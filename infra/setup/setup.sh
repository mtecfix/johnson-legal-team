#!/usr/bin/env bash
# Records, checks and recreates the parts of the johnsonlegalteam.org setup that are not created by a
# deploy script: S3 bucket settings, GitHub->AWS deploy roles, the Cloudflare purge token, the GitHub
# "production" approval environment, the Cloudflare ".html" rewrite rule and the Worker routes.
#
#   infra/setup/setup.sh record           save the live settings into infra/setup/desired/ (no secrets)
#   infra/setup/setup.sh check            compare live settings with desired/; exit 1 on any drift
#   infra/setup/setup.sh apply            make live match desired/ (only touches items that differ)
#   DRY_RUN=1 infra/setup/setup.sh apply  show what apply would change, change nothing
#
# Needs: aws CLI (credentials allowed to manage IAM, S3 and Secrets Manager), curl, jq.
# Tokens are read from Secrets Manager (metrotec/github-token, cloudflare/api-token) and never printed.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"; D="$DIR/desired"; mkdir -p "$D"
REGION=us-east-1; ACCOUNT=663877906756; BUCKET=johnsonlegalteam.org
REPO=mtecfix/johnson-legal-team; ZONE_NAME=johnsonlegalteam.org
OIDC_URL=token.actions.githubusercontent.com; OIDC_ARN="arn:aws:iam::$ACCOUNT:oidc-provider/$OIDC_URL"
ROLES=(jlt-site-plan jlt-site-deploy)
PURGE_SECRET=johnsonlegalteam/cloudflare-purge
HTML_RULE_DESC="Add .html extension to clean URLs"
CF_CACHE_PURGE_GROUP=e17beae8b8cb423a99b1730f21238bed   # Cloudflare permission group "Cache Purge"
MODE="${1:-}"; DRY_RUN="${DRY_RUN:-0}"; DRIFT=0

say()  { printf '%-34s %s\n' "$1" "$2"; }
norm() { jq -S "${1:-.}"; }
same() { [ "$(norm <<<"$1")" = "$(norm <"$2")" ]; }
act()  { if [ "$DRY_RUN" = 1 ]; then say "$1" "WOULD APPLY: $2"; return 1; fi; say "$1" "applying: $2"; }

# ---------- credentials (fetched only when needed) ----------
gh_token() { aws secretsmanager get-secret-value --secret-id metrotec/github-token --region $REGION --query SecretString --output text | jq -r .token; }
cf_token() {
  local raw; raw=$(aws secretsmanager get-secret-value --secret-id cloudflare/api-token --region $REGION --query SecretString --output text)
  if [[ "$raw" == \{* ]]; then jq -r 'to_entries|map(select(.key|test("token";"i")))[0].value // (to_entries[0].value)' <<<"$raw"; else echo "$raw"; fi
}
gh() { curl -fsS -H "Authorization: Bearer $GH" -H "Accept: application/vnd.github+json" "$@"; }
cf() { curl -fsS -H "Authorization: Bearer $CF" -H "Content-Type: application/json" "$@"; }
CFAPI=https://api.cloudflare.com/client/v4; GHAPI=https://api.github.com/repos/$REPO

# ---------- live readers (each prints normalized JSON, no secrets) ----------
live_s3() {
  jq -n --arg v "$(aws s3api get-bucket-versioning --bucket $BUCKET --region $REGION --query Status --output text)" \
        --argjson web "$(aws s3api get-bucket-website --bucket $BUCKET --region $REGION --output json)" \
        --argjson pol "$(aws s3api get-bucket-policy --bucket $BUCKET --region $REGION --query Policy --output text)" \
        '{versioning:$v, website:$web, policy:$pol}'
}
live_oidc() { aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" --output json 2>/dev/null | jq '{url:.Url, clients:.ClientIDList}' || echo '{}'; }
live_role() {
  local r=$1 trust pol name
  trust=$(aws iam get-role --role-name "$r" --query Role.AssumeRolePolicyDocument --output json 2>/dev/null) || { echo '{}'; return; }
  name=$(aws iam list-role-policies --role-name "$r" --query 'PolicyNames[0]' --output text)
  pol=$(aws iam get-role-policy --role-name "$r" --policy-name "$name" --query PolicyDocument --output json)
  jq -n --argjson t "$trust" --arg n "$name" --argjson p "$pol" \
    --arg desc "$(aws iam get-role --role-name "$r" --query Role.Description --output text)" \
    '{description:$desc, trust:$t, inline_policy_name:$n, inline_policy:$p}'
}
live_purge() {  # records only non-secret facts about the token
  local s; s=$(aws secretsmanager get-secret-value --secret-id $PURGE_SECRET --region $REGION --query SecretString --output text 2>/dev/null) || { echo '{}'; return; }
  local tok zid acct ok
  tok=$(jq -r .token <<<"$s"); zid=$(jq -r .zone_id <<<"$s")
  acct=$(cf $CFAPI/accounts | jq -r '.result[0].id')
  ok=$(curl -fsS -H "Authorization: Bearer $tok" "$CFAPI/accounts/$acct/tokens/verify" | jq -r '.result.status // "invalid"' 2>/dev/null || echo invalid)
  jq -n --arg z "$zid" --arg st "$ok" '{secret_keys:["token","token_id","zone_id"], zone:"johnsonlegalteam.org", zone_id:$z, permission:"Cache Purge (this zone only)", status:$st}'
}
live_github() {
  local env pols prot
  env=$(gh "$GHAPI/environments/production" 2>/dev/null) || { echo '{}'; return; }
  pols=$(gh "$GHAPI/environments/production/deployment-branch-policies" | jq '[.branch_policies[]|{name,type}]|sort_by(.name)')
  prot=$(gh "$GHAPI/branches/production/protection" | jq '{allow_force_pushes:.allow_force_pushes.enabled, allow_deletions:.allow_deletions.enabled}')
  jq -n --argjson e "$env" --argjson p "$pols" --argjson b "$prot" '{
    environment:{reviewers:[$e.protection_rules[]?|select(.type=="required_reviewers")|.reviewers[].reviewer.login]|sort,
                 custom_branch_policies:$e.deployment_branch_policy.custom_branch_policies, branch_policies:$p},
    production_branch_protection:$b}'
}
cf_zone() { cf "$CFAPI/zones?name=$ZONE_NAME" | jq -r '.result[0].id'; }
cf_transform_ruleset() { cf "$CFAPI/zones/$1/rulesets" | jq -r '.result[]|select(.phase=="http_request_transform")|.id' | head -1; }
live_cf_rule() {
  local z rs; z=$(cf_zone); rs=$(cf_transform_ruleset "$z")
  [ -n "$rs" ] || { echo '{}'; return; }
  cf "$CFAPI/zones/$z/rulesets/$rs" | jq --arg d "$HTML_RULE_DESC" '[.result.rules[]|select(.description==$d)|{description,expression,enabled,action,action_parameters}][0] // {}'
}
live_routes() {
  local z; z=$(cf_zone)
  cf "$CFAPI/zones/$z/workers/routes" | jq '[.result[]|select(.script|test("^jlt-"))|{pattern,script}]|sort_by(.script,.pattern)'
}

ITEMS=(s3 oidc role:jlt-site-plan role:jlt-site-deploy purge github cf-rule routes)
live_of() { case "$1" in s3) live_s3;; oidc) live_oidc;; role:*) live_role "${1#role:}";; purge) live_purge;; github) live_github;; cf-rule) live_cf_rule;; routes) live_routes;; esac; }
file_of() { echo "$D/${1/:/-}.json"; }

# ---------- appliers ----------
apply_s3() {
  act s3 "versioning, website config, bucket policy" || return 0
  aws s3api put-bucket-versioning --bucket $BUCKET --region $REGION --versioning-configuration Status="$(jq -r .versioning "$1")"
  aws s3api put-bucket-website --bucket $BUCKET --region $REGION --website-configuration "$(jq -c .website "$1")"
  aws s3api put-bucket-policy --bucket $BUCKET --region $REGION --policy "$(jq -c .policy "$1")"
}
apply_oidc() {
  act oidc "create GitHub OIDC provider" || return 0
  aws iam create-open-id-connect-provider --url "https://$OIDC_URL" --client-id-list sts.amazonaws.com >/dev/null
}
apply_role() {
  local r=$1 f=$2
  act "role:$r" "create/update trust + inline policy" || return 0
  if aws iam get-role --role-name "$r" >/dev/null 2>&1; then
    aws iam update-assume-role-policy --role-name "$r" --policy-document "$(jq -c .trust "$f")"
  else
    aws iam create-role --role-name "$r" --description "$(jq -r .description "$f")" --assume-role-policy-document "$(jq -c .trust "$f")" \
      --tags Key=Project,Value=johnson-legal Key=ManagedBy,Value=infra-setup >/dev/null
  fi
  aws iam put-role-policy --role-name "$r" --policy-name "$(jq -r .inline_policy_name "$f")" --policy-document "$(jq -c .inline_policy "$f")"
}
apply_purge() {
  act purge "create a new Cache Purge token for $ZONE_NAME and store it in $PURGE_SECRET" || return 0
  local acct z body resp val
  acct=$(cf $CFAPI/accounts | jq -r '.result[0].id'); z=$(cf_zone)
  body=$(jq -nc --arg z "$z" --arg g "$CF_CACHE_PURGE_GROUP" '{name:"jlt-site-deploy-cache-purge",policies:[{effect:"allow",resources:{("com.cloudflare.api.account.zone."+$z):"*"},permission_groups:[{id:$g}]}]}')
  resp=$(cf -X POST "$CFAPI/accounts/$acct/tokens" -d "$body")
  val=$(jq -c --arg z "$z" '{token:.result.value, token_id:.result.id, zone_id:$z}' <<<"$resp")
  if aws secretsmanager describe-secret --secret-id $PURGE_SECRET --region $REGION >/dev/null 2>&1; then
    aws secretsmanager put-secret-value --secret-id $PURGE_SECRET --region $REGION --secret-string "$val" >/dev/null
  else
    aws secretsmanager create-secret --name $PURGE_SECRET --region $REGION --secret-string "$val" \
      --description "Cloudflare Cache Purge token for johnsonlegalteam.org (used by the S3 deploy workflow)" >/dev/null
  fi
  unset val resp
}
apply_github() {
  local f=$1 ids
  act github "production environment (reviewers, branch policies) + branch protection" || return 0
  ids=$(jq -r '.environment.reviewers[]' "$f" | while read -r login; do gh "https://api.github.com/users/$login" | jq '{type:"User",id:.id}'; done | jq -s .)
  gh -X PUT "$GHAPI/environments/production" -d "$(jq -nc --argjson r "$ids" '{wait_timer:0,prevent_self_review:false,reviewers:$r,deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}}')" >/dev/null
  local have; have=$(gh "$GHAPI/environments/production/deployment-branch-policies" | jq -c '[.branch_policies[]|{name,type}]')
  jq -c '.environment.branch_policies[]' "$f" | while read -r p; do
    jq -e --argjson p "$p" 'index($p)' <<<"$have" >/dev/null || gh -X POST "$GHAPI/environments/production/deployment-branch-policies" -d "$p" >/dev/null
  done
  gh -X PUT "$GHAPI/branches/production/protection" -d "$(jq -c '{required_status_checks:null,enforce_admins:false,required_pull_request_reviews:null,restrictions:null,
    allow_force_pushes:.production_branch_protection.allow_force_pushes, allow_deletions:.production_branch_protection.allow_deletions}' "$f")" >/dev/null
}
apply_cf_rule() {
  local f=$1 z rs id rule
  act cf-rule "\"$HTML_RULE_DESC\" transform rule" || return 0
  z=$(cf_zone); rs=$(cf_transform_ruleset "$z"); rule=$(jq -c '{description,expression,enabled,action,action_parameters}' "$f")
  if [ -z "$rs" ]; then
    cf -X PUT "$CFAPI/zones/$z/rulesets/phases/http_request_transform/entrypoint" -d "$(jq -nc --argjson r "$rule" '{rules:[$r]}')" >/dev/null; return
  fi
  id=$(cf "$CFAPI/zones/$z/rulesets/$rs" | jq -r --arg d "$HTML_RULE_DESC" '.result.rules[]|select(.description==$d)|.id' | head -1)
  if [ -n "$id" ]; then cf -X PATCH "$CFAPI/zones/$z/rulesets/$rs/rules/$id" -d "$rule" >/dev/null
  else cf -X POST "$CFAPI/zones/$z/rulesets/$rs/rules" -d "$rule" >/dev/null; fi
}
apply_routes() {
  local f=$1 z have
  act routes "create missing jlt-* Worker routes (Worker code is deployed by tools/*/deploy.sh)" || return 0
  z=$(cf_zone); have=$(live_routes)
  jq -c '.[]' "$f" | while read -r r; do
    jq -e --argjson r "$r" 'index($r)' <<<"$have" >/dev/null || cf -X POST "$CFAPI/zones/$z/workers/routes" -d "$r" >/dev/null
  done
}

# ---------- main ----------
case "$MODE" in
  record|check|apply) ;;
  *) sed -n '2,12p' "$0"; exit 2;;
esac
GH=$(gh_token); CF=$(cf_token)
for item in "${ITEMS[@]}"; do
  f=$(file_of "$item"); live=$(live_of "$item")
  case "$MODE" in
    record) norm <<<"$live" > "$f"; say "$item" "recorded -> ${f#$DIR/}";;
    check)
      if [ ! -f "$f" ]; then say "$item" "NO RECORD (run record)"; DRIFT=1
      elif same "$live" "$f"; then say "$item" "ok"
      else say "$item" "DRIFT:"; diff <(norm <"$f") <(norm <<<"$live") | sed 's/^/      /' | head -20; DRIFT=1; fi;;
    apply)
      [ -f "$f" ] || { say "$item" "no record; skipped"; continue; }
      if same "$live" "$f"; then say "$item" "ok (no change)"; continue; fi
      case "$item" in
        s3) apply_s3 "$f";; oidc) apply_oidc;; role:*) apply_role "${item#role:}" "$f";; purge) apply_purge;;
        github) apply_github "$f";; cf-rule) apply_cf_rule "$f";; routes) apply_routes "$f";;
      esac;;
  esac
done
unset GH CF
[ "$MODE" = check ] && exit $DRIFT || exit 0
