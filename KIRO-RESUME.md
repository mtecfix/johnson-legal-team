# KIRO SESSION RESUME — Johnson Legal Team
# Scan this file to restore full project context on relaunch.
# Last updated: 2026-07-13 7:51 PM ET

---

## WHO / WHAT

- **User:** mtecfix (GitHub), mrtechfixes.ai@gmail.com
- **AWS Account:** 663877906756, region us-east-1, IAM user: metrotec
- **Project:** Johnson Legal Team — solo Michigan law firm (Attorney Rodney Johnson)
- **Repo:** https://github.com/mtecfix/johnson-legal-team (private, master branch, fully pushed)
- **Local path:** `/mnt/d/KIRO PROJECTS/johnson legal team`

---

## THE SYSTEM (3 layers)

### Layer 1: Static Website + CMS (LIVE)
- GitHub Pages: https://mtecfix.github.io/johnson-legal-team/
- Decap CMS (git-based, admin/config.yml, GitHub OAuth backend)
- GitHub Actions deploys to GitHub Pages on push to master
- Pages: index, about, blog (5 posts), contact, practice areas (5), client portal pages, legal onboarding, pay-invoice, privacy, terms, 404

### Layer 2: Client Portal API (LIVE)
- CloudFormation stack: `johnson-legal-portal` (UPDATE_COMPLETE)
- Cognito pool: `us-east-1_dqqgSRKwn` (MFA OPTIONAL, TOTP)
- API Gateway: https://2hp2bdxsz6.execute-api.us-east-1.amazonaws.com
- Lambda: `johnson-legal-portal-PortalFunction-RUckeHLKjZto` (Node.js 20)
- DynamoDB: `johnson-legal-portal-PortalTable-BSDJNMA75SSQ`
- Routes: /profile, /cases, /documents, /messages, /invoices, /appointments, /admin/*
- Users (2):
  - mrtechfixes.ai@gmail.com — CONFIRMED (super_admin)
  - johnsonlegalteam@gmail.com — CONFIRMED (password reset Jul 13: `JLT@2026!secure`)

### Layer 3: Jude AI Agent (PARTIALLY DEPLOYED)

#### Deployed (serverless backbone):
- `jude-leads` Lambda — captures, classifies, scores leads, stores in DynamoDB
- `jude-notify-owner` Lambda — notification backbone (SES email + SNS SMS)
- `jude-api` (API GW mpiai89295) — POST /leads (open), GET/PATCH /leads (JWT via jude-staff pool)
- DynamoDB: `jude-leads`, `jude-events` (19 events logged as of Jul 13)
- Cognito: `jude-staff` pool (1 user confirmed)
- **Email delivery CONFIRMED WORKING** (Jul 13) — sent to johnsonlegalteam@gmail.com successfully

#### Deployed (Phase 1 CDK — all CREATE_COMPLETE Jul 10):
| Stack | Status | Resources |
|-------|--------|-----------|
| JudeVpc | ✅ UPDATE_COMPLETE | VPC vpc-0adc0680981af7b25, subnets, NAT GW, VPC endpoints |
| JudeSecurity | ✅ CREATE_COMPLETE | KMS CMK |
| JudeAgentCore | ✅ CREATE_COMPLETE | Role, SG, Bucket |
| JudeObservability | ✅ CREATE_COMPLETE | SNS alarm topic, CloudWatch dashboard |

#### ECR Container Images ✅ PUSHED (previously was blocker):
- `663877906756.dkr.ecr.us-east-1.amazonaws.com/jude-bridge`
- Tags: `v1`, `v1-x86`, `v1-arm64`, `latest`, `latest-arm64`

#### ⛔ BLOCKED — AgentCore Runtime:
- **Cannot create agent runtime** — account quota override sets "Total Agents per Account" to 0
- AWS default is 1000, but account 663877906756 has applied value of 0
- This is an account activation issue, NOT a normal quota request
- Service Quotas API rejects increase (says default is already 1000)
- **Resolution:** Open AWS Support case requesting AgentCore Runtime activation
- Affected quotas: L-F4575653 (agents=0), L-0A9E32B3 (docker size=0), L-9B442722 (endpoints=0), L-3E5722B2 (sessions=0)

---

## AWS ENVIRONMENT STATUS (verified 2026-07-13)

### ✅ WORKING:
- Portal CORS → `https://mtecfix.github.io`
- Jude API CORS → `https://mtecfix.github.io`
- SES sending enabled, 0/200 used today
- SES verified: `mrtechfixes.ai@gmail.com`, `johnsonlegalteam@gmail.com`
- jude-notify-owner env vars: OWNER_EMAIL, FROM_EMAIL, OWNER_PHONE, TECH_EMAIL all set
- Cognito users: both confirmed and working
- Email delivery: confirmed working Jul 13 (2 emails sent successfully)
- ECR images: 5 images pushed (v1, latest, arm64 variants)

### ⚠️ LIMITATIONS:
- **SES sandbox** — 200 emails/day, verified recipients only (production access DENIED, case 178372854400925)
- **AgentCore not activated** — account needs AWS Support intervention to enable
- **JudeRouter stack** — cannot deploy until AgentCore runtime exists

---

## IMMEDIATE NEXT STEPS (in order)

### Step 1: Open AWS Support Case (MANUAL — user must do this)
- Go to: https://support.console.aws.amazon.com/support/home#/case/create
- Category: Service limit increase → Bedrock AgentCore
- Body: "Account 663877906756 has 'Total Agents per Account' (L-F4575653) applied quota of 0. The AWS default is 1000. Please activate Bedrock AgentCore Runtime for this account in us-east-1. We have all infrastructure ready (VPC, IAM role, ECR container) and need to create our first agent runtime."
- Also mention: L-9B442722 (Endpoints), L-3E5722B2 (Active Sessions), L-0A9E32B3 (Docker image size)

### Step 2: Once Quotas Activated — Create Runtime
```bash
aws bedrock-agentcore-control create-agent-runtime \
  --agent-runtime-name judeRuntime \
  --agent-runtime-artifact '{"containerConfiguration":{"containerUri":"663877906756.dkr.ecr.us-east-1.amazonaws.com/jude-bridge:v1"}}' \
  --role-arn arn:aws:iam::663877906756:role/jude-agentcore-execution-role-us-east-1 \
  --network-configuration '{"networkMode":"VPC","networkModeConfig":{"securityGroups":["sg-06a7f96b29b47d2bf"],"subnets":["subnet-0fba84e75b3951d54","subnet-056a3b55582f9804b"]}}' \
  --description "Jude AI agent - Johnson Legal Team back office" \
  --environment-variables '{"GEMINI_API_KEY_SECRET":"jude/gemini-api-key","HOOKS_TOKEN_SECRET":"jude/hooks-token","WORKSPACE_BUCKET":"jude-workspace-663877906756-us-east-1","AWS_REGION":"us-east-1"}' \
  --region us-east-1
```
NOTE: Runtime name must match `[a-zA-Z][a-zA-Z0-9_]{0,47}` (no hyphens!)

### Step 3: Create Runtime Endpoint
```bash
aws bedrock-agentcore-control create-agent-runtime-endpoint \
  --agent-runtime-id <RUNTIME_ID> \
  --name jude-endpoint \
  --description "Jude single-tenant invocation endpoint" \
  --region us-east-1
```

### Step 4: Deploy Router Stack
```bash
cd "/mnt/d/KIRO PROJECTS/johnson legal team/jude-infra"
source .venv/bin/activate
npx cdk deploy JudeRouter --context runtime_id=<RUNTIME_ID> --require-approval never
```

### Step 5: Wire jude-leads → Router
### Step 6: End-to-end test

---

## SITE STRUCTURE (as of Jul 13, 2026)

### Public Pages (HTML)
| File | Purpose |
|------|---------|
| index.html | Homepage |
| about.html | About the firm |
| blog.html | Blog listing |
| contact.html | Contact form (leads → Jude) |
| practice-areas.html | Practice area overview |
| expungements.html | Practice area detail |
| misdemeanors.html | Practice area detail |
| traffic-tickets.html | Practice area detail |
| personal-injury.html | Practice area detail |
| probate-estate-planning.html | Practice area detail |
| practice-area.html | Dynamic practice area template |
| team.html | Attorney profiles |
| privacy-policy.html | Legal |
| terms-of-service.html | Legal |
| 404.html | Error page |
| sitemap.xml | SEO |

### Portal/Auth Pages
| File | Purpose |
|------|---------|
| admin/ (index.html) | Staff portal login (Cognito auth) |
| admin-dashboard.html | Admin view (cases, clients) |
| client-login.html | Client portal login |
| client-dashboard.html | Client portal view |
| user-registration.html | New user registration |
| reset-password.html | Password reset |
| pay-invoice.html | Invoice payment |
| legal-onboarding.html | Client onboarding form |
| forms/client-onboarding.html | Extended onboarding |
| jude-leads-dashboard.html | Staff leads dashboard |
| google-oauth-setup.html | OAuth setup helper |

### JavaScript Modules
| File | Purpose |
|------|---------|
| cognito-auth.js | Cognito authentication library |
| portal-config.js | Portal configuration (pool ID, API URL) |
| portal-api-client.js | API client (window.PortalAPI) |
| portal-router.js | SPA routing |
| admin-dashboard.js | Admin dashboard logic |
| client-dashboard.js | Client dashboard logic |
| blog.js | Blog rendering |
| contact-form.js | Contact form → Jude leads |
| chat-widget.js | Chat widget |
| content.js | CMS content loader |
| footer-script.js | Footer interactions |
| legal-onboarding.js | Onboarding form logic |
| user-registration.js | Registration flow |
| search.js | Site search |
| practice-area.js | Practice area dynamic loading |
| team.js | Team page rendering |
| forms/onboarding-form.js | Onboarding form validation |

### Backend
| Path | Purpose |
|------|---------|
| portal-api/ | SAM stack (Lambda + API GW + DDB + Cognito) |
| jude-backend/leads/ | Lead capture/classify/score Lambda |
| jude-backend/notify-owner/ | Multi-channel notification Lambda |
| jude-infra/ | CDK app (5 stacks: VPC, Security, AgentCore, Router, Observability) |
| jude-infra/bridge/ | AgentCore container (Dockerfile, OpenClaw workspace) |
| lambda/ | Legacy registration_approver.py |
| api/ | Legacy PHP endpoints (DEAD CODE — replaced by Cognito) |

### Content (CMS-managed)
| Path | Purpose |
|------|---------|
| content/blog/ | 5 blog posts (markdown) |
| content/practice-areas/ | Practice area descriptions |
| content/team/ | Attorney bio |
| content/settings/ | Site config (contact info, general) |
| content/pages/ | Static page content |

### Config & Deploy
| File | Purpose |
|------|---------|
| .github/workflows/deploy-pages.yml | GitHub Pages deployment |
| .github/workflows/build-jude-bridge.yml | ECR container build pipeline |
| admin/config.yml | Decap CMS configuration |
| netlify.toml | Netlify config (alternative host) |
| package.json | NPM scripts (cms, serve, dev) |
| .gitignore | Git exclusions |
| .env.example | Environment template |
| DEPLOY.md | Deployment guide |
| KIRO-RESUME.md | This file |

---

## CREDENTIALS REFERENCE

### Portal Login (Staff)
- **URL:** https://mtecfix.github.io/johnson-legal-team/admin/
- **Admin:** mrtechfixes.ai@gmail.com (super_admin)
- **Firm:** johnsonlegalteam@gmail.com / `JLT@2026!secure` (reset Jul 13)
- **MFA:** TOTP required (authenticator app)

### AWS Resources
| Resource | Value |
|----------|-------|
| Cognito Pool ID | us-east-1_dqqgSRKwn |
| Cognito Client ID | 1ceidj2abdvs0jijedhckte5um |
| Portal API URL | https://2hp2bdxsz6.execute-api.us-east-1.amazonaws.com |
| Jude API URL | https://mpiai89295.execute-api.us-east-1.amazonaws.com |
| Region | us-east-1 |
| Portal CFN Stack | johnson-legal-portal |
| ECR Repo | 663877906756.dkr.ecr.us-east-1.amazonaws.com/jude-bridge |
| KMS Key | arn:aws:kms:us-east-1:663877906756:key/f2cb1248-04fe-4146-8f63-8e673b6ac33e |
| Workspace Bucket | jude-workspace-663877906756-us-east-1 |
| GitHub user | mtecfix |
| GitHub repo | johnson-legal-team (private) |
| SAM deploy bucket | johnson-legal-sam-deploy-663877906756 |

---

## SECRETS (reference by name only)
- `jude/gemini-api-key` — Gemini 3.1 Flash-Lite (paid tier)
- `jude/hooks-token` — Bearer token for Router Lambda ↔ AgentCore auth
- `jude/deepseek-api-key` — Fallback LLM (needs prepaid credit)
- `johnson-legal/rds-credentials` — Legacy MySQL creds (unused)
- `johnson-legal/google-oauth-client-secret` — Google OAuth (unused currently)

---

## KEY DESIGN DECISIONS (don't re-decide these)
- Model: Gemini 3.1 Flash-Lite (paid tier) — NOT Bedrock, NOT DeepSeek
- Runtime: Bedrock AgentCore (serverless microVMs) — NOT App Runner, NOT EC2
- Single-tenant: one agent "jude", one session "jude-main", one internal caller
- OpenClaw version: 2026.6.11
- Notifications: SES for all + SNS SMS for urgent only
- No Bedrock model permissions needed — Gemini called over internet via NAT Gateway
- Runtime name: `judeRuntime` (no hyphens — AWS naming constraint)
