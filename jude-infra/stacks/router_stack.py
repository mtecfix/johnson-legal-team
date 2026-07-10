"""Router Stack — API Gateway HTTP API for jude-leads/jude-notify-owner -> Jude.

Trimmed from aws-samples/sample-host-openclaw-on-amazon-bedrock-agentcore:
dropped Telegram/Slack/Feishu webhook parsing, the per-user DynamoDB
identity table, and cross-channel account linking. Jude has exactly one
caller (the existing jude-leads / jude-notify-owner Lambdas) and a single
fixed AgentCore session ID ("jude-main") — see docs/JUDE-OPENCLAW-SPEC.md
§3/§4. Auth is a single shared bearer token (JUDE_HOOKS_TOKEN) checked in
the Lambda handler, matching the `hooks.token` pattern OpenClaw's native
config already expects.

Single route: POST /hooks/{path} -> Router Lambda -> InvokeAgentRuntime.
"""

from aws_cdk import (
    CfnOutput,
    Duration,
    RemovalPolicy,
    Stack,
    aws_apigatewayv2 as apigwv2,
    aws_apigatewayv2_integrations as apigwv2_integrations,
    aws_iam as iam,
    aws_lambda as _lambda,
    aws_logs as logs,
)
import cdk_nag
from constructs import Construct

from stacks import retention_days


class RouterStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        runtime_arn: str,
        runtime_endpoint_id: str,
        hooks_token_secret_name: str,
        cmk_arn: str,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        region = Stack.of(self).region
        account = Stack.of(self).account
        log_retention = self.node.try_get_context("cloudwatch_log_retention_days") or 30
        lambda_timeout = int(self.node.try_get_context("router_lambda_timeout_seconds") or "30")
        lambda_memory = int(self.node.try_get_context("router_lambda_memory_mb") or "256")

        # --- Log Group ---
        router_log_group = logs.LogGroup(
            self,
            "RouterLogGroup",
            log_group_name="/jude/lambda/router",
            retention=retention_days(log_retention),
            removal_policy=RemovalPolicy.DESTROY,
        )

        # --- Lambda Function ---
        self.router_fn = _lambda.Function(
            self,
            "RouterFn",
            runtime=_lambda.Runtime.PYTHON_3_13,
            architecture=_lambda.Architecture.ARM_64,
            handler="index.handler",
            code=_lambda.Code.from_asset("lambda/router"),
            timeout=Duration.seconds(lambda_timeout),
            memory_size=lambda_memory,
            log_group=router_log_group,
            environment={
                "RUNTIME_ARN": runtime_arn,
                "RUNTIME_ENDPOINT_ID": runtime_endpoint_id,
                "HOOKS_TOKEN_SECRET_NAME": hooks_token_secret_name,
                "SESSION_ID": "jude-main",
            },
        )

        # Permission: invoke Jude's specific AgentCore runtime/endpoint only
        self.router_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["bedrock-agentcore:InvokeAgentRuntime"],
                resources=[runtime_arn, f"{runtime_arn}/*"],
            )
        )
        # Permission: read the hooks token to validate inbound calls
        self.router_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["secretsmanager:GetSecretValue"],
                resources=[
                    f"arn:aws:secretsmanager:{region}:{account}:secret:{hooks_token_secret_name}-*",
                ],
            )
        )
        self.router_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["kms:Decrypt"],
                resources=[cmk_arn],
            )
        )

        # --- API Gateway HTTP API ---
        self.http_api = apigwv2.HttpApi(
            self,
            "RouterApi",
            api_name="jude-router",
            description="Router for jude-leads/jude-notify-owner -> Jude AgentCore",
            create_default_stage=True,
            default_authorizer=None,  # auth enforced in Lambda (bearer token check)
        )

        integration = apigwv2_integrations.HttpLambdaIntegration(
            "RouterIntegration", handler=self.router_fn
        )
        self.http_api.add_routes(
            path="/hooks/{path}",
            methods=[apigwv2.HttpMethod.POST],
            integration=integration,
        )

        # Access logging via L1 escape hatch (matches upstream sample's pattern)
        api_access_log_group = logs.LogGroup(
            self,
            "ApiAccessLogGroup",
            log_group_name="/jude/api-access",
            retention=retention_days(log_retention),
            removal_policy=RemovalPolicy.DESTROY,
        )
        cfn_stage = self.http_api.default_stage.node.default_child
        cfn_stage.access_log_settings = apigwv2.CfnStage.AccessLogSettingsProperty(
            destination_arn=api_access_log_group.log_group_arn,
            format='{"requestId":"$context.requestId","ip":"$context.identity.sourceIp",'
            '"requestTime":"$context.requestTime","httpMethod":"$context.httpMethod",'
            '"routeKey":"$context.routeKey","status":"$context.status",'
            '"integrationErrorMessage":"$context.integrationErrorMessage"}',
        )
        cfn_stage.default_route_settings = apigwv2.CfnStage.RouteSettingsProperty(
            throttling_burst_limit=10,
            throttling_rate_limit=5,
        )

        # --- Outputs ---
        CfnOutput(self, "ApiUrl", value=self.http_api.api_endpoint)
        CfnOutput(self, "RouterFunctionArn", value=self.router_fn.function_arn)

        # --- cdk-nag suppressions ---
        cdk_nag.NagSuppressions.add_resource_suppressions(
            self.router_fn,
            [
                cdk_nag.NagPackSuppression(
                    id="AwsSolutions-IAM4",
                    reason="AWSLambdaBasicExecutionRole is the standard managed policy "
                    "for CloudWatch Logs write access; scoping it further provides no "
                    "practical benefit for a single-function Lambda execution role.",
                    applies_to=[
                        "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
                    ],
                ),
                cdk_nag.NagPackSuppression(
                    id="AwsSolutions-IAM5",
                    reason="AgentCore InvokeAgentRuntime IAM resource must include the "
                    "runtime-endpoint sub-resource path (runtime/{id}/*).",
                    applies_to=[
                        f"Resource::{runtime_arn}/*",
                        {"regex": "/^Resource::arn:aws:secretsmanager:.*:secret:.*-\\*$/g"},
                    ],
                ),
                cdk_nag.NagPackSuppression(
                    id="AwsSolutions-L1",
                    reason="Python 3.13 is the latest stable runtime supported in all regions.",
                ),
            ],
            apply_to_children=True,
        )
        cdk_nag.NagSuppressions.add_resource_suppressions(
            self.http_api,
            [
                cdk_nag.NagPackSuppression(
                    id="AwsSolutions-APIG4",
                    reason="Caller is our own jude-leads/jude-notify-owner Lambda, "
                    "authenticated via a shared bearer token (JUDE_HOOKS_TOKEN) "
                    "validated in the Router Lambda handler, not IAM/JWT at the "
                    "gateway. Throttling (5 req/s, burst 10) limits abuse.",
                ),
                cdk_nag.NagPackSuppression(
                    id="AwsSolutions-APIG1",
                    reason="Access logging IS configured via L1 escape hatch "
                    "(CfnStage.access_log_settings) to /jude/api-access log group.",
                ),
            ],
            apply_to_children=True,
        )
