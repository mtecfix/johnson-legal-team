# Skill: owner-notify

## Purpose
Deliver notifications to Mr. Johnson via the appropriate channel (SMS or email)
based on urgency classification from other skills.

## Backend
Invokes the `jude-notify-owner` Lambda which handles:
- SNS SMS → Mr. Johnson's phone (urgent)
- SES email → Mr. Johnson's email (digest/informational)

## SMS Notification Format

Keep SMS under 300 characters. Structure:

```
[CATEGORY] One-line summary
Key detail (who/what/when)
```

### Examples by category:

**Court:**
```
[COURT] Docket assignment: 36th Dist, Mon 7/13 8:30AM
Judge Ramsey-Heath, Rm 437. Phil Walling assisting.
```

**Lead (high priority):**
```
[LEAD-HIGH] PI/Auto accident, Southfield MI
"Rear-ended yesterday on 696, neck injury" — Score 82
```

**Client (active case):**
```
[CLIENT] Kenya Ruth — scheduling conflict
Wayne Co wants 6/24 1PM. Ms Ruth unavailable. Needs reply.
```

**Filing deadline:**
```
[DEADLINE] Discovery due: Brundidge/Ross 26-000710-NA
AG submitted witness list. Response window closing.
```

## Email Digest Format

Subject line: `Jude Brief — [Day, Month Date]`

```
REQUIRES ACTION (2):
━━━━━━━━━━━━━━━━━━
1. [Court] Docket assignment Mon 7/13 — need confirmation
2. [Client] Nadine Waller re: Living Trust — awaiting your reply since 7/7

NEW LEADS (3):
━━━━━━━━━━━━━
1. ★ Child Support, Oakland MI — "father, no existing order" (Score 65)
2. Property Damage, Westland MI — "neighbor's tree fell on car" (Score 52)
3. Wills & Probate, Detroit MI — "mother passed, no will" (Score 71)

INBOX ACTIVITY:
━━━━━━━━━━━━━━
• 4 Lawyer.com referrals received (all logged, none high-priority)
• Filing confirmation: 26-02943-LT payment $15.45 processed
• LinkedIn: 7 new job alerts (ignored)

NO ACTION / FYI:
━━━━━━━━━━━━━━━
• Google security alerts (account recovery confirmed)
• PayPal notification (payment received)
```

## Rate Limits

| Channel | Limit | Window |
|---------|-------|--------|
| SMS | 3 max | per hour |
| SMS | 1 max | per distinct event |
| Email digest | 2 max | per day (AM brief + PM wrap) |
| Urgent email (non-digest) | no limit | only for true emergencies |

## Travel Mode

When Mr. Johnson is detected as traveling (hotel confirmations, "out of
the country" language in recent sent mail, flight confirmations):
- Suppress all SMS except court deadlines and client emergencies
- Switch to email-only with subject prefix: `[TRAVEL MODE]`
- Batch more aggressively (one email per day max unless emergency)

## Do NOT
- Include full client case details in SMS (too exposed)
- Send SMS for Lawyer.com referrals regardless of score
- CC anyone other than Mr. Johnson
- Include privileged case information in email subject lines
