/**
 * Jude AgentCore Runtime Contract Server — single-tenant.
 *
 * Purpose-built, simplified replacement for the multi-user contract server
 * in aws-samples/sample-host-openclaw-on-amazon-bedrock-agentcore. Keeps
 * the required AgentCore HTTP protocol contract:
 *   - GET  /ping         -> Health check (Healthy/HealthyBusy)
 *   - POST /invocations  -> Runs one Jude turn, returns the response text
 *
 * Dropped vs. the upstream sample (see docs/JUDE-OPENCLAW-SPEC.md §3/§9
 * for the full rationale):
 *   - No Bedrock proxy process (agentcore-proxy.js) — OpenClaw's Gemini
 *     provider talks to generativelanguage.googleapis.com directly.
 *   - No per-user scoped STS credentials — single tenant, execution role
 *     is already scoped to exactly what Jude needs.
 *   - No Telegram/Slack streaming, no browser sessions, no EventBridge
 *     cron wiring, no session-storage-mount symlink dance — Jude has one
 *     caller (the Router Lambda) and one fixed session ("jude-main").
 *   - No lightweight-agent warm-up shim — Jude's calls are infrequent
 *     (lead triage, not live chat), so waiting ~1-2 min for full OpenClaw
 *     startup on a cold invocation is acceptable; the Router Lambda's
 *     timeout is set accordingly (see stacks/router_stack.py).
 *
 * Kept as-is: workspace-sync.js (S3 persistence of ~/.openclaw/), the
 * /ping health-check semantics AgentCore Runtime depends on for idle
 * termination, and the SIGTERM graceful-shutdown-with-save pattern.
 */

const http = require("http");
const fs = require("fs");
const { spawn } = require("child_process");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const workspaceSync = require("./workspace-sync");

const PORT = 8080;
const OPENCLAW_PORT = 18789;
const NAMESPACE = "jude-main"; // single fixed tenant — see spec §3

const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1MB

// --- Secrets (fetched eagerly at boot) --------------------------------------
let GEMINI_API_KEY = null;
let HOOKS_TOKEN = null;
let secretsReady = false;
let secretsPrefetchPromise = null;

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });

async function fetchSecret(secretName) {
  const resp = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretName }),
  );
  return resp.SecretString;
}

async function prefetchSecrets() {
  try {
    const [geminiKey, hooksToken] = await Promise.all([
      fetchSecret(process.env.GEMINI_API_KEY_SECRET_NAME),
      fetchSecret(process.env.HOOKS_TOKEN_SECRET_NAME),
    ]);
    GEMINI_API_KEY = geminiKey;
    HOOKS_TOKEN = hooksToken;
    secretsReady = true;
    console.log("[contract] Secrets pre-fetched successfully");
  } catch (err) {
    console.error(`[contract] Secret pre-fetch failed: ${err.message}`);
  }
}

// --- OpenClaw process management ---------------------------------------------
let openclawProcess = null;
let openclawReady = false;
let openclawExitCode = null;
let openclawRestartCount = 0;
const OPENCLAW_MAX_RESTARTS = 3;
const OPENCLAW_RESTART_DELAY_MS = 5000;
let initPromise = null;
let initInProgress = false;
let activeTaskCount = 0;
let shuttingDown = false;

/**
 * Write OpenClaw's config pointing the "jude" agent at Gemini's native
 * OpenAI-compatible endpoint. No proxy — see docs/JUDE-OPENCLAW-SPEC.md §2.
 */
function writeOpenClawConfig() {
  const config = {
    models: {
      providers: {
        gemini: {
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
          apiKey: GEMINI_API_KEY,
          api: "openai-completions",
          models: [
            { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite" },
          ],
        },
      },
    },
    agents: {
      defaults: {
        model: { primary: "gemini/gemini-3.1-flash-lite" },
        sandbox: { mode: "off" }, // AgentCore microVM provides isolation
      },
      list: [
        {
          id: "jude",
          default: true,
          workspace: "~/.openclaw/workspace-jude",
        },
      ],
    },
    hooks: {
      enabled: true,
      token: HOOKS_TOKEN,
      path: "/hooks",
      defaultSessionKey: "hook:leads",
      allowRequestSessionKey: false,
      allowedSessionKeyPrefixes: ["hook:"],
      mappings: [
        { match: { path: "new-lead" }, action: "agent", agentId: "jude", deliver: true },
        { match: { path: "call-event" }, action: "agent", agentId: "jude", deliver: true },
      ],
    },
    gateway: {
      port: OPENCLAW_PORT,
      bind: "127.0.0.1",
    },
  };

  const home = process.env.HOME || "/root";
  fs.mkdirSync(`${home}/.openclaw`, { recursive: true });
  fs.writeFileSync(`${home}/.openclaw/openclaw.json`, JSON.stringify(config, null, 2));
  console.log("[contract] Wrote openclaw.json (Gemini provider, no proxy)");
}

async function waitForPort(port, label, timeoutMs = 180000, intervalMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/", timeout: 1500 },
        (res) => {
          res.resume();
          resolve(true);
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.warn(`[contract] ${label} did not become ready within ${timeoutMs}ms`);
  return false;
}

function scheduleOpenClawRestart() {
  if (shuttingDown) return;
  if (openclawRestartCount >= OPENCLAW_MAX_RESTARTS) {
    console.error("[contract] OpenClaw exceeded max restart attempts — giving up");
    return;
  }
  openclawRestartCount++;
  console.log(`[contract] Scheduling OpenClaw restart #${openclawRestartCount} in ${OPENCLAW_RESTART_DELAY_MS}ms`);
  setTimeout(() => {
    startOpenClaw();
  }, OPENCLAW_RESTART_DELAY_MS);
}

function startOpenClaw() {
  console.log("[contract] Starting OpenClaw gateway (headless)...");
  openclawProcess = spawn(
    "openclaw",
    ["gateway", "run", "--port", String(OPENCLAW_PORT), "--verbose"],
    { stdio: ["ignore", "pipe", "pipe"], env: process.env },
  );
  const logPrefix = (label) => (chunk) => {
    chunk.toString().split("\n").filter(Boolean).forEach((line) => {
      console.log(`[openclaw:${label}] ${line}`);
    });
  };
  openclawProcess.stdout.on("data", logPrefix("out"));
  openclawProcess.stderr.on("data", logPrefix("err"));
  openclawProcess.on("exit", (code) => {
    console.log(`[contract] OpenClaw exited with code ${code}`);
    openclawExitCode = code;
    openclawReady = false;
    scheduleOpenClawRestart();
  });
}

async function init() {
  if (openclawReady) return;
  if (initInProgress) return initPromise;
  initInProgress = true;

  initPromise = (async () => {
    if (!secretsReady && secretsPrefetchPromise) {
      await secretsPrefetchPromise;
    }
    if (!secretsReady) {
      await prefetchSecrets();
    }
    if (!GEMINI_API_KEY || !HOOKS_TOKEN) {
      throw new Error("Required secrets not available — cannot start OpenClaw");
    }

    // Restore workspace from S3 (fire-and-forget; OpenClaw will pick up
    // whatever is there by the time it's ready — this is a cold-cache
    // race the upstream sample also accepts for the first invocation
    // after a fresh microVM).
    workspaceSync.restoreWorkspace(NAMESPACE).catch((err) => {
      console.warn(`[contract] Workspace restore failed: ${err.message}`);
    });

    writeOpenClawConfig();
    startOpenClaw();

    openclawReady = await waitForPort(OPENCLAW_PORT, "OpenClaw", 180000, 2000);
    if (!openclawReady) {
      throw new Error("OpenClaw failed to become ready within 180s");
    }
    openclawRestartCount = 0;

    workspaceSync.startPeriodicSave(
      NAMESPACE,
      parseInt(process.env.WORKSPACE_SYNC_INTERVAL_MS || "300000", 10),
    );

    console.log("[contract] Init complete — OpenClaw ready");
  })();

  try {
    await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  } finally {
    initInProgress = false;
  }
}

/**
 * Send a chat message to OpenClaw's gateway over its local HTTP/WS API
 * and return the response text. Uses OpenClaw's OpenAI-compatible chat
 * completions surface on the gateway port (agent="jude").
 */
async function chatWithOpenClaw(message, timeoutMs = 170000) {
  const body = JSON.stringify({
    model: "jude", // routed to the "jude" agent (default agent)
    messages: [{ role: "user", content: message }],
  });

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: OPENCLAW_PORT,
        path: "/v1/chat/completions",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed?.choices?.[0]?.message?.content || "";
            resolve(text);
          } catch (err) {
            reject(new Error(`Failed to parse OpenClaw response: ${err.message}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("OpenClaw request timed out"));
    });
    req.write(body);
    req.end();
  });
}

// --- HTTP server (AgentCore protocol contract) --------------------------------
const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: activeTaskCount > 0 ? "HealthyBusy" : "Healthy",
        openclawReady,
        activeTasks: activeTaskCount,
      }),
    );
    return;
  }

  if (req.method === "POST" && req.url === "/invocations") {
    let body = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on("end", async () => {
      if (tooLarge) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload too large" }));
        return;
      }
      let payload;
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      activeTaskCount++;
      try {
        await init();
        const message = JSON.stringify(payload); // hand the whole hook payload to Jude
        const responseText = await chatWithOpenClaw(message);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ response: responseText }));
      } catch (err) {
        console.error("[contract] Invocation error:", err.message, err.stack);
        // Return 200 with a generic error — AgentCore treats 5xx as infra failure.
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ response: "An internal error occurred. Please try again." }));
      } finally {
        activeTaskCount = Math.max(0, activeTaskCount - 1);
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// --- Graceful shutdown: save workspace before exit -----------------------------
process.on("SIGTERM", async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[contract] SIGTERM received — saving workspace and shutting down");

  const saveTimeout = setTimeout(() => {
    console.warn("[contract] Workspace save timeout — exiting");
    process.exit(0);
  }, 10000);

  try {
    await workspaceSync.cleanup(NAMESPACE);
  } catch (err) {
    console.warn(`[contract] Workspace cleanup error: ${err.message}`);
  }
  clearTimeout(saveTimeout);

  if (openclawProcess) {
    try {
      openclawProcess.kill("SIGTERM");
    } catch {}
  }
  console.log("[contract] Shutdown complete");
  process.exit(0);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[contract] Jude AgentCore contract server listening on http://0.0.0.0:${PORT}`);
  console.log("[contract] Endpoints: GET /ping, POST /invocations");
  secretsPrefetchPromise = prefetchSecrets();
});
