'use strict';
// Johnson Legal Team — Client Portal Data API (Lambda handler).
//
// Security model:
//  - API Gateway HTTP API has a Cognito JWT authorizer that verifies the token
//    SIGNATURE against the Cognito issuer's JWKS before this code runs. So the
//    claims in event.requestContext.authorizer.jwt.claims are TRUSTED.
//  - This handler enforces AUTHORIZATION: role checks + per-record ownership
//    (a client can only read their own rows).
//
// Data: single-table DynamoDB.
//   PK = "USER#<userId>", SK = "PROFILE" | "CASE#<id>" | "DOC#<id>" | ...

const TABLE = process.env.TABLE_NAME;

// Lazy-initialised DynamoDB doc client. Kept out of module top-level so the
// pure helpers remain unit-testable without the AWS SDK installed locally
// (the SDK is provided by the Lambda runtime at deploy time).
let _ddb = null;
function db() {
  if (!_ddb) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
    _ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return _ddb;
}
function cmds() { return require('@aws-sdk/lib-dynamodb'); }

// Lazy SES v2 client (email dispatch).
let _ses = null;
function ses() {
  if (!_ses) {
    const { SESv2Client } = require('@aws-sdk/client-sesv2');
    _ses = new SESv2Client({});
  }
  return _ses;
}

// Lazy SNS client (SMS dispatch).
let _sns = null;
function sns() {
  if (!_sns) {
    const { SNSClient } = require('@aws-sdk/client-sns');
    _sns = new SNSClient({});
  }
  return _sns;
}

const FROM_EMAIL = process.env.FROM_EMAIL || 'johnsonlegalteam@gmail.com';
const FIRM_NAME = 'Johnson Legal Team';

const ADMIN_GROUPS = ['admin', 'super_admin'];

exports.handler = async (event) => {
  try {
    const claims = getClaims(event);
    if (!claims || !claims.sub) return resp(401, { error: 'Unauthorized' });

    const userId = claims.sub;                 // Cognito subject (stable id)
    const groups = parseGroups(claims['cognito:groups']);
    const role = groups.includes('super_admin') ? 'super_admin'
               : groups.includes('admin') ? 'admin' : 'client';

    const method = event.requestContext?.http?.method || 'GET';
    const path = event.requestContext?.http?.path || event.rawPath || '';
    const segments = path.replace(/^\/+/, '').split('/');
    const route = segments[0];

    const ctx = { userId, role, claims, method, body: parseBody(event), segments };

    if (route === 'admin') {
      // All /admin/* routes require an elevated role.
      if (!ADMIN_GROUPS.includes(role)) return resp(403, { error: 'Forbidden' });
      return await handleAdmin(ctx);
    }

    switch (route) {
      case 'profile':      return await handleProfile(ctx);
      case 'cases':        return await handleList(ctx, 'CASE#');
      case 'documents':    return await handleList(ctx, 'DOC#');
      case 'messages':     return await handleMessages(ctx);
      case 'invoices':     return await handleList(ctx, 'INV#');
      case 'appointments': return await handleList(ctx, 'APPT#');
      default:             return resp(404, { error: 'Not found' });
    }
  } catch (err) {
    console.error('Unhandled error', err);
    return resp(500, { error: 'Internal error' });
  }
};

// --- Handlers ---------------------------------------------------------------

async function handleProfile(ctx) {
  const { GetCommand, PutCommand } = cmds();
  if (ctx.method === 'GET') {
    const out = await db().send(new GetCommand({
      TableName: TABLE, Key: { PK: `USER#${ctx.userId}`, SK: 'PROFILE' },
    }));
    return resp(200, { profile: out.Item || null });
  }
  if (ctx.method === 'PUT') {
    const b = ctx.body || {};
    const item = {
      PK: `USER#${ctx.userId}`, SK: 'PROFILE',
      email: ctx.claims.email,
      first_name: str(b.first_name), last_name: str(b.last_name),
      phone: str(b.phone), address: str(b.address),
      city: str(b.city), state: str(b.state), zip_code: str(b.zip_code),
      updated_at: new Date().toISOString(),
    };
    await db().send(new PutCommand({ TableName: TABLE, Item: item }));
    return resp(200, { success: true });
  }
  return resp(405, { error: 'Method not allowed' });
}

// Generic owner-scoped list: returns rows under the caller's partition whose
// SK begins with the given prefix. Ownership is implicit in the PK.
async function handleList(ctx, skPrefix) {
  if (ctx.method !== 'GET') return resp(405, { error: 'Method not allowed' });
  const { QueryCommand } = cmds();
  const out = await db().send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `USER#${ctx.userId}`, ':sk': skPrefix },
  }));
  return resp(200, { items: out.Items || [] });
}

async function handleMessages(ctx) {
  if (ctx.method === 'GET') return handleList(ctx, 'MSG#');
  if (ctx.method === 'POST') {
    const { PutCommand } = cmds();
    const b = ctx.body || {};
    if (!b.subject || !b.message) return resp(400, { error: 'subject and message required' });
    const id = Date.now().toString();
    await db().send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `USER#${ctx.userId}`, SK: `MSG#${id}`,
        subject: str(b.subject), message: str(b.message),
        case_id: b.case_id ? str(b.case_id) : null,
        created_at: new Date().toISOString(),
      },
    }));
    return resp(201, { success: true, message_id: id });
  }
  return resp(405, { error: 'Method not allowed' });
}

// --- Admin handlers (require admin/super_admin; enforced by the router) -----

async function handleAdmin(ctx) {
  const resource = ctx.segments[1] || '';
  switch (resource) {
    case 'clients':       return await adminList(ctx, 'USER');
    case 'cases':         return await adminCases(ctx);
    case 'invoices':      return await adminList(ctx, 'INV');
    case 'registrations': return await adminRegistrations(ctx);
    case 'users':         return await adminUsers(ctx);
    case 'messages':      return await adminMessages(ctx);
    case 'appointments':  return await adminAppointments(ctx);
    default:              return resp(404, { error: 'Not found' });
  }
}

// Cross-user list via GSI1 (GSI1PK = entity type). Admin-only.
async function adminList(ctx, entityType) {
  if (ctx.method !== 'GET') return resp(405, { error: 'Method not allowed' });
  const { QueryCommand } = cmds();
  const out = await db().send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': entityType },
  }));
  return resp(200, { items: out.Items || [] });
}

// All cases across all users — scan for SK begins_with CASE#, join with profile
async function adminCases(ctx) {
  if (ctx.method !== 'GET') return resp(405, { error: 'Method not allowed' });
  const { ScanCommand, QueryCommand } = cmds();
  const out = await db().send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':sk': 'CASE#' },
  }));
  // Enrich with client name from profiles
  const cases = out.Items || [];
  const profileCache = {};
  for (const c of cases) {
    const pk = c.PK;
    if (!profileCache[pk]) {
      try {
        const p = await db().send(new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: 'PK = :pk AND SK = :sk',
          ExpressionAttributeValues: { ':pk': pk, ':sk': 'PROFILE' },
        }));
        profileCache[pk] = (p.Items && p.Items[0]) || {};
      } catch (_) { profileCache[pk] = {}; }
    }
    const prof = profileCache[pk];
    c.client_name = ((prof.first_name || '') + ' ' + (prof.last_name || '')).trim();
    c.client_email = prof.email || '';
  }
  return resp(200, { items: cases });
}

async function adminRegistrations(ctx) {
  if (ctx.method === 'GET') {
    const { QueryCommand } = cmds();
    const out = await db().send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': 'REG#pending' },
    }));
    return resp(200, { registrations: out.Items || [] });
  }
  if (ctx.method === 'POST') {
    // Approve/reject: { user_id, decision: 'approved' | 'rejected' }
    const b = ctx.body || {};
    const decision = b.decision === 'approved' ? 'approved' : b.decision === 'rejected' ? 'rejected' : null;
    if (!b.user_id || !decision) return resp(400, { error: 'user_id and valid decision required' });
    const { UpdateCommand } = cmds();
    await db().send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `USER#${str(b.user_id)}`, SK: 'PROFILE' },
      UpdateExpression: 'SET registration_status = :s, GSI1PK = :g',
      ExpressionAttributeValues: { ':s': decision, ':g': `REG#${decision}` },
    }));
    return resp(200, { success: true, status: decision });
  }
  return resp(405, { error: 'Method not allowed' });
}

async function adminUsers(ctx) {
  if (ctx.method === 'GET') return adminList(ctx, 'USER');
  if (ctx.method === 'PUT') {
    // Change role — SUPER ADMIN ONLY. { user_id, role }
    if (ctx.role !== 'super_admin') return resp(403, { error: 'Super admin required' });
    const b = ctx.body || {};
    const valid = ['client', 'admin', 'super_admin'];
    if (!b.user_id || !valid.includes(b.role)) return resp(400, { error: 'user_id and valid role required' });
    const { UpdateCommand } = cmds();
    await db().send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `USER#${str(b.user_id)}`, SK: 'PROFILE' },
      UpdateExpression: 'SET #r = :role',
      ExpressionAttributeNames: { '#r': 'role' },
      ExpressionAttributeValues: { ':role': b.role },
    }));
    return resp(200, { success: true });
  }
  return resp(405, { error: 'Method not allowed' });
}

// --- Admin messaging: send email or SMS to a client, log the thread --------

// GET  /admin/messages            -> all outbound/inbound messages (log)
// POST /admin/messages            -> send a message { to_user_id, channel:'email'|'sms', subject, body }
async function adminMessages(ctx) {
  const { QueryCommand, PutCommand, GetCommand, ScanCommand } = cmds();

  if (ctx.method === 'GET') {
    // Optional ?user_id filter via query — else return the whole log (newest first).
    const out = await db().send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':sk': 'ADMINMSG#' },
    }));
    const items = (out.Items || []).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return resp(200, { items });
  }

  if (ctx.method === 'POST') {
    const b = ctx.body || {};
    const channel = b.channel === 'sms' ? 'sms' : 'email';
    if (!b.to_user_id) return resp(400, { error: 'to_user_id required' });
    if (!b.body) return resp(400, { error: 'body required' });

    // Look up the recipient profile for contact details.
    const prof = await db().send(new GetCommand({
      TableName: TABLE, Key: { PK: `USER#${str(b.to_user_id)}`, SK: 'PROFILE' },
    }));
    const recipient = prof.Item;
    if (!recipient) return resp(404, { error: 'Recipient not found' });

    const clientName = ((recipient.first_name || '') + ' ' + (recipient.last_name || '')).trim() || 'Client';
    let dispatch = { ok: false, detail: '' };

    if (channel === 'email') {
      if (!recipient.email) return resp(400, { error: 'Recipient has no email on file' });
      dispatch = await sendEmail(recipient.email, b.subject || `A message from ${FIRM_NAME}`, b.body, clientName);
    } else {
      const phone = recipient.phone || recipient.phone_number;
      if (!phone) return resp(400, { error: 'Recipient has no phone number on file' });
      dispatch = await sendSms(phone, b.body);
    }

    // Log the message regardless of dispatch outcome (audit trail).
    const id = Date.now().toString();
    const item = {
      PK: `USER#${str(b.to_user_id)}`, SK: `ADMINMSG#${id}`,
      GSI1PK: 'ADMINMSG', GSI1SK: id,
      direction: 'outbound', channel,
      to_user_id: str(b.to_user_id), to_name: clientName,
      to_address: channel === 'email' ? recipient.email : (recipient.phone || recipient.phone_number),
      subject: str(b.subject) || null,
      body: str(b.body),
      sent_by: ctx.claims.email || ctx.userId,
      status: dispatch.ok ? 'sent' : 'failed',
      error: dispatch.ok ? null : str(dispatch.detail),
      created_at: new Date().toISOString(),
    };
    await db().send(new PutCommand({ TableName: TABLE, Item: item }));

    if (!dispatch.ok) return resp(502, { error: 'Message logged but delivery failed', detail: dispatch.detail, message: item });
    return resp(201, { success: true, message: item });
  }

  return resp(405, { error: 'Method not allowed' });
}

// GET/POST /admin/appointments — calendar events & deadlines (firm-wide)
async function adminAppointments(ctx) {
  const { ScanCommand, PutCommand } = cmds();
  if (ctx.method === 'GET') {
    const out = await db().send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':sk': 'EVENT#' },
    }));
    const items = (out.Items || []).sort((a, b) => (a.event_date || '').localeCompare(b.event_date || ''));
    return resp(200, { items });
  }
  if (ctx.method === 'POST') {
    const b = ctx.body || {};
    if (!b.title || !b.event_date) return resp(400, { error: 'title and event_date required' });
    const id = Date.now().toString();
    const item = {
      PK: b.user_id ? `USER#${str(b.user_id)}` : 'FIRM',
      SK: `EVENT#${id}`,
      GSI1PK: 'EVENT', GSI1SK: str(b.event_date),
      title: str(b.title),
      event_date: str(b.event_date),
      event_type: str(b.event_type) || 'court',   // court | deadline | meeting | filing
      location: str(b.location) || null,
      case_id: b.case_id ? str(b.case_id) : null,
      client_name: str(b.client_name) || null,
      notes: str(b.notes) || null,
      created_by: ctx.claims.email || ctx.userId,
      created_at: new Date().toISOString(),
    };
    await db().send(new PutCommand({ TableName: TABLE, Item: item }));
    return resp(201, { success: true, event: item });
  }
  return resp(405, { error: 'Method not allowed' });
}

// --- Dispatch: SES email (branded HTML) + SNS SMS ---------------------------

async function sendEmail(toAddress, subject, bodyText, clientName) {
  try {
    const { SendEmailCommand } = require('@aws-sdk/client-sesv2');
    await ses().send(new SendEmailCommand({
      FromEmailAddress: `${FIRM_NAME} <${FROM_EMAIL}>`,
      Destination: { ToAddresses: [toAddress] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: emailTemplate(subject, bodyText, clientName), Charset: 'UTF-8' },
            Text: { Data: bodyText, Charset: 'UTF-8' },
          },
        },
      },
    }));
    return { ok: true };
  } catch (e) {
    console.error('SES send failed', e);
    return { ok: false, detail: e.name === 'MessageRejected' ? 'Email rejected (recipient may be unverified — SES sandbox)' : (e.message || 'send failed') };
  }
}

async function sendSms(phoneNumber, message) {
  try {
    const { PublishCommand } = require('@aws-sdk/client-sns');
    // Normalise to E.164 (assume US if 10 digits).
    let num = String(phoneNumber).replace(/[^\d+]/g, '');
    if (!num.startsWith('+')) {
      if (num.length === 10) num = '+1' + num;
      else if (num.length === 11 && num.startsWith('1')) num = '+' + num;
      else num = '+' + num;
    }
    await sns().send(new PublishCommand({
      PhoneNumber: num,
      Message: `${FIRM_NAME}: ${message}`,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
      },
    }));
    return { ok: true };
  } catch (e) {
    console.error('SNS send failed', e);
    return { ok: false, detail: e.message || 'sms failed' };
  }
}

// Branded navy + gold HTML email wrapper.
function emailTemplate(subject, bodyText, clientName) {
  const safeBody = String(bodyText).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <tr><td style="background:#1B365D;padding:28px 32px;text-align:center;">
          <div style="font-size:22px;font-weight:700;color:#D4AF37;letter-spacing:.5px;">⚖️ JOHNSON LEGAL TEAM</div>
          <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:4px;">Attorney Rodney M. Johnson</div>
        </td></tr>
        <tr><td style="height:3px;background:#D4AF37;"></td></tr>
        <tr><td style="padding:32px;">
          <p style="font-size:15px;color:#1F2937;margin:0 0 16px;">Dear ${escHtml(clientName)},</p>
          <div style="font-size:14px;line-height:1.7;color:#374151;">${safeBody}</div>
          <p style="font-size:14px;color:#374151;margin:24px 0 0;">Sincerely,<br><strong>Rodney M. Johnson</strong><br>Johnson Legal Team</p>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">
          Johnson Legal Team &nbsp;•&nbsp; (833) 659-8378 &nbsp;•&nbsp; johnsonlegalteam@gmail.com<br>
          <span style="font-size:11px;color:#9ca3af;">This message may contain confidential attorney-client information.</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// --- Helpers ----------------------------------------------------------------

function getClaims(event) {
  // HTTP API JWT authorizer places verified claims here.
  return event?.requestContext?.authorizer?.jwt?.claims || null;
}

function parseGroups(g) {
  if (!g) return [];
  if (Array.isArray(g)) return g;
  // Cognito may serialize groups as a string like "[admin super_admin]".
  return String(g).replace(/[[\]]/g, '').split(/[\s,]+/).filter(Boolean);
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return JSON.parse(raw);
  } catch { return {}; }
}

function str(v) { return v == null ? null : String(v).slice(0, 5000); }

function resp(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// Exported for unit tests.
exports._internal = { parseGroups, parseBody, str };
