# JUDE — AI Practice-Management System (Architecture Blueprint)

_Project: Johnson Legal Team_
_Last updated: 2026-07-01_
_Status: DESIGN — no build started yet_

---

## 1. Vision

**Jude** is a single autonomous AI agent (built on the **OpenClaw** framework)
that runs the back office of a solo attorney's legal LLC. Every "center" is a
facet of Jude, not a separate app. Jude:

- **Communicates with the owner (the lawyer) via EMAIL and SMS**, in full
  two-way conversation when needed.
- **EMAIL (via Amazon SES)** = ongoing notifications / digest of all happenings.
- **SMS (via Amazon SNS)** = anything actionable that needs to reach the owner.
- **Never uses SignalWire for SMS** (cost). SignalWire is only the existing
  phone system Jude monitors.

Jude's "brain" = Amazon Bedrock (LLM). Jude's runtime/orchestration =
OpenClaw Gateway (agent, skills, cron, memory).

---

## 2. High-level architecture

```
                         ┌──────────────────────────┐
                         │        THE OWNER          │
                         │  (solo attorney)          │
                         └──────────┬────────────────┘
                     SMS (SNS)  ▲   │   ▲ Email (SES)
                                │   │   │   (two-way)
                         ┌──────┴───┴───┴────────────┐
                         │           JUDE            │
                         │   OpenClaw agent + Bedrock │
                         │   (coordinator + memory)   │
                         └───┬─────┬─────┬─────┬──────┘
             ┌───────────────┘     │     │     └───────────────┐
             ▼                     ▼     ▼                     ▼
      ┌────────────┐   ┌───────────────────────┐   ┌──────────────────┐
      │ AD CENTER  │   │    CONTACT CENTER      │   │ SCHEDULING CENTER│
      │ Instagram  │   │  subagents:            │   │ Outlook + Google │
      │ Google Ads │   │   - Emails             │   │ + Zoom -> one    │
      │ Facebook   │   │   - Newsletter         │   │ synced calendar  │
      └────────────┘   │   - Leads (MOST COMPLEX)│  └──────────────────┘
                       └───────────────────────┘
      ┌────────────────────────┐
      │ PHONE CALL CENTER      │  (SignalWire already hosts calls;
      │ monitor call events    │   Jude monitors + reports to owner)
      └────────────────────────┘
```

---

## 3. Core platform components

- **Agent runtime:** OpenClaw Gateway (WebSocket). Jude is the agent; each
  center is exposed to Jude as one or more OpenClaw **skills**.
- **LLM:** Amazon Bedrock (model TBD; Amazon Nova for cost, or Claude).
  NOTE: account currently shows Bedrock authorizationStatus = NOT_AUTHORIZED
  (see MetroTec known-limitations doc) — must be enabled before Jude reasons.
- **Owner notifications:** Amazon SNS (SMS) + Amazon SES (email, two-way).
  SES requires production access for arbitrary sending (currently sandbox).
- **State/memory:** OpenClaw memory + DynamoDB tables per center.
- **Scheduling/polling:** OpenClaw cron (poll ad platforms, calendars,
  call events) — or EventBridge scheduled rules if run on AWS.
- **Existing site:** johnsonlegalteam-www (S3 static) + PHP /api + Cognito
  auth + client portal already deployed. Jude is the back-office layer
  behind/around it.

---

## 4. The centers (detailed)

### 4.1 Ad Center
- Purpose: track ad campaigns across **Instagram, Google Ads, Facebook**.
- Jude monitors performance/spend/events and reports to the owner
  (email digest; SMS for anything important, e.g. budget spent, ad rejected).
- Integrations: Meta Marketing API (IG + FB), Google Ads API.
- Mode: monitoring/reporting first; campaign creation is a later phase.

### 4.2 Phone Call Center
- Purpose: calls already hosted on **SignalWire**. Jude MONITORS call events
  (missed calls, voicemails, new calls) and reports to the owner.
- Integration: SignalWire event webhooks/API (read-only monitoring).
- SMS to owner for important events (e.g., missed call from a lead).
- Explicitly: no outbound SMS via SignalWire (cost) — owner alerts via SNS.

### 4.3 Contact Center (subagents)
A subagent per channel, coordinated by Jude:
- **Emails subagent:** process inbound/outbound client email; summarize;
  draft replies (human-in-the-loop for anything legal).
- **Newsletter subagent:** manage subscribers + campaigns (mirrors the
  MetroTec newsletter capture pattern; sending needs SES production access).
- **Leads subagent (MOST COMPLEX):** capture, qualify, track, and nurture
  leads; full conversational follow-up via email/SMS; scoring; pipeline
  stages. This is the flagship piece of Jude.
- Important info from all three -> SMS to owner.

### 4.4 Scheduling Center
- Purpose: ONE centrally-managed calendar, synced across **Outlook,
  Google Calendar, and Zoom**.
- Integrations: Microsoft Graph (Outlook), Google Calendar API, Zoom API.
- Two-way sync; Jude creates/updates events and notifies the owner.
- NOTE: a related calendar-ai prototype already exists in the MetroTec
  project (calendar_service.py, zoom_service.py) — reuse candidate.

---

## 5. Owner communication rules (explicit)
- EMAIL (SES): full log/digest of all happenings; two-way conversation.
- SMS (SNS): only actionable/important items; two-way when needed.
- Jude decides importance (LLM-driven triage) — with safe defaults so the
  owner is never spammed by SMS.

---

## 6. Integrations summary
| Center      | External system                     | AWS/notes                     |
|-------------|-------------------------------------|-------------------------------|
| Ad          | Meta Marketing API, Google Ads API  | secrets in Secrets Manager    |
| Phone       | SignalWire (monitor only)           | webhook -> Lambda             |
| Emails      | SES (in/out)                        | production access needed      |
| Newsletter  | SES + DynamoDB subscribers          | reuse MetroTec pattern        |
| Leads       | DynamoDB + Bedrock + SNS/SES        | flagship subagent             |
| Scheduling  | MS Graph, Google Calendar, Zoom     | OAuth tokens in Secrets Mgr   |
| Owner comms | SNS (SMS) + SES (email)             | core                          |

---

## 7. Cross-cutting concerns
- **Secrets:** many third-party OAuth tokens/keys — store in AWS Secrets
  Manager, never in the repo or the public S3 bucket. (The project folder
  currently contains rds-credentials.json and a Google client_secret json —
  these must be kept OUT of any deploy.)
- **Security/privacy:** law-firm data is sensitive/confidential. Least-
  privilege IAM, encryption, no client data in public assets.
- **Legal guardrails:** Jude assists; it does not dispatch legal advice to
  clients autonomously. Human-in-the-loop for client-facing legal content.
- **Cost control:** AWS Budgets alarm; prefer cheap Bedrock (Nova); avoid
  SignalWire SMS.

---

## 8. Known blockers / prerequisites
1. **Bedrock NOT_AUTHORIZED** — enable model access (console) before Jude
   can reason. Scaffolding can be built now.
2. **SES sandbox** — request production access for real email send + arbitrary
   recipients (owner + clients + newsletter).
3. **OpenClaw** must be set up/running (Gateway, agent workspace, models,
   secrets) — `openclaw setup` / `configure` / `onboard`.
4. **Third-party API credentials** — Meta, Google Ads, MS Graph, Google
   Calendar, Zoom, SignalWire (read).

---

## 9. Proposed phased build plan
Phase 0 — This blueprint + OpenClaw environment setup + Secrets Manager.
Phase 1 — Owner comms backbone: SNS SMS + SES email in/out, Jude triage core.
Phase 2 — **Leads subagent** (flagship): capture -> qualify -> converse ->
          pipeline -> owner alerts. (Highest priority per owner.)
Phase 3 — Contact center: Emails + Newsletter subagents.
Phase 4 — Scheduling Center (Outlook/Google/Zoom sync; reuse calendar-ai).
Phase 5 — Phone Call Center monitoring (SignalWire events -> alerts).
Phase 6 — Ad Center (Meta + Google Ads monitoring/reporting).

Each phase reuses proven patterns from the MetroTec build (serverless API +
DynamoDB + Cognito + Bedrock + SNS/SES).

---

## 10. Open questions to finalize
- Where does Jude/OpenClaw run — a persistent host (EC2/container) vs.
  serverless? (OpenClaw Gateway is long-running -> likely a small instance.)
- Which Bedrock model for Jude (cost vs. capability)?
- Owner's mobile number + primary email for SNS/SES.
- Priority confirmation: build Leads first after the comms backbone?
