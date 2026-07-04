# Johnson Legal Team — Auth & Registration Flow

## Stack
- Frontend: HTML/Bootstrap/JS hosted on S3 → CloudFront (`d1rqv10nry9s54.cloudfront.net`)
- Auth: AWS Cognito (User Pool `us-east-1_3W53TuLIX`, Client `23ag7h91l0u0a533t4n635534t`)
- API: PHP on EC2/server, `api/cms-api.php`
- DB: MySQL RDS (`johnson_legal`)
- Email: AWS SES (approval flow) / PHP `mail()` (legacy)
- Approval Lambda: `jlt-registration-approver` (see below)

---

## 1. Login Flow (`client-login.html`)

```
User submits email + password
  → cognito-auth.js: CognitoAuth.handleLogin()
  → AWS Cognito authenticateUser()
  → onSuccess: storeSession(tokens)
      - Decodes ID token JWT (base64, client-side)
      - Reads cognito:groups + email → derives role
      - Saves to localStorage: cognito_id_token, user_email, user_role, clientLoggedIn
  → redirectByRole() → PortalRouter
      - super_admin  → super-admin-portal.html
      - admin        → admin-portal.html
      - client       → client-portal-cms.html
```

**Google OAuth path:**
```
Click Google button
  → Redirect to Cognito hosted UI (identity_provider=Google)
  → Cognito handles OAuth, returns ?code= to client-login.html
  → CognitoAuth.init() detects code param
  → exchangeCodeForTokens() → POST /oauth2/token
  → Same storeSession() → same redirectByRole()
```

**Existing session:**
```
Page load → CognitoAuth.init()
  → userPool.getCurrentUser().getSession()
  → If valid → redirectByRole() immediately (skip login form)
```

---

## 2. Registration Flow (`client-login.html` register tab)

```
User fills register form
  → CognitoAuth.handleRegister()
  → Cognito userPool.signUp(email, password, [attrs])
  → On success:
      - Saves pending_registration to localStorage
      - Redirects → legal-onboarding.html?email=xxx
```

---

## 3. Legal Onboarding + Admin Approval Flow

### 3a. Client fills onboarding form (`legal-onboarding.html`)
Fields collected:
- Legal matter type, urgency, case description
- Preferred contact method, best time
- 4 legal disclosure checkboxes (required)

On submit → `legal-onboarding.js` → POST `api/legal-onboarding.php`

### 3b. `api/legal-onboarding.php`
1. Validates required fields
2. Upserts row into `legal_onboarding` table with `status = 'pending_review'`
3. Generates two HMAC-signed tokens: one for approve, one for deny
   - `hash_hmac('sha256', "$email:approve", HMAC_SECRET)`
   - Tokens are single-use safe — same email+action always produces same token (stateless)
4. Sends HTML email to all `ADMIN_EMAILS` via SES (falls back to PHP `mail()`)

### 3c. Admin receives embedded intake email
The email contains:
- Full intake form data rendered inline (name, matter type, urgency, description, contact prefs)
- Legal disclosure acknowledgements listed
- Two large CTA buttons at the bottom:
  - **✓ Approve Access** → GET `Lambda_URL?email=x&action=approve&token=<hmac>`
  - **✗ Deny Access**    → GET `Lambda_URL?email=x&action=deny&token=<hmac>`
- Clicking opens a browser confirmation page (no accidental one-click approval)

### 3d. Lambda: `jlt-registration-approver`
File: `lambda/registration_approver.py`

Triggered by API Gateway GET/POST `/approve-registration`

Steps:
1. Reads `email`, `action`, `token` from query params
2. `verify_token()` — recomputes HMAC and uses `hmac.compare_digest()` (timing-safe)
3. Queries DB — confirms record exists with `status = 'pending_review'` (prevents double-processing)
4. Updates `legal_onboarding.status` → `approved` or `denied`
5. If **approved**: `INSERT ... ON DUPLICATE KEY UPDATE` into `user_profiles` (fixes the missing record gap — client can now log in)
6. Sends client notification email via SES
7. Returns HTML confirmation page to the admin's browser

### 3e. Client receives email
- **Approved**: "Your account is approved" + portal login button
- **Denied**: Polite rejection with phone number

---

## 4. API Authentication (`api/cms-api.php`)

Every request from the portal:
```
client-portal-cms.js apiFetch()
  → Authorization: Bearer <cognito_id_token>
  → cms-api.php decodeJwtPayload()
      - Validates sub, email, exp
      - Derives $user_role server-side (not trusted from client)
      - getUserIdFromCognitoSub() → DB lookup
          - Falls back to email if cognito_sub not yet stored
          - Backfills cognito_sub on match
  → Routes to handleGet/handlePost by action param
  → 401 on missing/expired token → frontend auto-logout
```

---

## 5. Role Hierarchy

| Role | Email Examples | Portal |
|------|---------------|--------|
| `super_admin` | mrtechfixes.ai@gmail.com | super-admin-portal.html |
| `admin` | mrtechfixes@gmail.com, johnsonlegalteam@gmail.com | admin-portal.html |
| `client` | all approved users | client-portal-cms.html |

Role is derived from:
1. `cognito:groups` in the ID token (authoritative)
2. Admin email hardlist as fallback

---

## 6. Known Gaps / Notes
- Cognito JWT signature is decoded client-side only (base64). Full JWKS signature verification should be added server-side for production hardening.
- `simple-auth.js` is a legacy file — not loaded by any active page, can be removed.
- `client-dashboard.html` and `client-portal.html` are unreachable (router bypasses them) — legacy files.
- DB host in `config.php` must have the correct RDS endpoint (not the placeholder `cluster-xyz`).
