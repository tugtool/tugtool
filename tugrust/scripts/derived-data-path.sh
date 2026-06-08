#!/usr/bin/env bash
# Resolve the per-variant Xcode DerivedData path for the current working
# directory's Tug build identity. Parallel to `product-name-from-cwd.sh`
# and `bundle-id-from-cwd.sh`.
#
# Xcode's *default* DerivedData location is keyed on the `.xcodeproj`
# path, so every build variant of the same project shares one build
# directory — and since they are all the same `Tug` target, building one
# `PRODUCT_NAME` (e.g. `Tug-apptest`) evicts the previously-built product
# of another (`Tug-debug.app`), and vice-versa. Giving each variant its
# own `-derivedDataPath` keeps their build outputs disjoint so an
# app-test build never clobbers a live `app-debug` bundle.
#
# The path is keyed on PRODUCT_NAME (which already encodes the variant
# and honors `TUG_FORCE_BUNDLE_ID`):
#
#   (release, main)        → …/DerivedData/Tug
#   (debug, main)          → …/DerivedData/Tug-debug
#   (debug|release, other) → …/DerivedData/Tug-worktree
#   TUG_FORCE_BUNDLE_ID=…   → …/DerivedData/Tug-<suffix>  (e.g. Tug-apptest)
#
# Usage:
#   derived-data-path.sh <profile>    # debug | release
#
# Output: an absolute DerivedData path (no trailing slash). xcodebuild
# writes products to `<path>/Build/Products/<Configuration>/`.

set -euo pipefail

PROFILE="${1:-}"
if [ -z "$PROFILE" ]; then
    echo "usage: $0 <profile>" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT_NAME="$(bash "$SCRIPT_DIR/product-name-from-cwd.sh" "$PROFILE")"

# Match Xcode's default base so standard tooling (and `clean-*`) find it;
# only the leaf name is per-variant instead of the shared project hash.
BASE="${HOME}/Library/Developer/Xcode/DerivedData"
echo "${BASE}/${PRODUCT_NAME}"
