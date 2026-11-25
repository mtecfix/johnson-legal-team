#!/usr/bin/env bash
# Build (with tests), upload the zip, and deploy the jlt-php-api CloudFormation stack. Runs on the worker server.
set -euo pipefail
cd "$(dirname "$0")/.."
./build.sh
KEY="jlt-php-api/$(sha256sum dist/jlt-php-api.zip | cut -c1-16).zip"
aws s3 cp dist/jlt-php-api.zip "s3://johnson-legal-sam-deploy-663877906756/$KEY" --region us-east-1 --only-show-errors
aws cloudformation deploy --stack-name jlt-php-api --template-file infra/template.yaml --region us-east-1 \
  --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset --parameter-overrides "CodeKey=$KEY" \
  --tags Project=johnson-legal ManagedBy=apex
aws cloudformation describe-stacks --stack-name jlt-php-api --region us-east-1 --query 'Stacks[0].Outputs' --output text
