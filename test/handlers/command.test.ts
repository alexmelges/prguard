import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { handleCommand, parseCommand } from "../../src/handlers/command.js";
import { resetDb, getDb, upsertEmbedding } from "../../src/db.js";
import { resetMetrics } from "../../src/metrics.js";
import type { Probot } from "probot";

// Mock the PR and issue handlers so /prguard review doesn't run the full pipeline
vi.mock("../../src/handlers/pr.js", () => ({
  handlePR: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/handlers/issue.js", () => ({
  handleIssue: vi.fn().mockResolvedValue(undefined),
}));

function createMockOctokit() {
  return {
    repos: {
      getContent: vi.fn().mockRejectedValue(new Error("Not found")),
      getCollaboratorPermissionLevel: vi.fn().mockResolvedValue({
        data: { permission: "write" },
      }),
    },
    issues: {
      getLabel: vi.fn().mockResolvedValue({}),
      createLabel: vi.fn().mockResolvedValue({}),
      addLabels: vi.fn().mockResolvedValue({}),
      removeLabel: vi.fn().mockResolvedValue({}),
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

function createCommentPayload(
  commentBody: string,
  overrides: Record<string, any> = {}
) {
  return {
    comment: {
      body: commentBody,
      user: { login: "maintainer" },
    },
    issue: {
      number: 42,
      title: "Fix parser bug",
      body: "This PR fixes a critical parser bug",
      user: { login: "contributor", type: "User", created_at: "2024-01-01T00:00:00Z" },
      ...overrides,
    },
    repository: { name: "myrepo", owner: { login: "myorg" } },
  };
}

describe("parseCommand", () => {
  it("parses /prguard help", () => {
    expect(parseCommand("/prguard help")).toEqual({ kind: "help" });
  });

  it("parses /prguard review", () => {
    expect(parseCommand("/prguard review")).toEqual({ kind: "review" });
  });

  it("parses /prguard config", () => {
    expect(parseCommand("/prguard config")).toEqual({ kind: "config" });
  });

  it("parses /prguard ignore", () => {
    expect(parseCommand("/prguard ignore")).toEqual({ kind: "ignore" });
  });

  it("parses /prguard compare #123", () => {
    expect(parseCommand("/prguard compare #123")).toEqual({ kind: "compare", targetNumber: 123 });
  });

  it("parses /prguard compare 123 (without #)", () => {
    expect(parseCommand("/prguard compare 123")).toEqual({ kind: "compare", targetNumber: 123 });
  });

  it("returns null for non-prguard comments", () => {
    expect(parseCommand("This is a regular comment")).toBeNull();
  });

  it("returns null for unknown subcommand", () => {
    expect(parseCommand("/prguard foobar")).toBeNull();
  });

  it("returns null for /prguard compare without a number", () => {
    expect(parseCommand("/prguard compare")).toBeNull();
  });

  it("parses command embedded in multi-line comment", () => {
    const body = "Some context here\n\n/prguard review\n\nMore text";
    expect(parseCommand(body)).toEqual({ kind: "review" });
  });

  it("is case-insensitive for subcommand", () => {
    expect(parseCommand("/prguard HELP")).toEqual({ kind: "help" });
    expect(parseCommand("/prguard Review")).toEqual({ kind: "review" });
  });
});

describe("handleCommand", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.DATABASE_PATH = ":memory:";
    resetDb();
    resetMetrics();
  });

  afterEach(() => {
    resetDb();
  });

  it("ignores comments without /prguard", async () => {
    const app = createMockApp();
    const octokit = createMockOctokit();
    const payload = createCommentPayload("Just a regular comment");

    await handleCommand(app, { octokit, payload });

    expect(octokit.issues.createComment).not.toHaveBeenCalled();
  });

  it("denies access to users without write permission", async () => {
    const app = createMockApp();
    const octokit = createMockOctokit();
    octokit.repos.getCollaboratorPermissionLevel.mockResolvedValue({
      data: { permission: "read" },
    });
    const payload = createCommentPayload("/prguard help");

    await handleCommand(app, { octokit, payload });

    expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
    const body = octokit.issues.createComment.mock.calls[0][0].body;
    expect(body).toContain("only users with **write** or **admin** access");
  });

  it("allows admin users", async () => {
    const app = createMockApp();
    const octokit = createMockOctokit();
    octokit.repos.getCollaboratorPermissionLevel.mockResolvedValue({
      data: { permission: "admin" },
    });
    const payload = createCommentPayload("/prguard help");

    await handleCommand(app, { octokit, payload });

    const body = octokit.issues.createComment.mock.calls[0][0].body;
    expect(body).toContain("PRGuard Commands");
  });

  describe("/prguard help", () => {
    it("posts help message", async () => {
      const app = createMockApp();
      const octokit = createMockOctokit();
      const payload = createCommentPayload("/prguard help");

      await handleCommand(app, { octokit, payload });

      expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
      const body = octokit.issues.createComment.mock.calls[0][0].body;
      expect(body).toContain("PRGuard Commands");
      expect(body).toContain("/prguard review");
      expect(body).toContain("/prguard compare");
      expect(body).toContain("/prguard config");
      expect(body).toContain("/prguard ignore");
      expect(body).toContain("/prguard help");
    });
  });

  describe("/prguard config", () => {
    it("posts current configuration", async () => {
      const app = createMockApp();
      const octokit = createMockOctokit();
      const payload = createCommentPayload("/prguard config");

      await handleCommand(app, { octokit, payload });

      expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
      const body = octokit.issues.createComment.mock.calls[0][0].body;
      expect(body).toContain("PRGuard Configuration");
      expect(body).toContain("duplicate_threshold: 0.85");
      expect(body).toContain("deep_review: true");
      expect(body).toContain("daily_limit: 50");
    });

    it("shows custom config from repo", async () => {
      const app = createMockApp();
      const octokit = createMockOctokit();
      octokit.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from("duplicate_threshold: 0.9\ndaily_limit: 100").toString("base64"),
          encoding: "base64",
        },
      });
      const payload = createCommentPayload("/prguard config");

      await handleCommand(app, { octokit, payload });

      const body = octokit.issues.createComment.mock.calls[0][0].body;
      expect(body).toContain("duplicate_threshold: 0.9");
      expect(body).toContain("daily_limit: 100");
    });
  });

  describe("/prguard ignore", () => {
    it("deactivates embedding and removes labels", async () => {
      const app = createMockApp();
      const octokit = createMockOctokit();
      const payload = createCommentPayload("/prguard ignore", { pull_request: {} });

      // Seed an embedding
      const db = getDb();
      upsertEmbedding(db, {
        repo: "myorg/myrepo",
        type: "pr",
        number: 42,
        title: "Fix parser bug",
        body: "test",
        diffSummary: "",
        embedding: [0.1, 0.2, 0.3],
      });

      await handleCommand(app, { octokit, payload });

      // Should have removed labels
      expect(octokit.issues.removeLabel).toHaveBeenCalled();

      // Should have deactivated embedding
      const row = db.prepare("SELECT active FROM embeddings WHERE repo = ? AND type = ? AND number = ?").get("myorg/myrepo", "pr", 42) as { active: number };
      expect(row.active).toBe(0);

      // Should post confirmation comment
      const body = octokit.issues.createComment.mock.calls[0][0].body;
      expect(body).toContain("Ignored");
      expect(body).toContain("pull request");
    });

    it("cleans up analysis and review records", async () => {
      const app = createMockApp();
      const octokit = createMockOctokit();
      const payload = createCommentPayload("/prguard ignore");

      const db = getDb();
      // Seed analysis
      db.prepare(
        "INSERT INTO analyses (repo, type, number, duplicates, recommendation) VALUES (?, ?, ?, ?, ?)"
      ).run("myorg/myrepo", "issue", 42, "[]", "review");

      await handleCommand(app, { octokit, payload });

      const row = db.prepare("SELECT * FROM analyses WHERE repo = ? AND type = ? AND number = ?").get("myorg/myrepo", "issue", 42);
      expect(row).toBeUndefined();
    });
  });

  describe("/prguard review", () => {
    it("delegates to handlePR for pull requests", async () => {
      const app = createMockApp();
      const octokit = createMockOctokit();
      const payload = createCommentPayload("/prguard review", { pull_request: {} });

      await handleCommand(app, { octokit, payload });

      const { handlePR } = await import("../../src/handlers/pr.js");
      expect(handlePR).toHaveBeenCalled();
    });

    it("delegates to handleIssue for issues", async () => {
      const app = createMockApp();
      const octokit = createMockOctokit();
      const payload = createCommentPayload("/prguard review");

      await handleCommand(app, { octokit, payload });

      const { handleIssue } = await import("../../src/handlers/issue.js");
      expect(handleIssue).toHaveBeenCalled();
    });
  });

  describe("/prguard compare", () => {
    it("shows similarity between two items", async () => {
      const app = createMockApp();
      const octokit = createMockOctokit();
      const payload = createCommentPayload("/prguard compare #10", { pull_request: {} });

      const db = getDb();
      // Current item
      upsertEmbedding(db, {
        repo: "myorg/myrepo",
        type: "pr",
        number: 42,
        title: "Fix parser bug",
        body: "test",
        diffSummary: "",
        embedding: [1, 0, 0],
      });
      // Target item
      upsertEmbedding(db, {
        repo: "myorg/myrepo",
        type: "pr",
        number: 10,
        title: "Fix parser issue",
        body: "similar",
        diffSummary: "",
        embedding: [0.9, 0.1, 0],
      });

      await handleCommand(app, { octokit, payload });

      expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
      const body = octokit.issues.createComment.mock.calls[0][0].body;
      expect(body).toContain("Comparison");
      expect(body).toContain("#42");
      expect(body).toContain("#10");
      expect(body).toContain("Similarity");
    });

    it("reports error when current item has no embedding", async () => {
      const app = createMockApp();
      const octokit = createMockOctokit();
      const payload = createCommentPayload("/prguard compare #10", { pull_request: {} });

      await handleCommand(app, { octokit, payload });

      const body = octokit.issues.createComment.mock.calls[0][0].body;
      expect(body).toContain("No embedding found");
      expect(body).toContain("#42");
    });

    it("reports error when target item has no embedding", async () => {
      const app = createMockApp();
      const octokit = createMockOctokit();
      const payload = createCommentPayload("/prguard compare #99", { pull_request: {} });

      const db = getDb();
      upsertEmbedding(db, {
        repo: "myorg/myrepo",
        type: "pr",
        number: 42,
        title: "Fix parser bug",
        body: "test",
        diffSummary: "",
        embedding: [1, 0, 0],
      });

      await handleCommand(app, { octokit, payload });

      const body = octokit.issues.createComment.mock.calls[0][0].body;
      expect(body).toContain("No embedding found for #99");
    });

    it("finds target as issue when not found as PR", async () => {
      const app = createMockApp();
      const octokit = createMockOctokit();
      const payload = createCommentPayload("/prguard compare #10", { pull_request: {} });

      const db = getDb();
      upsertEmbedding(db, {
        repo: "myorg/myrepo",
        type: "pr",
        number: 42,
        title: "Fix parser bug",
        body: "test",
        diffSummary: "",
        embedding: [1, 0, 0],
      });
      // Target is an issue, not a PR
      upsertEmbedding(db, {
        repo: "myorg/myrepo",
        type: "issue",
        number: 10,
        title: "Parser is broken",
        body: "desc",
        diffSummary: "",
        embedding: [0.9, 0.1, 0],
      });

      await handleCommand(app, { octokit, payload });

      const body = octokit.issues.createComment.mock.calls[0][0].body;
      expect(body).toContain("Comparison");
      expect(body).toContain("issue");
    });
  });
});
