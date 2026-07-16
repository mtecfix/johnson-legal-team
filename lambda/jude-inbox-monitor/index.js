'use strict';
// Jude Inbox Monitor v2 — Runs every 3 hours via EventBridge
// 1. Scans for potential leads & unresolved business threads
// 2. Security scan for intrusion/phishing attempts
// 3. Sends security summary to MR TECH for approval before quarantine
// NO digest emails sent — only security alerts when threats detected

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const TABLE_NAME = process.env.TABLE_NAME || 'jude-events';
const LEADS_TABLE = process.env.LEADS_TABLE || 'jude-leads';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'johnsonlegalteam@gmail.com';
const TECH_EMAIL = process.env.TECH_EMAIL || 'mrtechfixes.ai@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'johnsonlegalteam@gmail.com';

// --- Security Threat Indicators ---
const PHISHING_INDICATORS = [
  // Urgency manipulation
  'verify your account immediately',
  'your account will be suspended',
  'click here to confirm your identity',
  'unauthorized login attempt',
  'security alert: action required',
  // Credential harvesting
  'reset your password now',
  'confirm your billing information',
  'update your payment method',
  'your invoice is attached',
  // Impersonation patterns
  'from the desk of',
  'wire transfer',
  'urgent wire',
  'western union',
  'gift card',
  'bitcoin payment',
  'cryptocurrency',
  // Malware delivery
  '.exe', '.scr', '.bat', '.cmd', '.vbs', '.js.zip',
  'enable macros', 'enable content',
  // BEC (Business Email Compromise)
  'change of bank details',
  'new payment instructions',
  'updated routing number',
  'please pay this invoice',
];

const SUSPICIOUS_SENDER_PATTERNS = [
  // Typosquatting of known domains
  /36thdistrictcourt[^m]/i,
  /michigan\.gov\.(com|net|org)/i,
  /waynecounty[^m]/i,
  // Common phishing TLDs
  /\.(xyz|top|click|loan|work|date|racing|download|stream)$/i,
  // Random string senders
  /[a-z0-9]{15,}@/i,
  // Recently registered / disposable
  /(@temp|@disposable|@throwaway|@guerrilla)/i,
];

const HEADER_RED_FLAGS = [
  // SPF/DKIM failures indicated in headers
  'spf=fail',
  'dkim=fail',
  'dmarc=fail',
  // Reply-to mismatch indicators
  'reply-to',
];

// --- Lead Detection Patterns ---
const LEAD_INDICATORS = {
  'personal-injury': ['accident', 'injury', 'hurt', 'car crash', 'slip and fall', 'medical malpractice', 'wrongful death', 'disability'],
  'probate-estate': ['will', 'estate', 'probate', 'trust', 'inheritance', 'executor', 'beneficiary', 'power of attorney'],
  'expungement': ['expungement', 'set aside', 'record', 'conviction', 'felony', 'misdemeanor', 'clean record'],
  'traffic': ['ticket', 'traffic', 'speeding', 'dui', 'dwi', 'license suspended', 'points'],
  'general': ['attorney', 'lawyer', 'legal help', 'consultation', 'representation', 'need a lawyer'],
};

const BUSINESS_THREAD_INDICATORS = [
  'follow up', 'following up', 'checking in', 'status update',
  'response needed', 'awaiting your reply', 'per our conversation',
  'as discussed', 'regarding our meeting', 'action item',
  'contract', 'agreement', 'proposal', 'quote', 'estimate',
  'scheduling', 'appointment', 'calendar',
];

// --- Main Handler ---
exports.handler = async (event) => {
  console.log('Jude inbox monitor v2 triggered:', new Date().toISOString());

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const ses = new SESv2Client({});

  try {
    const accessToken = await getGoogleAccessToken();
    const messages = await fetchRecentUnread(accessToken);

    console.log(`Found ${messages.length} unread messages`);

    if (!messages.length) {
      console.log('No unread messages. Done.');
      return { statusCode: 200, body: 'No new messages' };
    }

    const leads = [];
    const businessThreads = [];
    const securityThreats = [];
    const clean = [];

    for (const msg of messages) {
      const detail = await getMessageDetail(accessToken, msg.id);
      if (!detail) continue;

      // Security scan FIRST
      const threatAnalysis = analyzeSecurityThreats(detail);
      if (threatAnalysis.isThreat) {
        securityThreats.push({ ...detail, threat: threatAnalysis });
        continue;
      }

      // Lead detection
      const leadAnalysis = detectLead(detail);
      if (leadAnalysis.isLead) {
        leads.push({ ...detail, lead: leadAnalysis });
        continue;
      }

      // Business thread detection
      const isBusinessThread = detectBusinessThread(detail);
      if (isBusinessThread.isThread) {
        businessThreads.push({ ...detail, thread: isBusinessThread });
        continue;
      }

      clean.push(detail);
    }

    console.log(`Results: Leads=${leads.length}, Threads=${businessThreads.length}, Threats=${securityThreats.length}, Clean=${clean.length}`);

    // Store leads in DynamoDB
    for (const lead of leads) {
      await storeLead(ddb, lead);
    }

    // Store business threads
    for (const thread of businessThreads) {
      await storeBusinessThread(ddb, thread);
    }

    // SECURITY: Send threat summary to MR TECH for approval
    if (securityThreats.length > 0) {
      await sendSecurityAlert(ses, securityThreats);
    }

    // Log the run
    await logRun(ddb, { leads, businessThreads, securityThreats, clean });

    return {
      statusCode: 200,
      body: JSON.stringify({
        processed: messages.length,
        leads: leads.length,
        threads: businessThreads.length,
        threats: securityThreats.length,
        clean: clean.length,
      }),
    };
  } catch (err) {
    console.error('Inbox monitor error:', err);
    await sendTechError(ses, err.message);
    return { statusCode: 500, body: err.message };
  }
};

// --- Security Analysis ---
function analyzeSecurityThreats(msg) {
  const from = (msg.from || '').toLowerCase();
  const subject = (msg.subject || '').toLowerCase();
  const snippet = (msg.snippet || '').toLowerCase();
  const fullText = `${from} ${subject} ${snippet}`;
  const threats = [];
  let riskScore = 0;

  // Check phishing content indicators
  for (const indicator of PHISHING_INDICATORS) {
    if (fullText.includes(indicator.toLowerCase())) {
      threats.push(`Phishing indicator: "${indicator}"`);
      riskScore += 25;
    }
  }

  // Check suspicious sender patterns
  for (const pattern of SUSPICIOUS_SENDER_PATTERNS) {
    if (pattern.test(from)) {
      threats.push(`Suspicious sender pattern: ${pattern.toString()}`);
      riskScore += 35;
    }
  }

  // Check for header red flags
  const authResults = (msg.authResults || '').toLowerCase();
  for (const flag of HEADER_RED_FLAGS) {
    if (authResults.includes(flag) && flag !== 'reply-to') {
      threats.push(`Auth failure: ${flag}`);
      riskScore += 40;
    }
  }

  // Check reply-to mismatch
  if (msg.replyTo && msg.from) {
    const fromDomain = extractDomain(msg.from);
    const replyDomain = extractDomain(msg.replyTo);
    if (fromDomain && replyDomain && fromDomain !== replyDomain) {
      threats.push(`Reply-To domain mismatch: from=${fromDomain}, reply-to=${replyDomain}`);
      riskScore += 30;
    }
  }

  // Check for suspicious attachments mentioned in snippet
  const dangerousExtensions = ['.exe', '.scr', '.bat', '.cmd', '.vbs', '.ps1', '.msi', '.jar'];
  for (const ext of dangerousExtensions) {
    if (fullText.includes(ext)) {
      threats.push(`Dangerous attachment type: ${ext}`);
      riskScore += 50;
    }
  }

  // Spoofing detection: sender name contains known org but email doesn't match
  const knownOrgs = ['36th district', 'wayne county', 'michigan.gov', '3rd circuit', 'truefiling'];
  for (const org of knownOrgs) {
    if (subject.includes(org) || from.split('<')[0].toLowerCase().includes(org)) {
      const emailPart = from.match(/<(.+)>/)?.[1] || from;
      if (!emailPart.includes(org.replace(/\s/g, '').replace('.gov', ''))) {
        threats.push(`Possible spoofing: claims to be "${org}" but email doesn't match`);
        riskScore += 45;
      }
    }
  }

  // URL analysis in snippet
  const suspiciousUrlPatterns = [
    /bit\.ly/i, /tinyurl/i, /t\.co(?!urt)/i, /goo\.gl/i,
    /click\.\w+\.\w+/i, /track\.\w+/i,
  ];
  for (const pattern of suspiciousUrlPatterns) {
    if (pattern.test(fullText)) {
      threats.push(`Shortened/tracking URL detected: ${pattern.toString()}`);
      riskScore += 15;
    }
  }

  return {
    isThreat: riskScore >= 25,
    riskScore: Math.min(riskScore, 100),
    severity: riskScore >= 75 ? 'CRITICAL' : riskScore >= 50 ? 'HIGH' : riskScore >= 25 ? 'MEDIUM' : 'LOW',
    threats,
  };
}

// --- Lead Detection ---
function detectLead(msg) {
  const from = (msg.from || '').toLowerCase();
  const subject = (msg.subject || '').toLowerCase();
  const snippet = (msg.snippet || '').toLowerCase();
  const fullText = `${subject} ${snippet}`;

  // Skip known non-lead senders
  const noLeadSenders = ['noreply@', 'no-reply@', 'newsletter@', 'marketing@', 'notifications@'];
  for (const s of noLeadSenders) {
    if (from.includes(s)) return { isLead: false };
  }

  let bestMatch = null;
  let bestScore = 0;

  for (const [caseType, keywords] of Object.entries(LEAD_INDICATORS)) {
    let score = 0;
    const matched = [];
    for (const kw of keywords) {
      if (fullText.includes(kw)) {
        score += 20;
        matched.push(kw);
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { caseType, score, matched };
    }
  }

  // Referral sources get bonus
  const referralSources = ['lawyer.com', 'avvo.com', 'findlaw.com', 'justia.com', 'martindale.com'];
  for (const src of referralSources) {
    if (from.includes(src)) {
      bestScore += 30;
      if (!bestMatch) bestMatch = { caseType: 'general', score: bestScore, matched: [`referral:${src}`] };
      else bestMatch.matched.push(`referral:${src}`);
    }
  }

  if (bestScore >= 20 && bestMatch) {
    return { isLead: true, ...bestMatch, score: Math.min(bestScore, 100) };
  }

  return { isLead: false };
}

// --- Business Thread Detection ---
function detectBusinessThread(msg) {
  const subject = (msg.subject || '').toLowerCase();
  const snippet = (msg.snippet || '').toLowerCase();
  const fullText = `${subject} ${snippet}`;

  const matched = [];
  for (const indicator of BUSINESS_THREAD_INDICATORS) {
    if (fullText.includes(indicator)) {
      matched.push(indicator);
    }
  }

  // Re: or Fwd: chains indicate ongoing threads
  if (/^(re|fwd|fw):/i.test(msg.subject || '')) {
    matched.push('reply-chain');
  }

  return {
    isThread: matched.length >= 1,
    indicators: matched,
    urgency: matched.length >= 3 ? 'high' : matched.length >= 2 ? 'medium' : 'low',
  };
}

// --- Storage ---
async function storeLead(ddb, lead) {
  const id = `LD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
  await ddb.send(new PutCommand({
    TableName: LEADS_TABLE,
    Item: {
      leadId: id,
      source: 'inbox-monitor',
      from: lead.from,
      subject: lead.subject,
      snippet: lead.snippet,
      caseType: lead.lead.caseType,
      score: lead.lead.score,
      matchedKeywords: lead.lead.matched,
      status: 'new',
      createdAt: new Date().toISOString(),
      gmailMessageId: lead.id,
    },
  }));
  console.log(`Stored lead: ${id} (${lead.lead.caseType}, score ${lead.lead.score})`);
}

async function storeBusinessThread(ddb, thread) {
  const id = `BT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      eventId: id,
      type: 'business_thread',
      center: 'inbox',
      from: thread.from,
      subject: thread.subject,
      snippet: thread.snippet,
      urgency: thread.thread.urgency,
      indicators: thread.thread.indicators,
      status: 'unresolved',
      createdAt: new Date().toISOString(),
      recipient: OWNER_EMAIL,
      importance: thread.thread.urgency === 'high' ? 'high' : 'normal',
      channels: { sms: false, email: false },
      message: `Unresolved thread: ${thread.subject}`,
      meta: { gmailMessageId: thread.id },
    },
  }));
  console.log(`Stored business thread: ${id} (urgency: ${thread.thread.urgency})`);
}

// --- Security Alert to MR TECH (approval required before action) ---
async function sendSecurityAlert(ses, threats) {
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Detroit' });

  let html = `<html><body style="font-family: monospace; padding: 20px; background: #1a1a1a; color: #e0e0e0;">`;
  html += `<div style="background: #b71c1c; padding: 15px; border-radius: 6px; margin-bottom: 20px;">`;
  html += `<h2 style="color: #fff; margin: 0;">🛡️ JUDE SECURITY SCAN — Threats Detected</h2>`;
  html += `<p style="color: #ffcdd2; margin: 5px 0 0;">Scan time: ${now} | ${threats.length} suspicious email(s) flagged</p></div>`;

  html += `<p style="color: #ffd54f; font-weight: bold;">⚠️ ACTION REQUIRED: Reply APPROVE to quarantine/delete, or IGNORE to leave as-is.</p>`;

  threats.forEach((t, i) => {
    const severity = t.threat.severity;
    const severityColor = severity === 'CRITICAL' ? '#f44336' : severity === 'HIGH' ? '#ff9800' : '#ffc107';

    html += `<div style="border: 1px solid #333; padding: 15px; margin: 10px 0; border-radius: 4px; border-left: 4px solid ${severityColor};">`;
    html += `<h3 style="color: ${severityColor}; margin: 0 0 8px;">[${i + 1}] ${severity} — Risk Score: ${t.threat.riskScore}/100</h3>`;
    html += `<p style="margin: 4px 0;"><strong>From:</strong> ${escapeHtml(t.from)}</p>`;
    html += `<p style="margin: 4px 0;"><strong>Subject:</strong> ${escapeHtml(t.subject)}</p>`;
    html += `<p style="margin: 4px 0;"><strong>Snippet:</strong> ${escapeHtml((t.snippet || '').slice(0, 150))}...</p>`;
    html += `<p style="margin: 8px 0 0; color: #ef9a9a;"><strong>Threats:</strong></p><ul style="margin: 4px 0;">`;
    t.threat.threats.forEach(threat => {
      html += `<li style="color: #ef9a9a;">${escapeHtml(threat)}</li>`;
    });
    html += `</ul></div>`;
  });

  html += `<div style="margin-top: 20px; padding: 15px; background: #263238; border-radius: 6px;">`;
  html += `<p style="color: #80cbc4; margin: 0;"><strong>No emails have been deleted or moved.</strong> Jude is awaiting your authorization.</p>`;
  html += `<p style="color: #90a4ae; margin: 5px 0 0;">Reply to this email with:<br/>`;
  html += `• <strong>APPROVE ALL</strong> — quarantine all flagged emails<br/>`;
  html += `• <strong>APPROVE [1,3]</strong> — quarantine specific items by number<br/>`;
  html += `• <strong>IGNORE</strong> — take no action</p></div>`;

  html += `<p style="color: #616161; margin-top: 20px; font-size: 12px;">— Jude Security Module | Next scan in 3 hours</p>`;
  html += `</body></html>`;

  const textBody = threats.map((t, i) =>
    `[${i + 1}] ${t.threat.severity} (Score: ${t.threat.riskScore}/100)\n` +
    `    From: ${t.from}\n` +
    `    Subject: ${t.subject}\n` +
    `    Threats: ${t.threat.threats.join('; ')}\n`
  ).join('\n');

  await ses.send(new SendEmailCommand({
    FromEmailAddress: `Jude Security <${FROM_EMAIL}>`,
    Destination: { ToAddresses: [TECH_EMAIL] },
    Content: {
      Simple: {
        Subject: {
          Data: `🛡️ [JUDE SECURITY] ${threats.length} threat(s) detected — Approval needed`,
          Charset: 'UTF-8',
        },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
          Text: { Data: `JUDE SECURITY SCAN\n\n${textBody}\n\nReply APPROVE to quarantine or IGNORE to skip.\n\nNo action taken without your approval.`, Charset: 'UTF-8' },
        },
      },
    },
  }));
  console.log(`Security alert sent to MR TECH: ${threats.length} threats`);
}

// --- Error Alert ---
async function sendTechError(ses, errorMsg) {
  try {
    await ses.send(new SendEmailCommand({
      FromEmailAddress: FROM_EMAIL,
      Destination: { ToAddresses: [TECH_EMAIL] },
      Content: {
        Simple: {
          Subject: { Data: `[JUDE-ERROR] inbox-monitor: ${errorMsg.slice(0, 60)}`, Charset: 'UTF-8' },
          Body: { Text: { Data: `Jude inbox monitor failed at ${new Date().toISOString()}\n\nError: ${errorMsg}`, Charset: 'UTF-8' } },
        },
      },
    }));
  } catch (_) { console.error('Error alert also failed'); }
}

// --- Run Logging ---
async function logRun(ddb, results) {
  const id = `RUN-${Date.now().toString(36).toUpperCase()}`;
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      eventId: id,
      type: 'inbox_scan',
      center: 'system',
      createdAt: new Date().toISOString(),
      recipient: 'system',
      importance: results.securityThreats.length > 0 ? 'high' : 'normal',
      channels: { sms: false, email: results.securityThreats.length > 0 },
      message: `Scan complete: ${results.leads.length} leads, ${results.businessThreads.length} threads, ${results.securityThreats.length} threats`,
      meta: {
        leadsFound: results.leads.length,
        threadsFound: results.businessThreads.length,
        threatsFound: results.securityThreats.length,
        cleanMessages: results.clean.length,
        totalProcessed: results.leads.length + results.businessThreads.length + results.securityThreats.length + results.clean.length,
      },
    },
  }));
}

// --- Gmail API ---
async function getGoogleAccessToken() {
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
  const threeHoursAgo = Math.floor((Date.now() - 3 * 60 * 60 * 1000) / 1000);
  const query = `is:unread after:${threeHoursAgo}`;

  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.messages || [];
}

async function getMessageDetail(token, messageId) {
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Reply-To&metadataHeaders=Authentication-Results&metadataHeaders=Received-SPF`,
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
    replyTo: getHeader('Reply-To'),
    authResults: getHeader('Authentication-Results'),
    spf: getHeader('Received-SPF'),
    snippet: data.snippet || '',
    labelIds: data.labelIds || [],
    hasAttachments: (data.payload?.parts || []).some(p => p.filename),
  };
}

// --- Utilities ---
function extractDomain(email) {
  const match = email.match(/@([a-zA-Z0-9.-]+)/);
  return match ? match[1].toLowerCase() : null;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
