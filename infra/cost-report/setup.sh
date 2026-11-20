#!/usr/bin/env bash
# One-time, idempotent setup for the JLT daily cost report: SNS topic + email subscription,
# private S3 bucket for the Data Export, and the Data Export itself (CUR 2.0, daily, resource-level, CSV.GZ).
# Data Exports must be created in us-east-1. Safe to re-run.
set -euo pipefail

REGION=us-east-1
ACCT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="jlt-cost-exports-${ACCT}"
TOPIC=jlt-cost-report
EMAIL="${REPORT_EMAIL:-mrtechfixes.ai@gmail.com}"
EXPORT=jlt-cur2-daily

echo "== SNS topic and email subscription"
TOPIC_ARN=$(aws sns create-topic --region "$REGION" --name "$TOPIC" --tags Key=project,Value=johnson-legal --query TopicArn --output text)
if [ "$(aws sns list-subscriptions-by-topic --region "$REGION" --topic-arn "$TOPIC_ARN" --query "length(Subscriptions[?Endpoint=='${EMAIL}'])" --output text)" = "0" ]; then
  aws sns subscribe --region "$REGION" --topic-arn "$TOPIC_ARN" --protocol email --notification-endpoint "$EMAIL" >/dev/null
  echo "subscription created for ${EMAIL}: click the confirmation link in the email"
else
  echo "subscription already exists for ${EMAIL}"
fi

echo "== Export bucket ${BUCKET}"
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3api create-bucket --region "$REGION" --bucket "$BUCKET" >/dev/null
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-tagging --bucket "$BUCKET" --tagging 'TagSet=[{Key=project,Value=johnson-legal}]'
# Keep storage at ~$0: export files are small and rewritten daily; expire anything untouched for 35 days.
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration \
  '{"Rules":[{"ID":"expire-old-exports","Status":"Enabled","Filter":{"Prefix":"cur/"},"Expiration":{"Days":35},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":2}}]}'
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "$(cat <<EOF
{"Version":"2012-10-17","Statement":[
 {"Sid":"AllowDataExportsWrite","Effect":"Allow",
  "Principal":{"Service":["billingreports.amazonaws.com","bcm-data-exports.amazonaws.com"]},
  "Action":["s3:PutObject","s3:GetBucketPolicy"],
  "Resource":["arn:aws:s3:::${BUCKET}","arn:aws:s3:::${BUCKET}/*"],
  "Condition":{"StringLike":{"aws:SourceAccount":"${ACCT}",
    "aws:SourceArn":["arn:aws:cur:${REGION}:${ACCT}:definition/*","arn:aws:bcm-data-exports:${REGION}:${ACCT}:export/*"]}}},
 {"Sid":"DenyInsecureTransport","Effect":"Deny","Principal":"*","Action":"s3:*",
  "Resource":["arn:aws:s3:::${BUCKET}","arn:aws:s3:::${BUCKET}/*"],
  "Condition":{"Bool":{"aws:SecureTransport":"false"}}}]}
EOF
)"

echo "== Data Export ${EXPORT}"
if [ "$(aws bcm-data-exports list-exports --region "$REGION" --query "length(Exports[?ExportName=='${EXPORT}'])" --output text)" = "0" ]; then
  aws bcm-data-exports create-export --region "$REGION" --export "$(cat <<EOF
{"Name":"${EXPORT}","Description":"Daily resource-level cost and usage for the JLT cost report",
 "DataQuery":{"QueryStatement":"SELECT bill_billing_period_start_date, line_item_line_item_type, line_item_usage_start_date, line_item_product_code, line_item_usage_type, line_item_operation, line_item_resource_id, line_item_usage_amount, line_item_unblended_cost, line_item_line_item_description, product_region_code, pricing_unit FROM COST_AND_USAGE_REPORT",
  "TableConfigurations":{"COST_AND_USAGE_REPORT":{"TIME_GRANULARITY":"DAILY","INCLUDE_RESOURCES":"TRUE","INCLUDE_MANUAL_DISCOUNT_COMPATIBILITY":"FALSE","INCLUDE_SPLIT_COST_ALLOCATION_DATA":"FALSE"}}},
 "DestinationConfigurations":{"S3Destination":{"S3Bucket":"${BUCKET}","S3Prefix":"cur","S3Region":"${REGION}",
  "S3OutputConfigurations":{"OutputType":"CUSTOM","Format":"TEXT_OR_CSV","Compression":"GZIP","Overwrite":"OVERWRITE_REPORT"}}},
 "RefreshCadence":{"Frequency":"SYNCHRONOUS"}}
EOF
)" --query ExportArn --output text
else
  echo "export already exists"
fi
echo "TOPIC_ARN=${TOPIC_ARN}"
echo "EXPORT_BUCKET=${BUCKET}"
