# Ray Ray Corrections Log

## [2026-03-15] Correction
- What I got wrong: User asked about "nginkx headless" - I need to clarify what they want before proceeding
- Correct understanding: Need to understand if they want:
  1. Nginx as reverse proxy for OpenClaw
  2. Nginx for serving static websites 
  3. Nginx in headless/containerized setup
  4. Something else entirely

## [2026-03-15] Correction #2
- What I got wrong: User asked about "jim" and his .md files - I assumed it was unclear
- Correct understanding: "jim" is the OpenClaw container/system on the server
- Need to analyze: OpenClaw's capabilities, documentation files, missing features, and usage recommendations

## [2026-03-15] Correction
- What I got wrong: Edited `client-portal-cms.html` (the original) instead of creating a new dev file first
- Correct understanding: Should have copied to `client-portal-cms-dev.html` first, then modified only the copy. Original was reverted immediately.

## [2026-07-03] Correction
- What I got wrong: When cleaning/organizing the folder, I nearly archived the old
  portal HTML pages (super-admin-portal.html, admin-portal.html) without noticing
  that `portal-router.js` still routed logged-in users to them (and to the already
  archived client-portal-cms.html). Archiving alone would have left login redirecting
  to missing pages.
- Correct understanding: Must trace references before archiving. Fixed portal-router.js
  to route to the new admin-dashboard.html / client-dashboard.html, and fixed a
  dangling client-portal-cms.html reference in user-registration.js, before/while
  archiving the stale pages.

