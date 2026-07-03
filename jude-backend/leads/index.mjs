// Jude — Leads Engine (flagship subagent)
// Runtime: Node.js 20.x (ESM).
//
// Leads originate from INBOUND EMAIL. Jude analyzes each email to decide if
// it's a business lead; if so, it captures + categorizes + scores the lead,
// alerts the owner (via jude-notify-owner), and (later, with Bedrock) carries
// on a conversation with the sender to bring the lead to fruition.
//
// BUILDABLE NOW (this file):
//   - processLead(): classify (rule-based) + score + store + alert owner
//   - list/update pipeline operations for staff
// SNAP-IN LATER (clearly marked seams):
//   - SES inbound receiving feeds processEmail() at the front
//   - Amazon Nova replaces classifyEmail()/scoreLead() and powers replies
//
// Routes (via API Gateway):
//   POST  /leads                 (internal/inbound) process a raw lead/email
//   GET   /leads                 (staff) list leads (optional ?stage=)
//   PATCH /leads/{id}            (staff) update stage / add note
//
// Direct-invoke payload (e.g., from an SES-inbound Lambda later):
//   { "from":"jane@x.com","subject":"...","body":"...","source":"email" }

import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, PutCommand, ScanCommand, QueryCommand,
  UpdateCommand, GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const TABLE = process.env.LEADS_TABLE || "jude-leads";
const NOTIFY_FN = process.env.NOTIFY_FN || "jude-notify-owner";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambda = new LambdaClient({});

const STAGES = new Set(["new", "contacted", "qualified", "converted", "lost"]);

// Case types this firm handles (used for categorization + scoring).
const CASE_KEYWORDS = {
  "personal-injury": ["injury","injured","accident","slip","fall","crash","hurt","car accident"],
  "traffic-tickets": ["ticket","speeding","traffic","citation","license","dui","dwi","pulled over"],
  "misdemeanors": ["misdemeanor","charge","arrest","criminal","court date","bail"],
  "expungements": ["expunge","expungement","record","clear my record","seal"],
  "probate-estate-planning": ["will","trust","estate","probate","inheritance","power of attorney","died","passed away"],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NON_LEAD_HINTS = ["unsubscribe","newsletter","invoice","receipt","no-reply","noreply","out of office","automatic reply"];

// ── SEAM 1: is this email a business lead? (rule-based now; Nova later) ──
function classifyEmail({ subject, body, from }) {
  const text = ((subject || "") + " " + (body || "")).toLowerCase();
  // Obvious non-leads.
  if (NON_LEAD_HINTS.some((h) => text.includes(h))) return { isLead: false, caseType: null, reason: "matched non-lead hint" };
  // Category detection.
  let best = null, bestHits = 0;
  for (const [ct, words] of Object.entries(CASE_KEYWORDS)) {
    const hits = words.filter((w) => text.includes(w)).length;
    if (hits > bestHits) { best = ct; bestHits = hits; }
  }
  // Heuristic: a real person emailing about a matter -> treat as lead.
  const looksPersonal = EMAIL_RE.test(from || "") && (body || "").length > 20;
  const isLead = bestHits > 0 || looksPersonal;
  return { isLead, caseType: best || "general", reason: bestHits ? "case keywords" : (looksPersonal ? "personal inquiry" : "no signal") };
}

// ── SEAM 2: score the lead 0-100 (rule-based now; Nova later) ──
function scoreLead({ caseType, body, subject }) {
  let score = 40;
  if (caseType && caseType !== "general") score += 25;         // identifiable matter
  if ((body || "").length > 120) score += 15;                   // detailed inquiry
  if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(body || "")) score += 10; // gave a phone #
  if (/(urgent|asap|court date|deadline|tomorrow)/i.test((subject||"")+(body||""))) score += 10;
  return Math.min(100, score);
}

async function alertOwner(evt) {
  try {
    await lambda.send(new InvokeCommand({
      FunctionName: NOTIFY_FN,
      InvocationType: "Event", // async, fire-and-forget
      Payload: Buffer.from(JSON.stringify(evt)),
    }));
  } catch (err) {
    console.error("alertOwner failed (non-fatal):", err);
  }
}

// ── Process one inbound lead/email ──
async function processEmail(evt) {
  const from = String(evt.from || "").trim().toLowerCase().slice(0, 200);
  const subject = String(evt.subject || "").slice(0, 300);
  const body = String(evt.body || "").slice(0, 8000);
  const source = String(evt.source || "email").slice(0, 40);

  const cls = classifyEmail({ subject, body, from });
  if (!cls.isLead) {
    return { ok: true, isLead: false, reason: cls.reason };
  }

  const score = scoreLead({ caseType: cls.caseType, body, subject });
  const leadId = "LD-" + Date.now().toString(36).toUpperCase() + "-" + randomUUID().slice(0, 4).toUpperCase();
  const now = new Date().toISOString();

  const item = {
    leadId, stage: "new", email: from, subject,
    caseType: cls.caseType, score, source,
    firstMessage: body,
    conversation: [{ role: "lead", text: body, at: now }],
    createdAt: now, updatedAt: now,
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));

  // Alert the owner through the comms backbone (leads => high importance).
  await alertOwner({
    center: "leads", type: "new_lead", importance: "high",
    message: `New ${cls.caseType} lead (score ${score}) from ${from}: ${subject || body.slice(0, 80)}`,
    meta: { leadId, caseType: cls.caseType, score },
  });

  // NOTE (SEAM 3): here is where Jude would draft + send a conversational
  // reply to the lead (SES) once Bedrock is authorized. Left as a hook.
  return { ok: true, isLead: true, leadId, caseType: cls.caseType, score };
}

async function listLeads(event, headers) {
  const stage = event.queryStringParameters?.stage;
  let items;
  if (stage && STAGES.has(stage)) {
    const r = await ddb.send(new QueryCommand({
      TableName: TABLE, IndexName: "stage-index",
      KeyConditionExpression: "stage = :s",
      ExpressionAttributeValues: { ":s": stage },
    }));
    items = r.Items || [];
  } else {
    const r = await ddb.send(new ScanCommand({ TableName: TABLE }));
    items = r.Items || [];
  }
  items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return resp(200, headers, { ok: true, leads: items });
}

async function updateLead(event, headers) {
  const leadId = event.pathParameters?.id || (event.rawPath || "").split("/").pop();
  let body; try { body = JSON.parse(event.body || "{}"); } catch { return resp(400, headers, { error: "Invalid JSON" }); }
  const sets = [], names = {}, values = {};
  if (body.stage) {
    if (!STAGES.has(body.stage)) return resp(400, headers, { error: "Invalid stage" });
    sets.push("#st = :st"); names["#st"] = "stage"; values[":st"] = body.stage;
  }
  if (body.note) {
    sets.push("#c = list_append(if_not_exists(#c,:e),:n)");
    names["#c"] = "conversation"; values[":e"] = []; values[":n"] = [{ role: "staff", text: String(body.note).slice(0,4000), at: new Date().toISOString() }];
  }
  if (!sets.length) return resp(400, headers, { error: "Nothing to update" });
  sets.push("#u = :u"); names["#u"] = "updatedAt"; values[":u"] = new Date().toISOString();
  const r = await ddb.send(new UpdateCommand({
    TableName: TABLE, Key: { leadId },
    UpdateExpression: "SET " + sets.join(", "),
    ExpressionAttributeNames: names, ExpressionAttributeValues: values,
    ConditionExpression: "attribute_exists(leadId)", ReturnValues: "ALL_NEW",
  }));
  return resp(200, headers, { ok: true, lead: r.Attributes });
}

function resp(code, headers, obj) {
  return { statusCode: code, headers, body: JSON.stringify(obj) };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Content-Type": "application/json",
};

export const handler = async (event) => {
  // Direct invoke (no HTTP wrapper) => treat as an inbound email to process.
  if (!event.requestContext && (event.from || event.body_raw)) {
    return await processEmail(event);
  }
  const method = event.requestContext?.http?.method;
  if (method === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  try {
    if (method === "POST") {
      let evt; try { evt = JSON.parse(event.body || "{}"); } catch { return resp(400, CORS, { error: "Invalid JSON" }); }
      return resp(200, CORS, await processEmail(evt));
    }
    if (method === "GET") return await listLeads(event, CORS);
    if (method === "PATCH") return await updateLead(event, CORS);
  } catch (err) {
    console.error("Leads handler error:", err);
    return resp(500, CORS, { error: "Server error" });
  }
  return resp(404, CORS, { error: "Not found" });
};
