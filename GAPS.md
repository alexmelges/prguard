# GAPS.md — steipete Tweet Gap Analysis

## The Tweet (792K views, Feb 15 2026)
> PRs on OpenClaw are growing at an *impossible* rate.
> I need AI that scans every PR and Issue and de-dupes.
> It should also detect which PR is the best based on various signals (so really also a deep review is needed)
> Ideally it should also have a vision document to mark/reject PRs that stray too far.

## Feature Map

| steipete wants | PRGuard has | Score | Gap |
|---|---|---|---|
| Scan every PR and Issue | ✅ Probot webhooks on open/edit/reopen | 10/10 | — |
| De-dupe | ✅ Embeddings + cosine similarity | 8/10 | Need to test at 3000+ PR scale |
| Detect best PR (deep review) | ✅ LLM code review + weighted scoring | 9/10 | GPT-4o-mini reviews full diffs, cross-PR comparison, cached in DB |
| Vision document | ✅ .github/prguard.yml + GPT-4o-mini | 9/10 | Vision now sees full diff (up to max_diff_tokens * 4 chars) |
| "Even assisting would help" | ✅ Comments + labels, no auto-close | 9/10 | Good — advisory not authoritative |

## Remaining Gaps

### 1. Scale (untested at 3000+ PRs)
- Backfill CLI exists but not tested at scale
- `listEmbeddings` limited to 500 — what about repo with 3000 issues?
- Embedding storage: 1536 floats × 3000 items = ~18MB in SQLite — should be fine
- Cosine similarity loop over 500 items per PR = manageable
- Consider SQL-side nearest-neighbor for very large repos

### 2. Cross-PR Comparison Depth
When duplicates exist, comparison uses stored reviews. If a duplicate PR was analyzed before code review existed, the comparison will be shallow. Re-running backfill would fix this.

## Closed Gaps

- ~~Deep Code Review~~ ✅ LLM-powered review in `src/review.ts`
- ~~Full Diff Access for Vision~~ ✅ Vision now gets same expanded diff as code review
- ~~PR Reopened Events~~ ✅ `pull_request.reopened` handler + `reactivateEmbedding()`
- ~~Cross-PR Comparison Comment~~ ✅ `buildCrossComparison()` in comments
