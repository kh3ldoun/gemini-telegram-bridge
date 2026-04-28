import { Bot, GrammyError, Context } from 'grammy';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Load .env variables
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_CMD = process.env.GEMINI_PATH || 'gemini';

if (!TOKEN) {
    console.error('Error: TELEGRAM_BOT_TOKEN not found in environment.');
    process.exit(1);
}

const STATE_DIR = join(homedir(), '.gemini', 'channels', 'telegram');
const ACCESS_FILE = join(STATE_DIR, 'access.json');
const LOG_FILE = join(process.cwd(), 'bridge.log');

function log(msg: string) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    appendFileSync(LOG_FILE, line);
    console.log(msg);
}

mkdirSync(STATE_DIR, { recursive: true });
log('Starting bridge...');

type Access = {
  allowFrom: string[];
  pending: Record<string, { senderId: string; chatId: string; expiresAt: number }>;
};

function loadAccess(): Access {
  if (existsSync(ACCESS_FILE)) {
    return JSON.parse(readFileSync(ACCESS_FILE, 'utf8'));
  }
  return { allowFrom: [], pending: {} };
}

function saveAccess(a: Access) {
  writeFileSync(ACCESS_FILE, JSON.stringify(a, null, 2));
}

const bot = new Bot(TOKEN);

log(`Spawning Gemini from: ${GEMINI_CMD}`);
const gemini = spawn(GEMINI_CMD, ['--acp', '--skip-trust'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true
});

let rpcId = 1;
const pendingRequests = new Map<number, (res: any) => void>();
let sessionId: string | null = null;
const sessionResponses = new Map<string, string>();

gemini.stdout.on('data', (data) => {
  const raw = data.toString();
  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pendingRequests.has(msg.id)) {
        const resolve = pendingRequests.get(msg.id)!;
        pendingRequests.delete(msg.id);
        resolve(msg);
      } else if (msg.method === 'session/update') {
          const update = msg.params.update;
          const sid = msg.params.sessionId;
          if (update.sessionUpdate === 'agent_message_chunk') {
              const current = sessionResponses.get(sid) || '';
              sessionResponses.set(sid, current + update.content.text);
          }
      }
    } catch (e) {}
  }
});

function sendRpc(method: string, params: any = {}) {
  const id = rpcId++;
  const request = { jsonrpc: '2.0', id, method, params };
  gemini.stdin.write(JSON.stringify(request) + '\n');
  return new Promise((resolve) => {
    pendingRequests.set(id, resolve);
  });
}

async function initGemini() {
    try {
        const initRes: any = await sendRpc('initialize', { 
            protocolVersion: 1,
            capabilities: {},
            clientInfo: { name: "telegram-bridge", version: "1.0.0" }
        });
        
        const sessionRes: any = await sendRpc('session/new', {
            cwd: process.cwd(),
            mcpServers: []
        });
        
        if (sessionRes.result) {
            sessionId = sessionRes.result.sessionId;
            log(`Session Ready: ${sessionId}`);
        }
    } catch (err) {
        log(`Init Error: ${err}`);
    }
}

initGemini();

bot.command('start', (ctx) => ctx.reply('Welcome! Send a message to start pairing with Gemini.'));

bot.on('message:text', async (ctx) => {
  const senderId = String(ctx.from.id);
  const currentAccess = loadAccess();

  if (currentAccess.allowFrom.includes(senderId)) {
    if (!sessionId) {
        await ctx.reply('Gemini is warming up. Please try again in a moment.');
        initGemini();
        return;
    }

    sessionResponses.set(sessionId, ''); 
    const res: any = await sendRpc('session/prompt', { 
        sessionId: sessionId,
        prompt: [{ type: 'text', text: ctx.message.text }]
    });
    
    if (res.result) {
        const finalResponse = sessionResponses.get(sessionId) || "Gemini had no reply.";
        await ctx.reply(finalResponse);
    }
    return;
  }

  const code = randomBytes(3).toString('hex');
  currentAccess.pending[code] = {
    senderId,
    chatId: String(ctx.chat.id),
    expiresAt: Date.now() + 3600000
  };
  saveAccess(currentAccess);
  await ctx.reply(`Pairing required. Run /telegram:pair ${code} in your local Gemini CLI.`);
});

const APPROVED_DIR = join(STATE_DIR, 'approved');
mkdirSync(APPROVED_DIR, { recursive: true });

setInterval(() => {
  const files = existsSync(APPROVED_DIR) ? require('fs').readdirSync(APPROVED_DIR) : [];
  for (const code of files) {
    const currentAccess = loadAccess();
    const p = currentAccess.pending[code];
    if (p) {
      currentAccess.allowFrom.push(p.senderId);
      delete currentAccess.pending[code];
      saveAccess(currentAccess);
      bot.api.sendMessage(p.chatId, 'Paired! You can now talk to Gemini.');
      require('fs').rmSync(join(APPROVED_DIR, code));
    }
  }
}, 2000);

bot.start();
log('Bot polling started.');
