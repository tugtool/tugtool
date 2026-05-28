#!/bin/bash
set -euo pipefail

# assign-bundle-id.sh — xcodebuild build-phase script
#
# Assigns the bundle's CFBundleIdentifier per (BuildProfile, BuildBranch)
# according to roadmap/tug-multi-instance.md [D10]:
#
#   (production, main)        → dev.tugtool.app
#   (development, main)       → dev.tugtool.app.dev
#   (development, <other>)    → dev.tugtool.app.development-<slug>
#   (production, <other>)     → dev.tugtool.app.production-<slug>
#
# Where <slug> is the BuildBranch normalized via
# `tugrust/scripts/branch-slug.sh` (the canonical bash implementation
# of the slug algorithm). Parity with the Swift `BranchSlug.compute`
# is verified by `tests/build-info/test-slug-parity.sh`.
#
# Required env (set by Xcode at build time):
#   TARGET_BUILD_DIR          parent directory of the built bundle
#   CONTENTS_FOLDER_PATH      e.g. "Tug.app/Contents"
#
# Preconditions: capture-build-info.sh has already run and populated
# BuildProfile + BuildBranch in the bundle's Info.plist.
#
# Postcondition: the bundle's CFBundleIdentifier reflects the
# (BuildProfile, BuildBranch) tuple per [D10]. Code-signing (which
# happens after this phase) reads CFBundleIdentifier from the bundle's
# Info.plist directly, so the dynamic value propagates to the signed
# binary's designated requirement automatically.
#
# Note on PRODUCT_BUNDLE_IDENTIFIER: the xcconfig setting in
# project.pbxproj stays at the legacy `dev.tugtool.app` value. It is
# no longer the source of truth — this script is. Xcode IDE Build runs
# the same build phases as `xcodebuild`, so the dynamic override
# applies in both paths. The pbxproj value is the fallback that
# Xcode's `application-identifier` xcent generation uses; for our
# bundle (no sandbox, no app groups, no keychain access groups) a
# stale `application-identifier` in the xcent is cosmetic only.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLUG_CMD="$SCRIPT_DIR/branch-slug.sh"

PLIST="${TARGET_BUILD_DIR}/${CONTENTS_FOLDER_PATH}/Info.plist"

if [ ! -f "$PLIST" ]; then
    echo "error: $PLIST does not exist" >&2
    echo "       assign-bundle-id.sh must run after the Resources" >&2
    echo "       phase that copies Info.plist into the bundle." >&2
    exit 1
fi

read_key() {
    local key="$1"
    local value
    if ! value="$(plutil -extract "$key" raw "$PLIST" 2>/dev/null)"; then
        echo "error: Info.plist key '$key' is missing" >&2
        echo "       assign-bundle-id.sh must run after capture-build-info.sh." >&2
        exit 1
    fi
    if [ "$value" = "UNSET-AT-BUILD-TIME" ]; then
        echo "error: Info.plist key '$key' still has its placeholder value" >&2
        echo "       capture-build-info.sh did not run before this phase." >&2
        exit 1
    fi
    printf '%s' "$value"
}

BUILD_PROFILE="$(read_key BuildProfile)"
BUILD_BRANCH="$(read_key BuildBranch)"

case "${BUILD_PROFILE}-${BUILD_BRANCH}" in
    production-main)
        BUNDLE_ID="dev.tugtool.app"
        ;;
    development-main)
        BUNDLE_ID="dev.tugtool.app.dev"
        ;;
    *)
        BRANCH_SLUG="$(bash "$SLUG_CMD" "$BUILD_BRANCH")"
        if [ -z "$BRANCH_SLUG" ]; then
            echo "error: BuildBranch '$BUILD_BRANCH' slugifies to the empty string" >&2
            echo "       a branch name composed entirely of non-slug characters" >&2
            echo "       cannot produce a valid bundle ID suffix" >&2
            exit 1
        fi
        BUNDLE_ID="dev.tugtool.app.${BUILD_PROFILE}-${BRANCH_SLUG}"
        ;;
esac

plutil -replace CFBundleIdentifier -string "$BUNDLE_ID" "$PLIST"

echo "==> assign-bundle-id: $BUNDLE_ID"
