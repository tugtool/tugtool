# Tugtool development commands

VITE_DEV_PORT := "5173"

default:
    @just --list

# Build all Rust binaries (tugcast, tugtool, tugcode, tugrelaunch)
build:
    cd tugcode && cargo build -p tugcast -p tugtool -p tugcode -p tugrelaunch

# Build all binaries, then run tugtool (auto-detects source tree, activates dev mode via control socket)
dev: build
    tugcode/target/debug/tugtool

# Build binaries, run tugtool + cargo-watch for hands-free Rust hot reload
dev-watch: build
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v cargo-watch &>/dev/null; then
        echo "cargo-watch not found. Install with: cargo install cargo-watch"
        exit 1
    fi
    (cd tugcode && cargo watch -w crates -s "cargo build -p tugcast") &
    CARGO_WATCH_PID=$!
    trap "kill $CARGO_WATCH_PID 2>/dev/null" EXIT
    tugcode/target/debug/tugtool

# Run all tests (Rust + TypeScript)
test: test-rust test-ts

# Run Rust tests
test-rust:
    cd tugcode && cargo nextest run --workspace

# Run TypeScript tests
test-ts:
    cd tugdeck && bun test

# Format Rust code
fmt:
    cd tugcode && cargo fmt --all

# Run clippy + fmt check
lint:
    cd tugcode && cargo clippy --workspace --all-targets -- -D warnings
    cd tugcode && cargo fmt --all -- --check

# Full pre-merge gate (lint + test)
ci: lint test

# Build the Mac app (with all dependencies), and run/restart it
app: build
    #!/usr/bin/env bash
    set -euo pipefail
    (cd tugdeck && bun run build)
    xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build
    APP_DIR="$(xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug -showBuildSettings 2>/dev/null | grep -m1 'BUILT_PRODUCTS_DIR' | awk '{print $3}')/Tug.app"
    MACOS_DIR="$APP_DIR/Contents/MacOS"
    cp tugcode/target/debug/tugcast "$MACOS_DIR/"
    cp tugcode/target/debug/tugcode "$MACOS_DIR/"
    cp tugcode/target/debug/tugtool "$MACOS_DIR/"
    cp tugcode/target/debug/tugrelaunch "$MACOS_DIR/"
    echo "==> Launching Tug.app"
    pkill -x Tug 2>/dev/null || true
    pkill -x tugcast 2>/dev/null || true
    # Kill any stale Vite dev server on the configured port so the new one can bind with --strictPort
    lsof -ti :{{VITE_DEV_PORT}} | xargs kill 2>/dev/null || true
    sleep 0.5
    # Tell the app where the source tree is so tugcast can find tugtalk, tugdeck, etc.
    defaults write dev.tugtool.app SourceTreePath "$(pwd)"
    open "$APP_DIR"

# Build unsigned DMG
dmg:
    tugcode/scripts/build-app.sh --skip-sign --skip-notarize

# Clean Rust targets and Mac app build artifacts
clean:
    cd tugcode && cargo clean
    xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug clean 2>/dev/null || true
    rm -rf tugapp/build
