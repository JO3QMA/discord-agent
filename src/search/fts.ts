import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type SearchHit = {
  id: number;
  sessionKey: string;
  role: string;
  body: string;
  createdAt: string;
};

let db: DatabaseSync | null = null;

function dbPath(dataDir: string): string {
  return path.join(dataDir, "sessions.sqlite");
}

export function openSearchDb(dataDir: string): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(dataDir, { recursive: true });
  db = new DatabaseSync(dbPath(dataDir));
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      body,
      content='messages',
      content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.id, old.body);
    END;
  `);
  return db;
}

export function indexMessage(
  dataDir: string,
  sessionKey: string,
  role: "user" | "assistant",
  body: string,
): void {
  const text = body.trim();
  if (!text) return;
  const d = openSearchDb(dataDir);
  d.prepare(
    `INSERT INTO messages (session_key, role, body, created_at) VALUES (?, ?, ?, ?)`,
  ).run(sessionKey, role, text, new Date().toISOString());
}

export function searchMessages(
  dataDir: string,
  query: string,
  opts?: { sessionKey?: string; limit?: number; since?: string; before?: string },
): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const d = openSearchDb(dataDir);
  const limit = Math.min(opts?.limit ?? 10, 50);
  const clauses = ["messages_fts MATCH ?"];
  const params: (string | number)[] = [q];
  if (opts?.sessionKey) {
    clauses.push("m.session_key = ?");
    params.push(opts.sessionKey);
  }
  if (opts?.since) {
    clauses.push("m.created_at >= ?");
    params.push(opts.since);
  }
  if (opts?.before) {
    clauses.push("m.created_at < ?");
    params.push(opts.before);
  }
  params.push(limit);
  const rows = d
    .prepare(
      `SELECT m.id, m.session_key AS sessionKey, m.role, m.body, m.created_at AS createdAt
       FROM messages_fts f
       JOIN messages m ON m.id = f.rowid
       WHERE ${clauses.join(" AND ")}
       ORDER BY m.id DESC
       LIMIT ?`,
    )
    .all(...params) as SearchHit[];
  return rows;
}

export function deleteLastExchange(dataDir: string, sessionKey: string): number {
  // ponytail: delete last user+assistant pair from local FTS only (Cursor transcript can't surgically undo)
  const d = openSearchDb(dataDir);
  const rows = d
    .prepare(
      `SELECT id, role FROM messages WHERE session_key = ? ORDER BY id DESC LIMIT 4`,
    )
    .all(sessionKey) as { id: number; role: string }[];
  let removed = 0;
  for (const row of rows) {
    d.prepare(`DELETE FROM messages WHERE id = ?`).run(row.id);
    removed++;
    if (row.role === "user" && removed >= 2) break;
    if (removed >= 2 && rows[0]?.role === "assistant") break;
  }
  return removed;
}
