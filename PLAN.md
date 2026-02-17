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
| CLI backfill command | ⬚ | `src/cli.ts` (new) |
| Webhook signature verification docs | ⬚ | `README.md` |
| `.env.example` | ✅ | `.env.example` |
| README with deploy instructions | ⬚ | `README.md` — needs full rewrite |
| GitHub Actions CI | ✅ | `.github/workflows/ci.yml` |
| Beautiful summary comment | ✅ | `src/comment.ts` — emojis, tables, sections |
| Configurable quality thresholds | ✅ | `src/types.ts`, `src/config.ts`, `src/quality.ts` |
| Dry run mode | ✅ | `src/config.ts`, `src/index.ts` |
| Edge cases (empty PRs, no body, massive diffs, bots) | ✅ | `src/index.ts` — guards for all |
| GitHub API rate limiting awareness | ⬚ | Need to handle 403/rate-limit on GitHub calls |
| Tests for new functionality | ✅ | `test/db.test.ts`, `test/config.test.ts`, `test/comment.test.ts`, `test/embed.test.ts` |

## Remaining Work (Phase 2)

### Priority 1: CLI backfill
- New `src/cli.ts` — takes `owner/repo`, iterates open PRs/issues, embeds them
- Add `"backfill"` script to package.json
- Needs Octokit standalone (not Probot context)

### Priority 2: README rewrite
- Deployment guide (Docker, Railway, Fly.io)
- Webhook signature verification
- Config reference with all options
- Screenshot/example of comment format

### Priority 3: GitHub API rate awareness
- Wrap GitHub API calls in try/catch for 403 secondary rate limits
- Add retry-after header handling

### Priority 4: Cleanup
- Remove dead code
- Ensure `.dockerignore` exists
- Ensure `.gitignore` covers dist/, *.db, .env

## Decisions Made

1. **Soft-delete over hard-delete** for closed PRs — preserves history, can re-activate if reopened
2. **Rate limit = 60 OpenAI calls/repo/hour** — prevents runaway costs on busy repos
3. **Default limit 500 embeddings** — sufficient for most repos, SQL-filtered
4. **Lazy DB singleton** — avoids import-time side effects, testable
5. **`withRetry` in embed.ts** — shared by both embedding and vision calls
6. **Bot detection by `[bot]` suffix** — covers GitHub Apps + Dependabot/Renovate

## Lessons

- Should have planned before coding — the first pass produced a dead `pickBestPR` function with a `require()` call that needed cleanup
- Comment formatting matters — the table format for duplicates is much more readable than bullet lists
