# Jude Infrastructure — CDK App

Deploys the AI reasoning layer for Jude (the Johnson Legal Team's back-office agent) on AWS Bedrock AgentCore Runtime.

## Architecture

```
Router Lambda (POST /hooks/{path})
    → validates bearer token (JUDE_HOOKS_TOKEN from Secrets Manager)
    → bedrock-agentcore:InvokeAgentRuntime(sessionId="jude-main")
        → AgentCore Firecracker microVM
            → OpenClaw Gateway (port 18789)
                → Gemini 3.1 Flash-Lite (external HTTPS)
            → workspace-sync.js ↔ S3 (persist state across cold starts)
```

## Stacks

| Stack | Purpose |
|-------|---------|
| `JudeVpc` | VPC with private subnets, NAT Gateway (Gemini egress), VPC endpoints (S3, Secrets Manager, DynamoDB) |
| `JudeSecurity` | KMS CMK, Secrets Manager entries (Gemini API key, hooks token) |
| `JudeAgentCore` | IAM execution role, Security Group, S3 workspace bucket, runtime config |
| `JudeRouter` | Router Lambda (Python 3.13) + HTTP API Gateway |
| `JudeObservability` | CloudWatch dashboards + alarms |

## Prerequisites

1. **CDK bootstrapped** ✅ (CDKToolkit stack already exists)
2. **Secrets Manager entries created:**
   - `jude/gemini-api-key` ✅ (live-tested, AIzaSy... format)
   - `jude/deepseek-api-key` ✅ (fallback, needs prepaid credit)
   - `jude/hooks-token` ❌ (needs to be generated — `openssl rand -base64 32`)
3. **AgentCore Runtime available in us-east-1** — confirm AZ support before deploy

## Deployment (3-phase hybrid)

### Phase 1: CDK foundation stacks

```bash
cd jude-infra
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Deploy foundation (VPC, Security, AgentCore base, Observability)
cdk deploy JudeVpc JudeSecurity JudeAgentCore JudeObservability
```

### Phase 2: AgentCore Starter Toolkit (creates runtime + endpoint)

```bash
# Install the AgentCore starter toolkit (see AWS docs)
agentcore configure --region us-east-1
agentcore deploy \
  --runtime-name jude-runtime \
  --execution-role-arn <from JudeAgentCore stack output> \
  --security-group-ids <from JudeAgentCore stack output> \
  --subnet-ids <from JudeAgentCore stack output> \
  --image bridge:latest

# Note the runtime_id and endpoint_id from the output
```

### Phase 3: CDK Router stack (needs runtime_id from Phase 2)

```bash
# Update cdk.json context with the runtime_id
cdk deploy JudeRouter --context runtime_id=<from-phase-2>
```

## Bridge Container

The `bridge/` directory contains the Docker image that runs inside AgentCore:

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build: node:22-slim ARM64, OpenClaw 2026.3.8, AWS SDK (S3 + Secrets Manager) |
| `agentcore-contract.js` | AgentCore contract server (port 8080, /ping health check) |
| `workspace-sync.js` | Restore/save `~/.openclaw/` state to/from S3 bucket |
| `entrypoint.sh` | Container boot (starts contract server immediately) |
| `workspace-jude/AGENTS.md` | Operating rules (triage, notification decisions, guardrails) |
| `workspace-jude/SOUL.md` | Persona (professional, concise, dry) |
| `workspace-jude/TOOLS.md` | Tool usage constraints (rate limits, read-only rules) |

### Build the container

```bash
cd bridge
docker build --platform linux/arm64 -t jude-bridge:latest .
```

## Configuration (cdk.json context)

| Key | Value | Purpose |
|-----|-------|---------|
| `account` | 663877906756 | AWS account |
| `region` | us-east-1 | Deployment region |
| `runtime_id` | (empty — fill after Phase 2) | AgentCore runtime ID |
| `runtime_endpoint_id` | DEFAULT | AgentCore endpoint |
| `daily_token_budget` | 100000 | Gemini token budget |
| `daily_cost_budget_usd` | 2 | Cost alarm threshold |
| `session_idle_timeout` | 1800 | 30min idle before freeze |
| `router_lambda_timeout_seconds` | 30 | Router Lambda timeout |

## Model Provider

**Gemini 3.1 Flash-Lite** (paid tier) via OpenAI-compatible endpoint:
- Base URL: `https://generativelanguage.googleapis.com/v1beta/openai/`
- Auth: `Authorization: Bearer <GEMINI_API_KEY>` (from Secrets Manager)
- Model ID: `gemini-3.1-flash-lite`
- Cost: ~$0.10/$0.40 per 1M tokens (pennies/month at this volume)
- Data policy: Paid tier = prompts NOT used to train Google's models

## Current Status

- [x] CDK stacks written and linted
- [x] Bridge container Dockerfile complete
- [x] Workspace persona files (AGENTS.md, SOUL.md, TOOLS.md) drafted
- [x] Router Lambda written (Python 3.13, bearer token auth)
- [x] Gemini API key live-tested and stored in Secrets Manager
- [ ] Generate and store JUDE_HOOKS_TOKEN secret
- [ ] `cdk deploy` Phase 1 stacks
- [ ] AgentCore Starter Toolkit Phase 2
- [ ] `cdk deploy` JudeRouter (Phase 3)
- [ ] Wire `jude-leads` Lambda to call the Router endpoint
- [ ] End-to-end test: lead → Jude triage → owner notification

## Related Docs

- `docs/JUDE-OPENCLAW-SPEC.md` — Full specification (model decisions, architecture, cost model, blockers)
- `docs/JUDE-ARCHITECTURE-BLUEPRINT.md` — Original vision document (v1)
