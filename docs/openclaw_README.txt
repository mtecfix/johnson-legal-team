# 🦀 OpenClaw CLI Quick Reference

**OpenClaw** is a framework for managing autonomous AI agents across multiple communication channels (Telegram, WhatsApp, Discord, etc.) via a centralized WebSocket Gateway.

## 🚀 Getting Started

| Command | Description |
| :--- | :--- |
| `openclaw setup` | Initialize local config and agent workspace. |
| `openclaw configure` | Interactive wizard for credentials and agent defaults. |
| `openclaw onboard` | Step-by-step setup for gateway, workspaces, and skills. |
| `openclaw doctor` | Run health checks and quick fixes for the environment. |

## 🤖 Agent & Model Management
- **Run a turn:** `openclaw agent --message "Summarize my last 5 emails"`
- **List Skills:** `openclaw skills list`
- **Configure Models:** `openclaw models scan` (Discover and link LLM providers)
- **Manage Isolation:** `openclaw sandbox` (Handle containerized agent environments)

## 💬 Channels & Messaging
- **Link WhatsApp/Telegram:** `openclaw channels login --verbose`
- **Send a Message:** `openclaw message send --channel telegram --target @user --message "Hello"`
- **Check Status:** `openclaw status` (View channel health and recent recipients)
- **Directory:** `openclaw directory` (Lookup contact and group IDs)

## ⚙️ Gateway & Infrastructure
- **Start Gateway:** `openclaw gateway --port 18789`
- **View Logs:** `openclaw logs` (Tail gateway logs via RPC)
- **TUI Mode:** `openclaw tui` (Launch the Terminal User Interface)
- **Dashboard:** `openclaw dashboard` (Open the web UI with your current token)

## 🛠️ Advanced Tools
- **Backups:** `openclaw backup` (Archive local state)
- **Cron Jobs:** `openclaw cron` (Schedule tasks via the Gateway)
- **Memory:** `openclaw memory search` (Query the agent's long-term storage)
- **Secrets:** `openclaw secrets` (Reload environment variables/credentials)

---
**Official Docs:** [docs.openclaw.ai/cli](https://docs.openclaw.ai)
**Help:** Use `openclaw <command> --help` for specific flag details.
