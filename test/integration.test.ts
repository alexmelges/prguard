import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { buildSummaryComment } from "../src/comment.js";
import { migrate, upsertAnalysis, upsertEmbedding, listEmbeddings, getAnalysis, deactivateEmbedding, reactivateEmbedding } from "../src/db.js";
import type { AnalysisRecord, EmbeddingRecord } from "../src/types.js";

describe("integration", () => {
  it("stores embedding and analysis and renders comment", () => {
    const db = new Database(":memory:");
    migrate(db);

    const embedding: EmbeddingRecord = {
      repo: "o/r",
      type: "pr",
      number: 5,
      title: "Fix thing",
      body: "body",
      diffSummary: "diff",
      embedding: [0.1, 0.2]
    };

    upsertEmbedding(db, embedding);
    expect(listEmbeddings(db, "o/r")).toHaveLength(1);

    const analysis: AnalysisRecord = {
      repo: "o/r",
      type: "pr",
      number: 5,
      duplicates: [{ type: "pr", number: 4, similarity: 0.91, title: "Fix thing too" }],
      visionScore: 0.8,
      visionReasoning: "Aligned",
      recommendation: "approve",
      prQualityScore: 0.82
    };

    upsertAnalysis(db, analysis);
    const stored = getAnalysis(db, "o/r", "pr", 5);
    expect(stored?.duplicates).toHaveLength(1);

    const comment = buildSummaryComment({
      duplicates: stored?.duplicates ?? [],
      vision: { score: 0.8, aligned: true, reasoning: "Aligned", recommendation: "approve" },
      quality: { score: 0.82, recommendation: "approve", reasons: [] },
      bestPRNumber: 5,
      review: null,
      crossComparison: null
    });

    expect(comment).toContain("PRGuard Triage Summary");
    expect(comment).toContain("strongest implementation");
  });

  it("deactivates and reactivates embeddings on close/reopen", () => {
    const db = new Database(":memory:");
    migrate(db);

    const embedding: EmbeddingRecord = {
      repo: "o/r",
      type: "issue",
      number: 10,
      title: "Bug report",
      body: "Something is broken",
      diffSummary: "",
      embedding: [0.3, 0.4]
    };

    upsertEmbedding(db, embedding);
    expect(listEmbeddings(db, "o/r")).toHaveLength(1);

    // Close — deactivate
    deactivateEmbedding(db, "o/r", "issue", 10);
    expect(listEmbeddings(db, "o/r")).toHaveLength(0);

    // Reopen — reactivate
    const reactivated = reactivateEmbedding(db, "o/r", "issue", 10);
    expect(reactivated).toBe(true);
    expect(listEmbeddings(db, "o/r")).toHaveLength(1);

    // Reactivating a non-existent embedding returns false
    const noOp = reactivateEmbedding(db, "o/r", "issue", 999);
    expect(noOp).toBe(false);
  });
});
