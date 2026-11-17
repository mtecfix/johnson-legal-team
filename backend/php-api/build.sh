#!/usr/bin/env bash
# Install production deps, run tests, and produce dist/jlt-php-api.zip for Lambda. Runs on the worker server.
set -euo pipefail
cd "$(dirname "$0")"
docker build -q -t jlt-php-build -f Dockerfile.build . >/dev/null
docker run --rm -u "$(id -u):$(id -g)" -e COMPOSER_HOME=/tmp/c -v "$PWD":/app jlt-php-build \
  sh -c 'composer install --no-dev --no-interaction --no-progress --classmap-authoritative -q && for f in $(find src public tests -name "*.php"); do php -l $f >/dev/null || exit 1; done && tests/run.sh'
# Trim the AWS SDK: delete only per-service folders we don't use. A service folder is one that has a
# matching API model in src/data; core folders (no model) are always kept, so SDK internals can't go missing.
SDK=vendor/aws/aws-sdk-php/src
USED='dynamodb|email|cognito-idp|secretsmanager|sts|sso|sso-oidc'
for model in "$SDK"/data/*/; do
  svc=$(basename "$model")
  [[ "$svc" =~ ^($USED)$ ]] && continue
  rm -rf "$model"
done
for dir in "$SDK"/*/; do
  name=$(basename "$dir")
  case "$name" in DynamoDb|Ses|CognitoIdentityProvider|SecretsManager|Sts|Sso|SSOOIDC|data) continue;; esac
  # Service namespaces have a <Name>Client.php; core namespaces (Api, Credentials, SocketTimeout, ...) do not.
  [ -f "$dir/${name}Client.php" ] && rm -rf "$dir"
done
docker run --rm -u "$(id -u):$(id -g)" -e COMPOSER_HOME=/tmp/c -v "$PWD":/app jlt-php-build composer dump-autoload --no-dev --classmap-authoritative -q
docker run --rm -u "$(id -u):$(id -g)" -e COMPOSER_HOME=/tmp/c -v "$PWD":/app jlt-php-build tests/run.sh | tail -1
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD":/app jlt-php-build php tests/sdk_smoke.php
mkdir -p dist && rm -f dist/jlt-php-api.zip
zip -qr dist/jlt-php-api.zip public src vendor composer.json -x '*.md' '*/tests/*' '*/Tests/*'
echo "package: $(du -h dist/jlt-php-api.zip | cut -f1)"
