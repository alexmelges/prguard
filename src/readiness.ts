/**
 * Agent-readiness lint: non-blocking suggestions for missing signals that
 * help automated agents consume a repository safely.
 *
 * All rules emit **suggestions only** — they never block a PR.
 */

export interface ReadinessSuggestion {
  rule: string;
  message: string;
  severity: "suggestion";
  docUrl?: string;
}

export interface ReadinessInput {
  /** File paths changed in the PR (relative to repo root). */
  changedFiles: string[];
  /** All file paths known to exist in the repo root (top-level listing). */
  repoRootFiles: string[];
  /** Patch/diff content concatenated (used for heuristic scanning). */
  diffText: string;
  /**
   * Optional: full content of implementation files the caller resolved,
   * keyed by repo-relative path. Used by docs-vs-code drift checks.
   */
  fileContents?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Rule: machine-readable policy missing
// ---------------------------------------------------------------------------

const POLICY_FILES = [
  "robots.txt",
  "SECURITY.md",
  "security.md",
  ".well-known/ai-plugin.json",
  "openapi.yaml",
  "openapi.yml",
  "openapi.json",
  "swagger.yaml",
  "swagger.yml",
  "swagger.json",
  ".github/policy.yml",
];

/**
 * Detects whether the PR touches API-surface files (routes, handlers,
 * controllers) but the repo lacks any machine-readable policy files.
 */
function checkMachineReadablePolicy(input: ReadinessInput): ReadinessSuggestion | null {
  const touchesApi = input.changedFiles.some((f) =>
    /\/(routes|handlers|controllers|api|endpoints)\//i.test(f) ||
    /openapi|swagger/i.test(f)
  );

  if (!touchesApi) return null;

  const hasPolicy = POLICY_FILES.some((pf) =>
    input.repoRootFiles.some((rf) => rf.toLowerCase() === pf.toLowerCase()) ||
    input.changedFiles.some((cf) => cf.toLowerCase() === pf.toLowerCase())
  );

  if (hasPolicy) return null;

  return {
    rule: "readiness/machine-readable-policy",
    message:
      "This PR modifies API-surface code but the repo has no machine-readable policy file " +
      "(e.g. `openapi.yaml`, `SECURITY.md`, `.well-known/ai-plugin.json`). " +
      "Adding one helps automated agents discover and respect your API contract.",
    severity: "suggestion",
  };
}

// ---------------------------------------------------------------------------
// Rule: deterministic API error schema missing
// ---------------------------------------------------------------------------

/**
 * Looks for new/changed API handler code that lacks structured error
 * responses (e.g. JSON error objects with `code`/`message` fields).
 */
function checkDeterministicErrorSchema(input: ReadinessInput): ReadinessSuggestion | null {
  const touchesApi = input.changedFiles.some((f) =>
    /\/(routes|handlers|controllers|api|endpoints)\//i.test(f)
  );

  if (!touchesApi) return null;

  // Heuristic: look for error-response patterns in the diff.
  // If the diff adds status-code sends but never includes a JSON body with
  // `code` or `error` key, flag it.
  const hasErrorSend =
    /\.(status|sendStatus)\(\s*(4\d{2}|5\d{2})\s*\)/m.test(input.diffText) ||
    /res\s*\.\s*json\(\s*\{[^}]*status\s*:/m.test(input.diffText) ||
    /HttpException|HttpError|BadRequest|NotFound/m.test(input.diffText);

  if (!hasErrorSend) return null;

  const hasStructuredError =
    /["']error["']\s*:/m.test(input.diffText) &&
    /["'](code|message|detail)["']\s*:/m.test(input.diffText);

  if (hasStructuredError) return null;

  return {
    rule: "readiness/deterministic-error-schema",
    message:
      "API error responses in this PR may lack a deterministic JSON schema " +
      "(e.g. `{ error: { code, message } }`). " +
      "A consistent error shape lets automated agents parse failures without guessing.",
    severity: "suggestion",
  };
}

// ---------------------------------------------------------------------------
// Rule: minimal replay/test signal missing for automation paths
// ---------------------------------------------------------------------------

/**
 * If the PR adds automation-facing paths (webhooks, CLI commands, cron jobs,
 * GitHub Actions) but has no corresponding test file changes, suggest adding
 * a minimal replay/test fixture.
 */
function checkReplayTestSignal(input: ReadinessInput): ReadinessSuggestion | null {
  const automationFiles = input.changedFiles.filter((f) =>
    /\/(webhooks?|hooks?|cron|jobs?|commands?|actions?|workflows?)\//i.test(f) ||
    /\.github\/workflows\//i.test(f) ||
    /webhook/i.test(f)
  );

  if (automationFiles.length === 0) return null;

  const hasTestChanges = input.changedFiles.some((f) =>
    /(^|\/)tests?\//i.test(f) ||
    /\.(test|spec)\./i.test(f) ||
    /fixtures?\//i.test(f) ||
    /__(tests|mocks|fixtures)__\//i.test(f)
  );

  if (hasTestChanges) return null;

  return {
    rule: "readiness/replay-test-signal",
    message:
      "This PR modifies automation-facing code (webhooks, workflows, commands) " +
      "but includes no test or fixture changes. " +
      "Adding a minimal replay fixture helps agents verify behavior deterministically.",
    severity: "suggestion",
  };
}

// ---------------------------------------------------------------------------
// Rule: docs-vs-code contract drift
// ---------------------------------------------------------------------------

/** Patterns we look for in docs that imply specific implementation support. */
interface DriftPattern {
  /** Human-readable name for the syntax/feature. */
  name: string;
  /** Regex that matches claims in docs (applied to added lines only). */
  docsPattern: RegExp;
  /**
   * Regex that should match somewhere in the implementation if the claim is
   * valid. When `implPattern` is absent the rule checks `implPathPattern`.
   */
  implPattern?: RegExp;
  /**
   * Glob-ish regex for file paths that would contain the implementation.
   * If none of the known files match, the claim is suspicious.
   */
  implPathPattern?: RegExp;
  /** Remediation hint shown to the author. */
  remediation: string;
}

const DRIFT_PATTERNS: DriftPattern[] = [
  {
    name: "${env:VAR} substitution syntax",
    docsPattern: /\$\{env:[^}]+\}/,
    implPattern: /\$\{env:[^}]*\}|env\s*:\s*|parseEnvSubstitution|envPrefix/i,
    remediation:
      "The implementation appears to use `${VAR}` (plain env) rather than " +
      "`${env:...}` namespaced syntax. Update the docs to match, or add " +
      "a resolver for the `env:` prefix.",
  },
  {
    name: "${keyring:...} provider syntax",
    docsPattern: /\$\{keyring:[^}]+\}/,
    implPattern: /keyring|KeyringProvider|resolveKeyring/i,
    remediation:
      "No `keyring` resolver implementation was found. " +
      "Remove the docs reference or implement the provider.",
  },
  {
    name: "op:// (1Password) provider syntax",
    docsPattern: /op:\/\/[^\s)}`'"]*/,
    implPattern: /op:\/\/|OnePasswordProvider|resolve1Password|opResolver/i,
    remediation:
      "No 1Password (`op://`) resolver implementation was found. " +
      "Remove the docs reference or implement the provider.",
  },
];

/**
 * Detects when docs changes in a PR claim syntax or contracts that are not
 * supported by the implementation (conservative, suggestion-only).
 */
function checkDocsVsCodeDrift(input: ReadinessInput): ReadinessSuggestion[] {
  const results: ReadinessSuggestion[] = [];

  // Only inspect when docs files are changed.
  const docFiles = input.changedFiles.filter((f) =>
    /\.(md|mdx|rst|txt)$/i.test(f) ||
    /^docs?\//i.test(f) ||
    /readme/i.test(f)
  );
  if (docFiles.length === 0) return results;

  // Extract added lines from the diff that belong to docs files.
  // We look for unified-diff hunks: lines starting with "+" (not "+++").
  const addedDocsLines = extractAddedDocsLines(input.diffText, docFiles);
  if (addedDocsLines.length === 0) return results;

  const addedText = addedDocsLines.join("\n");

  // Aggregate all known implementation content for pattern scanning.
  const implText = input.fileContents
    ? Object.values(input.fileContents).join("\n")
    : "";

  for (const pattern of DRIFT_PATTERNS) {
    if (!pattern.docsPattern.test(addedText)) continue;

    // Find the offending line(s) for evidence.
    const offendingLines = addedDocsLines.filter((l) =>
      pattern.docsPattern.test(l)
    );

    // Check implementation evidence.
    let hasImplSupport = false;

    if (pattern.implPattern && implText) {
      hasImplSupport = pattern.implPattern.test(implText);
    }

    // If we have no impl content to scan, also check if the diff itself
    // contains implementation changes that match (self-contained PRs).
    if (!hasImplSupport && pattern.implPattern) {
      // Only check non-docs portions of the diff.
      const nonDocsChanged = input.changedFiles.some(
        (f) =>
          !/\.(md|mdx|rst|txt)$/i.test(f) &&
          !/^docs?\//i.test(f) &&
          !/readme/i.test(f)
      );
      if (nonDocsChanged && pattern.implPattern.test(input.diffText)) {
        hasImplSupport = true;
      }
    }

    if (hasImplSupport) continue;

    // If no fileContents were provided at all, only flag if the PR is
    // docs-only (no impl files changed) to stay conservative.
    if (!input.fileContents) {
      const hasImplChanges = input.changedFiles.some(
        (f) =>
          !/\.(md|mdx|rst|txt)$/i.test(f) &&
          !/^docs?\//i.test(f) &&
          !/readme/i.test(f)
      );
      if (hasImplChanges) continue; // can't verify → skip to avoid FP
    }

    const snippet =
      offendingLines.length > 0
        ? offendingLines[0].trim().substring(0, 120)
        : "";

    results.push({
      rule: "readiness/docs-vs-code-drift",
      message:
        `Docs claim **${pattern.name}** support ` +
        (snippet ? `(\`${snippet}\`) ` : "") +
        `but no matching implementation was found. ` +
        pattern.remediation,
      severity: "suggestion",
    });
  }

  return results;
}

/**
 * Extract added lines from unified diff that belong to the given doc files.
 * Conservative: only considers lines starting with "+" in hunks under a
 * matching file header.
 */
function extractAddedDocsLines(
  diffText: string,
  docFiles: string[]
): string[] {
  if (!diffText) return [];

  const lines = diffText.split("\n");
  const added: string[] = [];
  let inDocFile = false;

  for (const line of lines) {
    // Detect file header (--- a/path or +++ b/path).
    if (line.startsWith("+++ b/") || line.startsWith("+++ a/")) {
      const filePath = line.slice(6);
      inDocFile = docFiles.some(
        (df) => filePath === df || filePath.endsWith("/" + df)
      );
      continue;
    }
    if (line.startsWith("--- ")) continue;

    if (inDocFile && line.startsWith("+") && !line.startsWith("+++")) {
      added.push(line.slice(1)); // strip leading "+"
    }
  }

  return added;
}

// Re-export for testing.
export { extractAddedDocsLines as _extractAddedDocsLines };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run all readiness lint rules and return any suggestions.
 * Returns an empty array when nothing is flagged.
 */
export function lintReadiness(input: ReadinessInput): ReadinessSuggestion[] {
  const checks = [
    checkMachineReadablePolicy,
    checkDeterministicErrorSchema,
    checkReplayTestSignal,
  ];

  const suggestions: ReadinessSuggestion[] = [];
  for (const check of checks) {
    const result = check(input);
    if (result) suggestions.push(result);
  }

  // Multi-result rules.
  suggestions.push(...checkDocsVsCodeDrift(input));

  return suggestions;
}

/**
 * Format readiness suggestions into a markdown section for the PR comment.
 * Returns empty string if there are no suggestions.
 */
export function formatReadinessSuggestions(suggestions: ReadinessSuggestion[]): string {
  if (suggestions.length === 0) return "";

  const lines = [
    "\n### 🤖 Agent-Readiness Suggestions",
    "",
    "> These are **non-blocking suggestions** to improve automated-agent compatibility.",
    "",
  ];

  for (const s of suggestions) {
    lines.push(`- **\`${s.rule}\`** — ${s.message}`);
  }

  return lines.join("\n");
}
