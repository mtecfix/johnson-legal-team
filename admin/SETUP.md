# Decap CMS — Zero-Cost Setup

The CMS is configured to use the **GitHub backend** (`admin/config.yml`), which
is free. Content edits are committed straight to the GitHub repo; the site is
served for free from GitHub Pages (or Netlify's free tier).

There are two $0 auth options. Pick ONE.

## Option A — Netlify free tier (easiest, no proxy to run)

1. Push this repo to GitHub.
2. Create a free Netlify site linked to the repo.
3. In `admin/config.yml`, you may instead use:
   ```yaml
   backend:
     name: git-gateway
     branch: main
   ```
4. Enable **Netlify Identity** + **Git Gateway** in the Netlify dashboard.
5. Invite yourself as a user. Visit `/admin/` and log in.

Netlify handles the OAuth exchange for you — nothing to host.

## Option B — GitHub Pages + Cloudflare Worker OAuth proxy (fully $0, no Netlify)

1. Push this repo to GitHub; enable **GitHub Pages** (Settings → Pages).
2. Register a GitHub OAuth App (Settings → Developer settings → OAuth Apps):
   - Homepage URL: your Pages URL
   - Authorization callback URL: your Worker URL + `/callback`
3. Deploy a free Decap OAuth proxy to **Cloudflare Workers** (community
   templates exist). Set the app's Client ID/Secret as Worker secrets.
4. In `admin/config.yml` set:
   ```yaml
   backend:
     name: github
     repo: your-org/your-repo
     branch: main
     base_url: https://<your-worker-subdomain>.workers.dev
     auth_endpoint: auth
   ```
5. Visit `/admin/`, click "Login with GitHub".

## Required edit either way

Replace `your-org/your-repo` in `admin/config.yml` with the real GitHub repo.

## Local editing (no auth needed, works today)

```bash
npx decap-server      # starts a local git proxy on :8081
```
`local_backend: true` is already set, so opening `/admin/` locally will read and
write the files in this repo directly.
