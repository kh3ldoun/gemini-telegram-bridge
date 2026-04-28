import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface GeminiConfig {
  cmd: string;
  cwd?: string;
  onLog: (msg: string) => void;
}

interface RpcCallback {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Wraps a Gemini CLI subprocess in ACP (Agent Client Protocol) mode.
 *
 * Events:
 *   'crash'   — process exited unexpectedly, respawn scheduled
 *   'respawn' — process came back and re-initialized successfully
 *   'ready'   — initial init completed
 */
export class GeminiProcess extends EventEmitter {
  private proc: ChildProcess | null = null;
  private rpcId = 1;
  private pending = new Map<number, RpcCallback>();
  private streamCallbacks = new Map<string, (chunk: string) => void>();
  private lineBuffer = '';

  private _ready = false;
  private _intentionalStop = false;
  private _respawnDelay = 3000;

  private readonly cmd: string;
  private readonly cwd: string;
  private readonly log: (msg: string) => void;

  constructor(cfg: GeminiConfig) {
    super();
    this.cmd = cfg.cmd;
    this.cwd = cfg.cwd ?? process.cwd();
    this.log = cfg.onLog;
  }

  get ready() { return this._ready; }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async start() {
    this._intentionalStop = false;
    this.log(`Spawning Gemini: ${this.cmd}`);

    this.proc = spawn(this.cmd, ['--acp', '--skip-trust'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      cwd: this.cwd,
    });

    this.proc.stdout!.on('data', (data: Buffer) => {
      this.lineBuffer += data.toString();
      const lines = this.lineBuffer.split('\n');
      this.lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) this.handleLine(line);
      }
    });

    this.proc.stderr!.on('data', (data: Buffer) => {
      this.log(`[gemini stderr] ${data.toString().trim()}`);
    });

    this.proc.on('exit', (code, signal) => {
      this._ready = false;
      this.proc = null;
      this.log(`Gemini exited (code=${code}, signal=${signal})`);

      // Reject all in-flight RPCs
      for (const cb of this.pending.values()) {
        clearTimeout(cb.timer);
        cb.reject(new Error('Gemini process died'));
      }
      this.pending.clear();
      this.streamCallbacks.clear();

      if (!this._intentionalStop) {
        this.emit('crash');
        this.log(`Respawning in ${this._respawnDelay / 1000}s...`);
        setTimeout(() => {
          this.start()
            .then(() => this.initialize())
            .then(() => this.emit('respawn'))
            .catch((e) => this.log(`Respawn failed: ${e}`));
        }, this._respawnDelay);
      }
    });
  }

  async initialize() {
    await this.rpc('initialize', {
      protocolVersion: 1,
      capabilities: {},
      clientInfo: { name: 'telegram-bridge', version: '2.0.0' },
    }, 15_000);
    this._ready = true;
    this.emit('ready');
    this.log('Gemini initialized and ready');
  }

  stop() {
    this._intentionalStop = true;
    this._ready = false;
    this.proc?.kill();
  }

  // ── Session management ──────────────────────────────────────────────────────

  async newSession(): Promise<string> {
    const res: any = await this.rpc('session/new', {
      cwd: this.cwd,
      mcpServers: [],
    });
    return res.result.sessionId as string;
  }

  // ── Prompting with streaming ────────────────────────────────────────────────

  /**
   * Send a prompt and stream chunks back via onChunk.
   * Resolves when Gemini signals completion.
   */
  async prompt(
    sessionId: string,
    content: PromptContent[],
    onChunk: (chunk: string) => void,
    timeoutMs = 120_000,
  ): Promise<void> {
    this.streamCallbacks.set(sessionId, onChunk);
    try {
      await this.rpc('session/prompt', { sessionId, prompt: content }, timeoutMs);
    } finally {
      this.streamCallbacks.delete(sessionId);
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private handleLine(line: string) {
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }

    // RPC response
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const cb = this.pending.get(msg.id)!;
      clearTimeout(cb.timer);
      this.pending.delete(msg.id);
      if (msg.error) cb.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
      else cb.resolve(msg);
      return;
    }

    // Streaming chunk notification
    if (msg.method === 'session/update') {
      const { sessionId, update } = msg.params ?? {};
      if (update?.sessionUpdate === 'agent_message_chunk') {
        const cb = this.streamCallbacks.get(sessionId);
        if (cb) cb(update.content?.text ?? '');
      }
    }
  }

  private rpc(method: string, params: Record<string, any> = {}, timeoutMs = 30_000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.proc) {
        return reject(new Error('Gemini process is not running'));
      }

      const id = this.rpcId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.proc.stdin!.write(payload);
    });
  }
}

export type PromptContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };
