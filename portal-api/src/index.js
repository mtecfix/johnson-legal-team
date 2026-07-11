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
