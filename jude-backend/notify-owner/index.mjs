// Jude — Owner Communication Backbone
// Runtime: Node.js 20.x (ESM). SDK v3 clients are in the Lambda runtime.
//
// This is the single module every "center" calls to reach the business owner.
//   - Records the event to DynamoDB (jude-events) as the running log.
//   - Triages importance (rule-based now; an AI model plugs in here later).
//   - EMAIL (SES): sent for all notifications (the digest/log channel).
//   - SMS  (SNS): sent ONLY for important/actionable items.
//   - TECH ROUTING: system/tech errors go to MR TECH, not the owner.
//
// Invoke payload (from any center):
//   {
//     "center":   "leads" | "emails" | "newsletter" | "ads" | "phone" | "scheduling" | "system",
//     "type":     "new_lead" | "missed_call" | "tech_error" | "tech_intro" | ...,
//     "message":  "human-readable description",
//     "importance": "auto" | "high" | "normal" | "low",
//     "meta":     { ... optional structured data ... },
//     "html":     "optional HTML body (overrides template)"
//   }

import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const TABLE = process.env.EVENTS_TABLE || "jude-events";
const OWNER_PHONE = process.env.OWNER_PHONE || "";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "";
const FROM_EMAIL  = process.env.FROM_EMAIL  || "";
const TECH_EMAIL  = process.env.TECH_EMAIL  || "";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sns = new SNSClient({});
const ses = new SESClient({});

// Centers/types that are important enough to SMS the owner by default.
const HIGH_TYPES = new Set([
  "new_lead", "qualified_lead", "missed_call", "voicemail",
  "urgent_email", "payment_received", "appointment_booked",
  "ad_rejected", "budget_exhausted",
]);

// Types that route to MR TECH instead of the owner
const TECH_TYPES = new Set([
  "tech_error", "tech_intro", "tech_alert", "system_health",
  "deploy_status", "api_error", "auth_error",
]);

// ── The triage seam ──
function decideImportance(evt) {
  const explicit = (evt.importance || "auto").toLowerCase();
  if (explicit !== "auto") return explicit;
  if (HIGH_TYPES.has(evt.type)) return "high";
  if (evt.center === "leads") return "high";
  return "normal";
}

// ── Determine recipient ──
function getRecipient(evt) {
  if (evt.meta?.recipient_override) return evt.meta.recipient_override;
  if (evt.center === "system" || TECH_TYPES.has(evt.type)) return TECH_EMAIL || OWNER_EMAIL;
  return OWNER_EMAIL;
}

// ── HTML Email Template ──
function buildHtmlEmail({ subject, headline, body, footer, importance, center, type, eventId, timestamp }) {
  const accentColor = importance === "high" ? "#C41E3A" : "#1B365D";
  const importanceBadge = importance === "high"
    ? '<span style="background:#C41E3A;color:#fff;padding:3px 10px;border-radius:3px;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Urgent</span>'
    : importance === "low"
    ? '<span style="background:#6B7280;color:#fff;padding:3px 10px;border-radius:3px;font-size:11px;text-transform:uppercase;letter-spacing:1px;">FYI</span>'
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:'Georgia','Times New Roman',serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:30px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:4px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

  <!-- Header -->
  <tr><td style="background:${accentColor};padding:28px 40px;">
    <table role="presentation" width="100%"><tr>
      <td style="color:#D4AF37;font-size:22px;font-weight:bold;font-family:'Georgia',serif;letter-spacing:0.5px;">
        ⚖️ JUDE
      </td>
      <td align="right" style="color:rgba(255,255,255,0.7);font-size:11px;font-family:Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;">
        Johnson Legal Team
      </td>
    </tr></table>
  </td></tr>

  <!-- Gold accent line -->
  <tr><td style="background:#D4AF37;height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>

  <!-- Body -->
  <tr><td style="padding:36px 40px 28px;">
    ${importanceBadge ? `<div style="margin-bottom:16px;">${importanceBadge}</div>` : ''}
    <h1 style="margin:0 0 20px;font-size:20px;color:#1B365D;font-family:'Georgia',serif;font-weight:normal;line-height:1.3;">
      ${headline || subject}
    </h1>
    <div style="font-size:15px;color:#374151;line-height:1.7;font-family:'Georgia',serif;">
      ${body}
    </div>
  </td></tr>

  <!-- Divider -->
  <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #E5E7EB;margin:0;"></td></tr>

  <!-- Footer -->
  <tr><td style="padding:20px 40px 28px;">
    <table role="presentation" width="100%"><tr>
      <td style="font-size:11px;color:#9CA3AF;font-family:Arial,sans-serif;line-height:1.5;">
        ${footer || `Center: ${center} · Type: ${type} · ${eventId}`}<br>
        ${timestamp}
      </td>
      <td align="right" style="font-size:11px;color:#9CA3AF;font-family:Arial,sans-serif;">
        Powered by Jude AI
      </td>
    </tr></table>
  </td></tr>

  <!-- Bottom bar -->
  <tr><td style="background:#1B365D;padding:16px 40px;">
    <table role="presentation" width="100%"><tr>
      <td style="color:rgba(255,255,255,0.6);font-size:10px;font-family:Arial,sans-serif;">
        Johnson Legal Team, PLLC · (313) 355-2216
      </td>
      <td align="right" style="color:rgba(255,255,255,0.4);font-size:10px;font-family:Arial,sans-serif;">
        Automated · Do not reply
      </td>
    </tr></table>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
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

async function sendEmail(recipient, subject, textBody, htmlBody) {
  if (!recipient || !FROM_EMAIL) { console.warn("Recipient/FROM_EMAIL not set; email skipped."); return "skipped"; }
  const params = {
    Source: `"Jude | Johnson Legal Team" <${FROM_EMAIL}>`,
    Destination: { ToAddresses: [recipient] },
    Message: {
      Subject: { Data: subject.slice(0, 200) },
      Body: {
        Text: { Data: textBody },
        Html: { Data: htmlBody },
      },
    },
  };
  await ses.send(new SendEmailCommand(params));
  return "sent";
}

export const handler = async (event) => {
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
  const recipient = getRecipient({ ...evt, center, type });
  const eventId = "JE-" + Date.now().toString(36).toUpperCase() + "-" + randomUUID().slice(0, 4).toUpperCase();
  const createdAt = new Date().toISOString();

  // 1. Record to DynamoDB
  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        eventId, center, type, message, importance, createdAt,
        recipient,
        meta: evt.meta || {},
        channels: { sms: false, email: false },
      },
    }));
  } catch (err) {
    console.error("DynamoDB put failed:", err);
  }

  // 2. Build email
  const subject = evt.subject || `[Jude:${center}] ${type}` + (importance === "high" ? " (!)" : "");
  const textBody =
    `${message}\n\n` +
    `— Jude\nCenter: ${center}\nType: ${type}\nImportance: ${importance}\n` +
    `Event: ${eventId}\nTime: ${createdAt}\n`;

  // Convert message newlines to <br> for HTML
  const htmlMessage = evt.html || message.replace(/\n/g, "<br>");
  const htmlBody = buildHtmlEmail({
    subject,
    headline: evt.headline || subject,
    body: htmlMessage,
    footer: evt.footer || null,
    importance,
    center,
    type,
    eventId,
    timestamp: createdAt,
  });

  // 3. Send
  const results = {};
  try { results.email = await sendEmail(recipient, subject, textBody, htmlBody); }
  catch (e) { console.error("SES send failed:", e); results.email = "error"; }

  if ((importance === "high" || importance === "urgent") && !TECH_TYPES.has(type)) {
    try { results.sms = await sendSms(`${message} [${center}/${type}]`); }
    catch (e) { console.error("SNS SMS failed:", e); results.sms = "error"; }
  } else {
    results.sms = "not_important";
  }

  return { ok: true, eventId, importance, recipient, delivered: results };
};
