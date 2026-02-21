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
