# Contributing to PRGuard

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/your-org/prguard
cd prguard
npm install
```

## Running Locally

```bash
cp .env.example .env
# Fill in APP_ID, PRIVATE_KEY, WEBHOOK_SECRET, OPENAI_API_KEY
npm run dev
```

Use [smee.io](https://smee.io) to forward GitHub webhooks to your local instance.

## Code Standards

- **TypeScript ESM** with strict mode
- **Vitest** for testing — all tests must pass before merging
- Run `npx tsc --noEmit` to typecheck
- Run `npx vitest run` to run the full test suite

## Project Structure

```
src/
├── index.ts          # Event handlers + routes
├── handlers/
│   ├── pr.ts         # Pull request analysis
│   ├── issue.ts      # Issue analysis
│   └── command.ts    # Slash command handling
├── db.ts             # SQLite schema + queries
├── embed.ts          # OpenAI embeddings
├── dedup.ts          # Cosine similarity
├── vision.ts         # LLM vision alignment
├── quality.ts        # PR quality scoring
├── review.ts         # Deep code review
├── comment.ts        # Markdown comment rendering
├── labels.ts         # GitHub label management
├── config.ts         # Repo config loading
├── metrics.ts        # Prometheus counters
├── rate-limit.ts     # Per-installation rate limits
├── github.ts         # GitHub API retry wrapper
├── util.ts           # Shared utilities
├── types.ts          # TypeScript interfaces
├── cli.ts            # Backfill CLI
└── start.ts          # Entry point
```

## Testing

```bash
npm test              # Run all tests
npx vitest --watch    # Watch mode
npx vitest run -t "pattern"  # Run specific tests
```

Tests mock all external APIs (GitHub, OpenAI). No real API calls are made during tests.

## Submitting Changes

1. Fork the repo and create a feature branch
2. Make your changes with tests
3. Ensure `npx tsc --noEmit` and `npx vitest run` pass
4. Submit a PR with a clear description

## Architecture Decisions

- **SQLite** over Postgres — single-binary deployment, no external DB needed
- **Probot** for GitHub App framework — handles auth, webhooks, rate limiting
- **Graceful degradation** — if OpenAI is down, PRGuard still labels `needs-review`
- **Idempotent comments** — PRGuard finds/updates its own comment instead of creating duplicates
- **BYOK** — repos can bring their own OpenAI key to avoid shared quota
