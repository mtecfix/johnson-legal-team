# Documentation

Architecture specs, auth flows, and design documents for the Johnson Legal Team platform.

## Documents

| File | Purpose | Status |
|------|---------|--------|
| `JUDE-OPENCLAW-SPEC.md` | **Primary spec** — Full Jude agent specification (v3). Covers model selection, AgentCore deployment, skills, persona, cost model, blockers. | Current (2026-07-10) |
| `JUDE-ARCHITECTURE-BLUEPRINT.md` | Original vision document (v1). High-level centers, integrations, phased plan. Superseded by the OpenClaw spec but useful for context. | Superseded |
| `AUTH_FLOW.md` | Client portal authentication flow (Cognito, MFA, roles) | Current |
| `openclaw_README.txt` | Notes on the OpenClaw framework | Reference |
| `ray_ray_corrections.md` | Content corrections | Reference |

## Key Decisions Documented

1. **Model provider:** Gemini 3.1 Flash-Lite (paid tier) — not Bedrock, not DeepSeek. See JUDE-OPENCLAW-SPEC §2.
2. **Runtime:** Bedrock AgentCore (serverless microVMs) — not App Runner, not EC2. See §3.
3. **Single-tenant:** One agent ("jude"), one session ("jude-main"), one caller (internal Lambdas). See §4.
4. **Email/SMS:** SES for all notifications, SNS for urgent-only SMS. See ARCHITECTURE-BLUEPRINT §5.
5. **Security:** VPC isolation, least-privilege IAM, KMS encryption, bearer token auth between internal services.
