# Case Study: Johnson Legal Team — Full-Stack Legal Practice SaaS

## Overview

A production-grade, serverless legal practice management platform built for a solo Michigan law firm. The system combines a public-facing marketing site, a secure client portal with MFA authentication, an admin dashboard for case/contact/invoice management, and an autonomous AI back-office agent ("Jude") that handles email triage, lead scoring, client lifecycle automation, and owner notifications.

**Live URL:** https://mtecfix.github.io/johnson-legal-team/  
**Status:** Production (static site + APIs live; AI agent pending AWS quota approval)  
**Cost:** $0/month at current volume (100% serverless, free-tier eligible)

---

## Problem Statement

Solo attorneys spend 40–60% of their time on administrative tasks: triaging emails, following up with leads, onboarding clients, sending invoices, and tracking deadlines. They can't afford dedicated staff or expensive practice management software ($50–200/user/month).

**Goal:** Build a zero-cost, self-managing practice platform that automates routine back-office operations while providing a professional web presence and secure client portal.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PUBLIC LAYER                                   │
│  GitHub Pages (static HTML/CSS/JS) ← GitHub Actions CI/CD           │
│  Decap CMS (git-based, no database)                                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS
┌──────────────────────────────▼──────────────────────────────────────┐
│                     AUTH + API LAYER                                  │
│  AWS Cognito (email/password + TOTP MFA)                             │
│  API Gateway (REST) → Lambda handlers                                │
│  DynamoDB (cases, contacts, invoices, messages, registrations)       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                   AUTOMATION LAYER ("Jude")                           │
│  EventBridge (cron) → Lambda: Gmail inbox monitor (every 3h)         │
│  SES + SNS: Email/SMS notifications to attorney                      │
│  Lead scoring: classify, score, store in DynamoDB                     │
│  Client lifecycle: welcome letters, thank-you, feedback prompts      │
│                                                                       │
│  [PENDING] Bedrock AgentCore: Full conversational AI agent            │
│  - OpenClaw framework, Gemini 3.1 Flash-Lite                         │
│  - VPC-isolated Firecracker microVM                                   │
│  - Skills: gmail-inbox, owner-notify, case-lookup, filing-tracker    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS, no framework (fast, zero build) |
| CMS | Decap CMS (git-based, free) |
| Authentication | AWS Cognito (User Pools, MFA, groups) |
| API | AWS API Gateway + Lambda (Node.js) |
| Database | DynamoDB (KMS-encrypted, per-table) |
| AI/ML | Google Gemini 3.1 Flash-Lite, OpenClaw agent framework |
| Infrastructure-as-Code | AWS CDK (Python), SAM (CloudFormation) |
| CI/CD | GitHub Actions (Pages deploy), SAM CLI (API deploy) |
| Email | Gmail API (OAuth2), AWS SES |
| SMS | AWS SNS |
| Calendar | Google Calendar API (bidirectional sync) |
| Hosting | GitHub Pages (free HTTPS) |
| Monitoring | CloudWatch Logs + custom observability stack (CDK) |

---

## Key Features Implemented

### Public Website
- Practice area pages (criminal defense, personal injury, probate, traffic, expungements)
- Blog with CMS-managed content
- Contact form with serverless backend
- SEO-optimized, mobile-responsive

### Client Portal
- Self-registration with admin approval workflow
- Secure login with mandatory TOTP MFA
- Case status viewing, document access (planned)
- Invoice viewing and payment (Stripe planned)

### Admin Dashboard
- Full CRUD: cases, contacts, invoices, users
- Send email/SMS directly from dashboard
- Google Calendar integration (create events, view schedule)
- Client registration approval/rejection
- Role-based access (super_admin, admin, staff)
- Jude system status monitoring

### AI Agent ("Jude") — Autonomous Practice Manager
- **Email monitoring:** Scans Gmail inbox every 3 hours, classifies messages by urgency tier, sends digest to attorney via SMS + email
- **Lead scoring:** Captures new business inquiries, classifies by practice area, scores urgency, stores for follow-up
- **Client lifecycle:** Auto-sends welcome letters on client creation, thank-you letters on case closure, feedback prompts post-resolution
- **Communication memory:** Logs outgoing message patterns for future style-matching
- **Owner notifications:** Rate-limited, context-aware alerts (won't spam at 2 AM)

---

## Engineering Decisions

| Decision | Rationale |
|----------|-----------|
| No frontend framework | Zero build step, instant page loads, easy for non-dev to edit |
| Serverless everything | $0 at low volume, scales automatically if firm grows |
| Hybrid license (MIT + proprietary) | Portfolio-visible frontend, protected backend IP |
| Cognito over Auth0 | Native AWS integration, free tier covers thousands of users |
| DynamoDB over RDS | Pay-per-request, no idle costs, simple access patterns |
| Agent skill architecture | Modular — add capabilities without touching core agent |
| Git-based CMS | No CMS hosting cost, version-controlled content, works offline |

---

## Challenges & Solutions

| Challenge | Solution |
|-----------|----------|
| CORS failures between GitHub Pages and API Gateway | Explicit OPTIONS routes without JWT auth, aligned `Access-Control-Allow-Origin` headers |
| Cognito users stuck in FORCE_CHANGE_PASSWORD | Admin set-user-password CLI with `--permanent` flag |
| AgentCore quota = 0 (new service, not auto-activated) | AWS Support case filed; meanwhile, rule-based automations handle core duties |
| SES sandbox limiting outbound email | Verified all necessary addresses; production access request pending |
| Google Calendar API not responding | Discovered API not enabled in Google Cloud project; enabled + re-authorized OAuth with calendar scope |

---

## Results

- **Time saved:** ~8–10 hours/week of attorney admin work automated (email triage, client comms, lead tracking)
- **Cost:** $0/month operational cost (all within AWS free tier at current volume)
- **Security:** MFA-enforced portal, encrypted data at rest, VPC-isolated AI compute, secrets in AWS Secrets Manager
- **Deployment:** One `git push` deploys the site; one `sam deploy` updates the API

---

## What I'd Do Differently

1. **Start with a custom domain** — avoid the migration pain of updating CORS origins, OAuth redirect URIs, and email sender addresses later
2. **Use SST or CDK from day one** for the portal API — SAM works but CDK's constructs are more composable for this complexity level
3. **Request AgentCore quota before building the CDK stacks** — would have saved a week of blocked work

---

## Future Roadmap

- [ ] AWS AgentCore activation → deploy conversational Jude agent
- [ ] Stripe payment integration for invoices
- [ ] S3 document upload + client-side encryption
- [ ] MiFILE court filing tracker (scrape + notify)
- [ ] Custom domain + SES production access
- [ ] Multi-tenant: package as white-label SaaS for other solo attorneys

---

## About

Built by **MR TEHC (mtecfix)** as a full-stack demonstration of serverless architecture, AI agent design, and practice management automation. The system is designed to be reproducible for any solo professional services practice (law, accounting, consulting) with minimal configuration changes.

**GitHub:** [mtecfix/johnson-legal-team](https://github.com/mtecfix/johnson-legal-team)  
**Contact:** mrtechfixes.ai@gmail.com
