# KIRO SESSION RESUME — Johnson Legal Team
# Scan this file to restore full project context on relaunch.
# Last updated: 2026-07-11 11:47 AM ET

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

### Layer 2: Client Portal API (LIVE)
- CloudFormation stack: `johnson-legal-portal` (UPDATE_COMPLETE)
- Cognito pool: `us-east-1_dqqgSRKwn` (MFA OPTIONAL, TOTP)
- API Gateway: https://2hp2bdxsz6.execute-api.us-east-1.amazonaws.com
- Lambda: `johnson-legal-portal-PortalFunction-RUckeHLKjZto` (Node.js 20)
- DynamoDB: `johnson-legal-portal-PortalTable-BSDJNMA75SSQ`
- Routes: /profile, /cases, /documents, /messages, /invoices, /appointments, /admin/*
- Users (2):
  - mrtechfixes.ai@gmail.com — CONFIRMED (super_admin)
  - johnsonlegalteam@gmail.com — CONFIRMED (created Jul 10)

### Layer 3: Jude AI Agent (PARTIALLY DEPLOYED)

#### Deployed (serverless backbone):
- `jude-leads` Lambda — captures, classifies, scores leads, stores in DynamoDB
- `jude-notify-owner` Lambda — notification backbone (SES email + SNS SMS)
- `jude-api` (API GW mpiai89295) — POST /leads (open), GET/PATCH /leads (JWT via jude-staff pool)
- DynamoDB: `jude-leads`, `jude-events`
- Cognito: `jude-staff` pool (1 user confirmed)

#### Deployed (Phase 1 CDK — all CREATE_COMPLETE Jul 10):
| Stack | Status | Resources |
|-------|--------|-----------|
| JudeVpc | ✅ COMPLETE | VPC vpc-0adc0680981af7b25, subnets, NAT GW, VPC endpoints (S3, DDB, SecretsManager, CW Logs, Monitoring) |
| JudeSecurity | ✅ COMPLETE | KMS CMK arn:aws:kms:us-east-1:663877906756:key/f2cb1248-04fe-4146-8f63-8e673b6ac33e |
| JudeAgentCore | ✅ COMPLETE | Role: jude-agentcore-execution-role-us-east-1, SG: sg-06a7f96b29b47d2bf, Bucket: jude-workspace-663877906756-us-east-1 |
| JudeObservability | ✅ COMPLETE | SNS alarm topic: arn:aws:sns:us-east-1:663877906756:jude-alarms, CloudWatch dashboard |

#### NOT YET Deployed (blocked — container not built):
- **Bridge container** — Dockerfile ready in `jude-infra/bridge/`, ECR repo exists but **EMPTY (no images pushed)**
- **ECR repo:** 663877906756.dkr.ecr.us-east-1.amazonaws.com/jude-bridge
- **AgentCore Runtime** — not created (needs container image)
- **AgentCore Runtime Endpoint** — not created
- **JudeRouter CDK stack** — not deployed (needs runtime_id)

---

## AWS ENVIRONMENT STATUS (verified 2026-07-11)

### ✅ RESOLVED since last session:
- **jude-notify-owner env vars** — NOW POPULATED: OWNER_EMAIL=johnsonlegalteam@gmail.com, FROM_EMAIL=johnsonlegalteam@gmail.com, OWNER_PHONE=+13133552216, TECH_EMAIL=mrtechfixes.ai@gmail.com
- **Portal CORS** — NOW SET TO `https://mtecfix.github.io` (was dead CloudFront URL)
- **Cognito user** — mrtechfixes.ai@gmail.com is now CONFIRMED (was FORCE_CHANGE_PASSWORD)
- **SES identities** — both mrtechfixes.ai@gmail.com AND johnsonlegalteam@gmail.com are VERIFIED

### ⚠️ STILL PENDING:
- **SES production access** — DENIED (case 178372854400925). Still sandbox: 200 emails/day, verified recipients only
- **ECR jude-bridge** — repo exists but NO IMAGE pushed (Docker build was blocked by WSL read-only issue)
- **AgentCore Runtime + Endpoint** — cannot create until container is pushed
- **JudeRouter stack** — cannot deploy until runtime exists

### ℹ️ NOTES:
- Cognito MFA is OPTIONAL (not REQUIRED as previously noted)
- Portal API Cognito Client ID: 1ceidj2abdvs0jijedhckte5um
- jude-api CORS also correctly set to `https://mtecfix.github.io`

---

## IMMEDIATE NEXT STEPS (in order)

### Step 1: Build + Push Container
```bash
cd "/mnt/d/KIRO PROJECTS/johnson legal team/jude-infra/bridge"
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 663877906756.dkr.ecr.us-east-1.amazonaws.com
docker build -t 663877906756.dkr.ecr.us-east-1.amazonaws.com/jude-bridge:v1 .
docker push 663877906756.dkr.ecr.us-east-1.amazonaws.com/jude-bridge:v1
```

### Step 2: Create AgentCore Runtime
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

### Step 5: Wire jude-leads to call Router
Update `jude-leads` Lambda to POST to the new Router API after storing a lead.

### Step 6: End-to-end test
POST a test lead → jude-leads stores it → calls Router → AgentCore/OpenClaw triages → calls jude-notify-owner → delivers email/SMS.

---

## OTHER PENDING ITEMS (lower priority)

1. **SES production access** — re-apply or accept sandbox limits for now
2. **Set admin/config.yml backend.repo** to `mtecfix/johnson-legal-team`
3. **Commit any uncommitted changes** (blog images, recent code updates)
4. Google/social login: NOT set up (email/password only). Can add later.
5. api/ (old PHP endpoints) still present — revisit if migrating to serverless API

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

---

## KEY IDENTIFIERS (copy/paste reference)
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
