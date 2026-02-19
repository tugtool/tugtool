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

# Find repo root (script is in tugcode/scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TUGCODE_DIR="$REPO_ROOT/tugcode"
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
cargo build --release -p tugcast -p tugcode -p tugtool

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
cp "$TUGCODE_DIR/target/release/tugcode" "$STAGING_APP/Contents/MacOS/"
cp "$TUGCODE_DIR/target/release/tugtool" "$STAGING_APP/Contents/MacOS/"

# Step 6: Copy tugplug to Contents/Resources/
echo "==> Copying tugplug to Contents/Resources/"
mkdir -p "$STAGING_APP/Contents/Resources"
cp -R "$TUGPLUG_DIR" "$STAGING_APP/Contents/Resources/"

# Step 7: Override bundle ID and app name for nightly
if [ "$NIGHTLY" = true ]; then
    echo "==> Configuring nightly bundle ID and icon"
    PLIST="$STAGING_APP/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$PLIST"
    /usr/libexec/PlistBuddy -c "Set :CFBundleName $APP_NAME" "$PLIST"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile $ICON_NAME" "$PLIST"
fi

# Step 8: Code signing
if [ "$SKIP_SIGN" = false ]; then
    echo "==> Code signing"
    if [ -z "${DEVELOPER_ID_NAME:-}" ]; then
        echo "Error: DEVELOPER_ID_NAME environment variable not set"
        exit 1
    fi
    codesign --deep --force --verify --verbose \
        --sign "Developer ID Application: $DEVELOPER_ID_NAME" \
        "$STAGING_APP"
else
    echo "==> Skipping code signing (--skip-sign)"
fi

# Step 9: Notarization
if [ "$SKIP_SIGN" = false ] && [ "$SKIP_NOTARIZE" = false ]; then
    echo "==> Notarizing"
    if [ -z "${APPLE_ID:-}" ] || [ -z "${TEAM_ID:-}" ] || [ -z "${NOTARY_PASSWORD:-}" ]; then
        echo "Error: APPLE_ID, TEAM_ID, or NOTARY_PASSWORD environment variables not set"
        exit 1
    fi

    # Create temporary zip for notarization
    NOTARY_ZIP="$BUILD_DIR/notary.zip"
    ditto -c -k --keepParent "$STAGING_APP" "$NOTARY_ZIP"

    xcrun notarytool submit "$NOTARY_ZIP" \
        --apple-id "$APPLE_ID" \
        --team-id "$TEAM_ID" \
        --password "$NOTARY_PASSWORD" \
        --wait

    xcrun stapler staple "$STAGING_APP"
else
    echo "==> Skipping notarization"
fi

# Step 10: Create DMG
echo "==> Creating DMG"
OUTPUT_DMG="$REPO_ROOT/$DMG_NAME"
rm -f "$OUTPUT_DMG"
hdiutil create \
    -volname "$APP_NAME" \
    -srcfolder "$STAGING_DIR" \
    -ov \
    -format UDZO \
    "$OUTPUT_DMG"

echo "==> Build complete: $OUTPUT_DMG"

# Cleanup
echo "==> Cleaning up build artifacts"
rm -rf "$BUILD_DIR"

echo "==> Done!"
