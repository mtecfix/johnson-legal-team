"""Jude Router Lambda — POST /hooks/{path} -> AgentCore InvokeAgentRuntime.

Trimmed, single-caller replacement for the Telegram/Slack/Feishu webhook
router in aws-samples/sample-host-openclaw-on-amazon-bedrock-agentcore.
The only caller is our own jude-leads / jude-notify-owner Lambdas (see
docs/JUDE-OPENCLAW-SPEC.md §4), authenticated via a single shared bearer
token rather than per-channel webhook signature verification.

Request shape expected from jude-leads/jude-notify-owner:
  POST /hooks/new-lead
  Authorization: Bearer <JUDE_HOOKS_TOKEN>
  Content-Type: application/json
  { "leadId": "...", "caseType": "...", "score": 75, "subject": "...", "firstMessage": "..." }

Response: { "response": "<Jude's reply text>" } or an error shape.
"""

import json
import logging
import os

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

RUNTIME_ARN = os.environ["RUNTIME_ARN"]
RUNTIME_ENDPOINT_ID = os.environ.get("RUNTIME_ENDPOINT_ID", "DEFAULT")
HOOKS_TOKEN_SECRET_NAME = os.environ["HOOKS_TOKEN_SECRET_NAME"]
SESSION_ID = os.environ.get("SESSION_ID", "jude-main")

_secrets_client = None
_agentcore_client = None
_cached_hooks_token = None


def secrets_client():
    global _secrets_client
    if _secrets_client is None:
        _secrets_client = boto3.client("secretsmanager")
    return _secrets_client


def agentcore_client():
    global _agentcore_client
    if _agentcore_client is None:
        _agentcore_client = boto3.client("bedrock-agentcore")
    return _agentcore_client


def get_hooks_token():
    """Fetch (and cache for the container's lifetime) the shared hooks token."""
    global _cached_hooks_token
    if _cached_hooks_token is None:
        resp = secrets_client().get_secret_value(SecretId=HOOKS_TOKEN_SECRET_NAME)
        _cached_hooks_token = resp["SecretString"]
    return _cached_hooks_token


def _cors_headers():
    return {"Content-Type": "application/json"}


def _resp(status_code, body_dict):
    return {
        "statusCode": status_code,
        "headers": _cors_headers(),
        "body": json.dumps(body_dict),
    }


def _extract_bearer_token(event):
    headers = event.get("headers") or {}
    # API Gateway HTTP API lowercases header names.
    auth_header = headers.get("authorization") or headers.get("Authorization") or ""
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    return None


def invoke_agent_runtime(hook_path, payload_dict):
    """Invoke Jude's AgentCore runtime with a hook-routed payload.

    OpenClaw's `hooks.mappings` config (see spec §4) routes on the
    `path` segment of the URL — the payload here is passed through as
    the hook's request body/context for the "new-lead" / "call-event"
    mappings to act on.
    """
    payload = json.dumps({
        "path": hook_path,
        **payload_dict,
    }).encode()

    logger.info("Invoking AgentCore: arn=%s session=%s hook_path=%s", RUNTIME_ARN, SESSION_ID, hook_path)
    resp = agentcore_client().invoke_agent_runtime(
        agentRuntimeArn=RUNTIME_ARN,
        qualifier=RUNTIME_ENDPOINT_ID,
        runtimeSessionId=SESSION_ID,
        payload=payload,
        contentType="application/json",
        accept="application/json",
    )

    MAX_RESPONSE_BYTES = 200_000
    body = resp.get("response")
    if not body:
        return {"response": "No response from Jude."}
    if hasattr(body, "read"):
        body_bytes = body.read(MAX_RESPONSE_BYTES + 1)
        body_text = body_bytes.decode("utf-8", errors="replace")[:MAX_RESPONSE_BYTES]
    else:
        body_text = str(body)[:MAX_RESPONSE_BYTES]

    try:
        return json.loads(body_text)
    except json.JSONDecodeError:
        return {"response": body_text}


def handler(event, context):
    method = (event.get("requestContext", {}).get("http", {}) or {}).get("method")
    if method == "OPTIONS":
        return {"statusCode": 204, "headers": _cors_headers(), "body": ""}
    if method != "POST":
        return _resp(405, {"error": "Method not allowed"})

    # --- Auth: shared bearer token ---
    token = _extract_bearer_token(event)
    if not token:
        return _resp(401, {"error": "Missing Authorization header"})
    try:
        expected_token = get_hooks_token()
    except Exception:
        logger.exception("Failed to fetch hooks token from Secrets Manager")
        return _resp(500, {"error": "Server error"})
    if token != expected_token:
        logger.warning("Rejected request with invalid hooks token")
        return _resp(401, {"error": "Invalid token"})

    # --- Path: /hooks/{path} ---
    hook_path = (event.get("pathParameters") or {}).get("path")
    if not hook_path:
        return _resp(400, {"error": "Missing hook path"})

    # --- Body ---
    raw_body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        import base64
        raw_body = base64.b64decode(raw_body).decode("utf-8")
    try:
        payload_dict = json.loads(raw_body)
    except json.JSONDecodeError:
        return _resp(400, {"error": "Invalid JSON body"})

    try:
        result = invoke_agent_runtime(hook_path, payload_dict)
        return _resp(200, result)
    except Exception:
        logger.exception("AgentCore invocation failed")
        return _resp(502, {"error": "Jude is unavailable right now"})
