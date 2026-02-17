import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { handleIssue } from "../../src/handlers/issue.js";
import { resetDb, getDb } from "../../src/db.js";
import { resetMetrics, get } from "../../src/metrics.js";
import type { Probot } from "probot";

// Mock OpenAI
vi.mock("../../src/embed.js", () => ({
  createOpenAIClient: () => ({}),
  buildEmbeddingInput: (title: string, body: string) => `${title}\n${body}`,
  getEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4, 0.5]),
}));

function createMockOctokit() {
  return {
    repos: {
      getContent: vi.fn().mockRejectedValue(new Error("Not found")),
    },
    issues: {
      getLabel: vi.fn().mockResolvedValue({}),
      createLabel: vi.fn().mockResolvedValue({}),
      addLabels: vi.fn().mockResolvedValue({}),
      listComments: vi.fn().mockResolvedValue({ data: [] }),
      createComment: vi.fn().mockResolvedValue({}),
      updateComment: vi.fn().mockResolvedValue({}),
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

function createIssuePayload(overrides: Record<string, any> = {}) {
  return {
    issue: {
      number: 10,
      title: "Login page broken",
      body: "Cannot log in since the last deploy",
      user: { login: "reporter", type: "User" },
      ...overrides,
    },
    repository: { name: "myrepo", owner: { login: "myorg" } },
  };
}

describe("handleIssue", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.DATABASE_PATH = ":memory:";
    resetDb();
    resetMetrics();
  });

  afterEach(() => {
    resetDb();
  });

  it("processes a standard issue end-to-end", async () => {
    const app = createMockApp();
    const octokit = createMockOctokit();
    const payload = createIssuePayload();

    await handleIssue(app, { octokit, payload });

    expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
    const body = octokit.issues.createComment.mock.calls[0][0].body;
    expect(body).toContain("PRGuard Triage Summary");
    expect(body).toContain("Duplicate Check");
    // Issues don't get quality/vision sections
    expect(body).not.toContain("PR Quality");
    expect(body).not.toContain("Vision");

    expect(octokit.issues.addLabels).toHaveBeenCalled();
    expect(get("issues_analyzed_total")).toBe(1);
  });

  it("skips pull_request events disguised as issues", async () => {
    const app = createMockApp();
    const octokit = createMockOctokit();
    const payload = createIssuePayload({ pull_request: {} });

    await handleIssue(app, { octokit, payload });

    expect(octokit.issues.createComment).not.toHaveBeenCalled();
  });

  it("skips bot users", async () => {
    const app = createMockApp();
    const octokit = createMockOctokit();
    const payload = createIssuePayload({ user: { login: "renovate[bot]", type: "Bot" } });

    await handleIssue(app, { octokit, payload });

    expect(octokit.issues.createComment).not.toHaveBeenCalled();
  });

  it("detects duplicates when similar issue exists", async () => {
    const app = createMockApp();
    const octokit = createMockOctokit();

    // Insert an existing embedding that will match
    const db = getDb();
    const { migrate, upsertEmbedding } = await import("../../src/db.js");
    upsertEmbedding(db, {
      repo: "myorg/myrepo",
      type: "issue",
      number: 5,
      title: "Login page broken",
      body: "Cannot log in since the last deploy",
      diffSummary: "",
      embedding: [0.1, 0.2, 0.3, 0.4, 0.5], // Same embedding = perfect match
    });

    const payload = createIssuePayload({ number: 10 });
    await handleIssue(app, { octokit, payload });

    // Should apply duplicate label
    const labelsCall = octokit.issues.addLabels.mock.calls[0][0];
    expect(labelsCall.labels).toContain("prguard:duplicate");
    expect(get("duplicates_found_total")).toBeGreaterThan(0);
  });

  it("degrades gracefully when embedding fails", async () => {
    const { getEmbedding } = await import("../../src/embed.js");
    (getEmbedding as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const app = createMockApp();
    const octokit = createMockOctokit();
    const payload = createIssuePayload();

    await handleIssue(app, { octokit, payload });

    expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
    const body = octokit.issues.createComment.mock.calls[0][0].body;
    expect(body).toContain("temporarily unavailable");
    expect(get("openai_degraded_total")).toBe(1);
  });

  it("stores embedding and analysis in DB", async () => {
    const app = createMockApp();
    const octokit = createMockOctokit();
    const payload = createIssuePayload();

    await handleIssue(app, { octokit, payload });

    const db = getDb();
    const embeddings = db.prepare("SELECT * FROM embeddings WHERE repo = ?").all("myorg/myrepo");
    const analyses = db.prepare("SELECT * FROM analyses WHERE repo = ?").all("myorg/myrepo");
    expect(embeddings.length).toBeGreaterThanOrEqual(1);
    expect(analyses.length).toBeGreaterThanOrEqual(1);
  });
});
