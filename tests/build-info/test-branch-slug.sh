#!/bin/bash
set -euo pipefail

# test-branch-slug.sh — unit test for BranchSlug.compute.
#
# Concatenates the canonical Swift source (tugapp/Sources/BranchSlug.swift)
# with the test driver (tests/build-info/test-driver.swift) and runs the
# pair through the Swift interpreter via `swift -`. This avoids adding an
# XCTest bundle to the Xcode project while still testing the *actual*
# implementation the app builds against — no algorithm duplication.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SLUG_SRC="$REPO_ROOT/tugapp/Sources/BranchSlug.swift"
DRIVER="$SCRIPT_DIR/test-driver.swift"

if [ ! -f "$SLUG_SRC" ]; then
    echo "error: $SLUG_SRC not found" >&2
    exit 1
fi
if [ ! -f "$DRIVER" ]; then
    echo "error: $DRIVER not found" >&2
    exit 1
fi

cat "$SLUG_SRC" "$DRIVER" | swift -
