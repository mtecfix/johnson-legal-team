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
    const route = path.replace(/^\/+/, '').split('/')[0];

    const ctx = { userId, role, claims, method, body: parseBody(event) };

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
