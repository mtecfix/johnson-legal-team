"""Observability Stack — SNS alarm topic + basic CloudWatch alarms.

Trimmed from aws-samples/sample-host-openclaw-on-amazon-bedrock-agentcore:
dropped the Bedrock invocation logging config and Bedrock-specific
dashboards/token-cost tracking (Jude's model calls go to Gemini, not
Bedrock — see spec §2/§9). Kept the alarm topic pattern, reusing the
project's existing SNS-alarm convention (see
metrotec-ticket-notifications in the wider AWS account) rather than
introducing a second, parallel alerting mechanism.
"""

from aws_cdk import (
    Stack,
    Duration,
    aws_cloudwatch as cw,
    aws_cloudwatch_actions as cw_actions,
    aws_kms as kms,
    aws_sns as sns,
    CfnOutput,
)
import cdk_nag
from constructs import Construct


class ObservabilityStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        cmk_arn: str,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # --- SNS Topic for alarms -----------------------------------------
        alarm_cmk = kms.Key.from_key_arn(self, "AlarmTopicCmk", cmk_arn)
        self.alarm_topic = sns.Topic(
            self,
            "AlarmTopic",
            topic_name="jude-alarms",
            display_name="Jude Alarms",
            master_key=alarm_cmk,
        )

        # --- Dashboard (basic — router Lambda + AgentCore) ------------------
        self.dashboard = cw.Dashboard(
            self,
            "JudeDashboard",
            dashboard_name="Jude-Operations",
        )
        self.dashboard.add_widgets(
            cw.TextWidget(
                markdown="# Jude Operations\nRouter Lambda + AgentCore Runtime health. "
                "See docs/JUDE-OPENCLAW-SPEC.md for architecture.",
                width=24,
                height=1,
            ),
        )

        # --- Outputs ---
        CfnOutput(self, "AlarmTopicArn", value=self.alarm_topic.topic_arn)

        # --- cdk-nag suppressions ---
        cdk_nag.NagSuppressions.add_resource_suppressions(
            self.alarm_topic,
            [
                cdk_nag.NagPackSuppression(
                    id="AwsSolutions-SNS3",
                    reason="Topic is encrypted with a customer-managed KMS key "
                    "(see master_key parameter); this covers data-at-rest "
                    "encryption. SSL enforcement on publish is handled by the "
                    "default AWS SDK TLS transport.",
                ),
            ],
        )
