# Show HN: PRGuard – AI triage for GitHub PRs (duplicate detection, quality scoring, vision alignment)

I built PRGuard because I got tired of manually reviewing the flood of low-quality PRs hitting open source repos. Since the "Eternal September of open source" (GitHub's own term), maintainers are drowning in AI-generated PRs that are often duplicates, off-scope, or just bad.

PRGuard is a GitHub App that automatically:

- **Detects duplicates** using embeddings + cosine similarity (not just title matching)
- **Reviews code** with LLM-powered quality scoring (diff coherence, test coverage, commit hygiene)
- **Checks vision alignment** — does this PR match your project's goals?
- **Recommends the best PR** when duplicates exist
- **Auto-labels** everything: `duplicate`, `off-scope`, `on-track`, `needs-review`, `recommended`

It posts a single summary comment with all findings, so you can make a decision in seconds instead of minutes.

**Self-hostable** (Docker/Railway/Fly.io), per-repo config via `.github/prguard.yml`, BYOK (bring your own OpenAI key), rate limiting built in.

Install: https://github.com/apps/prguard-bot/installations/new
Code: https://github.com/alexmelges/prguard
