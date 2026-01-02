#!/bin/bash
# Validate markdown: lint + check cross-links
# Usage: ./scripts/check-docs.sh [--fix]
set -e
cd "$(dirname "$0")/.."

FILES=("docs/**/*.md" "grid-cli/README.md" "README.md")

# Lint
if [[ "$1" == "--fix" ]]; then
  npx --yes markdownlint-cli2 --fix "${FILES[@]}"
else
  npx --yes markdownlint-cli2 "${FILES[@]}"
fi

# Check cross-links
grep -roh '\]([^)]*\.md[^)]*)' docs grid-cli/README.md README.md 2>/dev/null | \
  sed 's/](//' | sed 's/)$//' | sed 's/#.*//' | sort -u | \
  while read -r link; do
    [[ -f "$link" || -f "docs/$link" || -f "docs/api/$link" ]] || echo "Broken: $link"
  done | grep -q . && exit 1 || echo "Links OK"
