# Jude Backend — Serverless Functions (Deployed)

The live Lambda functions that form Jude's leads pipeline and owner notification backbone.

## Functions

### `jude-leads` (leads/index.mjs)

**Purpose:** Capture, classify, score, and store inbound leads.

| Route | Auth | Description |
|-------|------|-------------|
| `POST /leads` | Open (inbound from contact form / SES) | Process a new lead |
| `GET /leads` | JWT (jude-staff pool) | List all leads (optional `?stage=` filter) |
| `PATCH /leads/{id}` | JWT (jude-staff pool) | Update stage or add notes |

**Lead scoring (rule-based — AI seams marked for Gemini/Nova later):**
- Case-type detection: personal-injury, traffic-tickets, misdemeanors, expungements, probate
- Score 0-100 based on: keyword matches, message length, phone number present, urgency words
- Non-lead filtering: unsubscribe, newsletter, invoices, auto-replies → rejected

**Environment:**
- `LEADS_TABLE` = `jude-leads`
- `NOTIFY_FN` = `jude-notify-owner`

**DynamoDB schema (jude-leads):**
- PK: `leadId` (format: `LD-<timestamp36>-<uuid4>`)
- GSI: `stage-index` (PK: `stage`)
- Fields: email, subject, caseType, score, source, firstMessage, conversation[], createdAt, updatedAt

---

### `jude-notify-owner` (notify-owner/index.mjs)

**Purpose:** Single notification module all Jude "centers" call to reach the business owner.

**Flow:**
1. Record event to DynamoDB (`jude-events`)
2. Triage importance (rule-based; seam for LLM later)
3. Email (SES) — sent for ALL notifications (the log/digest channel)
4. SMS (SNS) — sent ONLY for `high`/`urgent` importance

**Invoke payload:**
```json
{
  "center": "leads",
  "type": "new_lead",
  "message": "New personal-injury lead (score 75) from jane@x.com",
  "importance": "auto",
  "meta": { "leadId": "LD-...", "caseType": "personal-injury", "score": 75 }
}
```

**High-importance triggers (auto-SMS):**
- new_lead, qualified_lead, missed_call, voicemail, urgent_email
- payment_received, appointment_booked, ad_rejected, budget_exhausted
- Anything from center=leads

**Environment:**
- `EVENTS_TABLE` = `jude-events`
- `OWNER_PHONE` = ❌ **EMPTY** (needs: `+1XXXXXXXXXX`)
- `FROM_EMAIL` = ❌ **EMPTY** (needs: SES-verified sender address)
- `OWNER_EMAIL` = ❌ **EMPTY** (needs: owner's email address)

---

## Current State

| What | Status |
|------|--------|
| Leads Lambda deployed | ✅ Working — processes and stores leads |
| Notify Lambda deployed | ⚠️ Logs events but can't deliver (env vars empty) |
| jude-leads DynamoDB | ✅ Active, 0 items (test lead passed through) |
| jude-events DynamoDB | ✅ Active, 1 test event from today |
| jude-api (API Gateway) | ✅ Live with JWT auth on GET/PATCH |
| jude-staff Cognito | ✅ 1 confirmed user |

## Deploy (manual — no IaC for these yet)

```bash
# Package leads function
cd leads && zip function.zip index.mjs
aws lambda update-function-code --function-name jude-leads \
  --zip-file fileb://function.zip --region us-east-1

# Package notify function
cd ../notify-owner && zip function.zip index.mjs
aws lambda update-function-code --function-name jude-notify-owner \
  --zip-file fileb://function.zip --region us-east-1
```

## Configure Notifications (REQUIRED)

```bash
# Set owner contact info so notifications actually deliver
aws lambda update-function-configuration --function-name jude-notify-owner \
  --environment 'Variables={EVENTS_TABLE=jude-events,OWNER_EMAIL=<owner@firm.com>,FROM_EMAIL=<verified@sender.com>,OWNER_PHONE=<+1XXXXXXXXXX>}' \
  --region us-east-1
```

**Note:** Both `FROM_EMAIL` and `OWNER_EMAIL` must be SES-verified while in sandbox mode.

## AI Integration Seams

Three functions are marked for future LLM replacement:
1. `classifyEmail()` in leads/index.mjs — currently keyword-matching
2. `scoreLead()` in leads/index.mjs — currently heuristic rules
3. `decideImportance()` in notify-owner/index.mjs — currently type-based

When Jude's AgentCore is deployed, the Router Lambda calls into OpenClaw which uses Gemini for these decisions. The existing Lambdas continue to work as-is (rule-based fallback) until the AI layer is wired in.
