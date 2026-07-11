# ============================================================
# Jude bridge container — trimmed from the AWS AgentCore OpenClaw sample.
# Dropped vs. upstream: Playwright/browser deps, ClawHub marketplace
# skills, Bedrock/Cognito/DynamoDB/EventBridge/STS SDK clients (Jude's
# model provider is Gemini over the internet, not Bedrock — see
# docs/JUDE-OPENCLAW-SPEC.md §2/§9). Kept: OpenClaw itself, the S3 SDK
# (workspace sync) and Secrets Manager SDK (Gemini key + hooks token).
# ============================================================

# ============================================================
# Stage 1: Builder
# ============================================================
FROM public.ecr.aws/docker/library/node:22-slim AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl jq git openssh-client && \
    rm -rf /var/lib/apt/lists/*

# Force git to use HTTPS instead of SSH (openclaw has transitive git+ssh deps)
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" && \
    git config --global url."https://github.com/".insteadOf "git@github.com:" && \
    git config --global url."https://github.com/".insteadOf "git://github.com/"

# Pinned OpenClaw version — bump intentionally after testing.
# Release notes: https://github.com/openclaw/openclaw/releases
# NOTE: bumped from 2026.3.8 to 2026.6.11 because 2026.3.8 had a
# transitive git+ssh dep (@whiskeysockets/baileys -> libsignal-node)
# that broke Docker builds without SSH keys. 2026.6.11 dropped it.
RUN npm install -g openclaw@2026.6.11

RUN mkdir -p /app
WORKDIR /app

RUN npm init -y > /dev/null 2>&1 && \
    npm install --omit=dev \
                @aws-sdk/client-s3 \
                @aws-sdk/client-secrets-manager

# ============================================================
# Stage 2: Runtime
# ============================================================
FROM public.ecr.aws/docker/library/node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# Copy OpenClaw from builder
COPY --from=builder /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/openclaw/openclaw.mjs /usr/local/bin/openclaw

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/package.json /app/package.json
ENV NODE_PATH=/app/node_modules

WORKDIR /app
RUN mkdir -p /root/.openclaw

COPY agentcore-contract.js /app/agentcore-contract.js
COPY workspace-sync.js /app/workspace-sync.js

# Workspace prompt files — Jude's operating rules, persona, tool notes
# (see docs/JUDE-OPENCLAW-SPEC.md §6/§7/§8)
COPY workspace-jude/AGENTS.md /root/.openclaw/workspace-jude/AGENTS.md
COPY workspace-jude/SOUL.md /root/.openclaw/workspace-jude/SOUL.md
COPY workspace-jude/TOOLS.md /root/.openclaw/workspace-jude/TOOLS.md

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080

# AgentCore Runtime uses /ping for health checks — no Docker HEALTHCHECK needed.
ENTRYPOINT ["/app/entrypoint.sh"]
