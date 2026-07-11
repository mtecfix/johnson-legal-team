# Skill: leads-triage

## Purpose
Process, classify, score, and route inbound leads from all sources.

## Trigger
Called when a new lead arrives via POST /hooks/new-lead from the jude-leads Lambda.

## Input Format
```json
{
  "leadId": "uuid",
  "source": "contact-form | lawyer.com | phone | email",
  "name": "string",
  "email": "string",
  "phone": "string",
  "practiceArea": "string (raw from form)",
  "description": "string (freetext from lead)",
  "location": "string",
  "score": 0-100,
  "timestamp": "ISO-8601"
}
```

## Classification Logic

### Practice Area Mapping
Map raw input to canonical practice areas:
| Raw terms | Canonical area |
|-----------|---------------|
| divorce, custody, child support, family, visitation, domestic | Family Law |
| probate, estate, will, trust, guardianship, conservatorship, POA | Probate & Estate |
| criminal, DUI, OWI, CCW, felony, misdemeanor, expungement | Criminal Defense |
| personal injury, car accident, slip and fall, premises liability | Personal Injury |
| real estate, deed, landlord, tenant, eviction, quiet title | Real Estate |
| juvenile, delinquency, minor | Juvenile |

### Scoring Adjustments (apply on top of rule-based score from Lambda)
| Factor | Adjustment |
|--------|-----------|
| Location in Wayne/Oakland County | +15 |
| Location in Metro Detroit (Macomb, Washtenaw) | +10 |
| Location outside Michigan | -40 |
| Time-sensitive language detected | +20 |
| Source is Lawyer.com | -20 |
| Matches active case (via case-lookup) | +25 |
| Practice area not in Mr. Johnson's scope | -30 |

### Urgency Signals (trigger SMS)
- "court date" / "hearing" + date within 7 days
- "arrested" / "in jail" / "detained"
- "accident" + "yesterday" or "today"
- "emergency" / "urgent" in description
- Existing client name match

## Output
1. Update lead record in DynamoDB with:
   - `canonicalPracticeArea`
   - `adjustedScore`
   - `urgencyLevel`: "high" | "medium" | "low"
   - `triageSummary`: one-sentence plain English
   - `recommendedAction`: "sms-notify" | "email-digest" | "log-only"
2. If recommendedAction is "sms-notify" → invoke owner-notify skill
3. If recommendedAction is "email-digest" → queue for next digest batch

## Do NOT
- Contact the lead directly
- Make promises about response time
- Discard any lead (even low-score ones stay in DynamoDB)
