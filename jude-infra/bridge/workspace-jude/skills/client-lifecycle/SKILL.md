# Skill: client-lifecycle

## Purpose
Handle automated notifications and correspondence triggered by client lifecycle
events — specifically new client creation and case closure. Jude acts as the
firm's concierge: notifying the admin (Mr. Johnson) of events and offering to
send professional correspondence to clients.

## Trigger Events

### 1. CLIENT CREATED (new contact with role "client" added to system)

**Immediate actions:**
1. Send admin notification (owner-notify) informing Mr. Johnson a new client
   has been added:
   ```
   [CLIENT-NEW] {First Last} added to portal
   Email: {email} | Phone: {phone}
   Would you like onboarding docs sent? Reply YES to send welcome packet.
   ```

2. If admin confirms (or auto-send is enabled), dispatch a **Welcome Letter**
   to the client via email (SES):

   **Subject:** Welcome to Johnson Legal Team — Getting Started

   **Tone:** Warm yet professional. The client should feel valued and informed.

   **Content must include:**
   - Personalized greeting using client's first name
   - Confirmation they are now a client of the firm
   - Introduction to Attorney Rodney M. Johnson
   - What to expect next (initial consultation, document gathering)
   - How to contact the office (phone, email)
   - Client portal access instructions (if applicable)
   - Office hours and response time expectations
   - Confidentiality assurance

3. After sending welcome letter, ask admin:
   ```
   Welcome letter sent to {client email}.
   Want me to send the intake questionnaire to learn more about their matter?
   ```

### 2. CASE CLOSED (case status changed to "closed")

**Immediate actions:**
1. Send admin notification:
   ```
   [CASE-CLOSED] {Client Name} — {case_type}
   Case {case_id} closed on {date}.
   Would you like a thank-you letter sent to {client_name}? Reply YES to send.
   ```

2. If admin confirms (or auto-send is enabled), dispatch a **Thank You Letter**
   to the client via email (SES):

   **Subject:** Thank You — Johnson Legal Team

   **Tone:** Grateful, professional, with an invitation to stay connected.

   **Content must include:**
   - Thank the client for trusting the firm
   - Brief acknowledgment that their matter has been resolved
   - Invitation to reach out for any future legal needs
   - Request for a Google review (include direct link)
   - Referral encouragement ("If you know someone who needs legal help...")
   - Contact info for future reference

3. After sending thank-you letter, ask admin:
   ```
   Thank-you letter sent to {client email}.
   Want me to send a feedback request to {client name}? (Helps with reviews & improvement)
   ```

4. If admin confirms feedback request, send a **Feedback Request** email:

   **Subject:** How Did We Do? — Johnson Legal Team

   **Tone:** Brief, friendly, low-pressure.

   **Content:**
   - 1-2 sentences thanking them again
   - Simple question: "How was your experience working with us?"
   - Google Review link
   - Option to reply directly with private feedback
   - "Your feedback helps us serve our community better."

---

## Email Templates

### Welcome Letter Template

```
Dear {first_name},

Welcome to Johnson Legal Team! I'm pleased to confirm that you are now a
client of our firm. Attorney Rodney M. Johnson will be handling your matter
personally.

WHAT HAPPENS NEXT:
• We will review the details of your case and reach out to schedule an
  initial consultation (in person or by phone).
• If we need any documents or information from you, we'll let you know
  exactly what's needed.
• You can expect to hear from us within 1-2 business days.

HOW TO REACH US:
• Phone: (833) 659-8378
• Email: johnsonlegalteam@gmail.com
• Hours: Monday–Friday, 9:00 AM – 5:00 PM ET

IMPORTANT:
All communications between you and our office are protected by
attorney-client privilege. Your privacy is our priority.

We look forward to working with you.

Warm regards,
Rodney M. Johnson, Esq.
Johnson Legal Team, PLLC
```

### Thank You Letter Template

```
Dear {first_name},

Thank you for trusting Johnson Legal Team with your legal matter. It has
been a privilege to represent you, and I'm glad we could bring your case
to resolution.

YOUR FILE:
Your case file will be retained per our records policy. If you ever need
copies of documents or have questions about your matter, don't hesitate
to reach out.

FUTURE NEEDS:
Should you or anyone you know need legal assistance in the future —
family law, criminal defense, probate, real estate, or personal injury —
we are always here to help.

SHARE YOUR EXPERIENCE:
If you had a positive experience, a Google review helps others in our
community find quality legal representation:
→ [Google Review Link]

Thank you again for choosing Johnson Legal Team.

With appreciation,
Rodney M. Johnson, Esq.
Johnson Legal Team, PLLC
(833) 659-8378
```

### Feedback Request Template

```
Hi {first_name},

Now that your matter with Johnson Legal Team is complete, I'd love to
hear how your experience was.

Your feedback — whether it's a quick Google review or a reply to this
email — helps us improve and serve our community better.

→ Leave a Google Review: [link]

Or simply reply to this email with any thoughts. No pressure — I
appreciate your time either way.

Thank you,
Johnson Legal Team
```

---

## Implementation Notes

### Portal API Integration
The portal Lambda fires a lifecycle event when:
- `POST /admin/clients` succeeds → triggers `CLIENT_CREATED` event
- `PUT /admin/cases` with `status: "closed"` → triggers `CASE_CLOSED` event

Events are published to an internal notification queue that Jude processes.
Until the full OpenClaw pipeline is deployed, the portal Lambda handles
the admin notification directly via the existing admin messaging system.

### Auto-Send Configuration
For the initial deployment, all letters require admin confirmation (reply YES).
Once confidence is established, auto-send can be enabled per event type via
a `LIFECYCLE_AUTO_SEND` environment variable:
- `none` — always ask (default)
- `welcome` — auto-send welcome letters only
- `all` — auto-send welcome + thank you + feedback

### Guardrails
- NEVER include case details, outcomes, or legal specifics in any
  client-facing letter (especially the thank-you — it could be
  discoverable in future litigation)
- Welcome letter must NOT promise specific outcomes or timelines
  beyond "we will be in touch"
- Feedback request must not be pushy — one email only, never follow up
- All emails use the firm's branded HTML template (navy + gold)
- BCC the firm inbox on all outgoing lifecycle emails for records

### Metrics
Track for each event type:
- Notification sent to admin (timestamp)
- Admin response (YES/NO/no response within 24h)
- Client email dispatched (timestamp, delivery status)
- Client opened email (if tracking pixels enabled — optional)
- Google review left within 7 days (check via Places API — future)
