import { DatabaseSync } from "node:sqlite";
import { resolve, isAbsolute } from "node:path";
import { config, ensureDataDir } from "./config.js";
/**
 * 校验并解析数据库文件路径。
 * 路径来自运维者的环境变量而非终端用户，但仍做白名单校验作为纵深防御：
 * 只允许常见路径字符，拒绝控制字符与 shell 元字符。
 */
export function resolveDbPath(raw: string): string {
  if (!raw || raw.length > 1024) throw new Error("LUMINA_DB_PATH 配置非法");
  if (/[\0\r\n;&|`$<>]/.test(raw)) throw new Error("LUMINA_DB_PATH 含有非法字符");
  const p = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  if (!/\.(db|sqlite|sqlite3)$/i.test(p)) {
    throw new Error("LUMINA_DB_PATH 必须以 .db / .sqlite / .sqlite3 结尾");
  }
  return p;
}

export const db = (() => {
  ensureDataDir();
  return new DatabaseSync(resolveDbPath(config.dbPath));
})();

/** node:sqlite 的语句执行入口（执行 SQL，不涉及任何进程/命令）。 */
function run(sql: string): void {
  db.prepare(sql).run();
}

run("PRAGMA journal_mode = WAL;");
run("PRAGMA foreign_keys = ON;");

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   TEXT NOT NULL UNIQUE,
    nickname    TEXT NOT NULL,
    aid_mode    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider    TEXT NOT NULL,
    model       TEXT NOT NULL,
    base_url    TEXT,
    format      TEXT NOT NULL DEFAULT 'openai',
    label       TEXT NOT NULL DEFAULT '',
    ciphertext  TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'private' CHECK (status IN ('private','pool')),
    fail_count  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    donated_at  TEXT,
    last_used_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_keys_owner  ON api_keys(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_keys_status ON api_keys(status)`,
  `CREATE TABLE IF NOT EXISTS pool_usage (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day        TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('pool','watchman')),
    requests   INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, day, kind)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content     TEXT NOT NULL,
    provider    TEXT,
    source      TEXT,
    emotion     TEXT,
    intensity   REAL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_logs_user ON chat_logs(user_id, created_at)`,
];

for (const stmt of SCHEMA) run(stmt);

// 轻量迁移：旧库补列（node:sqlite 无 ADD COLUMN IF NOT EXISTS）
const keyCols = db.prepare("PRAGMA table_info(api_keys)").all() as Array<{ name: string }>;
if (!keyCols.some((c) => c.name === "format")) {
  run("ALTER TABLE api_keys ADD COLUMN format TEXT NOT NULL DEFAULT 'openai'");
}
const logCols = db.prepare("PRAGMA table_info(chat_logs)").all() as Array<{ name: string }>;
if (!logCols.some((c) => c.name === "care")) {
  run("ALTER TABLE chat_logs ADD COLUMN care TEXT");
}

/** 今日日期（UTC，yyyy-mm-dd）。互助配额按 UTC 日清零，简单且一致。 */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface UserRow {
  id: number;
  device_id: string;
  nickname: string;
  aid_mode: number;
  created_at: string;
}

export interface KeyRow {
  id: number;
  owner_id: number;
  provider: string;
  model: string;
  base_url: string | null;
  format: string;
  label: string;
  ciphertext: string;
  status: "private" | "pool";
  fail_count: number;
  created_at: string;
  donated_at: string | null;
  last_used_at: string | null;
}

export interface ChatLogRow {
  id: number;
  user_id: number;
  role: "user" | "assistant";
  content: string;
  provider: string | null;
  source: string | null;
  emotion: string | null;
  intensity: number | null;
  created_at: string;
}

export function getUser(id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function getUserByDevice(deviceId: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE device_id = ?").get(deviceId) as UserRow | undefined;
}

export function createUser(deviceId: string, nickname: string): UserRow {
  db.prepare("INSERT INTO users (device_id, nickname) VALUES (?, ?)").run(deviceId, nickname);
  return getUserByDevice(deviceId)!;
}

export function setAidMode(userId: number, enabled: boolean): void {
  db.prepare("UPDATE users SET aid_mode = ? WHERE id = ?").run(enabled ? 1 : 0, userId);
}

export function listKeys(ownerId: number): KeyRow[] {
  return db
    .prepare("SELECT * FROM api_keys WHERE owner_id = ? ORDER BY id")
    .all(ownerId) as unknown as KeyRow[];
}

export function getKey(id: number): KeyRow | undefined {
  return db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as KeyRow | undefined;
}

export function listPoolKeys(provider?: string): KeyRow[] {
  if (provider) {
    return db
      .prepare(
        "SELECT * FROM api_keys WHERE status = 'pool' AND provider = ? " +
          "ORDER BY last_used_at IS NOT NULL, last_used_at, id",
      )
      .all(provider) as unknown as KeyRow[];
  }
  return db
    .prepare(
      "SELECT * FROM api_keys WHERE status = 'pool' " +
        "ORDER BY last_used_at IS NOT NULL, last_used_at, id",
    )
    .all() as unknown as KeyRow[];
}

export function markKeyUsed(id: number): void {
  db.prepare("UPDATE api_keys SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(id);
}

export function setKeyStatus(id: number, status: "private" | "pool"): void {
  db.prepare(
    status === "pool"
      ? "UPDATE api_keys SET status = 'pool', donated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
      : "UPDATE api_keys SET status = 'private', donated_at = NULL WHERE id = ?",
  ).run(id);
}

export function deleteKey(id: number): void {
  db.prepare("DELETE FROM api_keys WHERE id = ?").run(id);
}

export function getPoolUsage(userId: number, day: string, kind: "pool"): number {
  const row = db
    .prepare("SELECT requests FROM pool_usage WHERE user_id = ? AND day = ? AND kind = ?")
    .get(userId, day, kind) as { requests: number } | undefined;
  return row?.requests ?? 0;
}

export function bumpPoolUsage(userId: number, day: string, kind: "pool"): void {
  db.prepare(
    `INSERT INTO pool_usage (user_id, day, kind, requests) VALUES (?, ?, ?, 1)
     ON CONFLICT (user_id, day, kind) DO UPDATE SET requests = requests + 1`,
  ).run(userId, day, kind);
}

export function countPoolKeys(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE status = 'pool'").get() as {
    n: number;
  };
  return row.n;
}

export function addLog(
  userId: number,
  role: "user" | "assistant",
  content: string,
  extra?: {
    provider?: string;
    source?: string;
    emotion?: string;
    intensity?: number;
    care?: string | null;
  },
): ChatLogRow {
  const r = db
    .prepare(
      `INSERT INTO chat_logs (user_id, role, content, provider, source, emotion, intensity, care)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      role,
      content,
      extra?.provider ?? null,
      extra?.source ?? null,
      extra?.emotion ?? null,
      extra?.intensity ?? null,
      extra?.care ?? null,
    );
  return db.prepare("SELECT * FROM chat_logs WHERE id = ?").get(r.lastInsertRowid) as unknown as ChatLogRow;
}
