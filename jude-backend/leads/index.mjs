// Jude — Leads Engine (flagship subagent)
// Runtime: Node.js 20.x (ESM).
//
// Leads originate from contact forms, Lawyer.com referrals, and (planned)
// inbound email. Jude classifies, scores, stores, and alerts the owner.
//
// Routes (via API Gateway):
//   POST  /leads                 (internal/inbound) process a raw lead/email
//   GET   /leads                 (staff) list leads (optional ?stage=)
//   PATCH /leads/{id}            (staff) update stage / add note
//
// Direct-invoke payload:
//   { "from":"jane@x.com","subject":"...","body":"...","source":"email","location":"..." }

import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, PutCommand, ScanCommand, QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const TABLE = process.env.LEADS_TABLE || "jude-leads";
const NOTIFY_FN = process.env.NOTIFY_FN || "jude-notify-owner";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambda = new LambdaClient({});

const STAGES = new Set(["new", "contacted", "qualified", "converted", "lost"]);

// ═══════════════════════════════════════════════════════════════════════════
// PRACTICE AREA CLASSIFICATION
// Based on deep inbox analysis of johnsonlegalteam@gmail.com (32K+ messages)
// Ranked by actual caseload volume, most active first.
// ═══════════════════════════════════════════════════════════════════════════

const CASE_KEYWORDS = {
  "family-law": [
    "divorce", "custody", "child support", "visitation", "parenting time",
    "domestic", "separation", "alimony", "spousal support", "paternity",
    "child custody", "family court", "PPO", "personal protection order",
    "FOC", "friend of the court",
  ],
  "juvenile": [
    "juvenile", "delinquency", "minor", "youth", "teen", "child welfare",
    "foster", "DHHS", "abuse", "neglect", "truancy",
  ],
  "probate-estate": [
    "probate", "estate", "will", "trust", "guardianship", "conservatorship",
    "power of attorney", "POA", "died", "passed away", "inheritance",
    "executor", "personal representative", "living trust", "QCD",
    "estate planning", "decedent",
  ],
  "criminal-defense": [
    "criminal", "felony", "misdemeanor", "arrest", "arrested", "jail",
    "bail", "bond", "charge", "DUI", "DWI", "OWI", "CCW",
    "expunge", "expungement", "clear my record", "court appointed",
    "plea", "sentencing",
  ],
  "personal-injury": [
    "injury", "injured", "accident", "slip", "fall", "crash", "hurt",
    "car accident", "rear-ended", "whiplash", "premises liability",
    "negligence", "medical bills", "pain and suffering", "insurance claim",
  ],
  "real-estate": [
    "real estate", "property", "deed", "landlord", "tenant", "eviction",
    "quiet title", "land contract", "lease", "rent", "housing",
    "foreclosure", "title", "closing",
  ],
  "traffic": [
    "ticket", "speeding", "traffic", "citation", "license",
    "pulled over", "suspended license", "license restoration",
    "points", "driving record",
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// GEOGRAPHY SCORING
// Core service areas derived from actual client locations in inbox
// ═══════════════════════════════════════════════════════════════════════════

const CORE_COUNTIES = new Set([
  "wayne", "oakland",
]);

const METRO_DETROIT = new Set([
  "macomb", "washtenaw", "livingston", "monroe",
]);

const CORE_CITIES = new Set([
  "detroit", "southfield", "birmingham", "pontiac", "westland",
  "inkster", "oak park", "madison heights", "royal oak", "ferndale",
  "dearborn", "livonia", "redford", "taylor", "romulus",
  "canton", "plymouth", "northville", "farmington",
  "warren", "sterling heights", "roseville", "st clair shores",
  "ann arbor", "ypsilanti",
]);

// ═══════════════════════════════════════════════════════════════════════════
// LEAD SOURCES — quality ranking from inbox analysis
// ═══════════════════════════════════════════════════════════════════════════

const SOURCE_ADJUSTMENTS = {
  "lawyer.com": -20,     // Owner: "not obtained business in six months"
  "contact-form": 0,     // Neutral — organic
  "referral": +15,       // Direct referral from existing client/contact
  "court-appointed": +10,// Court assignment
  "email": +5,           // Direct email inquiry
  "phone": +10,          // Called the office = high intent
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NON_LEAD_HINTS = [
  "unsubscribe", "newsletter", "invoice", "receipt", "no-reply", "noreply",
  "out of office", "automatic reply", "auto-reply", "do not reply",
  "marketing", "promotion", "survey",
];

// ═══════════════════════════════════════════════════════════════════════════
// CLASSIFICATION (SEAM 1 — rule-based now; Gemini later)
// ═══════════════════════════════════════════════════════════════════════════

function classifyEmail({ subject, body, from, source }) {
  const text = ((subject || "") + " " + (body || "")).toLowerCase();

  // Obvious non-leads
  if (NON_LEAD_HINTS.some((h) => text.includes(h))) {
    return { isLead: false, caseType: null, reason: "matched non-lead hint" };
  }

  // Lawyer.com format detection
  if ((from || "").includes("lawyer.com") || (source || "").includes("lawyer.com")) {
    // Extract practice area from Lawyer.com referral format
    const practiceMatch = text.match(/practice area:\*?\s*\*?([^\n*]+)/i);
    const practiceRaw = practiceMatch ? practiceMatch[1].trim().toLowerCase() : "";

    // Map Lawyer.com practice areas to our canonical types
    let caseType = "general";
    if (/child support|divorce|custody|family/.test(practiceRaw)) caseType = "family-law";
    else if (/probate|will|trust|estate/.test(practiceRaw)) caseType = "probate-estate";
    else if (/expung/.test(practiceRaw)) caseType = "criminal-defense";
    else if (/personal injury|car accident|property damage|product/.test(practiceRaw)) caseType = "personal-injury";
    else if (/dui|dwi|criminal|misdemeanor/.test(practiceRaw)) caseType = "criminal-defense";
    else if (/real estate|landlord|tenant/.test(practiceRaw)) caseType = "real-estate";
    else if (/traffic|ticket/.test(practiceRaw)) caseType = "traffic";

    return { isLead: true, caseType, reason: "lawyer.com referral", sourceParsed: "lawyer.com" };
  }

  // General classification by keyword matching
  let best = null, bestHits = 0;
  for (const [ct, words] of Object.entries(CASE_KEYWORDS)) {
    const hits = words.filter((w) => text.includes(w)).length;
    if (hits > bestHits) { best = ct; bestHits = hits; }
  }

  const looksPersonal = EMAIL_RE.test(from || "") && (body || "").length > 20;
  const isLead = bestHits > 0 || looksPersonal;
  return {
    isLead,
    caseType: best || "general",
    reason: bestHits ? "case keywords" : (looksPersonal ? "personal inquiry" : "no signal"),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SCORING (SEAM 2 — rule-based now; Gemini later)
// Tuned to Mr. Johnson's actual practice patterns from inbox analysis
// ═══════════════════════════════════════════════════════════════════════════

function scoreLead({ caseType, body, subject, source, location, name }) {
  let score = 35; // base score
  const text = ((subject || "") + " " + (body || "")).toLowerCase();
  const loc = (location || "").toLowerCase();

  // ── Practice area match ──
  const highVolume = new Set(["family-law", "juvenile", "probate-estate", "criminal-defense"]);
  const mediumVolume = new Set(["personal-injury", "real-estate"]);

  if (highVolume.has(caseType)) score += 25;
  else if (mediumVolume.has(caseType)) score += 20;
  else if (caseType === "traffic") score += 15;
  else if (caseType !== "general") score += 10;

  // ── Geography ──
  const inCoreCounty = [...CORE_COUNTIES].some(c => loc.includes(c));
  const inCoreCity = [...CORE_CITIES].some(c => loc.includes(c));
  const inMetro = [...METRO_DETROIT].some(c => loc.includes(c));
  const inMichigan = loc.includes("mi") || loc.includes("michigan");
  const outOfState = loc && !inMichigan && !inCoreCounty && !inCoreCity;

  if (inCoreCounty || inCoreCity) score += 15;
  else if (inMetro) score += 10;
  else if (inMichigan) score += 5;
  else if (outOfState) score -= 30;

  // ── Source quality ──
  const srcKey = Object.keys(SOURCE_ADJUSTMENTS).find(k =>
    (source || "").toLowerCase().includes(k)
  );
  if (srcKey) score += SOURCE_ADJUSTMENTS[srcKey];

  // ── Urgency signals ──
  const urgencyPatterns = [
    /court date|hearing/i,
    /arrested|in jail|detained|locked up/i,
    /accident.{0,20}(yesterday|today|just happened)/i,
    /emergency|urgent|asap|immediately/i,
    /deadline.{0,20}(tomorrow|this week|friday|monday)/i,
  ];
  const urgencyHits = urgencyPatterns.filter(p => p.test(text)).length;
  score += urgencyHits * 10;

  // ── Engagement signals ──
  if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(text)) score += 10; // gave phone number
  if ((body || "").length > 200) score += 10; // detailed message
  if ((body || "").length > 500) score += 5;  // very detailed
  if (name && name.length > 3) score += 5;    // provided real name

  return Math.min(100, Math.max(0, score));
}

// ═══════════════════════════════════════════════════════════════════════════
// URGENCY CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════

function classifyUrgency(score, text) {
  if (score >= 75) return "high";
  if (/(arrested|jail|detained|emergency|court date.{0,15}(tomorrow|today))/i.test(text)) return "high";
  if (score >= 50) return "medium";
  return "low";
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATION
// ═══════════════════════════════════════════════════════════════════════════

async function alertOwner(evt) {
  try {
    await lambda.send(new InvokeCommand({
      FunctionName: NOTIFY_FN,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify(evt)),
    }));
  } catch (err) {
    console.error("alertOwner failed (non-fatal):", err);
  }
}

function buildLeadNotification(lead) {
  const urgency = lead.urgency;
  const scoreBar = "█".repeat(Math.floor(lead.score / 10)) + "░".repeat(10 - Math.floor(lead.score / 10));

  const headline = urgency === "high"
    ? `🔴 High-Priority Lead — ${lead.caseType.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}`
    : `New Lead — ${lead.caseType.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}`;

  const html = `
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #E5E7EB;">
          <strong style="color:#6B7280;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Score</strong><br>
          <span style="font-family:monospace;font-size:16px;">${scoreBar} ${lead.score}/100</span>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #E5E7EB;">
          <strong style="color:#6B7280;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Practice Area</strong><br>
          <span style="font-size:15px;">${lead.caseType.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
        </td>
      </tr>
      ${lead.location ? `<tr>
        <td style="padding:12px 0;border-bottom:1px solid #E5E7EB;">
          <strong style="color:#6B7280;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Location</strong><br>
          <span style="font-size:15px;">${lead.location}</span>
        </td>
      </tr>` : ""}
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #E5E7EB;">
          <strong style="color:#6B7280;font-size:12px;text-transform:uppercase;letter-spacing:1px;">From</strong><br>
          <span style="font-size:15px;">${lead.email}${lead.name ? ` (${lead.name})` : ""}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #E5E7EB;">
          <strong style="color:#6B7280;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Source</strong><br>
          <span style="font-size:15px;${lead.source === "lawyer.com" ? "color:#9CA3AF;" : ""}">${lead.source}${lead.source === "lawyer.com" ? " ⚠️ (low conversion)" : ""}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 0 0;">
          <strong style="color:#6B7280;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Message</strong><br>
          <div style="margin-top:8px;padding:12px 16px;background:#F9FAFB;border-left:3px solid #D4AF37;border-radius:0 4px 4px 0;font-size:14px;color:#374151;line-height:1.6;">
            ${(lead.firstMessage || "").slice(0, 500).replace(/\n/g, "<br>")}${(lead.firstMessage || "").length > 500 ? "<br><em style='color:#9CA3AF;'>...truncated</em>" : ""}
          </div>
        </td>
      </tr>
    </table>
    ${urgency === "high" ? `<p style="margin-top:20px;padding:12px 16px;background:#FEF2F2;border:1px solid #FECACA;border-radius:4px;color:#991B1B;font-size:13px;"><strong>⚡ Recommended:</strong> Contact within 1 hour. Urgency signals detected in message.</p>` : ""}
    ${lead.source === "lawyer.com" ? `<p style="margin-top:12px;color:#9CA3AF;font-size:12px;font-style:italic;">Note: Lawyer.com leads have historically low conversion for this practice.</p>` : ""}
  `;

  return { headline, html };
}

// ═══════════════════════════════════════════════════════════════════════════
// PROCESS LEAD
// ═══════════════════════════════════════════════════════════════════════════

async function processEmail(evt) {
  const from = String(evt.from || evt.email || "").trim().toLowerCase().slice(0, 200);
  const subject = String(evt.subject || "").slice(0, 300);
  const body = String(evt.body || evt.description || "").slice(0, 8000);
  const source = String(evt.source || "email").slice(0, 40);
  const location = String(evt.location || "").slice(0, 200);
  const name = String(evt.name || "").slice(0, 200);
  const phone = String(evt.phone || "").slice(0, 30);

  const cls = classifyEmail({ subject, body, from, source });
  if (!cls.isLead) {
    return { ok: true, isLead: false, reason: cls.reason };
  }

  const score = scoreLead({ caseType: cls.caseType, body, subject, source, location, name });
  const urgency = classifyUrgency(score, (subject + " " + body));
  const leadId = "LD-" + Date.now().toString(36).toUpperCase() + "-" + randomUUID().slice(0, 4).toUpperCase();
  const now = new Date().toISOString();

  const item = {
    leadId, stage: "new", email: from, name, phone, subject,
    caseType: cls.caseType, score, urgency, source, location,
    firstMessage: body,
    conversation: [{ role: "lead", text: body, at: now }],
    createdAt: now, updatedAt: now,
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));

  // ── Notification routing based on urgency ──
  const { headline, html } = buildLeadNotification(item);

  if (urgency === "high") {
    // SMS + HTML email
    await alertOwner({
      center: "leads", type: "new_lead", importance: "high",
      subject: `[LEAD-HIGH] ${cls.caseType.replace(/-/g, " ")} — ${location || from}`,
      headline,
      html,
      message: `High-priority ${cls.caseType} lead (score ${score}) from ${name || from}${location ? ` in ${location}` : ""}. ${subject || body.slice(0, 80)}`,
      meta: { leadId, caseType: cls.caseType, score, urgency },
    });
  } else if (urgency === "medium") {
    // Email only (digest-worthy)
    await alertOwner({
      center: "leads", type: "new_lead", importance: "normal",
      subject: `[LEAD] ${cls.caseType.replace(/-/g, " ")} — ${location || from}`,
      headline,
      html,
      message: `New ${cls.caseType} lead (score ${score}) from ${name || from}${location ? ` in ${location}` : ""}.`,
      meta: { leadId, caseType: cls.caseType, score, urgency },
    });
  } else {
    // Low priority — log only (no notification for Lawyer.com junk)
    if (source !== "lawyer.com") {
      await alertOwner({
        center: "leads", type: "new_lead", importance: "low",
        subject: `[LEAD-LOW] ${cls.caseType.replace(/-/g, " ")} — ${location || from}`,
        headline,
        html,
        message: `Low-priority ${cls.caseType} lead (score ${score}) from ${name || from}.`,
        meta: { leadId, caseType: cls.caseType, score, urgency },
      });
    }
    // Lawyer.com low-priority → silently logged, no notification
  }

  // SEAM 3: Here is where the AgentCore Router would be called to let
  // Jude's AI layer do deeper analysis. Not yet deployed.
  // await callRouter({ hookPath: "new-lead", leadId, caseType: cls.caseType, score, urgency });

  return { ok: true, isLead: true, leadId, caseType: cls.caseType, score, urgency };
}

// ═══════════════════════════════════════════════════════════════════════════
// API HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

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
    names["#c"] = "conversation"; values[":e"] = []; values[":n"] = [{ role: "staff", text: String(body.note).slice(0, 4000), at: new Date().toISOString() }];
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
  // Direct invoke (no HTTP wrapper) => treat as an inbound lead to process.
  if (!event.requestContext && (event.from || event.email || event.body_raw)) {
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
