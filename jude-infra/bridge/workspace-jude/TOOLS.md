# Tool Usage Notes

## leads-triage

- **Access:** Read/update only. Never delete a lead record.
- **Stage transitions:** new → contacted → qualified → converted → lost
  (forward only; never regress a stage without explicit owner instruction).
- **Scoring adjustments:** You may increase a lead's score if inbox context
  reveals urgency (e.g., lead mentions an imminent court date). You may
  decrease score if lead is clearly outside service area or practice scope.
- **Lawyer.com leads:** Default to low priority. Mr. Johnson has expressed
  dissatisfaction with lead quality from this source ("I have not obtained
  business nor a serious consideration in six months"). Only escalate if
  the lead is in Wayne/Oakland County AND matches a core practice area
  (family, criminal, probate, PI).

## owner-notify

- **SMS rate limit:** Maximum 3 per hour. Maximum 1 per distinct event.
  If multiple events queue up within a 10-minute window, combine into a
  single message with bullet points.
- **Email:** No hard rate limit, but batch non-urgent items into a digest
  rather than sending individual emails for each event.
- **Travel mode:** When hotel confirmations or "out of the country" language
  is detected in recent sent mail, switch to email-only unless it's a court
  deadline or client emergency. Do not SMS for leads during travel.
- **Format for SMS:**
  ```
  [URGENT] Court docket: 36th Dist, Mon 7/13 8:30AM, Judge Ramsey-Heath
  ```
  ```
  [LEAD] PI/Slip-fall, Southfield MI — "fell at grocery store yesterday"
  ```
- **Format for email digest:**
  ```
  Subject: Jude Daily Brief — [date]

  REQUIRES ACTION:
  • [item]

  NEW LEADS (3):
  • [summary]

  FYI / NO ACTION:
  • [item]
  ```

## case-lookup

- **Access:** Admin-scoped, read-only via portal API.
- **Purpose:** Cross-reference incoming leads/emails against existing clients.
  Determine if a new contact is already in the system, or related to an
  existing case.
- **Confidentiality:** Every field returned is attorney-client privileged.
  Never include case-lookup data in any outbound communication except
  owner notifications. Never log raw case data in lead records.
- **Use cases:**
  - "Is this person already a client?" → check before treating as new lead
  - "What case is this related to?" → match incoming court emails to cases
  - "Does this client have outstanding invoices?" → context for owner

## gmail-inbox (planned)

- **Access:** Read-only via Gmail API (OAuth refresh token in Secrets Manager).
- **Account:** johnsonlegalteam@gmail.com
- **Purpose:** Monitor incoming email for court notices, client replies,
  deadlines, and new inquiries that bypass the contact form.
- **High-priority senders** (always flag immediately):
  - *@36thdistrictcourtmi.gov — court docket, scheduling
  - *@3rdcc.org — 3rd Circuit Court
  - *@waynecountymi.gov — Wayne County casework
  - *@michigan.gov — Michigan AG
  - *@detroitmi.gov — City of Detroit legal
  - Any sender with an active client folder label
- **Ignore/low-priority:**
  - referrals@corp.lawyer.com (Lawyer.com — being canceled)
  - Newsletters, LinkedIn, Google Alerts, job boards
  - PayPal/CashApp notifications (log but don't alert)
- **Pattern detection:**
  - Flag emails that have been unread > 24 hours from high-priority senders
  - Detect scheduling conflicts (two court dates same day/time)
  - Track response-time patterns to identify dropped threads

## filing-tracker (planned)

- **Purpose:** Monitor MiFILE notifications and court filing confirmations.
- **Actions:** Log filing, note payment amount, flag if reimbursement needed
  from client.
- **Source:** Emails from info@truefiling.com, noreply@courts.michigan.gov
