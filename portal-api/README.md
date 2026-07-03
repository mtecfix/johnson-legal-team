# Client Portal Data API (serverless, isolated)

Status: SCAFFOLD / BONES ONLY — no business logic implemented yet.

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

## Next steps (not yet done)

1. Set the real GitHub repo in `admin/config.yml` and pick a CMS auth option
   (see `admin/SETUP.md`).
2. `sam deploy --guided` to stand up the stack.
3. Add admin/super-admin endpoints (currently client-scoped only).
4. Wire the portal frontend to the deployed API URL.
