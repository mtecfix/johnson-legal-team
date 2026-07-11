# Skill: filing-tracker

## Purpose
Monitor MiFILE notifications and court filing confirmations. Track filing
fees paid by Mr. Johnson that need reimbursement from clients.

## Backend
- Source: Gmail inbox (emails from info@truefiling.com)
- Storage: DynamoDB (jude-events table, type: "filing")

## Trigger
Activated by gmail-inbox skill when a MiFILE email is detected.

## Data to Extract

From MiFILE confirmation emails:
```json
{
  "type": "filing",
  "caseNumber": "26-02943-LT",
  "caseName": "PATEL V HUNT",
  "filingDate": "2026-06-09",
  "amount": 15.45,
  "status": "payment_successful",
  "reimbursementStatus": "pending",
  "clientEmail": null
}
```

## Logic

1. Parse the MiFILE email for case number, parties, and amount
2. Use case-lookup to match the case to a client
3. If client match found:
   - Log filing with client association
   - Flag in next digest: "Filing fee $XX.XX paid for [Case] — reimbursement pending"
4. If no client match:
   - Log filing without association
   - Include in digest as FYI

## Reimbursement Tracking

Mr. Johnson's pattern (from inbox analysis):
- He forwards the MiFILE receipt to the client
- Requests payment via CashApp ($johnsonlegalteam) or Zelle (313.404.0939)
- Sometimes needs to follow up ("I did not receive reimbursement for the filing fee")

Jude should:
- Track which filings have been reimbursed (detect CashApp/Zelle payment
  notifications matching the amount)
- After 7 days without reimbursement detected, include in digest:
  "Unreimbursed filing fee: $15.45, Case 26-02943-LT (7 days)"
- After 14 days, escalate to "requires follow-up" section of digest

## Do NOT
- Send reimbursement requests to clients directly
- Assume a payment notification matches a specific filing without amount match
- Delete or modify any filing records
