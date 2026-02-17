import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { handlePR } from "../../src/handlers/pr.js";
import { resetDb, getDb } from "../../src/db.js";
import { resetMetrics, get } from "../../src/metrics.js";
import type { Probot } from "probot";

// Mock OpenAI
vi.mock("../../src/embed.js", () => ({
  createOpenAIClient: () => ({}),
  buildEmbeddingInput: (title: string, body: string, diff = "") => `${title}\n${body}\n${diff}`,
  getEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4, 0.5]),
  withRetry: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../../src/review.js", () => ({
  reviewPR: vi.fn().mockResolvedValue({
    summary: "This PR adds a feature",
    quality_score: 7,
    correctness_concerns: [],
    scope_assessment: "Focused",
    verdict: "approve",
    verdict_reasoning: "Looks good",
  }),
  buildCrossComparison: vi.fn().mockReturnValue(""),
}));

vi.mock("../../src/vision.js", () => ({
  evaluateVision: vi.fn().mockResolvedValue({
    score: 0.85,
    aligned: true,
    reasoning: "Looks good",
    recommendation: "approve",
  }),
}));

vi.mock("../../src/github.js", () => ({
  withGitHubRetry: vi.fn().mockResolvedValue({ data: { total_count: 3 } }),
}));

function createMockOctokit() {
  return {
    repos: {
      getContent: vi.fn().mockRejectedValue(new Error("Not found")),
    },
    pulls: {
      listCommits: vi.fn().mockResolvedValue({
        data: [{ commit: { message: "fix: resolve parser bug" } }],
      }),
      listFiles: vi.fn().mockResolvedValue({
        data: [
          { filename: "src/parser.ts", patch: "+fixed", additions: 10, deletions: 5 },
          { filename: "test/parser.test.ts", patch: "+test", additions: 20, deletions: 0 },
        ],
      }),
    },
    checks: {
      listForRef: vi.fn().mockResolvedValue({
        data: { check_runs: [{ conclusion: "success" }] },
      }),
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
      issuesAndPullRequests: vi.fn().mockResolvedValue({ data: { total_count: 3 } }),
    },
  };
}

function createMockApp(): Probot {
  return {
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as unknown as Probot;
}

function createPRPayload(overrides: Record<string, any> = {}) {
  return {
    pull_request: {
      number: 42,
      title: "Fix parser bug",
      body: "This PR fixes a critical parser bug",
      user: { login: "contributor", type: "User", created_at: "2024-01-01T00:00:00Z" },
      additions: 15,
      deletions: 5,
      changed_files: 2,
      commits: 1,
      merged: false,
      head: { sha: "abc123" },
      ...overrides,
    },
    repository: { name: "myrepo", owner: { login: "myorg" } },
  };
}

describe("handlePR", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    resetDb();
    resetMetrics();
  });

  afterEach(() => {
    resetDb();
  });

  it("processes a standard PR end-to-end", async () => {
    const app = createMockApp();
    const octokit = createMockOctokit();
    const payload = createPRPayload();

    await handlePR(app, { octokit, payload });

    // Should have posted a comment
    expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
    const commentBody = octokit.issues.createComment.mock.calls[0][0].body;
    expect(commentBody).toContain("PRGuard Triage Summary");
    expect(commentBody).toContain("PR Quality");

    // Should have applied labels
    expect(octokit.issues.addLabels).toHaveBeenCalled();

    // Metrics should be incremented
    expect(get("prs_analyzed_total")).toBe(1);
    expect(get("openai_calls_total")).toBeGreaterThan(0);
  });

  it("skips bot users", async () => {
    const app = createMockApp();
    const octokit = createMockOctokit();
    const payload = createPRPayload({ user: { login: "dependabot[bot]", type: "Bot", created_at: "2024-01-01T00:00:00Z" } });

    await handlePR(app, { octokit, payload });

    expect(octokit.issues.createComment).not.toHaveBeenCalled();
    expect(get("prs_analyzed_total")).toBe(0);
  });

  it("skips trusted users from config", async () => {
    const app = createMockApp();
    const octokit = createMockOctokit();
    // Return a config with trusted_users
    octokit.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from("trusted_users:\n  - contributor").toString("base64"),
        encoding: "base64",
      },
    });
    const payload = createPRPayload();

    await handlePR(app, { octokit, payload });

    expect(octokit.issues.createComment).not.toHaveBeenCalled();
  });

  it("stores embedding in DB", async () => {
    const app = createMockApp();
    const octokit = createMockOctokit();
    const payload = createPRPayload();

    await handlePR(app, { octokit, payload });

    const db = getDb();
    const rows = db.prepare("SELECT * FROM embeddings WHERE repo = ?").all("myorg/myrepo");
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("stores analysis in DB", async () => {
    const app = createMockApp();
    const octokit = createMockOctokit();
    const payload = createPRPayload();

    await handlePR(app, { octokit, payload });

    const db = getDb();
    const rows = db.prepare("SELECT * FROM analyses WHERE repo = ?").all("myorg/myrepo");
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("updates existing comment on re-edit", async () => {
    const app = createMockApp();
    const octokit = createMockOctokit();
    const payload = createPRPayload();

    // First call — creates comment
    await handlePR(app, { octokit, payload });
    expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);

    // Simulate existing comment on second call
    octokit.issues.listComments.mockResolvedValue({
      data: [{ id: 999, body: "<!-- prguard:summary -->\nold comment" }],
    });

    await handlePR(app, { octokit, payload });
    expect(octokit.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 999 })
    );
  });

  it("degrades gracefully when embedding fails", async () => {
    const { getEmbedding } = await import("../../src/embed.js");
    (getEmbedding as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const app = createMockApp();
    const octokit = createMockOctokit();
    const payload = createPRPayload();

    await handlePR(app, { octokit, payload });

    // Should still post a degraded comment
    expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
    const commentBody = octokit.issues.createComment.mock.calls[0][0].body;
    expect(commentBody).toContain("temporarily unavailable");
    expect(get("openai_degraded_total")).toBe(1);
    expect(get("prs_analyzed_total")).toBe(1);
  });
});
