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

## Intended architecture (to be confirmed before build)

- Runtime: AWS Lambda (Node.js) behind API Gateway
- Data store: DynamoDB (single-table or per-entity) — NOT the public S3 bucket
- Auth: Amazon Cognito JWT, verified server-side against the Cognito JWKS
        (full signature verification — do not trust unverified claims)
- Authorization: role checks (client / admin / super_admin) enforced in the
        Lambda, plus per-record ownership checks (client_id == caller)
- Secrets: AWS Secrets Manager only (never in repo / never in public bucket)

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

1. Confirm DynamoDB vs RDS for the data store.
2. Define the IaC (SAM/CDK/Serverless Framework).
3. Implement Cognito JWKS verification middleware.
4. Implement handlers per entity with authz + ownership checks.

See `openapi.yaml` for the draft endpoint contract.
