#!/bin/bash
set -euo pipefail

# build-app.sh - Build, sign, notarize, and package Tug.app as a DMG
#
# Usage:
#   ./build-app.sh [--nightly] [--skip-sign] [--skip-notarize]
#
# Flags:
#   --nightly        Build nightly variant with dev.tugtool.nightly bundle ID
#   --skip-sign      Skip code signing (for local builds without credentials)
#   --skip-notarize  Skip notarization (for local builds without credentials)
#   --help           Show this help message

NIGHTLY=false
SKIP_SIGN=false
SKIP_NOTARIZE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --nightly)
            NIGHTLY=true
            shift
            ;;
        --skip-sign)
            SKIP_SIGN=true
            shift
            ;;
        --skip-notarize)
            SKIP_NOTARIZE=true
            shift
            ;;
        --help)
            grep '^#' "$0" | cut -c 3-
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Run with --help for usage"
            exit 1
            ;;
    esac
done

# Determine build configuration
if [ "$NIGHTLY" = true ]; then
    BUNDLE_ID="dev.tugtool.nightly"
    APP_NAME="Tug Nightly"
    ICON_NAME="NightlyAppIcon"
    DMG_NAME="TugNightly.dmg"
else
    BUNDLE_ID="dev.tugtool.app"
    APP_NAME="Tug"
    ICON_NAME="AppIcon"
    DMG_NAME="Tug.dmg"
fi

echo "==> Building $APP_NAME"
echo "    Bundle ID: $BUNDLE_ID"

# Find repo root (script is in tugrust/scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TUGCODE_DIR="$REPO_ROOT/tugrust"
TUGDECK_DIR="$REPO_ROOT/tugdeck"
TUGAPP_DIR="$REPO_ROOT/tugapp"
TUGPLUG_DIR="$REPO_ROOT/tugplug"

# Read version from Cargo.toml
VERSION=$(grep '^version = ' "$TUGCODE_DIR/Cargo.toml" | head -1 | cut -d'"' -f2)
echo "    Version: $VERSION"

# Create build directories
BUILD_DIR="$REPO_ROOT/build"
DERIVED_DATA="$BUILD_DIR/derived"
STAGING_DIR="$BUILD_DIR/staging"
rm -rf "$BUILD_DIR"
mkdir -p "$DERIVED_DATA" "$STAGING_DIR"

# Step 1: Build Rust binaries
echo "==> Building Rust binaries (release mode)"
cd "$TUGCODE_DIR"
cargo build --release -p tugcast -p tugutil -p tugexec

# Step 1b: Build tugcode (Claude Code bridge) standalone binary
echo "==> Building tugcode (bun compile)"
cd "$REPO_ROOT"
bun build --compile tugcode/src/main.ts --outfile tugrust/target/release/tugcode

# Step 2: Build tugdeck frontend
echo "==> Building tugdeck frontend"
cd "$TUGDECK_DIR"
bun install --frozen-lockfile
bun run build

# Step 3: Build Mac app with xcodebuild
echo "==> Building Mac app via xcodebuild"
cd "$TUGAPP_DIR"
xcodebuild -project Tug.xcodeproj \
    -scheme Tug \
    -configuration Release \
    -derivedDataPath "$DERIVED_DATA" \
    build

# Step 4: Copy xcodebuild output to staging
echo "==> Assembling .app bundle"
XCODE_APP="$DERIVED_DATA/Build/Products/Release/Tug.app"
STAGING_APP="$STAGING_DIR/$APP_NAME.app"

if [ ! -d "$XCODE_APP" ]; then
    echo "Error: xcodebuild did not produce Tug.app at $XCODE_APP"
    exit 1
fi

cp -R "$XCODE_APP" "$STAGING_APP"

# Step 5: Inject Rust binaries into Contents/MacOS/
echo "==> Copying Rust binaries to Contents/MacOS/"
mkdir -p "$STAGING_APP/Contents/MacOS"
cp "$TUGCODE_DIR/target/release/tugcast" "$STAGING_APP/Contents/MacOS/"
cp "$TUGCODE_DIR/target/release/tugutil" "$STAGING_APP/Contents/MacOS/"
cp "$TUGCODE_DIR/target/release/tugexec" "$STAGING_APP/Contents/MacOS/"
cp "$TUGCODE_DIR/target/release/tugcode" "$STAGING_APP/Contents/MacOS/"

# Step 6: Copy tugplug to Contents/Resources/
echo "==> Copying tugplug to Contents/Resources/"
mkdir -p "$STAGING_APP/Contents/Resources"
cp -R "$TUGPLUG_DIR" "$STAGING_APP/Contents/Resources/"

# Step 6b: Bundle a self-contained tmux (built from source) + its terminfo.
# Eliminates the "tmux Required" preflight on machines without Homebrew tmux.
# ProcessManager points TUG_TMUX / TERMINFO_DIRS at these at launch.
echo "==> Bundling static tmux + terminfo"
TMUX_OUT="$("$SCRIPT_DIR/fetch-tmux.sh")"
mkdir -p "$STAGING_APP/Contents/Resources/bin"
cp "$TMUX_OUT/bin/tmux" "$STAGING_APP/Contents/Resources/bin/tmux"
cp -R "$TMUX_OUT/terminfo" "$STAGING_APP/Contents/Resources/terminfo"
mkdir -p "$STAGING_APP/Contents/Resources/third-party-licenses"
cp "$TMUX_OUT/licenses/"*.txt "$STAGING_APP/Contents/Resources/third-party-licenses/"

# Step 7: Override bundle ID and app name for nightly
if [ "$NIGHTLY" = true ]; then
    echo "==> Configuring nightly bundle ID and icon"
    PLIST="$STAGING_APP/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$PLIST"
    /usr/libexec/PlistBuddy -c "Set :CFBundleName $APP_NAME" "$PLIST"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile $ICON_NAME" "$PLIST"
fi

# Step 8: Code signing
#
# Inside-out signing with per-binary entitlements per [D16]. The
# legacy `codesign --deep --force --sign` block here used to apply
# the same entitlements to every nested binary — wrong for our
# bundle shape (tugcode needs permissive JIT entitlements; the
# Rust helpers and outer Swift binary do not). sign-bundle.sh
# enumerates each binary explicitly and signs with the correct
# entitlements per [D16].
#
# DEVELOPER_ID_NAME: passed through as a full codesign identity
# string (e.g. "Developer ID Application: Jane Doe (TEAMID)"). If
# unset, sign-bundle.sh auto-detects from the login keychain.
if [ "$SKIP_SIGN" = false ]; then
    echo "==> Code signing (inside-out, per [D16])"
    SIGN_IDENTITY_ARG=()
    if [ -n "${DEVELOPER_ID_NAME:-}" ]; then
        # Support both "Developer ID Application: ..." (full identity
        # string) and "Jane Doe (TEAMID)" (legacy short form) for
        # backward compat with existing CI configs.
        case "$DEVELOPER_ID_NAME" in
            "Developer ID Application: "*)
                SIGN_IDENTITY_ARG=("$DEVELOPER_ID_NAME")
                ;;
            *)
                SIGN_IDENTITY_ARG=("Developer ID Application: $DEVELOPER_ID_NAME")
                ;;
        esac
    fi
    # Guard the array expansion: macOS /bin/bash is 3.2, where expanding an
    # empty array as "${arr[@]}" under `set -u` aborts with "unbound variable".
    # DEVELOPER_ID_NAME is normally unset (sign-bundle.sh auto-detects from the
    # keychain), so this array is empty in the common path.
    if [ "${#SIGN_IDENTITY_ARG[@]}" -gt 0 ]; then
        bash "$SCRIPT_DIR/sign-bundle.sh" "$STAGING_APP" "${SIGN_IDENTITY_ARG[@]}"
    else
        bash "$SCRIPT_DIR/sign-bundle.sh" "$STAGING_APP"
    fi
else
    echo "==> Skipping code signing (--skip-sign)"
fi

# Step 9: Notarization
#
# Delegates to notarize.sh, which uses the keychain profile
# `tug-notary` (per #apple-prereqs step 5) instead of inline
# APPLE_ID / TEAM_ID / NOTARY_PASSWORD env vars. The keychain
# profile keeps the app-specific password out of command history,
# env files, and CI logs.
if [ "$SKIP_SIGN" = false ] && [ "$SKIP_NOTARIZE" = false ]; then
    bash "$SCRIPT_DIR/notarize.sh" "$STAGING_APP"
else
    echo "==> Skipping notarization"
fi

# Step 10: Create DMG
#
# Branded drag-to-Applications image built with dmgbuild (Python). dmgbuild
# writes the layout into .DS_Store directly via ds_store/mac_alias — no
# Finder, no AppleScript, no GUI session — so this stays deterministic and
# headless under notary/CI conditions, unlike create-dmg/osascript approaches.
# settings.py + background.tiff + VolumeIcon.icns live in scripts/dmg/.
echo "==> Creating DMG (dmgbuild)"
OUTPUT_DMG="$REPO_ROOT/$DMG_NAME"
rm -f "$OUTPUT_DMG"
DMGBUILD="$("$SCRIPT_DIR/dmg/ensure-dmgbuild.sh")"
"$DMGBUILD" \
    -s "$SCRIPT_DIR/dmg/settings.py" \
    -D app="$STAGING_APP" \
    -D background="$REPO_ROOT/resources/dmg-background.tiff" \
    -D icon="$SCRIPT_DIR/dmg/VolumeIcon.icns" \
    "$APP_NAME" \
    "$OUTPUT_DMG"

# Code-sign the .dmg on signed builds. Mirrors sign-bundle.sh's identity
# resolution: an explicit DEVELOPER_ID_NAME (full or short form) wins,
# otherwise the first "Developer ID Application" in the login keychain.
# (Notarizing the dmg wrapper itself remains a follow-on; the .app inside
# is already notarized + stapled.)
if [ "$SKIP_SIGN" = false ]; then
    DMG_IDENTITY="${DEVELOPER_ID_NAME:-}"
    case "$DMG_IDENTITY" in
        "Developer ID Application: "*) : ;;
        "") DMG_IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null \
                | awk -F'"' '/Developer ID Application:/ {print $2; exit}')" ;;
        *) DMG_IDENTITY="Developer ID Application: $DMG_IDENTITY" ;;
    esac
    if [ -z "$DMG_IDENTITY" ]; then
        echo "error: no Developer ID Application identity found to sign the DMG" >&2
        exit 1
    fi
    echo "==> Signing DMG: $DMG_IDENTITY"
    codesign --force --timestamp --sign "$DMG_IDENTITY" "$OUTPUT_DMG"
    codesign --verify --verbose "$OUTPUT_DMG"
else
    echo "==> Skipping DMG signing (--skip-sign)"
fi

echo "==> Build complete: $OUTPUT_DMG"

# Cleanup
echo "==> Cleaning up build artifacts"
rm -rf "$BUILD_DIR"

echo "==> Done!"
