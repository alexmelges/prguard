# GAPS.md — steipete Tweet Gap Analysis

## The Tweet (792K views, Feb 15 2026)
> PRs on OpenClaw are growing at an *impossible* rate.
> I need AI that scans every PR and Issue and de-dupes.
> It should also detect which PR is the best based on various signals (so really also a deep review is needed)
> Ideally it should also have a vision document to mark/reject PRs that stray too far.

## Feature Map

| steipete wants | PRGuard has | Score | Gap |
|---|---|---|---|
| Scan every PR and Issue | ✅ Probot webhooks on open/edit | 9/10 | Missing: reopen events |
| De-dupe | ✅ Embeddings + cosine similarity | 8/10 | Need to test at 3000+ PR scale |
| Detect best PR (deep review) | ⚠️ Heuristic quality scoring | 5/10 | **No LLM code review** — scores structure not substance |
| Vision document | ✅ .github/prguard.yml + GPT-4o-mini | 8/10 | Works but vision eval is shallow (title+body+diff summary, not full diff) |
| "Even assisting would help" | ✅ Comments + labels, no auto-close | 9/10 | Good — advisory not authoritative |

## Critical Gaps to Close

### 1. Deep Code Review (score 5/10 → target 8/10)
steipete explicitly says "deep review is needed." Our quality scorer checks:
- Diff size, file count (structural)
- Test presence (binary)
- Commit message hygiene (pattern matching)
- Contributor history (API lookup)
- CI status (binary)

What's MISSING:
- **LLM analysis of the actual code changes** — "does this PR do what it claims?"
- **Code quality signals** — does it follow project conventions? Is it well-structured?
- **Comparison across duplicate PRs** — "PR #42 is cleaner than PR #38 because..."

FIX: Add an LLM-powered code review step that reads the diff and produces a substantive assessment. Use this in `pickBestPR` to compare implementations.

### 2. Scale (untested at 3000+ PRs)
- Backfill CLI exists but not tested at scale
- `listEmbeddings` limited to 500 — what about repo with 3000 issues?
- Embedding storage: 1536 floats × 3000 items = ~18MB in SQLite — should be fine
- BUT cosine similarity loop over 500 items per PR = manageable

FIX: Test backfill on a large OSS repo. Consider increasing limit or doing SQL-side nearest-neighbor.

### 3. Full Diff Access for Vision
Currently vision eval only sees title + body + truncated diff summary (2000 chars).
For a real vision check, it should see more of the actual changes.

FIX: Increase diff context for vision eval, or summarize the full diff first then evaluate.

### 4. PR Reopened Events
Missing handler for `pull_request.reopened` — should reactivate deactivated embeddings.

### 5. Cross-PR Comparison Comment
When duplicates exist, the comment should explicitly compare them:
"PR #42 vs PR #38: #42 has tests, smaller diff, and passing CI. Recommend #42."

## Priority Order
1. Deep code review (LLM) — this is steipete's #1 ask after dedup
2. Cross-PR comparison in comments
3. Scale testing
4. Reopen handler
5. Better diff access for vision
