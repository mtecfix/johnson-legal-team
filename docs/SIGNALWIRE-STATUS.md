# SignalWire Integration — Status & Documentation

_Project: Johnson Legal Team_
_Last updated: 2026-07-27_

---

## Current State

**Status: ✅ PHONE LINE ACTIVE — Forwarding to owner's cell**

The phone number (833) 659-8378 is now configured to answer calls via a SWML script
that greets callers and forwards to the owner's cell phone. Voicemail is recorded
if no one answers.

Configured: **July 27, 2026 at 1:59 PM UTC**

---

## Account Details

| Item | Value |
|------|-------|
| Space URL | `mr-tech-fixes.signalwire.com` |
| Project ID | `e812b295-f230-4a60-a784-e74b60a4e14c` |
| Project Name | Main |
| Account Status | **Active** |
| Account Created | Oct 5, 2025 |
| Region | us-west |
| AWS Secret | `johnsonlegalteam/signalwire-api` (Secrets Manager, us-east-1) |

### API Token Scopes (PT token)

| Endpoint | Access |
|----------|--------|
| Account Info | ✅ |
| Calls (list/read) | ✅ |
| Recordings | ✅ |
| Applications | ✅ |
| Queues | ✅ |
| Phone Numbers (list/config) | ❌ Unauthorized |
| Messages | ❌ Unauthorized |

**Note:** The current API token (`PT...`) has limited scopes. To configure the
phone number's call handler via API, a token with "Numbers" scope is needed.
This can be done from the dashboard UI instead.

## Existing Phone Setup

| Item | Value |
|------|-------|
| Business Number (toll-free) | **(833) 659-8378** |
| E.164 | `+18336598378` |
| SignalWire Number ID | `f10a1818-0f8e-4f58-8578-066614836e54` |
| Type | Tollfree |
| Purchased | Oct 7, 2025 at 7:32 PM UTC |
| Next Billed On | Aug 7, 2026 at 7:32 PM UTC |
| Capabilities | Voice (SMS unverified) |
| Throughput | 1 Outbound Phone Call / sec (space-wide) |
| SMS Verification | **Unverified** — cannot send/receive SMS until verified |
| Call Handler | **SWML Script: forward-to-owner** (active) |
| Voice URL | `https://mr-tech-fixes.signalwire.com/relay-bins/85f2253f-5d5b-4272-847c-67e7f2529b42` |
| Call Flow (IVR, built but not assigned) | "Johnson Legal Team" (ID: e90ed97d-2a3e-493c-b871-432d1baebf98) |
| Applications | None |
| Queues | None |
| Recordings | None |

### Current Call Handling (SWML: forward-to-owner)

When someone calls (833) 659-8378:
1. Call is answered
2. Caller hears: *"Thank you for calling Johnson Legal Team. Please hold while we connect you."*
3. Call forwards to **+1 (313) 404-0939** (owner's cell) — 30 second timeout
4. If no answer: *"We are sorry, no one is available. Please leave a message after the beep."*
5. Voicemail is recorded

### Existing IVR Call Flow (built, NOT currently assigned)

A more professional IVR exists in the account ("Johnson Legal Team", v441) with:
- **Press 1** = Billing (hold music → account number → AI agent → forward to 313-355-2216)
- **Press 2** = Online Support (message prompt → voicemail)
- **Press 3** = Talk to a Lawyer (forward to 313-355-2216)
- **Press 4** = Leave a Message (voicemail)
- Voice: Amazon Polly Kendra (female, en-US)
- AI Agent: `90766844-494d-4147-8f15-a9bdb77557e8`

To switch to the IVR: In the dashboard, go to Phone Numbers → (833) number → 
set "Handle Calls Using" to the "Johnson Legal Team" call flow.

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

## Required Credentials (Now Stored ✅)

Credentials stored in AWS Secrets Manager:
```
Secret Name: johnsonlegalteam/signalwire-api
Region: us-east-1
ARN: arn:aws:secretsmanager:us-east-1:663877906756:secret:johnsonlegalteam/signalwire-api-wJmxwL
```

Contents:
```json
{
  "space_url": "mr-tech-fixes.signalwire.com",
  "project_id": "e812b295-f230-4a60-a784-e74b60a4e14c",
  "api_token": "PT..."
}
```

**Limitation:** The stored token has restricted scopes (no Numbers, no Messages).
To manage the phone number configuration or send SMS, either:
1. Use the SignalWire dashboard UI directly, OR
2. Generate a new API token with full scopes from Dashboard → Settings → API

---

## Action Items

### ✅ RESOLVED — Phone Now Answering
- [x] ~~Configure call handler on (833) 659-8378~~ — **Done**, forwarding to owner's cell via SWML script

### High Priority
- [ ] **Consider switching to the full IVR call flow** — "Johnson Legal Team" IVR is built and ready (menu with Billing/Support/Lawyer/Voicemail). Assign via dashboard: Phone Numbers → 833 → Handle Using: Call Flow.
- [ ] **Verify toll-free number for SMS** — currently "Unverified", SMS cannot be sent/received
- [ ] **Generate full-scope API token** — current PT token works for compatibility API but may have edge cases. Create new token from Dashboard → Settings → API with all scopes.
- [ ] Update Secrets Manager with new full-scope token once created

### Medium Priority (Phase 5 — Jude Integration)
- [x] ~~Get SignalWire Space URL, Project ID, and API Token~~ — **Done**, stored in Secrets Manager
- [x] ~~Verify which number is the toll-free~~ — **Confirmed**, ID: `f10a1818-0f8e-4f58-8578-066614836e54`
- [ ] Resolve OWNER_PHONE inconsistency: jude-notify-owner uses +18336598378, jude-inbox-monitor uses +13134040939
- [ ] Build webhook Lambda for call event monitoring
- [ ] Configure SignalWire status_callback URL to POST call events to webhook
- [ ] Review billing: next charge Aug 7, 2026

---

## References

- [SignalWire REST API Docs](https://docs.signalwire.com/rest)
- [Phone Numbers Management](https://docs.signalwire.com/platform/dashboard/get-started/phone-numbers)
- [Call Flow Builder](https://docs.signalwire.com/platform/basics/guides/getting-started-without-code)
- [Jude Architecture Blueprint](./JUDE-ARCHITECTURE-BLUEPRINT.md) — §4.2 Phone Call Center
- [Jude OpenClaw Spec](./JUDE-OPENCLAW-SPEC.md) — `call-monitor` skill

---

## Known Limitations (discovered 2026-07-27)

### Account Restrictions
1. **SWML not functional** — relay-bins (SWML JSON) don't execute on calls. Only LaML (XML) 
   via `laml-bins` works. This blocks AI agent usage.
2. **Action URLs don't fire** — Secondary URL fetches during calls (e.g., `<Dial action="...">`) 
   don't work. Voicemail after decline/timeout doesn't trigger.
3. **Verified caller ID required** — Only numbers in the verified caller ID list can call in. 
   Unverified numbers get "call cannot be completed" with no log entry.
4. **Outbound API works fine** — All URL fetching works for outbound API-initiated calls.

### Impact
- Voicemail doesn't play after declined/missed calls
- AI receptionist cannot be used (requires SWML)
- Only pre-verified numbers can call the business lines

### Recommended Actions
- Open a SignalWire support ticket about SWML execution and action URL fetching
- Ask if trial mode restrictions are still active despite "Full" account type
- Consider hosting a webhook on AWS Lambda for dynamic call routing
