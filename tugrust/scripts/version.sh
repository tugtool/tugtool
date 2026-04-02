#!/bin/bash
set -euo pipefail

# version.sh — unified version management for all tugtool components
#
# Single source of truth: tugrust/Cargo.toml [workspace.package] version
# Propagates to: tugcode/package.json, tugdeck/package.json, tugapp/Info.plist
#
# Usage:
#   version.sh show               Print current version
#   version.sh set <M.m.p>        Set version everywhere
#   version.sh bump major|minor|patch   Increment and set

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

CARGO_TOML="$REPO_ROOT/tugrust/Cargo.toml"
TUGCODE_PKG="$REPO_ROOT/tugcode/package.json"
TUGDECK_PKG="$REPO_ROOT/tugdeck/package.json"
INFO_PLIST="$REPO_ROOT/tugapp/Info.plist"

# Read current version from workspace Cargo.toml
read_version() {
    grep '^version = ' "$CARGO_TOML" | head -1 | sed 's/version = "//;s/"//'
}

# Compute CFBundleVersion integer: major*10000 + minor*100 + patch
bundle_version() {
    local ver="$1"
    local major minor patch
    IFS='.' read -r major minor patch <<< "$ver"
    echo $(( major * 10000 + minor * 100 + patch ))
}

# Set version in all files
do_set() {
    local ver="$1"

    # Validate format
    if ! echo "$ver" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
        echo "error: version must be in M.m.p format (e.g., 0.8.0)" >&2
        exit 1
    fi

    local bv
    bv=$(bundle_version "$ver")

    # 1. Cargo.toml workspace version
    sed -i '' "s/^version = \".*\"/version = \"$ver\"/" "$CARGO_TOML"

    # 2. tugcode/package.json
    sed -i '' "s/\"version\": \".*\"/\"version\": \"$ver\"/" "$TUGCODE_PKG"

    # 3. tugdeck/package.json
    sed -i '' "s/\"version\": \".*\"/\"version\": \"$ver\"/" "$TUGDECK_PKG"

    # 4. tugapp/Info.plist — CFBundleShortVersionString and CFBundleVersion
    /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $ver" "$INFO_PLIST"
    /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $bv" "$INFO_PLIST"

    # 5. Update Cargo.lock
    (cd "$REPO_ROOT/tugrust" && cargo generate-lockfile 2>/dev/null)

    echo "$ver"
}

# Bump version component
do_bump() {
    local component="$1"
    local ver
    ver=$(read_version)

    local major minor patch
    IFS='.' read -r major minor patch <<< "$ver"

    case "$component" in
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        patch)
            patch=$((patch + 1))
            ;;
        *)
            echo "error: unknown component '$component' (use major, minor, or patch)" >&2
            exit 1
            ;;
    esac

    do_set "$major.$minor.$patch"
}

# Main
case "${1:-}" in
    show)
        read_version
        ;;
    set)
        if [ -z "${2:-}" ]; then
            echo "usage: version.sh set <M.m.p>" >&2
            exit 1
        fi
        do_set "$2"
        ;;
    bump)
        if [ -z "${2:-}" ]; then
            echo "usage: version.sh bump major|minor|patch" >&2
            exit 1
        fi
        do_bump "$2"
        ;;
    *)
        echo "usage: version.sh {show|set <M.m.p>|bump major|minor|patch}" >&2
        exit 1
        ;;
esac
