import { describe, it, expect } from "vitest";
import { lintReadiness, formatReadinessSuggestions } from "../src/readiness.js";
import type { ReadinessInput } from "../src/readiness.js";

function makeInput(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    changedFiles: [],
    repoRootFiles: [],
    diffText: "",
    ...overrides,
  };
}

describe("lintReadiness", () => {
  // -----------------------------------------------------------------------
  // machine-readable-policy
  // -----------------------------------------------------------------------
  describe("readiness/machine-readable-policy", () => {
    it("flags when API files change and no policy exists", () => {
      const suggestions = lintReadiness(
        makeInput({ changedFiles: ["src/routes/users.ts"] })
      );
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].rule).toBe("readiness/machine-readable-policy");
      expect(suggestions[0].severity).toBe("suggestion");
    });

    it("does not flag when openapi.yaml exists in repo root", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["src/routes/users.ts"],
          repoRootFiles: ["openapi.yaml", "README.md"],
        })
      );
      const policy = suggestions.find(
        (s) => s.rule === "readiness/machine-readable-policy"
      );
      expect(policy).toBeUndefined();
    });

    it("does not flag when PR itself adds a policy file", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["src/api/handler.ts", "SECURITY.md"],
        })
      );
      const policy = suggestions.find(
        (s) => s.rule === "readiness/machine-readable-policy"
      );
      expect(policy).toBeUndefined();
    });

    it("does not flag when no API files are touched", () => {
      const suggestions = lintReadiness(
        makeInput({ changedFiles: ["src/utils/math.ts", "README.md"] })
      );
      expect(suggestions).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // deterministic-error-schema
  // -----------------------------------------------------------------------
  describe("readiness/deterministic-error-schema", () => {
    it("flags when API handler sends error status without structured body", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["src/handlers/auth.ts"],
          diffText: 'res.status(401).send("Unauthorized")',
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/deterministic-error-schema"
      );
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe("suggestion");
    });

    it("does not flag when error has structured JSON shape", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["src/controllers/orders.ts"],
          diffText:
            'res.status(400).json({ "error": { "code": "INVALID", "message": "bad input" } })',
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/deterministic-error-schema"
      );
      expect(rule).toBeUndefined();
    });

    it("does not flag when no API files are touched", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["lib/utils.ts"],
          diffText: 'res.status(500).send("fail")',
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/deterministic-error-schema"
      );
      expect(rule).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // replay-test-signal
  // -----------------------------------------------------------------------
  describe("readiness/replay-test-signal", () => {
    it("flags when automation code changes without tests", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["src/webhooks/github.ts"],
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/replay-test-signal"
      );
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe("suggestion");
    });

    it("does not flag when test files are also changed", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: [
            "src/webhooks/github.ts",
            "test/webhooks/github.test.ts",
          ],
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/replay-test-signal"
      );
      expect(rule).toBeUndefined();
    });

    it("does not flag for non-automation files", () => {
      const suggestions = lintReadiness(
        makeInput({ changedFiles: ["src/models/user.ts"] })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/replay-test-signal"
      );
      expect(rule).toBeUndefined();
    });

    it("recognizes .github/workflows as automation", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: [".github/workflows/ci.yml"],
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/replay-test-signal"
      );
      expect(rule).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Multiple rules
  // -----------------------------------------------------------------------
  it("can fire multiple rules at once", () => {
    const suggestions = lintReadiness(
      makeInput({
        changedFiles: [
          "src/routes/webhook.ts",
        ],
        diffText: 'res.status(500).send("boom")',
      })
    );
    // Should fire: policy, error-schema, replay-test (webhook in routes)
    expect(suggestions.length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty array for benign PRs", () => {
    const suggestions = lintReadiness(
      makeInput({
        changedFiles: ["docs/guide.md", "README.md"],
        repoRootFiles: ["README.md"],
        diffText: "just docs",
      })
    );
    expect(suggestions).toHaveLength(0);
  });
});

describe("formatReadinessSuggestions", () => {
  it("returns empty string for no suggestions", () => {
    expect(formatReadinessSuggestions([])).toBe("");
  });

  it("formats suggestions as markdown", () => {
    const result = formatReadinessSuggestions([
      {
        rule: "readiness/test-rule",
        message: "Test message",
        severity: "suggestion",
      },
    ]);
    expect(result).toContain("Agent-Readiness Suggestions");
    expect(result).toContain("`readiness/test-rule`");
    expect(result).toContain("non-blocking");
  });
});
