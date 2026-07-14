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
    case 'clients':       return await adminClients(ctx);
    case 'cases':         return await adminCases(ctx);
    case 'invoices':      return await adminInvoices(ctx);
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

// Admin clients: list, create, update
async function adminClients(ctx) {
  const { PutCommand, UpdateCommand } = cmds();

  if (ctx.method === 'GET') return adminList(ctx, 'USER');

  if (ctx.method === 'POST') {
    // Create new contact: { email, first_name, last_name, phone, role, category, city, state, notes }
    const b = ctx.body || {};
    if (!b.first_name && !b.last_name) return resp(400, { error: 'first_name or last_name required' });
    const id = require('crypto').randomUUID();
    const item = {
      PK: `USER#${id}`, SK: 'PROFILE',
      GSI1PK: 'USER', GSI1SK: id,
      email: str(b.email) || '',
      first_name: str(b.first_name) || '',
      last_name: str(b.last_name) || '',
      phone: str(b.phone) || '',
      role: str(b.role) || 'client',
      category: str(b.category) || '',
      city: str(b.city) || '',
      state: str(b.state) || '',
      notes: str(b.notes) || '',
      created_at: new Date().toISOString(),
    };
    await db().send(new PutCommand({ TableName: TABLE, Item: item }));

    // Lifecycle: notify admin about new client (if role is 'client')
    if ((b.role || 'client') === 'client') {
      const clientName = ((b.first_name || '') + ' ' + (b.last_name || '')).trim();
      try {
        await lifecycleNotify('CLIENT_CREATED', {
          client_name: clientName,
          client_email: b.email || '',
          client_phone: b.phone || '',
          user_id: id,
        }, ctx);
      } catch (e) { console.error('Lifecycle notify failed:', e.message); }
    }

    return resp(201, { success: true, user_id: id, item });
  }

  if (ctx.method === 'PUT') {
    // Update contact: { user_id, first_name?, last_name?, email?, phone?, role?, category?, city?, state?, notes? }
    const b = ctx.body || {};
    if (!b.user_id) return resp(400, { error: 'user_id required' });
    const updates = [];
    const names = {};
    const values = {};
    const fields = ['first_name','last_name','email','phone','role','category','city','state','notes'];
    fields.forEach((f, i) => {
      if (b[f] !== undefined) {
        const alias = `#f${i}`;
        const valAlias = `:v${i}`;
        updates.push(`${alias} = ${valAlias}`);
        names[alias] = f;
        values[valAlias] = str(b[f]);
      }
    });
    if (!updates.length) return resp(400, { error: 'No fields to update' });
    updates.push('#ua = :ua'); names['#ua'] = 'updated_at'; values[':ua'] = new Date().toISOString();

    await db().send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `USER#${str(b.user_id)}`, SK: 'PROFILE' },
      UpdateExpression: 'SET ' + updates.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
    return resp(200, { success: true });
  }

  return resp(405, { error: 'Method not allowed' });
}

// All cases across all users — scan for SK begins_with CASE#, join with profile
async function adminCases(ctx) {
  const { ScanCommand, QueryCommand, PutCommand, UpdateCommand, DeleteCommand } = cmds();

  if (ctx.method === 'GET') {
    const out = await db().send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':sk': 'CASE#' },
    }));
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
      c.client_phone = prof.phone || prof.phone_number || '';
    }
    return resp(200, { items: cases });
  }

  if (ctx.method === 'POST') {
    // Create case: { user_id, case_type, folder, notes }
    const b = ctx.body || {};
    if (!b.user_id) return resp(400, { error: 'user_id required' });
    const id = require('crypto').randomBytes(4).toString('hex');
    const item = {
      PK: `USER#${str(b.user_id)}`, SK: `CASE#${id}`,
      case_type: str(b.case_type) || 'general',
      status: 'active',
      folder: str(b.folder) || '',
      notes: str(b.notes) || '',
      opened_at: new Date().toISOString(),
      created_by: ctx.claims.email || ctx.userId,
    };
    await db().send(new PutCommand({ TableName: TABLE, Item: item }));
    return resp(201, { success: true, case_id: id, item });
  }

  if (ctx.method === 'PUT') {
    // Update case: { user_id, case_id, status?, case_type?, folder?, notes? }
    const b = ctx.body || {};
    if (!b.user_id || !b.case_id) return resp(400, { error: 'user_id and case_id required' });
    const updates = [];
    const names = {};
    const values = {};
    if (b.status !== undefined)    { updates.push('#st = :st');   names['#st'] = 'status';    values[':st'] = str(b.status); }
    if (b.case_type !== undefined) { updates.push('#ct = :ct');   names['#ct'] = 'case_type'; values[':ct'] = str(b.case_type); }
    if (b.folder !== undefined)    { updates.push('#fo = :fo');   names['#fo'] = 'folder';    values[':fo'] = str(b.folder); }
    if (b.notes !== undefined)     { updates.push('#no = :no');   names['#no'] = 'notes';     values[':no'] = str(b.notes); }
    if (b.closed_at !== undefined) { updates.push('#cl = :cl');   names['#cl'] = 'closed_at'; values[':cl'] = str(b.closed_at); }
    if (!updates.length) return resp(400, { error: 'No fields to update' });
    updates.push('#ua = :ua'); names['#ua'] = 'updated_at'; values[':ua'] = new Date().toISOString();

    await db().send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `USER#${str(b.user_id)}`, SK: `CASE#${str(b.case_id)}` },
      UpdateExpression: 'SET ' + updates.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));

    // Lifecycle: notify admin when case is closed
    if (b.status === 'closed') {
      try {
        // Get client profile for the notification
        const { QueryCommand: QC } = cmds();
        const prof = await db().send(new QC({
          TableName: TABLE,
          KeyConditionExpression: 'PK = :pk AND SK = :sk',
          ExpressionAttributeValues: { ':pk': `USER#${str(b.user_id)}`, ':sk': 'PROFILE' },
        }));
        const p = (prof.Items && prof.Items[0]) || {};
        const clientName = ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || 'Client';
        await lifecycleNotify('CASE_CLOSED', {
          client_name: clientName,
          client_email: p.email || '',
          user_id: b.user_id,
          case_id: b.case_id,
          case_type: b.case_type || '',
        }, ctx);
      } catch (e) { console.error('Lifecycle notify (case close) failed:', e.message); }
    }

    return resp(200, { success: true });
  }

  if (ctx.method === 'DELETE') {
    const b = ctx.body || {};
    if (!b.user_id || !b.case_id) return resp(400, { error: 'user_id and case_id required' });
    await db().send(new DeleteCommand({
      TableName: TABLE,
      Key: { PK: `USER#${str(b.user_id)}`, SK: `CASE#${str(b.case_id)}` },
    }));
    return resp(200, { success: true });
  }

  return resp(405, { error: 'Method not allowed' });
}

// Admin invoices: list all + create + mark paid
async function adminInvoices(ctx) {
  const { ScanCommand, PutCommand, UpdateCommand, QueryCommand } = cmds();

  if (ctx.method === 'GET') {
    const out = await db().send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':sk': 'INV#' },
    }));
    const invoices = (out.Items || []).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    // Enrich with client name
    const profileCache = {};
    for (const inv of invoices) {
      const pk = inv.PK;
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
      inv.client_name = ((prof.first_name || '') + ' ' + (prof.last_name || '')).trim();
      inv.client_email = prof.email || '';
    }
    return resp(200, { invoices });
  }

  if (ctx.method === 'POST') {
    // Create invoice: { user_id, amount, description, due_date }
    const b = ctx.body || {};
    if (!b.user_id || !b.amount) return resp(400, { error: 'user_id and amount required' });
    const id = Date.now().toString();
    const item = {
      PK: `USER#${str(b.user_id)}`, SK: `INV#${id}`,
      GSI1PK: 'INV', GSI1SK: id,
      amount: Number(b.amount) || 0,
      description: str(b.description) || '',
      status: 'pending',
      due_date: str(b.due_date) || null,
      case_id: str(b.case_id) || null,
      created_by: ctx.claims.email || ctx.userId,
      created_at: new Date().toISOString(),
    };
    await db().send(new PutCommand({ TableName: TABLE, Item: item }));
    return resp(201, { success: true, invoice_id: id, item });
  }

  if (ctx.method === 'PUT') {
    // Update invoice (mark paid, update amount, etc): { user_id, invoice_id, status?, amount? }
    const b = ctx.body || {};
    if (!b.user_id || !b.invoice_id) return resp(400, { error: 'user_id and invoice_id required' });
    const updates = [];
    const names = {};
    const values = {};
    if (b.status !== undefined)      { updates.push('#st = :st');   names['#st'] = 'status';      values[':st'] = str(b.status); }
    if (b.amount !== undefined)      { updates.push('#am = :am');   names['#am'] = 'amount';      values[':am'] = Number(b.amount) || 0; }
    if (b.description !== undefined) { updates.push('#de = :de');   names['#de'] = 'description'; values[':de'] = str(b.description); }
    if (b.paid_at !== undefined)     { updates.push('#pa = :pa');   names['#pa'] = 'paid_at';     values[':pa'] = str(b.paid_at); }
    if (!updates.length) return resp(400, { error: 'No fields to update' });
    updates.push('#ua = :ua'); names['#ua'] = 'updated_at'; values[':ua'] = new Date().toISOString();

    await db().send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `USER#${str(b.user_id)}`, SK: `INV#${str(b.invoice_id)}` },
      UpdateExpression: 'SET ' + updates.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
    return resp(200, { success: true });
  }

  return resp(405, { error: 'Method not allowed' });
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

    // Log to communication memory (for Jude style-learning)
    try {
      await logToMemory({
        to: clientName,
        channel,
        subject: str(b.subject) || null,
        body_preview: (str(b.body) || '').slice(0, 120),
        sent_by: ctx.claims.email || ctx.userId,
      });
    } catch (e) { console.error('Memory log failed:', e.message); }

    if (!dispatch.ok) return resp(502, { error: 'Message logged but delivery failed', detail: dispatch.detail, message: item });
    return resp(201, { success: true, message: item });
  }

  return resp(405, { error: 'Method not allowed' });
}

// GET/POST /admin/appointments — calendar events & deadlines (firm-wide)
async function adminAppointments(ctx) {
  const { ScanCommand, PutCommand } = cmds();

  if (ctx.method === 'GET') {
    // Fetch from Google Calendar + local DynamoDB events
    let gcalEvents = [];
    try {
      gcalEvents = await fetchGoogleCalendarEvents();
    } catch (e) {
      console.error('Google Calendar fetch failed:', e.message);
    }

    // Also get local DynamoDB events (for any that weren't synced to gcal)
    const out = await db().send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':sk': 'EVENT#' },
    }));
    const localItems = out.Items || [];

    // Merge: Google Calendar events + local-only events
    const gcalIds = new Set(gcalEvents.map(e => e.gcal_id));
    const localOnly = localItems.filter(e => !e.gcal_id || !gcalIds.has(e.gcal_id));
    const merged = [...gcalEvents, ...localOnly].sort((a, b) => (a.event_date || '').localeCompare(b.event_date || ''));

    return resp(200, { items: merged, source: 'google_calendar' });
  }

  if (ctx.method === 'POST') {
    const b = ctx.body || {};
    if (!b.title || !b.event_date) return resp(400, { error: 'title and event_date required' });

    // Create on Google Calendar
    let gcalId = null;
    try {
      gcalId = await createGoogleCalendarEvent(b);
    } catch (e) {
      console.error('Google Calendar create failed:', e.message);
    }

    // Also save locally in DynamoDB
    const id = Date.now().toString();
    const item = {
      PK: b.user_id ? `USER#${str(b.user_id)}` : 'FIRM',
      SK: `EVENT#${id}`,
      GSI1PK: 'EVENT', GSI1SK: str(b.event_date),
      title: str(b.title),
      event_date: str(b.event_date),
      event_type: str(b.event_type) || 'court',
      location: str(b.location) || null,
      case_id: b.case_id ? str(b.case_id) : null,
      client_name: str(b.client_name) || null,
      notes: str(b.notes) || null,
      gcal_id: gcalId,
      created_by: ctx.claims.email || ctx.userId,
      created_at: new Date().toISOString(),
    };
    await db().send(new PutCommand({ TableName: TABLE, Item: item }));
    return resp(201, { success: true, event: item, google_calendar: !!gcalId });
  }

  return resp(405, { error: 'Method not allowed' });
}

// --- Google Calendar integration ---

const GOOGLE_SECRET_ID = 'johnson-legal/gmail-refresh-token';
const GOOGLE_CLIENT_SECRET_ID = 'johnson-legal/google-oauth-client-secret';

let _gcalCreds = null;
async function getGoogleCredentials() {
  if (_gcalCreds) return _gcalCreds;
  const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
  const sm = new SecretsManagerClient({});

  const [tokenRes, clientRes] = await Promise.all([
    sm.send(new GetSecretValueCommand({ SecretId: GOOGLE_SECRET_ID })),
    sm.send(new GetSecretValueCommand({ SecretId: GOOGLE_CLIENT_SECRET_ID })),
  ]);

  const tokenData = JSON.parse(tokenRes.SecretString);
  const clientData = JSON.parse(clientRes.SecretString);
  const web = clientData.web;

  _gcalCreds = {
    clientId: web.client_id,
    clientSecret: web.client_secret,
    refreshToken: tokenData.refresh_token,
  };
  return _gcalCreds;
}

async function getGoogleAccessToken() {
  const creds = await getGoogleCredentials();
  const params = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get Google access token');
  return data.access_token;
}

async function fetchGoogleCalendarEvents() {
  const token = await getGoogleAccessToken();
  const now = new Date();
  const timeMin = new Date(now.getTime() - 30 * 864e5).toISOString(); // 30 days ago
  const timeMax = new Date(now.getTime() + 90 * 864e5).toISOString(); // 90 days ahead

  const params = new URLSearchParams({
    timeMin, timeMax,
    maxResults: '100',
    singleEvents: 'true',
    orderBy: 'startTime',
  });

  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.items) return [];

  // Map Google Calendar events to our format
  return data.items.map(e => {
    const start = e.start?.dateTime || e.start?.date || '';
    const typeGuess = guessEventType(e.summary || '', e.location || '');
    return {
      gcal_id: e.id,
      title: e.summary || '(No title)',
      event_date: start,
      event_type: typeGuess,
      location: e.location || null,
      notes: e.description || null,
      source: 'google_calendar',
    };
  });
}

function guessEventType(title, location) {
  const t = (title + ' ' + location).toLowerCase();
  if (t.includes('court') || t.includes('hearing') || t.includes('trial') || t.includes('arraign')) return 'court';
  if (t.includes('deadline') || t.includes('due') || t.includes('filing deadline')) return 'deadline';
  if (t.includes('filing') || t.includes('file') || t.includes('motion')) return 'filing';
  if (t.includes('meeting') || t.includes('consult') || t.includes('client')) return 'meeting';
  return 'meeting';
}

async function createGoogleCalendarEvent(eventData) {
  const token = await getGoogleAccessToken();
  const startDate = new Date(eventData.event_date);
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour default

  const gcalEvent = {
    summary: eventData.title,
    location: eventData.location || '',
    description: [
      eventData.notes || '',
      eventData.event_type ? `Type: ${eventData.event_type}` : '',
      eventData.client_name ? `Client: ${eventData.client_name}` : '',
    ].filter(Boolean).join('\n'),
    start: { dateTime: startDate.toISOString(), timeZone: 'America/Detroit' },
    end: { dateTime: endDate.toISOString(), timeZone: 'America/Detroit' },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }, { method: 'popup', minutes: 1440 }] },
  };

  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(gcalEvent),
  });
  const data = await res.json();
  if (!data.id) throw new Error(data.error?.message || 'Failed to create event');
  return data.id;
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

// --- Communication Memory (style learning) -----------------------------------

// Logs a compact summary of every outgoing message for Jude to reference
// when matching Attorney Johnson's communication style. Stored as a rolling
// buffer in DynamoDB — max 50 entries, oldest pruned automatically.
async function logToMemory(data) {
  const { PutCommand, QueryCommand, DeleteCommand } = cmds();
  const ts = new Date().toISOString();
  const id = Date.now().toString();

  // Extract style signals from the message
  const body = data.body_preview || '';
  let greeting = '—';
  if (body.match(/^Greetings,/i)) greeting = 'Greetings,';
  else if (body.match(/^Good (morning|afternoon|evening)/i)) greeting = body.match(/^Good \w+,?/i)?.[0] || '—';
  else if (body.match(/^Hello/i)) greeting = 'Hello [name],';
  else if (body.match(/^Dear/i)) greeting = 'Dear [name],';

  let closing = '—';
  if (body.match(/Best,?\s*$/i)) closing = 'Best,';
  else if (body.match(/Respectfully,?\s*$/i)) closing = 'Respectfully,';
  else if (body.match(/Thank you,?\s*$/i)) closing = 'Thank you,';

  const entry = {
    PK: 'MEMORY', SK: `MSG#${id}`,
    timestamp: ts,
    to: str(data.to) || '',
    channel: data.channel || 'email',
    subject: str(data.subject) || '',
    body_preview: str(data.body_preview) || '',
    greeting,
    closing,
    sent_by: str(data.sent_by) || '',
    word_count: body.split(/\s+/).length,
  };

  await db().send(new PutCommand({ TableName: TABLE, Item: entry }));

  // Prune: keep only most recent 50 entries
  try {
    const existing = await db().send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': 'MEMORY', ':sk': 'MSG#' },
      ScanIndexForward: true, // oldest first
    }));
    const items = existing.Items || [];
    if (items.length > 50) {
      const toDelete = items.slice(0, items.length - 50);
      for (const old of toDelete) {
        await db().send(new DeleteCommand({ TableName: TABLE, Key: { PK: old.PK, SK: old.SK } }));
      }
    }
  } catch (_) { /* pruning is best-effort */ }
}

// --- Client Lifecycle Notifications -----------------------------------------

async function lifecycleNotify(eventType, data, ctx) {
  const { PutCommand } = cmds();

  if (eventType === 'CLIENT_CREATED') {
    // 1. Notify admin via internal admin message
    const adminMsg = `[CLIENT-NEW] ${data.client_name} added to portal.\nEmail: ${data.client_email || 'none'} | Phone: ${data.client_phone || 'none'}\n\nWould you like onboarding documentation sent to this client? Use the Messages section to send a welcome letter.`;

    // Log as admin notification
    const id = Date.now().toString();
    await db().send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: 'FIRM', SK: `NOTIFY#${id}`,
        GSI1PK: 'NOTIFY', GSI1SK: id,
        type: 'CLIENT_CREATED',
        message: adminMsg,
        client_name: data.client_name,
        client_email: data.client_email,
        user_id: data.user_id,
        status: 'pending_action',
        created_at: new Date().toISOString(),
      },
    }));

    // 2. Auto-send welcome letter to client (if email exists)
    if (data.client_email) {
      const firstName = data.client_name.split(' ')[0] || 'Client';
      await sendEmail(
        data.client_email,
        'Welcome to Johnson Legal Team — Getting Started',
        welcomeLetterText(firstName),
        firstName
      );

      // Log that welcome was sent
      const wId = (Date.now() + 1).toString();
      await db().send(new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `USER#${data.user_id}`, SK: `ADMINMSG#${wId}`,
          GSI1PK: 'ADMINMSG', GSI1SK: wId,
          direction: 'outbound', channel: 'email',
          to_user_id: data.user_id, to_name: data.client_name,
          to_address: data.client_email,
          subject: 'Welcome to Johnson Legal Team — Getting Started',
          body: '[Auto] Welcome/onboarding letter sent via Jude lifecycle.',
          sent_by: 'jude-lifecycle',
          status: 'sent',
          created_at: new Date().toISOString(),
        },
      }));
    }

    // 3. Notify admin that welcome was sent + ask about intake questionnaire
    const followupId = (Date.now() + 2).toString();
    await db().send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: 'FIRM', SK: `NOTIFY#${followupId}`,
        GSI1PK: 'NOTIFY', GSI1SK: followupId,
        type: 'LIFECYCLE_FOLLOWUP',
        message: `✓ Welcome letter sent to ${data.client_name} (${data.client_email}).\n\nWant to send an intake questionnaire to learn more about their legal matter? Use Messages → select ${data.client_name} → ask about their case details.`,
        client_name: data.client_name,
        user_id: data.user_id,
        status: 'info',
        created_at: new Date().toISOString(),
      },
    }));
  }

  if (eventType === 'CASE_CLOSED') {
    // 1. Notify admin
    const adminMsg = `[CASE-CLOSED] ${data.client_name} — ${data.case_type || 'general'}\nCase ${(data.case_id || '').substring(0, 8)} closed on ${new Date().toLocaleDateString()}.\n\nA thank-you letter has been sent. Would you like to send a feedback request as well? Use Messages to follow up.`;

    const id = Date.now().toString();
    await db().send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: 'FIRM', SK: `NOTIFY#${id}`,
        GSI1PK: 'NOTIFY', GSI1SK: id,
        type: 'CASE_CLOSED',
        message: adminMsg,
        client_name: data.client_name,
        client_email: data.client_email,
        user_id: data.user_id,
        case_id: data.case_id,
        status: 'pending_action',
        created_at: new Date().toISOString(),
      },
    }));

    // 2. Auto-send thank you letter
    if (data.client_email) {
      const firstName = data.client_name.split(' ')[0] || 'Client';
      await sendEmail(
        data.client_email,
        'Thank You — Johnson Legal Team',
        thankYouLetterText(firstName),
        firstName
      );

      // Log
      const tId = (Date.now() + 1).toString();
      await db().send(new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `USER#${data.user_id}`, SK: `ADMINMSG#${tId}`,
          GSI1PK: 'ADMINMSG', GSI1SK: tId,
          direction: 'outbound', channel: 'email',
          to_user_id: data.user_id, to_name: data.client_name,
          to_address: data.client_email,
          subject: 'Thank You — Johnson Legal Team',
          body: '[Auto] Thank-you letter sent via Jude lifecycle on case closure.',
          sent_by: 'jude-lifecycle',
          status: 'sent',
          created_at: new Date().toISOString(),
        },
      }));
    }

    // 3. Ask admin about feedback request
    const fbId = (Date.now() + 2).toString();
    await db().send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: 'FIRM', SK: `NOTIFY#${fbId}`,
        GSI1PK: 'NOTIFY', GSI1SK: fbId,
        type: 'LIFECYCLE_FOLLOWUP',
        message: `✓ Thank-you letter sent to ${data.client_name}.\n\nWant to request feedback? Send a message asking about their experience and include your Google Review link.`,
        client_name: data.client_name,
        user_id: data.user_id,
        case_id: data.case_id,
        status: 'info',
        created_at: new Date().toISOString(),
      },
    }));
  }
}

function welcomeLetterText(firstName) {
  return `Dear ${firstName},

Welcome to Johnson Legal Team! I'm pleased to confirm that you are now a client of our firm. Attorney Rodney M. Johnson will be handling your matter personally.

WHAT HAPPENS NEXT:
• We will review the details of your case and reach out to schedule an initial consultation (in person or by phone).
• If we need any documents or information from you, we'll let you know exactly what's needed.
• You can expect to hear from us within 1-2 business days.

HOW TO REACH US:
• Phone: (833) 659-8378
• Email: johnsonlegalteam@gmail.com
• Hours: Monday–Friday, 9:00 AM – 5:00 PM ET

IMPORTANT:
All communications between you and our office are protected by attorney-client privilege. Your privacy is our priority.

We look forward to working with you.

Warm regards,
Rodney M. Johnson, Esq.
Johnson Legal Team, PLLC`;
}

function thankYouLetterText(firstName) {
  return `Dear ${firstName},

Thank you for trusting Johnson Legal Team with your legal matter. It has been a privilege to represent you, and I'm glad we could bring your case to resolution.

YOUR FILE:
Your case file will be retained per our records policy. If you ever need copies of documents or have questions about your matter, don't hesitate to reach out.

FUTURE NEEDS:
Should you or anyone you know need legal assistance in the future — family law, criminal defense, probate, real estate, or personal injury — we are always here to help.

SHARE YOUR EXPERIENCE:
If you had a positive experience, a Google review helps others in our community find quality legal representation:
→ https://g.page/r/johnsonlegalteam/review

Thank you again for choosing Johnson Legal Team.

With appreciation,
Rodney M. Johnson, Esq.
Johnson Legal Team, PLLC
(833) 659-8378`;
}

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
