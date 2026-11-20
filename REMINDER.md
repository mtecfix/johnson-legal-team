# REMINDER — Johnson Legal Team (JLT)

> **Repo and mirror only. Never published to the bucket.** This file is listed in `deploy/exclude.txt`.
> The live bucket `johnsonlegalteam.org` changes only through `.github/workflows/deploy-s3.yml`
> (push to `production`, then approval). Do not scan, sync or edit the bucket as part of a folder or mirror scan.
>
> Last reviewed: 2026-11-20. Items marked *(per Jul 13 notes)* come from older docs and need re-checking.

## Things to remember

- **Live site:** https://johnsonlegalteam.org. S3 bucket `johnsonlegalteam.org`, fronted by Cloudflare.
- **Deploy branch:** `production`. The GitHub default branch is still `master`.
- **Deploys:** a normal push only adds or updates files and never deletes. Deleting needs an `s3-prune-*` tag.
- **Rollback:** bucket versioning is on. Revert on `production`, or restore the earlier object version.
- **Mirror check on 2026-11-20:** the bucket matched a fresh build of commit `734b4c0` (141 files, 0 differences).
- **Repo is private** (changed 2026-11-20). GitHub Pages is off, so `mtecfix.github.io/johnson-legal-team` returns 404.
- **Worker server copy:** `/home/ec2-user/jl-work/jlt-mirror` on metrotec-worker. It pulls through
  `/usr/local/bin/git-credential-sm`, which reads secret `metrotec/github-token` at call time. No token is stored on disk.
  The older `/home/ec2-user/jl-work/jlt` clone has no credentials set up.
- **Do not put passwords, tokens or keys in this repo.** Refer to Secrets Manager secrets by name only.

## Security (do first)

- [x] **Firm portal password rotated 2026-11-20.** The new value is only in Secrets Manager (`johnsonlegalteam/portal-firm-credentials`;
      delete that secret once handed over). The old value was removed from `KIRO-RESUME.md` on production, master, sandbox-variants,
      bucket-mirror and fix/header-logo-left-spacing-25px. It is still in git history, and in the two draft-PR branches until they merge.
      Decide whether to rewrite history. Enable TOTP MFA on that account.
- [ ] **Scan git history for other secrets** (the repo was public).
- [ ] **Replace `metrotec/github-token`** with a fine-grained token: this repo only, Contents read-only.
      The server picks it up automatically.
- [ ] **Review public pages in the bucket:** `google-oauth-setup.html` is a developer page (the mobile plan says it should
      not be public), and `admin-ab/*`, `admin/lead-setup/*` and `admin/payment-setup/*` are live prototype or setup pages.
- [ ] Confirm the Decap CMS GitHub login still works now that the repo is private.

## Unfinished systems

### Jude AI agent (Bedrock AgentCore) — blocked *(per Jul 13 notes)*
- [ ] Open an AWS Support case to activate AgentCore. Quotas were 0: `L-F4575653` (agents), `L-0A9E32B3` (image size),
      `L-9B442722` (endpoints), `L-3E5722B2` (sessions). A normal Service Quotas request is rejected.
- [ ] Then: create runtime `judeRuntime` (no hyphens), create an endpoint, deploy the `JudeRouter` stack,
      wire `jude-leads` to the router, run an end-to-end test.
- [ ] Re-check the current quota state first. Nothing has been verified since Jul 13.
- [ ] `jude/deepseek-api-key` fallback needs prepaid credit.

### Email
- [ ] SES is still in sandbox (checked 2026-11-20). Production access was denied *(per Jul 13 notes)*.
      Only verified recipients can receive mail.

### Admin dashboard and portal modules
- [ ] Documents: "coming soon" in `admin-dashboard.html`. Planned: file upload to S3, e-signature.
- [ ] Payments and invoices: Stripe integration marked "coming soon" / planned.
- [ ] `admin-ab/` prototypes still contain TODO placeholders for: leads (HubSpot or `jude-leads`), cases, clients,
      calendar (Google Calendar or Calendly), documents, messages (SignalWire SMS + SES), invoices, payments,
      registrations, users, health dashboard.
- [ ] `filing-tracker` (MiFILE monitoring) is planned and not built.

### PHP backend
- [ ] Registration and `pay-invoice.html` post to `api/*.php`. The old `api/` folder is dead code.
      Commit `ab37c00` added a Bref PHP backend (`backend/php-api`) plus an API proxy Worker. Confirm what is actually deployed.

### Phone (SignalWire)
- [ ] Number (833) 659-8378 forwards to the owner's cell. Toll-free SMS is unverified, so no texting yet.
- [ ] The "Johnson Legal Team" call-flow (IVR) is built but not assigned to the number.
- [ ] The API token lacks Numbers and Messages scopes.

### Mobile site plan
- [ ] Status: plan only, not started. Owner approval is needed before Phase 2 ships to the bucket (`docs/MOBILE-SITE-PLAN.md`).
- [ ] Known issues listed there: desktop header overflow at 992 to 1199 px, 12 pages without the chat widget,
      some pages missing `preview-style.css`.
- [ ] GA4 measurement ID: stored in Secrets Manager as `metrotec/google-analytics-measurement-id`. Confirm it is wired into the pages.

## Placeholders still live on the site (found by `deploy/check_site.py`, 0 failures, 8 warnings)

- [ ] `pay-invoice.html`: `YOUR_STRIPE_PUBLISHABLE_KEY` and `YOUR_PAYPAL_CLIENT_ID`. Online invoice payment cannot work until these are set.
- [ ] `cognito-auth.js` and `portal-api-client.js`: `REPLACE_AFTER_DEPLOY`. Check that sign-in and API calls work as deployed.
- [ ] `admin/payment-setup/stripe-links.html`: `your-unique-link-here`.
- [ ] `google-oauth-setup.html`: `yourdomain.com`.
- [ ] `admin-ab/admin-ab-a.html` (`YOUR_LINK`) and `admin-ab/admin-ab-b.html` (`YOUR_SLUG`): Calendly placeholders.

## Cleanup

- [ ] Stale CloudFront URL `d1rqv10nry9s54.cloudfront.net` in `.env.example`, `admin/config.yml`, `docs/AUTH_FLOW.md`,
      `portal-api/template.yaml`, `lambda/registration_approver.py`. Replace with `https://johnsonlegalteam.org` or remove.
- [x] Portal API and Jude API CORS now allow johnsonlegalteam.org, www and mtecfix.github.io (2026-11-20). Portal CORS is also in the stack and `portal-api/template.yaml`.
- [ ] `.github/workflows/deploy-pages.yml` is obsolete now that Pages is off. Remove or disable it.
- [ ] `admin/config.yml` line 14 still has a "TODO before go-live" comment. Check the `repo` value.
- [ ] Outdated docs: `KIRO-RESUME.md` (says private, `master`, Pages live), `README.md`, `CASE-STUDY.md`, `DEPLOY.md`.
- [ ] `netlify.toml` (alternative host) is probably unused.
- [ ] Old bucket `johnsonlegalteam-www`: not deployed by any workflow, versioning off. Check contents, then retire.
- [ ] Bucket `johnson-legal-sam-deploy-663877906756`: versioning off. Enable it with a lifecycle rule if it is kept.
- [ ] Possibly unused secrets *(per Jul 13 notes)*: `johnson-legal/rds-credentials`, `johnson-legal/google-oauth-client-secret`,
      `johnsonlegalteam/rds-credentials`, `johnsonlegalteam/google-oauth`. Confirm, then delete (about $0.40 per month each).

## Open items found 2026-11-20

- [ ] **Portal API routes are hand-built and not in the template.** Do not `sam deploy` `portal-api/template.yaml` until it declares
      the real routes (27 JWT method routes plus 13 open OPTIONS routes). A stack update on 2026-11-20 deleted them; they were rebuilt
      by hand from an inventory. Fix: declare explicit routes, and OPTIONS routes with AuthorizationType NONE, in the template.
- [ ] **Two draft PRs are open against `master`** (opened 2026-11-20 12:29 to 12:51 ET by something using the mtecfix GitHub token):
      #2 React preview (`/react-app`, 27 commits) and #3 PHP API recovery baseline plus changes to `cognito-auth.js` and `user-registration.js`
      (12 commits). `master` is 16 commits behind `production`, so merging them does not reach the live site. Confirm they are yours.
- [ ] Confirm the SNS subscription `jlt-cost-report` (email to mrtechfixes.ai@gmail.com), then check the first real cost report.
- [ ] Three `*.metrotec.online` MCP endpoints on the worker answer without credentials. Put Cloudflare Access in front of them.
