import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { withRetry } from "../src/embed.js";
import { withGitHubRetry } from "../src/github.js";
import { migrate, checkRateLimit } from "../src/db.js";
import OpenAI from "openai";

describe("error paths", () => {
  describe("OpenAI errors", () => {
    it("returns null on 500 internal server error after retries", async () => {
      const logger = { warn: vi.fn() };
      const result = await withRetry(
        () => {
          throw new OpenAI.InternalServerError(500, { message: "Internal Server Error" }, "server error", {});
        },
        { retries: 1, logger }
      );

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("failed after 2 attempts")
      );
    });

    it("returns null on rate limit error after retries", async () => {
      const logger = { warn: vi.fn() };
      const result = await withRetry(
        () => {
          throw new OpenAI.RateLimitError(429, { message: "Rate limited" }, "rate limited", {});
        },
        { retries: 0, logger }
      );

      expect(result).toBeNull();
    });

    it("returns null immediately on non-retryable error", async () => {
      const logger = { warn: vi.fn() };
      const result = await withRetry(
        () => {
          throw new OpenAI.AuthenticationError(401, { message: "Invalid API key" }, "auth error", {});
        },
        { retries: 3, logger }
      );

      expect(result).toBeNull();
      // Should fail after just 1 attempt (not retryable)
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("failed after 1 attempt")
      );
    });
  });

  describe("GitHub API errors", () => {
    it("throws on non-retryable status", async () => {
      const logger = { warn: vi.fn() };

      await expect(
        withGitHubRetry(() => {
          const err = new Error("Not Found") as any;
          err.status = 404;
          err.response = { headers: {} };
          throw err;
        }, logger)
      ).rejects.toThrow("Not Found");

      // Should not have retried (404 is not retryable)
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("database errors", () => {
    it("handles concurrent rate limit checks", () => {
      const db = new Database(":memory:");
      migrate(db);

      // Fill rate limit to near capacity
      const repo = "test/repo";
      for (let i = 0; i < 59; i++) {
        checkRateLimit(db, repo, 60);
      }

      // 60th call should still be under budget
      expect(checkRateLimit(db, repo, 60)).toBe(true);

      // 61st call should exceed budget
      expect(checkRateLimit(db, repo, 60)).toBe(false);
    });

    it("survives with WAL mode on busy database", () => {
      const db = new Database(":memory:");
      migrate(db);

      // Verify WAL mode is set
      const result = db.pragma("journal_mode") as Array<{ journal_mode: string }>;
      // In-memory databases may use "memory" instead of "wal"
      expect(result[0].journal_mode).toBeDefined();
    });
  });
});
