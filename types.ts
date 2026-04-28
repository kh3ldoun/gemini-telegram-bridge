export interface HistoryEntry {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export interface UserSession {
  sessionId: string;
  userId: string;
  username?: string;
  firstName?: string;
  lastActivity: number;
  messageCount: number;
  history: HistoryEntry[];
  busy: boolean;
}

export interface AccessEntry {
  userId: string;
  username?: string;
  firstName?: string;
  approvedAt: number;
  isAdmin: boolean;
}

export interface PendingEntry {
  userId: string;
  chatId: string;
  username?: string;
  firstName?: string;
  expiresAt: number;
}

export interface AccessStore {
  users: Record<string, AccessEntry>;
  pending: Record<string, PendingEntry>;
}
