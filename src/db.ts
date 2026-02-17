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

export function createDb(path = process.env.DATABASE_PATH ?? "./prguard.db"): Database.Database {
  const db = new Database(path);
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
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(repo, type, number)
    );

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
  `);
}

export function upsertEmbedding(db: Database.Database, record: EmbeddingRecord): void {
  db.prepare(
    `
      INSERT INTO embeddings (repo, type, number, title, body, diff_summary, embedding)
      VALUES (@repo, @type, @number, @title, @body, @diffSummary, @embedding)
      ON CONFLICT(repo, type, number)
      DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        diff_summary = excluded.diff_summary,
        embedding = excluded.embedding,
        created_at = datetime('now')
    `
  ).run({
    ...record,
    embedding: JSON.stringify(record.embedding)
  });
}

export function listEmbeddings(db: Database.Database, repo: string): EmbeddingRecord[] {
  const rows = db
    .prepare("SELECT repo, type, number, title, body, diff_summary, embedding FROM embeddings WHERE repo = ?")
    .all(repo) as EmbeddingRow[];

  return rows.map((row) => ({
    repo: row.repo,
    type: row.type,
    number: row.number,
    title: row.title,
    body: row.body,
    diffSummary: row.diff_summary,
    embedding: JSON.parse(row.embedding) as number[]
  }));
}

export function upsertAnalysis(db: Database.Database, record: AnalysisRecord): void {
  db.prepare(
    `
      INSERT INTO analyses (
        repo,
        type,
        number,
        duplicates,
        vision_score,
        vision_reasoning,
        recommendation,
        pr_quality_score
      ) VALUES (
        @repo,
        @type,
        @number,
        @duplicates,
        @visionScore,
        @visionReasoning,
        @recommendation,
        @prQualityScore
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
