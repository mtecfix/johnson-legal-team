# Deploying the Johnson Legal Team site over HTTPS ($0)

CloudFront is currently disabled on this AWS account (needs AWS Support account
verification). Until that clears, use one of the free HTTPS hosts below. Both
serve the static site over real TLS — required because the login page handles
passwords + MFA codes.

The backend (API, Cognito, DynamoDB) is already deployed and live. Only the
static frontend needs a secure home, plus a one-line CORS update so the browser
can call the API from the new domain.

---

## Option A — Netlify (simplest)

1. Push this repo to GitHub (see below).
2. On netlify.com: "Add new site" → "Import from Git" → pick the repo.
3. Build settings are read from `netlify.toml` (publish = repo root, no build).
4. Deploy → you get `https://<name>.netlify.app`.

## Option B — GitHub Pages

1. Push this repo to GitHub.
2. Repo → Settings → Pages → Source = "GitHub Actions".
3. The workflow `.github/workflows/deploy-pages.yml` runs on push to `main`
   and publishes to `https://<user>.github.io/<repo>/`.
   (It excludes `portal-api/`, `_archive/`, `api/`, and secret files.)

---

## Push to GitHub (either option)

```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Also set the real repo in `admin/config.yml` (`backend.repo`) for the CMS.

---

## After the site has an HTTPS URL — update API CORS (required)

The API only accepts browser calls from an allowed origin. Point it at the new
HTTPS domain (replace the URL):

```bash
cd portal-api
aws cloudformation deploy \
  --template-file <(aws cloudformation package \
      --template-file template.yaml \
      --s3-bucket johnson-legal-sam-deploy-663877906756 \
      --s3-prefix packaged --output-template-file /dev/stdout) \
  --stack-name johnson-legal-portal \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides CorsOrigin=https://<your-new-domain> \
  --region us-east-1
```

Then update `portal-config.js` only if the API URL changes (it will not).
The Cognito `RedirectUri` in `cognito-auth.js` derives from the browser origin
automatically, so it needs no edit for email/password login.

---

## When CloudFront is later enabled (optional, stays on AWS)

Create an Origin Access Control + distribution in front of `johnsonlegalteam-www`,
lock the bucket policy to the distribution, and set `CorsOrigin` to the new
`*.cloudfront.net` (or a custom domain). The static files are already in the
bucket.
