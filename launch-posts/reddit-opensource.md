# Title: I built a GitHub App to fight the AI PR flood — duplicate detection, quality scoring, auto-labeling

# Subreddits: r/opensource, r/github, r/selfhosted

Hey everyone,

If you maintain an open source project, you've probably noticed the wave of AI-generated PRs and issues. curl dropped their bug bounty because useful reports went from 15% to 5%. GitHub literally added a feature to disable PRs entirely.

I built **PRGuard** — a GitHub App that automatically triages incoming PRs and issues:

- **Duplicate detection** via embeddings (catches semantically similar PRs, not just exact title matches)
- **LLM code review** with quality scoring (diff coherence, tests, commit messages)
- **Vision alignment** — define your project's goals in `.github/prguard.yml`, PRGuard checks if PRs match
- **Auto-labeling** — `duplicate`, `off-scope`, `needs-review`, `recommended`
- **Best-PR recommendation** — when 3 people submit the same fix, tells you which one is cleanest

One summary comment per PR. No notification spam.

It's self-hostable (Docker, Railway, Fly.io), MIT licensed, and supports BYOK (bring your own OpenAI key) per repo.

**Install:** https://github.com/apps/prguard-bot/installations/new
**Source:** https://github.com/alexmelges/prguard

Would love feedback from fellow maintainers. What signals do you use to triage PRs?
