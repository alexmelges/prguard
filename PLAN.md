# PLAN.md — PRGuard Production Readiness

## Status Legend
- ✅ Done and tested
- 🔧 In progress
- ⬚ Not started

## Core Issues (from task)

| # | Issue | Status | Files |
|---|-------|--------|-------|
| 1 | `contributorMergedPRs` hardcoded to 0 | ✅ | `src/index.ts` — `fetchContributorMergedPRs()` via search API |
| 2 | No rate limiting / OpenAI error handling | ✅ | `src/embed.ts` — `withRetry()`, `src/db.ts` — `checkRateLimit()`, `src/index.ts` — budget check |
| 3 | SQLite on serverless | ✅ | `Dockerfile`, `docker-compose.yml`, README docs |
| 4 | `listEmbeddings` loads all into memory | ✅ | `src/db.ts` — `LIMIT ?` + `active=1` filter |
| 5 | No `response_format` on vision call | ✅ | `src/vision.ts` — added `response_format: { type: "json_object" }` |
| 6 | Global `const db = createDb()` | ✅ | `src/db.ts` — `getDb()` lazy singleton, `src/index.ts` — calls `getDb()` |
| 7 | Missing `app.yml` | ✅ | `app.yml` with correct permissions |
| 8 | No closed/merged cleanup | ✅ | `src/db.ts` — `deactivateEmbedding()`, `src/index.ts` — `pull_request.closed` + `issues.closed` handlers |
| 9 | `pickBestPR` naive | ✅ | `src/index.ts` — `pickBestPRClean()` compares scores from DB |
| 10 | No Dockerfile / deploy config | ✅ | `Dockerfile`, `docker-compose.yml` |

## Enhancement Items

| Item | Status | Files |
|------|--------|-------|
| Proper logging (Probot logger) | ✅ | `src/index.ts` — `app.log` throughout |
| CLI backfill command | ✅ | `src/cli.ts` + `@octokit/rest` |
| Webhook signature verification docs | ✅ | `README.md` |
| `.env.example` | ✅ | `.env.example` |
| README with deploy instructions | ✅ | `README.md` — full rewrite with deploy guide |
| GitHub Actions CI | ✅ | `.github/workflows/ci.yml` |
| Beautiful summary comment | ✅ | `src/comment.ts` — emojis, tables, sections |
| Configurable quality thresholds | ✅ | `src/types.ts`, `src/config.ts`, `src/quality.ts` |
| Dry run mode | ✅ | `src/config.ts`, `src/index.ts` |
| Edge cases (empty PRs, no body, massive diffs, bots) | ✅ | `src/index.ts` — guards for all |
| GitHub API rate limiting awareness | ✅ | `src/github.ts` — `withGitHubRetry()` with retry-after |
| Tests for new functionality | ✅ | `test/db.test.ts`, `test/config.test.ts`, `test/comment.test.ts`, `test/embed.test.ts` |

## Completed Work

All 10 core issues resolved. All enhancement items done except:
- Could add more granular GitHub API wrapping (currently only search call is wrapped)
- Could add E2E test with mocked Probot context
- Could add Fly.io `fly.toml` template

## Decisions Made

1. **Soft-delete over hard-delete** for closed PRs — preserves history, can re-activate if reopened
2. **Rate limit = 60 OpenAI calls/repo/hour** — prevents runaway costs on busy repos
3. **Default limit 500 embeddings** — sufficient for most repos, SQL-filtered
4. **Lazy DB singleton** — avoids import-time side effects, testable
5. **`withRetry` in embed.ts** — shared by both embedding and vision calls
6. **Bot detection by `[bot]` suffix** — covers GitHub Apps + Dependabot/Renovate

## Iteration 4: Deep Code Review

| Item | Status |
|------|--------|
| LLM-powered code review (`src/review.ts`) | ✅ |
| Reviews table in DB | ✅ |
| Cross-PR comparison | ✅ |
| Weighted `pickBestPR` (review 40%, quality 30%, vision 30%) | ✅ |
| Enhanced comment with review section | ✅ |
| Config: `deep_review`, `review_model`, `max_diff_tokens` | ✅ |
| Tests (10 new review tests, 3 DB review tests, 1 comment snapshot) | ✅ |

## Iteration 5: Final Polish

| Item | Status |
|------|--------|
| PR reopened handler + `reactivateEmbedding()` | ✅ |
| Vision gets full diff (not 2000 char truncation) | ✅ |
| CONTRIBUTING.md | ✅ |
| `npm run dev` with smee.io proxy | ✅ |
| `npm run lint` script | ✅ |
| Fix flaky handler tests (DATABASE_PATH=:memory:) | ✅ |
| GAPS.md updated | ✅ |

## Review Scores

Reviewed 2026-02-17 (iteration 5). **91 tests passing**, TypeScript clean.

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Code quality** | 8/10 | Clean split into handlers, good separation of concerns. Types are solid. Structured logging throughout. Minor: some `any` types on octokit params. |
| **Test coverage** | 9/10 | 91 tests: unit, integration, handler-level with mocked Probot context, error paths, comment snapshot tests, DB reactivation tests. All green. |
| **Documentation** | 9/10 | Comprehensive README, CONTRIBUTING.md, deploy guide, env vars, config reference, .env.example, app.yml. |
| **Deployment** | 8/10 | Dockerfile works (multi-stage, native deps handled), docker-compose, volume for SQLite, /healthz endpoint. |
| **Feature completeness** | 9/10 | Core loop solid: dedup, quality scoring, LLM code review, vision alignment (full diff), labels, comments, backfill CLI, reopen handler. Cross-PR comparison. Graceful degradation. |
| **Operational readiness** | 8/10 | Structured logging, /healthz, /metrics Prometheus, graceful degradation, startup validation, rate limiting, retry with backoff. |
| **DX** | 8/10 | `npm run dev` with smee.io, `npm run lint`, CONTRIBUTING.md, vitest, TSX for CLI. |

**Overall: 8.7/10** (up from 8.6)

**Overall: 8.6/10** — Deep code review closes the biggest gap. Cross-PR comparison and weighted scoring make duplicate handling substantive.

## Lessons

- **Plan before coding** — the first pass produced a dead `pickBestPR` function with a `require()` call that needed cleanup. Planning would have caught the dependency between getAnalysis import and the function.
- **Comment formatting matters** — table format for duplicates is much more readable than bullet lists
- **Probot's CMD** — Dockerfile needs `npx probot run`, not `node dist/index.js`
- **Type safety with wrappers** — `withGitHubRetry` returns `unknown` generic which means destructuring needs explicit casting at call sites
- **Test execution time** — the GitHub retry test takes ~1s due to real `setTimeout` delays; consider mocking timers if test suite grows
