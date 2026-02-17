import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  migrate,
  upsertEmbedding,
  listEmbeddings,
  deactivateEmbedding,
  checkRateLimit,
  upsertAnalysis,
  getAnalysis
} from "../src/db.js";
import type { EmbeddingRecord } from "../src/types.js";

function makeDb() {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

function makeRecord(number: number, overrides: Partial<EmbeddingRecord> = {}): EmbeddingRecord {
  return {
    repo: "o/r",
    type: "pr",
    number,
    title: `PR #${number}`,
    body: "body",
    diffSummary: "diff",
    embedding: [0.1, 0.2],
    ...overrides
  };
}

describe("listEmbeddings", () => {
  it("respects limit parameter", () => {
    const db = makeDb();
    for (let i = 1; i <= 10; i++) {
      upsertEmbedding(db, makeRecord(i));
    }
    expect(listEmbeddings(db, "o/r", 5)).toHaveLength(5);
    expect(listEmbeddings(db, "o/r")).toHaveLength(10);
  });

  it("only returns active embeddings", () => {
    const db = makeDb();
    upsertEmbedding(db, makeRecord(1));
    upsertEmbedding(db, makeRecord(2));
    deactivateEmbedding(db, "o/r", "pr", 1);
    expect(listEmbeddings(db, "o/r")).toHaveLength(1);
    expect(listEmbeddings(db, "o/r")[0].number).toBe(2);
  });
});

describe("deactivateEmbedding", () => {
  it("soft deletes an embedding", () => {
    const db = makeDb();
    upsertEmbedding(db, makeRecord(1));
    expect(listEmbeddings(db, "o/r")).toHaveLength(1);
    deactivateEmbedding(db, "o/r", "pr", 1);
    expect(listEmbeddings(db, "o/r")).toHaveLength(0);
  });

  it("re-upsert reactivates", () => {
    const db = makeDb();
    upsertEmbedding(db, makeRecord(1));
    deactivateEmbedding(db, "o/r", "pr", 1);
    upsertEmbedding(db, makeRecord(1));
    expect(listEmbeddings(db, "o/r")).toHaveLength(1);
  });
});

describe("checkRateLimit", () => {
  it("allows calls under budget", () => {
    const db = makeDb();
    expect(checkRateLimit(db, "o/r", 3)).toBe(true);
    expect(checkRateLimit(db, "o/r", 3)).toBe(true);
    expect(checkRateLimit(db, "o/r", 3)).toBe(true);
    expect(checkRateLimit(db, "o/r", 3)).toBe(false);
  });
});

describe("configurable quality thresholds", () => {
  it("stores and retrieves analysis with quality score", () => {
    const db = makeDb();
    upsertAnalysis(db, {
      repo: "o/r",
      type: "pr",
      number: 1,
      duplicates: [],
      visionScore: 0.8,
      visionReasoning: "good",
      recommendation: "approve",
      prQualityScore: 0.9
    });
    const analysis = getAnalysis(db, "o/r", "pr", 1);
    expect(analysis?.prQualityScore).toBe(0.9);
  });
});
