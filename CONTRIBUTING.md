# Contributing to PRGuard

## Prerequisites

- Node.js ≥ 20
- An OpenAI API key (`OPENAI_API_KEY`)
- A GitHub App (for end-to-end testing)

## Setup

```bash
git clone https://github.com/your-org/prguard
cd prguard
npm install
cp .env.example .env
# Fill in OPENAI_API_KEY, APP_ID, PRIVATE_KEY, WEBHOOK_SECRET
```

## Development

### Build & typecheck

```bash
npm run build      # Compile TypeScript to dist/
npm run lint       # Typecheck without emitting (tsc --noEmit)
```

### Run tests

```bash
npm test           # Run all tests once
npm run test:watch # Watch mode
```

### Local webhook development

PRGuard uses [smee.io](https://smee.io) to proxy GitHub webhooks to your local machine during development.

1. Go to https://smee.io/new and copy the URL
2. Set `WEBHOOK_PROXY_URL` in your `.env` file
3. Run:

```bash
npm run build
npm run dev
```

This starts `smee` to forward webhooks and `probot` to run the app.

### Project structure

```
src/
  index.ts       — Probot app entry, event routing
  handlers/
    pr.ts        — Pull request handler (embed, dedup, score, review, comment)
    issue.ts     — Issue handler
  db.ts          — SQLite schema, queries
  embed.ts       — OpenAI embeddings + retry logic
  vision.ts      — Vision alignment evaluation
  review.ts      — LLM code review
  comment.ts     — Markdown comment builder
  config.ts      — .github/prguard.yml config loader
  quality.ts     — PR quality scoring
  dedup.ts       — Cosine similarity duplicate detection
  labels.ts      — GitHub label management
  metrics.ts     — Prometheus metrics
  util.ts        — Shared helpers
  types.ts       — TypeScript types
  cli.ts         — Backfill CLI
test/
  *.test.ts      — Vitest tests
```

## Code style

- Use `app.log` for logging (never `console.log`)
- All OpenAI calls go through `withRetry()` from `embed.ts`
- Database access via `getDb()` singleton
- Types in `types.ts`, config in `config.ts`
