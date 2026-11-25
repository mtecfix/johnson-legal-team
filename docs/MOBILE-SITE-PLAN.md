# Mobile site plan (based on variant D)

Status: plan, not started. Owner approval needed before Phase 2 ships to the bucket.
Last updated: 2026-11-15.

## Goal
Every public page on johnsonlegalteam.org gets the variant D mobile experience on phones:
a compact call-to-action under the page heading, a sticky Call / Message bar, full-width tap targets,
and a chat bubble that does not cover the bar. Desktop stays exactly as it is.

## Approach
One responsive layer for the whole site, on the same URLs. No separate `m.` site.
- `mobile.css`: rules scoped to `@media (max-width: 767.98px)`, so desktop rendering cannot change.
- `mobile.js` (small, no dependencies): injects the sticky bar and, where a page has a heading but no
  compact CTA, inserts one. It reads the phone number and the contact path from one config object, so
  there is a single place to change them.
- Both files are added to every public page by a generator script, the same way the variants are built,
  so pages are never hand-edited one by one.

Same URLs keep SEO simple: no redirects, no duplicate pages, no canonical changes, and Google's mobile
crawler sees what phone visitors see.

## Scope (from the production build)
Public pages (24): index, about, blog, contact, team, practice-areas, practice-area, the five service
pages, privacy-policy, terms-of-service, 404, client-login, client-dashboard, user-registration,
legal-onboarding, forms/client-onboarding, reset-password, pay-invoice, google-oauth-setup.

Out of scope: `admin/`, `admin-ab/`, `admin-dashboard.html` (staff tools), and the six A/B/C/D test
pages while the split runs (D already is the mobile design there).

Per-page treatment:
| Group | Pages | Sticky bar | Compact CTA |
|---|---|---|---|
| Marketing | index, about, practice-areas, practice-area, 5 service pages, blog, team, contact | yes | yes (contact: call only) |
| Legal / utility | privacy-policy, terms-of-service, 404 | yes | no |
| Forms and portal | client-login, client-dashboard, user-registration, legal-onboarding, client-onboarding, reset-password, pay-invoice | no (it would cover form buttons) | no |
| Internal | google-oauth-setup | excluded; recommend removing from the public site |

## Known issues the audit found
- 18 pages set the logo inline at `width: 330px`. On a 390 px phone that is most of the header.
  Fix in `mobile.css` (max-width on the logo).
- `google-oauth-setup.html` has no viewport meta tag and is a developer setup page. It should not be public.
- `team.html`, `practice-area.html`, `client-dashboard.html` do not load `preview-style.css`; they need
  separate checks.
- `expungements.html` has a wide table; needs horizontal scroll on phones.
- 12 pages do not load the chat widget; the sticky bar must not assume the chat bubble exists.
- Each page has at most one `tel:` link today; on phones the sticky bar becomes the primary call path.
- Desktop header overflows at 992–1199 px (search box off-screen). Desktop, not mobile, but should be
  fixed in the same release since it affects every page.

## Phases
All builds, screenshots and checks run on the worker server (`~/jl-work/scripts/`), triggered over SSM.

**Phase 0 – audit baseline (scripted).**
Screenshot all 24 pages at 360, 390 and 430 px wide and at 1024 / 1366 px (desktop regression baseline).
Record horizontal overflow, tap targets under 44 px, and text under 16 px.
Output: a contact sheet + JSON report staged in the private transfer bucket.

**Phase 1 – build in the sandbox.**
Extract D's mobile rules from `ab-variants.css` into `mobile.css` / `mobile.js`. Generator adds them to
the pages in the table above. Publish to `johnsonlegalteam-www-variants` (GitHub Pages) for review.

**Phase 2 – verify.**
Re-run the Phase 0 scripts. Pass criteria: no horizontal scroll at 360 px, every tap target ≥ 44 px,
sticky bar never covers a form button or the chat input, desktop screenshots pixel-identical to
baseline. Manual check on one real iPhone and one Android phone.

**Phase 3 – ship.**
Merge to `production`, normal approved deploy (upload only). Rollback = revert commit + redeploy, or
restore object versions.

**Phase 4 – measure.**
`ab-track.js` events already carry `device`. Compare phone lead rate (call taps + message taps + form
submits per visit) for 4 weeks before vs. after. Because ad phones get D at 100%, there is no
in-period phone control on the test pages; organic phone visitors to non-test pages serve as the
comparison until the sitewide rollout.

## Dependencies and decisions
- GA4 measurement ID (pending) for Phase 4 reporting.
- Decide whether the sticky bar's "Message" goes to `/contact` (current) or opens the chat widget.
- Portal/registration pages: their PHP backend does not exist (see below), so mobile work there is
  cosmetic until they are rewired.

## Related: forms that post to PHP
`user-registration.js`, `legal-onboarding.js`, `forms/onboarding-form.js`, `reset-password.html` and
`pay-invoice.html` post to `api/*.php`. No PHP server exists (S3 cannot run PHP; the worker server has
no PHP or web server). The working backend is AWS: Cognito pool `us-east-1_dqqgSRKwn` + portal API
`2hp2bdxsz6` (Lambda `johnson-legal-portal-PortalFunction`) + leads API `mpiai89295`. Rewiring:
registration → Cognito `signUp` (already in `cognito-auth.js`) + `POST /admin/registrations` approval;
password reset → Cognito `forgotPassword`; onboarding forms → `POST /leads` or a new portal route.
Separate task; not part of the mobile rollout.
