# Tugtool development commands

default:
    @just --list

# Build all Rust binaries + tugcode (Claude Code bridge), symlink to ~/.local/bin
build:
    #!/usr/bin/env bash
    set -euo pipefail
    cd tugrust && cargo build -p tugcast -p tugexec -p tugutil -p tugrelaunch -p tugbank
    cd ..
    bun build --compile tugcode/src/main.ts --outfile tugrust/target/debug/tugcode
    mkdir -p ~/.local/bin
    for bin in tugcast tugexec tugutil tugcode tugrelaunch tugbank; do
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

# Run TypeScript tests (tugdeck frontend + tugcode bridge)
test-ts:
    cd tugdeck && bun test
    cd tugcode && bun test

# Capture Claude Code fixtures + capabilities snapshot (~2-3 min; real-claude)
capture-capabilities:
    #!/usr/bin/env bash
    set -eo pipefail
    if ! command -v claude &>/dev/null; then
        echo "error: claude not found on PATH" >&2
        exit 1
    fi
    echo "---- claude version ----"
    claude --version
    echo
    # Single stability run by default. Shape flakiness (e.g., optional
    # thinking_text appearing on some runs) surfaces downstream via the
    # drift regression, which canonicalizes sequences and already
    # classifies findings per Benign/Semantic/Ambiguous. Running the
    # capture 3× front-loaded detection that drift already does with
    # one extra run — empirically (v2.1.104..v2.1.112, 3 captures × 35
    # probes), the 3× caught only 2 flakes total, both Benign-class.
    # Override with `TUG_STABILITY=N just capture-capabilities` if you
    # specifically want to probe flapping at baseline time.
    STABILITY="${TUG_STABILITY:-1}"
    echo "---- running capture (TUG_STABILITY=$STABILITY, ~$((STABILITY * 2))-$((STABILITY * 3)) min) ----"
    (cd tugrust && env -u ANTHROPIC_API_KEY TUG_STABILITY="$STABILITY" TUG_REAL_CLAUDE=1 \
        cargo nextest run -p tugcast --features real-claude-tests \
        --run-ignored only --no-capture capture_all_probes)
    VER="$(tr -d '[:space:]' < capabilities/LATEST)"
    echo
    echo "---- capabilities/LATEST → $VER ----"
    ls -la "capabilities/$VER/"
    # Previous baseline = second-newest version dir under capabilities/ in
    # semver order. Used for the stream-json-catalog stat summary.
    PREV_VER="$(ls -d capabilities/*/ 2>/dev/null \
        | sed -E 's|capabilities/||; s|/$||' \
        | grep -v "^$VER$" \
        | sort -V \
        | tail -1 || true)"
    if [ -n "$PREV_VER" ]; then
        echo
        echo "---- stream-json-catalog diff (v$PREV_VER → v$VER) — file-stat summary ----"
        # git diff returns 1 when files differ — expected, not an error.
        git --no-pager diff --no-index --stat \
            "tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v$PREV_VER/" \
            "tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v$VER/" \
            || true
        echo
        read -r -p "View full stream-json diff in pager? [y/N] " ans
        if [[ "$ans" =~ ^[Yy] ]]; then
            git diff --no-index \
                "tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v$PREV_VER/" \
                "tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v$VER/" \
                || true
        fi
    fi
    echo
    echo "---- running drift regression (~2 min) ----"
    # Drift test exit code: 0 = clean or Benign-only warnings; non-zero =
    # Semantic or Ambiguous findings that require consumer classification
    # before a version bump can land. Capture that distinction here.
    DRIFT_OK=1
    (cd tugrust && env -u ANTHROPIC_API_KEY TUG_REAL_CLAUDE=1 \
        cargo nextest run -p tugcast --features real-claude-tests \
        --run-ignored only --no-capture stream_json_catalog_drift_regression) \
        || DRIFT_OK=0
    echo
    if [ "$DRIFT_OK" -eq 0 ]; then
        echo "---- drift regression FAILED ----"
        echo "Classify findings above as Benign / Semantic / Ambiguous per"
        echo "  tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/README.md"
        echo "Nothing staged. Resolve or reclassify, then commit manually."
        exit 1
    fi
    echo "---- drift regression clean (Benign-or-better) ----"
    echo
    COMMIT_MSG="test(tugcast): advance golden baseline to claude $VER"
    echo "Proposed commit:"
    echo "  files: tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v$VER/"
    echo "         capabilities/$VER/ + capabilities/LATEST"
    echo "  msg:   $COMMIT_MSG"
    echo
    read -r -p "Approve, stage, and commit? [y/N] " ans
    if [[ ! "$ans" =~ ^[Yy] ]]; then
        echo "Skipped. Working tree left untouched — review, then commit manually."
        exit 0
    fi
    git add "tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v$VER/"
    git add "capabilities/$VER/" capabilities/LATEST
    git commit -m "$COMMIT_MSG"
    echo
    echo "---- committed ----"
    git --no-pager log -1 --oneline

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
    # tugcast/tugcode/tugutil/tugexec/tugrelaunch and tugdeck/dist are copied into
    # the bundle by the Tug target's shell script build phase (see project.pbxproj).
    echo "==> Launching Tug.app"
    # Tell the app where the source tree is so tugcast can find tugcode, tugdeck, etc.
    tugbank write dev.tugexec.app source-tree-path "$(pwd)"
    TUG_PID=$(pgrep -x Tug 2>/dev/null || true)
    if [ -n "$TUG_PID" ]; then
        # App is running — orderly signal/wait/relaunch via tugrelaunch.
        tugrust/target/debug/tugrelaunch --app-bundle "$APP_DIR" --pid "$TUG_PID"
    else
        open "$APP_DIR"
    fi

# Tail today's tugcast log. Includes forwarded tugcode / Claude
# stderr under the `tugcast::tugcode_stderr` target — that's where
# Claude's real error messages land since Tug.app is launched via
# `open` (see `just app`) and the raw stderr fd is otherwise lost
# to launchd.
logs:
    #!/usr/bin/env bash
    set -euo pipefail
    DATE="$(date +%Y-%m-%d)"
    LOG="$HOME/Library/Application Support/Tug/Logs/tugcast.log.$DATE"
    if [ ! -f "$LOG" ]; then
        echo "No log yet for $DATE at $LOG. Launch Tug.app with 'just app' first."
        exit 1
    fi
    tail -F "$LOG"

# List any tugcode / claude processes reparented to PID 1 — these
# are zombies left behind by an ungraceful Tug.app exit (roadmap
# step 4j). Expected output: `(no zombies)`. A non-empty list means
# processes leaked past the pgid SIGTERM cleanup and need to be
# reaped manually — use `just zombie-cleanup`.
zombies:
    #!/usr/bin/env bash
    set -euo pipefail
    PIDS="$(ps -eo pid,ppid,command \
        | awk '$2 == 1 && ($3 ~ /tugcode/ || ($3 == "claude" && $0 ~ /stream-json/)) { print $0 }')"
    if [ -z "$PIDS" ]; then
        echo "(no zombies)"
    else
        COUNT="$(printf '%s\n' "$PIDS" | wc -l | tr -d ' ')"
        echo "$COUNT zombie process(es) reparented to PID 1:"
        printf '%s\n' "$PIDS"
    fi

# Kill any tugcode / claude processes reparented to PID 1. Sends
# SIGTERM first, waits briefly, then SIGKILLs anything still alive.
zombie-cleanup:
    #!/usr/bin/env bash
    set -euo pipefail
    PIDS="$(ps -eo pid,ppid,command \
        | awk '$2 == 1 && ($3 ~ /tugcode/ || ($3 == "claude" && $0 ~ /stream-json/)) { print $1 }')"
    if [ -z "$PIDS" ]; then
        echo "(no zombies to clean up)"
        exit 0
    fi
    COUNT="$(printf '%s\n' "$PIDS" | wc -l | tr -d ' ')"
    echo "SIGTERM-ing $COUNT zombie process(es): $PIDS"
    # shellcheck disable=SC2086
    kill -TERM $PIDS 2>/dev/null || true
    sleep 1
    STRAGGLERS="$(printf '%s\n' $PIDS | while read -r pid; do
        if kill -0 "$pid" 2>/dev/null; then echo "$pid"; fi
    done)"
    if [ -n "$STRAGGLERS" ]; then
        echo "SIGKILL-ing stragglers: $STRAGGLERS"
        # shellcheck disable=SC2086
        kill -KILL $STRAGGLERS 2>/dev/null || true
    fi
    echo "done"

# Build unsigned DMG
dmg:
    tugrust/scripts/build-app.sh --skip-sign --skip-notarize

# One-time per-machine setup: create the `Tug Dev` self-signed code-
# signing identity in the login keychain. `test-in-app` re-signs
# Tug.app with this identity after xcodebuild so the signature hash
# stays stable across rebuilds — the Accessibility permission grant
# persists across runs instead of being invalidated on every rebuild
# (which is what ad-hoc signing does).
#
# Idempotent: no-op if `Tug Dev` already exists.
setup-dev-signing:
    scripts/setup-dev-signing.sh

# Run the in-app tests (harness smoke + M01/M03/M16) against a fresh
# DEBUG Tug.app. Boots the app in dev mode via an isolated scratch
# tugbank so your real ~/.tugbank.db is untouched. Requires tmux and
# a prior `just build` (for tugbank / tugutil on PATH), plus a
# one-time `just setup-dev-signing` to install the local code-signing
# identity.
test-in-app:
    #!/usr/bin/env bash
    set -euo pipefail
    REPO_ROOT="$(pwd)"
    SCRATCH_DB="$(mktemp -t tugapp-inapp.XXXX).db"
    SIGNING_IDENTITY="Tug Dev"

    command -v tmux >/dev/null || { echo "tmux not on PATH — brew install tmux"; exit 1; }
    command -v tugbank >/dev/null || { echo "tugbank not on PATH — run 'just build' first"; exit 1; }

    # Verify the per-machine code-signing identity exists. Without it,
    # xcodebuild would fall back to ad-hoc signing and the Accessibility
    # grant would be invalidated on every rebuild (CGEvent.post silently
    # no-ops without the grant).
    #
    # Note: we use `find-identity -p codesigning` WITHOUT `-v` — a self-
    # signed identity registers as CSSMERR_TP_NOT_TRUSTED (no system-wide
    # root trust), which the `-v` filter hides. codesign doesn't care:
    # setup-dev-signing.sh whitelists codesign via `-T /usr/bin/codesign`
    # on import.
    if ! security find-identity -p codesigning | grep -q "\"$SIGNING_IDENTITY\""; then
        echo "error: '$SIGNING_IDENTITY' code-signing identity not found in login keychain." >&2
        echo "       Run: just setup-dev-signing" >&2
        exit 1
    fi

    echo "==> [1/7] Rust debug binaries"
    (cd tugrust && cargo build -p tugcast -p tugexec -p tugutil -p tugrelaunch -p tugbank)
    bun build --compile tugcode/src/main.ts --outfile tugrust/target/debug/tugcode

    echo "==> [2/7] tugdeck deps + prebuilt dist"
    (cd tugdeck && bun install && bun run build)

    echo "==> [3/7] tests/in-app deps"
    (cd tests/in-app && bun install)

    echo "==> [4/7] Build Tug.app (Debug)"
    find tugapp/Sources -name '*.swift' -exec touch {} +
    # xcodebuild is very noisy (~800 lines of SwiftDriver/SwiftCompile phase
    # headers + indented command-line invocations) even on a clean build.
    # Capture the full log to a temp file, then on success show only the
    # signal (warnings, errors, BUILD banner). On failure, dump the full
    # log so the user can diagnose — nothing is hidden when it matters.
    XCODE_LOG="$(mktemp -t tugapp-xcode.XXXX.log)"
    if xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug \
        -configuration Debug -destination 'platform=macOS,arch=arm64' build \
        > "$XCODE_LOG" 2>&1; then
        # Print warnings, compiler/linker errors, and the BUILD banner.
        # `grep || true` tolerates a clean build (no matches).
        grep -E '^\*\*|warning:|error:|^ld: |^clang: |^Undefined' "$XCODE_LOG" || true
        # If the build was fully clean, grep prints nothing — surface the
        # banner explicitly so the user sees a success signal.
        grep -q '^\*\* BUILD' "$XCODE_LOG" || echo "** BUILD SUCCEEDED **"
        rm -f "$XCODE_LOG"
    else
        status=$?
        echo "==> xcodebuild failed (status $status), full log:"
        cat "$XCODE_LOG"
        rm -f "$XCODE_LOG"
        exit "$status"
    fi
    APP_DIR="$(xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug \
        -configuration Debug -destination 'platform=macOS,arch=arm64' \
        -showBuildSettings 2>/dev/null | awk '/ BUILT_PRODUCTS_DIR /{print $3}')/Tug.app"
    APP_BIN="$APP_DIR/Contents/MacOS/Tug"
    [ -x "$APP_BIN" ] || { echo "Tug.app binary missing: $APP_BIN"; exit 1; }

    # Re-sign the built app bundle with the stable local identity so
    # the signature hash doesn't change between rebuilds — preserves
    # the Accessibility grant across the test loop. `--force` replaces
    # xcodebuild's ad-hoc signature; `--deep` ensures nested frameworks
    # (if any) get the same identity; `--preserve-metadata=...` keeps
    # the entitlements + designated-requirement string intact.
    echo "==> [4b/7] Re-sign with '$SIGNING_IDENTITY' for stable AX grant"
    codesign --sign "$SIGNING_IDENTITY" --force --deep \
        --preserve-metadata=entitlements,requirements \
        "$APP_DIR" 2>&1 | grep -v 'replacing existing signature' || true
    echo "    Tug.app binary: $APP_BIN"

    echo "==> [5/7] Scratch tugbank (dev mode + source tree at $REPO_ROOT)"
    TUGBANK_PATH="$SCRATCH_DB" tugbank write dev.tugtool.app source-tree-path "$REPO_ROOT"
    TUGBANK_PATH="$SCRATCH_DB" tugbank write dev.tugtool.app dev-mode-enabled true

    echo "==> [6/7] Kill any stale Tug processes and free vite port 55155"
    # Leaked Tug AND tugcast instances from a previous run will hold
    # tugbank locks, mess with the Dock, and race on ports 55155 and
    # 55255. tugcast outlives Tug when the prior run ended via
    # SIGTERM (`app.close()`) instead of the graceful path.
    pkill -x Tug 2>/dev/null || true
    pkill -x tugcast 2>/dev/null || true
    sleep 0.3
    if PID="$(lsof -ti tcp:55155 2>/dev/null)"; then kill "$PID" 2>/dev/null || true; sleep 0.5; fi

    # Ensure we clean up on exit no matter how we got here (Ctrl-C,
    # test crash, just-recipe error). pkill is idempotent and safe.
    cleanup() {
        pkill -x Tug 2>/dev/null || true
        pkill -x tugcast 2>/dev/null || true
        rm -f "$SCRATCH_DB"
    }
    trap cleanup EXIT INT TERM

    echo "==> [7/7] Run in-app tests (sequentially, one Tug.app per file)"
    export TUGBANK_PATH="$SCRATCH_DB"
    export TUGAPP_IN_APP_TEST=1
    export TUGAPP_DEBUG_PATH="$APP_BIN"
    export TUGAPP_TUGCODE_BINARY="$REPO_ROOT/tugrust/target/debug/tugcode"
    # tugbank binary path (selection plan Step 25C.2 Layer 2). Used
    # by `tests/in-app/_harness/tugbank-helpers.ts` for cold-boot
    # disk-side reads.
    export TUGAPP_TUGBANK_BINARY="$REPO_ROOT/tugrust/target/debug/tugbank"
    cd tests/in-app
    STATUS=0
    for f in _smoke.test.ts _smoke-native.test.ts _smoke-cold-boot.test.ts _smoke-app-reload.test.ts _smoke-capture-phase-save.test.ts m01-tab-switch-fc.test.ts m03-pane-activation.test.ts m16-tab-close-handoff.test.ts m24-prompt-state-roundtrip.test.ts m25-prompt-deactivated-roundtrip.test.ts m37-deck-wide-restore-consistency.test.ts m38-deactivation-inactive-paint.test.ts m36-inactive-card-app-switch-selection.test.ts; do
        echo "---- $f ----"
        bun test "$f" || STATUS=$?
        # Between files, kill any stragglers so port 55155 is free
        # and Dock icons don't accumulate. The harness's wrappedKill
        # already pkills tugcast on `app.close()`, so the between-
        # file pkill stays Tug-only to keep the inter-file pause
        # short (extra pkills disturb WindowServer activation
        # state, surfacing as Finder-activation races in tests).
        pkill -x Tug 2>/dev/null || true
        sleep 0.3
    done

    exit $STATUS

# Fast iteration variant of `test-in-app`. Skips the full rebuild
# (cargo, tugdeck, scratch-bank setup, tmux) and runs the in-app test
# sweep directly against the already-built, stable-signed Tug.app.
# Useful when iterating on a single test file or on tugdeck source
# (vite HMR picks up tugdeck changes live). Swift changes still
# require a rebuild — use `just test-in-app` for those.
#
# Prerequisites (same as test-in-app, run once per machine):
#   just setup-dev-signing                 # creates 'Tug Dev' identity
#   just test-in-app                       # builds Tug.app + signs it
#
# Usage:
#   just test-in-app-fast                  # runs default sweep
#   just test-in-app-fast m03-pane-activation.test.ts
#                                          # runs only the named file
#   just test-in-app-fast _smoke-native.test.ts m03-pane-activation.test.ts
#                                          # runs specific files in order
#
# Re-signs with 'Tug Dev' on every invocation so a bare xcodebuild in
# between runs cannot invalidate the Accessibility grant. Re-signing
# is idempotent and fast (~100ms).
test-in-app-fast *FILES:
    #!/usr/bin/env bash
    set -euo pipefail

    # Locate the already-built Tug.app via xcodebuild's settings
    # query (instant — no compilation).
    APP_DIR="$(xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug \
        -configuration Debug -destination 'platform=macOS,arch=arm64' \
        -showBuildSettings 2>/dev/null | awk '/ BUILT_PRODUCTS_DIR /{print $3}')/Tug.app"
    APP_BIN="$APP_DIR/Contents/MacOS/Tug"
    if [ ! -x "$APP_BIN" ]; then
        echo "error: Tug.app binary missing at $APP_BIN" >&2
        echo "       Run 'just test-in-app' first for a full build + sign." >&2
        exit 1
    fi

    # Re-sign with the stable identity so the AX grant persists across
    # iterations. No-op fast path when the identity isn't present
    # (lets the recipe work on a machine without dev-signing set up,
    # though tests requiring AX will fail).
    if security find-identity -p codesigning 2>/dev/null | grep -q '"Tug Dev"'; then
        codesign --sign "Tug Dev" --force --deep \
            --preserve-metadata=entitlements,requirements \
            "$APP_DIR" >/dev/null 2>&1 || true
    fi

    # Refresh tugdeck/dist so the harness (which loads from prod-built
    # static files via tugcast's ServeDir, not Vite — see TUGAPP_IN_APP_TEST
    # branch in AppDelegate.loadPreferences) reflects the current source.
    # Vite is fast for incremental builds (~200ms when nothing changed,
    # ~1.5s on first run after a source edit). Skipping Vite at launch
    # time is worth ~700ms per launch on cold disk, so the trade is
    # decisively in favor of building once up-front.
    (cd tugdeck && bun run build >/dev/null)

    # Clean slate: kill stale Tug AND tugcast processes before the
    # first spawn. tugcast lives in its own process group; a prior
    # run that ended via `app.close()` (SIGTERM, not the graceful
    # path) leaks it past Tug's death and causes port-55255
    # collisions on the next launch.
    pkill -x Tug 2>/dev/null || true
    pkill -x tugcast 2>/dev/null || true
    sleep 0.3

    # Clean up on exit so a Ctrl-C or test crash leaves no orphans.
    cleanup() {
        pkill -x Tug 2>/dev/null || true
        pkill -x tugcast 2>/dev/null || true
    }
    trap cleanup EXIT INT TERM

    export TUGAPP_IN_APP_TEST=1
    export TUGAPP_DEBUG_PATH="$APP_BIN"
    # tugcode binary path (Pass 7A — harness Step 5). Located via
    # `bun build --compile` in `just test-in-app`'s [1/7] step.
    REPO_ROOT_FAST="$(pwd)"
    export TUGAPP_TUGCODE_BINARY="$REPO_ROOT_FAST/tugrust/target/debug/tugcode"
    # tugbank binary path (selection plan Step 25C.2 Layer 2). Used
    # by `tests/in-app/_harness/tugbank-helpers.ts` to read tugbank
    # state from disk between two-process cold-boot phases.
    export TUGAPP_TUGBANK_BINARY="$REPO_ROOT_FAST/tugrust/target/debug/tugbank"
    cd tests/in-app

    # Default sweep mirrors `test-in-app`'s loop.
    FILES_INPUT="{{FILES}}"
    if [ -z "$FILES_INPUT" ]; then
        FILES=(_smoke.test.ts _smoke-native.test.ts _smoke-em.test.ts _smoke-cold-boot.test.ts _smoke-app-reload.test.ts _smoke-capture-phase-save.test.ts m01-tab-switch-fc.test.ts m01-rapid-cadence.test.ts m02-tab-switch-em.test.ts m03-pane-activation.test.ts m03-rapid-cadence.test.ts m16-tab-close-handoff.test.ts m16-rapid-cadence.test.ts m06-cross-pane-drag.test.ts m06-em-cross-pane.test.ts m07-card-detach.test.ts m07-em-card-detach.test.ts m09-em-inactive-mount.test.ts m21-drag-aborted.test.ts m04-app-resign-return.test.ts m05-app-hide-unhide.test.ts m10-markdown-selection.test.ts m10-cold-boot-selection.test.ts m14-scroll-persistence.test.ts m14-cold-boot-scroll.test.ts m17-savestate-rpc-parity.test.ts m18-async-content-race.test.ts m19-pane-teardown-flush.test.ts m20-overlay-focus-return.test.ts m22-caret-visibility.test.ts m23-cross-card-selection.test.ts m24-prompt-state-roundtrip.test.ts m25-prompt-deactivated-roundtrip.test.ts m26-overlay-persistence.test.ts m27-layout-state-persistence.test.ts m30-virtual-focus.test.ts m31-prompt-entry-chrome.test.ts m32-em-cold-boot-selection.test.ts m33-em-fresh-card-activation.test.ts m34-em-focus-after-move.test.ts m35-em-app-switch-selection.test.ts m35-tide-app-switch-selection.test.ts m36-inactive-card-app-switch-selection.test.ts m37-deck-wide-restore-consistency.test.ts m38-deactivation-inactive-paint.test.ts)
    else
        read -r -a FILES <<< "$FILES_INPUT"
    fi

    STATUS=0
    for f in "${FILES[@]}"; do
        echo "---- $f ----"
        bun test "$f" || STATUS=$?
        # Between files, kill stragglers so port 55155 is free and
        # Dock icons don't accumulate. The harness's wrappedKill
        # already pkills tugcast on `app.close()`, so the between-
        # file pkill stays Tug-only — extra pkills disturb
        # WindowServer activation state and surface as Finder-
        # activation races in subsequent tests.
        pkill -x Tug 2>/dev/null || true
        sleep 0.3
    done
    exit $STATUS

# Clean Rust targets and Mac app build artifacts
clean:
    cd tugrust && cargo clean
    xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -destination 'platform=macOS,arch=arm64' clean 2>/dev/null || true
    rm -rf tugapp/build
