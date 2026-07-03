// Jude — Owner Communication Backbone
// Runtime: Node.js 20.x (ESM). SDK v3 clients are in the Lambda runtime.
//
// This is the single module every "center" calls to reach the business owner.
//   - Records the event to DynamoDB (jude-events) as the running log.
//   - Triages importance (rule-based now; an AI model plugs in here later).
//   - EMAIL (SES): sent for all notifications (the digest/log channel).
//   - SMS  (SNS): sent ONLY for important/actionable items.
//
// No Bedrock yet — triage is deterministic rules. The `decideImportance`
// function is the single seam where Jude's LLM (Amazon Nova) will slot in.
//
// Invoke payload (from any center):
//   {
//     "center":   "leads" | "emails" | "newsletter" | "ads" | "phone" | "scheduling",
//     "type":     "new_lead" | "missed_call" | ...,
//     "message":  "human-readable description",
//     "importance": "auto" | "high" | "normal" | "low",   // optional; "auto" = let triage decide
//     "meta":     { ... optional structured data ... }
//   }

import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const TABLE = process.env.EVENTS_TABLE || "jude-events";
// Owner contact — set these once known (kept as env placeholders for now).
const OWNER_PHONE = process.env.OWNER_PHONE || "";          // e.g. +13135551234
const OWNER_EMAIL = process.env.OWNER_EMAIL || "";          // e.g. lawyer@firm.com
const FROM_EMAIL  = process.env.FROM_EMAIL  || "";          // SES-verified sender

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sns = new SNSClient({});
const ses = new SESClient({});

// Centers/types that are important enough to SMS the owner by default.
const HIGH_TYPES = new Set([
  "new_lead", "qualified_lead", "missed_call", "voicemail",
  "urgent_email", "payment_received", "appointment_booked",
  "ad_rejected", "budget_exhausted",
]);

// ── The triage seam. Rule-based today; swap for an Amazon Nova call later. ──
function decideImportance(evt) {
  const explicit = (evt.importance || "auto").toLowerCase();
  if (explicit !== "auto") return explicit; // caller forced it
  if (HIGH_TYPES.has(evt.type)) return "high";
  // Leads are the flagship — lean toward notifying on lead activity.
  if (evt.center === "leads") return "high";
  return "normal";
}

async function sendSms(text) {
  if (!OWNER_PHONE) { console.warn("OWNER_PHONE not set; SMS skipped."); return "skipped"; }
  await sns.send(new PublishCommand({
    PhoneNumber: OWNER_PHONE,
    Message: text.slice(0, 600),
    MessageAttributes: {
      "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" },
    },
  }));
  return "sent";
}

async function sendEmail(subject, body) {
  if (!OWNER_EMAIL || !FROM_EMAIL) { console.warn("OWNER_EMAIL/FROM_EMAIL not set; email skipped."); return "skipped"; }
  await ses.send(new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: { ToAddresses: [OWNER_EMAIL] },
    Message: {
      Subject: { Data: subject.slice(0, 200) },
      Body: { Text: { Data: body } },
    },
  }));
  return "sent";
}

export const handler = async (event) => {
  // Accept either a direct invoke payload or an API Gateway body.
  let evt = event;
  if (typeof event.body === "string") {
    try { evt = JSON.parse(event.body); } catch { evt = {}; }
  }

  const center = String(evt.center || "system").slice(0, 40);
  const type = String(evt.type || "note").slice(0, 60);
  const message = String(evt.message || "").slice(0, 4000);
  if (!message) {
    return { ok: false, error: "message is required" };
  }

  const importance = decideImportance({ ...evt, center, type });
  const eventId = "JE-" + Date.now().toString(36).toUpperCase() + "-" + randomUUID().slice(0, 4).toUpperCase();
  const createdAt = new Date().toISOString();

  // 1. Record the happening (the log Jude keeps).
  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        eventId, center, type, message, importance, createdAt,
        meta: evt.meta || {},
        channels: { sms: false, email: false },
      },
    }));
  } catch (err) {
    console.error("DynamoDB put failed:", err);
    // Continue — still try to notify.
  }

  // 2. Notify. Email always (the digest channel); SMS only if important.
  const subject = `[Jude:${center}] ${type}` + (importance === "high" ? " (!)" : "");
  const emailBody =
    `${message}\n\n` +
    `— Jude\nCenter: ${center}\nType: ${type}\nImportance: ${importance}\n` +
    `Event: ${eventId}\nTime: ${createdAt}\n`;

  const results = {};
  try { results.email = await sendEmail(subject, emailBody); }
  catch (e) { console.error("SES send failed:", e); results.email = "error"; }

  if (importance === "high" || importance === "urgent") {
    try { results.sms = await sendSms(`${message} [${center}/${type}]`); }
    catch (e) { console.error("SNS SMS failed:", e); results.sms = "error"; }
  } else {
    results.sms = "not_important";
  }

  return { ok: true, eventId, importance, delivered: results };
};
