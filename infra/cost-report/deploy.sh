#!/usr/bin/env bash
# Package handler.py, upload it to the JLT SAM artifact bucket, and deploy the CloudFormation stack.
# Run setup.sh once before the first deploy. Re-run this script to ship code or scope changes.
set -euo pipefail
cd "$(dirname "$0")"

REGION=us-east-1
ACCT=$(aws sts get-caller-identity --query Account --output text)
STACK=jlt-cost-report
CODE_BUCKET="johnson-legal-sam-deploy-${ACCT}"
EXPORT_BUCKET="jlt-cost-exports-${ACCT}"
TOPIC_ARN="arn:aws:sns:${REGION}:${ACCT}:jlt-cost-report"

python3 -m unittest -q                     # never ship code that fails its tests
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
python3 - "$TMP/function.zip" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    z.write("handler.py")
PY
KEY="cost-report/function-$(sha256sum "$TMP/function.zip" | cut -c1-16).zip"
aws s3 cp "$TMP/function.zip" "s3://${CODE_BUCKET}/${KEY}" --region "$REGION" --only-show-errors
PATTERNS=$(python3 -c 'import json;print(json.dumps(json.load(open("patterns.json")),separators=(",",":")))')

aws cloudformation deploy --region "$REGION" --stack-name "$STACK" --template-file template.yaml \
  --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset \
  --tags project=johnson-legal \
  --parameter-overrides "ExportBucket=${EXPORT_BUCKET}" "TopicArn=${TOPIC_ARN}" "CodeBucket=${CODE_BUCKET}" "CodeKey=${KEY}" "PatternsJson=${PATTERNS}"
aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query 'Stacks[0].{Status:StackStatus,Outputs:Outputs}' --output json
