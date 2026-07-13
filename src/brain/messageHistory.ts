import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { join } from "path";
import { brainboxRoot } from "@/config/loader";

export type MessageSender = "persona" | "user";

export interface MessageHistoryEntry {
  sender: MessageSender;
  time: Date;
  content: string;
}

let db: Database | null = null;

function getDb(): Database {
  if (db) return db;
  mkdirSync(brainboxRoot, { recursive: true });
  db = new Database(join(brainboxRoot, "message-history.sqlite"));
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brain_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      time INTEGER NOT NULL,
      content TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_brain_time
      ON messages(brain_id, time);
  `);
  return db;
}

export function appendMessageHistory(
  brainId: string,
  entry: MessageHistoryEntry,
): void {
  getDb()
    .prepare(
      `INSERT INTO messages (brain_id, sender, time, content)
       VALUES (?, ?, ?, ?)`,
    )
    .run(brainId, entry.sender, entry.time.getTime(), entry.content);
}

/** Fetch channel history in [start, end] (inclusive), oldest first. */
export function getMessageHistory(
  brainId: string,
  start: Date,
  end: Date,
): MessageHistoryEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT sender, time, content FROM messages
       WHERE brain_id = ? AND time >= ? AND time <= ?
       ORDER BY time ASC, id ASC`,
    )
    .all(brainId, start.getTime(), end.getTime()) as Array<{
    sender: MessageSender;
    time: number;
    content: string;
  }>;
  return rows.map((row) => ({
    sender: row.sender,
    time: new Date(row.time),
    content: row.content,
  }));
}

function formatTime(time: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(
    time.getDate(),
  )} ${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
}

export function translateMessageHistory(
  personaName: string,
  entries: ReadonlyArray<MessageHistoryEntry>,
  userLabel = "User",
): string {
  return entries
    .map((entry) => {
      const label = entry.sender === "persona" ? personaName : userLabel;
      return `${label}@${formatTime(entry.time)}: ${entry.content}`;
    })
    .join("\n");
}
