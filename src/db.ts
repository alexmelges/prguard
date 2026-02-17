import Database from "better-sqlite3";
import type { AnalysisRecord, CodeReview, EmbeddingRecord, ItemType } from "./types.js";

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

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY,
      repo TEXT NOT NULL,
      type TEXT NOT NULL,
      number INTEGER NOT NULL,
      summary TEXT NOT NULL,
      quality_score REAL NOT NULL,
      correctness_concerns TEXT,
      scope_assessment TEXT,
      verdict TEXT NOT NULL,
      verdict_reasoning TEXT,
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

    CREATE TABLE IF NOT EXISTS installation_rate_limits (
      installation_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (installation_id, date)
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

/** Get a single embedding record by repo/type/number. */
export function getEmbeddingRecord(db: Database.Database, repo: string, type: ItemType, number: number): EmbeddingRecord | null {
  const row = db
    .prepare(
      `SELECT repo, type, number, title, body, diff_summary, embedding, active
       FROM embeddings
       WHERE repo = ? AND type = ? AND number = ?`
    )
    .get(repo, type, number) as EmbeddingRow | undefined;

  if (!row) return null;

  return {
    repo: row.repo,
    type: row.type,
    number: row.number,
    title: row.title,
    body: row.body,
    diffSummary: row.diff_summary,
    embedding: JSON.parse(row.embedding) as number[],
    active: row.active === 1
  };
}

/** Delete analysis and review records for a given item. */
export function deleteAnalysisAndReview(db: Database.Database, repo: string, type: ItemType, number: number): void {
  db.prepare("DELETE FROM analyses WHERE repo = ? AND type = ? AND number = ?").run(repo, type, number);
  db.prepare("DELETE FROM reviews WHERE repo = ? AND type = ? AND number = ?").run(repo, type, number);
}

/** Mark an embedding as inactive (soft delete on close/merge). */
export function deactivateEmbedding(db: Database.Database, repo: string, type: ItemType, number: number): void {
  db.prepare(
    "UPDATE embeddings SET active = 0 WHERE repo = ? AND type = ? AND number = ?"
  ).run(repo, type, number);
}

/** Reactivate a previously deactivated embedding (e.g. on PR reopen). */
export function reactivateEmbedding(db: Database.Database, repo: string, type: ItemType, number: number): boolean {
  const result = db.prepare(
    "UPDATE embeddings SET active = 1 WHERE repo = ? AND type = ? AND number = ? AND active = 0"
  ).run(repo, type, number);
  return result.changes > 0;
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

export function upsertReview(db: Database.Database, repo: string, type: ItemType, number: number, review: CodeReview): void {
  db.prepare(
    `INSERT INTO reviews (repo, type, number, summary, quality_score, correctness_concerns, scope_assessment, verdict, verdict_reasoning)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(repo, type, number)
     DO UPDATE SET
       summary = excluded.summary,
       quality_score = excluded.quality_score,
       correctness_concerns = excluded.correctness_concerns,
       scope_assessment = excluded.scope_assessment,
       verdict = excluded.verdict,
       verdict_reasoning = excluded.verdict_reasoning,
       created_at = datetime('now')`
  ).run(repo, type, number, review.summary, review.quality_score, JSON.stringify(review.correctness_concerns), review.scope_assessment, review.verdict, review.verdict_reasoning);
}

export function getReview(db: Database.Database, repo: string, type: ItemType, number: number): CodeReview | null {
  const row = db.prepare(
    "SELECT summary, quality_score, correctness_concerns, scope_assessment, verdict, verdict_reasoning FROM reviews WHERE repo = ? AND type = ? AND number = ?"
  ).get(repo, type, number) as { summary: string; quality_score: number; correctness_concerns: string; scope_assessment: string; verdict: string; verdict_reasoning: string } | undefined;

  if (!row) return null;

  return {
    summary: row.summary,
    quality_score: row.quality_score,
    correctness_concerns: JSON.parse(row.correctness_concerns ?? "[]") as string[],
    scope_assessment: row.scope_assessment,
    verdict: row.verdict as CodeReview["verdict"],
    verdict_reasoning: row.verdict_reasoning
  };
}

// ── Dashboard query types ──────────────────────────────────────────

export interface DashboardStats {
  repos: number;
  embeddings: { total: number; active: number };
  analyses: number;
  reviews: number;
  duplicates_found: number;
  avg_quality: number;
}

export interface RecentActivityRow {
  repo: string;
  type: string;
  number: number;
  recommendation: string | null;
  quality_score: number | null;
  created_at: string;
  source: "analysis" | "review";
}

export interface QualityDistribution {
  excellent: number;
  good: number;
  needs_work: number;
  poor: number;
}

export interface RepoStatsRow {
  repo: string;
  embeddings: number;
  analyses: number;
  reviews: number;
  duplicates: number;
}

// ── Dashboard queries ──────────────────────────────────────────────

export function getStats(db: Database.Database): DashboardStats {
  const repos = (db.prepare("SELECT COUNT(DISTINCT repo) AS c FROM embeddings").get() as { c: number }).c;
  const totalEmbed = (db.prepare("SELECT COUNT(*) AS c FROM embeddings").get() as { c: number }).c;
  const activeEmbed = (db.prepare("SELECT COUNT(*) AS c FROM embeddings WHERE active = 1").get() as { c: number }).c;
  const analyses = (db.prepare("SELECT COUNT(*) AS c FROM analyses").get() as { c: number }).c;
  const reviews = (db.prepare("SELECT COUNT(*) AS c FROM reviews").get() as { c: number }).c;
  const dupsRow = db.prepare(
    "SELECT COUNT(*) AS c FROM analyses WHERE duplicates IS NOT NULL AND duplicates != '[]'"
  ).get() as { c: number };
  const avgRow = db.prepare(
    "SELECT AVG(pr_quality_score) AS avg FROM analyses WHERE pr_quality_score IS NOT NULL"
  ).get() as { avg: number | null };

  return {
    repos,
    embeddings: { total: totalEmbed, active: activeEmbed },
    analyses,
    reviews,
    duplicates_found: dupsRow.c,
    avg_quality: avgRow.avg ?? 0,
  };
}

export function getRecentActivity(db: Database.Database, limit = 20): RecentActivityRow[] {
  const rows = db.prepare(`
    SELECT repo, type, number, recommendation, pr_quality_score AS quality_score, created_at, 'analysis' AS source
    FROM analyses
    UNION ALL
    SELECT repo, type, number, verdict AS recommendation, quality_score, created_at, 'review' AS source
    FROM reviews
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as RecentActivityRow[];
  return rows;
}

export function getQualityDistribution(db: Database.Database): QualityDistribution {
  const rows = db.prepare(`
    SELECT
      SUM(CASE WHEN score >= 8 THEN 1 ELSE 0 END) AS excellent,
      SUM(CASE WHEN score >= 6 AND score < 8 THEN 1 ELSE 0 END) AS good,
      SUM(CASE WHEN score >= 4 AND score < 6 THEN 1 ELSE 0 END) AS needs_work,
      SUM(CASE WHEN score < 4 THEN 1 ELSE 0 END) AS poor
    FROM (
      SELECT pr_quality_score AS score FROM analyses WHERE pr_quality_score IS NOT NULL
      UNION ALL
      SELECT quality_score AS score FROM reviews
    )
  `).get() as { excellent: number | null; good: number | null; needs_work: number | null; poor: number | null };

  return {
    excellent: rows.excellent ?? 0,
    good: rows.good ?? 0,
    needs_work: rows.needs_work ?? 0,
    poor: rows.poor ?? 0,
  };
}

export function getRepoStats(db: Database.Database): RepoStatsRow[] {
  return db.prepare(`
    SELECT
      e.repo,
      COALESCE(e.cnt, 0) AS embeddings,
      COALESCE(a.cnt, 0) AS analyses,
      COALESCE(r.cnt, 0) AS reviews,
      COALESCE(d.cnt, 0) AS duplicates
    FROM (SELECT repo, COUNT(*) AS cnt FROM embeddings GROUP BY repo) e
    LEFT JOIN (SELECT repo, COUNT(*) AS cnt FROM analyses GROUP BY repo) a ON e.repo = a.repo
    LEFT JOIN (SELECT repo, COUNT(*) AS cnt FROM reviews GROUP BY repo) r ON e.repo = r.repo
    LEFT JOIN (
      SELECT repo, COUNT(*) AS cnt FROM analyses
      WHERE duplicates IS NOT NULL AND duplicates != '[]'
      GROUP BY repo
    ) d ON e.repo = d.repo
    ORDER BY embeddings DESC
  `).all() as RepoStatsRow[];
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
