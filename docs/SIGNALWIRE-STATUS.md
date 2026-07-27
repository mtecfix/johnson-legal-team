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
| Business Number (toll-free) | **(833) 659-8378** |
| E.164 | `+18336598378` |
| SignalWire Number ID | `f10a1818-0f8e-4f58-8578-066614836e54` |
| Type | Tollfree |
| Purchased | Oct 7, 2025 at 7:32 PM UTC |
| Next Billed On | Aug 7, 2026 at 7:32 PM UTC |
| Capabilities | Voice, Fax, SMS (unverified) |
| Throughput | 1 Outbound Phone Call / sec (space-wide) |
| SMS Verification | **Unverified** — must verify to send/receive SMS |
| Provider | SignalWire |
| Owner Personal Number | (313) 404-0939 (Zelle/CashApp, not public) |
| Dashboard | `<space-name>.signalwire.com` — **Space URL / API credentials still needed** |

The (833) number appears on:
- Website header/footer (all pages)
- Contact page (emergency phone CTA)
- Google Business Profile
- Practice area pages (consultation CTA sections)
- All marketing/print materials

### AWS References to These Numbers

| Lambda | Env Var | Value | Purpose |
|--------|---------|-------|---------|
| jude-notify-owner | OWNER_PHONE | +18336598378 | SNS SMS alerts to business line |
| jude-inbox-monitor | OWNER_PHONE | +13134040939 | SNS SMS alerts to personal cell |

**Note:** The `jude-notify-owner` Lambda sends SMS to the **toll-free (833)** number,
while `jude-inbox-monitor` sends to the **personal (313)** number. This may be
intentional (different alert routing) or a config inconsistency to verify with owner.

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
| Space URL | SignalWire dashboard URL (e.g., `jlt.signalwire.com`) | Secrets Manager: `johnsonlegalteam/signalwire-api` |
| Project ID | Dashboard → API tab | Secrets Manager: `johnsonlegalteam/signalwire-api` |
| API Token | Dashboard → API tab | Secrets Manager: `johnsonlegalteam/signalwire-api` |

**These credentials are NOT anywhere in AWS, the repo, or the local environment.**
The owner (Attorney Rodney M. Johnson) or whoever set up the SignalWire account
originally needs to provide them, or grant MR TECH access to the SignalWire
dashboard.

### How to Find Them
1. Log into the SignalWire Space (the `.signalwire.com` URL used when the account was created)
2. Go to the **API** tab in the left sidebar
3. Copy: Space URL, Project ID, API Token
4. Store in Secrets Manager:
   ```bash
   aws secretsmanager create-secret \
     --name johnsonlegalteam/signalwire-api \
     --secret-string '{"space_url":"YOUR_SPACE.signalwire.com","project_id":"...","api_token":"..."}' \
     --region us-east-1
   ```

---

## Action Items

- [ ] **Get SignalWire Space URL, Project ID, and API Token** (blocking — need these to make API calls)
- [x] ~~Verify which number is the toll-free: confirm (833) 659-8378 is on SignalWire~~ — **Confirmed**, ID: `f10a1818-0f8e-4f58-8578-066614836e54`
- [ ] **Verify toll-free number for SMS** — currently "Unverified", meaning SMS send/receive may not work. Submit verification through SignalWire dashboard or API.
- [ ] Store credentials in AWS Secrets Manager (`johnsonlegalteam/signalwire-api`)
- [ ] Document current call flow / IVR configuration (what happens when someone calls the 833 number?)
- [ ] Resolve OWNER_PHONE inconsistency: jude-notify-owner uses +18336598378, jude-inbox-monitor uses +13134040939
- [ ] Build webhook Lambda for call event monitoring (Phase 5)
- [ ] Configure SignalWire Call Flow Builder to send events to webhook
- [ ] Review billing: next charge Aug 7, 2026 — confirm account is in good standing

---

## References

- [SignalWire REST API Docs](https://docs.signalwire.com/rest)
- [Phone Numbers Management](https://docs.signalwire.com/platform/dashboard/get-started/phone-numbers)
- [Call Flow Builder](https://docs.signalwire.com/platform/basics/guides/getting-started-without-code)
- [Jude Architecture Blueprint](./JUDE-ARCHITECTURE-BLUEPRINT.md) — §4.2 Phone Call Center
- [Jude OpenClaw Spec](./JUDE-OPENCLAW-SPEC.md) — `call-monitor` skill
