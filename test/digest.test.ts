import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createDb, resetDb, upsertEmbedding, upsertAnalysis, upsertReview, logEvent, getRepoReport, getWeeklyDigestData } from "../src/db.js";
import { generateReport, generateWeeklyDigest } from "../src/digest.js";
import type Database from "better-sqlite3";

describe("getRepoReport", () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.DATABASE_PATH = ":memory:";
    resetDb();
    db = createDb(":memory:");
  });

  afterEach(() => {
    resetDb();
  });

  it("returns zeros for empty repo", () => {
    const r = getRepoReport(db, "org/repo");
    expect(r.totalItems).toBe(0);
    expect(r.activeItems).toBe(0);
    expect(r.duplicateRate).toBe(0);
    expect(r.avgQuality).toBe(0);
  });

  it("counts items correctly", () => {
    upsertEmbedding(db, { repo: "org/repo", type: "pr", number: 1, title: "PR 1", body: "", diffSummary: "", embedding: [0.1] });
    upsertEmbedding(db, { repo: "org/repo", type: "issue", number: 2, title: "Issue 2", body: "", diffSummary: "", embedding: [0.2] });
    upsertEmbedding(db, { repo: "org/repo", type: "pr", number: 3, title: "PR 3", body: "", diffSummary: "", embedding: [0.3] });

    const r = getRepoReport(db, "org/repo");
    expect(r.totalItems).toBe(3);
    expect(r.activeItems).toBe(3);
    expect(r.prs).toBe(2);
    expect(r.issues).toBe(1);
  });

  it("calculates duplicate rate", () => {
    upsertEmbedding(db, { repo: "org/repo", type: "issue", number: 1, title: "Bug A", body: "", diffSummary: "", embedding: [0.1] });
    upsertAnalysis(db, { repo: "org/repo", type: "issue", number: 1, duplicates: [{ number: 2, similarity: 0.9, title: "Bug B", type: "issue" }], visionScore: null, visionReasoning: null, recommendation: "review", prQualityScore: 7 });
    upsertAnalysis(db, { repo: "org/repo", type: "issue", number: 2, duplicates: [], visionScore: null, visionReasoning: null, recommendation: "approve", prQualityScore: 8 });

    const r = getRepoReport(db, "org/repo");
    expect(r.duplicateCount).toBe(1);
    expect(r.duplicateRate).toBe(0.5);
  });

  it("counts verdicts", () => {
    upsertAnalysis(db, { repo: "org/repo", type: "pr", number: 1, duplicates: [], visionScore: null, visionReasoning: null, recommendation: "approve", prQualityScore: 9 });
    upsertAnalysis(db, { repo: "org/repo", type: "pr", number: 2, duplicates: [], visionScore: null, visionReasoning: null, recommendation: "reject", prQualityScore: 2 });
    upsertAnalysis(db, { repo: "org/repo", type: "pr", number: 3, duplicates: [], visionScore: null, visionReasoning: null, recommendation: "approve", prQualityScore: 8 });

    const r = getRepoReport(db, "org/repo");
    expect(r.verdictCounts.approve).toBe(2);
    expect(r.verdictCounts.reject).toBe(1);
    expect(r.verdictCounts.review).toBe(0);
  });
});

describe("getWeeklyDigestData", () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.DATABASE_PATH = ":memory:";
    resetDb();
    db = createDb(":memory:");
  });

  afterEach(() => {
    resetDb();
  });

  it("returns empty data for no activity", () => {
    const d = getWeeklyDigestData(db, "org/repo");
    expect(d.newItems7d).toHaveLength(0);
    expect(d.duplicatesFound7d).toBe(0);
    expect(d.reviewsCompleted7d).toBe(0);
  });

  it("counts new items within 7 days", () => {
    upsertEmbedding(db, { repo: "org/repo", type: "pr", number: 1, title: "New PR", body: "", diffSummary: "", embedding: [0.1] });
    const d = getWeeklyDigestData(db, "org/repo");
    expect(d.newItems7d.length).toBeGreaterThanOrEqual(1);
  });
});

describe("generateReport", () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.DATABASE_PATH = ":memory:";
    resetDb();
    db = createDb(":memory:");
  });

  afterEach(() => {
    resetDb();
  });

  it("produces markdown with correct sections", () => {
    upsertEmbedding(db, { repo: "org/repo", type: "pr", number: 1, title: "PR 1", body: "", diffSummary: "", embedding: [0.1] });
    upsertAnalysis(db, { repo: "org/repo", type: "pr", number: 1, duplicates: [], visionScore: null, visionReasoning: null, recommendation: "approve", prQualityScore: 8 });

    const md = generateReport({ repo: "org/repo", db });
    expect(md).toContain("Repository Health Report");
    expect(md).toContain("Overview");
    expect(md).toContain("Quality Distribution");
    expect(md).toContain("Verdicts");
    expect(md).toContain("PRGuard");
  });

  it("includes duplicate pairs when present", () => {
    upsertEmbedding(db, { repo: "org/repo", type: "issue", number: 1, title: "Bug A", body: "", diffSummary: "", embedding: [0.1] });
    upsertEmbedding(db, { repo: "org/repo", type: "issue", number: 2, title: "Bug B", body: "", diffSummary: "", embedding: [0.2] });
    upsertAnalysis(db, { repo: "org/repo", type: "issue", number: 1, duplicates: [{ number: 2, similarity: 0.92, title: "Bug B", type: "issue" }], visionScore: null, visionReasoning: null, recommendation: "review", prQualityScore: 6 });

    const md = generateReport({ repo: "org/repo", db });
    expect(md).toContain("Duplicate Pairs");
    expect(md).toContain("92.0%");
  });
});

describe("generateWeeklyDigest", () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.DATABASE_PATH = ":memory:";
    resetDb();
    db = createDb(":memory:");
  });

  afterEach(() => {
    resetDb();
  });

  it("produces markdown with correct sections", () => {
    const md = generateWeeklyDigest({ repo: "org/repo", db });
    expect(md).toContain("Weekly Digest");
    expect(md).toContain("This Week's Activity");
    expect(md).toContain("Verdicts This Week");
  });

  it("includes recommendations for low quality", () => {
    // Create items with low quality scores
    upsertAnalysis(db, { repo: "org/repo", type: "pr", number: 1, duplicates: [], visionScore: null, visionReasoning: null, recommendation: "reject", prQualityScore: 2 });
    upsertAnalysis(db, { repo: "org/repo", type: "pr", number: 2, duplicates: [], visionScore: null, visionReasoning: null, recommendation: "reject", prQualityScore: 3 });

    const md = generateWeeklyDigest({ repo: "org/repo", db });
    expect(md).toContain("Recommendations");
  });

  it("includes no-activity recommendation when empty", () => {
    const md = generateWeeklyDigest({ repo: "org/repo", db });
    expect(md).toContain("No new activity");
  });
});
