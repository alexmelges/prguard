import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate, checkRateLimit, upsertEmbedding, listEmbeddings } from "../src/db.js";
import { buildEmbeddingInput } from "../src/embed.js";
import { isBot, normalizeBody } from "../src/util.js";
import { parseConfig, defaultConfig } from "../src/config.js";
import { scorePRQuality } from "../src/quality.js";
import { buildSummaryComment } from "../src/comment.js";

describe("edge cases", () => {
  describe("empty PR body", () => {
    it("normalizeBody handles null", () => {
      expect(normalizeBody(null)).toBe("");
    });

    it("normalizeBody handles empty string", () => {
      expect(normalizeBody("")).toBe("");
    });

    it("normalizeBody handles undefined", () => {
      expect(normalizeBody(undefined)).toBe("");
    });

    it("buildEmbeddingInput works with title only", () => {
      const input = buildEmbeddingInput("Fix crash on login", "");
      expect(input).toBe("Fix crash on login");
    });

    it("buildEmbeddingInput works with title only and empty diff", () => {
      const input = buildEmbeddingInput("Fix crash", "", "");
      expect(input).toBe("Fix crash");
    });
  });

  describe("PR with 0 files changed", () => {
    it("quality score handles zero additions/deletions", () => {
      const result = scorePRQuality({
        additions: 0,
        deletions: 0,
        changedFiles: 0,
        hasTests: false,
        commitMessages: ["initial commit"],
        contributorMergedPRs: 0,
        contributorAccountAgeDays: 30,
        ciPassing: true
      });
      // Should still produce a valid score
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.recommendation).toBeDefined();
    });
  });

  describe("no config file (defaults)", () => {
    it("defaultConfig has all required fields", () => {
      expect(defaultConfig.duplicate_threshold).toBe(0.85);
      expect(defaultConfig.skip_bots).toBe(true);
      expect(defaultConfig.dry_run).toBe(false);
      expect(defaultConfig.labels.duplicate).toBe("prguard:duplicate");
      expect(defaultConfig.trusted_users).toEqual([]);
      expect(defaultConfig.max_diff_lines).toBe(10000);
    });

    it("parseConfig with empty YAML returns defaults", () => {
      const config = parseConfig("");
      expect(config).toEqual(defaultConfig);
    });
  });

  describe("bot detection", () => {
    it("detects [bot] suffix", () => {
      expect(isBot("dependabot[bot]")).toBe(true);
    });

    it("detects dependabot", () => {
      expect(isBot("dependabot")).toBe(true);
    });

    it("detects renovate", () => {
      expect(isBot("renovate")).toBe(true);
    });

    it("detects Bot user type", () => {
      expect(isBot("some-app", "Bot")).toBe(true);
    });

    it("does not flag normal users", () => {
      expect(isBot("steipete")).toBe(false);
      expect(isBot("steipete", "User")).toBe(false);
    });
  });

  describe("rate limiter", () => {
    it("allows up to maxPerHour calls", () => {
      const db = new Database(":memory:");
      migrate(db);
      for (let i = 0; i < 3; i++) {
        expect(checkRateLimit(db, "o/r", 3)).toBe(true);
      }
      // 4th call should be rejected
      expect(checkRateLimit(db, "o/r", 3)).toBe(false);
    });

    it("different repos have separate limits", () => {
      const db = new Database(":memory:");
      migrate(db);
      for (let i = 0; i < 2; i++) {
        checkRateLimit(db, "o/r1", 2);
      }
      // r1 is maxed
      expect(checkRateLimit(db, "o/r1", 2)).toBe(false);
      // r2 should still work
      expect(checkRateLimit(db, "o/r2", 2)).toBe(true);
    });
  });

  describe("concurrent embeddings", () => {
    it("upsert is idempotent — same PR twice doesn't duplicate", () => {
      const db = new Database(":memory:");
      migrate(db);
      const record = {
        repo: "o/r", type: "pr" as const, number: 1,
        title: "Test", body: "body", diffSummary: "diff",
        embedding: [0.1, 0.2, 0.3]
      };
      upsertEmbedding(db, record);
      upsertEmbedding(db, record);
      expect(listEmbeddings(db, "o/r")).toHaveLength(1);
    });
  });

  describe("comment for issues (no quality/vision)", () => {
    it("renders cleanly with only duplicates section", () => {
      const comment = buildSummaryComment({
        duplicates: [],
        vision: null,
        quality: null,
        bestPRNumber: null,
      review: null,
      crossComparison: null
      });
      expect(comment).toContain("PRGuard Triage Summary");
      expect(comment).toContain("No close duplicates found");
      expect(comment).not.toContain("PR Quality");
      expect(comment).not.toContain("Vision Alignment");
    });
  });
});
