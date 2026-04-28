import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { AccessStore, AccessEntry, PendingEntry } from './types';

export const STATE_DIR = join(homedir(), '.gemini', 'channels', 'telegram');
export const APPROVED_DIR = join(STATE_DIR, 'approved');
const ACCESS_FILE = join(STATE_DIR, 'access.json');

export class AccessManager {
  private store: AccessStore;

  constructor() {
    mkdirSync(STATE_DIR, { recursive: true });
    mkdirSync(APPROVED_DIR, { recursive: true });
    this.store = this.load();
  }

  private load(): AccessStore {
    if (existsSync(ACCESS_FILE)) {
      try {
        const data = JSON.parse(readFileSync(ACCESS_FILE, 'utf8'));
        return {
          users: data.users || {},
          pending: data.pending || {}
        };
      } catch {}
    }
    return { users: {}, pending: {} };
  }

  private save() {
    writeFileSync(ACCESS_FILE, JSON.stringify(this.store, null, 2));
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  isAllowed(userId: string): boolean {
    return userId in this.store.users;
  }

  isAdmin(userId: string): boolean {
    return this.store.users[userId]?.isAdmin ?? false;
  }

  getUser(userId: string): AccessEntry | null {
    return this.store.users[userId] ?? null;
  }

  getUsers(): AccessEntry[] {
    return Object.values(this.store.users);
  }

  getPendingList(): Record<string, PendingEntry> {
    const now = Date.now();
    for (const code of Object.keys(this.store.pending)) {
      if (this.store.pending[code]!.expiresAt < now) {
        delete this.store.pending[code];
      }
    }
    return this.store.pending;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  addPending(code: string, entry: PendingEntry) {
    this.store.pending[code] = entry;
    this.save();
  }

  /**
   * Approve a pairing code. Returns the pending entry on success, null if
   * code is unknown or expired.
   */
  approve(code: string): PendingEntry | null {
    const p = this.store.pending[code];
    if (!p) return null;
    if (p.expiresAt < Date.now()) {
      delete this.store.pending[code];
      this.save();
      return null;
    }

    const isFirstUser = Object.keys(this.store.users).length === 0;
    this.store.users[p.userId] = {
      userId: p.userId,
      username: p.username,
      firstName: p.firstName,
      approvedAt: Date.now(),
      isAdmin: isFirstUser, // first approved user becomes admin
    };
    delete this.store.pending[code];
    this.save();
    return p;
  }

  /**
   * Revoke a user. Returns true if removed, false if not found.
   */
  revoke(userId: string): boolean {
    if (!(userId in this.store.users)) return false;
    delete this.store.users[userId];
    this.save();
    return true;
  }

  /**
   * Promote a user to admin.
   */
  promote(userId: string): boolean {
    const u = this.store.users[userId];
    if (!u) return false;
    u.isAdmin = true;
    this.save();
    return true;
  }
}
