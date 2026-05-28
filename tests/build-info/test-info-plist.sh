#!/bin/bash
set -euo pipefail

# test-info-plist.sh — integration test for the capture-build-info
# build phase. Builds a Debug bundle, inspects the Info.plist that
# the build phase wrote into it, and verifies:
#   - BuildProfile  == "development"   (Debug → development)
#   - BuildBranch   == current git branch (or detached-<sha8>)
#   - BuildCommit   == current HEAD sha
#   - BuildSourceTree == repo root      (development builds include it)
#   - CFBundleIdentifier == dev.tugtool.app (until Step 2 lands)
#
# Reports the expected BuildInfo.instanceId (computed by running the
# branch-slug algorithm against BuildBranch) so a human can spot-check
# end-to-end identity composition.
#
# Use `--no-build` to skip xcodebuild and verify whatever bundle is
# already built (faster iteration).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TUGAPP_DIR="$REPO_ROOT/tugapp"

NO_BUILD=false
for arg in "$@"; do
    case "$arg" in
        --no-build) NO_BUILD=true ;;
        *) echo "error: unknown arg '$arg' (use --no-build to skip xcodebuild)" >&2; exit 2 ;;
    esac
done

if [ "$NO_BUILD" = false ]; then
    echo "==> building Debug bundle"
    xcodebuild \
        -project "$TUGAPP_DIR/Tug.xcodeproj" \
        -scheme Tug \
        -configuration Debug \
        -destination 'platform=macOS,arch=arm64' \
        build >/dev/null
fi

BUILT_PRODUCTS_DIR="$(
    xcodebuild \
        -project "$TUGAPP_DIR/Tug.xcodeproj" \
        -scheme Tug \
        -configuration Debug \
        -destination 'platform=macOS,arch=arm64' \
        -showBuildSettings 2>/dev/null \
    | awk '/^[[:space:]]*BUILT_PRODUCTS_DIR =/ {print $3; exit}'
)"
APP="$BUILT_PRODUCTS_DIR/Tug.app"
PLIST="$APP/Contents/Info.plist"

if [ ! -f "$PLIST" ]; then
    echo "error: $PLIST not found — bundle was not built" >&2
    exit 1
fi

read_key() {
    plutil -extract "$1" raw -o - "$PLIST" 2>/dev/null || true
}

# Reproduce the Swift slugify in shell — the goal is to assert that
# BuildBranch + slugify gives the expected instance ID. The Swift
# version is canonical; this sed pipeline is *only* used to predict
# the instance ID a Swift BuildInfo read would surface. If the two
# implementations diverge, the unit test (test-branch-slug.sh) covers
# Swift; tests in Step 2's assign-bundle-id.sh will cover the bash
# implementation against the same case table.
shell_slugify() {
    printf '%s\n' "$1" \
        | LC_ALL=C tr '[:upper:]' '[:lower:]' \
        | LC_ALL=C sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

PROFILE="$(read_key BuildProfile)"
BRANCH="$(read_key BuildBranch)"
COMMIT="$(read_key BuildCommit)"
SOURCE_TREE="$(read_key BuildSourceTree)"
BUNDLE_ID="$(read_key CFBundleIdentifier)"

GIT_HEAD="$(git -C "$TUGAPP_DIR" rev-parse HEAD)"
GIT_BRANCH="$(git -C "$TUGAPP_DIR" rev-parse --abbrev-ref HEAD)"
if [ "$GIT_BRANCH" = "HEAD" ]; then
    GIT_BRANCH="detached-$(echo "$GIT_HEAD" | cut -c1-8)"
fi
REPO_ROOT_REAL="$(cd "$TUGAPP_DIR/.." && pwd)"

fail=0
check() {
    local name="$1"
    local actual="$2"
    local expected="$3"
    if [ "$actual" = "$expected" ]; then
        printf '  ok   %-22s = %s\n' "$name" "$actual"
    else
        printf '  FAIL %-22s = %s  (expected %s)\n' "$name" "$actual" "$expected"
        fail=$((fail + 1))
    fi
}

echo "==> verifying $PLIST"
check BuildProfile     "$PROFILE"     "development"
check BuildBranch      "$BRANCH"      "$GIT_BRANCH"
check BuildCommit      "$COMMIT"      "$GIT_HEAD"
check BuildSourceTree  "$SOURCE_TREE" "$REPO_ROOT_REAL"
check CFBundleIdentifier "$BUNDLE_ID" "dev.tugtool.app"

EXPECTED_INSTANCE_ID="development-$(shell_slugify "$GIT_BRANCH")"
echo "==> expected BuildInfo.instanceId for a Swift consumer: $EXPECTED_INSTANCE_ID"

if [ "$fail" -ne 0 ]; then
    echo "FAIL: $fail key(s) did not match expected values" >&2
    exit 1
fi
echo "ok: Info.plist has all four build-time identity keys with expected values"
