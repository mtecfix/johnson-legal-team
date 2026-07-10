# Jude — OpenClaw Agent Specification (v2)

_Project: Johnson Legal Team_
_Supersedes: JUDE-ARCHITECTURE-BLUEPRINT.md (v1, DESIGN status)_
_Last updated: 2026-07-10_
_Status: SPEC — grounded in real OpenClaw docs; ready to implement_

---

## 0. What changed from v1 and why

The original blueprint assumed OpenClaw could run **serverless on Lambda**.
That is incorrect. Verified against the real project (openclaw/openclaw,
MIT license, docs.openclaw.ai):

- OpenClaw is a **long-running Gateway daemon** (Node.js 22.19+/24, WebSocket
  server + HTTP control plane). It is not a request/response function —
  it holds persistent channel connections, session state, and cron/heartbeat
  timers in memory, backed by a local SQLite file and `~/.openclaw/` state dir.
- There is **no official serverless/Lambda deployment mode**. The project
  ships a Dockerfile and `docker-compose.yml`; community guides deploy it to
  a VPS, Fly.io, Render, or a small always-on container.
- Explicit community security guidance: *"The OpenClaw Gateway is designed
  as an internal communication component. It should NOT be open to the
  public internet indiscriminately."*
- Config is one JSON5 file (`~/.openclaw/openclaw.json`), strictly schema-
  validated — unknown keys or bad types make the Gateway refuse to start.
- License: **MIT**. Fully free, self-hosted, no vendor lock-in.

**Practical consequence for "serverless in AWS":** we cannot run OpenClaw
itself as a Lambda. The closest AWS-native equivalent to "serverless" for a
long-running container is **AWS App Runner** (or Fargate on a minimal task,
or a `t4g.micro` EC2 free-tier instance). App Runner is recommended: it
scales the container, handles TLS, and — unlike Lambda — supports
long-lived processes and WebSocket upgrade traffic. It is not scale-to-zero
free, but at Jude's expected traffic (one law firm, one agent) the smallest
App Runner tier costs a few dollars a month, which is the closest "free-tier
friendly" option that still satisfies "OpenClaw running in the AWS env."

Everything **around** OpenClaw (the leads capture, DynamoDB, SNS/SES,
webhooks that feed it) stays serverless exactly as already built
(`jude-leads`, `jude-notify-owner`). OpenClaw becomes the **reasoning +
messaging layer** in front of that existing serverless backbone, reached via
its `hooks` (webhook) feature — not by rewriting the backbone as OpenClaw
"skills" that run somewhere else.

---

## 1. Agent identity

```json5
{
  agents: {
    list: [
      {
        id: "jude",
        default: true,
        workspace: "~/.openclaw/workspace-jude",
      },
    ],
  },
}
```

- **One agent, one workspace**: `jude`. No multi-agent routing needed — the
  firm is a single-owner practice with one back office to run.
- Workspace holds the injected prompt files OpenClaw reads on every turn:
  - `AGENTS.md` — operating instructions (see §6)
  - `SOUL.md` — persona/tone (see §7)
  - `TOOLS.md` — tool usage notes/guardrails (see §8)
  - `skills/` — per-skill `SKILL.md` files (see §5)

---

## 2. Model

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "amazon-bedrock/amazon.nova-lite-v1:0",
        fallbacks: ["anthropic/claude-haiku-4-5"],
      },
    },
  },
}
```

- **Primary: Amazon Bedrock, Nova Lite.** Cheapest capable model, keeps
  Jude's reasoning cost close to $0 at this firm's volume, and keeps
  everything in-region (`us-east-1`) with the rest of the AWS footprint.
  Requires enabling Bedrock model access in the console (blocked in v1 —
  this must be done before Jude can reason; see §11 Blockers).
- **Fallback: a cheap external model** only if Bedrock has an outage or the
  account's Bedrock quota is exhausted. Keep it optional — if the owner
  wants zero non-AWS spend, drop the fallback and let turns fail closed
  instead (safer for a law firm than silently switching model vendors).
- Do **not** point Jude at a paid frontier model by default — the leads/
  triage work here does not need it, and it would blow past "100% free/
  cheap" intent fast.

---

## 3. Where OpenClaw runs (the "serverless-as-possible" host)

| Option | Verdict |
|---|---|
| AWS Lambda | ❌ Not supported by OpenClaw (no serverless mode) |
| AWS App Runner (small instance, min-instances=1) | ✅ **Recommended** — closest to serverless; managed TLS, auto-restart, no server patching |
| Fargate (single task, no ALB) | ✅ Viable alternative if App Runner's opinionated networking is a problem |
| EC2 t4g.micro (free-tier 12 months) | ✅ Cheapest in dollar terms, but is a real server the owner must patch |
| Local machine / always-on mini-PC | ❌ Rejected — Jude must run 24/7 independent of the office being open |

**Decision: AWS App Runner**, one service, one instance, running the
official `ghcr.io/openclaw/openclaw` image (or a thin wrapper image that
`COPY`s in the `openclaw.json` + workspace at build time — see §9).

- Networking: App Runner's default public endpoint is **not** exposed
  directly for the Gateway's control WebSocket. Only the `hooks` HTTP path
  (see §4) is intentionally public; everything else binds to
  `gateway.bind: "127.0.0.1"` inside the container and is reached by the
  operator over **Tailscale** (OpenClaw has first-class Tailscale support) —
  never opened to `0.0.0.0` on the internet. This directly satisfies the
  project's own security guidance quoted in §0.
- Secrets (Bedrock creds via IAM task role, hook token, SES/SNS ARNs) are
  injected as App Runner environment variables backed by **Secrets
  Manager**, referenced with OpenClaw's `${VAR_NAME}` substitution — never
  hardcoded in `openclaw.json`.
- State (`~/.openclaw/`, SQLite session DB) persists on an attached
  **EFS access point** mounted into the container, so a redeploy/restart
  does not wipe cron history, sessions, or paired-channel state.

---

## 4. How the existing serverless backbone talks to Jude

Keep `jude-leads` and `jude-notify-owner` exactly as built. Do not port
their logic into OpenClaw "skills." Instead, wire them to Jude's `hooks`
(webhook) endpoint so Jude becomes the **triage brain** on top of data that
already lands in DynamoDB.

```json5
{
  hooks: {
    enabled: true,
    token: "${JUDE_HOOKS_TOKEN}",       // Secrets Manager, never inline
    path: "/hooks",
    defaultSessionKey: "hook:leads",
    allowRequestSessionKey: false,
    allowedSessionKeyPrefixes: ["hook:"],
    mappings: [
      {
        match: { path: "new-lead" },
        action: "agent",
        agentId: "jude",
        deliver: true,
      },
      {
        match: { path: "call-event" },
        action: "agent",
        agentId: "jude",
        deliver: true,
      },
    ],
  },
}
```

Flow for a new lead (public contact form → already-built `POST /leads` →
this hook):

1. `jude-leads` Lambda processes + scores + stores the lead in DynamoDB
   (unchanged).
2. `jude-leads` makes one more call: `POST https://<app-runner-url>/hooks/new-lead`
   with the lead summary as JSON body, `Authorization: Bearer <JUDE_HOOKS_TOKEN>`.
3. OpenClaw's hook mapping routes that payload into an agent turn for
   `jude`, which decides — using the rules in `AGENTS.md` (§6) — whether
   this is SMS-worthy (urgent) or email-digest-only, and drafts the alert.
4. Jude sends via the **channels** it's configured with (§5): SNS SMS for
   urgent, SES email for the digest.

This keeps the two Lambdas as the system of record (DynamoDB) and makes
OpenClaw the decision-and-notify layer, which matches the original blueprint's
intent ("Jude decides importance — LLM-driven triage") without requiring
OpenClaw to be serverless itself.

---

## 5. Skills (what Jude can actually do)

OpenClaw skills are markdown+metadata bundles the agent loads on demand
(`~/.openclaw/workspace-jude/skills/<skill>/SKILL.md`), not new Lambda code.
Each skill below wraps an **existing or planned AWS resource** — the skill
itself is just the instructions + a small tool/API wrapper telling Jude how
to call it.

| Skill id | Wraps | Status |
|---|---|---|
| `leads-triage` | `jude-leads` DynamoDB table (read/update via existing routes) | ✅ Backend exists |
| `owner-notify` | `jude-notify-owner` Lambda (SNS SMS + SES email) | ✅ Backend exists |
| `case-lookup` | Portal API `/admin/clients`, `/admin/registrations` (read-only, admin JWT) | ✅ Backend exists (needs a service-role token for Jude, see §11) |
| `email-inbox` (Contact Center → Emails subagent) | SES inbound (needs SES production access) | ⏳ Blocked, see §11 |
| `newsletter` | Reuse MetroTec subscriber pattern (`metrotec-subscribe` Lambda as template) + SES | ⏳ Not started |
| `scheduling` | MS Graph / Google Calendar / Zoom (per v1 blueprint §4.4) | ⏳ Not started — lowest priority per phased plan |
| `call-monitor` | SignalWire webhook → hook mapping (read-only monitoring, no outbound SMS via SignalWire) | ⏳ Not started |
| `ad-center` | Meta Marketing API + Google Ads API (reporting only, v1 phase) | ⏳ Not started, lowest priority |

Per-agent skill restriction (since there's only one agent, this is really
just an explicit allowlist so a future second agent can't accidentally
inherit law-firm-only tools):

```json5
{
  agents: {
    list: [
      {
        id: "jude",
        skills: [
          "leads-triage",
          "owner-notify",
          "case-lookup",
        ],
      },
    ],
  },
}
```

Add `email-inbox`, `newsletter`, `scheduling`, `call-monitor`, `ad-center`
to the array as each backend is actually built (matches the phased plan in
§10 of the original blueprint — kept unchanged here, it was already sound).

---

## 6. `AGENTS.md` — operating rules (drafted, ready to drop in workspace)

```markdown
# Jude — Operating Rules

You are Jude, the sole back-office agent for Johnson Legal Team, a solo/small
Michigan law firm. You act on behalf of the owner (the attorney). You are
NOT a lawyer and must never give legal advice to clients or leads.

## Core duties
1. Triage inbound leads (from the leads-triage skill) — classify urgency,
   summarize, and decide the notification channel (see "Notification rules").
2. Draft — but do not autonomously send — any client-facing legal content.
   Human-in-the-loop always for anything that could be read as legal advice.
3. Keep the owner informed without spamming them.

## Notification rules
- SMS (via owner-notify → SNS): ONLY for actionable/urgent items —
  a new high-score lead, a missed call from an existing client, anything
  with a deadline inside 48 hours.
- Email (via owner-notify → SES): everything else, batched into a digest
  where reasonable. Full log of all activity lives here, not in SMS.
- Never message the owner more than once per lead/event; if you already
  alerted about something, update the existing thread/record instead of
  sending a duplicate.

## Guardrails
- Never fabricate case status, deadlines, or legal outcomes.
- Never promise a specific case result to a lead or client.
- Confidential client data (from case-lookup) is for the owner's eyes only —
  never forward it to a public channel or include it in a lead-facing reply.
- If you are not confident in a classification, say so explicitly rather
  than guessing silently.
```

---

## 7. `SOUL.md` — persona (drafted)

```markdown
# Jude's Persona

Tone: professional, concise, calm. You work for a law firm — no slang, no
exclamation-point enthusiasm, no emoji in anything client-facing.

You are efficient and a little dry. You do not pad responses. When
summarizing a lead or event for the owner, lead with the one sentence that
matters, then supporting detail.

You never speak on behalf of the firm to a client or lead without the
owner's review — your job is to prepare, notify, and organize, not to be
the public voice of the practice.
```

---

## 8. `TOOLS.md` — tool usage notes (drafted)

```markdown
# Tool Notes

- leads-triage: read/update only. Never delete a lead record. Stage
  transitions must be one of: new, contacted, qualified, converted, lost.
- owner-notify: rate-limit yourself — do not send more than one SMS per
  10 minutes to the owner regardless of how many events queue up; batch
  into one message if several arrive close together.
- case-lookup: admin-scoped, read-only. Treat every field as confidential.
  Never quote a client's case detail back through a public/hook-triggered
  channel.
```

---

## 9. Deployment shape (App Runner)

```
Dockerfile (extends ghcr.io/openclaw/openclaw:latest)
  └─ COPY workspace-jude/  → /root/.openclaw/workspace-jude/
  └─ COPY openclaw.json    → /root/.openclaw/openclaw.json   (secrets as ${VAR} refs only)

App Runner service
  ├─ Source: ECR image (built via existing GitHub Actions → push to ECR)
  ├─ Instance: 0.25 vCPU / 0.5 GB (smallest tier)
  ├─ Min instances: 1 (must stay warm — it's a stateful daemon, not
  │                    request-driven, so scale-to-zero is not applicable)
  ├─ Env vars: pulled from Secrets Manager
  │     JUDE_HOOKS_TOKEN, AWS creds via task IAM role (Bedrock, SNS, SES,
  │     DynamoDB read access scoped to jude-leads table only)
  ├─ Storage: EFS access point mounted at /root/.openclaw (session/state
  │           persistence across deploys/restarts)
  └─ Networking: public endpoint restricted at the app layer — only
                 /hooks/* responds meaningfully; everything else requires
                 the Tailscale-tunneled operator connection.
```

IAM task role — least privilege, scoped exactly to what Jude needs:
- `dynamodb:GetItem`, `Query` on `jude-leads` table only (no `Scan`, no
  write except the existing `PATCH` path already enforced by the Lambda,
  which Jude calls via HTTP, not directly via SDK — keeps the ownership/
  auth logic in one place).
- `bedrock:InvokeModel` for the Nova Lite model ARN only.
- `sns:Publish` to the owner-alert topic only.
- `ses:SendEmail` from the verified firm domain identity only.
- No S3, no other DynamoDB tables, no IAM, no broad `*` resource anywhere.

---

## 10. Cost model (why this is "as free as possible")

| Component | Cost |
|---|---|
| OpenClaw software | $0 (MIT license) |
| App Runner (0.25 vCPU/0.5GB, always-on) | ~$5–7/mo — the one non-Lambda line item; unavoidable because OpenClaw needs a persistent process |
| Bedrock Nova Lite | Pay-per-token, fractions of a cent per triage turn at this volume |
| DynamoDB (`jude-leads`) | On-demand, already ~$0 at current volume |
| SNS SMS | ~$0.0075/SMS to a US number, only for urgent alerts (rate-limited to protect against runaway cost) |
| SES email | $0.10 per 1,000 emails after free tier |
| EFS (small access point) | Pennies/month at this data size |

This is the cheapest architecture that still satisfies "OpenClaw actually
running, in AWS, as the core of Jude" — full Lambda-only serverless is not
achievable because the upstream project does not support it.

---

## 11. Blockers (carried over + updated from v1)

1. **Bedrock model access** — must be enabled in the console for the Nova
   Lite model before Jude can reason at all. (Unchanged from v1.)
2. **SES production access** — required for the `email-inbox` and
   `newsletter` skills and for the owner-notify digest to reach arbitrary
   recipients. (Unchanged from v1.)
3. **App Runner + ECR pipeline** — needs to be built (does not exist yet).
   This replaces v1's open question #10 ("where does Jude run") with a
   concrete answer.
4. **Service-role JWT for `case-lookup`** — the existing portal API only
   issues Cognito user JWTs; Jude needs its own machine-to-machine
   credential (e.g., a Cognito client-credentials app client, or a signed
   internal token) scoped to admin-read routes only. Not yet built.
5. **Tailscale on the operator's side** — needed so the owner can reach the
   OpenClaw Control UI/dashboard without the Gateway being open to the
   public internet.
6. **`JUDE_HOOKS_TOKEN`** — must be generated and stored in Secrets Manager,
   then wired into both the `jude-leads`/`jude-notify-owner` Lambdas (as the
   caller) and OpenClaw's `hooks.token` (as the verifier).

---

## 12. Phased build plan (updated)

Phase 0 (this doc) — spec + App Runner/ECR scaffolding + Bedrock access
                       request + Secrets Manager entries.
Phase 1 — Deploy bare OpenClaw to App Runner with the `jude` agent, no
          skills yet. Confirm it boots, Tailscale reaches the Control UI,
          and `openclaw doctor` is clean.
Phase 2 — Wire `hooks` + `leads-triage` + `owner-notify` skills to the
          existing `jude-leads`/`jude-notify-owner` Lambdas. This is the
          flagship piece per the original blueprint's priority call.
Phase 3 — `case-lookup` skill (needs the service-role JWT from §11.4).
Phase 4 — `email-inbox` + `newsletter` skills (needs SES production access).
Phase 5 — `scheduling` skill (Outlook/Google/Zoom).
Phase 6 — `call-monitor` skill (SignalWire, read-only).
Phase 7 — `ad-center` skill (Meta + Google Ads, reporting only).

---

## 13. Open decisions for the owner

1. Confirm App Runner is acceptable given it's the one recurring AWS cost
   in this otherwise-serverless stack (~$5–7/mo minimum for an always-on
   instance) — or explicitly choose EC2 free-tier instead and accept the
   patching responsibility that comes with a real server.
2. Confirm Bedrock Nova Lite as the model (cheapest capable option) vs.
   paying more for a stronger model — Jude's triage work is not complex
   enough to need a frontier model.
3. Owner's mobile number + primary email for SNS/SES (still open from v1).
4. Confirm the phase order in §12 — leads-triage first (matches v1's stated
   priority), or reorder if priorities changed.
