# PRGuard Webhook & API Contract

> **Audience:** Agents and integrators consuming or sending webhooks to PRGuard.
> **Version:** 0.1.0 — matches PRGuard `package.json` version.

---

## Table of Contents

1. [Overview](#overview)
2. [Webhook Events](#webhook-events)
3. [Webhook Payload Schema](#webhook-payload-schema)
4. [Authentication & Signature Verification](#authentication--signature-verification)
5. [Idempotency](#idempotency)
6. [Error Codes](#error-codes)
7. [Retry & Backoff Semantics](#retry--backoff-semantics)
8. [Rate Limiting](#rate-limiting)
9. [Request / Response Examples](#request--response-examples)

---

## Overview

PRGuard is a [Probot](https://probot.github.io/)-based GitHub App. It receives **GitHub webhook events** at:

```
POST /api/github/webhooks
```

PRGuard does **not** expose a custom REST API for external callers — all interaction flows through GitHub webhooks. This document specifies the contract for those webhooks and the deterministic behaviors agents can rely on.

---

## Webhook Events

PRGuard subscribes to the following GitHub webhook events:

| Event | Action(s) | What PRGuard Does |
|---|---|---|
| `pull_request` | `opened`, `edited`, `synchronize`, `reopened` | Embed → Deduplicate → Quality score → Vision evaluation → Label → Comment |
| `pull_request` | `closed` | Deactivate embedding (soft-delete) |
| `issues` | `opened`, `edited`, `reopened` | Embed → Deduplicate → Label → Comment |
| `issues` | `closed` | Deactivate embedding (soft-delete) |
| `issue_comment` | `created` | Slash-command handling (e.g., `/prguard rescan`) |

### Event Filtering

- **Bot PRs** are skipped when `skip_bots: true` (default). Detected via `[bot]` suffix on login or known bot names (Dependabot, Renovate, etc.).
- **Issues with `pull_request` key** are ignored in the `issues` handler to avoid double-processing.

---

## Webhook Payload Schema

PRGuard consumes standard [GitHub webhook payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads). No custom payload extensions are required.

### Key Fields Consumed

**`pull_request` event:**

```jsonc
{
  "action": "opened",              // string — trigger action
  "pull_request": {
    "number": 42,                  // integer — PR number
    "title": "Add feature X",     // string — used for embedding
    "body": "Description...",      // string | null — used for embedding
    "additions": 120,              // integer — quality scoring
    "deletions": 30,               // integer — quality scoring
    "changed_files": 5,            // integer — quality scoring
    "user": {
      "login": "contributor",      // string — bot detection, contributor history
      "type": "User"               // string — "User" or "Bot"
    },
    "head": {
      "sha": "abc123..."          // string — CI status lookup
    }
  },
  "repository": {
    "name": "my-repo",            // string
    "owner": { "login": "org" }   // string
  },
  "installation": {
    "id": 12345                    // integer — rate-limit scoping
  }
}
```

**`issues` event:**

```jsonc
{
  "action": "opened",
  "issue": {
    "number": 99,
    "title": "Bug report",
    "body": "Steps to reproduce...",
    "pull_request": null,           // must be null (otherwise skipped)
    "user": {
      "login": "reporter",
      "type": "User"
    }
  },
  "repository": {
    "name": "my-repo",
    "owner": { "login": "org" }
  },
  "installation": {
    "id": 12345
  }
}
```

**`issue_comment` event:**

```jsonc
{
  "action": "created",
  "comment": {
    "body": "/prguard rescan",    // string — checked for slash commands
    "user": { "login": "maintainer" }
  },
  "issue": {
    "number": 42,
    "pull_request": { "url": "..." }  // present = PR comment
  },
  "repository": {
    "name": "my-repo",
    "owner": { "login": "org" }
  }
}
```

---

## Authentication & Signature Verification

GitHub signs every webhook delivery with HMAC-SHA256. PRGuard (via Probot) **automatically verifies** the signature before processing.

### How It Works

1. GitHub computes: `HMAC-SHA256(WEBHOOK_SECRET, raw_body)`
2. Sends the signature in the `X-Hub-Signature-256` header as `sha256=<hex_digest>`
3. Probot compares the signature using timing-safe comparison
4. **Requests with invalid or missing signatures are rejected with `400`**

### Agent Implications

- If you relay webhooks through a proxy (e.g., smee.io for dev), the signature is preserved — no re-signing needed.
- If you **construct** webhook requests manually, you must sign the raw JSON body with the same `WEBHOOK_SECRET` configured in PRGuard.

```bash
# Example: compute signature for a payload
echo -n '{"action":"opened",...}' | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET"
# → sha256=a1b2c3d4...

# Send with header:
curl -X POST https://prguard.example.com/api/github/webhooks \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=a1b2c3d4..." \
  -H "X-GitHub-Event: pull_request" \
  -d @payload.json
```

---

## Idempotency

PRGuard is **idempotent by design**. Processing the same event multiple times produces the same outcome.

### Idempotency Keys

| Resource | Key | Behavior |
|---|---|---|
| **Embeddings** | `(repo, type, number)` | `INSERT OR REPLACE` — re-processing overwrites the embedding |
| **Analysis records** | `(repo, type, number)` | `INSERT OR REPLACE` — re-analysis overwrites previous results |
| **Code reviews** | `(repo, number)` | `INSERT OR REPLACE` — re-review overwrites |
| **Summary comments** | `(repo, number, bot_login)` | PRGuard finds its existing comment by author and updates it (edit, not create) |
| **Labels** | `(repo, number, label_name)` | GitHub's label API is naturally idempotent — adding an existing label is a no-op |

### Guarantees

- **No duplicate comments.** PRGuard searches for its own prior comment and updates in-place via `PATCH`.
- **No duplicate labels.** Labels are applied additively; GitHub ignores already-present labels.
- **Safe to re-deliver.** If GitHub retries a webhook (or you replay one), PRGuard will re-compute and overwrite — not duplicate.

---

## Error Codes

PRGuard uses deterministic HTTP status codes for webhook responses:

| Code | Meaning | Retryable | Agent Action |
|---|---|---|---|
| `200` | Event processed successfully | — | None |
| `202` | Event accepted, processing skipped (bot PR, dry-run, rate-limited) | No | None — intentional skip |
| `400` | Bad request — invalid signature, malformed payload | **No** | Fix payload or signature |
| `404` | Unknown route | **No** | Check URL |
| `429` | Rate limited (installation daily budget or repo hourly budget exceeded) | **Yes** | Retry after reset window (see [Rate Limiting](#rate-limiting)) |
| `500` | Internal error (OpenAI failure, DB error, unexpected exception) | **Yes** | Retry with backoff |
| `502/503` | Upstream unavailable (GitHub API or OpenAI down) | **Yes** | Retry with backoff |

### Error Response Body

Error responses include a JSON body:

```json
{
  "error": "rate_limit_exceeded",
  "message": "Installation 12345 has exceeded the daily budget of 200 calls",
  "retryable": true,
  "retry_after_seconds": 3600
}
```

| Field | Type | Description |
|---|---|---|
| `error` | `string` | Machine-readable error code (snake_case) |
| `message` | `string` | Human-readable description |
| `retryable` | `boolean` | Whether the request can be retried |
| `retry_after_seconds` | `integer \| null` | Suggested wait time (when applicable) |

### Error Code Catalog

| `error` value | HTTP Status | Description |
|---|---|---|
| `invalid_signature` | 400 | HMAC signature verification failed |
| `malformed_payload` | 400 | Required fields missing or wrong type |
| `rate_limit_exceeded` | 429 | Daily or hourly budget exhausted |
| `openai_error` | 500 | OpenAI API call failed after retries |
| `database_error` | 500 | SQLite write/read failure |
| `github_api_error` | 502 | GitHub API returned non-retryable error |
| `internal_error` | 500 | Unexpected exception |

---

## Retry & Backoff Semantics

### GitHub API Retries (Outbound)

When PRGuard calls the GitHub API and receives a retryable error, it uses exponential backoff:

| Attempt | Delay | Condition |
|---|---|---|
| 1 | 1 second | On 403, 429, or 5xx |
| 2 | 5 seconds | On 403, 429, or 5xx |
| 3 | 30 seconds | On 403, 429, or 5xx |
| 4 | — | **Give up, propagate error** |

- If the response includes a `Retry-After` header, that value (in seconds) is used instead of the fixed delay.
- Total max retry time: **36 seconds** (1 + 5 + 30).

### Webhook Delivery Retries (Inbound — GitHub's Behavior)

GitHub retries webhook deliveries on failure:

- **Timeout:** GitHub expects a response within **10 seconds**.
- **Retries:** GitHub retries failed deliveries up to **3 times** with increasing delays.
- **Safe for PRGuard:** Because PRGuard is idempotent, retried deliveries are harmless.

### Agent Retry Recommendations

If you are programmatically triggering PRGuard (e.g., via GitHub API to create a PR):

1. **Don't retry the webhook yourself** — GitHub handles delivery retries.
2. **If replaying webhooks manually**, use exponential backoff: `1s → 2s → 4s → 8s → max 60s`.
3. **Check `retryable` field** in error responses before retrying.
4. **Honor `retry_after_seconds`** when present.

---

## Rate Limiting

PRGuard enforces two rate-limit tiers:

| Tier | Scope | Default Budget | Window |
|---|---|---|---|
| **Installation** | Per GitHub App installation | `daily_limit` (configurable, default in `.prguard.yml`) | 24 hours (rolling) |
| **Repository** | Per repo within an installation | 10 calls | 1 hour (rolling) |

### Rate Limit Headers

Responses include rate-limit information:

```
X-PRGuard-RateLimit-Remaining: 42
X-PRGuard-RateLimit-Reset: 1703275200
```

### When Rate-Limited

- PRGuard returns `202 Accepted` with a skip reason (the event is acknowledged but not fully processed).
- No labels or comments are posted.
- The event can be replayed later when budget resets.

---

## Request / Response Examples

### Example 1: Successful PR Analysis

**Request** (from GitHub):

```http
POST /api/github/webhooks HTTP/1.1
Host: prguard.example.com
Content-Type: application/json
X-GitHub-Event: pull_request
X-GitHub-Delivery: 72d3162e-cc78-11e3-81ab-4c9367dc0958
X-Hub-Signature-256: sha256=d57c68ca6f92289e6987922ff26938930f6e66a2d161ef06abdf1859230aa23c

{
  "action": "opened",
  "number": 42,
  "pull_request": {
    "number": 42,
    "title": "Add Redis caching layer",
    "body": "This PR adds Redis caching to reduce DB load...",
    "additions": 245,
    "deletions": 12,
    "changed_files": 8,
    "user": { "login": "alice", "type": "User" },
    "head": { "sha": "abc123def456" }
  },
  "repository": {
    "name": "my-app",
    "owner": { "login": "my-org" }
  },
  "installation": { "id": 12345 }
}
```

**Response:**

```http
HTTP/1.1 200 OK
Content-Type: application/json
X-PRGuard-RateLimit-Remaining: 195

{
  "status": "processed",
  "repo": "my-org/my-app",
  "number": 42,
  "type": "pr",
  "duplicates_found": 1,
  "quality_score": 7.8,
  "vision_aligned": true,
  "labels_applied": ["on-track"],
  "comment_action": "created"
}
```

### Example 2: Duplicate Issue Detected

**Request** (from GitHub):

```http
POST /api/github/webhooks HTTP/1.1
X-GitHub-Event: issues
X-Hub-Signature-256: sha256=...

{
  "action": "opened",
  "issue": {
    "number": 99,
    "title": "App crashes on login",
    "body": "When I try to log in, the app crashes with error...",
    "pull_request": null,
    "user": { "login": "bob", "type": "User" }
  },
  "repository": { "name": "my-app", "owner": { "login": "my-org" } },
  "installation": { "id": 12345 }
}
```

**Response:**

```http
HTTP/1.1 200 OK

{
  "status": "processed",
  "repo": "my-org/my-app",
  "number": 99,
  "type": "issue",
  "duplicates_found": 2,
  "duplicate_matches": [
    { "type": "issue", "number": 45, "similarity": 0.92, "title": "Login crash on iOS" },
    { "type": "issue", "number": 67, "similarity": 0.87, "title": "App crash during authentication" }
  ],
  "labels_applied": ["duplicate"],
  "comment_action": "created"
}
```

### Example 3: Rate-Limited Request

**Response:**

```http
HTTP/1.1 202 Accepted

{
  "status": "skipped",
  "reason": "rate_limit_exceeded",
  "message": "Installation 12345 has exceeded the daily budget",
  "retry_after_seconds": 1800
}
```

### Example 4: Bot PR Skipped

**Response:**

```http
HTTP/1.1 202 Accepted

{
  "status": "skipped",
  "reason": "bot_pr",
  "message": "PR #43 by dependabot[bot] skipped (skip_bots=true)"
}
```

### Example 5: Invalid Signature

**Response:**

```http
HTTP/1.1 400 Bad Request

{
  "error": "invalid_signature",
  "message": "X-Hub-Signature-256 verification failed",
  "retryable": false,
  "retry_after_seconds": null
}
```

---

## Dashboard & Metrics Endpoints

PRGuard also exposes read-only endpoints (no authentication required by default):

| Endpoint | Method | Description |
|---|---|---|
| `/dashboard` | GET | HTML dashboard with stats and recent activity |
| `/metrics` | GET | Prometheus-format metrics |
| `/healthz` | GET | Health check — returns `200 OK` |

---

## Configuration Reference

Per-repo configuration lives in `.prguard.yml` at the repository root:

```yaml
# .prguard.yml
vision: "This project focuses on performance and security. Reject cosmetic-only changes."
duplicate_threshold: 0.85        # cosine similarity threshold (0.0–1.0)
vision_model: "gpt-4o-mini"     # LLM for vision evaluation
review_model: "gpt-4o-mini"     # LLM for code review
quality_thresholds:
  approve: 7                     # auto-approve above this score
  reject: 3                      # flag for rejection below this score
max_diff_lines: 1000            # max diff lines to embed
max_diff_tokens: 4000           # max tokens for review
daily_limit: 200                # OpenAI calls per installation per day
dry_run: false                  # true = analyze but don't post comments/labels
skip_bots: true                 # skip bot-authored PRs
deep_review: false              # enable detailed code review
trusted_users:                  # users whose PRs skip vision check
  - "maintainer1"
labels:
  duplicate: "duplicate"
  off_scope: "off-scope"
  on_track: "on-track"
  needs_review: "needs-review"
  recommended: "recommended"
```

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-02-21 | 0.1.0 | Initial contract documentation |
