# Client Portal Data API (serverless, isolated)

Status: ✅ **DEPLOYED AND LIVE** (stack: `johnson-legal-portal`, updated 2026-07-04)

## Why this is separate from the CMS

Site **content** (blog, practice areas, team, pages) is managed by Decap CMS
(git-based, in `/admin`, content in `/content`). That content is public and
low-risk.

**Client portal data** (cases, documents, invoices, messages, appointments) is
confidential attorney–client data. It is deliberately kept OUT of the CMS and
served by this separate, authenticated, serverless API so that a compromise of
the public content system cannot expose client data.

## Architecture (zero-cost serverless)

- Runtime: AWS Lambda (Node.js 20, arm64/Graviton) — `src/index.js`
- API: API Gateway HTTP API with a built-in Cognito JWT authorizer
        (verifies token signature against Cognito JWKS BEFORE the Lambda runs)
- Data store: DynamoDB, single-table, on-demand billing (scales to $0 idle)
- Auth: Cognito JWT (verified at the gateway); the Lambda enforces role +
        per-record ownership authorization
- IaC: AWS SAM (`template.yaml`)
- Secrets: AWS Secrets Manager only (never in repo / public bucket)

All three services (Lambda, HTTP API, DynamoDB) sit in AWS free/near-free
tiers for a solo-firm workload.

## Deploy

```bash
cd portal-api
sam build
sam deploy --guided     # first time; creates Cognito pool, API, table
```

This stack provisions a **dedicated Cognito user pool** (`johnson-legal-portal`),
an app client, `admin`/`super_admin` groups, the HTTP API (with the JWT
authorizer bound to that pool), and the DynamoDB table. No IDs are hardcoded —
they are created and cross-referenced within the stack.

### After deploy — wire the frontend (one file)

`sam deploy` prints Outputs. Copy them into `portal-config.js` at the repo root:

| SAM Output        | portal-config.js field         |
|-------------------|--------------------------------|
| `UserPoolId`      | `COGNITO_USER_POOL_ID`         |
| `UserPoolClientId`| `COGNITO_CLIENT_ID`            |
| `ApiUrl`          | `window.PORTAL_API_BASE`       |
| `Region`          | `COGNITO_REGION`               |

Load `portal-config.js` before `cognito-auth.js` / `portal-api-client.js` on
portal pages.

### Create the first admin user

Accounts are admin-created (invite-only). After deploy:

```bash
aws cognito-idp admin-create-user --user-pool-id <UserPoolId> \
  --username you@example.com --user-attributes Name=email,Value=you@example.com
aws cognito-idp admin-add-user-to-group --user-pool-id <UserPoolId> \
  --username you@example.com --group-name super_admin
```

## Test (no AWS needed)

```bash
cd portal-api/src
node --test             # unit tests for the pure helpers
```

## Planned entities (bones)

| Entity        | Key fields                                             |
|---------------|--------------------------------------------------------|
| user_profiles | id, cognito_sub, email, first_name, last_name, role    |
| cases         | id, client_id, title, status, attorney, next_court_date|
| documents     | id, case_id, client_id, name, category, s3_key         |
| messages      | id, case_id, client_id, sender_id, subject, body       |
| invoices      | id, client_id, description, amount, status, due_date    |
| appointments  | id, client_id, case_id, title, date, meeting_type      |
| notifications | id, client_id, type, message, read_at                  |

## Live Outputs

| Output | Value |
|--------|-------|
| UserPoolId | `us-east-1_dqqgSRKwn` |
| UserPoolClientId | `1ceidj2abdvs0jijedhckte5um` |
| ApiUrl | `https://2hp2bdxsz6.execute-api.us-east-1.amazonaws.com` |
| Region | `us-east-1` |
| TableName | `johnson-legal-portal-PortalTable-BSDJNMA75SSQ` |

## Current CORS Configuration

**Origin:** `https://d1rqv10nry9s54.cloudfront.net` ⚠️ (dead — CloudFront creation failed)

**To fix:** Redeploy with the correct origin:
```bash
cd portal-api
sam build && sam deploy --stack-name johnson-legal-portal \
  --s3-bucket johnson-legal-sam-deploy-663877906756 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides CorsOrigin=https://mtecfix.github.io \
  --region us-east-1
```

## Remaining Work

1. ⚠️ Fix CORS to match actual hosting URL (GitHub Pages or Netlify)
2. Complete first admin login (currently FORCE_CHANGE_PASSWORD)
3. Set `admin/config.yml` backend.repo to `mtecfix/johnson-legal-team`
4. Onboard real client data
