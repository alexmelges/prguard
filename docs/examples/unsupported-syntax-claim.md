# `readiness/unsupported-syntax-claim` — Examples

> This rule scans **all** provided file contents (not just the diff) for
> syntax references in docs/config files that lack a corresponding resolver
> in the implementation. It catches pre-existing unsupported claims that a
> PR may unknowingly depend on.

---

## ✅ True Positive — Config doc references `${env:...}` with no resolver

**File: `docs/setup.md` (full content):**

```markdown
## Configuration

Set your database URL using environment substitution:

    database_url: ${env:DATABASE_URL}
```

**Implementation files (`src/config.ts`):**

```ts
// Reads process.env directly — no ${env:...} prefix parser
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://localhost/dev",
};
```

**Result:** PRGuard flags `readiness/unsupported-syntax-claim`:

> Found **${env:...} namespaced substitution** references (`${env:DATABASE_URL}`)
> in `docs/setup.md` but no corresponding resolver in the implementation.

**Why it's correct:** The `${env:...}` syntax is documented but nothing in the
codebase actually parses that pattern. Anyone (human or agent) following the
docs will get a broken config.

---

## ✅ True Positive — YAML config uses `op://` but no 1Password integration

**File: `config/defaults.yml`:**

```yaml
secrets:
  api_key: op://Production/API/credential
```

**Implementation:** No file matches `op://`, `OnePasswordProvider`, or
`resolve1Password`.

**Result:** Flagged. The config references a 1Password path that nothing
in the code can resolve.

---

## ✅ True Positive — Multiple providers, partial support

**File: `docs/secrets.md`:**

```markdown
Supported secret providers:

- `${env:VAR}` — environment variables
- `${vault:secret/data/db#password}` — HashiCorp Vault
- `${ssm:/prod/db-password}` — AWS SSM Parameter Store
```

**Implementation (`src/secrets.ts`):**

```ts
// Only env resolver exists
export function resolveSecret(ref: string): string {
  const envMatch = ref.match(/^\$\{env:(\w+)\}$/);
  if (envMatch) return process.env[envMatch[1]] ?? "";
  throw new Error(`Unknown secret reference: ${ref}`);
}
```

**Result:** Two suggestions fired:
1. `${vault:...}` — no Vault resolver found
2. `${ssm:...}` — no SSM resolver found

The `${env:...}` reference is **not** flagged because the implementation
contains a matching resolver (`resolveSecret` with env pattern).

*Wait — actually PRGuard's `implEvidence` regex for `${env:...}` looks for
`parseEnvSubstitution`, `resolveEnvPrefix`, `envPrefix`, or literal `${env:`
in the code. The `resolveSecret` function above does contain `${env:` as a
string literal in the regex, so it **would** match and correctly suppress
the env finding.*

---

## ❌ False Positive (suppressed) — Resolver exists in implementation

**File: `docs/config.md`:**

```markdown
Use `${keyring:my-app/db-password}` for OS keychain integration.
```

**File: `src/keyring-provider.ts`:**

```ts
export class KeyringProvider {
  async resolve(ref: string): Promise<string> {
    // ... keychain access logic
  }
}
```

**Result:** **Not flagged.** The `implEvidence` regex for keyring matches
`KeyringProvider` in the implementation file.

---

## ❌ False Positive (suppressed) — Roadmap file path

**File: `docs/roadmap.md`:**

```markdown
## Q3 Goals

- Add `${vault:...}` secret provider support
- Integrate `op://` for 1Password
```

**Result:** **Not flagged.** The file path matches the roadmap pattern
(`/roadmap/i`), so it is excluded from syntax-claim scanning entirely.

---

## ❌ False Positive (suppressed) — Code fence in docs

**File: `docs/architecture.md`:**

````markdown
The resolver interface looks like this:

```yaml
# Hypothetical example — not implemented yet
database:
  password: ${vault:secret/data/db#pass}
```
````

**Result:** **Not flagged.** Content inside fenced code blocks is stripped
before pattern matching.

---

## ❌ False Positive (suppressed) — Planned-language lines

**File: `docs/config.md`:**

```markdown
## Secret Providers

Currently supported: `${env:VAR}`

Coming soon: `${ssm:/path}` for AWS SSM integration (planned for v2.0)
```

**Result:** Only `${env:...}` is scanned (and presumably supported). The
`${ssm:...}` line is stripped because it contains "coming soon" and "planned".

---

## Key Differences from `docs-vs-code-drift`

| Aspect | `docs-vs-code-drift` | `unsupported-syntax-claim` |
|--------|---------------------|---------------------------|
| **Scope** | Only diff-added lines | Full file contents |
| **When it fires** | PR adds new claims | Pre-existing claims in repo |
| **Requires** | Diff text | `fileContents` map |
| **Use case** | Catch new drift as it's introduced | Catch inherited/stale claims |
