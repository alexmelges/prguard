#!/usr/bin/env bash
set -euo pipefail

echo "==> Pre-publish PR checks"

echo "==> lint/typecheck"
npm run lint

echo "==> tests"
npm run test

echo "==> build"
npm run build

if [ -d docs ]; then
  echo "==> docs parity grep"
  if rg -n '\$\{env:|\$\{keyring:|op://' docs >/tmp/pr_docs_parity_hits.txt; then
    echo "❌ Found potentially unsupported/over-claimed secret syntax in docs:"
    cat /tmp/pr_docs_parity_hits.txt
    echo "If intentional roadmap mention, mark clearly as planned/unimplemented."
    exit 1
  fi
fi

echo "✅ pre-publish checks passed"
echo "Tip: use safe PR comments: gh pr comment <num> --body-file /path/to/comment.md"
