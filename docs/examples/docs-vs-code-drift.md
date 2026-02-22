# `readiness/docs-vs-code-drift` — Examples

> This rule fires when a PR adds documentation claiming syntax or provider
> support that cannot be found in the implementation.

---

## ✅ True Positive — Docs claim `${env:VAR}` but code only supports `${VAR}`

**Scenario:** A PR adds a README section documenting `${env:DB_HOST}` syntax,
but the implementation only reads `process.env.DB_HOST` — there is no
`${env:...}` resolver.

**Diff (added lines in `docs/config.md`):**

```diff
+## Variable Substitution
+
+Use `${env:DB_HOST}` and `${env:DB_PORT}` to inject environment variables
+into your configuration file.
```

**Implementation (`src/config.ts`):**

```ts
// Only plain process.env — no ${env:...} prefix resolver exists
const host = process.env.DB_HOST ?? "localhost";
const port = process.env.DB_PORT ?? "5432";
```

**Result:** PRGuard flags `readiness/docs-vs-code-drift` with message:

> Docs claim **${env:VAR} substitution syntax** support (`${env:DB_HOST}`)
> but no matching implementation was found.

**Why it's correct:** An agent or user following the docs would write
`${env:DB_HOST}` in their config file and get a literal string instead of
the resolved value. The docs are misleading.

---

## ✅ True Positive — Docs reference `op://` but no 1Password resolver exists

**Diff (added lines in `README.md`):**

```diff
+### Secrets
+
+Point your config to 1Password: `op://Vault/Database/password`
```

**Implementation:** No file contains `op://`, `OnePasswordProvider`, or
`resolve1Password`.

**Result:** Flagged. The docs promise 1Password integration that doesn't exist.

---

## ❌ False Positive (suppressed) — Code fence examples

**Diff (added lines in `docs/syntax-reference.md`):**

````diff
+Here is the full syntax reference:
+
+```yaml
+# Example — not currently supported
+database:
+  password: ${keyring:my-service/db-password}
+```
````

**Result:** **Not flagged.** PRGuard strips fenced code blocks before scanning,
so illustrative examples inside triple-backtick fences are ignored.

---

## ❌ False Positive (suppressed) — Planned/roadmap language

**Diff (added lines in `docs/roadmap.md`):**

```diff
+## Planned Features
+
+- Coming soon: `${env:VAR}` namespaced substitution support
```

**Result:** **Not flagged.** Lines containing "coming soon", "planned",
"roadmap", "future", or "todo" are excluded. Additionally, files whose path
matches roadmap/proposal/RFC patterns are skipped entirely.

---

## ❌ False Positive (suppressed) — Implementation exists in same PR

**Diff (added lines in `docs/config.md`):**

```diff
+Use `${env:API_KEY}` to inject secrets.
```

**Diff (added lines in `src/resolver.ts`):**

```diff
+export function parseEnvSubstitution(value: string): string {
+  return value.replace(/\$\{env:(\w+)\}/g, (_, key) => process.env[key] ?? "");
+}
```

**Result:** **Not flagged.** PRGuard detects `parseEnvSubstitution` in the
non-docs portion of the diff and considers the claim supported.

---

## ❌ False Positive (suppressed) — Mixed PR with unverifiable impl

**Scenario:** The PR changes both `docs/config.md` (adding `${env:...}`
references) and `src/resolver.ts`, but `fileContents` was not provided
to the linter.

**Result:** **Not flagged.** When implementation file contents are unavailable
and the PR includes non-docs changes, the rule stays silent rather than risk
a false positive.
