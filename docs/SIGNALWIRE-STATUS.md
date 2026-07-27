# SignalWire Integration — Status & Documentation

_Project: Johnson Legal Team_
_Last updated: 2026-07-27_

---

## Current State

**Status: CREDENTIALS STORED — Phone number NOT FUNCTIONAL**

The SignalWire account is active and API-accessible, but the phone number has
**no call handler configured**. All inbound calls are failing. The number needs
a call flow, forwarding rule, or SWML script assigned before it can answer calls.

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
| Call Handler | **⚠️ NONE CONFIGURED — ALL CALLS FAILING** |
| Applications | None |
| Queues | None |
| Recordings | None |

### ⚠️ CRITICAL ISSUE: Phone Number Not Answering Calls

**Every inbound call to (833) 659-8378 is failing.** There is no call flow,
forwarding rule, SWML script, or cXML application assigned to the number.

Call log (all 13 calls on record — ALL failed):
```
May 5, 2026  | +10000000000   -> +18336598378 | FAILED | 1s
May 4, 2026  | +13138259374   -> +18336598378 | FAILED | 2s  (5 attempts)
Apr 16, 2026 | +13138259374   -> +18336598378 | FAILED | 5s
Apr 15, 2026 | +13138259374   -> +18336598378 | FAILED | 5s  (5 attempts)
```

The caller +13138259374 appears to be someone testing the line repeatedly.
No calls have successfully connected since the number was purchased.

### To Fix (Minimum Viable — Forward to Owner's Cell)

From the SignalWire dashboard (`mr-tech-fixes.signalwire.com`):
1. Go to **Phone Numbers** → click the (833) number
2. Under **Incoming Call Settings**, set **Handle Calls Using** to one of:
   - **Call Flow Builder** — to create an IVR/menu
   - **SWML Script** — for programmatic handling
   - **cXML Webhook** — point to a URL that returns XML instructions
   - **Forward** — simple forward to `+13134040939` (owner's cell)

Or via API (needs a token with "Numbers" scope):
```bash
curl -X PUT "https://mr-tech-fixes.signalwire.com/api/relay/rest/phone_numbers/f10a1818-0f8e-4f58-8578-066614836e54" \
  -u "<project_id>:<token_with_numbers_scope>" \
  -H "Content-Type: application/json" \
  -d '{"call_handler": "laml_webhooks", "call_request_url": "<your_webhook_url>"}'
```

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

### 🔴 URGENT — Phone Not Working
- [ ] **Configure call handler on (833) 659-8378** — currently ALL calls fail. At minimum, set up forwarding to owner's cell (+13134040939) via the SignalWire dashboard.

### High Priority
- [ ] **Verify toll-free number for SMS** — currently "Unverified", SMS cannot be sent/received
- [ ] **Generate full-scope API token** — current PT token lacks Numbers and Messages access. Create new token from Dashboard → Settings → API with all scopes enabled.
- [ ] Update Secrets Manager with new full-scope token once created

### Medium Priority (Phase 5 — Jude Integration)
- [x] ~~Get SignalWire Space URL, Project ID, and API Token~~ — **Done**, stored in Secrets Manager
- [x] ~~Verify which number is the toll-free~~ — **Confirmed**, ID: `f10a1818-0f8e-4f58-8578-066614836e54`
- [ ] Resolve OWNER_PHONE inconsistency: jude-notify-owner uses +18336598378, jude-inbox-monitor uses +13134040939
- [ ] Build webhook Lambda for call event monitoring
- [ ] Configure SignalWire to POST call events to webhook
- [ ] Review billing: next charge Aug 7, 2026 — confirm account is in good standing

---

## References

- [SignalWire REST API Docs](https://docs.signalwire.com/rest)
- [Phone Numbers Management](https://docs.signalwire.com/platform/dashboard/get-started/phone-numbers)
- [Call Flow Builder](https://docs.signalwire.com/platform/basics/guides/getting-started-without-code)
- [Jude Architecture Blueprint](./JUDE-ARCHITECTURE-BLUEPRINT.md) — §4.2 Phone Call Center
- [Jude OpenClaw Spec](./JUDE-OPENCLAW-SPEC.md) — `call-monitor` skill
