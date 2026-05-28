#!/usr/bin/env bash
# Resolve the CFBundleIdentifier for the current working directory's
# Tug build identity, applying the same [D10] mapping that
# `assign-bundle-id.sh` uses at xcodebuild time:
#
#   (production, main)        → dev.tugtool.app
#   (development, main)       → dev.tugtool.app.dev
#   (development, <other>)    → dev.tugtool.app.development-<slug>
#   (production, <other>)     → dev.tugtool.app.production-<slug>
#
# Usage:
#   bundle-id-from-cwd.sh <profile>   # development | production
#
# Output: a CFBundleIdentifier string.

set -euo pipefail

PROFILE="${1:-}"
if [ -z "$PROFILE" ]; then
    echo "usage: $0 <profile>" >&2
    exit 1
fi

if BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" && [ "$BRANCH" != "HEAD" ]; then
    :
else
    SHA="$(git rev-parse HEAD 2>/dev/null | cut -c1-8)"
    BRANCH="detached-${SHA:-unknown}"
fi

case "${PROFILE}-${BRANCH}" in
    production-main)
        echo "dev.tugtool.app"
        ;;
    development-main)
        echo "dev.tugtool.app.dev"
        ;;
    *)
        REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
        SLUG="$(bash "$REPO_ROOT/tugrust/scripts/branch-slug.sh" "$BRANCH")"
        echo "dev.tugtool.app.${PROFILE}-${SLUG}"
        ;;
esac
