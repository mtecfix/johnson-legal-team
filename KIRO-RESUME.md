# KIRO SESSION RESUME — Johnson Legal Team / Jude AI Agent
# Scan this file to restore context on relaunch.
# Location: C:\Users\MR TEHC\johnson legal team\KIRO-RESUME.md
# Last updated: 2026-07-10 5:56 PM ET

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
- S3 bucket `johnsonlegalteam-www` (public HTTP, website hosting enabled)
- Decap CMS (git-based, admin/config.yml)
- GitHub Actions deploys to GitHub Pages on push to master
- Pages: index, about, blog (5 posts), contact, practice areas (5), client portal pages
- **BLOCKER:** Portal CORS set to dead CloudFront URL `https://d1rqv10nry9s54.cloudfront.net` — needs update to GitHub Pages URL

### Layer 2: Client Portal API (LIVE)
- CloudFormation stack: `johnson-legal-portal`
- Cognito pool: `us-east-1_dqqgSRKwn` (MFA required, TOTP)
- API Gateway: https://2hp2bdxsz6.execute-api.us-east-1.amazonaws.com
- Lambda: `johnson-legal-portal-PortalFunction-RUckeHLKjZto` (Node.js 20)
- DynamoDB: `johnson-legal-portal-PortalTable-BSDJNMA75SSQ` (0 items)
- User: mrtechfixes.ai@gmail.com (super_admin, FORCE_CHANGE_PASSWORD — never logged in)
- Routes: /profile, /cases, /documents, /messages, /invoices, /appointments, /admin/*

### Layer 3: Jude AI Agent (PARTIALLY DEPLOYED)

#### Deployed (serverless backbone):
- `jude-leads` Lambda — captures, classifies (rule-based), scores leads, stores in DynamoDB
- `jude-notify-owner` Lambda — notification backbone (SES email + SNS SMS)
  - **⚠️ OWNER_EMAIL, FROM_EMAIL, OWNER_PHONE are ALL EMPTY** — notifications log but don't deliver
- `jude-api` (API GW mpiai89295) — POST /leads (open), GET/PATCH /leads (JWT via jude-staff pool)
- DynamoDB: `jude-leads` (0 items), `jude-events` (1 test event from today)
- Cognito: `jude-staff` pool (1 user confirmed)

#### Deployed THIS SESSION (Phase 1 CDK):
| Stack | Resources |
|-------|-----------|
| JudeVpc | VPC vpc-0adc0680981af7b25, subnets subnet-0fba84e75b3951d54 + subnet-056a3b55582f9804b, NAT GW, VPC endpoints (S3, DDB, SecretsManager, CW Logs, Monitoring) |
| JudeSecurity | KMS CMK arn:aws:kms:us-east-1:663877906756:key/f2cb1248-04fe-4146-8f63-8e673b6ac33e |
| JudeAgentCore | Role: jude-agentcore-execution-role-us-east-1, SG: sg-06a7f96b29b47d2bf, Bucket: jude-workspace-663877906756-us-east-1 |
| JudeObservability | SNS alarm topic: arn:aws:sns:us-east-1:663877906756:jude-alarms, CloudWatch dashboard |

#### NOT YET Deployed (blocked by WSL read-only filesystem):
- **Bridge container** — Dockerfile is ready in `jude-infra/bridge/`, openclaw bumped to 2026.6.11
- **ECR repo created:** 663877906756.dkr.ecr.us-east-1.amazonaws.com/jude-bridge (empty, no image pushed)
- **AgentCore Runtime** — not created yet (needs container image first)
- **AgentCore Runtime Endpoint** — not created
- **JudeRouter CDK stack** — not deployed (needs runtime_id)

---

## IMMEDIATE NEXT STEPS (in order)

### Step 1: Fix WSL (user action)
PowerShell (admin): `wsl --shutdown` → reopen terminal

### Step 2: Build + Push Container
```bash
cd "/mnt/c/Users/MR TEHC/johnson legal team/jude-infra/bridge"
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 663877906756.dkr.ecr.us-east-1.amazonaws.com
docker build -t 663877906756.dkr.ecr.us-east-1.amazonaws.com/jude-bridge:v1 .
docker push 663877906756.dkr.ecr.us-east-1.amazonaws.com/jude-bridge:v1
```

### Step 3: Create AgentCore Runtime
```bash
aws bedrock-agentcore-control create-agent-runtime \
  --agent-runtime-name jude-runtime \
  --agent-runtime-artifact '{"containerConfiguration":{"containerUri":"663877906756.dkr.ecr.us-east-1.amazonaws.com/jude-bridge:v1"}}' \
  --role-arn arn:aws:iam::663877906756:role/jude-agentcore-execution-role-us-east-1 \
  --network-configuration '{"networkMode":"VPC","networkModeConfig":{"securityGroups":["sg-06a7f96b29b47d2bf"],"subnets":["subnet-0fba84e75b3951d54","subnet-056a3b55582f9804b"]}}' \
  --description "Jude AI agent - Johnson Legal Team back office" \
  --environment-variables '{"GEMINI_API_KEY_SECRET":"jude/gemini-api-key","HOOKS_TOKEN_SECRET":"jude/hooks-token","WORKSPACE_BUCKET":"jude-workspace-663877906756-us-east-1","AWS_REGION":"us-east-1"}' \
  --region us-east-1
```
→ Save the `agentRuntimeId` from the response

### Step 4: Create Runtime Endpoint
```bash
aws bedrock-agentcore-control create-agent-runtime-endpoint \
  --agent-runtime-id <RUNTIME_ID> \
  --name jude-endpoint \
  --description "Jude single-tenant invocation endpoint" \
  --region us-east-1
```

### Step 5: Deploy Router Stack
```bash
cd "/mnt/c/Users/MR TEHC/johnson legal team/jude-infra"
source .venv/bin/activate
npx cdk deploy JudeRouter --context runtime_id=<RUNTIME_ID> --require-approval never
```

### Step 6: Wire jude-leads to call Router
Update `jude-leads` Lambda to POST to the new Router API after storing a lead.

### Step 7: End-to-end test
POST a test lead → jude-leads stores it → calls Router → AgentCore/OpenClaw triages → calls jude-notify-owner → delivers email/SMS.

---

## OTHER PENDING ITEMS (lower priority)

1. **Fix Portal CORS** — redeploy with `CorsOrigin=https://mtecfix.github.io` (or wherever GitHub Pages serves it)
2. **Configure jude-notify-owner** — set OWNER_EMAIL, FROM_EMAIL, OWNER_PHONE
3. **Request SES production access** — currently sandbox (200 emails/day, verified-only recipients)
4. **Commit blog images** — `images/blog/` is untracked
5. **Set admin/config.yml backend.repo** to `mtecfix/johnson-legal-team`
6. **Commit this session's changes** — READMEs, security_stack.py fix, Dockerfile fixes

---

## SECRETS (reference by name only)
- `jude/gemini-api-key` — Gemini 3.1 Flash-Lite (AIzaSy... format, paid tier)
- `jude/hooks-token` — Bearer token for Router Lambda ↔ AgentCore auth
- `jude/deepseek-api-key` — Fallback LLM (needs prepaid credit to use)
- `johnson-legal/rds-credentials` — Legacy MySQL creds (unused)
- `johnson-legal/google-oauth-client-secret` — Google OAuth (unused currently)

---

## KEY DESIGN DECISIONS (don't re-decide these)
- Model: Gemini 3.1 Flash-Lite (paid tier) — NOT Bedrock (was blocked), NOT DeepSeek (no credit)
- Runtime: Bedrock AgentCore (serverless microVMs) — NOT App Runner, NOT EC2
- Single-tenant: one agent "jude", one session "jude-main", one internal caller
- OpenClaw version: 2026.6.11 (bumped from 2026.3.8 due to baileys SSH dep issue)
- Notifications: SES for all + SNS SMS for urgent only
- No Bedrock model permissions needed — Gemini is called over internet via NAT Gateway
