#!/usr/bin/env python3
"""Jude on AgentCore Runtime — CDK Application entry point.

Trimmed, single-tenant fork of aws-samples/sample-host-openclaw-on-
amazon-bedrock-agentcore (pinned commit e13e385, 2026-03-27), adapted per
docs/JUDE-OPENCLAW-SPEC.md. Key differences from the original sample:

  - ONE caller (Router Lambda, invoked by jude-leads/jude-notify-owner),
    not many human users over Telegram/Slack. No Cognito user pool, no
    per-channel bot secrets, no cross-channel identity linking.
  - Model provider is Gemini (via its native OpenAI-compatible endpoint),
    not Bedrock. No Bedrock Guardrails stack, no Bedrock IAM permissions
    on the execution role. VPC keeps its NAT Gateway for Gemini's
    internet egress (the sample's original design already had this for
    web_fetch/web_search tools).
  - Single fixed AgentCore session ID ("jude-main"). No per-user DynamoDB
    identity table, no allowlist.

Hybrid deployment model (same pattern as the sample):
  Phase 1 (CDK): VPC, Security, AgentCore-base (Role/SG/S3), Observability
  Phase 2 (Starter Toolkit): Runtime, Endpoint, ECR, Docker build
  Phase 3 (CDK): Router (needs runtime_id/endpoint_id from Phase 2)
"""

import os

import aws_cdk as cdk
import cdk_nag

from stacks.vpc_stack import VpcStack
from stacks.security_stack import SecurityStack
from stacks.agentcore_stack import AgentCoreStack
from stacks.router_stack import RouterStack
from stacks.observability_stack import ObservabilityStack

app = cdk.App()

env = cdk.Environment(
    account=app.node.try_get_context("account") or os.environ.get("CDK_DEFAULT_ACCOUNT"),
    region=app.node.try_get_context("region") or os.environ.get("CDK_DEFAULT_REGION"),
)

# --- Foundation ---
vpc_stack = VpcStack(app, "JudeVpc", env=env)

security_stack = SecurityStack(app, "JudeSecurity", env=env)

# --- AgentCore base resources (Role, SG, S3) ---
# Runtime/Endpoint created by Starter Toolkit; runtime_id/endpoint_id
# injected via cdk.json context after `agentcore deploy`.
agentcore_stack = AgentCoreStack(
    app,
    "JudeAgentCore",
    cmk_arn=security_stack.cmk.key_arn,
    vpc=vpc_stack.vpc,
    private_subnet_ids=[s.subnet_id for s in vpc_stack.vpc.private_subnets],
    gemini_api_key_secret_name=security_stack.gemini_api_key_secret.secret_name,
    hooks_token_secret_name=security_stack.hooks_token_secret.secret_name,
    leads_table_name=os.environ.get("JUDE_LEADS_TABLE", "jude-leads"),
    owner_notify_function_name=os.environ.get("JUDE_OWNER_NOTIFY_FN", "jude-notify-owner"),
    env=env,
)

# --- Router (Lambda + API Gateway HTTP API for jude-leads/jude-notify-owner) ---
router_stack = RouterStack(
    app,
    "JudeRouter",
    runtime_arn=agentcore_stack.runtime_arn,
    runtime_endpoint_id=agentcore_stack.runtime_endpoint_id,
    hooks_token_secret_name=security_stack.hooks_token_secret.secret_name,
    cmk_arn=security_stack.cmk.key_arn,
    env=env,
)

# --- Observability (dashboards + alarms) ---
observability_stack = ObservabilityStack(
    app,
    "JudeObservability",
    cmk_arn=security_stack.cmk.key_arn,
    env=env,
)

# --- cdk-nag security checks ---
cdk.Aspects.of(app).add(cdk_nag.AwsSolutionsChecks(verbose=True))

app.synth()
