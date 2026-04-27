#!/usr/bin/env bash
#
# rename-m-to-at.sh — One-shot rename script for the M-tag → AT-tag
# transition documented in `roadmap/tugplan-app-test-cleanup.md`.
#
# Performs the mechanical pieces of the cleanup:
#
#   1. Directory rename:  tests/in-app/      → tests/app-test/
#   2. Test-file rename:  m{NN}-*.test.ts    → at{NNNN}-*.test.ts
#   3. Smoke relocation:  _smoke*.test.ts    → harness-smoke/<name>.test.ts
#                         (drops _smoke-app-lifecycle, subsumed by AT0004/AT0005)
#   4. Inventory rename:  tuglaws/m-series-inventory.md
#                         → tuglaws/app-test-inventory.md
#   5. Regex sweep:       [M{NN}] → [AT{NNNN}], m{NN}- → at{NNNN}-,
#                         M-series/M-tag/m-tag → AT-series/AT-tag/at-tag,
#                         tests/in-app → tests/app-test
#
# What it does NOT do (Steps 3, 6, 7 do these by hand):
#
#   - Justfile recipe collapse (test-in-app → app-test, new build-app)
#   - tests/app-test/README.md rewrite
#   - CLAUDE.md naming sweep
#   - .claude/settings.local.json permission update
#   - scripts/setup-dev-signing.sh comment polish
#   - memory/feedback_just_test_in_app_fast.md rename
#   - m-series-reconciliation.md banner
#
# Idempotent: each section guards itself, so re-running the script after
# partial completion produces the same end state.
#
# This script is one-shot — committed in Step 1, deleted in Step 6.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"


# --- Section 1: Directory rename ---------------------------------------
if [ -d tests/in-app ] && [ ! -d tests/app-test ]; then
  echo "==> [1/5] git mv tests/in-app → tests/app-test"
  git mv tests/in-app tests/app-test
elif [ -d tests/app-test ]; then
  echo "==> [1/5] tests/app-test already exists; skipping directory rename"
else
  echo "error: neither tests/in-app nor tests/app-test exists" >&2
  exit 1
fi


# --- Section 2: m{NN}-*.test.ts → at{NNNN}-*.test.ts ------------------
echo "==> [2/5] Renaming m{NN}-*.test.ts → at{NNNN}-*.test.ts"
shopt -s nullglob
for f in tests/app-test/m??-*.test.ts; do
  base="$(basename "$f")"
  num="${base:1:2}"          # NN
  rest="${base:4}"           # everything after "m{NN}-"
  new="tests/app-test/at00${num}-${rest}"
  if [ "$f" != "$new" ]; then
    git mv "$f" "$new"
  fi
done
shopt -u nullglob


# --- Section 3: Smoke-test relocation ---------------------------------
echo "==> [3/5] Relocating smoke tests under tests/app-test/harness-smoke/"
mkdir -p tests/app-test/harness-smoke

shopt -s nullglob
for f in \
    tests/app-test/_smoke.test.ts \
    tests/app-test/_smoke-native.test.ts \
    tests/app-test/_smoke-em.test.ts \
    tests/app-test/_smoke-em-live.test.ts \
    tests/app-test/_smoke-app-reload.test.ts \
    tests/app-test/_smoke-cold-boot.test.ts \
    tests/app-test/_smoke-capture-phase-save.test.ts \
    tests/app-test/_double-connect.test.ts \
    tests/app-test/_log-capture.test.ts \
    tests/app-test/_version-handshake.test.ts \
    tests/app-test/_wait-for-condition.test.ts; do
  base="$(basename "$f")"
  trimmed="${base#_}"        # drop leading underscore
  new="tests/app-test/harness-smoke/${trimmed}"
  if [ "$f" != "$new" ]; then
    git mv "$f" "$new"
  fi
done
shopt -u nullglob

# Drop subsumed file (M04+M05 / AT0004+AT0005 cover its scope).
for path in \
    tests/app-test/_smoke-app-lifecycle.test.ts \
    tests/app-test/harness-smoke/smoke-app-lifecycle.test.ts; do
  if [ -f "$path" ]; then
    git rm "$path"
  fi
done


# --- Section 4: Inventory file rename ---------------------------------
if [ -f tuglaws/m-series-inventory.md ] && [ ! -f tuglaws/app-test-inventory.md ]; then
  echo "==> [4/5] git mv tuglaws/m-series-inventory.md → tuglaws/app-test-inventory.md"
  git mv tuglaws/m-series-inventory.md tuglaws/app-test-inventory.md
else
  echo "==> [4/5] Inventory file already renamed (or source missing); skipping"
fi


# --- Section 5: Regex sweep over tag references -----------------------
echo "==> [5/5] Regex sweep over tag references"

# Excludes:
#   - roadmap/archive/  : historical plans; intentionally untouched.
#   - .tugtool/         : local working state, archived plans, logs.
#   - **/node_modules/  : vendor.
#   - tugrust/target/, tugdeck/dist/ : build artifacts.
#   - scripts/rename-m-to-at.sh : this script (avoid self-mutation).
#   - roadmap/m-series-reconciliation.md : legacy doc kept verbatim
#       per plan's Non-goals; banner added by hand in Step 6.
#   - roadmap/tugplan-app-test-cleanup.md : the plan itself; uses M-
#       prefix in spec text intentionally.
#   - tuglaws/tugplan-skeleton.md : uses `M01` as Milestone anchor
#       (unrelated artifact); excluding prevents false positives.
#   - tugrust/tests/fixtures/valid/complete.md : test fixture using
#       `Milestone M01` syntax; must not be perturbed.

PATHS=()
while IFS= read -r -d '' f; do
  PATHS+=("$f")
done < <(find . -type f \( \
        -name '*.ts' -o -name '*.tsx' \
     -o -name '*.md' \
     -o -name '*.swift' \
     -o -name '*.rs' \
     -o -name '*.sh' \
     -o -name 'Justfile' \) \
  -not -path './roadmap/archive/*' \
  -not -path './.tugtool/*' \
  -not -path './**/node_modules/*' \
  -not -path './tugrust/target/*' \
  -not -path './tugdeck/dist/*' \
  -not -path './scripts/rename-m-to-at.sh' \
  -not -path './roadmap/m-series-reconciliation.md' \
  -not -path './roadmap/tugplan-app-test-cleanup.md' \
  -not -path './tuglaws/tugplan-skeleton.md' \
  -not -path './tugrust/tests/fixtures/valid/complete.md' \
  -print0)

if [ "${#PATHS[@]}" -gt 0 ]; then
  perl -i -pe '
    # Filename prefix: m{NN}-{slug-char} → at00{NN}-{slug-char}.
    # Run BEFORE the [M{NN}] rule so a literal "m01-foo" does not
    # get mangled into "at0001-foo" by the lowercase-tag rule.
    s/\bm([0-9]{2})(-[a-z0-9])/at00$1$2/g;
    # Bare uppercase tag references: M01..M99 → AT0001..AT0099.
    s/\bM([0-9]{2})\b/AT00$1/g;
    # Generic phrasings.
    s/M-series/AT-series/g;
    s/m-series/at-series/g;
    s/M-tags/AT-tags/g;
    s/M-tag/AT-tag/g;
    s/m-tags/at-tags/g;
    s/m-tag/at-tag/g;
    # Path references.
    s{\btests/in-app\b}{tests/app-test}g;
  ' "${PATHS[@]}"
fi


echo
echo "==> Rename script done."
echo
echo "Manual touches still required (see plan Steps 3, 6, 7):"
echo "  - Justfile: collapse test-in-app/test-in-app-fast → app-test + build-app"
echo "  - tests/app-test/README.md: full rewrite"
echo "  - CLAUDE.md: naming sweep"
echo "  - .claude/settings.local.json: 'Bash(test-in-app-fast)' → 'Bash(app-test)'"
echo "  - scripts/setup-dev-signing.sh: comment sweep"
echo "  - memory/feedback_just_test_in_app_fast.md: rename + reword"
echo "  - roadmap/m-series-reconciliation.md: top-of-file banner"
echo "  - tuglaws/app-test-inventory.md: heading + intro paragraph"
