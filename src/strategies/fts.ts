import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizePrefix } from "../prefix.ts";
import type { Ctx, Doc, Hit, SearchOpts, Strategy } from "../types.ts";

const DB_FILE = "fts.db";
// Bump when the schema, tokenizer, column weights or reader output change, so existing indexes rebuild.
const INDEX_VERSION = "1";
const META_SCHEMA = "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);";
const SCHEMA = `
CREATE TABLE IF NOT EXISTS note_hash (path TEXT PRIMARY KEY, hash TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS notes USING fts5(
  path UNINDEXED, title, description, tags, headings, body,
  tokenize = 'porter unicode61'
);
`;
// Column order: path (unindexed), title, description, tags, headings, body.
const BM25 = "bm25(notes, 0, 10, 8, 4, 3, 1)";

export function toMatchExpression(query: string): string {
  const words = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.map((word) => `"${word}"`).join(" OR ");
}

function dbPath(ctx: Ctx): string {
  return path.join(ctx.indexDir, DB_FILE);
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(META_SCHEMA);
  const row = db.prepare("SELECT value FROM meta WHERE key = 'index_version'").get();
  if (row === undefined || String(row["value"]) !== INDEX_VERSION) {
    db.exec("DROP TABLE IF EXISTS notes; DROP TABLE IF EXISTS note_hash;");
  }
  db.exec(SCHEMA);
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('index_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(INDEX_VERSION);
}

function storedHashes(db: DatabaseSync): Map<string, string> {
  const rows = db.prepare("SELECT path, hash FROM note_hash").all();
  return new Map(rows.map((row): [string, string] => [String(row["path"]), String(row["hash"])]));
}

function applyChanges(db: DatabaseSync, docs: Doc[]): void {
  const stored = storedHashes(db);
  const current = new Set(docs.map((doc) => doc.path));
  const deleteNote = db.prepare("DELETE FROM notes WHERE path = ?");
  const deleteHash = db.prepare("DELETE FROM note_hash WHERE path = ?");
  const insertNote = db.prepare(
    "INSERT INTO notes (path, title, description, tags, headings, body) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const upsertHash = db.prepare(
    "INSERT INTO note_hash (path, hash) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET hash = excluded.hash",
  );
  for (const doc of docs) {
    if (stored.get(doc.path) === doc.hash) continue;
    deleteNote.run(doc.path);
    insertNote.run(doc.path, doc.title, doc.description, doc.tags.join(" "), doc.headings.join("\n"), doc.body);
    upsertHash.run(doc.path, doc.hash);
  }
  for (const storedPath of stored.keys()) {
    if (current.has(storedPath)) continue;
    deleteNote.run(storedPath);
    deleteHash.run(storedPath);
  }
}

async function build(docs: Doc[], ctx: Ctx): Promise<void> {
  mkdirSync(ctx.indexDir, { recursive: true });
  const db = new DatabaseSync(dbPath(ctx));
  try {
    db.exec("BEGIN");
    try {
      ensureSchema(db);
      applyChanges(db, docs);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

async function search(query: string, opts: SearchOpts, ctx: Ctx): Promise<Hit[]> {
  const match = toMatchExpression(query);
  if (match === "") return [];
  const file = dbPath(ctx);
  if (!existsSync(file)) throw new Error("FTS index not found, run `build` first");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const prefix = normalizePrefix(opts.pathPrefix);
    const rows = db
      .prepare(
        `SELECT path, title, description, -${BM25} AS score
         FROM notes
         WHERE notes MATCH ? AND substr(path, 1, length(?)) = ?
         ORDER BY score DESC
         LIMIT ?`,
      )
      .all(match, prefix, prefix, opts.limit);
    return rows.map((row) => ({
      path: String(row["path"]),
      title: String(row["title"]),
      description: String(row["description"]),
      score: Number(row["score"]),
    }));
  } finally {
    db.close();
  }
}

export function ftsStrategy(): Strategy {
  return { name: "fts", build, search };
}
