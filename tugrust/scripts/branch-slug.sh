#!/bin/bash
set -euo pipefail

# branch-slug.sh — canonical bash implementation of the branch-name
# slug algorithm. The single source of truth for the bash side.
#
# Usage:
#   branch-slug.sh <branch>
#
# Prints the slug to stdout. No trailing newline (avoids surprises
# when the caller interpolates the output).
#
# Algorithm (must stay in sync with `BranchSlug.compute` in
# `tugapp/Sources/BranchSlug.swift`):
#   1. lowercase
#   2. replace every char not in [a-z0-9] with `-`
#   3. collapse runs of `-`
#   4. trim leading/trailing `-`
#
# Parity with the Swift implementation is verified on every commit
# touching either side by `tests/build-info/test-slug-parity.sh`.
#
# `LC_ALL=C` forces byte-level (not locale-collated) semantics so
# the bash and Swift versions agree on multibyte input — both
# treat each non-ASCII byte as a non-slug character.

if [ "$#" -ne 1 ]; then
    echo "usage: $(basename "$0") <branch>" >&2
    exit 2
fi

printf '%s' "$1" \
    | LC_ALL=C tr '[:upper:]' '[:lower:]' \
    | LC_ALL=C sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
