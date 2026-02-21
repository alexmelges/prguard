# Greptile-Style PR Checklist (Pre-Publish)

## Semantic gate
- [ ] Docs claims are backed by implementation today.
- [ ] No unsupported syntax in docs/examples.
- [ ] Contract examples match runtime behavior.

## Reliability gate
- [ ] Deterministic error schema (no ad-hoc error text-only responses).
- [ ] Retry/backoff and idempotency semantics are explicit.
- [ ] Security-sensitive paths have tests.

## Parity gate
- [ ] Any policy/config changes are mirrored in all runtime surfaces.
- [ ] No unused config constants/flags.

## Review gate
- [ ] Triage all review-bot comments before replying.
- [ ] Avoid premature confidence language.
- [ ] Use `gh ... --body-file` for PR comments.

## Build gate
- [ ] lint
- [ ] tests
- [ ] build/docs checks

If any gate fails, keep PR in draft.
