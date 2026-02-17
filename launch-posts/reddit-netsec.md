# Title: PRGuard — automated triage for the AI PR flood (embeddings-based dedup, quality scoring, vision alignment)

# Subreddits: r/netsec, r/cybersecurity

With AI coding agents (Devin, Claude Code, Codex) now submitting PRs at scale, open source maintainers face a supply chain risk: low-quality or malicious PRs slipping through review fatigue.

**PRGuard** is a GitHub App that automates the first pass of PR triage:

**Security-relevant features:**
- Embeddings-based duplicate detection (cosine similarity) — catches coordinated duplicate submissions
- LLM code review catches suspicious patterns in diffs
- Vision alignment flags PRs that don't match project scope (potential supply chain injection)
- All analysis is logged and labeled for audit trail

**Operational features:**
- Per-repo config (`.github/prguard.yml`)
- Rate limiting (daily budget per installation)
- BYOK — repos bring their own OpenAI key
- Self-hostable (Docker) — your data stays on your infra

MIT licensed. Source: https://github.com/alexmelges/prguard

Context: GitHub's "Eternal September" blog post, Socket's AI PR farming report, curl dropping bug bounties. This is a growing problem.
