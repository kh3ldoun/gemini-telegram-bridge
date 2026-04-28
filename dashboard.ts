import type { GeminiProcess } from './gemini';
import type { AccessManager } from './access';
import type { UserSession } from './types';

interface DashboardConfig {
  port: number;
  gemini: GeminiProcess;
  access: AccessManager;
  userSessions: Map<string, UserSession>;
  recentLogs: string[];
  startedAt: number;
}

function formatUptime(startedAt: number): string {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function renderHtml(cfg: DashboardConfig): string {
  const { gemini, access, userSessions, recentLogs, startedAt } = cfg;
  const sessions = [...userSessions.values()];
  const users = access.getUsers();
  const pending = Object.entries(access.getPendingList());

  const sessionRows = sessions.length
    ? sessions.map(s => `
      <tr>
        <td>${s.firstName ?? ''}${s.username ? ' <span class="dim">@' + s.username + '</span>' : ''}</td>
        <td class="mono">${s.userId}</td>
        <td class="mono dim">${s.sessionId.slice(0, 10)}…</td>
        <td>${s.messageCount}</td>
        <td>${timeAgo(s.lastActivity)}</td>
        <td><span class="badge ${s.busy ? 'badge-yellow' : 'badge-green'}">${s.busy ? 'Busy' : 'Idle'}</span></td>
        <td><span class="badge ${access.isAdmin(s.userId) ? 'badge-blue' : 'badge-gray'}">${access.isAdmin(s.userId) ? 'Admin' : 'User'}</span></td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="empty">No active sessions</td></tr>';

  const userRows = users.length
    ? users.map(u => `
      <tr>
        <td>${u.firstName ?? ''} ${u.username ? '<span class="dim">@' + u.username + '</span>' : ''}</td>
        <td class="mono">${u.userId}</td>
        <td>${new Date(u.approvedAt).toLocaleDateString()}</td>
        <td><span class="badge ${u.isAdmin ? 'badge-blue' : 'badge-gray'}">${u.isAdmin ? 'Admin' : 'User'}</span></td>
        <td><span class="badge ${userSessions.has(u.userId) ? 'badge-green' : 'badge-gray'}">${userSessions.has(u.userId) ? 'Online' : 'Offline'}</span></td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="empty">No approved users</td></tr>';

  const pendingRows = pending.length
    ? pending.map(([code, p]) => `
      <tr>
        <td class="mono">${code}</td>
        <td>${p.firstName ?? ''} ${p.username ? '@' + p.username : ''}</td>
        <td class="mono">${p.userId}</td>
        <td>${new Date(p.expiresAt).toLocaleTimeString()}</td>
      </tr>`).join('')
    : '<tr><td colspan="4" class="empty">No pending approvals</td></tr>';

  const logLines = recentLogs.slice(-30).reverse().map(l =>
    `<div class="log-line">${l.replace(/</g, '&lt;')}</div>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gemini Bridge</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0d1117; color: #c9d1d9; min-height: 100vh; padding: 24px; }
    h1 { font-size: 1.25rem; font-weight: 600; color: #58a6ff; margin-bottom: 24px; display: flex; align-items: center; gap: 10px; }
    h1 .dot { width: 10px; height: 10px; border-radius: 50%; background: ${gemini.ready ? '#3fb950' : '#f85149'}; animation: ${gemini.ready ? 'pulse 2s infinite' : 'none'}; }
    @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }
    .meta { font-size: 0.75rem; color: #8b949e; margin-left: auto; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
    .stat-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: .08em; color: #8b949e; margin-bottom: 6px; }
    .stat-value { font-size: 2rem; font-weight: 700; color: #e6edf3; }
    .stat-value.green { color: #3fb950; }
    .stat-value.red { color: #f85149; }
    section { margin-bottom: 24px; }
    section h2 { font-size: 0.85rem; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 10px; }
    .table-wrap { overflow-x: auto; border-radius: 8px; border: 1px solid #30363d; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th { background: #161b22; padding: 10px 14px; text-align: left; font-size: 0.7rem; color: #8b949e; text-transform: uppercase; letter-spacing: .06em; white-space: nowrap; }
    td { padding: 10px 14px; border-top: 1px solid #21262d; white-space: nowrap; }
    .empty { text-align: center; color: #8b949e; padding: 20px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 0.7rem; font-weight: 600; }
    .badge-green  { background: #0f2a1a; color: #3fb950; border: 1px solid #238636; }
    .badge-yellow { background: #2a1e00; color: #e3b341; border: 1px solid #9e6a03; }
    .badge-blue   { background: #0d2044; color: #58a6ff; border: 1px solid #1f6feb; }
    .badge-gray   { background: #161b22; color: #8b949e; border: 1px solid #30363d; }
    .mono { font-family: monospace; font-size: 0.8rem; }
    .dim { color: #8b949e; }
    .log-box { background: #010409; border: 1px solid #30363d; border-radius: 8px; padding: 12px; max-height: 280px; overflow-y: auto; font-family: monospace; font-size: 0.75rem; color: #8b949e; }
    .log-line { line-height: 1.6; border-bottom: 1px solid #0d1117; padding: 1px 0; }
  </style>
  <script>setTimeout(() => location.reload(), 5000)</script>
</head>
<body>
  <h1>
    <span class="dot"></span>
    Gemini Bridge
    <span class="meta">Auto-refresh 5s &nbsp;·&nbsp; Uptime ${formatUptime(startedAt)}</span>
  </h1>

  <div class="grid">
    <div class="stat">
      <div class="stat-label">Gemini</div>
      <div class="stat-value ${gemini.ready ? 'green' : 'red'}">${gemini.ready ? 'Online' : 'Down'}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Active Sessions</div>
      <div class="stat-value">${sessions.length}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Approved Users</div>
      <div class="stat-value">${users.length}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Pending</div>
      <div class="stat-value">${pending.length}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Total Messages</div>
      <div class="stat-value">${sessions.reduce((a, s) => a + s.messageCount, 0)}</div>
    </div>
  </div>

  <section>
    <h2>Active Sessions</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>User ID</th><th>Session</th><th>Msgs</th><th>Last Active</th><th>State</th><th>Role</th></tr></thead>
        <tbody>${sessionRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Approved Users</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>User ID</th><th>Approved</th><th>Role</th><th>Status</th></tr></thead>
        <tbody>${userRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Pending Approvals</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>User ID</th><th>Expires</th></tr></thead>
        <tbody>${pendingRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Recent Logs</h2>
    <div class="log-box">${logLines || '<div class="log-line dim">No logs yet</div>'}</div>
  </section>
</body>
</html>`;
}

export function startDashboard(cfg: DashboardConfig) {
  Bun.serve({
    port: cfg.port,
    fetch(req) {
      const path = new URL(req.url).pathname;

      if (path === '/api/status') {
        const usersCount = cfg.access.getUsers()?.length ?? 0;
        const pendingCount = Object.keys(cfg.access.getPendingList() ?? {}).length;
        return Response.json({
          gemini: cfg.gemini.ready,
          sessions: cfg.userSessions.size,
          users: usersCount,
          pending: pendingCount,
          uptime: Date.now() - cfg.startedAt,
        });
      }

      if (path === '/v1/chat/completions') {
        try {
            const body = await req.json();
            const messages = body.messages || [];
            const lastMsg = messages[messages.length - 1]?.content || "hi";
            
            // For OpenClaw/Local API compatibility, we use a generic internal user
            const sessionId = await cfg.gemini.newSession();
            let accumulated = "";
            
            // We use the streaming logic but return as a single response for simplicity in this bridge layer
            await cfg.gemini.prompt(sessionId, [{ type: 'text', text: lastMsg }], (chunk) => {
                accumulated += chunk;
            });

            return Response.json({
                id: `chatcmpl-${crypto.randomUUID()}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: body.model || "gemini-cli",
                choices: [{
                    index: 0,
                    message: {
                        role: "assistant",
                        content: accumulated
                    },
                    finish_reason: "stop"
                }]
            });
        } catch (e) {
            return Response.json({ error: String(e) }, { status: 500 });
        }
      }

      return new Response(renderHtml(cfg), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    },
  });
  cfg.recentLogs.push(`Dashboard running → http://localhost:${cfg.port}`);
}
