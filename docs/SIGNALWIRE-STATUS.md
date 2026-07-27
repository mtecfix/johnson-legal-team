# SignalWire Integration — Status & Documentation

_Project: Johnson Legal Team_
_Last updated: 2026-07-27_

---

## Current State

**Status: NOT INTEGRATED (Phase 5 — Not Started)**

The firm's phone system runs on SignalWire independently of the website and AWS
infrastructure. No API credentials, webhooks, or programmatic connections exist
between SignalWire and the Jude/AWS stack.

---

## Existing Phone Setup

| Item | Value |
|------|-------|
| Business Number | (833) 659-8378 |
| Provider | SignalWire |
| Format | Toll-free (1-833) |
| Usage | Inbound calls, voicemail, IVR |
| Dashboard | `<space-name>.signalwire.com` (credentials with owner) |

The number appears on:
- Website header/footer (all pages)
- Contact page
- Google Business Profile
- Practice area pages (CTA sections)

---

## Planned Integration (Phase 5)

Per the [Jude Architecture Blueprint](./JUDE-ARCHITECTURE-BLUEPRINT.md), the
SignalWire integration is **read-only monitoring**:

### What Jude Will Do
- Monitor call events (missed calls, voicemails, new calls)
- Report important events to the owner via SMS (SNS) and email (SES)
- Track call patterns for lead qualification

### What Jude Will NOT Do
- Make outbound calls
- Send SMS via SignalWire (cost — uses AWS SNS instead)
- Modify call flows or IVR settings
- Handle calls programmatically

### Technical Architecture
```
SignalWire Call Events
        │
        ▼ (webhook)
   API Gateway / Lambda
        │
        ▼
   Jude (Bedrock) — triage importance
        │
        ├─→ SNS SMS to owner (urgent: missed call from lead)
        └─→ SES email digest (daily call summary)
```

### Prerequisites Before Building
1. **SignalWire API credentials** — Project ID, API Token, Space URL
   - Must be obtained from the owner's SignalWire dashboard
   - Store in AWS Secrets Manager as `johnsonlegalteam/signalwire-api`
2. **Webhook endpoint** — Lambda function + API Gateway URL to receive call events
3. **Call Flow Builder** — Configure SignalWire to POST events to our webhook
4. **Owner confirmation** — Which events to alert on (all missed calls? only during business hours?)

---

## Required Credentials (Not Yet Stored)

| Secret | Where to Find | Store In |
|--------|---------------|----------|
| Space URL | SignalWire dashboard URL (e.g., `jlt.signalwire.com`) | Secrets Manager |
| Project ID | Dashboard → API tab | Secrets Manager |
| API Token | Dashboard → API tab | Secrets Manager |

---

## Action Items

- [ ] Get SignalWire Space URL, Project ID, and API Token from owner
- [ ] Store credentials in AWS Secrets Manager
- [ ] Verify phone number ownership via API: `GET /api/relay/rest/phone_numbers`
- [ ] Document current call flow / IVR configuration
- [ ] Build webhook Lambda for call event monitoring (Phase 5)
- [ ] Configure SignalWire Call Flow Builder to send events to webhook

---

## References

- [SignalWire REST API Docs](https://docs.signalwire.com/rest)
- [Phone Numbers Management](https://docs.signalwire.com/platform/dashboard/get-started/phone-numbers)
- [Call Flow Builder](https://docs.signalwire.com/platform/basics/guides/getting-started-without-code)
- [Jude Architecture Blueprint](./JUDE-ARCHITECTURE-BLUEPRINT.md) — §4.2 Phone Call Center
- [Jude OpenClaw Spec](./JUDE-OPENCLAW-SPEC.md) — `call-monitor` skill
