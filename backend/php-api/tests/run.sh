#!/usr/bin/env bash
# Integration tests against the real front controller with fake AWS services.
set -uo pipefail
cd "$(dirname "$0")/.."
rm -f /tmp/jlt-fake-state.json
php -d display_errors=stderr -d error_reporting=-1 -S 127.0.0.1:8099 tests/router.php >/tmp/jlt-php-server.log 2>&1 & PID=$!; trap 'kill $PID' EXIT; sleep 1
B=http://127.0.0.1:8099; FAIL=0
ok(){ if [ "$1" = "$2" ]; then echo "PASS $3"; else echo "FAIL $3 (got '$1', want '$2')"; FAIL=$((FAIL+1)); fi; }
post(){ curl -s -o /tmp/r.json -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$2" "$B$1"; }
# st '<php statements that echo>': inspect the fake AWS state.
st(){ php -r '$s=json_decode(file_get_contents("/tmp/jlt-fake-state.json"),true); '"$1"; }

ok "$(curl -s -o /dev/null -w '%{http_code}' $B/api/health)" 200 "health"
ok "$(curl -s -o /dev/null -w '%{http_code}' $B/api/nope.php)" 404 "unknown route 404"
ok "$(curl -s -o /dev/null -w '%{http_code}' $B/api/user-registration.php)" 405 "GET rejected"
ok "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS $B/api/onboarding.php)" 204 "CORS preflight"
ok "$(curl -s -D - -o /dev/null -X OPTIONS $B/api/onboarding.php | grep -ci '^access-control-allow-origin: https://johnsonlegalteam.org')" 1 "CORS limited to site origin"
ok "$(post /api/user-registration.php 'not json')" 400 "invalid JSON"
ok "$(post /api/user-registration.php '{"email":"a@b.co"}')" 400 "missing fields"
ok "$(post /api/user-registration.php "{\"email\":\"a@b.co\",\"role\":\"client\",\"firstName\":\"$(printf 'x%.0s' $(seq 1 120))\",\"lastName\":\"L\",\"phone\":\"1\"}")" 400 "field too long"
ok "$(post /api/user-registration.php '{"email":"bad","role":"client","firstName":"F","lastName":"L","phone":"1"}')" 400 "bad email"

# registration
R='{"email":"Jane@Example.com","role":"super_admin","firstName":"Jane","lastName":"Doe","phone":"313-555-0100","city":"Detroit","state":"MI","preferredContact":"email"}'
ok "$(post /api/user-registration.php "$R")" 200 "register"
ok "$(st 'echo $s["tables"]["users-t"]["jane@example.com"]["role"]["S"];')" client "role forced to client (super_admin ignored)"
ok "$(post /api/user-registration.php "$R")" 409 "duplicate registration"
ok "$(st 'echo count($s["emails"]);')" 1 "registration email sent once"

# legal onboarding with XSS attempt
L='{"email":"sam@example.com","firstName":"Sam","lastName":"<script>x</script>","legalMatter":"expungement","urgency":"soon","caseDescription":"Need record cleared <b>now</b>","preferredContact":"phone","bestTime":"morning","consentContact":true}'
ok "$(post /api/legal-onboarding.php "$L")" 200 "legal intake"
ok "$(post /api/legal-onboarding.php '{"email":"x@y.co","legalMatter":"hacking","urgency":"soon","caseDescription":"d","preferredContact":"phone"}')" 400 "invalid legal matter rejected"
ok "$(st 'echo str_contains(end($s["emails"])["html"],"<script>") ? "raw":"escaped";')" escaped "intake email escapes HTML"
LINK=$(st 'preg_match("#href=\"([^\"]*action=approve[^\"]*)\"#",end($s["emails"])["html"],$m); echo html_entity_decode($m[1]);')
DENY=$(st 'preg_match("#href=\"([^\"]*action=deny[^\"]*)\"#",end($s["emails"])["html"],$m); echo html_entity_decode($m[1]);')
ok "$(echo "$LINK" | grep -c '^https://johnsonlegalteam.org/api/approve-registration.php?type=legal&email=sam%40example.com&action=approve&token=')" 1 "approve link format"
P=${LINK#https://johnsonlegalteam.org}
ok "$(curl -s -o /dev/null -w '%{http_code}' "$B${P%?}0")" 403 "tampered token rejected"
ok "$(curl -s -o /dev/null -w '%{http_code}' "$B${P/action=approve/action=deny}")" 403 "approve token not valid for deny"
ok "$(curl -s "$B$P" | grep -c 'method="POST"')" 1 "GET shows confirmation, no change"
ok "$(st 'echo $s["tables"]["legal-t"]["sam@example.com"]["status"]["S"];')" pending_review "still pending after GET"
ok "$(curl -s -o /tmp/p.html -w '%{http_code}' -X POST "$B$P")" 200 "POST approves"
ok "$(st 'echo $s["tables"]["legal-t"]["sam@example.com"]["status"]["S"];')" approved "status approved"
ok "$(st 'echo isset($s["users"]["sam@example.com"]) ? "yes":"no";')" yes "Cognito user created"
ok "$(st 'echo $s["tables"]["users-t"]["sam@example.com"]["source"]["S"];')" legal_onboarding "profile created on approve"
ok "$(curl -s -X POST "$B$P" | grep -c 'Already handled')" 1 "second approve is a no-op"

# client onboarding + deny with SES-sandbox rejection
C='{"email":"pat@unverified.test","legalMatter":"traffic","urgency":"immediate","caseDescription":"Speeding","preferredContact":"email","referralSource":"Google"}'
ok "$(post /api/onboarding.php "$C")" 200 "client onboarding #1"
ok "$(post /api/onboarding.php "$C")" 200 "client onboarding #2 (kept separately)"
ok "$(st 'echo count($s["tables"]["client-t"]);')" 2 "both submissions stored"
CD=$(st 'preg_match("#href=\"([^\"]*action=deny[^\"]*)\"#",end($s["emails"])["html"],$m); echo html_entity_decode($m[1]);')
ok "$(curl -s -X POST "$B${CD#https://johnsonlegalteam.org}" | grep -c 'could not be emailed')" 1 "deny saved even when SES rejects client email"
ok "$(st 'echo implode(",",array_map(fn($i)=>$i["status"]["S"],$s["tables"]["client-t"]));')" "denied,denied" "all pending submissions denied"
ok "$(st 'echo isset($s["users"]["pat@unverified.test"]) ? "yes":"no";')" no "no login created on deny"

ok "$(grep -ciE 'fatal|warning|deprecated' /tmp/jlt-php-server.log)" 0 "no PHP warnings/errors in server log"
[ "$FAIL" = 0 ] && echo "ALL TESTS PASSED" || { echo "$FAIL FAILURES"; grep -vE 'Accepted|Closing' /tmp/jlt-php-server.log | tail -20; exit 1; }
