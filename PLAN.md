# PRGuard — Implementation Plan

## Objective
Build a GitHub App that helps OSS maintainers triage PRs and Issues at scale.
Target user: steipete (OpenClaw, 3100+ PRs) and any OSS maintainer drowning in AI-generated contributions.

## Core Features (MVP)

### 1. PR & Issue De-duplication
- On new PR or Issue opened, generate embedding of title + body + (for PRs) diff summary
- Compare against all open PRs/Issues using cosine similarity
- If similarity > threshold (configurable, default 0.85), comment with links to related items
- Group duplicates into clusters

### 2. Best-PR Selection
- When duplicates detected, score each PR on signals:
  - Diff quality (size, focused changes vs kitchen-sink)
  - Test coverage (adds/modifies tests?)
  - Commit hygiene (clean messages, logical commits)
  - Contributor history (past merged PRs, account age)
  - CI status (passing?)
- Surface recommendation: "PR #123 appears to be the strongest implementation"

### 3. Vision Document Enforcement
- Maintainer creates `.github/prguard.yml` with:
  - `vision:` — project description, goals, what's in/out of scope
  - `rules:` — specific accept/reject criteria
  - `labels:` — custom label mappings
- On each PR, LLM evaluates: does this PR align with the vision?
- If off-scope: label `off-scope`, comment explaining why
- If aligned: label `on-track`

### 4. Auto-labeling & Dashboard Comment
- Labels: `duplicate`, `off-scope`, `on-track`, `needs-review`, `recommended`
- Summary comment on each PR with:
  - Duplicate check result
  - Vision alignment score
  - Related PRs/Issues
  - Recommendation

## Architecture

### Tech Stack
- **Runtime:** Node.js + TypeScript (ESM)
- **Framework:** Probot (GitHub App framework) — handles webhooks, auth, API
- **Embeddings:** OpenAI `text-embedding-3-small` (cheap, fast, good enough)
- **LLM:** OpenAI GPT-4o-mini for vision enforcement (cheap, fast)
- **Storage:** SQLite via better-sqlite3 (simple, no external deps for MVP)
  - Embeddings stored as JSON arrays
  - Cosine similarity computed in JS (fast enough for <10K items)
- **Deployment:** Vercel serverless functions (or self-hosted)
- **Testing:** Vitest

### Data Model (SQLite)
```sql
CREATE TABLE embeddings (
  id INTEGER PRIMARY KEY,
  repo TEXT NOT NULL,           -- owner/repo
  type TEXT NOT NULL,           -- 'pr' or 'issue'  
  number INTEGER NOT NULL,      -- PR/issue number
  title TEXT NOT NULL,
  body TEXT,
  diff_summary TEXT,            -- first 2000 chars of diff for PRs
  embedding TEXT NOT NULL,      -- JSON array of floats
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(repo, type, number)
);

CREATE TABLE analyses (
  id INTEGER PRIMARY KEY,
  repo TEXT NOT NULL,
  type TEXT NOT NULL,
  number INTEGER NOT NULL,
  duplicates TEXT,              -- JSON array of {number, similarity}
  vision_score REAL,            -- 0-1 alignment score
  vision_reasoning TEXT,
  recommendation TEXT,          -- 'approve', 'review', 'reject'
  pr_quality_score REAL,        -- 0-1 for best-PR selection
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(repo, type, number)
);
```

### Webhook Events
- `pull_request.opened` — full analysis (embed, dedup, vision check, quality score)
- `pull_request.edited` — re-embed and re-analyze
- `issues.opened` — embed and dedup (no vision check for issues)
- `issues.edited` — re-embed and re-dedup

### File Structure
```
prguard/
├── src/
│   ├── index.ts              — Probot app entry, webhook handlers
│   ├── embed.ts              — OpenAI embedding generation
│   ├── dedup.ts              — Cosine similarity, duplicate detection
│   ├── vision.ts             — Vision doc enforcement via LLM
│   ├── quality.ts            — PR quality scoring
│   ├── comment.ts            — GitHub comment formatting
│   ├── labels.ts             — Label management
│   ├── db.ts                 — SQLite setup and queries
│   └── config.ts             — Load .github/prguard.yml
├── test/
│   ├── dedup.test.ts
│   ├── vision.test.ts
│   ├── quality.test.ts
│   └── integration.test.ts
├── .github/
│   └── prguard.example.yml   — Example config
├── CLAUDE.md                 — Agent instructions for this codebase
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

### Key Design Decisions
1. **SQLite over Supabase for MVP** — Zero infra cost, runs anywhere, easy to migrate later.
   Vector search at <10K items is fast enough with brute-force cosine similarity.
2. **Probot framework** — Battle-tested for GitHub Apps, handles OAuth, webhooks, API.
   Alternative: raw Octokit + Express, but Probot saves days of boilerplate.
3. **text-embedding-3-small** — $0.02/1M tokens. At 500 PRs/day, ~$0.01/day. Negligible.
4. **GPT-4o-mini for vision** — $0.15/1M input tokens. Vision check ~1K tokens/PR = ~$0.08/day at 500 PRs.
5. **Comment, don't block** — MVP comments and labels. Never auto-close or auto-reject.
   Maintainers decide. Lower risk, faster adoption.
6. **Diff summary, not full diff** — Embed title + body + first 2000 chars of diff.
   Full diffs can be huge; summary captures intent.

### Config Format (.github/prguard.yml)
```yaml
# PRGuard configuration
vision: |
  OpenClaw is a personal AI assistant platform. 
  We accept: bug fixes, performance improvements, new skills, documentation.
  We reject: unrelated features, breaking API changes without discussion,
  AI-generated PRs that don't follow CONTRIBUTING.md.

duplicate_threshold: 0.85  # cosine similarity threshold
vision_model: gpt-4o-mini  # or gpt-4o for deeper review
labels:
  duplicate: "prguard:duplicate"
  off_scope: "prguard:off-scope"  
  on_track: "prguard:on-track"
  recommended: "prguard:recommended"

# Optional: skip analysis for trusted contributors
trusted_users:
  - steipete
  - dependabot[bot]
```

## Success Criteria
1. Install on a test repo, open 3 similar PRs → correctly identifies duplicates
2. Open a PR that contradicts vision doc → correctly flags as off-scope
3. Open 3 duplicate PRs with varying quality → correctly recommends best one
4. Full test suite passes
5. README with setup instructions
6. Can be installed as GitHub App from marketplace (or self-hosted)

## Build Order
1. Project scaffolding (package.json, tsconfig, vitest)
2. CLAUDE.md (agent instructions)
3. SQLite + embedding storage
4. Dedup engine (embed + cosine similarity)
5. Vision enforcement
6. PR quality scoring
7. Comment formatting + label management
8. Probot webhook handlers (tie it all together)
9. Tests
10. README + example config
11. Demo on a test repo
