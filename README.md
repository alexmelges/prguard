# 🛡️ PRGuard

> Automated PR/Issue triage for GitHub — duplicate detection, quality scoring, and vision alignment.

PRGuard is a GitHub App that helps maintainers manage high-volume repositories. It automatically analyzes incoming PRs and issues, detects duplicates, scores PR quality, checks alignment with your project vision, and posts a single actionable summary comment.

## ✨ Features

- **🔍 Duplicate Detection** — Embeddings-based similarity search across PRs and issues
- **📊 PR Quality Scoring** — Diff size, test coverage, commit hygiene, contributor history, CI status
- **🎯 Vision Alignment** — LLM-based evaluation against your project's rules and goals
- **🏆 Best-PR Recommendation** — When duplicates exist, identifies the strongest implementation
- **🏷️ Auto-labeling** — `duplicate`, `off-scope`, `on-track`, `needs-review`, `recommended`
- **💬 Summary Comments** — Single, idempotent comment with all findings
- **🧹 Automatic Cleanup** — Deactivates embeddings when PRs/issues are closed
- **🤖 Bot Filtering** — Skip bot PRs (Dependabot, Renovate, etc.)
- **🏃 Dry Run Mode** — Test without posting comments or labels
- **⚡ Rate Limiting** — Per-repo hourly budget for OpenAI calls

## 📋 How It Works

When a PR or issue is opened/edited:

1. **Embed** — Title, body, and diff are embedded via OpenAI `text-embedding-3-small`
2. **Deduplicate** — Cosine similarity against existing embeddings (configurable threshold)
3. **Score** (PRs only) — Quality scoring based on multiple signals
4. **Evaluate** (PRs only) — LLM checks alignment with project vision
5. **Label** — Apply relevant labels
6. **Comment** — Post/update a summary comment with findings

When a PR/issue is closed:
- Embedding is soft-deleted (marked inactive) to keep duplicate detection accurate

## 🚀 Deployment

PRGuard uses SQLite and **requires persistent disk storage**. It runs on any platform with persistent volumes: Railway, Fly.io, a VPS, Docker, etc. **Not compatible with serverless** (Vercel, Lambda).

### Docker (recommended)

```bash
# Clone and configure
git clone https://github.com/your-org/prguard
cd prguard
cp .env.example .env
# Edit .env with your credentials

# Run
docker compose up -d
```

The SQLite database is persisted in a Docker volume at `/data/prguard.db`.

### Railway / Fly.io

1. Create a new project and link the repo
2. Set environment variables (see `.env.example`)
3. Ensure a persistent volume is mounted at `/data`
4. Set `DATABASE_PATH=/data/prguard.db`

### Manual

```bash
npm install
npm run build
npm run dev
```

## ⚙️ Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_ID` | ✅ | GitHub App ID |
| `PRIVATE_KEY` | ✅ | GitHub App private key (PEM format) |
| `WEBHOOK_SECRET` | ✅ | GitHub webhook secret |
| `OPENAI_API_KEY` | ✅ | OpenAI API key |
| `DATABASE_PATH` | | SQLite path (default: `./prguard.db`) |
| `PORT` | | Server port (default: `3000`) |
| `LOG_LEVEL` | | `trace` / `debug` / `info` / `warn` / `error` |

### Repository Config (`.github/prguard.yml`)

Create this file in each repository where PRGuard is installed:

```yaml
# Project vision — PRGuard uses this to evaluate PR alignment
vision: |
  We are building a CLI tool for developers.
  Accept: bug fixes, performance improvements, new commands, docs.
  Reject: unrelated features, breaking changes without RFC.

# Similarity threshold for duplicate detection (0.0 - 1.0)
duplicate_threshold: 0.85

# OpenAI model for vision evaluation
vision_model: gpt-4o-mini

# Quality score thresholds
quality_thresholds:
  approve: 0.75  # Score >= this → recommend approve
  reject: 0.45   # Score < this → recommend reject

# Maximum diff lines to analyze (PRs beyond this get a warning)
max_diff_lines: 10000

# Skip bot PRs (dependabot, renovate, etc.)
skip_bots: true

# Log actions without posting comments/labels
dry_run: false

# Users to skip entirely
trusted_users:
  - maintainer-username
  - dependabot[bot]

# Custom label names
labels:
  duplicate: "prguard:duplicate"
  off_scope: "prguard:off-scope"
  on_track: "prguard:on-track"
  needs_review: "prguard:needs-review"
  recommended: "prguard:recommended"
```

All fields are optional — sensible defaults are used when not specified.

## 🏷️ Labels

PRGuard automatically creates and applies these labels:

| Label | Color | Meaning |
|-------|-------|---------|
| `prguard:needs-review` | 🟡 | Maintainer review needed |
| `prguard:duplicate` | 🔴 | Potential duplicate of another PR/issue |
| `prguard:on-track` | 🟢 | Aligned with project vision |
| `prguard:off-scope` | 🟠 | Likely outside project vision |
| `prguard:recommended` | 🔵 | Strongest implementation among duplicates |

## 💬 Comment Format

PRGuard posts a single comment per PR/issue that looks like:

```
🛡️ PRGuard Triage Summary

🔍 Duplicate Check
| #  | Type | Similarity | Title          |
|----|------|-----------|----------------|
| #42 | pr   | 91%       | Fix parser bug |

🎯 Vision Alignment
- Score: 🟢 85%
- Aligned: ✅ Yes
- Assessment: PR adds a new CLI command, aligned with project goals

📊 PR Quality
- Score: 🟢 82%
- Recommendation: ✅ approve

🏆 Recommendation
PR #45 appears to be the strongest implementation.
```

## 📡 Observability

### Health Check

```
GET /healthz → { "status": "ok", "db": "connected" }
```

Returns 200 when healthy, 503 when DB is unavailable.

### Metrics

```
GET /metrics → Prometheus text format
```

Exposes counters: `prguard_prs_analyzed_total`, `prguard_issues_analyzed_total`, `prguard_duplicates_found_total`, `prguard_openai_calls_total`, `prguard_errors_total`, `prguard_openai_degraded_total`.

### Graceful Degradation

If OpenAI is unavailable, PRGuard continues to function:
- Applies `needs-review` label
- Posts a comment explaining automated analysis is temporarily unavailable
- Maintainers can review manually until the service recovers

## 🔧 CLI — Backfill Existing Data

To embed all existing open PRs and issues for a repo:

```bash
export GITHUB_TOKEN=ghp_...
export OPENAI_API_KEY=sk-...
npm run backfill -- owner/repo
```

This is useful when installing PRGuard on a repo that already has open PRs/issues.

## 🔐 Webhook Security

Probot automatically verifies webhook signatures using `WEBHOOK_SECRET`. Ensure:

1. Your GitHub App's webhook secret matches the `WEBHOOK_SECRET` env var
2. Your webhook URL uses HTTPS in production
3. The webhook endpoint is not publicly accessible without signature verification

Probot handles signature verification internally — no additional configuration needed.

## 🏗️ GitHub App Setup

1. Go to [GitHub App settings](https://github.com/settings/apps/new)
2. Use `app.yml` as reference for permissions:
   - **Issues:** Read & Write (for comments and labels)
   - **Pull Requests:** Read (for PR data)
   - **Checks:** Read (for CI status)
   - **Contents:** Read (for `.github/prguard.yml`)
   - **Metadata:** Read
3. Subscribe to events: `pull_request`, `issues`, `check_run`
4. Set webhook URL to `https://your-domain.com/api/github/webhooks`
5. Generate a private key and note the App ID

## 🧪 Development

```bash
npm install          # Install dependencies
npx tsc --noEmit     # Type check
npm test             # Run tests
npm run build        # Compile TypeScript
npm run dev          # Run locally with Probot
```

## 📐 Architecture

```
src/index.ts     → Event handlers + orchestration
src/db.ts        → SQLite schema, queries, rate limiting
src/embed.ts     → OpenAI embeddings + retry logic
src/vision.ts    → LLM vision alignment evaluation
src/quality.ts   → PR quality scoring (pure function)
src/dedup.ts     → Cosine similarity + duplicate detection
src/comment.ts   → Markdown summary rendering
src/labels.ts    → GitHub label management
src/config.ts    → Repo config loading + defaults
src/github.ts    → GitHub API retry wrapper
src/cli.ts       → CLI for backfill operations
src/types.ts     → Shared TypeScript interfaces
```

## License

MIT
