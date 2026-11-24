# KIRO SESSION RESUME — Johnson Legal Team
# Scan this file first when reopening the project.
# Current handoff: 2026-11-24
# Latest audit: PHP-COMPATIBILITY-AUDIT-2026-11-24.md
# Prior session notes: KIRO-SESSION-2026-11-20.md

> **Current source of truth:** the detailed handoff linked above and the live AWS/GitHub state. Sections below this current-session summary contain older project notes from July 2026 and must be treated as historical until reverified. Do not assume old credentials, resource states, URLs, deployments, or next steps are still current.

---

## CURRENT SESSION UPDATE — 2026-11-24

### PHP production compatibility audit
- Compared the branch reconstruction with the deployed PHP Lambda ZIP and live AWS configuration.
- Confirmed runtime compatibility targets: `provided.al2023`, handler `public/index.php`, Bref PHP 8.3 layer v25, `BREF_RUNTIME=fpm`.
- Confirmed all three DynamoDB table key schemas match the branch's current table access logic. Legal intake remains one item per email; client onboarding uses email + submission_id.
- Confirmed the deployed HMAC secret is JSON with an `hmac_secret` key; its value was not exposed.
- Confirmed the Cognito pool is invite-only and contains `admin` and `super_admin` groups.
- Confirmed the PHP API Gateway catch-all route has AuthorizationType `NONE` and no API Gateway authorizer. PHP handlers must enforce authorization for protected operations.
- Confirmed the Lambda role's scoped permissions cover the branch's required DynamoDB, SES, Cognito AdminCreateUser, and Secrets Manager calls.

### Additional branch changes
- Added an atomic `decision_processing` state to prevent competing approve/deny actions from creating an account before the winning decision is established.
- Same-action retries can resume after a partial Lambda failure; finalization is conditional and duplicate finalization is handled idempotently.
- Expanded PHP smoke tests to exercise production validators.
- Added `PHP-COMPATIBILITY-AUDIT-2026-11-24.md` with evidence, compatibility notes, and remaining blockers.
- Aligned the public registration page with the invite-only workflow: its form now submits contact details to the legal-intake step instead of requesting a password or expecting an authenticated session.
- Carried phone/address fields from registration into the legal intake and approved client profile.
- Reviewed the separate Node.js portal API: all application routes use Cognito JWT authorization; `/admin/*` additionally requires `admin` or `super_admin` group claims, and role changes require `super_admin`.
- Identified an integration gap: PHP approval writes to `jlt-user-profiles`, while the Node portal reads its own `johnson-legal-portal-PortalTable`; the portal admin registration queue also reads that separate table. Decide whether to add first-login profile completion or integrate the two workflows before production.
- Confirmed the deployed S3 website was inspected read-only; no production website objects were changed.

### Current status
- Branch: `fix/php-onboarding-security`.
- Branch comparison: `fix/php-onboarding-security` is ahead of `master` and 1 commit behind; branch is diverged and must be reconciled before merge. Check the live GitHub comparison for the current commit count.
- The previously observed PHP Actions run 7 passed for an earlier branch head. The newest approval-state-machine, registration-flow, test-suite, and documentation changes still need a confirmed CI run. The GitHub connector did not return a workflow run/status for these latest commits.
- No production AWS resources, tables, secrets, or live data were modified.
- No production deployment or merge is approved. Remaining blockers: confirm CI on the latest head, add approval/HMAC/DynamoDB tests, validate the exact Bref build/package, verify actual browser payloads and Cognito staff login, and prepare rollback/recovery procedures.
- **Read `PHP-COMPATIBILITY-AUDIT-2026-11-24.md` before continuing PHP deployment work.**

---

## HISTORICAL SESSION HANDOFF — 2026-11-20

### Repository and work branch
- Repository: https://github.com/mtecfix/johnson-legal-team
- Base branch: `master`
- Working branch: `fix/php-onboarding-security`
- Draft PR: https://github.com/mtecfix/johnson-legal-team/pull/3
- PR title: **Secure and recover the deployed PHP intake API**
- PR #3 is OPEN and DRAFT. It has not been merged or deployed.
- This session added a PHP API recovery/reimplementation baseline under `php-api/`, a PHP CI workflow, and frontend authentication/registration corrections.
- No production AWS resources or records were modified.

### AWS architecture verified in this session (region us-east-1)
Two separate JLT backend paths exist. Do not conflate them.

1. **Existing client portal**
   - CloudFormation stack: `johnson-legal-portal`
   - Node.js 20 Lambda, API Gateway HTTP API, Cognito User Pool, DynamoDB portal table.
   - The portal API has approximately 40 routes and a JWT authorizer attached to its protected routes.
   - The portal DynamoDB table contained 147 records at inspection. Do not read client records unless explicitly needed and authorized.

2. **PHP onboarding API**
   - CloudFormation stack: `jlt-php-api`
   - Lambda: `jlt-php-api`, runtime `provided.al2023`, handler `public/index.php`, 1024 MB, 28-second timeout; last modified 2026-11-17.
   - API Gateway HTTP API route: `ANY /api/{proxy+}`, Lambda proxy integration.
   - The route's API Gateway authorization type is `NONE`. A Cognito JWT authorizer exists on the API but was not attached to that catch-all route.
   - Backing tables: `jlt-client-onboarding`, `jlt-legal-onboarding`, `jlt-user-profiles`.
   - HMAC secret is in Secrets Manager; never print or commit its value.
   - These three tables had zero records at metadata inspection.
   - Lambda IAM policy is comparatively narrow: access to those three tables, the specific HMAC secret, SES sending under the firm sender address, Cognito AdminCreateUser on the JLT pool, and CloudWatch logging.

### Confirmed PHP/API security and workflow findings
- Public intake submission can be unauthenticated by design, but it must validate fields and disclosures server-side.
- The deployed `user-registration.php` accepted an email from the request body and created a profile without validating a Cognito access token or proving ownership of that email. This is an identity/authorization defect.
- The deployed browser `user-registration.js` called that endpoint without an Authorization header.
- The deployed approval token was an HMAC of email, intake type, and action only; it did not bind a unique submission ID or expiry.
- The deployed client approval path processed every pending intake for an email rather than one exact submission.
- The legal intake table is keyed by email and the deployed endpoint overwrote the latest intake for that email. The old approval-link design was therefore not safely bound to an individual submission.
- Browser `cognito-auth.js` called Cognito self-service `signUp`, although the inspected user pool is configured for administrator-created users. This is inconsistent with the deployed invite-only registration model.
- Browser role calculation also included hard-coded email allowlists. Server-side authorization must rely on signed Cognito group claims and backend authorization, not email strings or browser state.
- The PHP API catch-all route being unauthenticated at API Gateway is not, by itself, proof that every endpoint is public: inspect application middleware and each handler before concluding. The deployed profile endpoint issue above was confirmed from its handler source.
- Public S3 website buckets are for public site assets. Do not store confidential client documents in them.

### Changes made on the working branch
- Added `php-api/public/index.php`, `php-api/src/bootstrap.php`, Composer manifest, README, environment example, .gitignore, and smoke test.
- Added `.github/workflows/php-api-check.yml`.
- Changed `user-registration.js` to send the Cognito access token to the profile endpoint.
- Changed `cognito-auth.js` to remove self-service Cognito sign-up in favor of the invite-only intake flow and derive UI roles from Cognito group claims rather than email allowlists.
- Added submission-specific, expiring HMAC approval links in the PHP recovery baseline.
- Added server-side validation of legal intake acknowledgements.
- Added Cognito access-token verification and verified-email matching for profile creation.
- See PR #3 for the full diff and review notes.

### Critical qualification — PHP source is a recovery baseline, not yet a verified production replacement
- The deployed PHP package was inspected from the private SAM deployment bucket and relevant endpoint source was reviewed.
- The new `php-api/` implementation is a **reconstruction/reimplementation** based on the deployed routes, observed DynamoDB keys, environment variable names, and endpoint behavior. It is not a byte-for-byte recovery of the deployed source package.
- Its compatibility with the exact Bref runtime, existing HMAC secret JSON shape, Lambda event mapping, and all live table schemas has not yet been proven.
- Do not deploy this code to production or merge PR #3 until the build, integration tests, security review, and test-environment validation are complete.

### Verification status / where work stopped
- PR #3 is open as a draft; not merged.
- GitHub reported no commit status entries and no workflow runs were returned during this session. CI is therefore **not verified as passing**.
- No PHP runtime/build execution or end-to-end test against AWS was completed.
- No AWS write operations or production deployments were performed.
- Next technical steps, if resuming this work:
  1. Inspect the complete deployed PHP bootstrap/helpers and compare them with `php-api/src/bootstrap.php`.
  2. Confirm the deployed HMAC secret's JSON key/format without exposing the secret value.
  3. Verify Bref layer/runtime compatibility, request event mapping, and DynamoDB key schemas.
  4. Fix any source/CI issues and obtain a passing CI run.
  5. Deploy only to isolated test resources and test intake, approval, retries, expiry, Cognito invitation, and profile authorization.
  6. Have a human review the PR before merge and separately authorize any production deployment.

### Data handling
- The account contains multiple projects. Account-wide counts are not Johnson Legal Team resource counts.
- This session used resource metadata and selected source files only; it did not inspect client case files or DynamoDB client records.
- Never copy credentials, tokens, secret values, passwords, or personal client information into Markdown, Git, prompts, or logs.
- The older notes below contained a plaintext password; that literal has been removed. If that historical password was ever valid and remains in use, rotate it.

---

## HISTORICAL PROJECT NOTES (2026-07-13 AND EARLIER)
The remainder of this file is retained as historical context. Re-verify before acting on it.

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
  - johnsonlegalteam@gmail.com — CONFIRMED at the time (historical password details removed; verify current account state)

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
