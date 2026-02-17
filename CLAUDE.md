# CLAUDE.md — PRGuard Project Rules

## Architecture

- **Runtime:** Node 20+, TypeScript ESM (`"type": "module"`), strict mode
- **Framework:** Probot 13 (GitHub App framework)
- **DB:** SQLite via `better-sqlite3` — requires persistent disk (not serverless)
- **AI:** OpenAI SDK — embeddings (`text-embedding-3-small`) + chat (`gpt-4o-mini`)
- **Tests:** Vitest

## File Layout

```
src/index.ts     — Probot event handlers, orchestration (the "controller")
src/db.ts        — SQLite schema, queries, rate limiting
src/embed.ts     — OpenAI embedding + retry logic
src/vision.ts    — LLM-based vision alignment evaluation
src/quality.ts   — PR quality scoring (pure function)
src/dedup.ts     — Cosine similarity + duplicate detection (pure functions)
src/comment.ts   — Markdown summary rendering (pure function)
src/labels.ts    — GitHub label ensure/apply
src/config.ts    — `.github/prguard.yml` loading + defaults
src/types.ts     — All shared TypeScript interfaces
```

## Conventions

- All source in `src/`, tests in `test/`
- File imports use `.js` extension (ESM requirement)
- Pure functions where possible — side effects only in `index.ts`, `db.ts`, `labels.ts`
- `getDb()` returns lazy singleton; never use global `const db = createDb()`
- OpenAI calls always go through `withRetry()` for exponential backoff
- All OpenAI JSON responses use `response_format: { type: "json_object" }`
- Config has sensible defaults; everything works with zero config

## Commands

```bash
npx tsc --noEmit    # Type check
npx vitest run      # Run tests
npm run build       # Compile to dist/
npm run dev         # Run with Probot
```

## Rules

1. **Every OpenAI call must have retry + graceful degradation** — return fallback, never crash
2. **Rate limit per repo/hour** — checked before any OpenAI call
3. **Embeddings are soft-deleted** on PR/issue close (active=0), not hard-deleted
4. **listEmbeddings is paginated** — default limit 500, SQL-side filtering by active + repo
5. **No global mutable state** — db is lazy singleton via `getDb()`
6. **dry_run mode** — logs actions without posting comments or applying labels
7. **Bot PRs skipped by default** — configurable via `skip_bots`
8. **Massive diffs handled** — configurable `max_diff_lines`, logged warning
9. **Quality thresholds configurable** — `quality_thresholds.approve` / `.reject`
10. **pickBestPR compares actual scores** from DB, not just current PR
11. **Always run `tsc --noEmit` + `vitest run` after changes**
