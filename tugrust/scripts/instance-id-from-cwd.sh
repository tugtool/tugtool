#!/usr/bin/env bash
# Resolve the per-instance identity for the current working directory.
#
# Usage:
#   instance-id-from-cwd.sh <profile>   # profile is "development" or "production"
#
# Output: <profile>-<branch-slug>
#
# Branch resolution mirrors the Xcode build-phase script:
#   - `git rev-parse --abbrev-ref HEAD` if attached
#   - `detached-<sha8>` if HEAD is detached
# Slug computation delegates to branch-slug.sh so build, runtime, and
# CLI all use the same algorithm.

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

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SLUG="$(bash "$REPO_ROOT/tugrust/scripts/branch-slug.sh" "$BRANCH")"
echo "${PROFILE}-${SLUG}"
