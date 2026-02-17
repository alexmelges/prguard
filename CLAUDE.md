# CLAUDE.md — PRGuard Agent Instructions

## Project Overview
PRGuard is a GitHub App that helps OSS maintainers triage PRs and Issues at scale.
It de-duplicates submissions, enforces project vision, and recommends the best PR among duplicates.

## Tech Stack
- TypeScript (ESM, strict mode)
- Probot framework for GitHub App
- SQLite via better-sqlite3 for storage
- OpenAI API for embeddings (text-embedding-3-small) and LLM (gpt-4o-mini)
- Vitest for testing
- Node.js 20+

## Code Style
- ESM only (`"type": "module"` in package.json)
- Strict TypeScript (`strict: true`)
- No classes unless truly needed — prefer functions and plain objects
- No premature abstractions — three similar lines are better than a premature abstraction
- Small, focused files — each module does one thing
- All async functions return `Promise<T>` explicitly typed
- Error handling: fail loud in dev, graceful in production (log + continue)

## Architecture Rules
- **Comment, don't block.** Never auto-close or auto-reject PRs. Only comment and label.
- **Idempotent operations.** Re-analyzing a PR should produce the same result and update in place.
- **Config from repo.** All behavior configured via `.github/prguard.yml` in the target repo.
- **No external infra for MVP.** SQLite only. No Redis, no Postgres, no Supabase.
- **Embeddings are cheap.** Don't over-optimize. Re-embed on edit is fine.

## File Layout
- `src/index.ts` — Probot entry point, webhook handlers
- `src/embed.ts` — OpenAI embedding generation
- `src/dedup.ts` — Cosine similarity, duplicate detection, clustering
- `src/vision.ts` — Vision doc enforcement via LLM
- `src/quality.ts` — PR quality scoring (diff size, tests, commit hygiene)
- `src/comment.ts` — GitHub comment formatting (markdown)
- `src/labels.ts` — Label creation and application
- `src/db.ts` — SQLite database setup, migrations, queries
- `src/config.ts` — Load and parse .github/prguard.yml

## Testing
- Unit tests for each module (dedup, vision, quality)
- Mock OpenAI API calls in tests (don't hit real API)
- Mock GitHub API via Probot's test helpers
- `vitest` with `--coverage` for CI

## Common Patterns
```typescript
// Embedding generation
const embedding = await getEmbedding(text); // returns number[]

// Cosine similarity
const similarity = cosineSimilarity(embA, embB); // returns 0-1

// DB operations
db.upsertEmbedding({ repo, type, number, title, body, diffSummary, embedding });
const duplicates = db.findDuplicates(repo, type, number, embedding, threshold);
```

## Anti-Patterns
- Don't fetch full diffs for embedding — use first 2000 chars max
- Don't call OpenAI for every label check — batch where possible
- Don't create labels that already exist (check first)
- Don't comment if nothing actionable found (no "all clear!" spam)
- Don't over-engineer the MVP — ship something that works for one repo first

## Lessons Learned
(Add lessons here as we build)
