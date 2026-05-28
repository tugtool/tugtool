#!/bin/bash
set -euo pipefail

# sign-bundle.sh — inside-out signing for Tug.app with per-binary
# entitlements per [D16] of roadmap/tug-multi-instance.md.
#
# Replaces the `codesign --deep --force --sign` pattern that used to
# live in build-app.sh and Justfile recipes. `--deep` is FORBIDDEN
# for signing in this codebase because it applies the same
# entitlements file (or no entitlements) to every nested binary —
# wrong for our bundle shape, where the bun-compiled `tugcode`
# binary needs permissive JIT-related entitlements that the Rust
# helpers and the outer Swift binary explicitly should not have.
#
# `--deep` remains valid for *verification* commands (`codesign --verify
# --deep --strict ...`); it's only the signing form that's banned.
#
# Signing order is strictly inside-out, per Apple's guidance for any
# bundle with heterogeneous nested binaries (macOS 13+):
#
#   1. Rust helpers (tugcast, tugutil, tugexec, tugrelaunch, tugbank)
#      — default hardened runtime, no custom entitlements file.
#   2. Swift debug dylibs (`Tug.debug.dylib`, `__preview.dylib` —
#      Debug builds only). Hardened runtime requires nested dylibs
#      to share the Team ID of the loading binary, so we re-sign
#      Xcode's ad-hoc-signed dylibs with our Developer ID.
#   3. `tugcode` (bun-compiled) — permissive entitlements via
#      `tugapp/tugcode.entitlements`.
#   4. (Future: nested frameworks like Sparkle.framework would slot in
#      here, before the outer .app is sealed.)
#   5. The outer Tug binary + bundle wrapper — minimal entitlements
#      via `tugapp/Tug.entitlements`. This is the final seal; it
#      records the hashes of every signed item beneath it.
#
# Usage:
#   sign-bundle.sh <APP_PATH> [<IDENTITY>]
#
# IDENTITY defaults to the first "Developer ID Application" line
# returned by `security find-identity -v -p codesigning` — see
# #apple-prereqs in the plan for the one-time keychain setup that
# installs the certificate.

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
    echo "usage: $(basename "$0") <APP_PATH> [<IDENTITY>]" >&2
    exit 2
fi

APP_PATH="$1"
IDENTITY="${2:-}"

if [ ! -d "$APP_PATH" ] || [ ! -d "$APP_PATH/Contents/MacOS" ]; then
    echo "error: $APP_PATH does not look like a .app bundle" >&2
    exit 1
fi

if [ -z "$IDENTITY" ]; then
    IDENTITY="$(
        security find-identity -v -p codesigning 2>/dev/null \
            | awk -F'"' '/Developer ID Application:/ {print $2; exit}'
    )"
    if [ -z "$IDENTITY" ]; then
        echo "error: no Developer ID Application identity found in the login keychain" >&2
        echo "       run: just setup-dev-signing  (one-time machine setup)" >&2
        exit 1
    fi
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

TUGCODE_ENTITLEMENTS="$REPO_ROOT/tugapp/tugcode.entitlements"
TUG_ENTITLEMENTS="$REPO_ROOT/tugapp/Tug.entitlements"

for f in "$TUGCODE_ENTITLEMENTS" "$TUG_ENTITLEMENTS"; do
    if [ ! -f "$f" ]; then
        echo "error: required entitlements file missing: $f" >&2
        exit 1
    fi
done

echo "==> Signing $APP_PATH"
echo "    Identity: $IDENTITY"

# (1) Rust helper binaries. No custom entitlements — hardened runtime
# gives them sensible defaults for native code with no JIT. We iterate
# a candidate list and sign each that's actually present; tugbank and
# tugrelaunch are present in some bundle configurations and not
# others, and a missing entry is benign (the bundle just doesn't ship
# that helper).
RUST_BINS=(tugcast tugutil tugexec tugrelaunch tugbank)
for bin in "${RUST_BINS[@]}"; do
    bin_path="$APP_PATH/Contents/MacOS/$bin"
    if [ -x "$bin_path" ]; then
        echo "    signing helper:        $bin"
        codesign --force --options runtime --timestamp \
            --sign "$IDENTITY" "$bin_path"
    fi
done

# (2) Swift debug dylibs (Debug configuration only). Xcode signs
# these ad-hoc as part of `Tug.app/Contents/MacOS/*.dylib` (e.g.
# `Tug.debug.dylib`, `__preview.dylib`). Under hardened runtime,
# dyld refuses to load a dylib whose Team ID differs from the
# loading binary's — so once the outer Tug binary is Developer-ID-
# signed, the ad-hoc dylibs fail to load with:
#   "mapping process and mapped file (non-platform) have different Team IDs"
# Re-signing them with the same Developer ID makes their Team IDs
# match. No custom entitlements — they're just nested code.
# Release builds have no .dylib files in MacOS/ so this loop is a
# no-op there.
shopt -s nullglob
for dylib in "$APP_PATH/Contents/MacOS"/*.dylib; do
    echo "    signing debug dylib:   $(basename "$dylib")"
    codesign --force --options runtime --timestamp \
        --sign "$IDENTITY" "$dylib"
done
shopt -u nullglob

# (3) tugcode — bun-compiled, needs permissive JIT entitlements.
TUGCODE_BIN="$APP_PATH/Contents/MacOS/tugcode"
if [ ! -x "$TUGCODE_BIN" ]; then
    echo "error: tugcode binary missing at $TUGCODE_BIN" >&2
    echo "       sign-bundle.sh requires tugcode in the bundle" >&2
    exit 1
fi
echo "    signing tugcode (bun): permissive entitlements"
codesign --force --options runtime --timestamp \
    --entitlements "$TUGCODE_ENTITLEMENTS" \
    --sign "$IDENTITY" "$TUGCODE_BIN"

# (4) Reserved slot for nested frameworks. Sign them HERE, before
# the outer seal in (5). Adding one without updating this script
# will fail notarization (the outer seal won't cover the framework's
# binaries unambiguously, or codesign will report nested signature
# mismatches).

# (5) Outer Tug binary + bundle wrapper. Minimal entitlements; this
# seal records every signed item beneath.
echo "    sealing outer bundle:  Tug.entitlements"
codesign --force --options runtime --timestamp \
    --entitlements "$TUG_ENTITLEMENTS" \
    --sign "$IDENTITY" "$APP_PATH"

# Verification uses --deep (allowed for verify, banned for sign) to
# walk the entire bundle and confirm every nested signature checks
# out against the outer seal.
echo "==> Verifying signature"
codesign --verify --deep --strict --verbose=1 "$APP_PATH" 2>&1

echo "==> sign-bundle: done"
