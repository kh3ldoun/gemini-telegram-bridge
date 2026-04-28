# Gemini Telegram Bridge

Bridge your [Gemini CLI](https://geminicli.com) session to Telegram. Talk to your local AI agent from anywhere via Telegram.

## Features
- **Remote Access:** Chat with your local Gemini CLI through a Telegram bot.
- **Pairing System:** Secure pairing process to ensure only authorized users can access your session.
- **ACP Mode:** Uses Gemini's Agent Client Protocol for high-performance communication.

## Prerequisites
- [Bun](https://bun.sh) (Recommended) or Node.js.
- [Gemini CLI](https://geminicli.com) installed and authenticated.
- A Telegram Bot Token (from [@BotFather](https://t.me/BotFather)).

## Installation

1. **Clone the repo:**
   ```bash
   git clone https://github.com/yourusername/gemini-telegram-bridge.git
   cd gemini-telegram-bridge
   ```

2. **Install dependencies:**
   ```bash
   bun install
   ```

3. **Configure environment:**
   Create a `.env` file:
   ```env
   TELEGRAM_BOT_TOKEN=your_token_here
   # Optional: Path to gemini.cmd if not in PATH
   # GEMINI_PATH=C:\Path\To\gemini.cmd
   ```

4. **Run the bridge:**
   ```bash
   bun run bridge.ts
   ```

## Setup & Pairing
1. Message your bot on Telegram (e.g., send `/start`).
2. The bot will reply with a 6-digit pairing code.
3. On your computer (where the bridge is running), create a file in the `approved` folder named after the code:
   ```powershell
   # Windows Example
   New-Item -Path "$HOME\.gemini\channels\telegram\approved\YOUR_CODE" -ItemType File
   ```
4. The bot will confirm pairing, and you're ready to chat!

## Windows: Run on Startup
To make the bridge start automatically when you log in:

1. Create a file named `start-bridge.vbs` on your Desktop:
   ```vbs
   Set WshShell = CreateObject("WScript.Shell")
   WshShell.Run "bun run C:\Users\YourUser\Desktop\gemini-telegram-bridge\bridge.ts", 0
   Set WshShell = Nothing
   ```
2. Press `Win + R`, type `shell:startup`, and hit Enter.
3. Move the `start-bridge.vbs` file into that folder.

## Testing
To verify the bridge on Windows:
- Check `bridge.log` in the project directory for logs.
- Ensure `gemini --acp` works manually in your terminal first.
- If the bot doesn't reply, verify the `GEMINI_PATH` in your `.env` is correct.

## License
MIT
