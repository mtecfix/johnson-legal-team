# Johnson Legal Team — Full-Stack Legal Practice Platform

A serverless web presence + client portal + AI practice-management agent for a solo Michigan law firm.

## Live Infrastructure (AWS `us-east-1`, account 663877906756)

| Component | Status | URL / ARN |
|-----------|--------|-----------|
| Static site | ✅ Live | https://mtecfix.github.io/johnson-legal-team/ |
| Client portal API | ✅ Live | https://2hp2bdxsz6.execute-api.us-east-1.amazonaws.com |
| Cognito auth | ✅ Live | Pool `us-east-1_dqqgSRKwn`, MFA optional (TOTP) |
| Jude leads API | ✅ Live | https://mpiai89295.execute-api.us-east-1.amazonaws.com |
| Jude notifications | ✅ Live | SES email + SNS SMS (sandbox mode) |
| Jude CDK infra | ✅ Deployed | VPC, Security, AgentCore IAM, Observability |
| Jude AI (AgentCore) | ⛔ Blocked | Account needs AgentCore activation (quota=0) |

---

## Repository Structure

```
├── index.html, about.html, ...      Static site pages (public)
├── combined-style.css                Main stylesheet
├── images/                           Site images + blog images
├── content/                          CMS-managed content (markdown + JSON)
│   ├── blog/                         Blog posts
│   ├── practice-areas/               Practice area descriptions
│   ├── team/                         Attorney bios
│   └── settings/                     Site-wide config (contact, general)
├── admin/                            Decap CMS (git-based, free)
│   ├── config.yml                    CMS collection definitions
│   └── index.html                    CMS admin UI entry point
│
├── portal-api/                       Client Portal backend (SAM/CloudFormation)
│   ├── template.yaml                 SAM template (Cognito + API GW + Lambda + DDB)
│   ├── src/index.js                  Lambda handler (all portal routes)
│   ├── src/index.test.js             Unit tests
│   └── openapi.yaml                  API spec
├── cognito-auth.js                   Frontend Cognito auth library
├── portal-config.js                  Frontend config (Pool ID, API URL)
├── portal-api-client.js              Frontend API client (window.PortalAPI)
├── client-login.html                 Login + MFA setup page
├── client-dashboard.html/js          Client portal view
├── admin-dashboard.html/js           Admin portal view
│
├── jude-backend/                     Jude serverless functions (deployed)
│   ├── leads/index.mjs               Lead capture, classify, score, store
│   └── notify-owner/index.mjs        Owner notification backbone (SNS + SES)
├── jude-leads-dashboard.html         Staff leads dashboard
│
├── jude-infra/                       Jude AI CDK app (NOT YET DEPLOYED)
│   ├── app.py                        CDK entry point
│   ├── cdk.json                      CDK config + context
│   ├── requirements.txt              Python deps
│   ├── stacks/                       CDK stacks (VPC, Security, AgentCore, Router, Observability)
│   ├── lambda/router/index.py        Router Lambda for AgentCore invocation
│   └── bridge/                       AgentCore container (OpenClaw + workspace)
│       ├── Dockerfile
│       ├── agentcore-contract.js     AgentCore runtime contract impl
│       ├── workspace-sync.js         S3 workspace sync
│       ├── entrypoint.sh
│       └── workspace-jude/           Agent persona + skills
│           ├── AGENTS.md             Operating rules + core duties
│           ├── SOUL.md               Persona + voice + tone
│           ├── TOOLS.md              Tool usage notes + guardrails
│           └── skills/
│               ├── gmail-inbox/      Email monitoring rules
│               ├── owner-notify/     Notification format + rate limits
│               ├── case-lookup/      Client/case cross-reference
│               ├── client-lifecycle/ Onboarding + closure automation + MEMORY.md
│               ├── leads-triage/     Lead classification rules
│               └── filing-tracker/   MiFILE monitoring (planned)
│
├── lambda/
│   └── jude-inbox-monitor/index.js   Gmail inbox checker (runs every 3h via EventBridge)
│
├── docs/                             Architecture + specs
│   ├── JUDE-OPENCLAW-SPEC.md         Full Jude agent spec (v3, current)
│   ├── JUDE-ARCHITECTURE-BLUEPRINT.md  Original design doc (v1)
│   ├── AUTH_FLOW.md                  Portal auth documentation
│   └── openclaw_README.txt           OpenClaw framework notes
├── DEPLOY.md                         Hosting + CORS deployment guide
├── PICKUP-HERE.txt                   Handoff / resumption notes
│
├── .github/workflows/
│   └── deploy-pages.yml              GitHub Pages deployment workflow
├── netlify.toml                      Netlify config (alternative host)
├── _archive/                         Legacy/deprecated code
└── _secrets-local/                   Local secrets (GITIGNORED, never deploy)
```

---

## Quick Start

### View the site locally

Open `index.html` in a browser. No build step required — it's static HTML/CSS/JS.

### Edit content (CMS)

```bash
npx decap-server        # Local git proxy on :8081
# Open admin/index.html in browser — edits go straight to local files
```

### Deploy site changes

Push to `master` → GitHub Actions workflow deploys to GitHub Pages automatically.

### Deploy portal API changes

```bash
cd portal-api
sam build
sam deploy --stack-name johnson-legal-portal \
  --s3-bucket johnson-legal-sam-deploy-663877906756 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides CorsOrigin=https://<YOUR-HTTPS-DOMAIN> \
  --region us-east-1
```

---

## Authentication

- **Portal auth:** AWS Cognito (email/password + mandatory TOTP MFA)
- **Admin user:** `mrtechfixes.ai@gmail.com` (super_admin group)
- **Jude API staff access:** Separate Cognito pool `jude-staff` for GET/PATCH routes on leads

---

## Jude — AI Practice Management Agent

Jude is an autonomous back-office agent built on the [OpenClaw](https://github.com/openclaw/openclaw) framework, running on AWS Bedrock AgentCore Runtime (serverless Firecracker microVMs).

**Current state:** The leads capture/scoring pipeline is live (rule-based). The AI reasoning layer (CDK stacks in `jude-infra/`) is written but not yet deployed.

**Model:** Google Gemini 3.1 Flash-Lite (paid tier) via OpenAI-compatible endpoint.

### Jude Active Services (live)

| Service | Function | Schedule |
|---------|----------|----------|
| `jude-inbox-monitor` Lambda | Checks Gmail for new emails, classifies by tier, sends SMS/email digest | Every 3 hours (EventBridge) |
| Client lifecycle notifications | Auto-sends welcome letter on client creation, thank-you on case closure | Triggered by portal API |
| Communication memory | Logs outgoing message patterns for style-matching | On every admin message send |

### Jude Skills (workspace)

| Skill | Status | Description |
|-------|--------|-------------|
| `gmail-inbox` | ✅ Active | Email monitoring, tier classification, digest generation |
| `owner-notify` | ✅ Active | SMS + email notifications to Attorney Johnson |
| `case-lookup` | ✅ Active | Cross-reference contacts against case database |
| `client-lifecycle` | ✅ Active | Welcome letters, thank-you letters, feedback prompts |
| `leads-triage` | ⏸ Reserved | New-business lead scoring (awaiting inbox-monitor pipeline) |
| `filing-tracker` | 📋 Planned | MiFILE notification monitoring |

See `docs/JUDE-OPENCLAW-SPEC.md` for the full specification.

---

## Email Configuration

| Service | Status | Detail |
|---------|--------|--------|
| SES | ⚠️ Sandbox | 200 emails/day max, only to verified addresses |
| Verified sender | `johnsonlegalteam@gmail.com` | Used for all outbound correspondence |
| Gmail API | ✅ Active | OAuth refresh token with Calendar + Gmail scopes |
| Google Calendar | ✅ Synced | Events created from dashboard appear on Google Calendar |
| jude-inbox-monitor | ✅ Active | Reads inbox every 3 hours, classifies, notifies |
| Lifecycle emails | ✅ Active | Welcome + Thank-you letters auto-sent |

---

## Admin Dashboard Features (as of July 14, 2026)

| Section | Status | Capabilities |
|---------|--------|-------------|
| Dashboard | ✅ | Stats, recent cases, Jude status |
| Cases | ✅ | Create, edit, close, delete, notes, category tabs, detail view |
| Contacts | ✅ | Create, edit, search, filter by type/category |
| Calendar | ✅ | Google Calendar embed (requires login), add events via modal (syncs to GCal) |
| Messages | ✅ | Send email/SMS to contacts, message history log |
| Invoices | ✅ | Create invoices, mark as paid |
| Registrations | ✅ | Approve/reject pending client registrations |
| Users | ✅ | Role management (super_admin only) |
| Documents | 📋 Planned | File upload + S3 integration |
| Leads | ⏸ Reserved | Awaiting Jude inbox-monitor pipeline for new-business detection |
| Payments | 📋 Planned | Stripe integration |
| System | ✅ | Static infrastructure status display |

---

## Known Blockers

| # | Issue | Impact | Resolution |
|---|-------|--------|------------|
| 1 | ⛔ AgentCore quota = 0 (account not activated) | Cannot create agent runtime — conversational Jude blocked | AWS Support case open for quota increase |
| 2 | SES in sandbox | Can't email unverified addresses (200/day limit) | Request SES production access |
| 3 | No firm domain | Jude can't have its own reply-to email for conversations | Purchase domain + set up email |

### ✅ Previously Resolved
| # | Was | Fixed |
|---|-----|-------|
| ~~4~~ | Portal CORS → dead CloudFront URL | Now points to `https://mtecfix.github.io` |
| ~~5~~ | jude-notify-owner env vars empty | All set: OWNER_EMAIL, FROM_EMAIL, OWNER_PHONE, TECH_EMAIL |
| ~~6~~ | Cognito user FORCE_CHANGE_PASSWORD | Both users CONFIRMED |
| ~~7~~ | ECR jude-bridge repo empty | 5 images pushed (v1, latest, arm64 variants) |
| ~~8~~ | Jude CDK stacks not deployed | Phase 1 stacks all CREATE_COMPLETE |
| ~~9~~ | Portal API CORS preflight 401 | Fixed: explicit method routes replace ANY routes |
| ~~10~~ | Cases API NetworkError | Fixed: OPTIONS routes without JWT auth |
| ~~11~~ | Google Calendar API not enabled | Enabled in Google Cloud project |
| ~~12~~ | Gmail refresh token missing calendar scope | Re-authorized with calendar + gmail.readonly |

---

## Cost

All services are on pay-per-use / free-tier pricing. At current (zero-traffic) volume: **~$0/month**. The most expensive future component will be the NAT Gateway for Gemini API egress (~$0.045/hr only while Jude's AgentCore session is warm).

---

## Security Notes

- Client portal data is isolated from the public CMS (separate Lambda + DynamoDB)
- MFA is mandatory for all portal users
- Secrets stored in AWS Secrets Manager (never in repo)
- `_secrets-local/` is gitignored — contains local-only credential copies
- S3 bucket policy is public-read for the static site only
- DynamoDB tables are KMS-encrypted
- Jude's AgentCore container runs in VPC-isolated private subnets
