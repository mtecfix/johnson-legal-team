#!/usr/bin/env bash
# Deploy jlt-api-proxy and route johnsonlegalteam.org/api/* to it. Token from Secrets Manager; never printed.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
(cd "$DIR" && node test.mjs >/dev/null) || { echo "proxy tests failed; not deploying"; exit 1; }
RAW=$(aws secretsmanager get-secret-value --secret-id cloudflare/api-token --query SecretString --output text --region us-east-1)
if [[ "$RAW" == \{* ]]; then TOKEN=$(jq -r 'to_entries|map(select(.key|test("token";"i")))[0].value // (to_entries[0].value)' <<<"$RAW"); else TOKEN="$RAW"; fi
CF=https://api.cloudflare.com/client/v4; AUTH=(-H "Authorization: Bearer $TOKEN")
ACCOUNT=$(curl -fsS "${AUTH[@]}" $CF/accounts | jq -r '.result[0].id')
ZONE=$(curl -fsS "${AUTH[@]}" "$CF/zones?name=johnsonlegalteam.org" | jq -r '.result[0].id')
META='{"main_module":"jlt-api-proxy.js","compatibility_date":"2026-11-01"}'
curl -fsS -X PUT "${AUTH[@]}" "$CF/accounts/$ACCOUNT/workers/scripts/jlt-api-proxy" \
  -F "metadata=$META;type=application/json" -F "jlt-api-proxy.js=@$DIR/jlt-api-proxy.js;type=application/javascript+module" \
  | jq -r '"script uploaded: " + (.success|tostring)'
PATTERN='johnsonlegalteam.org/api/*'
if ! curl -fsS "${AUTH[@]}" "$CF/zones/$ZONE/workers/routes" | jq -e --arg p "$PATTERN" '.result[]|select(.pattern==$p)' >/dev/null; then
  curl -fsS -X POST "${AUTH[@]}" -H "Content-Type: application/json" "$CF/zones/$ZONE/workers/routes" \
    -d "$(jq -nc --arg p "$PATTERN" '{pattern:$p,script:"jlt-api-proxy"}')" | jq -r '"route added: " + (.success|tostring)'
else echo "route exists"; fi
