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

# Build every WASM crate under tugdeck/crates/ via scripts/build-wasm.sh.
# The script auto-discovers crates by globbing tugdeck/crates/*/Cargo.toml
# and normalizes pkg/.gitignore so the built artifacts can be committed
# without `git add -f`. See tuglaws/wasm-crates.md for the convention.
wasm:
    scripts/build-wasm.sh

# Build the Mac app (with all dependencies), and run/restart it.
#
# Signing: after xcodebuild's ad-hoc signing, the recipe re-signs via
# tugrust/scripts/sign-bundle.sh — inside-out, per [D16] of
# roadmap/tug-multi-instance.md. This gives the dev bundle a stable
# designated requirement (signed by Apple Developer ID) so the AX
# grant persists across rebuilds. Without it, every rebuild would
# invalidate the grant.
#
# (Note: Step 15 of the multi-instance plan will retire this recipe
# in favor of `just app-dev`. Until then, this is the canonical dev
# loop.)
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
    echo "==> Re-signing with Developer ID for stable AX grant"
    bash tugrust/scripts/sign-bundle.sh "$APP_DIR"
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

# Run/restart Tug.app using whatever's already built — no Rust, wasm,
# tugdeck, or xcodebuild work. Useful when only Swift-untouched assets
# (e.g. tugdeck dist via HMR or a prior `bun run build`) need to be
# picked up, or to relaunch after a manual quit.
launch:
    #!/usr/bin/env bash
    set -euo pipefail
    APP_DIR="$(xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug -destination 'platform=macOS,arch=arm64' -showBuildSettings 2>/dev/null | grep -m1 'BUILT_PRODUCTS_DIR' | awk '{print $3}')/Tug.app"
    if [ ! -d "$APP_DIR" ]; then
        echo "error: Tug.app not built at $APP_DIR" >&2
        echo "       Run 'just app' (or 'just build-app') first." >&2
        exit 1
    fi
    echo "==> Launching Tug.app"
    tugbank write dev.tugexec.app source-tree-path "$(pwd)"
    TUG_PID=$(pgrep -x Tug 2>/dev/null || true)
    if [ -n "$TUG_PID" ]; then
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

# Same body as `logs`. The discoverable name makes intent obvious
# when grepping `just --list`; reach for this when triaging
# session-lifecycle / replay issues.
# Tail today's tugcast log (alias for `logs`).
tail-tugcast:
    #!/usr/bin/env bash
    set -euo pipefail
    DATE="$(date +%Y-%m-%d)"
    LOG="$HOME/Library/Application Support/Tug/Logs/tugcast.log.$DATE"
    if [ ! -f "$LOG" ]; then
        echo "No log yet for $DATE at $LOG. Launch Tug.app with 'just app' first."
        exit 1
    fi
    tail -F "$LOG"

# Use this during smoke runs (see
# `roadmap/tugplan-tide-transcript-resume-smoke.md`) so the relevant
# `[tide::replay::started|progress|complete|error]` and
# `[tide::session-lifecycle event=...]` lines stand out without the
# full firehose. `--line-buffered` keeps grep's output flowing live
# even when the pipe stage downstream block-buffers.
# Tail tugcast log filtered to replay + lifecycle targets.
tail-replay:
    #!/usr/bin/env bash
    set -euo pipefail
    DATE="$(date +%Y-%m-%d)"
    LOG="$HOME/Library/Application Support/Tug/Logs/tugcast.log.$DATE"
    if [ ! -f "$LOG" ]; then
        echo "No log yet for $DATE at $LOG. Launch Tug.app with 'just app' first."
        exit 1
    fi
    tail -F "$LOG" | grep --line-buffered -E "tide::replay::|tide::session-lifecycle"

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

# Build unsigned DMG (no Developer ID, no notarization). Fastest
# distribution-shape artifact; suitable for sharing a build locally
# (e.g., to a tester on the same Mac) but Gatekeeper will reject it
# on a clean machine.
dmg:
    tugrust/scripts/build-app.sh --skip-sign --skip-notarize

# Build a signed + notarized DMG. Submits to Apple's notary service
# and waits for the ticket (typically 5-15 min, ceiling 30 min via
# notarytool --timeout). Requires the `tug-notary` keychain profile
# from #apple-prereqs and an active network connection.
#
# Prereqs (one-time per machine):
#   just setup-dev-signing                 # verifies Developer ID cert
#   # plus #apple-prereqs step 5:
#   #   xcrun notarytool store-credentials tug-notary \
#   #       --apple-id <apple-id> --team-id <team-id> --password <app-password>
#
# This is the canonical distribution build. Use `just dmg` for the
# fast unsigned variant.
notarize:
    tugrust/scripts/build-app.sh

# One-time per-machine signing check. Verifies that an Apple
# Developer ID Application certificate is installed in the login
# keychain (the identity every Tug build signs with per [D11]).
# Prints actionable instructions if the cert is missing — the
# install is a one-click flow via Xcode → Settings → Accounts.
#
# Idempotent: prints success and exits 0 when the cert is present.
#
# Renamed-in-spirit: this used to provision a self-signed `Tug Dev`
# cert via openssl. Real Developer ID certs have stable designated
# requirements (signed by Apple), so TCC Accessibility grants
# persist across rebuilds without a fragile self-signed shim.
setup-dev-signing:
    scripts/setup-dev-signing.sh

# Clear the per-machine code-sign drift sentinel. Use this if the
# `.tugtool/code-sign-fingerprint` file ever gets out of sync (e.g.
# after manually re-issuing the Developer ID cert in Xcode).
#
# Does NOT touch the Developer ID cert in the login keychain — that's
# the user's Apple-issued identity, not project-specific.
#
# Idempotent: reports "nothing to remove" and exits 0 if the
# sentinel doesn't exist.
teardown-dev-signing:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -f .tugtool/code-sign-fingerprint ]; then
        rm -f .tugtool/code-sign-fingerprint
        echo "✓ Sentinel .tugtool/code-sign-fingerprint cleared."
    else
        echo ".tugtool/code-sign-fingerprint not present; nothing to remove."
    fi
    echo
    echo "Note: the Developer ID Application cert in the login keychain"
    echo "      is intentionally preserved. To remove it, use Keychain"
    echo "      Access manually (it's your Apple-issued identity, not a"
    echo "      project-scoped self-signed cert)."
    echo
    echo "Next: 'just build-app' will rebuild the sentinel on first run."

# Build Tug.app (Debug) end-to-end: Rust debug binaries, tugdeck deps
# + production dist, app-test deps, xcodebuild, and a re-sign with the
# user's Developer ID Application identity (per [D11]) so the
# designated requirement is stable across rebuilds and the
# Accessibility grant persists. After this finishes, run `just
# app-test` to run tests.
#
# Prereqs (one-time per machine):
#   just setup-dev-signing                 # verifies Developer ID cert
build-app:
    #!/usr/bin/env bash
    set -euo pipefail

    # Verify the Developer ID Application identity is present. Without
    # it, the dev-loop AX grant story breaks (ad-hoc signing produces
    # per-build cdhash DRs, invalidating the grant on every rebuild).
    if ! security find-identity -v -p codesigning 2>/dev/null \
            | grep -q "Developer ID Application:"; then
        echo "error: Developer ID Application identity not found in login keychain." >&2
        echo "       Run: just setup-dev-signing" >&2
        exit 1
    fi
    SIGNING_IDENTITY="$(
        security find-identity -v -p codesigning 2>/dev/null \
            | awk -F'"' '/Developer ID Application:/ {print $2; exit}'
    )"

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

    # Re-sign inside-out with Developer ID per [D16]. The script
    # walks the bundle, signs each Rust helper with default hardened
    # runtime, signs tugcode with the bun-permissive entitlements,
    # then seals the outer .app with Tug.entitlements. `--deep` is
    # intentionally absent — see tugrust/scripts/sign-bundle.sh.
    echo "==> [5/5] Re-sign inside-out with Developer ID"
    bash tugrust/scripts/sign-bundle.sh "$APP_DIR" "$SIGNING_IDENTITY"

    # Capture the bundle's designated requirement (DR) into a
    # sentinel so subsequent `app-test` runs can detect drift. Under
    # Developer ID signing the DR is stable across rebuilds (signed
    # by an Apple intermediate), so this is now belt-and-suspenders
    # rather than load-bearing — but the comparison still catches
    # the case where someone replaces the Developer ID cert in the
    # keychain and the new cert produces a different DR string.
    #
    # `sed -nE 's/^#?[[:space:]]*designated[[:space:]]+=>[[:space:]]+(.*)$/\1/p'`
    # tolerates both the `# designated => ...` form (ad-hoc) and the
    # `designated => identifier "..." and anchor apple generic ...`
    # form (Developer ID).
    SENTINEL_DIR=".tugtool"
    SENTINEL_FILE="${SENTINEL_DIR}/code-sign-fingerprint"
    CURRENT_DR="$(codesign -d -r- "$APP_DIR" 2>&1 | sed -nE 's/^#?[[:space:]]*designated[[:space:]]+=>[[:space:]]+(.*)$/\1/p' | head -1)"
    if [ -z "$CURRENT_DR" ]; then
        echo "warn: could not extract designated requirement; skipping fingerprint capture" >&2
    else
        mkdir -p "$SENTINEL_DIR"
        SENTINEL_TMP="$(mktemp "${SENTINEL_DIR}/code-sign-fp.XXXXXX")"
        printf '%s\n' "$CURRENT_DR" > "$SENTINEL_TMP"
        mv "$SENTINEL_TMP" "$SENTINEL_FILE"
        echo "    Sentinel: $SENTINEL_FILE"
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
#
# Env var:
#   APP_TEST_SKIP_RESIGN=1   # bypass the re-sign step; useful for
#                            # first-time onboarding before
#                            # 'just setup-dev-signing' has run, or
#                            # when diagnosing whether the re-sign
#                            # itself is the culprit. Tests requiring
#                            # AX-granted CGEvent.post will fail
#                            # without a properly-signed bundle.
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

    # Compute the bundle's current designated requirement (DR) ONCE,
    # plus the sentinel value from the last successful `build-app`.
    # Both the early-skip optimization and the post-resign drift check
    # reuse them.
    SENTINEL_FILE=".tugtool/code-sign-fingerprint"
    DR_EXTRACT='s/^#?[[:space:]]*designated[[:space:]]+=>[[:space:]]+(.*)$/\1/p'
    CURRENT_DR="$(codesign -d -r- "$APP_DIR" 2>&1 | sed -nE "$DR_EXTRACT" | head -1)"
    SAVED_DR=""
    if [ -f "$SENTINEL_FILE" ]; then
        SAVED_DR="$(cat "$SENTINEL_FILE")"
    fi

    # Optimization: if the bundle DR already matches the sentinel,
    # the bundle is signed with the same identity that's behind the
    # AX grant — re-signing would be a no-op. Skip it.
    #
    # Falls through to the re-sign branch when:
    #   - DR extraction failed (CURRENT_DR is empty — happens for
    #     pure ad-hoc bundles that haven't been Developer-ID-signed
    #     yet, since `# designated => cdhash H"..."` is preserved
    #     by the sed pattern but represents an ad-hoc cdhash that
    #     won't match a real Developer ID DR string),
    #   - sentinel doesn't exist yet (first run after teardown +
    #     setup, or before first build-app),
    #   - DR mismatches sentinel (Xcode IDE Build between runs,
    #     or the user re-issued their Developer ID cert).
    if [ -n "$CURRENT_DR" ] && [ -n "$SAVED_DR" ] && [ "$CURRENT_DR" = "$SAVED_DR" ]; then
        echo "==> Re-sign skipped (bundle DR matches sentinel)"
    else
        # Re-sign inside-out with Developer ID per [D16] so the DR
        # matches what build-app produced. Three branches:
        #   - Identity present: re-sign via sign-bundle.sh; on failure
        #     exit non-zero with a diagnostic.
        #   - Identity missing AND APP_TEST_SKIP_RESIGN=1: print a
        #     notice and skip. Useful for first-time onboarding.
        #   - Identity missing without the opt-out: exit non-zero
        #     with an actionable message.
        if security find-identity -v -p codesigning 2>/dev/null \
                | grep -q "Developer ID Application:"; then
            if ! bash tugrust/scripts/sign-bundle.sh "$APP_DIR" >/dev/null 2>&1; then
                echo "error: sign-bundle.sh failed during app-test setup" >&2
                bash tugrust/scripts/sign-bundle.sh "$APP_DIR" >&2 || true
                exit 1
            fi
        elif [ "${APP_TEST_SKIP_RESIGN:-}" = "1" ]; then
            echo "==> APP_TEST_SKIP_RESIGN=1: skipping re-sign (Developer ID identity not found)"
        else
            echo "error: Developer ID Application identity missing from login keychain." >&2
            echo "       Run 'just setup-dev-signing' to verify install," >&2
            echo "       or set APP_TEST_SKIP_RESIGN=1 to bypass." >&2
            echo "       See tests/app-test/README.md → 'Accessibility grant" >&2
            echo "       failure modes' for diagnosis." >&2
            exit 1
        fi

        # Drift detection: re-extract the post-resign DR and compare
        # against the sentinel. A mismatch here means the saved DR
        # references a cert different from the current one (cert
        # re-issued). We warn but don't fatal — the user may have
        # re-granted AX manually; if AX is actually broken the
        # harness's per-spawn preflight will throw
        # AccessibilityPermissionMissingError with full context.
        POST_DR="$(codesign -d -r- "$APP_DIR" 2>&1 | sed -nE "$DR_EXTRACT" | head -1)"
        if [ -z "$POST_DR" ]; then
            echo "[warn] code-sign: could not extract designated requirement from $APP_DIR" >&2
        elif [ -n "$SAVED_DR" ] && [ "$POST_DR" != "$SAVED_DR" ]; then
            echo "[warn] code-sign fingerprint drift detected." >&2
            echo "       Saved : $SAVED_DR" >&2
            echo "       Current: $POST_DR" >&2
            echo "       AX grant likely invalidated; see tests/app-test/README.md" >&2
            echo "       § 'Accessibility grant failure modes' for diagnosis." >&2
        fi
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
        FILES=(harness-smoke/smoke.test.ts harness-smoke/smoke-native.test.ts harness-smoke/smoke-em.test.ts harness-smoke/smoke-cold-boot.test.ts harness-smoke/smoke-app-reload.test.ts harness-smoke/smoke-capture-phase-save.test.ts at0001-tab-switch-fc.test.ts at0001-rapid-cadence.test.ts at0002-tab-switch-em.test.ts at0003-pane-activation.test.ts at0003-rapid-cadence.test.ts at0016-tab-close-handoff.test.ts at0016-rapid-cadence.test.ts at0006-cross-pane-drag.test.ts at0006-em-cross-pane.test.ts at0007-card-detach.test.ts at0007-em-card-detach.test.ts at0009-em-inactive-mount.test.ts at0021-drag-aborted.test.ts at0004-app-resign-return.test.ts at0005-app-hide-unhide.test.ts at0010-markdown-selection.test.ts at0010-cold-boot-selection.test.ts at0014-scroll-persistence.test.ts at0014-cold-boot-scroll.test.ts at0017-savestate-rpc-parity.test.ts at0018-async-content-race.test.ts at0019-pane-teardown-flush.test.ts at0020-overlay-focus-return.test.ts at0022-caret-visibility.test.ts at0023-cross-card-selection.test.ts at0024-prompt-state-roundtrip.test.ts at0025-prompt-deactivated-roundtrip.test.ts at0026-overlay-persistence.test.ts at0027-layout-state-persistence.test.ts at0030-virtual-focus.test.ts at0031-prompt-entry-chrome.test.ts at0032-em-cold-boot-selection.test.ts at0033-em-fresh-card-activation.test.ts at0034-em-focus-after-move.test.ts at0035-em-app-switch-selection.test.ts at0035-tide-app-switch-selection.test.ts at0036-inactive-card-app-switch-selection.test.ts at0037-deck-wide-restore-consistency.test.ts at0038-deactivation-inactive-paint.test.ts at0078-tide-engine-focus-survives.test.ts at0080-tide-focus-card-switch.test.ts at0081-tide-focus-reload.test.ts)
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

# Three-file smoke: bridge basics + handshake + one AT scenario.
# Useful after a Swift / harness change or right after `just build-app`
# to confirm the pipeline still works without running the full sweep.
# Runtime ~20-30s (vs ~3min for the full sweep).
app-test-smoke: (app-test "harness-smoke/smoke.test.ts" "harness-smoke/version-handshake.test.ts" "at0001-tab-switch-fc.test.ts")

# Clean Rust targets and Mac app build artifacts
clean:
    cd tugrust && cargo clean
    xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -destination 'platform=macOS,arch=arm64' clean 2>/dev/null || true
    rm -rf tugapp/build
