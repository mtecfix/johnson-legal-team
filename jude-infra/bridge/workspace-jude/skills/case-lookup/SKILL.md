# Skill: case-lookup

## Purpose
Query the Johnson Legal Team client portal API to cross-reference contacts,
check existing client records, and provide case context for triage decisions.

## Backend
- Portal API: https://2hp2bdxsz6.execute-api.us-east-1.amazonaws.com
- Auth: Cognito JWT (service role token, super_admin group)
- DynamoDB: johnson-legal-portal-PortalTable-BSDJNMA75SSQ

## Available Endpoints (read-only)

| Endpoint | Purpose |
|----------|---------|
| GET /admin/clients | List all clients, search by name/email |
| GET /admin/registrations | Pending registrations |
| GET /profile?userId={id} | Specific client profile |
| GET /cases?userId={id} | Cases for a client |
| GET /invoices?userId={id} | Invoice history |

## Use Cases

### 1. "Is this lead already a client?"
Before classifying a new lead, check:
```
GET /admin/clients?search={email or name}
```
If match found → flag as "existing client contact" → higher priority.

### 2. "What case is this court email about?"
When a court email references a case number or client name:
- Search clients by name
- Check if case number appears in case records
- Add context to the notification ("Re: active probate case, Robinson")

### 3. "Does this client have an outstanding balance?"
When payment-related emails arrive:
```
GET /invoices?userId={id}&status=pending
```
Mention in owner notification if relevant.

## Confidentiality Rules

- ALL data from this skill is attorney-client privileged
- Never include case-lookup results in any external communication
- Never store raw case data in lead records (store only: "existing client: yes/no")
- Never expose client names, case numbers, or case details outside the
  owner-notify channel
- If a lead matches an existing client, note this ONLY in the owner
  notification — never tell the lead "we already represent you" or
  similar (that's Mr. Johnson's call)

## Error Handling

- If portal API is unreachable, proceed with triage without client context
- Note in the notification: "⚠️ Could not verify against client database"
- Never block or delay a notification because case-lookup failed
