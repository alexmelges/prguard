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

  // -----------------------------------------------------------------------
  // docs-vs-code-drift
  // -----------------------------------------------------------------------
  describe("readiness/docs-vs-code-drift", () => {
    it("flags ${env:VAR} in docs when impl uses plain ${VAR}", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["docs/config.md"],
          diffText: [
            "+++ b/docs/config.md",
            "+Use `${env:DATABASE_URL}` to inject secrets.",
          ].join("\n"),
          fileContents: {
            "src/config.ts": 'const dbUrl = process.env.DATABASE_URL || "${DATABASE_URL}";',
          },
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/docs-vs-code-drift"
      );
      expect(rule).toBeDefined();
      expect(rule!.message).toContain("${env:VAR}");
      expect(rule!.severity).toBe("suggestion");
    });

    it("does not flag ${env:VAR} when impl actually supports it", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["docs/config.md"],
          diffText: [
            "+++ b/docs/config.md",
            "+Use `${env:DATABASE_URL}` to inject secrets.",
          ].join("\n"),
          fileContents: {
            "src/config.ts": 'function parseEnvSubstitution(val) { /* handles ${env:...} */ }',
          },
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/docs-vs-code-drift"
      );
      expect(rule).toBeUndefined();
    });

    it("flags op:// in docs when no resolver exists", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["README.md"],
          diffText: [
            "+++ b/README.md",
            "+Secrets can be loaded from `op://vault/item/field`.",
          ].join("\n"),
          fileContents: {
            "src/secrets.ts": "export function resolveSecrets() { return {}; }",
          },
        })
      );
      const rule = suggestions.find(
        (s) =>
          s.rule === "readiness/docs-vs-code-drift" &&
          s.message.includes("op://")
      );
      expect(rule).toBeDefined();
    });

    it("does not flag op:// when resolver exists in impl", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["README.md"],
          diffText: [
            "+++ b/README.md",
            "+Secrets can be loaded from `op://vault/item/field`.",
          ].join("\n"),
          fileContents: {
            "src/secrets.ts": "export class OnePasswordProvider { resolve() {} }",
          },
        })
      );
      const rule = suggestions.find(
        (s) =>
          s.rule === "readiness/docs-vs-code-drift" &&
          s.message.includes("op://")
      );
      expect(rule).toBeUndefined();
    });

    it("flags ${keyring:...} in docs when no keyring impl exists", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["docs/secrets.md"],
          diffText: [
            "+++ b/docs/secrets.md",
            "+Use `${keyring:my-service/password}` for OS keychain.",
          ].join("\n"),
          fileContents: {
            "src/config.ts": "const config = loadYaml();",
          },
        })
      );
      const rule = suggestions.find(
        (s) =>
          s.rule === "readiness/docs-vs-code-drift" &&
          s.message.includes("keyring")
      );
      expect(rule).toBeDefined();
    });

    it("does not flag when no docs files are changed", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["src/index.ts"],
          diffText: "+Use `${env:FOO}` in config.",
          fileContents: {},
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/docs-vs-code-drift"
      );
      expect(rule).toBeUndefined();
    });

    it("does not flag when docs change has no drift patterns", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["docs/guide.md"],
          diffText: [
            "+++ b/docs/guide.md",
            "+This is a normal docs update with no special syntax.",
          ].join("\n"),
          fileContents: {},
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/docs-vs-code-drift"
      );
      expect(rule).toBeUndefined();
    });

    it("skips flagging when impl files are changed but no fileContents provided (conservative)", () => {
      // When we can't verify implementation, and impl files are changed,
      // we stay silent to avoid false positives.
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["docs/config.md", "src/config.ts"],
          diffText: [
            "+++ b/docs/config.md",
            "+Use `${env:FOO}` for env vars.",
            "+++ b/src/config.ts",
            "+const x = 1;",
          ].join("\n"),
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/docs-vs-code-drift"
      );
      expect(rule).toBeUndefined();
    });

    it("flags docs-only PR with drift patterns even without fileContents", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["docs/config.md"],
          diffText: [
            "+++ b/docs/config.md",
            "+Use `${env:FOO}` for env vars.",
          ].join("\n"),
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/docs-vs-code-drift"
      );
      expect(rule).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // unsupported-syntax-claim
  // -----------------------------------------------------------------------
  describe("readiness/unsupported-syntax-claim", () => {
    it("flags ${env:VAR} in existing docs when no resolver in impl", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["src/index.ts"],
          fileContents: {
            "docs/config.md": "Set `${env:DATABASE_URL}` in your config file.",
            "src/config.ts": "const db = process.env.DATABASE_URL;",
          },
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/unsupported-syntax-claim" && s.message.includes("${env:")
      );
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe("suggestion");
    });

    it("does not flag ${env:VAR} when impl has resolver", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["src/index.ts"],
          fileContents: {
            "docs/config.md": "Set `${env:DATABASE_URL}` in your config file.",
            "src/config.ts": "function parseEnvSubstitution(val) { /* ${env:...} */ }",
          },
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/unsupported-syntax-claim" && s.message.includes("${env:")
      );
      expect(rule).toBeUndefined();
    });

    it("flags op:// in config YAML when no resolver exists", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["src/index.ts"],
          fileContents: {
            "config.yaml": "secret: op://vault/item/field",
            "src/secrets.ts": "export function getSecret() { return ''; }",
          },
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/unsupported-syntax-claim" && s.message.includes("op://")
      );
      expect(rule).toBeDefined();
    });

    it("does not flag op:// when 1password resolver exists", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["src/index.ts"],
          fileContents: {
            "config.yaml": "secret: op://vault/item/field",
            "src/secrets.ts": "class OnePasswordProvider { resolve() {} }",
          },
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/unsupported-syntax-claim" && s.message.includes("op://")
      );
      expect(rule).toBeUndefined();
    });

    it("flags ${keyring:...} in markdown when no keyring impl", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["src/index.ts"],
          fileContents: {
            "README.md": "Use `${keyring:my-service/password}` for OS keychain.",
            "src/config.ts": "const config = {};",
          },
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/unsupported-syntax-claim" && s.message.includes("keyring")
      );
      expect(rule).toBeDefined();
    });

    it("flags ${vault:...} when no vault resolver", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["src/index.ts"],
          fileContents: {
            "docs/secrets.md": "Use `${vault:secret/data/myapp#password}` for Vault.",
            "src/secrets.ts": "export const getSecret = () => '';",
          },
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/unsupported-syntax-claim" && s.message.includes("vault")
      );
      expect(rule).toBeDefined();
    });

    it("flags ${ssm:...} when no SSM resolver", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["src/index.ts"],
          fileContents: {
            "config.toml": 'api_key = "${ssm:/prod/api-key}"',
            "src/config.ts": "export const load = () => ({});",
          },
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/unsupported-syntax-claim" && s.message.includes("ssm")
      );
      expect(rule).toBeDefined();
    });

    it("returns nothing when no fileContents provided", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["docs/config.md"],
          diffText: "+Use ${env:FOO}",
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/unsupported-syntax-claim"
      );
      expect(rule).toBeUndefined();
    });

    it("includes file path and example in evidence", () => {
      const suggestions = lintReadiness(
        makeInput({
          changedFiles: ["src/index.ts"],
          fileContents: {
            "docs/config.md": "Use `${keyring:svc/pass}` for secrets.",
            "src/app.ts": "console.log('hello');",
          },
        })
      );
      const rule = suggestions.find(
        (s) => s.rule === "readiness/unsupported-syntax-claim" && s.message.includes("keyring")
      );
      expect(rule).toBeDefined();
      expect(rule!.message).toContain("docs/config.md");
      expect(rule!.message).toContain("${keyring:svc/pass}");
    });
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
