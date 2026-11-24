# JLT PHP Compatibility Audit — 2026-11-24

## Scope and safety

This audit compared the version-controlled reconstruction on `fix/php-onboarding-security` with the deployed PHP Lambda package and live AWS configuration in `us-east-1`.

- Read-only inspection only; no AWS resources or production data were changed.
- The deployed Lambda ZIP was inspected for source files. No client intake/profile records were read.
- The HMAC secret's JSON structure and key length were checked, but its value was not displayed or copied.
- This document is an engineering compatibility review, not a production deployment approval.

## Deployed runtime and infrastructure

| Setting | Observed production value | Branch compatibility |
|---|---|---|
| Lambda | `jlt-php-api` | Target function matches |
| Runtime | `provided.al2023` | Compatible target |
| Handler | `public/index.php` | Branch entry point matches |
| PHP layer | Bref PHP 8.3 layer, version 25 | Runtime target matches |
| Bref runtime mode | `fpm` | Documented/expected |
| API Gateway | HTTP API `lpkyw27bm0` | Same API |
| API route | `ANY /api/{proxy+}` | Routes are dispatched by PHP front controller |
| Cognito pool | `johnson-legal-portal` | Same pool ID in Lambda environment |
| Profile table | `jlt-user-profiles`, partition key `email` | Matches |
| Legal intake table | `jlt-legal-onboarding`, partition key `email` | Matches; latest submission per email |
| Client onboarding table | `jlt-client-onboarding`, partition key `email`, sort key `submission_id` | Matches |
| HMAC secret | JSON object with `hmac_secret`; 64-character value | Branch expects the same JSON key; secret value intentionally not disclosed |

The Lambda environment variables used by the branch match the deployed names: `TABLE_USER_PROFILES`, `TABLE_LEGAL_ONBOARDING`, `TABLE_CLIENT_ONBOARDING`, `HMAC_SECRET_ARN`, `COGNITO_USER_POOL_ID`, `ADMIN_EMAILS`, `FROM_EMAIL`, and `SITE_URL`.

## Cognito and IAM compatibility

- The user pool is configured for administrator-created users (`AllowAdminCreateUserOnly=true`), with email as the username and email auto-verification.
- The pool contains `admin` and `super_admin` groups. The browser role-routing update reads Cognito group claims rather than granting staff roles from email allowlists.
- The app client supports password/SRP and refresh-token authentication. It does not have hosted-UI OAuth flow/callback settings configured in the observed client metadata; any Google OAuth flow in the browser therefore needs separate validation and should not be treated as verified.
- The Lambda role grants DynamoDB GetItem/PutItem/UpdateItem/Query on the three JLT tables, SES SendEmail constrained to the firm's sender address, Cognito AdminCreateUser on this pool, and Secrets Manager GetSecretValue on the HMAC secret.
- Cognito `GetUser` is called using the caller's Cognito access token; it is not an IAM-authorized admin operation. The branch does not require an added IAM permission for it.

## API Gateway exposure

The HTTP API has one catch-all route, `ANY /api/{proxy+}`, with `AuthorizationType=NONE`; there are no API Gateway authorizers attached and no API Gateway CORS configuration.

This is consistent with public intake routes, but it means security must be enforced in PHP for every non-public operation. The branch does this for profile registration by requiring a Cognito access token and checking the verified email with Cognito `GetUser`. The approval endpoint relies on a signed, expiring, submission-bound HMAC token. There are currently no general-purpose admin/case-management routes in this reconstructed PHP front controller.

The branch emits CORS headers in PHP for the configured firm website origins. CORS is a browser policy, not authentication or authorization; direct HTTP clients can still call public intake routes.

## Deployed-package comparison

The deployed ZIP contained these application sources:

- `public/index.php`
- `src/config.php`
- `src/endpoints/user-registration.php`
- `src/endpoints/legal-onboarding.php`
- `src/endpoints/onboarding.php`
- `src/endpoints/approve-registration.php`
- `src/endpoints/health.php`

Confirmed differences addressed by the branch:

1. The deployed profile endpoint trusted the submitted email and did not validate a Cognito access token. The branch validates the token with Cognito and requires a verified matching email.
2. The deployed approval HMAC covered only email, intake type, and action. The branch adds the exact submission ID and expiry.
3. The deployed client approval handler queried and updated all pending submissions for an email. The branch binds approval to one composite key (`email` + `submission_id`).
4. The deployed legal intake table is keyed only by email and stores the latest intake. The branch preserves that schema, adds a submission ID attribute, and rejects stale links when the stored ID no longer matches.
5. The deployed frontend attempted Cognito self-service registration even though the pool is invite-only. The branch changes this to an intake-and-review flow.
6. The branch's profile-registration browser request now sends the Cognito access token.

## Browser form compatibility check

The deployed static site was also inspected read-only. The public `user-registration.html` form uses `clientRegistrationForm`, but its original JavaScript listened for `userRegistrationForm` and expected an already-authenticated session. The page itself is a new-client form and is not a signed-in profile-completion page. It also asked applicants to create a password even though Cognito is invite-only. This mismatch would prevent the intended registration flow from working reliably.

The branch now:
- Binds the public registration script to the actual `clientRegistrationForm` element.
- Removes password collection from the pre-approval registration page.
- Saves the applicant's contact details and selected legal matter in session storage, then routes to the legal intake.
- Prefills the legal matter and case description on the legal intake page.
- Carries phone/address fields into the intake request and writes them to the profile when the firm approves the submission.
- Maps legacy registration-page matter values (traffic tickets, expungements, misdemeanors) to values accepted by the legal intake API.

The live S3 website files were not changed. These are branch-only fixes pending review and deployment.

## Additional remediation made during this audit

The branch's approval sequence previously performed Cognito user creation and profile creation before conditionally updating the intake decision. A competing approve/deny request could therefore create an account even if the opposite decision won the status update.

The branch now uses a conditional `decision_processing` state:
- A pending submission is atomically claimed for either approve or deny.
- A competing opposite action cannot claim the same submission.
- Repeated requests for the same action can resume after a partial Lambda failure.
- The final status update is conditional on the same action's processing claim.
- Duplicate same-action finalization is treated as idempotent when the record already has the expected final status.

If an invocation fails after claiming a decision, retry the same signed link while it remains valid. An item left in `decision_processing` after the link expires requires an administrative recovery procedure; do not manually edit production records without a reviewed runbook.

## Existing Node.js portal authorization review

The separate Node.js portal API was checked at the API Gateway and source level:

- The HTTP API has 40 routes. All application routes use the Cognito JWT authorizer; only `OPTIONS` preflight routes use `AuthorizationType=NONE`.
- The JWT authorizer is configured with the JLT Cognito issuer and the portal app-client audience.
- The reviewed portal handler reads claims from API Gateway's verified JWT context, derives the role from the signed `cognito:groups` claim, and rejects requests without a subject.
- The handler requires `admin` or `super_admin` for `/admin/*` routes. Role changes under `/admin/users` require `super_admin`.
- Client record reads/writes are partitioned by the authenticated Cognito subject, not a browser-supplied email or user ID.

No obvious missing route-level JWT or admin-group gate was found in this review. The Lambda deployment ZIP itself could not be read from its snapshot bucket due to AccessDenied, so the inspected `portal-api/src/index.js` source mirror was not byte-compared with the deployed package. This is a source-level review, not a penetration test.

## Cross-backend onboarding integration gap

The PHP intake workflow and the Node.js client portal currently maintain separate registration/profile data:

- PHP approval writes the intake decision to `jlt-legal-onboarding` or `jlt-client-onboarding`, creates a Cognito user, and writes a profile to `jlt-user-profiles`.
- The Node.js portal API uses the separate `johnson-legal-portal-PortalTable`, keyed by Cognito subject (`USER#<sub>`) and `PROFILE`.
- The portal's `GET /profile` reads only that Node.js table. The client dashboard displays "No profile on file yet" when it is empty.
- The Node.js `GET /admin/registrations` handler queries its own table's `GSI1PK = REG#pending`; it does not read the PHP intake tables.
- Therefore, email-based PHP approval does not automatically populate the Node.js portal profile or the Node.js admin registrations queue. This is a workflow integration gap, not a missing JWT check.

Before deployment, choose the intended system of record:
1. Keep email approval as the canonical intake workflow and add a first-login profile-completion step that writes to the Node.js `/profile` API; or
2. Integrate PHP approval with the Node.js portal table and admin registration workflow, with explicitly scoped IAM permissions and tested idempotency.

The current branch does not make that cross-backend integration and must not be represented as a fully integrated client portal onboarding flow.

## Validation status

- The PHP GitHub Actions workflow ran successfully for the earlier branch head (run 7). The approval state-machine and test-suite changes made during this audit were committed afterward; a new CI run must be confirmed before treating the current head as passing.
- The smoke test was expanded to exercise the actual production validators (legal matter, urgency, email normalization, required fields, field length, and HTML escaping). It is still a smoke suite, not a complete unit/integration suite.
- CI was changed to PHP 8.3 to match the deployed Bref runtime. The repository does not yet contain a Composer lock file, so dependency resolution is not fully reproducible; generate and commit `composer.lock` in a network-enabled build environment before production packaging.
- No end-to-end test was run against the live API, Cognito, SES, or DynamoDB.
- No Lambda package was built from this branch and compared byte-for-byte with the deployed package.
- No production deployment was performed.

## Remaining blockers before merge/deploy

1. Confirm CI passes on the latest branch head.
2. Add tests for the approval state machine, HMAC expiry/signature, and DynamoDB conditional behavior using mocks/local test doubles.
3. Generate/commit `composer.lock`, then validate the exact Bref PHP 8.3 layer packaging and Composer vendor output with a reproducible build.
4. Validate the actual browser payloads for both intake forms and the registration flow.
5. Confirm Cognito admin-group assignment and staff sign-in behavior. Hosted UI / Google OAuth is not verified by the observed app-client configuration.
6. Decide whether legal intake should remain one record per email or migrate to a composite key like client onboarding. Current branch intentionally preserves the live email-only key.
7. Decide and implement the PHP-to-Node portal registration/profile integration described above.
8. Review the PHP endpoint exposure and the separate Node.js portal's server-side authorization before any production security sign-off.
9. Prepare a rollback plan and obtain explicit approval before any production deployment.

**Current disposition: suitable for continued branch-level testing; not approved for production merge or deployment yet.**
