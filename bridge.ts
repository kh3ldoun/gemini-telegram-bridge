import { Bot } from 'grammy';
import { randomBytes } from 'crypto';
import { appendFileSync, existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';

import { AccessManager, APPROVED_DIR } from './access';
import { GeminiProcess, type PromptContent } from './gemini';
import { startDashboard } from './dashboard';
import type { UserSession } from './types';

// ── Config ───────────────────────────────────────────────────────────────────

const TOKEN            = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_CMD       = process.env.GEMINI_PATH ?? 'gemini';
const SESSION_TIMEOUT  = Number(process.env.SESSION_TIMEOUT_MS  ?? 3_600_000); // 1h
const DASHBOARD_PORT   = Number(process.env.DASHBOARD_PORT      ?? 7823);
const STREAM_INTERVAL  = Number(process.env.STREAM_INTERVAL_MS  ?? 700);       // edit every 700 ms
const MAX_HISTORY      = 20;

if (!TOKEN) {
  console.error('[bridge] TELEGRAM_BOT_TOKEN is not set.');
  process.exit(1);
}

// ── Logging ──────────────────────────────────────────────────────────────────

const LOG_FILE    = join(process.cwd(), 'bridge.log');
const recentLogs: string[] = [];
const startedAt   = Date.now();

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
  recentLogs.push(line);
  if (recentLogs.length > 200) recentLogs.shift();
}

// ── Core objects ─────────────────────────────────────────────────────────────

const access      = new AccessManager();
const gemini      = new GeminiProcess({ cmd: GEMINI_CMD, onLog: log });
const bot         = new Bot(TOKEN!);
const userSessions = new Map<string, UserSession>();

// ── Gemini lifecycle ─────────────────────────────────────────────────────────

async function startGemini() {
  await gemini.start();
  try {
    await gemini.initialize();
  } catch (e) {
    log(`Gemini init error: ${e}`);
  }
}

gemini.on('crash', () => {
  userSessions.clear(); // sessions are gone when process dies
  for (const u of access.getUsers()) {
    const s = userSessions.get(u.userId);
    if (s && Date.now() - s.lastActivity < 120_000) {
      bot.api.sendMessage(u.userId, '⚠️ Gemini crashed. Reconnecting automatically…').catch(() => {});
    }
  }
});

gemini.on('respawn', () => {
  log('Gemini back online after crash');
  // Notify recently-active users
  for (const u of access.getUsers()) {
    bot.api.sendMessage(u.userId, '✅ Gemini is back online.').catch(() => {});
  }
});

// ── Session helpers ───────────────────────────────────────────────────────────

async function getOrCreateSession(userId: string, from: { username?: string; first_name?: string }): Promise<UserSession> {
  const existing = userSessions.get(userId);
  if (existing && Date.now() - existing.lastActivity < SESSION_TIMEOUT) {
    return existing;
  }

  const sessionId = await gemini.newSession();
  const session: UserSession = {
    sessionId,
    userId,
    username:     from.username,
    firstName:    from.first_name,
    lastActivity: Date.now(),
    messageCount: 0,
    history:      [],
    busy:         false,
  };
  userSessions.set(userId, session);
  log(`New session for user ${userId} → ${sessionId}`);
  return session;
}

function pushHistory(session: UserSession, role: 'user' | 'assistant', text: string) {
  session.history.push({ role, text, timestamp: Date.now() });
  if (session.history.length > MAX_HISTORY) session.history.shift();
}

// ── Streaming helper ─────────────────────────────────────────────────────────

async function streamReply(ctx: any, session: UserSession, content: PromptContent[]) {
  let accumulated = '';
  let msgId: number | null = null;
  let editPending = false;
  let done = false;

  // Initial placeholder message
  const placeholder = await ctx.reply('⏳');
  msgId = placeholder.message_id;

  // Debounced edit loop
  const editTimer = setInterval(async () => {
    if (!accumulated || done || !editPending) return;
    editPending = false;
    const display = accumulated + ' ▌';
    if (display.length > 4096) return;
    try {
      await bot.api.editMessageText(ctx.chat.id, msgId!, display);
    } catch {} // ignore "message not modified" errors
  }, STREAM_INTERVAL);

  try {
    await gemini.prompt(session.sessionId, content, (chunk) => {
      accumulated += chunk;
      editPending = true;
    });

    done = true;
    clearInterval(editTimer);

    const final = accumulated.trim() || '_(no response)_';

    if (final.length <= 4096) {
      await bot.api.editMessageText(ctx.chat.id, msgId!, final);
    } else {
      // Telegram max message length
      await bot.api.editMessageText(ctx.chat.id, msgId!, final.slice(0, 4096));
      for (let i = 4096; i < final.length; i += 4096) {
        await ctx.reply(final.slice(i, i + 4096));
      }
    }

    return final;
  } catch (e: any) {
    clearInterval(editTimer);
    done = true;
    const errMsg = `❌ Error: ${e.message}`;
    try { await bot.api.editMessageText(ctx.chat.id, msgId!, errMsg); } catch {}
    throw e;
  }
}

// ── Typing action loop ────────────────────────────────────────────────────────

async function withTyping(ctx: any, fn: () => Promise<void>) {
  let alive = true;
  const loop = async () => {
    while (alive) {
      await ctx.api.sendChatAction(ctx.chat.id, 'typing').catch(() => {});
      await new Promise(r => setTimeout(r, 4000));
    }
  };
  loop();
  try { await fn(); } finally { alive = false; }
}

// ── Authorization gate ────────────────────────────────────────────────────────

async function requestPairing(ctx: any) {
  const from = ctx.from!;
  const code = randomBytes(3).toString('hex').toUpperCase();

  access.addPending(code, {
    userId:    String(from.id),
    chatId:    String(ctx.chat.id),
    username:  from.username,
    firstName: from.first_name,
    expiresAt: Date.now() + 3_600_000,
  });

  await ctx.reply(
    `🔐 *Access Required*\n\n` +
    `Your pairing code: \`${code}\`\n\n` +
    `Ask an admin to run:\n\`/approve ${code}\`\n\n` +
    `Or approve from the terminal:\n\`touch ${APPROVED_DIR}/${code}\`\n\n` +
    `_Code expires in 1 hour._`,
    { parse_mode: 'Markdown' },
  );
}

// ── Commands ─────────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  const userId = String(ctx.from!.id);
  if (access.isAllowed(userId)) {
    const s = userSessions.get(userId);
    await ctx.reply(
      `👋 Welcome back, ${ctx.from!.first_name ?? 'friend'}!\n\n` +
      `You're connected to Gemini.${s ? ` (${s.messageCount} messages this session)` : ''}\n\n` +
      `Type /help for available commands.`,
    );
  } else {
    await ctx.reply(
      `👋 Hello! This is a private Gemini bridge.\n\nSend any message to request access.`,
    );
  }
});

bot.command('help', async (ctx) => {
  const userId = String(ctx.from!.id);
  const isAdmin = access.isAdmin(userId);
  await ctx.reply(
    `*Gemini Bridge — Commands*\n\n` +
    `*General*\n` +
    `/reset — Start a new conversation\n` +
    `/status — Bridge & Gemini health\n` +
    `/history — Last 10 messages this session\n` +
    `/myid — Show your Telegram user ID\n` +
    (isAdmin
      ? `\n*Admin*\n` +
        `/users — List all approved users\n` +
        `/pending — Show pending approvals\n` +
        `/approve <code> — Approve a pairing code\n` +
        `/revoke <id> — Revoke a user's access\n` +
        `/promote <id> — Make a user an admin\n`
      : ''),
    { parse_mode: 'Markdown' },
  );
});

bot.command('reset', async (ctx) => {
  const userId = String(ctx.from!.id);
  if (!access.isAllowed(userId)) return ctx.reply('Not authorized.');
  const had = userSessions.has(userId);
  userSessions.delete(userId);
  await ctx.reply(had ? '🔄 Session cleared. Your next message starts fresh.' : 'No active session to clear.');
});

bot.command('status', async (ctx) => {
  const up = Math.floor((Date.now() - startedAt) / 1000);
  const h  = Math.floor(up / 3600);
  const m  = Math.floor((up % 3600) / 60);
  const s  = up % 60;
  await ctx.reply(
    `*Bridge Status*\n\n` +
    `🤖 Gemini: ${gemini.ready ? '✅ Online' : '❌ Offline'}\n` +
    `💬 Active sessions: ${userSessions.size}\n` +
    `👥 Approved users: ${access.getUsers().length}\n` +
    `⏳ Pending approvals: ${Object.keys(access.getPendingList()).length}\n` +
    `⏱ Uptime: ${h}h ${m}m ${s}s\n` +
    `📊 Dashboard: http://localhost:${DASHBOARD_PORT}`,
    { parse_mode: 'Markdown' },
  );
});

bot.command('history', async (ctx) => {
  const userId = String(ctx.from!.id);
  if (!access.isAllowed(userId)) return ctx.reply('Not authorized.');

  const session = userSessions.get(userId);
  if (!session || session.history.length === 0) return ctx.reply('No history in this session.');

  const lines = session.history.slice(-10).map((h) => {
    const icon = h.role === 'user' ? '👤' : '🤖';
    const snippet = h.text.length > 120 ? h.text.slice(0, 120) + '…' : h.text;
    return `${icon} ${snippet}`;
  }).join('\n\n');

  await ctx.reply(`*Session history (last ${Math.min(10, session.history.length)})*\n\n${lines}`, {
    parse_mode: 'Markdown',
  });
});

bot.command('myid', (ctx) =>
  ctx.reply(`Your Telegram ID: \`${ctx.from!.id}\``, { parse_mode: 'Markdown' })
);

// ── Admin commands ────────────────────────────────────────────────────────────

bot.command('users', async (ctx) => {
  if (!access.isAdmin(String(ctx.from!.id))) return ctx.reply('Admin only.');
  const users = access.getUsers();
  if (!users.length) return ctx.reply('No approved users yet.');

  const lines = users.map((u) => {
    const name  = [u.firstName, u.username ? `@${u.username}` : ''].filter(Boolean).join(' ');
    const role  = u.isAdmin ? ' 👑' : '';
    const online = userSessions.has(u.userId) ? ' 🟢' : '';
    return `• ${name} \`${u.userId}\`${role}${online}`;
  }).join('\n');

  await ctx.reply(`*Approved Users (${users.length})*\n\n${lines}`, { parse_mode: 'Markdown' });
});

bot.command('pending', async (ctx) => {
  if (!access.isAdmin(String(ctx.from!.id))) return ctx.reply('Admin only.');
  const pending = Object.entries(access.getPendingList());
  if (!pending.length) return ctx.reply('No pending approvals.');

  const lines = pending.map(([code, p]) => {
    const name = [p.firstName, p.username ? `@${p.username}` : ''].filter(Boolean).join(' ');
    return `Code: \`${code}\`\nUser: ${name} (${p.userId})\nUse: /approve ${code}`;
  }).join('\n\n');

  await ctx.reply(`*Pending Approvals (${pending.length})*\n\n${lines}`, { parse_mode: 'Markdown' });
});

bot.command('approve', async (ctx) => {
  if (!access.isAdmin(String(ctx.from!.id))) return ctx.reply('Admin only.');
  const code = ctx.match?.trim();
  if (!code) return ctx.reply('Usage: /approve <code>');

  const approved = access.approve(code);
  if (approved) {
    log(`Admin approved user ${approved.userId} via /approve ${code}`);
    await ctx.reply(`✅ User ${approved.userId} approved.`);
    bot.api.sendMessage(approved.chatId, `✅ You've been approved! Send me a message to start talking to Gemini.`).catch(() => {});
  } else {
    await ctx.reply(`❌ Code \`${code}\` not found or expired.`, { parse_mode: 'Markdown' });
  }
});

bot.command('revoke', async (ctx) => {
  if (!access.isAdmin(String(ctx.from!.id))) return ctx.reply('Admin only.');
  const targetId = ctx.match?.trim();
  if (!targetId) return ctx.reply('Usage: /revoke <user_id>');

  if (access.revoke(targetId)) {
    userSessions.delete(targetId);
    log(`Admin revoked user ${targetId}`);
    await ctx.reply(`✅ User ${targetId} revoked.`);
    bot.api.sendMessage(targetId, '⛔ Your access to this bot has been revoked.').catch(() => {});
  } else {
    await ctx.reply(`User ${targetId} not found.`);
  }
});

bot.command('promote', async (ctx) => {
  if (!access.isAdmin(String(ctx.from!.id))) return ctx.reply('Admin only.');
  const targetId = ctx.match?.trim();
  if (!targetId) return ctx.reply('Usage: /promote <user_id>');

  if (access.promote(targetId)) {
    await ctx.reply(`✅ User ${targetId} is now an admin.`);
    bot.api.sendMessage(targetId, '👑 You have been promoted to admin.').catch(() => {});
  } else {
    await ctx.reply(`User ${targetId} not found.`);
  }
});

// ── Message handlers ──────────────────────────────────────────────────────────

async function handleAuthorizedMessage(ctx: any, content: PromptContent[], rawText: string) {
  const userId = String(ctx.from!.id);

  if (!gemini.ready) {
    await ctx.reply('⏳ Gemini is starting up. Please wait a moment and try again.');
    return;
  }

  const session = await getOrCreateSession(userId, ctx.from!);

  if (session.busy) {
    await ctx.reply('⏳ Still working on your previous message. Please wait.');
    return;
  }

  session.busy = true;
  session.lastActivity = Date.now();
  session.messageCount++;
  pushHistory(session, 'user', rawText);

  await withTyping(ctx, async () => {
    try {
      const response = await streamReply(ctx, session, content);
      pushHistory(session, 'assistant', response);
    } catch (e: any) {
      log(`Error responding to ${userId}: ${e.message}`);
    } finally {
      session.busy = false;
      session.lastActivity = Date.now();
    }
  });
}

// Text messages
bot.on('message:text', async (ctx) => {
  const userId = String(ctx.from!.id);
  if (!access.isAllowed(userId)) return requestPairing(ctx);

  const text = ctx.message.text;
  await handleAuthorizedMessage(ctx, [{ type: 'text', text }], text);
});

// Photos
bot.on('message:photo', async (ctx) => {
  const userId = String(ctx.from!.id);
  if (!access.isAllowed(userId)) return requestPairing(ctx);

  const photo   = ctx.message.photo.at(-1)!;
  const file    = await ctx.api.getFile(photo.file_id);
  const url     = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;
  const caption = ctx.message.caption ?? 'Describe this image in detail.';

  const content: PromptContent[] = [
    { type: 'image_url', image_url: { url } },
    { type: 'text', text: caption },
  ];
  await handleAuthorizedMessage(ctx, content, `[Image] ${caption}`);
});

// Documents / files
bot.on('message:document', async (ctx) => {
  const userId = String(ctx.from!.id);
  if (!access.isAllowed(userId)) return requestPairing(ctx);

  const doc     = ctx.message.document;
  const file    = await ctx.api.getFile(doc.file_id);
  const url     = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;
  const caption = ctx.message.caption ?? `Analyze this file: ${doc.file_name}`;

  const content: PromptContent[] = [
    { type: 'text', text: `[File attachment: ${doc.file_name} (${doc.mime_type ?? 'unknown type'}), URL: ${url}]\n${caption}` },
  ];
  await handleAuthorizedMessage(ctx, content, `[File: ${doc.file_name}] ${caption}`);
});

// ── File-system pairing watcher (backward-compat) ───────────────────────────

setInterval(() => {
  if (!existsSync(APPROVED_DIR)) return;
  for (const code of readdirSync(APPROVED_DIR)) {
    const filePath = join(APPROVED_DIR, code);
    const approved = access.approve(code);
    if (approved) {
      log(`Paired user ${approved.userId} via filesystem (code ${code})`);
      bot.api.sendMessage(approved.chatId, `✅ Paired! Send a message to start talking to Gemini.`).catch(() => {});
    }
    rmSync(filePath, { force: true });
  }
}, 2000);

// ── Session expiry cleanup ────────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  for (const [uid, session] of userSessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      userSessions.delete(uid);
      log(`Session expired for user ${uid}`);
    }
  }
}, 5 * 60_000);

// ── Dashboard ─────────────────────────────────────────────────────────────────

startDashboard({ port: DASHBOARD_PORT, gemini, access, userSessions, recentLogs, startedAt });

// ── Boot ──────────────────────────────────────────────────────────────────────

bot.catch((err) => log(`Bot error: ${err.message}`));

log('Starting bridge v2.0…');
await startGemini();
bot.start();
log('Bot polling started.');
