'use strict';
// Jude Inbox Monitor — Runs every 3 hours via EventBridge Scheduler.
// Checks johnsonlegalteam@gmail.com for new/unread emails, triages them,
// and sends notifications to the owner based on priority tier.

const TABLE = process.env.TABLE_NAME || 'johnson-legal-portal-PortalTable-BSDJNMA75SSQ';
const OWNER_PHONE = process.env.OWNER_PHONE || '+13134040939';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'johnsonlegalteam@gmail.com';
const TECH_EMAIL = process.env.TECH_EMAIL || 'mrtechfixes.ai@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'johnsonlegalteam@gmail.com';

// --- Tier classification rules ---

const TIER1_SENDERS = [
  '36thdistrictcourtmi.gov',
  '3rdcc.org',
  'waynecountymi.gov',
  'michigan.gov',
  'detroitmi.gov',
];

const TIER1_SUBJECTS = [
  'deadline', 'hearing', 'emergency', 'arraignment', 'docket',
  'scheduling order', 'motion', 'court date', 'discovery due',
];

const TIER2_SENDERS = [
  'butzel.com', 'urbanimarshall.com', 'truefiling.com',
  'watchguardvideo.com', 'courts.michigan.gov',
];

const TIER3_IGNORE = [
  'lawyer.com', 'linkedin.com', 'google.com/alerts',
  'paypal.com', 'cash.app', 'square.com', 'hilton.com',
  'marriott.com', 'noreply@', 'no-reply@',
];

// --- Main handler ---

exports.handler = async (event) => {
  console.log('Jude inbox monitor triggered:', new Date().toISOString());

  try {
    const accessToken = await getGoogleAccessToken();
    const messages = await fetchRecentUnread(accessToken);

    console.log(`Found ${messages.length} unread messages`);

    if (!messages.length) {
      console.log('No unread messages. Done.');
      return { statusCode: 200, body: 'No new messages' };
    }

    // Classify each message
    const tier1 = [];
    const tier2 = [];
    const tier3 = [];

    for (const msg of messages) {
      const detail = await getMessageDetail(accessToken, msg.id);
      if (!detail) continue;

      const classified = classifyMessage(detail);
      if (classified.tier === 1) tier1.push(classified);
      else if (classified.tier === 2) tier2.push(classified);
      else tier3.push(classified);
    }

    console.log(`Classified: Tier1=${tier1.length}, Tier2=${tier2.length}, Tier3=${tier3.length}`);

    // Handle Tier 1 — SMS for urgent
    for (const msg of tier1.slice(0, 3)) { // Max 3 SMS per run
      await sendSmsNotification(msg);
    }

    // Handle Tier 1 + Tier 2 — Email digest
    if (tier1.length || tier2.length) {
      await sendEmailDigest(tier1, tier2, tier3.length);
    }

    // Log all to DynamoDB for audit
    await logInboxRun(tier1, tier2, tier3);

    return { statusCode: 200, body: `Processed ${messages.length} messages` };
  } catch (err) {
    console.error('Inbox monitor error:', err);
    // Notify MR TECH of failure
    await sendTechAlert(err.message);
    return { statusCode: 500, body: err.message };
  }
};

// --- Gmail API functions ---

async function getGoogleAccessToken() {
  const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
  const sm = new SecretsManagerClient({});

  const [tokenRes, clientRes] = await Promise.all([
    sm.send(new GetSecretValueCommand({ SecretId: 'johnson-legal/gmail-refresh-token' })),
    sm.send(new GetSecretValueCommand({ SecretId: 'johnson-legal/google-oauth-client-secret' })),
  ]);

  const { refresh_token } = JSON.parse(tokenRes.SecretString);
  const { web } = JSON.parse(clientRes.SecretString);

  const params = new URLSearchParams({
    client_id: web.client_id,
    client_secret: web.client_secret,
    refresh_token,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Google token refresh failed');
  return data.access_token;
}

async function fetchRecentUnread(token) {
  // Get unread messages from the last 3 hours
  const threeHoursAgo = Math.floor((Date.now() - 3 * 60 * 60 * 1000) / 1000);
  const query = `is:unread after:${threeHoursAgo}`;

  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=25`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.messages || [];
}

async function getMessageDetail(token, messageId) {
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();

  const headers = data.payload?.headers || [];
  const getHeader = (name) => (headers.find(h => h.name.toLowerCase() === name.toLowerCase()) || {}).value || '';

  return {
    id: messageId,
    from: getHeader('From'),
    subject: getHeader('Subject'),
    date: getHeader('Date'),
    snippet: data.snippet || '',
    labelIds: data.labelIds || [],
  };
}

// --- Classification ---

function classifyMessage(msg) {
  const from = (msg.from || '').toLowerCase();
  const subject = (msg.subject || '').toLowerCase();
  const snippet = (msg.snippet || '').toLowerCase();

  // Check Tier 3 first (ignore)
  for (const pattern of TIER3_IGNORE) {
    if (from.includes(pattern)) {
      return { ...msg, tier: 3, reason: `Ignored sender: ${pattern}` };
    }
  }

  // Check Tier 1 (urgent)
  for (const domain of TIER1_SENDERS) {
    if (from.includes(domain)) {
      return { ...msg, tier: 1, reason: `Urgent sender: ${domain}` };
    }
  }
  for (const keyword of TIER1_SUBJECTS) {
    if (subject.includes(keyword) || snippet.includes(keyword)) {
      return { ...msg, tier: 1, reason: `Urgent keyword: ${keyword}` };
    }
  }

  // Check Tier 2 (important)
  for (const domain of TIER2_SENDERS) {
    if (from.includes(domain)) {
      return { ...msg, tier: 2, reason: `Important sender: ${domain}` };
    }
  }
  // Case number pattern (##-######-XX)
  if (/\d{2}-\d{4,6}-[A-Z]{2}/.test(msg.subject)) {
    return { ...msg, tier: 2, reason: 'Contains case number' };
  }

  // Default: Tier 2 for unclassified (better to notify than miss)
  return { ...msg, tier: 2, reason: 'Unclassified — defaulting to important' };
}

// --- Notifications ---

async function sendSmsNotification(msg) {
  const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
  const sns = new SNSClient({});

  const fromName = msg.from.split('<')[0].trim() || msg.from;
  const text = `[INBOX] ${fromName}\n${(msg.subject || '(no subject)').slice(0, 100)}`;

  try {
    await sns.send(new PublishCommand({
      PhoneNumber: OWNER_PHONE,
      Message: `Johnson Legal: ${text}`,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
      },
    }));
    console.log('SMS sent for:', msg.subject);
  } catch (e) {
    console.error('SMS failed:', e.message);
  }
}

async function sendEmailDigest(tier1, tier2, tier3Count) {
  const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
  const sesClient = new SESv2Client({});

  let body = `JUDE INBOX MONITOR — ${new Date().toLocaleString('en-US', { timeZone: 'America/Detroit' })}\n${'━'.repeat(50)}\n\n`;

  if (tier1.length) {
    body += `⚠️  URGENT (${tier1.length}):\n`;
    tier1.forEach((m, i) => {
      const from = m.from.split('<')[0].trim();
      body += `${i + 1}. [${from}] ${m.subject}\n   Reason: ${m.reason}\n`;
    });
    body += '\n';
  }

  if (tier2.length) {
    body += `📋 IMPORTANT (${tier2.length}):\n`;
    tier2.forEach((m, i) => {
      const from = m.from.split('<')[0].trim();
      body += `${i + 1}. [${from}] ${m.subject}\n`;
    });
    body += '\n';
  }

  body += `📁 Low priority (logged, not shown): ${tier3Count}\n\n`;
  body += `— Jude Inbox Monitor\n   Next check in 3 hours.`;

  try {
    await sesClient.send(new SendEmailCommand({
      FromEmailAddress: `Jude — Johnson Legal <${FROM_EMAIL}>`,
      Destination: { ToAddresses: [OWNER_EMAIL] },
      Content: {
        Simple: {
          Subject: { Data: `Jude Inbox Brief — ${tier1.length} urgent, ${tier2.length} important`, Charset: 'UTF-8' },
          Body: { Text: { Data: body, Charset: 'UTF-8' } },
        },
      },
    }));
    console.log('Email digest sent');
  } catch (e) {
    console.error('Email digest failed:', e.message);
  }
}

async function sendTechAlert(errorMsg) {
  try {
    const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
    const sesClient = new SESv2Client({});
    await sesClient.send(new SendEmailCommand({
      FromEmailAddress: FROM_EMAIL,
      Destination: { ToAddresses: [TECH_EMAIL] },
      Content: {
        Simple: {
          Subject: { Data: `[JUDE-HIGH] inbox-monitor: ${errorMsg.slice(0, 60)}`, Charset: 'UTF-8' },
          Body: { Text: { Data: `Jude inbox monitor failed at ${new Date().toISOString()}\n\nError: ${errorMsg}\n\nThis means inbox monitoring is paused until the next successful run.`, Charset: 'UTF-8' } },
        },
      },
    }));
  } catch (_) { console.error('Tech alert also failed'); }
}

// --- DynamoDB logging ---

async function logInboxRun(tier1, tier2, tier3) {
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const id = Date.now().toString();
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: 'JUDE', SK: `INBOX_RUN#${id}`,
      timestamp: new Date().toISOString(),
      tier1_count: tier1.length,
      tier2_count: tier2.length,
      tier3_count: tier3.length,
      tier1_subjects: tier1.map(m => m.subject).slice(0, 5),
      tier2_subjects: tier2.map(m => m.subject).slice(0, 10),
      total_processed: tier1.length + tier2.length + tier3.length,
    },
  }));
}
