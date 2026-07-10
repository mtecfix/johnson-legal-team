#!/bin/bash
# Start the contract server immediately — AgentCore requires a fast /ping response.
# Secrets are fetched by the contract server itself via the AWS SDK.
# Do NOT use set -e — the contract server must start regardless of any pre-flight issues.

echo "[jude] Starting Jude on AgentCore Runtime..."
echo "[jude] Node: $(node --version 2>&1 || echo 'not found')"
echo "[jude] AWS_REGION=${AWS_REGION:-not set}"

echo "[jude] Starting AgentCore contract server on port 8080..."
exec node /app/agentcore-contract.js
