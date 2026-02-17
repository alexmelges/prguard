import Database from "better-sqlite3";
import type { AnalysisRecord, EmbeddingRecord, ItemType } from "./types.js";

interface EmbeddingRow {
  repo: string;
  type: ItemType;
  number: number;
  title: string;
  body: string;
  diff_summary: string;
  embedding: string;
  active: number;
}

interface AnalysisRow {
  repo: string;
  type: ItemType;
  number: number;
  duplicates: string | null;
  vision_score: number | null;
  vision_reasoning: string | null;
  recommendation: "approve" | "review" | "reject" | null;
  pr_quality_score: number | null;
}

let _db: Database.Database | null = null;

/** Lazy singleton database. Call getDb() instead of using a global. */
export function getDb(path?: string): Database.Database {
  if (!_db) {
    _db = createDb(path);
  }
  return _db;
}

/** Reset the singleton (for testing). */
export function resetDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function createDb(path = process.env.DATABASE_PATH ?? "./prguard.db"): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS embeddings (
      id INTEGER PRIMARY KEY,
      repo TEXT NOT NULL,
      type TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      diff_summary TEXT,
      embedding TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(repo, type, number)
    );

    CREATE INDEX IF NOT EXISTS idx_embeddings_repo_active ON embeddings(repo, active);

    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY,
      repo TEXT NOT NULL,
      type TEXT NOT NULL,
      number INTEGER NOT NULL,
      duplicates TEXT,
      vision_score REAL,
      vision_reasoning TEXT,
      recommendation TEXT,
      pr_quality_score REAL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(repo, type, number)
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      id INTEGER PRIMARY KEY,
      repo TEXT NOT NULL,
      hour TEXT NOT NULL,
      openai_calls INTEGER NOT NULL DEFAULT 0,
      UNIQUE(repo, hour)
    );
  `);

  // Migration: add active column if missing
  try {
    db.prepare("SELECT active FROM embeddings LIMIT 1").get();
  } catch {
    db.exec("ALTER TABLE embeddings ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
    db.exec("CREATE INDEX IF NOT EXISTS idx_embeddings_repo_active ON embeddings(repo, active)");
  }
}

export function upsertEmbedding(db: Database.Database, record: EmbeddingRecord): void {
  db.prepare(
    `
      INSERT INTO embeddings (repo, type, number, title, body, diff_summary, embedding, active)
      VALUES (@repo, @type, @number, @title, @body, @diffSummary, @embedding, 1)
      ON CONFLICT(repo, type, number)
      DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        diff_summary = excluded.diff_summary,
        embedding = excluded.embedding,
        active = 1,
        created_at = datetime('now')
    `
  ).run({
    ...record,
    embedding: JSON.stringify(record.embedding)
  });
}

/** List active embeddings for a repo, limited to the most recent N (default 500). */
export function listEmbeddings(db: Database.Database, repo: string, limit = 500): EmbeddingRecord[] {
  const rows = db
    .prepare(
      `SELECT repo, type, number, title, body, diff_summary, embedding, active
       FROM embeddings
       WHERE repo = ? AND active = 1
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(repo, limit) as EmbeddingRow[];

  return rows.map((row) => ({
    repo: row.repo,
    type: row.type,
    number: row.number,
    title: row.title,
    body: row.body,
    diffSummary: row.diff_summary,
    embedding: JSON.parse(row.embedding) as number[],
    active: row.active === 1
  }));
}

/** Mark an embedding as inactive (soft delete on close/merge). */
export function deactivateEmbedding(db: Database.Database, repo: string, type: ItemType, number: number): void {
  db.prepare(
    "UPDATE embeddings SET active = 0 WHERE repo = ? AND type = ? AND number = ?"
  ).run(repo, type, number);
}

export function upsertAnalysis(db: Database.Database, record: AnalysisRecord): void {
  db.prepare(
    `
      INSERT INTO analyses (
        repo, type, number, duplicates,
        vision_score, vision_reasoning,
        recommendation, pr_quality_score
      ) VALUES (
        @repo, @type, @number, @duplicates,
        @visionScore, @visionReasoning,
        @recommendation, @prQualityScore
      )
      ON CONFLICT(repo, type, number)
      DO UPDATE SET
        duplicates = excluded.duplicates,
        vision_score = excluded.vision_score,
        vision_reasoning = excluded.vision_reasoning,
        recommendation = excluded.recommendation,
        pr_quality_score = excluded.pr_quality_score,
        created_at = datetime('now')
    `
  ).run({
    ...record,
    duplicates: JSON.stringify(record.duplicates)
  });
}

export function getAnalysis(
  db: Database.Database,
  repo: string,
  type: ItemType,
  number: number
): AnalysisRecord | null {
  const row = db
    .prepare(
      "SELECT repo, type, number, duplicates, vision_score, vision_reasoning, recommendation, pr_quality_score FROM analyses WHERE repo = ? AND type = ? AND number = ?"
    )
    .get(repo, type, number) as AnalysisRow | undefined;

  if (!row) {
    return null;
  }

  return {
    repo: row.repo,
    type: row.type,
    number: row.number,
    duplicates: row.duplicates ? (JSON.parse(row.duplicates) as AnalysisRecord["duplicates"]) : [],
    visionScore: row.vision_score,
    visionReasoning: row.vision_reasoning,
    recommendation: row.recommendation,
    prQualityScore: row.pr_quality_score
  };
}

/** Check and increment rate limit counter atomically. Returns true if under budget. */
export function checkRateLimit(db: Database.Database, repo: string, maxPerHour: number): boolean {
  const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH

  // Atomic: insert-or-increment, then check if we're over budget
  db.prepare(
    `INSERT INTO rate_limits (repo, hour, openai_calls)
     VALUES (?, ?, 1)
     ON CONFLICT(repo, hour)
     DO UPDATE SET openai_calls = openai_calls + 1`
  ).run(repo, hour);

  const row = db.prepare(
    "SELECT openai_calls FROM rate_limits WHERE repo = ? AND hour = ?"
  ).get(repo, hour) as { openai_calls: number };

  return row.openai_calls <= maxPerHour;
}
