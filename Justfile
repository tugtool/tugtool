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
# signing identity in the login keychain. `build-app` re-signs
# Tug.app with this identity after xcodebuild so the signature hash
# stays stable across rebuilds — the Accessibility permission grant
# persists across runs instead of being invalidated on every rebuild
# (which is what ad-hoc signing does).
#
# Idempotent: no-op if `Tug Dev` already exists.
setup-dev-signing:
    scripts/setup-dev-signing.sh

# Build Tug.app (Debug) end-to-end: Rust debug binaries, tugdeck deps
# + production dist, app-test deps, xcodebuild, and a re-sign with the
# local `Tug Dev` identity so the Accessibility grant persists across
# rebuilds. After this finishes, run `just app-test` to run tests.
#
# Prereqs (one-time per machine):
#   just setup-dev-signing                 # creates 'Tug Dev' identity
build-app:
    #!/usr/bin/env bash
    set -euo pipefail
    SIGNING_IDENTITY="Tug Dev"

    # Verify the per-machine code-signing identity exists. Without it,
    # xcodebuild falls back to ad-hoc signing and the Accessibility
    # grant is invalidated on every rebuild (CGEvent.post silently
    # no-ops without the grant).
    #
    # Note: `find-identity -p codesigning` WITHOUT `-v` — a self-
    # signed identity registers as CSSMERR_TP_NOT_TRUSTED (no system
    # root trust), which the `-v` filter hides. codesign doesn't
    # care; setup-dev-signing.sh whitelists codesign via
    # `-T /usr/bin/codesign` on import.
    if ! security find-identity -p codesigning | grep -q "\"$SIGNING_IDENTITY\""; then
        echo "error: '$SIGNING_IDENTITY' code-signing identity not found in login keychain." >&2
        echo "       Run: just setup-dev-signing" >&2
        exit 1
    fi

    echo "==> [1/5] Rust debug binaries"
    (cd tugrust && cargo build -p tugcast -p tugexec -p tugutil -p tugrelaunch -p tugbank)
    bun build --compile tugcode/src/main.ts --outfile tugrust/target/debug/tugcode

    echo "==> [2/5] tugdeck deps + prebuilt dist"
    (cd tugdeck && bun install && bun run build)

    echo "==> [3/5] tests/app-test deps"
    (cd tests/app-test && bun install)

    echo "==> [4/5] Build Tug.app (Debug)"
    find tugapp/Sources -name '*.swift' -exec touch {} +
    # xcodebuild is very noisy (~800 lines of SwiftDriver/SwiftCompile
    # phase headers + indented invocations) even on a clean build.
    # Capture the full log; on success show only the signal (warnings,
    # errors, BUILD banner). On failure, dump the full log so the user
    # can diagnose.
    XCODE_LOG="$(mktemp -t tugapp-xcode.XXXX.log)"
    if xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug \
        -configuration Debug -destination 'platform=macOS,arch=arm64' build \
        > "$XCODE_LOG" 2>&1; then
        grep -E '^\*\*|warning:|error:|^ld: |^clang: |^Undefined' "$XCODE_LOG" || true
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

    # Re-sign with the stable local identity. `--force` replaces the
    # ad-hoc signature; `--deep` covers nested frameworks;
    # `--preserve-metadata=...` keeps entitlements + the designated
    # requirement string intact.
    #
    # We capture codesign's combined output to a temp file and check
    # the exit code explicitly. The previous shape
    # (`codesign ... | grep -v ... || true`) swallowed codesign
    # failures because the trailing `|| true` neutralized the pipe's
    # non-zero exit (PIPESTATUS[0] under `set -o pipefail`).
    echo "==> [5/5] Re-sign with '$SIGNING_IDENTITY' for stable AX grant"
    CODESIGN_LOG="$(mktemp -t tugapp-codesign.XXXX.log)"
    if ! codesign --sign "$SIGNING_IDENTITY" --force --deep \
        --preserve-metadata=entitlements,requirements \
        "$APP_DIR" > "$CODESIGN_LOG" 2>&1; then
        echo "error: codesign --sign failed:" >&2
        cat "$CODESIGN_LOG" >&2
        rm -f "$CODESIGN_LOG"
        exit 1
    fi
    # Filter the noise line ('replacing existing signature') but keep
    # everything else — warnings about deprecated flags, etc., should
    # surface even on success.
    grep -v 'replacing existing signature' "$CODESIGN_LOG" || true
    rm -f "$CODESIGN_LOG"

    # Verify the bundle's signature is valid post re-sign. A botched
    # signature would otherwise only surface as an opaque WebKit /
    # AX failure when the test sweep runs.
    if ! codesign --verify --strict "$APP_DIR" 2>&1; then
        echo "error: codesign --verify --strict failed; bundle is invalid" >&2
        exit 1
    fi

    echo "    Tug.app binary: $APP_BIN"
    echo
    echo "==> Built. Now run 'just app-test' to run tests."

# Run the app-test suite against an already-built Tug.app. Each file
# launches its own Tug.app subprocess via the harness's
# `launchTugApp`. Output streams per-file as bun runs, and an
# end-of-run summary block follows — its last line is exactly
# `VERDICT: PASS` or `VERDICT: FAIL`, greppable via `tail -n 1`.
# Recipe exit code matches the verdict (0 iff PASS).
#
# Prereqs:
#   just setup-dev-signing                 # one-time; 'Tug Dev' identity
#   just build-app                         # build + sign Tug.app
#
# Usage:
#   just app-test                          # full sweep
#   just app-test at0001-tab-switch-fc.test.ts
#                                          # single file
#   just app-test harness-smoke/smoke.test.ts at0003-pane-activation.test.ts
#                                          # specific files in order
#
# Re-signs Tug.app with 'Tug Dev' on every invocation so a bare
# xcodebuild between runs cannot invalidate the Accessibility grant.
# Re-signing is idempotent and fast (~100ms).
app-test *FILES:
    #!/usr/bin/env bash
    # Deliberately NOT `set -e` — we want to keep iterating past per-
    # file failures so the summary captures every file's status.
    set -uo pipefail

    APP_DIR="$(xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug \
        -configuration Debug -destination 'platform=macOS,arch=arm64' \
        -showBuildSettings 2>/dev/null | awk '/ BUILT_PRODUCTS_DIR /{print $3}')/Tug.app"
    APP_BIN="$APP_DIR/Contents/MacOS/Tug"
    if [ ! -x "$APP_BIN" ]; then
        echo "error: Tug.app not built at $APP_BIN" >&2
        echo "       Run 'just build-app' first." >&2
        exit 1
    fi

    # Re-sign with the stable identity so the AX grant persists.
    # No-op fast path when the identity isn't installed (tests that
    # need AX will fail explicitly).
    if security find-identity -p codesigning 2>/dev/null | grep -q '"Tug Dev"'; then
        codesign --sign "Tug Dev" --force --deep \
            --preserve-metadata=entitlements,requirements \
            "$APP_DIR" >/dev/null 2>&1 || true
    fi

    # Refresh tugdeck/dist so the harness (which loads prod-built
    # static files via tugcast's ServeDir, not Vite — see the
    # TUGAPP_APP_TEST branch in AppDelegate.loadPreferences)
    # reflects current source.
    (cd tugdeck && bun run build >/dev/null)

    # Clean slate before the first spawn. tugcast lives in its own
    # process group; a prior `app.close()` SIGTERM leaks it past Tug's
    # death and causes port-55255 collisions on the next launch.
    pkill -x Tug 2>/dev/null || true
    pkill -x tugcast 2>/dev/null || true
    sleep 0.3

    TMPOUT="$(mktemp -t app-test.XXXXXX)"
    cleanup() {
        pkill -x Tug 2>/dev/null || true
        pkill -x tugcast 2>/dev/null || true
        rm -f "$TMPOUT"
    }
    trap cleanup EXIT INT TERM

    export TUGAPP_APP_TEST=1
    export TUGAPP_DEBUG_PATH="$APP_BIN"
    REPO_ROOT_FAST="$(pwd)"
    export TUGAPP_TUGCODE_BINARY="$REPO_ROOT_FAST/tugrust/target/debug/tugcode"
    # tugbank binary path used by tests/app-test/_harness/tugbank-helpers.ts
    # for cold-boot disk-side reads.
    export TUGAPP_TUGBANK_BINARY="$REPO_ROOT_FAST/tugrust/target/debug/tugbank"
    cd tests/app-test

    FILES_INPUT="{{FILES}}"
    if [ -z "$FILES_INPUT" ]; then
        FILES=(harness-smoke/smoke.test.ts harness-smoke/smoke-native.test.ts harness-smoke/smoke-em.test.ts harness-smoke/smoke-cold-boot.test.ts harness-smoke/smoke-app-reload.test.ts harness-smoke/smoke-capture-phase-save.test.ts at0001-tab-switch-fc.test.ts at0001-rapid-cadence.test.ts at0002-tab-switch-em.test.ts at0003-pane-activation.test.ts at0003-rapid-cadence.test.ts at0016-tab-close-handoff.test.ts at0016-rapid-cadence.test.ts at0006-cross-pane-drag.test.ts at0006-em-cross-pane.test.ts at0007-card-detach.test.ts at0007-em-card-detach.test.ts at0009-em-inactive-mount.test.ts at0021-drag-aborted.test.ts at0004-app-resign-return.test.ts at0005-app-hide-unhide.test.ts at0010-markdown-selection.test.ts at0010-cold-boot-selection.test.ts at0014-scroll-persistence.test.ts at0014-cold-boot-scroll.test.ts at0017-savestate-rpc-parity.test.ts at0018-async-content-race.test.ts at0019-pane-teardown-flush.test.ts at0020-overlay-focus-return.test.ts at0022-caret-visibility.test.ts at0023-cross-card-selection.test.ts at0024-prompt-state-roundtrip.test.ts at0025-prompt-deactivated-roundtrip.test.ts at0026-overlay-persistence.test.ts at0027-layout-state-persistence.test.ts at0030-virtual-focus.test.ts at0031-prompt-entry-chrome.test.ts at0032-em-cold-boot-selection.test.ts at0033-em-fresh-card-activation.test.ts at0034-em-focus-after-move.test.ts at0035-em-app-switch-selection.test.ts at0035-tide-app-switch-selection.test.ts at0036-inactive-card-app-switch-selection.test.ts at0037-deck-wide-restore-consistency.test.ts at0038-deactivation-inactive-paint.test.ts)
        SWEEP_LABEL="full"
    else
        read -r -a FILES <<< "$FILES_INPUT"
        SWEEP_LABEL="explicit-files"
    fi

    declare -a RESULT_ROWS=()
    declare -a FAILURE_BLOCKS=()
    START_EPOCH="$(date +%s)"

    for f in "${FILES[@]}"; do
        echo "---- $f ----"
        # bun's stdout/stderr both stream to the user's terminal AND
        # land in $TMPOUT for parsing. `tee` truncates without `-a`.
        if bun test "$f" 2>&1 | tee "$TMPOUT"; then
            rc=0
        else
            rc="${PIPESTATUS[0]}"
        fi
        # Bun emits "  N pass\n  N fail" near the end of each file.
        # Match the LAST occurrence so per-test mentions earlier in
        # the output do not confuse the count.
        passed="$(grep -E '^[ \t]*[0-9]+ pass$' "$TMPOUT" | tail -n 1 | grep -oE '[0-9]+' | head -n 1)"
        failed="$(grep -E '^[ \t]*[0-9]+ fail$' "$TMPOUT" | tail -n 1 | grep -oE '[0-9]+' | head -n 1)"
        passed="${passed:-0}"
        failed="${failed:-0}"
        total=$((passed + failed))

        if [ "$rc" -eq 0 ] && [ "$total" -eq 0 ]; then
            RESULT_ROWS+=("SKIP:$f:0:0")
        elif [ "$rc" -eq 0 ]; then
            RESULT_ROWS+=("PASS:$f:$passed:$total")
        elif [ "$total" -gt 0 ]; then
            RESULT_ROWS+=("FAIL:$f:$passed:$total")
            FAILURE_BLOCKS+=("$f"$'\n'"$(cat "$TMPOUT")")
        else
            RESULT_ROWS+=("ERR:$f:0:0")
            FAILURE_BLOCKS+=("$f"$'\n'"$(cat "$TMPOUT")")
        fi

        # Between files, kill stragglers. Tug-only — pkilling tugcast
        # here disturbs WindowServer state and surfaces as Finder-
        # activation races in subsequent tests; the harness's
        # wrappedKill already pkills tugcast on `app.close()`.
        pkill -x Tug 2>/dev/null || true
        sleep 0.3
    done

    END_EPOCH="$(date +%s)"
    ELAPSED=$((END_EPOCH - START_EPOCH))

    files_run=${#FILES[@]}
    files_passed=0
    files_failed=0
    files_errored=0
    files_skipped=0
    tests_passed_total=0
    tests_total=0
    for row in "${RESULT_ROWS[@]}"; do
        IFS=':' read -r status _file rpassed rtotal <<< "$row"
        case "$status" in
            PASS) files_passed=$((files_passed + 1)) ;;
            FAIL) files_failed=$((files_failed + 1)) ;;
            ERR)  files_errored=$((files_errored + 1)) ;;
            SKIP) files_skipped=$((files_skipped + 1)) ;;
        esac
        tests_passed_total=$((tests_passed_total + rpassed))
        tests_total=$((tests_total + rtotal))
    done

    BANNER="========================================================"
    echo
    echo "$BANNER"
    echo "APP-TEST SUMMARY"
    echo "$BANNER"
    printf '%-14s  %s\n' 'Sweep:' "$SWEEP_LABEL"
    printf '%-14s  %d\n' 'Files run:' "$files_run"
    printf '%-14s  %d\n' 'Files passed:' "$files_passed"
    printf '%-14s  %d\n' 'Files failed:' "$files_failed"
    printf '%-14s  %d\n' 'Files errored:' "$files_errored"
    [ "$files_skipped" -gt 0 ] && printf '%-14s  %d\n' 'Files skipped:' "$files_skipped"
    if [ "$ELAPSED" -lt 60 ]; then
        printf '%-14s  %ds\n' 'Wall time:' "$ELAPSED"
    else
        printf '%-14s  %dm %ds\n' 'Wall time:' $((ELAPSED / 60)) $((ELAPSED % 60))
    fi

    echo
    echo "Per-file results:"
    for row in "${RESULT_ROWS[@]}"; do
        IFS=':' read -r status file rpassed rtotal <<< "$row"
        printf '  %-6s %-56s (%d/%d)\n' "[$status]" "$file" "$rpassed" "$rtotal"
    done

    if [ ${#FAILURE_BLOCKS[@]} -gt 0 ]; then
        echo
        echo "Failures:"
        for blk in "${FAILURE_BLOCKS[@]}"; do
            file="${blk%%$'\n'*}"
            echo "  $file"
            # Surface bun's per-test "(fail) ..." lines for quick diagnosis.
            printf '%s\n' "$blk" | grep -E '^\(fail\) ' | sed 's/^/    > /' || true
        done
    fi

    echo "$BANNER"
    if [ "$files_failed" -eq 0 ] && [ "$files_errored" -eq 0 ]; then
        printf 'VERDICT: PASS  (%d/%d files green; %d/%d tests passed)\n' \
            "$files_passed" "$files_run" "$tests_passed_total" "$tests_total"
        exit 0
    else
        printf 'VERDICT: FAIL  (%d/%d files green; %d file(s) failed; %d/%d tests passed)\n' \
            "$files_passed" "$files_run" $((files_failed + files_errored)) "$tests_passed_total" "$tests_total"
        exit 1
    fi

# Clean Rust targets and Mac app build artifacts
clean:
    cd tugrust && cargo clean
    xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -destination 'platform=macOS,arch=arm64' clean 2>/dev/null || true
    rm -rf tugapp/build
