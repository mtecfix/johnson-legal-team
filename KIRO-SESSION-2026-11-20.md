# Johnson Legal Team — Kiro Session Handoff
**Session date:** 2026-11-20  
**Purpose:** Preserve the work completed in this session and the exact point at which development paused.

> Start here when resuming. The top-level `KIRO-RESUME.md` points to this handoff. This document records findings and changes from one session; it is not authorization to deploy or modify production.

## 1. GitHub state

- Repository: [mtecfix/johnson-legal-team](https://github.com/mtecfix/johnson-legal-team)
- Base branch: `master`
- Work branch: `fix/php-onboarding-security`
- Draft pull request: [#3 — Secure and recover the deployed PHP intake API](https://github.com/mtecfix/johnson-legal-team/pull/3)
- PR status at handoff: open, draft, not merged.
- Latest commit recorded in this session: `1286bede846ccf96e6ed6aac63255bca6a569de0` (Kiro resume update).
- No production AWS changes were made.

## 2. AWS resources inspected

All relevant JLT resources found in this inspection were in `us-east-1`. The AWS account also hosts unrelated projects; account-wide totals must not be described as JLT totals.

### Existing Node.js client portal
- CloudFormation stack: `johnson-legal-portal`
- API Gateway HTTP API with about 40 routes.
- Lambda: Node.js 20.
- Cognito User Pool: `us-east-1_dqqgSRKwn`.
- DynamoDB portal table: `johnson-legal-portal-PortalTable-BSDJNMA75SSQ`.
- JWT authorizer is attached to protected portal routes.
- Table metadata showed 147 records at inspection. No record contents were read.

### PHP onboarding API
- CloudFormation stack: `jlt-php-api`.
- Lambda: `jlt-php-api`, custom runtime `provided.al2023`, handler `public/index.php`, 1024 MB memory, 28-second timeout; last modified 2026-11-17.
- API Gateway HTTP API: catch-all `ANY /api/{proxy+}` route to the PHP Lambda.
- API Gateway route authorization type: `NONE`. A Cognito JWT authorizer exists on the API but was not attached to the catch-all route.
- DynamoDB tables: `jlt-client-onboarding`, `jlt-legal-onboarding`, `jlt-user-profiles`.
- HMAC secret stored in Secrets Manager. Do not retrieve or expose its value.
- The three table metadata counts were zero at inspection.
- Lambda IAM policy was scoped to the three JLT tables, the HMAC secret, Cognito AdminCreateUser on the JLT pool, SES sending under the firm's sender address, and CloudWatch logging.

### Website storage
- Public static-site buckets include `johnsonlegalteam-www` and `johnsonlegalteam.org`.
- These are public website origins. They are not a suitable private client-document vault.
- The deployment bucket `johnson-legal-sam-deploy-663877906756` is private.
- Do not place confidential legal/client records in public website buckets.

## 3. Confirmed findings from deployed PHP and browser source

The deployed PHP package was retrieved from the private SAM deployment bucket. Selected PHP endpoints and browser JavaScript were inspected. No DynamoDB client records were read.

1. **Profile ownership was not verified in the deployed PHP handler.** The deployed `user-registration.php` accepted an email from the request body and created a profile without verifying a Cognito access token or proving control of that email.
2. **The browser did not send a bearer token.** The deployed `user-registration.js` called `api/user-registration.php` with only a JSON content-type header.
3. **Approval tokens were not submission-specific or time-limited.** The deployed approval HMAC bound email, intake type, and action, but not a submission ID or expiry.
4. **Client approval could affect multiple submissions.** The deployed approval handler queried and updated every pending client onboarding record for the email rather than a single exact submission.
5. **Legal intake overwrote the one-per-email record.** The legal table key was email; the intake endpoint upserted the latest submission. The old approval link was not bound to that exact submission.
6. **Registration flow conflicted with Cognito configuration.** The browser called Cognito self-service `signUp`, while the inspected pool was configured for administrator-created users.
7. **Browser role calculation trusted email allowlists.** UI role decisions included hard-coded email checks. Server authorization should be based on verified Cognito group claims and server-side authorization, not an email string or sessionStorage.
8. **Catch-all API Gateway authorization needs endpoint-by-endpoint review.** The route is unauthenticated at API Gateway, but application middleware can still enforce authorization. Do not conclude that every endpoint is publicly exploitable without reviewing its handler and middleware.

## 4. Files changed on the working branch

### New PHP recovery/reimplementation baseline
- `php-api/public/index.php`
- `php-api/src/bootstrap.php`
- `php-api/composer.json`
- `php-api/.env.example`
- `php-api/.gitignore`
- `php-api/README.md`
- `php-api/tests/smoke.php`

### CI
- `.github/workflows/php-api-check.yml`

### Browser corrections
- `user-registration.js`: now sends the Cognito access token to the profile endpoint.
- `cognito-auth.js`: removes the self-service sign-up call in favor of the invite-only intake path; derives the UI role from Cognito group claims rather than email allowlists.

### Kiro handoff
- `KIRO-RESUME.md`: refreshed with current-session status and a pointer to this file.
- `KIRO-SESSION-2026-11-20.md`: this detailed handoff.

## 5. Critical qualification: PHP code is not yet production-ready

The `php-api/` directory is a **reconstruction/reimplementation**, not a byte-for-byte recovery of the deployed PHP package. It was written based on inspected endpoint behavior, observed table keys, route names, and environment-variable names.

Before it can replace production code, verify:
- Exact Bref layer and custom runtime behavior.
- Lambda event/request mapping and availability of expected server variables.
- Full deployed bootstrap/helper implementation and endpoint routing.
- Existing HMAC secret JSON structure (inspect only the key names/format; never print the value).
- Actual DynamoDB key schemas and attribute expectations.
- IAM policy permissions against every operation in the replacement.
- Composer dependencies, PHP extensions, syntax, and CI.
- SES failure handling and retry behavior.
- Cognito invitation behavior and profile idempotency.

The current code has not been deployed or tested end-to-end against AWS. Do not merge or deploy it until these checks are complete.

## 6. CI and PR status at pause

- Draft PR #3 was created successfully.
- A PHP GitHub Actions workflow was added.
- GitHub returned no workflow runs and no commit status entries during the session. CI is **not confirmed passing**.
- No PHP build was executed in a local or remote runtime during this session.
- No end-to-end test against AWS was executed.
- PR is not merged. Production AWS remains unchanged.

## 7. Recommended next steps if resuming this backend task

1. Retrieve and inspect the complete deployed PHP ZIP source, especially the bootstrap/helper file and router.
2. Compare deployed source to `php-api/`; resolve behavior and schema differences.
3. Verify the secret's JSON key/format without revealing its secret value.
4. Run Composer validation, PHP syntax checks, and smoke tests; obtain a passing GitHub Actions run.
5. Deploy only to isolated test resources.
6. Test public legal intake, disclosure validation, email delivery, approval/denial, expired/replayed links, repeated submissions, Cognito invitation, and profile creation with a verified token.
7. Review and approve PR #3 before merge.
8. Treat production deployment as a separate action requiring explicit authorization.

## 8. Session safety boundary

- Read-only inspection was used for AWS resource metadata and selected source artifacts.
- No AWS infrastructure, Lambda function, Cognito user, DynamoDB item, secret, S3 object, or production site was modified.
- No client/case records were inspected.
- Never commit passwords, API tokens, OAuth tokens, HMAC secrets, private client data, or other credentials.
- Older content in `KIRO-RESUME.md` is historical and must be revalidated before use.
