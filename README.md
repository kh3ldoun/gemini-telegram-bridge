# Gemini Telegram Bridge v2

Bridge your local [Gemini CLI](https://geminicli.com) session to Telegram.  
Talk to your local AI agent from anywhere — with streaming replies, per-user sessions, and a live dashboard.

---

## What's new in v2

| Feature | Details |
|---|---|
| **Per-user sessions** | Each Telegram user gets an isolated Gemini session. No cross-talk. |
| **Live streaming replies** | Bot edits its message in real-time as Gemini thinks, like a typing effect. |
| **Crash recovery** | Gemini subprocess auto-respawns on crash. Sessions recover automatically. |
| **Timeout handling** | All RPC calls have deadlines. Hung requests fail cleanly. |
| **Admin commands** | Manage users entirely from Telegram: approve, revoke, promote, list. |
| **File & image support** | Send photos or documents — forwarded to Gemini with captions. |
| **Web dashboard** | Live session monitor at `http://localhost:7823` with auto-refresh. |
| **Busy guard** | If you send a second message while one is processing, you get a clear notice. |
| **Session history** | `/history` shows your last 10 exchanges in the current session. |

---

## Prerequisites

- [Bun](https://bun.sh) (recommended) or Node.js 20+
- [Gemini CLI](https://geminicli.com) installed and authenticated (`gemini --acp` must work)
- A Telegram Bot Token from [@BotFather](https://t.me/BotFather)

---

## Installation

```bash
git clone https://github.com/yourusername/gemini-telegram-bridge.git
cd gemini-telegram-bridge
bun install
cp .env.example .env
# Edit .env and fill in TELEGRAM_BOT_TOKEN
```

---

## Running

```bash
# Production
bun run start

# Development (auto-restart on file changes)
bun run dev

# Follow logs
bun run logs
```

---

## Pairing (first-time access)

1. Message your bot on Telegram — any text works.
2. The bot replies with a 6-character pairing code.
3. Approve it **from Telegram** (if you're already an admin) using `/approve CODE`.
4. Or approve it from the terminal:

   ```bash
   # Linux / macOS
   touch ~/.gemini/channels/telegram/approved/YOUR_CODE

   # Windows PowerShell
   New-Item "$HOME\.gemini\channels\telegram\approved\YOUR_CODE"
   ```

5. The bot confirms. You're in.

> **First user to be approved automatically becomes admin.**

---

## Telegram Commands

### Everyone
| Command | What it does |
|---|---|
| `/start` | Welcome message + session info |
| `/help` | Show all available commands |
| `/reset` | Start a fresh conversation with Gemini |
| `/status` | Bridge health, session count, uptime |
| `/history` | Last 10 messages in your current session |
| `/myid` | Show your numeric Telegram user ID |

### Admin only
| Command | What it does |
|---|---|
| `/users` | List all approved users (🟢 = online) |
| `/pending` | Show pending pairing requests |
| `/approve <code>` | Approve a pairing code without touching the terminal |
| `/revoke <user_id>` | Revoke a user's access immediately |
| `/promote <user_id>` | Grant admin rights to a user |

---

## Web Dashboard

Open `http://localhost:7823` in your browser while the bridge is running.

Shows:
- Gemini status (online/offline, with pulsing indicator)
- Active sessions with last-activity time and busy state
- All approved users and whether they're currently connected
- Pending approvals with codes ready to copy
- Rolling log tail (last 30 lines)

Auto-refreshes every 5 seconds. Change the port with `DASHBOARD_PORT` in `.env`.

---

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | _(required)_ | Token from BotFather |
| `GEMINI_PATH` | `gemini` | Full path to `gemini.cmd` if not in PATH |
| `SESSION_TIMEOUT_MS` | `3600000` | Idle session expiry in ms (default 1h) |
| `STREAM_INTERVAL_MS` | `700` | How often to edit the message while streaming |
| `DASHBOARD_PORT` | `7823` | Port for the web dashboard |

---

## Auto-start on Windows

1. Create `start-bridge.vbs` somewhere permanent (e.g., `C:\Users\YourUser\scripts\`):

   ```vbs
   Set WshShell = CreateObject("WScript.Shell")
   WshShell.Run "bun run C:\path\to\gemini-telegram-bridge\bridge.ts", 0
   Set WshShell = Nothing
   ```

2. Press `Win + R`, type `shell:startup`, press Enter.
3. Place a shortcut to the `.vbs` file in that folder.

---

## Auto-start on Linux (systemd)

Create `/etc/systemd/system/gemini-bridge.service`:

```ini
[Unit]
Description=Gemini Telegram Bridge
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/path/to/gemini-telegram-bridge
EnvironmentFile=/path/to/gemini-telegram-bridge/.env
ExecStart=/home/YOUR_USER/.bun/bin/bun run bridge.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gemini-bridge
sudo journalctl -u gemini-bridge -f  # live logs
```

---

## Project structure

```
gemini-telegram-bridge/
├── bridge.ts      — Bot logic, commands, message handlers
├── gemini.ts      — GeminiProcess: lifecycle, RPC, streaming, crash recovery
├── access.ts      — AccessManager: users, pairing codes, admin roles
├── dashboard.ts   — Web dashboard (Bun HTTP server)
├── types.ts       — Shared TypeScript interfaces
├── .env.example   — Configuration template
└── bridge.log     — Runtime log file (auto-created)
```

---

## License

MIT
