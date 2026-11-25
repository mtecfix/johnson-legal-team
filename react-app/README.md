# Johnson Legal Team — React preview

This Vite/React application is intentionally isolated under `/react-app`. The existing static website, Decap CMS, portal pages, Cognito scripts, API clients, and backend infrastructure remain unchanged.

## Local development

```bash
cd react-app
npm install
npm run check
npm run dev
```

## Production build (preview only)

```bash
npm run build
npm run preview
```

The app uses HashRouter-compatible navigation in this preview and relative asset paths so it can be hosted beneath a repository subpath. It is not wired into the live site's root entry point.

## Current public routes

- `/` — homepage
- `/practice-areas` — practice-area overview
- `/practice-areas/:slug` — service detail route placeholder (currently shares the overview)
- `/about` — firm overview
- `/contact` — inquiry form
- `/blog` — CMS-backed article listing
- `/blog/:slug` — CMS-backed article detail

## Integrations and boundaries

- Contact inquiries reuse the existing public leads endpoint and the same `from`, `subject`, `body`, and `source` payload contract used by the current `contact-form.js`.
- Client login links to the existing `client-login.html`; Cognito auth, portal API client, and authenticated portal routes are not reimplemented.
- Blog listing and detail pages read the existing `content/blog/index.json` manifest and Markdown files.
- Images are referenced from the existing top-level `images/` directory. The courtroom banner expects `images/courtroom-banner.png`; add the approved banner asset before visual QA.
- Office contact data is based on `content/settings/contact.json`. Confirm the address and contact details before production cutover because the legacy contact page contains a different address in its metadata.

## Validation gates before cutover

1. Run `npm run check` and `npm run build`.
2. Test all routes at desktop, tablet, and mobile widths.
3. Verify blog manifest and Markdown fetches against the production hosting path.
4. Submit a test inquiry in a controlled environment and verify the leads API response and notification flow.
5. Verify client login navigation and Cognito flow without changing portal assets.
6. Run accessibility, SEO, link, and browser regression tests.
7. Confirm the banner image exists and the final address/phone/email are approved.
8. Review the deployment path, redirects, canonical URLs, and rollback procedure.

No production cutover is performed by this project branch.
