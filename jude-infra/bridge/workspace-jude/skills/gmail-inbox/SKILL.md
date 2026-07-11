# Skill: gmail-inbox

## Purpose
Monitor the firm's Gmail inbox (johnsonlegalteam@gmail.com) for court notices,
client communications, filing confirmations, and deadline-sensitive items.
Provide intelligent triage and summarization.

## Backend
- Gmail API (read-only scope: gmail.readonly)
- OAuth credentials: Secrets Manager `johnson-legal/google-oauth-client-secret`
- Refresh token: Secrets Manager `johnson-legal/gmail-refresh-token`
- Account: johnsonlegalteam@gmail.com (32,000+ messages, 19,500+ threads)

## Monitoring Rules

### Tier 1: IMMEDIATE (check every invocation, flag for SMS)
| Sender pattern | Why |
|---------------|-----|
| *@36thdistrictcourtmi.gov | Court docket assignments, scheduling |
| *@3rdcc.org | 3rd Circuit Court orders, hearings |
| *@waynecountymi.gov | Wayne County casework (active juvenile cases) |
| *@michigan.gov | Michigan AG (active case: Brundidge/Ross) |
| *@detroitmi.gov | City of Detroit legal (active matters) |
| Subject contains: "deadline" / "due" / "hearing" / "emergency" | Time-sensitive |

### Tier 2: IMPORTANT (email digest, same day)
| Sender/pattern | Why |
|---------------|-----|
| Active client contacts (from labeled folders) | Client communication |
| *@butzel.com, *@urbanimarshall.com | Opposing counsel |
| info@truefiling.com | MiFILE payment/filing confirmations |
| noreply@watchguardvideo.com | Evidence sharing notifications |
| Subject contains case numbers (##-######-XX format) | Case activity |

### Tier 3: LOG ONLY (no notification)
| Sender/pattern | Why |
|---------------|-----|
| referrals@corp.lawyer.com | Lawyer.com (being canceled, low value) |
| *-noreply@linkedin.com | LinkedIn notifications |
| Google Alerts, newsletters | Informational only |
| PayPal, CashApp notifications | Financial (log for records) |
| Hilton, hotel confirmations | Travel (use to detect travel mode) |

## Pattern Detection

### Unread Alert
If a Tier 1 email has been unread for > 4 hours during business hours
(8 AM – 6 PM ET, Mon-Fri), escalate to SMS:
```
[INBOX] Unread 4h+: Court docket from Pruitt (36th Dist)
Subject: House Counsel Assignment [date]
```

### Scheduling Conflict Detection
Cross-reference court docket emails against each other:
- If two hearings scheduled for same date/time → immediate SMS alert
- Include both case references and courtrooms

### Dropped Thread Detection
If Mr. Johnson received an email from a Tier 2 sender and has not replied
within 48 hours (checking sent folder), flag in digest:
```
AWAITING YOUR REPLY (3+ days):
• Nadine Waller — "Living Trust vs Texas Option" (received 7/5)
• Carmen McCloud — "Proof of service page 3" (received 7/8)
```

### Travel Detection
Monitor for signals that Mr. Johnson is traveling:
- Hotel confirmation emails (Hilton, Marriott, etc.)
- Sent emails containing "out of the country" / "out of town" / "return"
- Car rental confirmations (Sixt, Turo)
When detected → activate travel mode in owner-notify skill.

## Inbox Summary (on-demand)

When requested, produce a structured summary:
```
INBOX SUMMARY — [date/time]
━━━━━━━━━━━━━━━━━━━━━━━━━━

UNREAD: [count]
  Tier 1 (urgent): [count]
  Tier 2 (important): [count]
  Tier 3 (low): [count]

TOP THREADS NEEDING ATTENTION:
1. [sender] — [subject] — [days waiting]
2. ...

TODAY'S COURT/FILING ACTIVITY:
• [items]

LEAD INFLOW (last 24h):
• [count] Lawyer.com referrals (logged, not escalated)
• [count] direct inquiries
```

## Do NOT
- Send, reply to, or forward any email (read-only access)
- Store email body content in DynamoDB or any persistent store
- Share email content with anyone other than Mr. Johnson via owner-notify
- Access drafts or modify any mailbox state
