"""VPC Stack — subnets, NAT (for Gemini egress), VPC endpoints, flow logs.

Trimmed from aws-samples/sample-host-openclaw-on-amazon-bedrock-agentcore:
dropped the Bedrock Runtime VPC endpoint (Jude's model provider is Gemini,
reached over the internet via NAT — see docs/JUDE-OPENCLAW-SPEC.md §3/§9).
Kept the NAT Gateway itself; the sample already had it for web_fetch/
web_search tool egress, so no additional cost was introduced by this
change — just one fewer interface endpoint.
"""

from aws_cdk import (
    Stack,
    aws_ec2 as ec2,
    aws_logs as logs,
    aws_iam as iam,
    RemovalPolicy,
)
import cdk_nag
from constructs import Construct

from stacks import retention_days


class VpcStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        log_retention = self.node.try_get_context("cloudwatch_log_retention_days") or 30

        # --- VPC ----------------------------------------------------------
        # Allow override via context if AgentCore Runtime has AZ restrictions
        # in this region. Context: "availability_zones": ["us-east-1a", "us-east-1b"]
        availability_zones = self.node.try_get_context("availability_zones")

        vpc_kwargs = {
            "ip_addresses": ec2.IpAddresses.cidr("10.0.0.0/16"),
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

        # VPC Flow Logs
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

        # --- Security Groups ---------------------------------------------
        self.vpce_sg = ec2.SecurityGroup(
            self,
            "VpceSecurityGroup",
            vpc=self.vpc,
            description="VPC Endpoint interface security group",
            allow_all_outbound=False,
        )
        self.vpce_sg.add_ingress_rule(
            peer=ec2.Peer.ipv4(self.vpc.vpc_cidr_block),
            connection=ec2.Port.tcp(443),
            description="HTTPS from VPC (AgentCore container)",
        )

        # --- VPC Endpoints (S3/DynamoDB/SecretsManager/CW only — no Bedrock) --
        private_subnets = ec2.SubnetSelection(
            subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS
        )

        interface_endpoints = {
            "SecretsManager": ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
            "CwLogs": ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
            "Monitoring": ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING,
        }

        for name, service in interface_endpoints.items():
            self.vpc.add_interface_endpoint(
                f"{name}Endpoint",
                service=service,
                subnets=private_subnets,
                security_groups=[self.vpce_sg],
                private_dns_enabled=True,
            )

        # S3 gateway endpoint (free, no SG needed) — workspace sync
        self.vpc.add_gateway_endpoint(
            "S3Endpoint",
            service=ec2.GatewayVpcEndpointAwsService.S3,
            subnets=[private_subnets],
        )

        # DynamoDB gateway endpoint (free, no SG needed) — jude-leads reads
        self.vpc.add_gateway_endpoint(
            "DynamoDbEndpoint",
            service=ec2.GatewayVpcEndpointAwsService.DYNAMODB,
            subnets=[private_subnets],
        )

        # NOTE: generativelanguage.googleapis.com (Gemini) has no VPC
        # endpoint — it's reached via the NAT Gateway → internet, same
        # path already used by OpenClaw's built-in web_fetch/web_search
        # tools in the upstream sample.

        # --- cdk-nag suppressions ---
        cdk_nag.NagSuppressions.add_resource_suppressions(
            self.vpce_sg,
            [
                cdk_nag.NagPackSuppression(
                    id="AwsSolutions-EC23",
                    reason="Ingress uses VPC CIDR (10.0.0.0/16) which resolves via Fn::GetAtt at deploy time; not open to 0.0.0.0/0.",
                ),
                cdk_nag.NagPackSuppression(
                    id="CdkNagValidationFailure",
                    reason="Security group rule uses Fn::GetAtt for VPC CIDR which cannot be validated at synth time.",
                ),
            ],
        )
