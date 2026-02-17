# PRGuard

PRGuard is a GitHub App for maintainers handling large PR/Issue volume. It detects duplicates, checks alignment with project vision, scores PR quality, and posts a single actionable summary comment.

## MVP Features

- PR/Issue de-duplication via embeddings + cosine similarity
- Best-PR recommendation among duplicate implementations
- Vision document enforcement from `.github/prguard.yml`
- Auto-labeling (`duplicate`, `off-scope`, `on-track`, `needs-review`, `recommended`)
- Idempotent summary comment updates on PRs and Issues

## Stack

- Node.js 20+
- TypeScript (ESM, strict)
- Probot
- OpenAI API (`text-embedding-3-small`, `gpt-4o-mini`)
- SQLite (`better-sqlite3`)
- Vitest

## Project Layout

- `src/index.ts`: Probot event handlers and orchestration
- `src/db.ts`: SQLite schema and queries
- `src/embed.ts`: embedding helpers
- `src/dedup.ts`: similarity + duplicate clustering
- `src/vision.ts`: LLM-based vision alignment
- `src/quality.ts`: PR quality scoring
- `src/comment.ts`: markdown summary rendering
- `src/labels.ts`: label ensure/apply
- `src/config.ts`: `.github/prguard.yml` loading
- `test/*.test.ts`: unit + integration tests

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure env vars:

```bash
export OPENAI_API_KEY=your_key_here
export APP_ID=...
export PRIVATE_KEY='-----BEGIN RSA PRIVATE KEY-----...'
export WEBHOOK_SECRET=...
# Optional
export DATABASE_PATH=./prguard.db
```

3. Build:

```bash
npm run build
```

4. Run tests:

```bash
npm test
```

5. Run app:

```bash
npm run dev
```

## Repo Configuration

Create `.github/prguard.yml` in each target repository:

```yaml
vision: |
  OpenClaw is a personal AI assistant platform.
  We accept: bug fixes, performance improvements, new skills, documentation.
  We reject: unrelated features, breaking API changes without discussion.

duplicate_threshold: 0.85
vision_model: gpt-4o-mini
labels:
  duplicate: "prguard:duplicate"
  off_scope: "prguard:off-scope"
  on_track: "prguard:on-track"
  needs_review: "prguard:needs-review"
  recommended: "prguard:recommended"
trusted_users:
  - steipete
  - dependabot[bot]
```

A starter config also exists at `.github/prguard.example.yml`.

## Behavior

- `pull_request.opened` / `pull_request.edited`
  - Embeds title/body/diff summary
  - Finds duplicates
  - Scores PR quality
  - Runs vision check
  - Applies labels
  - Upserts summary comment

- `issues.opened` / `issues.edited`
  - Embeds title/body
  - Finds duplicates
  - Applies labels
  - Upserts summary comment

## Notes

- PRGuard comments and labels only; it does not auto-close or block submissions.
- Diff content used for embedding is capped at 2000 chars.
- SQLite is used for MVP simplicity; migrate later if scale requires.
