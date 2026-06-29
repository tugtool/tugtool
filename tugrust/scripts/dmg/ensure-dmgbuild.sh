#!/usr/bin/env bash
# Resolve a dmgbuild executable, bootstrapping a pinned, isolated venv on
# first use. dmgbuild writes the disk image's .DS_Store directly (via
# ds_store/mac_alias) with no Finder/AppleScript/GUI session, so the styled
# DMG build stays deterministic and headless.
#
# Prints the absolute path to the dmgbuild binary on stdout. All progress
# goes to stderr so the stdout capture stays clean.
#
# Resolution order:
#   1. $DMGBUILD if set and executable (operator override / CI cache).
#   2. dmgbuild on PATH (e.g. a pipx install).
#   3. A repo-local venv at $REPO_ROOT/.build-tools/dmgbuild-venv (gitignored),
#      created once and reused across builds. System python is never touched.
set -euo pipefail

DMGBUILD_VERSION="1.6.7"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

if [ -n "${DMGBUILD:-}" ] && [ -x "${DMGBUILD}" ]; then
    echo "$DMGBUILD"
    exit 0
fi

if command -v dmgbuild >/dev/null 2>&1; then
    command -v dmgbuild
    exit 0
fi

VENV="$REPO_ROOT/.build-tools/dmgbuild-venv"
VENV_DMGBUILD="$VENV/bin/dmgbuild"

if [ ! -x "$VENV_DMGBUILD" ]; then
    echo "==> Bootstrapping dmgbuild $DMGBUILD_VERSION venv at $VENV" >&2
    python3 -m venv "$VENV" >&2
    "$VENV/bin/pip" install --quiet --upgrade pip >&2
    "$VENV/bin/pip" install --quiet "dmgbuild==$DMGBUILD_VERSION" >&2
fi

echo "$VENV_DMGBUILD"
