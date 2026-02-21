# Agent-Readiness Lint (B2)

PRGuard includes **non-blocking readiness suggestions** that help repos become
friendlier to automated agents (CI bots, LLM-powered tools, API consumers).

## Rules

### `readiness/machine-readable-policy`

**Triggers when:** A PR modifies API-surface code (`routes/`, `handlers/`,
`controllers/`, `api/`, `endpoints/`) and the repository has no machine-readable
policy file.

**Recognized policy files:** `robots.txt`, `SECURITY.md`, `openapi.yaml`,
`openapi.json`, `swagger.yaml`, `.well-known/ai-plugin.json`, `.github/policy.yml`

**Why it matters:** Automated agents need a discoverable contract to understand
what they can and cannot do with your API.

### `readiness/deterministic-error-schema`

**Triggers when:** A PR modifies API handler code and the diff contains
error-status sends (4xx/5xx) without a structured JSON error shape
(`{ error: { code, message } }`).

**Why it matters:** Agents parsing API errors need a deterministic schema.
Unstructured error strings force brittle string-matching.

### `readiness/replay-test-signal`

**Triggers when:** A PR modifies automation-facing code (webhooks, workflows,
commands, cron jobs) but includes no test or fixture file changes.

**Why it matters:** Automated agents verifying behavior need replay fixtures or
tests as a minimal correctness signal.

## Behavior

- All rules emit **suggestions only** — they never block a PR.
- Suggestions appear in the PRGuard summary comment under
  "🤖 Agent-Readiness Suggestions".
- Conservative heuristics avoid false positives (only fire when API-surface
  files are explicitly touched).

## Configuration

Readiness lint is enabled by default with no extra configuration needed.
It runs as part of the standard PR analysis pipeline.
