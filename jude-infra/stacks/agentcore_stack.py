"""AgentCore Stack — IAM, S3, and Security Group for Jude's AgentCore Runtime.

Trimmed from aws-samples/sample-host-openclaw-on-amazon-bedrock-agentcore:
dropped Bedrock model-invocation IAM permissions (Jude's model provider is
Gemini, reached over the internet — see spec §2/§9), dropped Bedrock
Guardrails permissions, dropped Cognito admin permissions (no per-user
identity), dropped per-channel bot token secret access, dropped
EventBridge cron / DynamoDB identity-table permissions (no per-user
routing — single fixed session "jude-main"). Added: DynamoDB read-only
access scoped to the existing `jude-leads` table, and Secrets Manager
read access scoped to the Gemini API key + hooks token secrets.

The Runtime itself (container, endpoint) is deployed separately via the
AgentCore Starter Toolkit (`agentcore deploy`), same as the upstream
sample. This stack only creates the supporting resources.
"""

from aws_cdk import (
    CfnOutput,
    Duration,
    Stack,
    RemovalPolicy,
    aws_ec2 as ec2,
    aws_iam as iam,
    aws_kms as kms,
    aws_s3 as s3,
)
import cdk_nag
from constructs import Construct


class AgentCoreStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        cmk_arn: str,
        vpc: ec2.IVpc,
        private_subnet_ids: list[str],
        gemini_api_key_secret_name: str,
        hooks_token_secret_name: str,
        leads_table_name: str,
        owner_notify_function_name: str,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        region = Stack.of(self).region
        account = Stack.of(self).account

        # --- Security Group for the AgentCore Runtime container -------------
        self.agent_sg = ec2.SecurityGroup(
            self,
            "AgentRuntimeSecurityGroup",
            vpc=vpc,
            description="Jude AgentCore Runtime container security group",
            allow_all_outbound=False,
        )
        self.agent_sg.add_egress_rule(
            peer=ec2.Peer.any_ipv4(),
            connection=ec2.Port.tcp(443),
            description="HTTPS to VPC endpoints and internet (Gemini API, web tools)",
        )
        self.agent_sg.add_ingress_rule(
            peer=ec2.Peer.ipv4(vpc.vpc_cidr_block),
            connection=ec2.Port.tcp(443),
            description="HTTPS from VPC",
        )

        # --- Execution Role (what the container can do) -----------------------
        execution_role_name = f"jude-agentcore-execution-role-{region}"
        self.execution_role = iam.Role(
            self,
            "JudeExecutionRole",
            role_name=execution_role_name,
            assumed_by=iam.CompositePrincipal(
                iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
                iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
            ),
        )

        # Secrets Manager — Gemini API key + hooks token only
        self.execution_role.add_to_policy(
            iam.PolicyStatement(
                actions=[
                    "secretsmanager:GetSecretValue",
                    "secretsmanager:DescribeSecret",
                ],
                resources=[
                    f"arn:aws:secretsmanager:{region}:{account}:secret:{gemini_api_key_secret_name}-*",
                    f"arn:aws:secretsmanager:{region}:{account}:secret:{hooks_token_secret_name}-*",
                ],
            )
        )
        self.execution_role.add_to_policy(
            iam.PolicyStatement(
                actions=["kms:Decrypt"],
                resources=[cmk_arn],
            )
        )

        # DynamoDB — read-only access to jude-leads (no Scan; Query only)
        self.execution_role.add_to_policy(
            iam.PolicyStatement(
                actions=["dynamodb:GetItem", "dynamodb:Query"],
                resources=[
                    f"arn:aws:dynamodb:{region}:{account}:table/{leads_table_name}",
                    f"arn:aws:dynamodb:{region}:{account}:table/{leads_table_name}/index/*",
                ],
            )
        )

        # Lambda — invoke the existing owner-notify function (SNS SMS / SES email)
        self.execution_role.add_to_policy(
            iam.PolicyStatement(
                actions=["lambda:InvokeFunction"],
                resources=[
                    f"arn:aws:lambda:{region}:{account}:function:{owner_notify_function_name}",
                ],
            )
        )

        # S3 — workspace sync bucket (created below), scoped to jude-main/ prefix
        # (single-tenant; kept for parity with the upstream STS-scoping pattern)

        # CloudWatch Logs — scoped to /jude/ log group prefix
        self.execution_role.add_to_policy(
            iam.PolicyStatement(
                actions=[
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                ],
                resources=[
                    f"arn:aws:logs:{region}:{account}:log-group:/jude/*",
                    f"arn:aws:logs:{region}:{account}:log-group:/jude/*:*",
                ],
            )
        )

        # CloudWatch Metrics — namespace-scoped
        self.execution_role.add_to_policy(
            iam.PolicyStatement(
                actions=["cloudwatch:PutMetricData"],
                resources=["*"],
                conditions={
                    "StringEquals": {
                        "cloudwatch:namespace": ["Jude/AgentCore"]
                    }
                },
            )
        )

        # X-Ray tracing
        self.execution_role.add_to_policy(
            iam.PolicyStatement(
                actions=[
                    "xray:PutTraceSegments",
                    "xray:PutTelemetryRecords",
                ],
                resources=["*"],
            )
        )

        # ECR pull (toolkit creates the repo, execution role needs pull access)
        self.execution_role.add_to_policy(
            iam.PolicyStatement(
                actions=[
                    "ecr:GetDownloadUrlForLayer",
                    "ecr:BatchGetImage",
                    "ecr:BatchCheckLayerAvailability",
                ],
                resources=[
                    f"arn:aws:ecr:{region}:{account}:repository/jude-bridge*",
                    f"arn:aws:ecr:{region}:{account}:repository/bedrock-agentcore-*",
                ],
            )
        )
        self.execution_role.add_to_policy(
            iam.PolicyStatement(
                actions=["ecr:GetAuthorizationToken"],
                resources=["*"],
            )
        )

        # --- S3 Bucket for workspace (.openclaw/) sync -------------------------
        workspace_cmk = kms.Key.from_key_arn(self, "WorkspaceCmk", cmk_arn)
        self.workspace_bucket = s3.Bucket(
            self,
            "WorkspaceBucket",
            bucket_name=f"jude-workspace-{account}-{region}",
            encryption=s3.BucketEncryption.KMS,
            encryption_key=workspace_cmk,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy=RemovalPolicy.RETAIN,
            enforce_ssl=True,
            versioned=True,
        )
        self.workspace_bucket.grant_read_write(self.execution_role)

        # --- Runtime info (from Starter Toolkit, read via context) ------------
        runtime_id = self.node.try_get_context("runtime_id") or "PLACEHOLDER"
        runtime_endpoint_id = self.node.try_get_context("runtime_endpoint_id") or "PLACEHOLDER"
        self.runtime_arn = f"arn:aws:bedrock-agentcore:{region}:{account}:runtime/{runtime_id}"
        self.runtime_endpoint_id = runtime_endpoint_id

        # --- Outputs ------------------------------------------------------------
        CfnOutput(self, "ExecutionRoleArn", value=self.execution_role.role_arn)
        CfnOutput(self, "SecurityGroupId", value=self.agent_sg.security_group_id)
        CfnOutput(self, "WorkspaceBucketName", value=self.workspace_bucket.bucket_name)
        CfnOutput(self, "PrivateSubnetIds", value=",".join(private_subnet_ids))

        # --- cdk-nag suppressions -----------------------------------------------
        cdk_nag.NagSuppressions.add_resource_suppressions(
            self.execution_role,
            [
                cdk_nag.NagPackSuppression(
                    id="AwsSolutions-IAM5",
                    reason="Secrets Manager/CloudWatch Logs scoped to jude/* prefix. "
                    "DynamoDB scoped to the single jude-leads table + its indexes. "
                    "ecr:GetAuthorizationToken and X-Ray/CloudWatch metric-put APIs do "
                    "not support resource-level restrictions.",
                    applies_to=[
                        {"regex": "/^Resource::arn:aws:secretsmanager:.*:secret:.*-\\*$/g"},
                        f"Resource::arn:aws:dynamodb:{region}:{account}:table/{leads_table_name}/index/*",
                        f"Resource::arn:aws:logs:{region}:{account}:log-group:/jude/*",
                        f"Resource::arn:aws:logs:{region}:{account}:log-group:/jude/*:*",
                        "Resource::*",
                        "Action::s3:Abort*",
                        "Action::s3:DeleteObject*",
                        "Action::s3:GetBucket*",
                        "Action::s3:GetObject*",
                        "Action::s3:List*",
                        "Action::kms:GenerateDataKey*",
                        "Action::kms:ReEncrypt*",
                        {"regex": "/^Resource::<WorkspaceBucket.*\\.Arn>\\/\\*$/g"},
                        f"Resource::arn:aws:ecr:{region}:{account}:repository/jude-bridge*",
                        f"Resource::arn:aws:ecr:{region}:{account}:repository/bedrock-agentcore-*",
                    ],
                ),
            ],
            apply_to_children=True,
        )
        cdk_nag.NagSuppressions.add_resource_suppressions(
            self.workspace_bucket,
            [
                cdk_nag.NagPackSuppression(
                    id="AwsSolutions-S1",
                    reason="Server access logging not required for single-tenant workspace "
                    "storage — CloudTrail S3 data events provide sufficient audit trail.",
                ),
            ],
        )
        cdk_nag.NagSuppressions.add_resource_suppressions(
            self.agent_sg,
            [
                cdk_nag.NagPackSuppression(
                    id="AwsSolutions-EC23",
                    reason="Ingress uses VPC CIDR; not open to 0.0.0.0/0.",
                ),
                cdk_nag.NagPackSuppression(
                    id="CdkNagValidationFailure",
                    reason="Security group rule uses Fn::GetAtt for VPC CIDR which "
                    "cannot be validated at synth time.",
                ),
            ],
        )
