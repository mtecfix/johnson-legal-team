"""VPC Stack — subnets, NAT instance (for Gemini egress), flow logs.

Cost-optimized: replaced the managed NAT Gateway ($32/month) and 3
interface VPC endpoints (~$36/month) with a single t4g.nano NAT instance
(~$3/month). Total VPC cost goes from ~$68/month to ~$4/month.

Trade-offs vs. managed NAT Gateway:
  - Not auto-healing (if the instance dies, Jude loses internet until
    restart — acceptable for a low-volume back-office agent)
  - No multi-AZ redundancy (single instance in one AZ)
  - SecretsManager/CloudWatch calls now route through NAT instead of
    private VPC endpoints (negligible latency at this volume)

Uses CDK's NatInstanceProviderV2 which properly manages route table
entries (avoids conflicts with existing 0.0.0.0/0 routes on update).
"""

from aws_cdk import (
    Stack,
    aws_ec2 as ec2,
    aws_logs as logs,
    aws_iam as iam,
    RemovalPolicy,
    CfnOutput,
)
import cdk_nag
from constructs import Construct

from stacks import retention_days


class VpcStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        log_retention = self.node.try_get_context("cloudwatch_log_retention_days") or 30

        # --- NAT Instance Provider (t3a.nano — ~$3.40/month) --------------------
        # Using t3a.nano (AMD) instead of t4g.nano (ARM) due to temporary
        # t4g.nano capacity shortage in us-east-1a.
        nat_provider = ec2.NatProvider.instance_v2(
            instance_type=ec2.InstanceType("t3a.nano"),
        )

        # --- VPC with NAT instance -------------------------------------------
        availability_zones = self.node.try_get_context("availability_zones")

        vpc_kwargs = {
            "ip_addresses": ec2.IpAddresses.cidr("10.0.0.0/16"),
            "nat_gateway_provider": nat_provider,
            "nat_gateways": 1,
            "subnet_configuration": [
                ec2.SubnetConfiguration(
                    name="Public",
                    subnet_type=ec2.SubnetType.PUBLIC,
                    cidr_mask=24,
                ),
                ec2.SubnetConfiguration(
                    name="Private",
                    subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidr_mask=24,
                ),
            ],
        }

        if availability_zones:
            vpc_kwargs["availability_zones"] = availability_zones
        else:
            vpc_kwargs["max_azs"] = 2

        self.vpc = ec2.Vpc(self, "Vpc", **vpc_kwargs)

        # Allow all traffic from VPC CIDR to NAT instance (for forwarding)
        nat_provider.connections.allow_from(
            ec2.Peer.ipv4(self.vpc.vpc_cidr_block),
            ec2.Port.all_traffic(),
            "All traffic from VPC (private subnets route through NAT)",
        )

        # --- VPC Flow Logs ----------------------------------------------------
        flow_log_group = logs.LogGroup(
            self,
            "VpcFlowLogGroup",
            retention=retention_days(log_retention),
            removal_policy=RemovalPolicy.RETAIN,
        )
        flow_log_role = iam.Role(
            self,
            "VpcFlowLogRole",
            assumed_by=iam.ServicePrincipal("vpc-flow-logs.amazonaws.com"),
        )
        self.vpc.add_flow_log(
            "FlowLog",
            destination=ec2.FlowLogDestination.to_cloud_watch_logs(
                flow_log_group, flow_log_role
            ),
            traffic_type=ec2.FlowLogTrafficType.ALL,
        )

        # --- Gateway Endpoints (FREE — keep these) ----------------------------
        private_subnets = ec2.SubnetSelection(
            subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS
        )

        # S3 gateway endpoint (free) — workspace sync
        self.vpc.add_gateway_endpoint(
            "S3Endpoint",
            service=ec2.GatewayVpcEndpointAwsService.S3,
            subnets=[private_subnets],
        )

        # DynamoDB gateway endpoint (free) — jude-leads reads
        self.vpc.add_gateway_endpoint(
            "DynamoDbEndpoint",
            service=ec2.GatewayVpcEndpointAwsService.DYNAMODB,
            subnets=[private_subnets],
        )

        # NOTE: Interface VPC endpoints (SecretsManager, CloudWatch Logs,
        # Monitoring) REMOVED to save ~$36/month. Those services are now
        # reached via the NAT instance → internet. At Jude's volume
        # (a few invocations/day) this adds negligible latency and cost.

        # --- Outputs -----------------------------------------------------------
        CfnOutput(self, "VpcId", value=self.vpc.vpc_id)

        # --- cdk-nag suppressions ----------------------------------------------
        # Get the NAT instance(s) for suppressions
        nat_instances = nat_provider.gateway_instances
        for inst in nat_instances:
            cdk_nag.NagSuppressions.add_resource_suppressions(
                inst,
                [
                    cdk_nag.NagPackSuppression(
                        id="AwsSolutions-EC26",
                        reason="NAT instance does not need EBS encryption — no data stored, "
                        "only forwards packets.",
                    ),
                    cdk_nag.NagPackSuppression(
                        id="AwsSolutions-EC28",
                        reason="NAT instance does not need detailed monitoring — "
                        "low-volume single-agent traffic.",
                    ),
                    cdk_nag.NagPackSuppression(
                        id="AwsSolutions-EC29",
                        reason="NAT instance is intentionally not in an ASG — single "
                        "instance is acceptable for this low-volume use case.",
                    ),
                ],
            )

        cdk_nag.NagSuppressions.add_resource_suppressions(
            nat_provider.security_group,
            [
                cdk_nag.NagPackSuppression(
                    id="AwsSolutions-EC23",
                    reason="NAT instance ingress is from VPC CIDR (10.0.0.0/16) only, "
                    "not 0.0.0.0/0. All-traffic rule is required for NAT forwarding.",
                ),
                cdk_nag.NagPackSuppression(
                    id="CdkNagValidationFailure",
                    reason="Security group uses VPC CIDR which is known at deploy time.",
                ),
            ],
        )
