# Jude Infrastructure Deployment — Status (2026-07-10 ~5:48 PM)

## ✅ COMPLETED THIS SESSION

### Phase 1 CDK Stacks — ALL DEPLOYED
| Stack | Status | Key Outputs |
|-------|--------|-------------|
| JudeVpc | ✅ CREATE_COMPLETE | VPC: vpc-0adc0680981af7b25, Private subnets: subnet-0fba84e75b3951d54, subnet-056a3b55582f9804b |
| JudeSecurity | ✅ CREATE_COMPLETE | KMS CMK: arn:aws:kms:us-east-1:663877906756:key/f2cb1248-04fe-4146-8f63-8e673b6ac33e |
| JudeAgentCore | ✅ CREATE_COMPLETE | Role: arn:aws:iam::663877906756:role/jude-agentcore-execution-role-us-east-1, SG: sg-06a7f96b29b47d2bf, Bucket: jude-workspace-663877906756-us-east-1 |
| JudeObservability | ✅ CREATE_COMPLETE | Alarm Topic: arn:aws:sns:us-east-1:663877906756:jude-alarms |

### Secrets Manager
- `jude/hooks-token` ✅ Created (bearer token for Router Lambda auth)
- `jude/gemini-api-key` ✅ Already existed (live-tested working)
- `jude/deepseek-api-key` ✅ Already existed (fallback)

### ECR Repository
- `jude-bridge` ✅ Created: 663877906756.dkr.ecr.us-east-1.amazonaws.com/jude-bridge

### Code Changes
- Fixed security_stack.py to import existing secrets (not recreate)
- Updated Dockerfile: removed hardcoded ARM64 platform, added git HTTPS redirect, bumped openclaw from 2026.3.8 → 2026.6.11 (fixed transitive SSH dep)
- Created READMEs: root, jude-infra, jude-backend, docs
- Updated portal-api/README.md with live status

---

## 🔧 NEXT: Phase 2 (Container Build + Runtime Creation)

### Docker Build (blocked by WSL read-only filesystem)
WSL2's virtual disk went read-only mid-build. To fix:
1. Close all terminals
2. In PowerShell (as admin): `wsl --shutdown`
3. Reopen WSL
4. Then run:
```bash
cd "/mnt/c/Users/MR TEHC/johnson legal team/jude-infra/bridge"
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 663877906756.dkr.ecr.us-east-1.amazonaws.com
docker build -t 663877906756.dkr.ecr.us-east-1.amazonaws.com/jude-bridge:v1 .
docker push 663877906756.dkr.ecr.us-east-1.amazonaws.com/jude-bridge:v1
```

### Create AgentCore Runtime (after container is pushed)
```bash
aws bedrock-agentcore-control create-agent-runtime \
  --agent-runtime-name jude-runtime \
  --agent-runtime-artifact '{"containerConfiguration":{"containerUri":"663877906756.dkr.ecr.us-east-1.amazonaws.com/jude-bridge:v1"}}' \
  --role-arn arn:aws:iam::663877906756:role/jude-agentcore-execution-role-us-east-1 \
  --network-configuration '{"networkMode":"VPC","networkModeConfig":{"securityGroups":["sg-06a7f96b29b47d2bf"],"subnets":["subnet-0fba84e75b3951d54","subnet-056a3b55582f9804b"]}}' \
  --description "Jude AI agent - Johnson Legal Team back office" \
  --environment-variables '{"GEMINI_API_KEY_SECRET":"jude/gemini-api-key","HOOKS_TOKEN_SECRET":"jude/hooks-token","WORKSPACE_BUCKET":"jude-workspace-663877906756-us-east-1","AWS_REGION":"us-east-1"}' \
  --region us-east-1
```

### Create Runtime Endpoint (after runtime is ACTIVE)
```bash
aws bedrock-agentcore-control create-agent-runtime-endpoint \
  --agent-runtime-id <runtime-id-from-above> \
  --name jude-endpoint \
  --description "Jude's single-tenant invocation endpoint" \
  --region us-east-1
```

### Deploy Router Stack (Phase 3 — after getting runtime_id)
```bash
cd "/mnt/c/Users/MR TEHC/johnson legal team/jude-infra"
source .venv/bin/activate
npx cdk deploy JudeRouter --context runtime_id=<RUNTIME_ID> --require-approval never
```

---

## Key Values Reference
| Resource | Value |
|----------|-------|
| VPC | vpc-0adc0680981af7b25 |
| Private Subnets | subnet-0fba84e75b3951d54, subnet-056a3b55582f9804b |
| Security Group | sg-06a7f96b29b47d2bf |
| Execution Role ARN | arn:aws:iam::663877906756:role/jude-agentcore-execution-role-us-east-1 |
| KMS CMK ARN | arn:aws:kms:us-east-1:663877906756:key/f2cb1248-04fe-4146-8f63-8e673b6ac33e |
| Workspace Bucket | jude-workspace-663877906756-us-east-1 |
| ECR Repo | 663877906756.dkr.ecr.us-east-1.amazonaws.com/jude-bridge |
| Alarm Topic | arn:aws:sns:us-east-1:663877906756:jude-alarms |
