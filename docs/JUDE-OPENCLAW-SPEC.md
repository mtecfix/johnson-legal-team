# Jude — OpenClaw Agent Specification (v3)

_Project: Johnson Legal Team_
_Supersedes: JUDE-ARCHITECTURE-BLUEPRINT.md (v1, DESIGN status)_
_Last updated: 2026-07-10_
_Status: SPEC — grounded in real OpenClaw docs + verified AWS/model access; ready to implement_

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
  models: {
    providers: {
      gemini: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
        apiKey: "${GEMINI_API_KEY}",
        api: "openai-completions",
        models: [
          { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite" },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: { primary: "gemini/gemini-3.1-flash-lite" },
    },
  },
  env: {
    GEMINI_API_KEY: "${GEMINI_API_KEY}",   // Secrets Manager, never inline
  },
}
```

- **Primary: Google Gemini 3.1 Flash-Lite** (updated from the originally
  planned `gemini-2.5-flash-lite` — see "Model name correction" below),
  **live-tested and confirmed working** on 2026-07-10 with an
  `AIzaSy...`-format key against both the native `generateContent`
  endpoint and the OpenAI-compatible endpoint. Chosen over Bedrock, xAI
  Grok, and DeepSeek after real-world verification:
  - **Bedrock was blocked**: model-access approval for Nova Lite is not
    yet granted in this AWS account (`InvokeModel` returned
    `ValidationException: Operation not allowed`), and approval requires
    manual console action per model/provider.
  - **Grok's free tier ended** (May 2025) — new accounts pay from day one,
    and current published pricing for grok-4.3 ($1.25/$2.50 per 1M) is
    higher than the "Grok 4.1 Fast" figures originally cited. Not tested
    live; deprioritized on cost/uncertainty grounds.
  - **DeepSeek V3 was tested live** and authenticated successfully
    (`sk-...` key format) but returned `Insufficient Balance` — the
    account has no prepaid credit. Left as a documented, ready-to-use
    fallback (see below) if Gemini has problems later; not pursued
    further since Gemini started working.
  - **Gemini's `AQ.`-format key was tested extensively and confirmed
    broken** (see "AQ. key saga" below) — a genuine, currently-open Google
    bug, not a client-side issue. Getting a legacy `AIzaSy...`-format key
    resolved it immediately.
  - **Gemini has a real, permanent free tier** for Flash-Lite (per
    ai.google.dev/gemini-api/docs/pricing), but **paid tier was chosen
    deliberately**: Google's own pricing page states free-tier prompts
    are `"Used to improve our products: Yes"` while paid-tier prompts are
    `"Used to improve our products: No"`. Lead/case-adjacent text is
    client-sensitive; paid tier costs pennies/month at this volume and
    buys a real confidentiality guarantee the free tier does not.

### Model name correction (2026-07-10)

The original plan (`gemini-2.5-flash-lite`) returned `404 ... no longer
available to new users` when live-tested — Google appears to have retired
that specific model ID for accounts/keys created recently, even though it
still appeared as "Free of charge" and "Standard" on the public pricing
page at time of writing. Live-tested working alternatives, cheapest-first:
- `gemini-3.1-flash-lite` ✅ — **chosen**, matches the original cost/tier
  intent (successor to 2.5 Flash-Lite in Google's naming).
- `gemini-3-flash-preview` ✅ — also confirmed working, one tier up in
  cost/capability; kept as a documented option if 3.1 Flash-Lite proves
  insufficient for triage quality in practice.
- `gemini-2.0-flash` — hit a `429 RESOURCE_EXHAUSTED` (free-tier quota
  exhausted, limit 0) on this key/project; not pursued since the two
  options above already work.

### AQ. key saga (for anyone hitting this later)

Google is mid-migration from legacy `AIzaSy...` "Traffic Keys" (39 chars)
to new `AQ....` "Authorization Keys" (53 chars) as of mid-2026. The new
key type is supposed to be more secure (bound to a service account,
faster leak-response). **In practice, as of 2026-07-10, AQ.-format keys
were completely non-functional for direct API/SDK access** — confirmed by:
- Testing every combination of native `generateContent` endpoint vs.
  OpenAI-compat endpoint, REST vs. official `google-genai`/`openai` SDKs
  (latest versions), query-param key vs. `Authorization: Bearer` vs.
  `x-goog-api-key` header — **all failed identically** with
  `401 UNAUTHENTICATED / ACCESS_TOKEN_TYPE_UNSUPPORTED`.
- Cross-referencing Google's own AI developer forum
  (discuss.ai.google.dev): multiple independent reports of the exact same
  error, spanning April–June 2026, including one thread where a Google
  engineer acknowledged it ("We are working on address the issue with
  AQ.prefix keys. To unblock your workflow, create a new key via AI
  Studio — this will create a non-AQ-prefix key.") — but a later reply in
  the same thread (June 25) said the issue was still unresolved.

**Resolution**: simply requesting another key from Google AI Studio
eventually produced a legacy `AIzaSy...`-format key, which worked
immediately with zero code changes. If this recurs (e.g., after a key
rotation), the fix is the same: keep requesting new keys until one comes
back in the old format, or watch for Google's fix to the AQ. key rollout.

### DeepSeek V3 — documented fallback (not deployed)

If Gemini access breaks again, DeepSeek V3 is a tested, ready fallback:
`api.deepseek.com/chat/completions`, `model: "deepseek-chat"`, standard
`Authorization: Bearer sk-...` auth — confirmed the key authenticates
correctly (got `Insufficient Balance`, not an auth error). Would need
prepaid credit added to the DeepSeek account before use. Cheapest tested
option at $0.14/$0.28 per 1M tokens.

- **No Bedrock dependency, no App Runner/AgentCore compute-hosting
  requirement to run OpenClaw's model calls specifically.** This does
  **not** change the hosting decision in §3 (AgentCore is still how
  OpenClaw itself runs) — it only changes which LLM provider OpenClaw
  calls out to. AgentCore's IAM role no longer needs `bedrock:InvokeModel`
  permissions; it needs outbound HTTPS to `generativelanguage.googleapis.com`
  and the `GEMINI_API_KEY` secret instead.
- **No fallback model configured in OpenClaw itself.** For a law firm's
  triage workload, failing closed (no reasoning) if Gemini has an outage
  is safer than silently routing lead/case text to a second, unvetted
  provider through an automatic failover. DeepSeek is documented above as
  a manual fallback to switch to if needed, not an automatic one.

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

## 9. Deployment shape (Bedrock AgentCore, Gemini as model provider)

```
CDK app (adapted from aws-samples/sample-host-openclaw-on-amazon-bedrock-agentcore)
  ├─ VPC stack: private subnets, VPC endpoints (s3, dynamodb,
  │             secretsmanager only — no bedrock-agentcore-runtime
  │             endpoint needed since we don't call Bedrock models),
  │             PLUS a NAT Gateway for outbound HTTPS to
  │             generativelanguage.googleapis.com (new vs. the sample),
  │             flow logs
  ├─ Security stack: KMS CMK, Secrets Manager entries (JUDE_HOOKS_TOKEN,
  │                  GEMINI_API_KEY), optional CloudTrail
  ├─ AgentCore stack: CfnRuntime, CfnRuntimeEndpoint, CfnWorkloadIdentity,
  │                    ECR repo, S3 bucket (workspace sync), SG, IAM
  │      Bridge container (bridge/Dockerfile, node:22-slim ARM64):
  │        - entrypoint.sh -> contract server (port 8080, /ping health)
  │        - agentcore-contract.js -> hybrid routing: lightweight shim
  │          first, full OpenClaw gateway (port 18789) once ready
  │        - agentcore-proxy.js -> DROPPED (RESOLVED 2026-07-10). Verified
  │          against Google's own docs: Gemini exposes a native OpenAI-
  │          compatible endpoint at
  │          https://generativelanguage.googleapis.com/v1beta/openai/
  │          that accepts a Bearer API key and implements
  │          POST /chat/completions in the same shape OpenClaw's
  │          `openai-completions` provider already expects. The sample's
  │          1,661-line proxy exists ONLY to translate that same
  │          OpenAI-shaped request into Bedrock's Converse API — with
  │          Gemini as the provider, that translation layer is
  │          unnecessary. OpenClaw's `models.providers.<name>` config
  │          points directly at Google's endpoint (see snippet below);
  │          no local proxy process is started, port 18790 is unused.
  │        - workspace-sync.js -> restores/saves ~/.openclaw/ to/from S3
  │        - openclaw.json baked in (single agent "jude"; skills per §5)
  ├─ Router stack: Router Lambda + API Gateway HTTP API (single route:
  │                 POST /hooks/{path}), no DynamoDB identity table needed
  │                 (single fixed sessionId "jude-main", no per-user routing)
  └─ Observability stack: dashboard, alarms (errors, latency, token/cost
                           budget), reusing the existing SNS topic pattern
                           already used by metrotec-ticket-notifications

Dropped entirely vs. the AWS sample: Guardrails stack (Bedrock Guardrails
only applies to Bedrock model calls — irrelevant once Gemini is the
provider; see §11.1 for the AgentCore-vs-Bedrock-models distinction).
```

**OpenClaw config for the Gemini provider** (replaces the sample's
`agentcore` provider block, which pointed at the local Bedrock proxy —
duplicated from §2 for reference; §2 is the source of truth for the model
config):

```json5
{
  models: {
    providers: {
      gemini: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
        apiKey: "${GEMINI_API_KEY}",
        api: "openai-completions",
        models: [
          { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite" },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: { primary: "gemini/gemini-3.1-flash-lite" },
    },
  },
}
```

**Live-tested and confirmed working** on 2026-07-10 (see §2 for the full
verification detail and the model-name correction from the originally
planned `gemini-2.5-flash-lite`). Three-line swap (base URL, API key,
model name) from a stock OpenAI client; the REST shape
(`POST /chat/completions`, `Authorization: Bearer <key>`) matches what
OpenClaw's `openai-completions` provider type sends, confirmed via direct
curl and both the `openai` and `google-genai` Python SDKs.

IAM role for the AgentCore container — least privilege, scoped exactly to
what Jude needs:
- `s3:GetObject`/`PutObject` on the workspace-sync bucket, scoped to the
  `jude-main/` prefix only (no other prefixes; irrelevant since single-
  tenant, but keeps the STS-scoping pattern from the sample intact).
- `dynamodb:GetItem`, `Query` on `jude-leads` table only (no `Scan`).
- `sns:Publish` to the owner-alert topic only.
- `ses:SendEmail` from the verified firm domain identity only.
- No broad `*` resource anywhere; no cross-account access.
- **No `bedrock:InvokeModel` permission needed** — per §2, Jude's LLM
  calls go to the Gemini API over the internet (via the container's
  outbound HTTPS + `GEMINI_API_KEY` secret), not to Bedrock. Note this
  means the AgentCore container needs a NAT/internet egress path in its
  VPC subnet for `generativelanguage.googleapis.com` — the sample's
  default private-subnet-only design assumes Bedrock (in-VPC via VPC
  endpoint) and will need this one adjustment.

The Router Lambda's role is separately scoped to only
`bedrock-agentcore:InvokeAgentRuntime` on Jude's specific runtime ARN
(this permission is about invoking the *AgentCore compute service*, which
is unrelated to which LLM the agent inside it calls), plus reading the
`JUDE_HOOKS_TOKEN` secret to validate inbound calls.

---

## 10. Cost model (true serverless — pay only when Jude runs)

| Component | Cost |
|---|---|
| OpenClaw software | $0 (MIT license) |
| AgentCore Runtime | Pay-per-invocation runtime-seconds only while a session is warm (~30 min idle timeout); $0 while idle — no fixed monthly floor unlike App Runner/EC2 |
| Router Lambda + API Gateway | Pennies — a handful of invocations per lead/event |
| Gemini 2.5 Flash-Lite (paid tier, per §2) | $0.10 input / $0.40 output per 1M tokens — pennies per month at this volume; paid tier chosen specifically so prompts are NOT used to train Google's models |
| Bedrock Guardrails | Not used — dropped along with Bedrock as the model provider (§2). If content-filtering on hook payloads is wanted later, revisit via a lighter-weight approach (e.g., a rules-based pre-filter before the LLM call) rather than reintroducing a Bedrock dependency just for this. |
| S3 (workspace sync) | Pennies/month at this data size |
| VPC endpoints | Trim the sample's default 7 down to only what's actually used: `s3`, `secretsmanager`, `dynamodb`. Drop `bedrock-agentcore-runtime`'s Bedrock-model-specific endpoints since Gemini calls go out over the internet, not through a Bedrock VPC endpoint — but the container's subnet now needs NAT Gateway egress instead (small added cost, ~$0.045/hr + data, only while a session is warm). |
| DynamoDB (`jude-leads`) | On-demand, already ~$0 at current volume |
| SNS SMS | ~$0.0075/SMS to a US number, only for urgent alerts (rate-limited) |
| SES email | $0.10 per 1,000 emails after free tier |

This is meaningfully cheaper than the App Runner plan in the earlier draft
(~$5-7/mo fixed floor) — AgentCore has **no idle cost floor**, matching
the original "as free as possible" ask. Dropping Bedrock/Guardrails in
favor of Gemini also removes the model-access-approval blocker entirely
and keeps the model cost trivial. The trade is operational: AgentCore
itself is still labeled experimental by AWS, so budget time for
troubleshooting the container/runtime integration rather than a
guaranteed smooth setup, and the NAT Gateway swap (for Gemini's internet
egress) is a small deviation from the sample's original all-VPC-endpoint
design that needs testing.

---

## 11. Blockers (carried over + updated from v1)

1. ~~Bedrock model access~~ — **Resolved by dropping Bedrock as the model
   provider (§2).** Jude uses Gemini 2.5 Flash-Lite (paid tier) via API
   key instead, which sidesteps the model-access-approval blocker
   entirely. Note: this does NOT remove AWS Bedrock from the stack
   completely — AgentCore Runtime itself is a Bedrock *product* (the
   compute/microVM layer), separate from Bedrock's model-hosting
   feature. No model-access approval is needed to use AgentCore Runtime
   as a compute host; approval is only required to *invoke a Bedrock
   foundation model*, which Jude no longer does.
2. **SES production access** — required for the `email-inbox` and
   `newsletter` skills and for the owner-notify digest to reach arbitrary
   recipients. (Unchanged from v1.)
3. **AgentCore CDK stack build-out** — needs to be forked from
   `aws-samples/sample-host-openclaw-on-amazon-bedrock-agentcore` and
   trimmed to the single-tenant shape described in §3/§9 (drop Telegram/
   Slack routers, per-user identity table, allowlist, Bedrock Guardrails).
   This replaces v1's open question #10 ("where does Jude run") with a
   concrete answer.
4. **NAT Gateway for Gemini egress** — the sample's default network design
   assumes in-VPC Bedrock calls via VPC endpoint (no internet needed).
   Since Jude now calls the external Gemini API, the AgentCore container's
   subnet needs outbound internet access (NAT Gateway or equivalent) added
   to the VPC stack. Not yet built.
5. ~~`GEMINI_API_KEY`~~ — **Resolved.** Generated via Google AI Studio and
   stored in Secrets Manager as `jude/gemini-api-key`. Live-verified
   working against both the native and OpenAI-compatible endpoints (see
   §2). Note for future rotation: if a newly-generated key comes back in
   the `AQ.` format, it will currently be broken (see §2's "AQ. key saga")
   — keep requesting new keys until one comes back in the legacy
   `AIzaSy...` format, or check Google's status on the AQ. key bug fix.
6. **Experimental-status risk** — the upstream AgentCore sample is
   explicitly not production-hardened. Plan to pin the exact commit we
   fork from, run our own `cdk-nag`/security checks before go-live, and
   keep a rollback path (the App Runner design from the earlier draft)
   documented in case AgentCore proves unworkable in practice.
7. **Service-role credential for `case-lookup`** — the existing portal API
   only issues Cognito user JWTs; Jude needs its own machine-to-machine
   credential (e.g., a Cognito client-credentials app client, or a signed
   internal token) scoped to admin-read routes only. Not yet built.
8. **`JUDE_HOOKS_TOKEN`** — must be generated and stored in Secrets Manager,
   then wired into both the `jude-leads`/`jude-notify-owner` Lambdas (as the
   caller) and the Router Lambda (as the verifier).
9. **AgentCore Runtime region/AZ availability** — per the sample's own
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
2. ~~Which model~~ — **Resolved:** Gemini 2.5 Flash-Lite, paid tier (§2).
   Bedrock was blocked (no model access granted); Grok's free tier ended
   and current pricing needs re-verification; Gemini's real free tier
   confirmed the volume is a non-issue, and paid tier buys a "not used
   for training" guarantee worth paying for given client-adjacent data.
3. Whether the AZ/NAT-Gateway network changes needed to support external
   Gemini calls (§11.4) are acceptable, or whether it's worth revisiting
   Bedrock once model access is eventually granted (no urgency — Gemini
   works fine, this is just a future option if there's ever a reason to
   consolidate everything back onto AWS-native model hosting).
4. Owner's mobile number + primary email for SNS/SES (still open from v1).
5. Confirm the phase order in §12 — leads-triage first (matches v1's stated
   priority), or reorder if priorities changed.
