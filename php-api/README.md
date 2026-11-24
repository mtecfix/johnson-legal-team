# Johnson Legal Team PHP intake API

This directory is the version-controlled recovery and remediation baseline for the PHP Lambda currently deployed as `jlt-php-api`. It is deliberately separate from the static website and from the existing Node.js authenticated client portal.

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Runtime health only |
| `/api/legal-onboarding.php` | POST | Public legal intake; requires all four disclosure acknowledgements |
| `/api/onboarding.php` | POST | Public client onboarding submission |
| `/api/user-registration.php` | POST | Creates the signed-in user's own profile; requires Cognito access token |
| `/api/approve-registration.php` | GET / POST | GET displays confirmation; POST applies the decision |

## Security changes in this baseline

- Approval HMAC binds the email, intake type, action, unique submission ID and 48-hour expiry.
- A link is accepted only while its exact submission is pending or the same decision is already processing. A conditional DynamoDB claim prevents competing approve/deny actions; same-action retries can resume after a partial failure.
- Client onboarding approval addresses one submission, not every pending submission for an email address.
- Approval first atomically claims the submission as `decision_processing`, then provisions Cognito/profile state, then conditionally finalizes the decision. Same-action retries can resume after partial failure; competing opposite actions cannot claim the record. Existing Cognito usernames and profile records are handled idempotently.
- Legal disclosure acknowledgements are validated server-side; browser checkbox validation is not trusted.
- Profile creation verifies the Cognito access token with Cognito `GetUser`, requires a verified matching email, and always assigns the client role. Browser-supplied role values are ignored.
- CORS is restricted to configured origins. Responses are not cacheable.
- Intake records are persisted before SES delivery. If SES fails, the API returns HTTP 202 with a warning rather than falsely reporting that the saved intake was lost.

## Environment variables

Required: `TABLE_USER_PROFILES`, `TABLE_LEGAL_ONBOARDING`, `TABLE_CLIENT_ONBOARDING`, `HMAC_SECRET_ARN`, `COGNITO_USER_POOL_ID`.

Optional: `AWS_REGION` (default `us-east-1`), `SITE_URL` (default `https://johnsonlegalteam.org`), `CORS_ORIGINS`, `ADMIN_EMAILS`, `FROM_EMAIL`.

The Secrets Manager secret referenced by `HMAC_SECRET_ARN` must contain JSON with an `hmac_secret` value of at least 32 characters. Never commit secret values.

## Build and verification

```bash
cd php-api
composer validate --strict
composer install --no-interaction --prefer-dist
php -l public/index.php
php -l src/bootstrap.php
php tests/smoke.php
```

The deployed Lambda was inspected on 2026-11-24: runtime `provided.al2023`, handler `public/index.php`, Bref PHP 8.3 layer v25, and `BREF_RUNTIME=fpm`. The deployment layer/runtime and Lambda handler must remain aligned with that Bref PHP-FPM layer. The current production function uses `provided.al2023` and the handler path `public/index.php`. Do not deploy this branch until the package has been built, tested against the deployed Bref layer, and reviewed against the live DynamoDB key schemas and Cognito configuration.

## Important migration notes

- `legal_onboarding` is keyed by `email`; this implementation stores the latest submission ID in that item so stale links stop matching after a later intake.
- `client_onboarding` is keyed by `email` + `submission_id`; each approval link is scoped to that composite key.
- `user_profiles` is keyed by `email`.
- The public intake endpoints intentionally remain unauthenticated. The profile endpoint is not public in practice: it requires a Cognito access token and verifies the caller at Cognito.
- The browser's registration form must not call Cognito `signUp`, because the deployed pool is administrator-created/invite-only. The updated frontend now collects an intake and lets the firm approve before Cognito provisions the account.
- No AWS resource is modified by committing these files. Production deployment is a separate, explicitly approved step.


## Compatibility audit

See [PHP-COMPATIBILITY-AUDIT-2026-11-24.md](../PHP-COMPATIBILITY-AUDIT-2026-11-24.md) for the read-only comparison against the deployed Lambda ZIP, API Gateway route, Cognito pool, IAM policy, Secrets Manager format, and DynamoDB key schemas. That audit does not authorize a production deployment. Confirm CI on the latest branch head and complete the listed tests before merge/deploy.
