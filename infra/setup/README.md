# Manual setup, recorded

Most of the site is rebuilt from this repo by the deploy scripts:

| What | Rebuilt by |
|---|---|
| Website files in the `johnsonlegalteam.org` S3 bucket | `.github/workflows/deploy-s3.yml` (push to `production`) |
| A/B/C/D split Worker | `tools/worker/deploy.sh preview\|live` |
| `/api/*` proxy Worker | `tools/api-proxy/deploy.sh` |
| PHP form API (Lambda, DynamoDB, approval-link secret) | `backend/php-api/infra/deploy.sh` (CloudFormation stack `jlt-php-api`) |

Everything else was set up by hand once. `setup.sh` records those settings in `desired/` and can recreate them.

| Item (`desired/` file) | What it is |
|---|---|
| `s3.json` | Bucket versioning (on), website hosting (`index.html`, `404.html`), public-read policy |
| `oidc.json` | Lets GitHub Actions sign in to AWS without stored keys |
| `role-jlt-site-plan.json` | Read-only AWS role the deploy plan step uses (list the bucket) |
| `role-jlt-site-deploy.json` | Write role used only after approval (upload/delete site files, read purge token) |
| `purge.json` | Facts about the Cloudflare cache-purge token in `johnsonlegalteam/cloudflare-purge` (the token itself is never stored in git) |
| `github.json` | GitHub `production` environment: required reviewer, which branch/tags may deploy; `production` branch can't be force-pushed or deleted |
| `cf-rule.json` | Cloudflare rule that serves `/page` as `/page.html` (skips `/`, `/admin`, folders and `api/`) |
| `routes.json` | Cloudflare Worker routes for the six test pages and `/api/*` |

## Use

Run from a machine with AWS admin credentials, `curl` and `jq` (the worker server works for everything except creating IAM/CloudFormation resources).

```bash
infra/setup/setup.sh check            # live == recorded? exits 1 and shows the difference if not
DRY_RUN=1 infra/setup/setup.sh apply  # preview what would be changed
infra/setup/setup.sh apply            # recreate/repair only the items that differ
infra/setup/setup.sh record           # after an intentional manual change: save it, then commit
```

Notes:
- `apply` for `purge` creates a **new** Cloudflare token and overwrites the secret; the old token keeps working until revoked in Cloudflare.
- `apply` for `routes` only adds missing routes. Worker code and the split mode (`preview`/`live`) are set by the deploy scripts above.
- Secrets used: `metrotec/github-token`, `cloudflare/api-token` (read), `johnsonlegalteam/cloudflare-purge` (read/write). None are printed.
- Not covered: DNS records in Cloudflare and the domain registration at Spaceship.
