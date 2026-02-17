import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { parseConfig, defaultConfig } from "../src/config.js";
import { createOpenAIClient } from "../src/embed.js";
import { handlePR } from "../src/handlers/pr.js";
import { handleIssue } from "../src/handlers/issue.js";
import { resetDb, getDb, createDb } from "../src/db.js";
import { resetMetrics } from "../src/metrics.js";
import { incrementInstallationRateLimit } from "../src/rate-limit.js";
import type { Probot } from "probot";

// Mock OpenAI
vi.mock("../src/embed.js", () => ({
  createOpenAIClient: vi.fn().mockReturnValue({}),
  buildEmbeddingInput: (title: string, body: string, diff = "") => `${title}\n${body}\n${diff}`,
  getEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4, 0.5]),
  withRetry: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../src/review.js", () => ({
  reviewPR: vi.fn().mockResolvedValue({
    summary: "Test",
    quality_score: 7,
    correctness_concerns: [],
    scope_assessment: "OK",
    verdict: "approve",
    verdict_reasoning: "Good",
  }),
  buildCrossComparison: vi.fn().mockReturnValue(""),
}));

vi.mock("../src/vision.js", () => ({
  evaluateVision: vi.fn().mockResolvedValue({
    score: 0.85,
    aligned: true,
    reasoning: "Looks good",
    recommendation: "approve",
  }),
}));

vi.mock("../src/github.js", () => ({
  withGitHubRetry: vi.fn().mockResolvedValue({ data: { total_count: 3 } }),
}));

function createMockOctokit(configYaml?: string) {
  return {
    repos: {
      getContent: configYaml
        ? vi.fn().mockResolvedValue({
            data: {
              content: Buffer.from(configYaml).toString("base64"),
              encoding: "base64",
            },
          })
        : vi.fn().mockRejectedValue(new Error("Not found")),
    },
    pulls: {
      listCommits: vi.fn().mockResolvedValue({ data: [{ commit: { message: "fix: stuff" } }] }),
      listFiles: vi.fn().mockResolvedValue({
        data: [{ filename: "src/a.ts", patch: "+x", additions: 5, deletions: 2 }],
      }),
    },
    checks: {
      listForRef: vi.fn().mockResolvedValue({ data: { check_runs: [{ conclusion: "success" }] } }),
    },
    issues: {
      getLabel: vi.fn().mockResolvedValue({}),
      createLabel: vi.fn().mockResolvedValue({}),
      addLabels: vi.fn().mockResolvedValue({}),
      listComments: vi.fn().mockResolvedValue({ data: [] }),
      createComment: vi.fn().mockResolvedValue({}),
      updateComment: vi.fn().mockResolvedValue({}),
    },
    search: {
      issuesAndPullRequests: vi.fn().mockResolvedValue({ data: { total_count: 0 } }),
    },
  };
}

function createMockApp(): Probot {
  return {
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  } as unknown as Probot;
}

describe("config parsing with new fields", () => {
  it("includes daily_limit default", () => {
    expect(defaultConfig.daily_limit).toBe(50);
  });

  it("includes openai_api_key default", () => {
    expect(defaultConfig.openai_api_key).toBe("");
  });

  it("parses daily_limit from yaml", () => {
    const config = parseConfig("daily_limit: 100");
    expect(config.daily_limit).toBe(100);
  });

  it("parses openai_api_key from yaml", () => {
    const config = parseConfig("openai_api_key: sk-custom-key");
    expect(config.openai_api_key).toBe("sk-custom-key");
  });

  it("uses defaults when fields not present", () => {
    const config = parseConfig("vision: test");
    expect(config.daily_limit).toBe(50);
    expect(config.openai_api_key).toBe("");
  });
});

describe("BYOK client creation", () => {
  beforeEach(() => {
    resetDb();
    resetMetrics();
    process.env.OPENAI_API_KEY = "sk-server-default";
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENAI_API_KEY;
  });

  it("uses custom key when openai_api_key is configured", async () => {
    const { createOpenAIClient: mockCreate } = await import("../src/embed.js");
    const octokit = createMockOctokit("openai_api_key: sk-custom-key-123");
    const app = createMockApp();

    await handlePR(app, {
      octokit,
      payload: {
        pull_request: {
          number: 1,
          title: "Test PR",
          body: "body",
          user: { login: "user1", created_at: "2020-01-01T00:00:00Z" },
          additions: 10,
          deletions: 5,
          changed_files: 1,
          commits: 1,
          merged: false,
          head: { sha: "abc123" },
        },
        repository: { name: "repo", owner: { login: "owner" } },
        installation: { id: 999 },
      },
    });

    expect(mockCreate).toHaveBeenCalledWith("sk-custom-key-123");
  });

  it("uses server default when openai_api_key is empty", async () => {
    const { createOpenAIClient: mockCreate } = await import("../src/embed.js");
    const octokit = createMockOctokit(); // no config file = defaults
    const app = createMockApp();

    await handlePR(app, {
      octokit,
      payload: {
        pull_request: {
          number: 2,
          title: "Test PR 2",
          body: "body",
          user: { login: "user1", created_at: "2020-01-01T00:00:00Z" },
          additions: 10,
          deletions: 5,
          changed_files: 1,
          commits: 1,
          merged: false,
          head: { sha: "def456" },
        },
        repository: { name: "repo", owner: { login: "owner" } },
        installation: { id: 999 },
      },
    });

    // Should call without custom key (uses default)
    expect(mockCreate).toHaveBeenCalledWith();
  });
});

describe("rate limit exceeded behavior", () => {
  beforeEach(() => {
    resetDb();
    resetMetrics();
    process.env.OPENAI_API_KEY = "sk-test";
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENAI_API_KEY;
  });

  it("posts rate limit comment and skips PR analysis", async () => {
    const db = getDb(":memory:");
    // Fill up the limit
    for (let i = 0; i < 50; i++) {
      incrementInstallationRateLimit(db, 777);
    }

    const octokit = createMockOctokit();
    const app = createMockApp();

    await handlePR(app, {
      octokit,
      payload: {
        pull_request: {
          number: 10,
          title: "Should be skipped",
          body: "body",
          user: { login: "user1", created_at: "2020-01-01T00:00:00Z" },
          additions: 5,
          deletions: 2,
          changed_files: 1,
          commits: 1,
          merged: false,
          head: { sha: "aaa" },
        },
        repository: { name: "repo", owner: { login: "owner" } },
        installation: { id: 777 },
      },
    });

    // Should have posted a rate limit comment
    expect(octokit.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("daily analysis limit reached"),
      })
    );
  });

  it("posts rate limit comment and skips issue analysis", async () => {
    const db = getDb(":memory:");
    for (let i = 0; i < 50; i++) {
      incrementInstallationRateLimit(db, 888);
    }

    const octokit = createMockOctokit();
    const app = createMockApp();

    await handleIssue(app, {
      octokit,
      payload: {
        issue: {
          number: 20,
          title: "Should be skipped",
          body: "body",
          user: { login: "user1" },
        },
        repository: { name: "repo", owner: { login: "owner" } },
        installation: { id: 888 },
      },
    });

    expect(octokit.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("daily analysis limit reached"),
      })
    );
  });
});
