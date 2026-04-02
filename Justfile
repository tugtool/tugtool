# Tugtool development commands

default:
    @just --list

# Build all Rust binaries + tugtalk, symlink to ~/.local/bin
build:
    #!/usr/bin/env bash
    set -euo pipefail
    cd tugrust && cargo build -p tugcast -p tugexec -p tugutil -p tugrelaunch -p tugbank
    cd ..
    bun build --compile tugtalk/src/main.ts --outfile tugrust/target/debug/tugtalk
    mkdir -p ~/.local/bin
    for bin in tugcast tugexec tugutil tugrelaunch tugbank; do
        ln -sf "$(pwd)/tugrust/target/debug/$bin" ~/.local/bin/"$bin"
    done

# Build all binaries, then run tugexec (auto-detects source tree, activates dev mode via control socket)
dev: build
    tugrust/target/debug/tugexec

# Build binaries, run tugexec + cargo-watch for hands-free Rust hot reload
dev-watch: build
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v cargo-watch &>/dev/null; then
        echo "cargo-watch not found. Install with: cargo install cargo-watch"
        exit 1
    fi
    (cd tugrust && cargo watch -w crates -s "cargo build -p tugcast") &
    CARGO_WATCH_PID=$!
    trap "kill $CARGO_WATCH_PID 2>/dev/null" EXIT
    tugrust/target/debug/tugexec

# Run all tests (Rust + TypeScript)
test: test-rust test-ts

# Run Rust tests
test-rust:
    cd tugrust && cargo nextest run --workspace

# Run TypeScript tests
test-ts:
    cd tugdeck && bun test

# Format Rust code
fmt:
    cd tugrust && cargo fmt --all

# Run clippy + fmt check
lint:
    cd tugrust && cargo clippy --workspace --all-targets -- -D warnings
    cd tugrust && cargo fmt --all -- --check

# Full pre-merge gate (lint + test)
ci: lint test

# Build tugmark-wasm via wasm-pack (output goes to tugdeck/crates/tugmark-wasm/pkg/)
wasm:
    #!/usr/bin/env bash
    set -euo pipefail
    WASM_PACK="$(command -v wasm-pack 2>/dev/null || echo "$HOME/.cargo/bin/wasm-pack")"
    if [[ ! -x "$WASM_PACK" ]]; then
        echo "wasm-pack not found. Install with: cargo install wasm-pack"
        exit 1
    fi
    "$WASM_PACK" build --target web --release tugdeck/crates/tugmark-wasm

# Build the Mac app (with all dependencies), and run/restart it
app: build wasm
    #!/usr/bin/env bash
    set -euo pipefail
    (cd tugdeck && bun run build)
    # Touch Swift sources so xcodebuild detects changes on this mount.
    find tugapp/Sources -name '*.swift' -exec touch {} +
    xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug -destination 'platform=macOS,arch=arm64' build
    APP_DIR="$(xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug -destination 'platform=macOS,arch=arm64' -showBuildSettings 2>/dev/null | grep -m1 'BUILT_PRODUCTS_DIR' | awk '{print $3}')/Tug.app"
    MACOS_DIR="$APP_DIR/Contents/MacOS"
    cp tugrust/target/debug/tugcast "$MACOS_DIR/"
    cp tugrust/target/debug/tugutil "$MACOS_DIR/"
    cp tugrust/target/debug/tugexec "$MACOS_DIR/"
    cp tugrust/target/debug/tugrelaunch "$MACOS_DIR/"
    cp tugrust/target/debug/tugtalk "$MACOS_DIR/"
    echo "==> Launching Tug.app"
    # Tell the app where the source tree is so tugcast can find tugtalk, tugdeck, etc.
    tugbank write dev.tugexec.app source-tree-path "$(pwd)"
    TUG_PID=$(pgrep -x Tug 2>/dev/null || true)
    if [ -n "$TUG_PID" ]; then
        # App is running — orderly signal/wait/relaunch via tugrelaunch.
        tugrust/target/debug/tugrelaunch --app-bundle "$APP_DIR" --pid "$TUG_PID"
    else
        open "$APP_DIR"
    fi

# Build unsigned DMG
dmg:
    tugrust/scripts/build-app.sh --skip-sign --skip-notarize

# Clean Rust targets and Mac app build artifacts
clean:
    cd tugrust && cargo clean
    xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -destination 'platform=macOS,arch=arm64' clean 2>/dev/null || true
    rm -rf tugapp/build
