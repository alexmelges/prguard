import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  migrate,
  upsertEmbedding,
  upsertAnalysis,
  upsertReview,
  getStats,
  getRecentActivity,
  getQualityDistribution,
  getRepoStats,
} from "../src/db.js";
import { renderDashboard } from "../src/dashboard.js";
import type { EmbeddingRecord } from "../src/types.js";

function makeDb() {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

function makeRecord(number: number, overrides: Partial<EmbeddingRecord> = {}): EmbeddingRecord {
  return {
    repo: "org/repo",
    type: "pr",
    number,
    title: `PR #${number}`,
    body: "body",
    diffSummary: "diff",
    embedding: [0.1, 0.2],
    ...overrides,
  };
}

function seedDb(db: Database.Database) {
  // 3 embeddings across 2 repos
  upsertEmbedding(db, makeRecord(1));
  upsertEmbedding(db, makeRecord(2));
  upsertEmbedding(db, makeRecord(3, { repo: "org/other" }));

  // analyses with various quality scores
  upsertAnalysis(db, {
    repo: "org/repo",
    type: "pr",
    number: 1,
    duplicates: [{ type: "pr", number: 2, similarity: 0.95, title: "dup" }],
    visionScore: 0.8,
    visionReasoning: "good",
    recommendation: "approve",
    prQualityScore: 9.0,
  });
  upsertAnalysis(db, {
    repo: "org/repo",
    type: "pr",
    number: 2,
    duplicates: [],
    visionScore: 0.5,
    visionReasoning: "ok",
    recommendation: "review",
    prQualityScore: 5.0,
  });
  upsertAnalysis(db, {
    repo: "org/other",
    type: "issue",
    number: 3,
    duplicates: [],
    visionScore: 0.3,
    visionReasoning: "poor",
    recommendation: "reject",
    prQualityScore: 2.0,
  });

  // reviews
  upsertReview(db, "org/repo", "pr", 1, {
    summary: "Solid PR",
    quality_score: 8.5,
    correctness_concerns: [],
    scope_assessment: "Focused",
    verdict: "approve",
    verdict_reasoning: "LGTM",
  });
  upsertReview(db, "org/other", "issue", 3, {
    summary: "Weak",
    quality_score: 3.0,
    correctness_concerns: ["bugs"],
    scope_assessment: "Broad",
    verdict: "reject",
    verdict_reasoning: "Needs work",
  });
}

describe("getStats", () => {
  it("returns correct counts on empty db", () => {
    const db = makeDb();
    const stats = getStats(db);
    expect(stats.repos).toBe(0);
    expect(stats.embeddings.total).toBe(0);
    expect(stats.embeddings.active).toBe(0);
    expect(stats.analyses).toBe(0);
    expect(stats.reviews).toBe(0);
    expect(stats.duplicates_found).toBe(0);
    expect(stats.avg_quality).toBe(0);
  });

  it("returns correct counts with seeded data", () => {
    const db = makeDb();
    seedDb(db);
    const stats = getStats(db);
    expect(stats.repos).toBe(2);
    expect(stats.embeddings.total).toBe(3);
    expect(stats.embeddings.active).toBe(3);
    expect(stats.analyses).toBe(3);
    expect(stats.reviews).toBe(2);
    expect(stats.duplicates_found).toBe(1);
    // avg of 9.0, 5.0, 2.0
    expect(stats.avg_quality).toBeCloseTo(5.33, 1);
  });
});

describe("getRecentActivity", () => {
  it("returns empty array on empty db", () => {
    const db = makeDb();
    expect(getRecentActivity(db)).toEqual([]);
  });

  it("returns analyses and reviews combined, respects limit", () => {
    const db = makeDb();
    seedDb(db);
    const all = getRecentActivity(db);
    // 3 analyses + 2 reviews = 5
    expect(all).toHaveLength(5);
    expect(all.every(r => r.repo && r.created_at)).toBe(true);

    const limited = getRecentActivity(db, 2);
    expect(limited).toHaveLength(2);
  });

  it("includes source field distinguishing analysis from review", () => {
    const db = makeDb();
    seedDb(db);
    const activity = getRecentActivity(db);
    const sources = new Set(activity.map(r => r.source));
    expect(sources.has("analysis")).toBe(true);
    expect(sources.has("review")).toBe(true);
  });
});

describe("getQualityDistribution", () => {
  it("returns all zeros on empty db", () => {
    const db = makeDb();
    const dist = getQualityDistribution(db);
    expect(dist).toEqual({ excellent: 0, good: 0, needs_work: 0, poor: 0 });
  });

  it("buckets scores correctly", () => {
    const db = makeDb();
    seedDb(db);
    const dist = getQualityDistribution(db);
    // analysis scores: 9.0 (excellent), 5.0 (needs_work), 2.0 (poor)
    // review scores: 8.5 (excellent), 3.0 (poor)
    expect(dist.excellent).toBe(2); // 9.0, 8.5
    expect(dist.good).toBe(0);
    expect(dist.needs_work).toBe(1); // 5.0
    expect(dist.poor).toBe(2); // 2.0, 3.0
  });
});

describe("getRepoStats", () => {
  it("returns empty array on empty db", () => {
    const db = makeDb();
    expect(getRepoStats(db)).toEqual([]);
  });

  it("returns per-repo breakdown", () => {
    const db = makeDb();
    seedDb(db);
    const repos = getRepoStats(db);
    expect(repos).toHaveLength(2);

    const main = repos.find(r => r.repo === "org/repo");
    expect(main).toBeDefined();
    expect(main!.embeddings).toBe(2);
    expect(main!.analyses).toBe(2);
    expect(main!.reviews).toBe(1);
    expect(main!.duplicates).toBe(1);

    const other = repos.find(r => r.repo === "org/other");
    expect(other).toBeDefined();
    expect(other!.embeddings).toBe(1);
    expect(other!.analyses).toBe(1);
    expect(other!.reviews).toBe(1);
    expect(other!.duplicates).toBe(0);
  });
});

describe("renderDashboard", () => {
  it("returns valid HTML with expected elements", () => {
    const db = makeDb();
    seedDb(db);
    const html = renderDashboard(
      getStats(db),
      getRecentActivity(db),
      getQualityDistribution(db),
      getRepoStats(db),
      3661,
    );

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("PRGuard Dashboard");
    expect(html).toContain("Repos Monitored");
    expect(html).toContain("Items Analyzed");
    expect(html).toContain("Duplicates Found");
    expect(html).toContain("Avg Quality Score");
    expect(html).toContain("Recent Activity");
    expect(html).toContain("Quality Distribution");
    expect(html).toContain("Per-Repo Breakdown");
    expect(html).toContain("org/repo");
    expect(html).toContain("org/other");
    // Auto-refresh meta tag
    expect(html).toContain('content="60"');
    // Uptime formatting: 1h 1m
    expect(html).toContain("1h");
    expect(html).toContain("1m");
  });

  it("handles empty data gracefully", () => {
    const html = renderDashboard(
      { repos: 0, embeddings: { total: 0, active: 0 }, analyses: 0, reviews: 0, duplicates_found: 0, avg_quality: 0 },
      [],
      { excellent: 0, good: 0, needs_work: 0, poor: 0 },
      [],
      0,
    );

    expect(html).toContain("No activity yet.");
    expect(html).toContain("No quality data yet.");
    expect(html).toContain("No repos tracked yet.");
    expect(html).toContain("—"); // em-dash for avg quality
  });

  it("escapes HTML in repo names", () => {
    const html = renderDashboard(
      { repos: 1, embeddings: { total: 1, active: 1 }, analyses: 1, reviews: 0, duplicates_found: 0, avg_quality: 5.0 },
      [{
        repo: "<script>alert(1)</script>",
        type: "pr",
        number: 1,
        recommendation: "approve",
        quality_score: 7.0,
        created_at: "2025-01-01T00:00:00",
        source: "analysis",
      }],
      { excellent: 0, good: 1, needs_work: 0, poor: 0 },
      [{ repo: "<script>alert(1)</script>", embeddings: 1, analyses: 1, reviews: 0, duplicates: 0 }],
      0,
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
