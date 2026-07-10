"""Security Stack — KMS CMK + Secrets Manager entries.

Trimmed from aws-samples/sample-host-openclaw-on-amazon-bedrock-agentcore:
dropped the Cognito user pool (no per-human-user identity needed — Jude
has one caller, the jude-leads/jude-notify-owner Lambdas), the per-channel
bot token secrets (Telegram/Slack/Feishu — not used), and the gateway
token for CloudFront Web UI access (no public web chat UI for Jude).
Added: GEMINI_API_KEY secret (model provider) and JUDE_HOOKS_TOKEN secret
(auth between the Router Lambda and AgentCore's hook mapping).
See docs/JUDE-OPENCLAW-SPEC.md §9/§11 for the full rationale.
"""

from aws_cdk import (
    Stack,
    RemovalPolicy,
    aws_iam as iam,
    aws_kms as kms,
    aws_secretsmanager as secretsmanager,
    aws_s3 as s3,
    aws_cloudtrail as cloudtrail,
    aws_logs as logs,
)
import cdk_nag
from constructs import Construct

from stacks import retention_days


class SecurityStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        log_retention = self.node.try_get_context("cloudwatch_log_retention_days") or 30

        # --- KMS CMK for Secrets Manager ----------------------------------
        self.cmk = kms.Key(
            self,
            "SecretsCmk",
            alias="jude/secrets",
            description="CMK for Jude secrets encryption",
            enable_key_rotation=True,
            removal_policy=RemovalPolicy.RETAIN,
        )

        # Allow CloudWatch Alarms to publish to KMS-encrypted SNS topics
        self.cmk.add_to_resource_policy(
            iam.PolicyStatement(
                actions=[
                    "kms:Decrypt",
                    "kms:GenerateDataKey*",
                ],
                principals=[
                    iam.ServicePrincipal("cloudwatch.amazonaws.com"),
                ],
                resources=["*"],
            )
        )

        # --- Gemini API key (model provider) ------------------------------
        # NOTE: the real value is set out-of-band via `aws secretsmanager
        # put-secret-value` after this stack deploys — CDK only creates the
        # secret container here with a throwaway placeholder so the ARN is
        # stable for downstream IAM policies. See docs/JUDE-OPENCLAW-SPEC.md
        # §2 for the AQ.-key-format gotcha if this is ever rotated.
        self.gemini_api_key_secret = secretsmanager.Secret(
            self,
            "GeminiApiKeySecret",
            secret_name="jude/gemini-api-key",
            description="Gemini API key — Jude's LLM provider (see spec §2)",
            encryption_key=self.cmk,
            generate_secret_string=secretsmanager.SecretStringGenerator(
                password_length=32,
                exclude_punctuation=True,
            ),  # placeholder — replace via console/CLI with the real key
        )

        # --- Hooks token (Router Lambda <-> AgentCore hook auth) ----------
        self.hooks_token_secret = secretsmanager.Secret(
            self,
            "HooksTokenSecret",
            secret_name="jude/hooks-token",
            description="Bearer token validating Router Lambda -> AgentCore hook calls",
            encryption_key=self.cmk,
            generate_secret_string=secretsmanager.SecretStringGenerator(
                password_length=64,
                exclude_punctuation=True,
            ),
        )

        # --- CloudTrail (optional, off by default) -------------------------
        # Most AWS accounts already have an organization-level or account-level
        # CloudTrail. Deploying a second trail adds cost with no additional
        # security benefit. Enable via cdk.json context: "enable_cloudtrail": true
        enable_cloudtrail = self.node.try_get_context("enable_cloudtrail") or False
        self.trail = None
        trail_bucket = None

        if enable_cloudtrail:
            trail_bucket = s3.Bucket(
                self,
                "CloudTrailBucket",
                encryption=s3.BucketEncryption.S3_MANAGED,
                enforce_ssl=True,
                block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
                versioned=True,
                removal_policy=RemovalPolicy.RETAIN,
                auto_delete_objects=False,
            )

            trail_log_group = logs.LogGroup(
                self,
                "CloudTrailLogGroup",
                retention=retention_days(log_retention),
                removal_policy=RemovalPolicy.DESTROY,
            )

            self.trail = cloudtrail.Trail(
                self,
                "CloudTrail",
                bucket=trail_bucket,
                send_to_cloud_watch_logs=True,
                cloud_watch_log_group=trail_log_group,
                is_multi_region_trail=False,
                include_global_service_events=True,
                enable_file_validation=True,
            )

        # --- cdk-nag suppressions ---
        cdk_nag.NagSuppressions.add_resource_suppressions(
            [self.gemini_api_key_secret, self.hooks_token_secret],
            [
                cdk_nag.NagPackSuppression(
                    id="AwsSolutions-SMG4",
                    reason="Gemini API key is a third-party credential rotated manually via "
                    "Google AI Studio + `aws secretsmanager put-secret-value`. The hooks token "
                    "is an internal shared secret between our own Lambdas and AgentCore; "
                    "automatic rotation would require coordinated redeployment of both sides.",
                ),
            ],
        )
        if trail_bucket:
            cdk_nag.NagSuppressions.add_resource_suppressions(
                trail_bucket,
                [
                    cdk_nag.NagPackSuppression(
                        id="AwsSolutions-S1",
                        reason="This is the CloudTrail log bucket itself. Enabling access logs "
                        "would require an additional bucket, creating a recursive logging chain. "
                        "CloudTrail file validation is enabled as an integrity check instead.",
                    ),
                ],
            )
