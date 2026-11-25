#!/usr/bin/env bash
# Deploy jlt-ab-split to Cloudflare and attach routes for the six test pages (apex + www, with and without .html).
# Usage: tools/worker/deploy.sh preview|live
# Token is read from Secrets Manager (cloudflare/api-token); never printed.
set -euo pipefail
MODE="${1:?usage: deploy.sh preview|live}"; [[ "$MODE" == preview || "$MODE" == live ]] || { echo "mode must be preview or live"; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"
RAW=$(aws secretsmanager get-secret-value --secret-id cloudflare/api-token --query SecretString --output text --region us-east-1)
if [[ "$RAW" == \{* ]]; then TOKEN=$(jq -r 'to_entries|map(select(.key|test("token";"i")))[0].value // (to_entries[0].value)' <<<"$RAW"); else TOKEN="$RAW"; fi
CF=https://api.cloudflare.com/client/v4; AUTH=(-H "Authorization: Bearer $TOKEN")
ACCOUNT=$(curl -fsS "${AUTH[@]}" $CF/accounts | jq -r '.result[0].id')
ZONE=$(curl -fsS "${AUTH[@]}" "$CF/zones?name=johnsonlegalteam.org" | jq -r '.result[0].id')
(cd "$DIR" && node test.mjs >/dev/null 2>&1) || { echo "worker tests failed; not deploying"; exit 1; }
META=$(jq -nc --arg m "$MODE" '{main_module:"jlt-ab-split.js",compatibility_date:"2026-11-01",bindings:[{type:"plain_text",name:"SPLIT_MODE",text:$m}]}')
curl -fsS -X PUT "${AUTH[@]}" "$CF/accounts/$ACCOUNT/workers/scripts/jlt-ab-split" \
  -F "metadata=$META;type=application/json" \
  -F "jlt-ab-split.js=@$DIR/jlt-ab-split.js;type=application/javascript+module" | jq -r '"script uploaded: " + (.success|tostring) + " " + (.errors|tostring)'
# Prefix routes ("/page*"): exact-path routes do not match when a query string is present (e.g. ?gclid=),
# which would bypass the split for every ad click. Non-test paths sharing a prefix pass through the Worker.
ROUTES=$(curl -fsS "${AUTH[@]}" "$CF/zones/$ZONE/workers/routes")
WANTED=()
for host in johnsonlegalteam.org www.johnsonlegalteam.org; do
  for page in expungements misdemeanors personal-injury probate-estate-planning traffic-tickets practice-areas; do
    WANTED+=("$host/$page*")
  done
done
# Remove this Worker's routes that are no longer wanted (e.g. older exact-path routes).
jq -r '.result[]|select(.script=="jlt-ab-split")|.id+" "+.pattern' <<<"$ROUTES" | while read -r id pattern; do
  if ! printf '%s\n' "${WANTED[@]}" | grep -qxF "$pattern"; then
    curl -fsS -X DELETE "${AUTH[@]}" "$CF/zones/$ZONE/workers/routes/$id" | jq -r --arg p "$pattern" '"removed route " + $p + ": " + (.success|tostring)'
  fi
done
EXISTING=$(jq -r '.result[].pattern' <<<"$ROUTES")
for pattern in "${WANTED[@]}"; do
  if grep -qxF "$pattern" <<<"$EXISTING"; then continue; fi
  curl -fsS -X POST "${AUTH[@]}" -H "Content-Type: application/json" "$CF/zones/$ZONE/workers/routes" \
    -d "$(jq -nc --arg p "$pattern" '{pattern:$p,script:"jlt-ab-split"}')" | jq -r --arg p "$pattern" '"route " + $p + ": " + (.success|tostring)'
done
echo "routes now: $(curl -fsS "${AUTH[@]}" "$CF/zones/$ZONE/workers/routes" | jq '[.result[]|select(.script=="jlt-ab-split")]|length') (mode: $MODE)"
