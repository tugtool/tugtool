#!/usr/bin/env bash
# check-legacy-tokens.sh — CI enforcement for legacy token naming (Spec S02)
#
# Greps for legacy token patterns in tugdeck/src/ and tugdeck/styles/.
# Exits 0 if clean, exits 1 if any violations found.
#
# Exclusions:
#   - This script itself (check-legacy-tokens.sh)
#   - Lines containing /* legacy-token-allowlist */ marker comment

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TUGDECK_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SRC_DIR="$TUGDECK_ROOT/src"
STYLES_DIR="$TUGDECK_ROOT/styles"
SELF="$(basename "${BASH_SOURCE[0]}")"

FOUND=0

run_grep() {
  local label="$1"
  local pattern="$2"
  local results

  results=$(grep -rn "$pattern" "$SRC_DIR" "$STYLES_DIR" \
    --include="*.css" --include="*.ts" --include="*.tsx" \
    | grep -v "$SELF" \
    | grep -v "legacy-token-allowlist" \
    || true)

  if [ -n "$results" ]; then
    echo "FAIL [$label]: Found legacy pattern '$pattern':"
    echo "$results"
    FOUND=1
  fi
}

# Pattern 1: legacy semantic token prefix
run_grep "--td-" '\-\-td-'

# Pattern 2: legacy Tier 1 palette prefix
run_grep "--tways-" '\-\-tways-'

# Pattern 3: banned --tug-comp-* prefix (replaced by --tug-<component>-* per [D05])
run_grep "--tug-comp-" '\-\-tug-comp-'

# Pattern 3: legacy short-name alias definitions (as property definitions, not values)
SHORTNAME_PATTERNS=(
  '\-\-background:'
  '\-\-foreground:'
  '\-\-primary:'
  '\-\-secondary:'
  '\-\-accent:'
  '\-\-destructive:'
  '\-\-muted:'
  '\-\-popover:'
  '\-\-ring:'
  '\-\-input:'
  '\-\-chart-1:'
  '\-\-chart-2:'
  '\-\-chart-3:'
  '\-\-chart-4:'
  '\-\-chart-5:'
  '\-\-syntax-keyword:'
  '\-\-syntax-string:'
  '\-\-syntax-number:'
  '\-\-syntax-function:'
  '\-\-syntax-type:'
  '\-\-syntax-variable:'
  '\-\-syntax-comment:'
  '\-\-syntax-operator:'
  '\-\-syntax-punctuation:'
  '\-\-syntax-constant:'
  '\-\-syntax-decorator:'
  '\-\-syntax-tag:'
  '\-\-syntax-attribute:'
)

for pattern in "${SHORTNAME_PATTERNS[@]}"; do
  run_grep "short-name alias" "$pattern"
done

if [ "$FOUND" -eq 0 ]; then
  echo "OK: No legacy token patterns found."
  exit 0
else
  echo ""
  echo "FAIL: Legacy token violations detected. Migrate to --tug-base-* or --tug-<component>-* naming."
  exit 1
fi
