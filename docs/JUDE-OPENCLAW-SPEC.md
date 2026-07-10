# Jude — OpenClaw Agent Specification (v2)

_Project: Johnson Legal Team_
_Supersedes: JUDE-ARCHITECTURE-BLUEPRINT.md (v1, DESIGN status)_
_Last updated: 2026-07-10_
_Status: SPEC — grounded in real OpenClaw docs; ready to implement_

---

## 0. What changed from v1 and why (revised)

The original blueprint assumed OpenClaw could run **serverless on Lambda**.
An earlier draft of this spec said that was impossible — that claim was
**wrong** and is now corrected after checking real deployments.

OpenClaw itself (openclaw/openclaw, MIT) is a long-running Gateway daemon
by default (Node.js, WebSocket + HTTP control plane, local SQLite state).
But two real, working projects run it **truly serverless on AWS**:

1. **`aws-samples/sample-host-openclaw-on-amazon-bedrock-agentcore`**
   (AWS's own sample, MIT-0 license). Runs OpenClaw in **per-user Firecracker
   microVMs** via **Bedrock AgentCore Runtime** — the microVM spins up on
   the first message and freezes/terminates after ~30 min idle. Workspace
   state syncs to **S3** so nothing is lost between cold starts. Fronted by
   **API Gateway + a Router Lambda** (pure pay-per-invocation). Includes
   EventBridge Scheduler for cron/reminders, per-user STS-scoped
   credentials, Bedrock Guardrails, and VPC isolation.
   **Status: labeled "Experimental — not intended for production use."**

2. **`serithemage/serverless-openclaw`** (community, MIT). Runs OpenClaw
   **directly inside a Lambda container image** — ~$0.01/month idle cost,
   ~1.35s cold start. DynamoDB + S3 for session persistence. Fargate Spot
   as an automatic fallback only for tasks that exceed Lambda's 15-minute
   limit. **Status: labeled "Alpha... has not been fully tested in
   production."**

**Decision (owner-confirmed): go with Option 1, Bedrock AgentCore,
accepting its experimental status.** Rationale: it's AWS's own sample, it
already mirrors this project's existing shape (Lambda + API Gateway +
DynamoDB), and its security model (per-user STS scoping, VPC isolation,
Guardrails) is far more built-out than the Alpha Lambda-container project.
"Experimental" here means: expect to patch things ourselves, keep a close
eye on AWS's own updates to the sample, and treat it as an actively-
maintained-by-us fork rather than an install-and-forget dependency.

Everything **around** OpenClaw (the leads capture, DynamoDB, SNS/SES,
webhooks that feed it) stays serverless exactly as already built
(`jude-leads`, `jude-notify-owner`). Rather than adding a second, separate
Router Lambda + identity DynamoDB table (as the AWS sample does for
Telegram/Slack users), Jude has **exactly one caller** — the existing
`jude-leads`/`jude-notify-owner` pipeline — so the sample's multi-user
routing layer is simplified down to a single-tenant path (see §3).

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

## 3. Where OpenClaw runs (Bedrock AgentCore Runtime — serverless)

| Option | Verdict |
|---|---|
| AWS Lambda (container image, OpenClaw runs directly inside) | ⚠️ Viable (`serithemage/serverless-openclaw`) but "Alpha," less security tooling — not chosen |
| **Bedrock AgentCore Runtime (per-invocation microVM)** | ✅ **Chosen** — AWS's own sample, richer security model, matches this project's existing Lambda+DynamoDB+APIGW shape |
| AWS App Runner (always-on container) | ❌ Rejected — not actually serverless (pays 24/7 even idle); only needed if AgentCore turns out unworkable |
| EC2 t4g.micro | ❌ Rejected — real server, patching burden, not serverless |

**How AgentCore actually achieves "serverless" for a stateful daemon:**
OpenClaw's `.openclaw/` workspace (sessions, config, skill state) is synced
to **S3** on a timer and on shutdown. Each invocation:

1. A **Router Lambda** receives the event (in our case, a hook call from
   `jude-leads`/`jude-notify-owner` — not a public chat channel; see §4)
   and calls `InvokeAgentRuntime` with a fixed, single-tenant session ID
   (`jude-main` — there is only one "user," the firm itself).
2. AgentCore spins up a Firecracker microVM (cold start) or reuses a warm
   one. On cold start, a lightweight shim answers immediately (~5-15s)
   while full OpenClaw restores its workspace from S3 in the background
   (~1-2 min) and takes over.
3. After ~30 min idle, AgentCore freezes/terminates the microVM. Before
   shutdown, `.openclaw/` is saved back to S3. Nothing is lost.
4. Pay only for: Router Lambda invocations (pennies), AgentCore
   runtime-seconds while a session is actually warm, and Bedrock tokens.
   Zero cost while nobody has triggered Jude.

**Simplification vs. the AWS sample:** the sample is built for many human
users chatting over Telegram/Slack (per-user microVMs, cross-channel
linking, a Cognito user pool, an allowlist). Jude has **one caller** (our
own Lambdas) and **one human recipient** (the firm owner, reached via
SNS/SES — not a chat channel the owner types into). So we keep:
- The Router Lambda + API Gateway pattern (unchanged — it's exactly the
  right shape for "our Lambda calls into AgentCore").
- The S3 workspace-sync mechanism (unchanged — this is what makes state
  survive a serverless cold start).
- The per-invocation STS-scoped credentials pattern (unchanged — good
  practice even for a single tenant; scopes Jude's S3/DynamoDB access to
  exactly its own namespace).

And drop/skip:
- Per-user DynamoDB identity table, cross-channel account linking, and the
  public allowlist system — there is no "public user" here, only our own
  backend calling in over an authenticated hook path.
- Telegram/Slack channel adapters — not needed; Jude's only inbound is the
  hook call, and its only outbound is SNS SMS / SES email via the existing
  `owner-notify` Lambda (see §4), not a chat platform.
- Bedrock Guardrails' PII-redaction-for-public-users config — still worth
  keeping the content-filter/prompt-attack layers, since hook payloads
  (email/lead text) are technically untrusted external input.

**Networking/security carried over from the sample as-is (do not weaken these):**
- VPC isolation with private subnets + VPC endpoints, no direct internet
  exposure for the AgentCore container.
- Webhook/hook authentication: HMAC or bearer-token validation on every
  inbound call — matches the existing `hooks.token` pattern from the
  original OpenClaw-native design; the Router Lambda enforces it before
  ever calling `InvokeAgentRuntime`.
- KMS encryption at rest for S3/DynamoDB/Secrets Manager; TLS in transit.
- Least-privilege IAM per component; the AgentCore container's assumed
  role is scoped to only what Jude needs (see the IAM list in §9).

---

## 4. How the existing serverless backbone talks to Jude

Keep `jude-leads` and `jude-notify-owner` exactly as built. Do not port
their logic into OpenClaw "skills." Instead, they call a small **Router
Lambda + API Gateway** endpoint (the pattern from the AWS AgentCore sample,
simplified to one caller) which invokes Jude on AgentCore Runtime.

```
jude-leads (existing)
    │  POST https://<router-api>/hooks/new-lead
    │  Authorization: Bearer <JUDE_HOOKS_TOKEN>
    ▼
Router Lambda (new, thin)
    │  validates JUDE_HOOKS_TOKEN
    │  bedrock-agentcore:InvokeAgentRuntime(sessionId="jude-main", payload=leadSummary)
    ▼
AgentCore Runtime — Jude's microVM
    │  (cold: shim answers in ~10s, full OpenClaw takes over in ~1-2min;
    │   warm: near-instant)
    │  runs the AGENTS.md triage rules (§6), decides SMS vs. email
    ▼
owner-notify (existing) — Jude calls this exactly like the Lambdas already do
    → SNS SMS (urgent) / SES email (digest)
```

Config-wise, this still uses OpenClaw's native `hooks` feature — but now
`hooks.enabled`/`hooks.token`/`hooks.mappings` live **inside the AgentCore
container's `openclaw.json`**, and it's the **Router Lambda** (not the
public internet) that reaches the container's hook path, because AgentCore
Runtime has no public endpoint of its own — everything goes through
`InvokeAgentRuntime`.

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
      { match: { path: "new-lead" },   action: "agent", agentId: "jude", deliver: true },
      { match: { path: "call-event" }, action: "agent", agentId: "jude", deliver: true },
    ],
  },
}
```

Flow for a new lead (public contact form → already-built `POST /leads` →
Router Lambda → AgentCore):

1. `jude-leads` Lambda processes + scores + stores the lead in DynamoDB
   (unchanged).
2. `jude-leads` makes one more call: `POST https://<router-api>/hooks/new-lead`.
3. The new Router Lambda validates the token and calls
   `InvokeAgentRuntime`, which routes into OpenClaw's hook mapping →
   an agent turn for `jude`.
4. Jude decides — using `AGENTS.md` (§6) — whether this is SMS-worthy or
   email-digest-only, drafts the alert, and calls the existing
   `owner-notify` Lambda (via a `owner-notify` skill/tool, §5) to actually
   send it.

This keeps the two original Lambdas as the system of record (DynamoDB) and
makes OpenClaw the decision-and-notify layer — matching the original
blueprint's intent ("Jude decides importance — LLM-driven triage") while
running Jude itself fully serverless.

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

## 9. Deployment shape (Bedrock AgentCore)

```
CDK app (adapted from aws-samples/sample-host-openclaw-on-amazon-bedrock-agentcore)
  ├─ VPC stack: private subnets, VPC endpoints (bedrock-agentcore-runtime,
  │             s3, dynamodb, secretsmanager, sns, ses), flow logs
  ├─ Security stack: KMS CMK, Secrets Manager entries (JUDE_HOOKS_TOKEN,
  │                  any model/API creds), optional CloudTrail
  ├─ Guardrails stack: Bedrock Guardrails (content filters + prompt-attack
  │                     detection; PII redaction ANONYMIZE mode since hook
  │                     payloads carry real lead contact info)
  ├─ AgentCore stack: CfnRuntime, CfnRuntimeEndpoint, CfnWorkloadIdentity,
  │                    ECR repo, S3 bucket (workspace sync), SG, IAM
  │      Bridge container (bridge/Dockerfile, node:22-slim ARM64):
  │        - entrypoint.sh -> contract server (port 8080, /ping health)
  │        - agentcore-contract.js -> hybrid routing: lightweight shim
  │          first, full OpenClaw gateway (port 18789) once ready
  │        - workspace-sync.js -> restores/saves ~/.openclaw/ to/from S3
  │        - openclaw.json baked in (single agent "jude"; skills per §5)
  ├─ Router stack: Router Lambda + API Gateway HTTP API (single route:
  │                 POST /hooks/{path}), no DynamoDB identity table needed
  │                 (single fixed sessionId "jude-main", no per-user routing)
  └─ Observability stack: dashboard, alarms (errors, latency, token/cost
                           budget), reusing the existing SNS topic pattern
                           already used by metrotec-ticket-notifications
```

IAM role for the AgentCore container — least privilege, scoped exactly to
what Jude needs:
- `s3:GetObject`/`PutObject` on the workspace-sync bucket, scoped to the
  `jude-main/` prefix only (no other prefixes; irrelevant since single-
  tenant, but keeps the STS-scoping pattern from the sample intact).
- `dynamodb:GetItem`, `Query` on `jude-leads` table only (no `Scan`).
- `bedrock:InvokeModel`/`InvokeModelWithResponseStream` for the Nova Lite
  model ARN only.
- `sns:Publish` to the owner-alert topic only.
- `ses:SendEmail` from the verified firm domain identity only.
- No broad `*` resource anywhere; no cross-account access.

The Router Lambda's role is separately scoped to only
`bedrock-agentcore:InvokeAgentRuntime` on Jude's specific runtime ARN, plus
reading the `JUDE_HOOKS_TOKEN` secret to validate inbound calls.

---

## 10. Cost model (true serverless — pay only when Jude runs)

| Component | Cost |
|---|---|
| OpenClaw software | $0 (MIT license) |
| AgentCore Runtime | Pay-per-invocation runtime-seconds only while a session is warm (~30 min idle timeout); $0 while idle — no fixed monthly floor unlike App Runner/EC2 |
| Router Lambda + API Gateway | Pennies — a handful of invocations per lead/event |
| Bedrock Nova Lite (or Guardrails-wrapped Claude, per sample defaults) | Pay-per-token, fractions of a cent per triage turn at this volume |
| Bedrock Guardrails | ~$0.75 per 1,000 text units if enabled — optional, can disable to save cost since Jude has no public untrusted chat users, only lead/email text |
| S3 (workspace sync) | Pennies/month at this data size |
| VPC endpoints (7 in the AWS sample) | ~$0.01/hr each if all enabled — trim to only the ones actually used (bedrock-agentcore-runtime, s3, secretsmanager, dynamodb) to cut this down |
| DynamoDB (`jude-leads`) | On-demand, already ~$0 at current volume |
| SNS SMS | ~$0.0075/SMS to a US number, only for urgent alerts (rate-limited) |
| SES email | $0.10 per 1,000 emails after free tier |

This is meaningfully cheaper than the App Runner plan in the earlier draft
(~$5-7/mo fixed floor) — AgentCore has **no idle cost floor**, matching
the original "as free as possible" ask. The trade is operational: this is
labeled experimental by AWS, so budget time for troubleshooting the
container/runtime integration rather than a guaranteed smooth setup.

---

## 11. Blockers (carried over + updated from v1)

1. **Bedrock model access** — must be enabled in the console for the Nova
   Lite (and/or Claude, per the sample's default) model before Jude can
   reason at all. (Unchanged from v1.)
2. **SES production access** — required for the `email-inbox` and
   `newsletter` skills and for the owner-notify digest to reach arbitrary
   recipients. (Unchanged from v1.)
3. **AgentCore CDK stack build-out** — needs to be forked from
   `aws-samples/sample-host-openclaw-on-amazon-bedrock-agentcore` and
   trimmed to the single-tenant shape described in §3/§9 (drop Telegram/
   Slack routers, per-user identity table, allowlist). This replaces v1's
   open question #10 ("where does Jude run") with a concrete answer.
4. **Experimental-status risk** — the upstream sample is explicitly not
   production-hardened. Plan to pin the exact commit we fork from, run our
   own `cdk-nag`/security checks before go-live, and keep a rollback path
   (the App Runner design from the earlier draft) documented in case
   AgentCore proves unworkable in practice.
5. **Service-role credential for `case-lookup`** — the existing portal API
   only issues Cognito user JWTs; Jude needs its own machine-to-machine
   credential (e.g., a Cognito client-credentials app client, or a signed
   internal token) scoped to admin-read routes only. Not yet built.
6. **`JUDE_HOOKS_TOKEN`** — must be generated and stored in Secrets Manager,
   then wired into both the `jude-leads`/`jude-notify-owner` Lambdas (as the
   caller) and the Router Lambda (as the verifier).
7. **AgentCore Runtime region/AZ availability** — per the sample's own
   gotchas, AgentCore Runtime is not available in all AZs; must confirm
   supported AZs in `us-east-1` (where the rest of this project already
   lives) before deploying.

---

## 12. Phased build plan (updated)

Phase 0 (this doc) — spec + fork the AWS AgentCore sample + Bedrock access
                       request + Secrets Manager entries + confirm AZ support.
Phase 1 — Deploy the trimmed single-tenant AgentCore stack with the `jude`
          agent, no skills yet. Confirm `InvokeAgentRuntime` round-trips
          from a manual test call, workspace S3 sync works, and
          `openclaw doctor` is clean inside the container.
Phase 2 — Wire the Router Lambda + `hooks` + `leads-triage` + `owner-notify`
          skills to the existing `jude-leads`/`jude-notify-owner` Lambdas.
          This is the flagship piece per the original blueprint's priority
          call.
Phase 3 — `case-lookup` skill (needs the service-role credential from §11.5).
Phase 4 — `email-inbox` + `newsletter` skills (needs SES production access).
Phase 5 — `scheduling` skill (Outlook/Google/Zoom).
Phase 6 — `call-monitor` skill (SignalWire, read-only).
Phase 7 — `ad-center` skill (Meta + Google Ads, reporting only).

---

## 13. Open decisions for the owner

1. ~~App Runner vs. EC2~~ — **Resolved:** going with Bedrock AgentCore
   Runtime (§3), accepting its "experimental" status, because it has no
   idle-cost floor and reuses this project's existing Lambda/DynamoDB/
   API Gateway patterns.
2. Confirm Bedrock Nova Lite as the model (cheapest capable option) vs.
   paying more for a stronger model (the AWS sample defaults to Claude
   Sonnet) — Jude's triage work may not need a frontier model, but Nova
   Lite has not been validated against the sample's proxy code, which
   was built/tested against Claude via Bedrock ConverseStream. Worth a
   quick compatibility check in Phase 1 before committing.
3. Whether to keep Bedrock Guardrails enabled (~$0.75/1,000 text units)
   given Jude's only "untrusted" input is lead/email text, not public
   chat — leaning toward keeping the prompt-attack/PII layers on since
   lead form submissions are technically public-facing input.
4. Owner's mobile number + primary email for SNS/SES (still open from v1).
5. Confirm the phase order in §12 — leads-triage first (matches v1's stated
   priority), or reorder if priorities changed.
