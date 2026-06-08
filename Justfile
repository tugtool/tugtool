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
    # Dirty-tugplug guard. The capture spawns claude with `--plugin-dir tugplug`,
    # so the golden `system_metadata` (skills / slash_commands / agents) reflects
    # whatever is in `tugplug/` AT CAPTURE TIME. Uncommitted skill changes there
    # silently bake into the committed baseline and desync its consumers (e.g.
    # tugdeck/src/__tests__/system-metadata-fixture.test.ts) — exactly the
    # contamination that the recipe/devise + bake/implement rename caused. Refuse
    # on a dirty `tugplug/` tree so the baseline always reflects committed state.
    # Override with TUG_ALLOW_DIRTY_TUGPLUG=1 for an intentional pre-commit capture.
    if [ -z "${TUG_ALLOW_DIRTY_TUGPLUG:-}" ] && [ -n "$(git status --porcelain -- tugplug)" ]; then
        echo "error: tugplug/ has uncommitted changes — the capture would bake them into the golden" >&2
        echo "  commit or stash them first, or set TUG_ALLOW_DIRTY_TUGPLUG=1 to capture anyway" >&2
        git status --porcelain -- tugplug >&2
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
        # TTY-guarded: a non-interactive shell (CI, an agent, a piped
        # invocation) has no stdin to read, and an unguarded `read` would
        # hit EOF, return non-zero, and — under `set -e` — abort the recipe
        # BEFORE the drift regression below. The pager is a convenience for
        # a human at a terminal; headless runs skip it and proceed.
        if [ -t 0 ]; then
            read -r -p "View full stream-json diff in pager? [y/N] " ans
            if [[ "$ans" =~ ^[Yy] ]]; then
                git diff --no-index \
                    "tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v$PREV_VER/" \
                    "tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v$VER/" \
                    || true
            fi
        else
            echo "(non-interactive shell: skipping full-diff pager; stat summary above)"
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
    # TTY-guarded (see the pager note above). A non-interactive run never
    # auto-commits a golden-baseline advance — that's a deliberate review
    # gate. It leaves the refreshed fixtures in the working tree for a
    # human to inspect and commit; the drift regression has already run
    # and passed by this point, which is the leg that must not be skipped.
    if [ -t 0 ]; then
        read -r -p "Approve, stage, and commit? [y/N] " ans
    else
        ans="n"
        echo "(non-interactive shell: skipping interactive baseline commit; review and commit manually)"
    fi
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
# in favor of `just app-debug`. Until then, this is the canonical
# debug loop.)
# ── Multi-instance recipe surface ────────────────────────────────────────────
#
# The debug/release axis (per [D17] of roadmap/tug-multi-instance.md,
# tokens renamed per [D19]): `app-debug` / `app-release` build +
# relaunch a per-(profile, branch) instance. Running `app-release`
# from a worktree branch produces a `(release, <branch>)` instance,
# not `(release, main)` — the axis is build-flavor, not
# identity-fork.
#
# Distribution-flow recipes (`dmg`, `notarize`) live separately and
# operate on bundles, not running instances.

# Build a Debug bundle and (re)launch the cwd-derived debug
# instance. Identity is computed from the current git branch and the
# `debug` profile.
#
# The quit-prior step is the FIRST thing the recipe does, before
# cargo/wasm/xcodebuild/sign. sign-bundle.sh rewrites the bundle's
# binaries in place; if the previous instance is still running, the
# kernel notices the signature change under its live mmap'd code and
# SIGKILLs tugcast — the WebView then flashes a disconnect banner
# during what should be a smooth handoff. Quitting first avoids that.
app-debug: build wasm
    #!/usr/bin/env bash
    set -euo pipefail
    # TUG_FORCE_BUNDLE_ID belongs ONLY to the app-test / unattended build
    # path (build-app / app-test, where it pins a stable AX grant across
    # worktrees). The interactive dev loop is always the cwd-derived
    # debug identity, so clear any value the shell exported for app-test —
    # otherwise product-name / bundle-id / capture-build-info would honor
    # it and `app-debug` would build and launch an apptest instance
    # instead of Tug-debug (debug-main).
    unset TUG_FORCE_BUNDLE_ID
    INSTANCE_ID="$(bash tugrust/scripts/instance-id-from-cwd.sh debug)"
    BUNDLE_ID="$(bash tugrust/scripts/bundle-id-from-cwd.sh debug)"
    PRODUCT_NAME="$(bash tugrust/scripts/product-name-from-cwd.sh debug)"
    echo "==> Quitting prior $INSTANCE_ID, if running"
    bash tugrust/scripts/quit-tug-bundle.sh "$BUNDLE_ID" "$INSTANCE_ID"
    # Debug bundles serve the frontend via Vite HMR — no `bun run build`
    # is needed here. The xcodebuild build phase tolerates an empty
    # tugdeck/dist; release builds (`app-release`) run the full vite
    # build before xcodebuild.
    # Touch Swift sources so xcodebuild detects changes on this mount.
    find tugapp/Sources -name '*.swift' -exec touch {} +
    # PRODUCT_NAME gives each variant its own `.app` (Tug-debug.app /
    # Tug-worktree.app) so builds never clobber or re-sign each other.
    xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug -destination 'platform=macOS,arch=arm64' PRODUCT_NAME="$PRODUCT_NAME" build
    APP_DIR="$(xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug -destination 'platform=macOS,arch=arm64' -showBuildSettings 2>/dev/null | grep -m1 'BUILT_PRODUCTS_DIR' | awk '{print $3}')/${PRODUCT_NAME}.app"
    echo "==> Re-signing with Developer ID for stable AX grant"
    bash tugrust/scripts/sign-bundle.sh "$APP_DIR"
    # Non-blocking orphan-detection preamble so users get a nudge to
    # clean up bundle-less data dirs without ever failing the build.
    if tugrust/target/debug/tugutil instance prune --json 2>/dev/null | grep -q instance_id; then
        echo "[warn] orphaned per-instance data dirs detected. Run 'tugutil instance prune' to clean up." >&2
    fi
    # Seed the per-instance source-tree-path so the first launch knows
    # where to find tugdeck/, tugcode, etc. AppDelegate also falls
    # back to BuildInfo.sourceTree (capture-build-info.sh writes
    # $SRCROOT into Info.plist), but writing it explicitly here keeps
    # the user's chosen tree wins over any stale build-time value.
    tugrust/target/debug/tugbank --instance "$INSTANCE_ID" write dev.tugtool.app source-tree-path "$(pwd)" >/dev/null
    echo "==> Launching $INSTANCE_ID ($APP_DIR)"
    open "$APP_DIR"

# Build a Release bundle and (re)launch the cwd-derived release
# instance. Quit-prior runs first for the same reason as app-debug.
app-release: build wasm
    #!/usr/bin/env bash
    set -euo pipefail
    # Dev loop = cwd-derived identity; the forced bundle id is app-test-only.
    unset TUG_FORCE_BUNDLE_ID
    INSTANCE_ID="$(bash tugrust/scripts/instance-id-from-cwd.sh release)"
    BUNDLE_ID="$(bash tugrust/scripts/bundle-id-from-cwd.sh release)"
    PRODUCT_NAME="$(bash tugrust/scripts/product-name-from-cwd.sh release)"
    echo "==> Quitting prior $INSTANCE_ID, if running"
    bash tugrust/scripts/quit-tug-bundle.sh "$BUNDLE_ID" "$INSTANCE_ID"
    echo "==> Building tugdeck static assets for the release bundle"
    (cd tugdeck && bun run build)
    # The xcodebuild copy phase reads binaries from tugrust/target/$CONFIGURATION,
    # so a Release bundle needs optimized binaries in target/release/. `build`
    # (a dep) only produces target/debug/, which the Release config never reads.
    echo "==> Building release Rust binaries for the bundle"
    (cd tugrust && cargo build --release -p tugcast -p tugexec -p tugutil -p tugrelaunch)
    bun build --compile tugcode/src/main.ts --outfile tugrust/target/release/tugcode
    find tugapp/Sources -name '*.swift' -exec touch {} +
    xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Release -destination 'platform=macOS,arch=arm64' PRODUCT_NAME="$PRODUCT_NAME" build
    APP_DIR="$(xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Release -destination 'platform=macOS,arch=arm64' -showBuildSettings 2>/dev/null | grep -m1 'BUILT_PRODUCTS_DIR' | awk '{print $3}')/${PRODUCT_NAME}.app"
    echo "==> Re-signing with Developer ID"
    bash tugrust/scripts/sign-bundle.sh "$APP_DIR"
    # Seed source-tree-path for the release instance too. AppDelegate
    # falls back to BuildInfo.sourceTree if the tugbank value is
    # missing, but release builds intentionally omit BuildSourceTree
    # ([D03]), so this write is the only path for release from a
    # developer checkout.
    tugrust/target/debug/tugbank --instance "$INSTANCE_ID" write dev.tugtool.app source-tree-path "$(pwd)" >/dev/null
    echo "==> Launching $INSTANCE_ID ($APP_DIR)"
    open "$APP_DIR"

# Relaunch the cwd-derived debug instance without rebuilding.
launch-debug:
    #!/usr/bin/env bash
    set -euo pipefail
    # Dev loop = cwd-derived identity; the forced bundle id is app-test-only.
    unset TUG_FORCE_BUNDLE_ID
    PRODUCT_NAME="$(bash tugrust/scripts/product-name-from-cwd.sh debug)"
    APP_DIR="$(xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug -destination 'platform=macOS,arch=arm64' -showBuildSettings 2>/dev/null | grep -m1 'BUILT_PRODUCTS_DIR' | awk '{print $3}')/${PRODUCT_NAME}.app"
    if [ ! -d "$APP_DIR" ]; then
        echo "error: ${PRODUCT_NAME}.app not built at $APP_DIR" >&2
        echo "       Run 'just app-debug' first." >&2
        exit 1
    fi
    INSTANCE_ID="$(bash tugrust/scripts/instance-id-from-cwd.sh debug)"
    BUNDLE_ID="$(bash tugrust/scripts/bundle-id-from-cwd.sh debug)"
    bash tugrust/scripts/quit-tug-bundle.sh "$BUNDLE_ID" "$INSTANCE_ID"
    open "$APP_DIR"

# Relaunch the cwd-derived release instance without rebuilding.
launch-release:
    #!/usr/bin/env bash
    set -euo pipefail
    # Dev loop = cwd-derived identity; the forced bundle id is app-test-only.
    unset TUG_FORCE_BUNDLE_ID
    PRODUCT_NAME="$(bash tugrust/scripts/product-name-from-cwd.sh release)"
    APP_DIR="$(xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Release -destination 'platform=macOS,arch=arm64' -showBuildSettings 2>/dev/null | grep -m1 'BUILT_PRODUCTS_DIR' | awk '{print $3}')/${PRODUCT_NAME}.app"
    if [ ! -d "$APP_DIR" ]; then
        echo "error: ${PRODUCT_NAME}.app not built at $APP_DIR" >&2
        echo "       Run 'just app-release' first." >&2
        exit 1
    fi
    INSTANCE_ID="$(bash tugrust/scripts/instance-id-from-cwd.sh release)"
    BUNDLE_ID="$(bash tugrust/scripts/bundle-id-from-cwd.sh release)"
    bash tugrust/scripts/quit-tug-bundle.sh "$BUNDLE_ID" "$INSTANCE_ID"
    open "$APP_DIR"

# Stop the cwd-derived debug instance (idempotent). Quits the GUI app
# AND the tugcast registry entry — `just app-debug` then re-launches
# fresh, instead of LaunchServices bringing the previous (stale)
# Tug.app to front.
stop-debug:
    #!/usr/bin/env bash
    set -euo pipefail
    # Dev loop = cwd-derived identity; the forced bundle id is app-test-only.
    unset TUG_FORCE_BUNDLE_ID
    INSTANCE_ID="$(bash tugrust/scripts/instance-id-from-cwd.sh debug)"
    BUNDLE_ID="$(bash tugrust/scripts/bundle-id-from-cwd.sh debug)"
    bash tugrust/scripts/quit-tug-bundle.sh "$BUNDLE_ID" "$INSTANCE_ID"

# Stop the cwd-derived release instance (idempotent).
stop-release:
    #!/usr/bin/env bash
    set -euo pipefail
    # Dev loop = cwd-derived identity; the forced bundle id is app-test-only.
    unset TUG_FORCE_BUNDLE_ID
    INSTANCE_ID="$(bash tugrust/scripts/instance-id-from-cwd.sh release)"
    BUNDLE_ID="$(bash tugrust/scripts/bundle-id-from-cwd.sh release)"
    bash tugrust/scripts/quit-tug-bundle.sh "$BUNDLE_ID" "$INSTANCE_ID"

# Stop every live Tug instance.
stop:
    #!/usr/bin/env bash
    set -uo pipefail
    while read -r LINE; do
        ID="$(printf '%s' "$LINE" | awk '{print $1}')"
        BUNDLE_PATH="$(printf '%s' "$LINE" | awk '{print $4}')"
        [ -n "$ID" ] || continue
        # Derive bundle ID from the bundle path's Info.plist when
        # available — that's the source of truth for a running app.
        # Fall back to plain `tugutil instance stop` if the plist
        # can't be read (registry entry without a live bundle).
        BUNDLE_ID=""
        if [ -n "$BUNDLE_PATH" ] && [ -f "$BUNDLE_PATH/Contents/Info.plist" ]; then
            BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$BUNDLE_PATH/Contents/Info.plist" 2>/dev/null || true)"
        fi
        if [ -n "$BUNDLE_ID" ]; then
            bash tugrust/scripts/quit-tug-bundle.sh "$BUNDLE_ID" "$ID"
        else
            tugrust/target/debug/tugutil instance stop "$ID" --timeout 5 || true
        fi
    done < <(tugrust/target/debug/tugutil instance list 2>/dev/null | tail -n +2)

# One-line wrapper around `tugutil instance list`. Forwards any extra
# args (e.g. `--json`).
instances *FLAGS:
    tugrust/target/debug/tugutil instance list {{FLAGS}}

# Tail today's debug-instance log.
logs-debug:
    #!/usr/bin/env bash
    set -euo pipefail
    INSTANCE_ID="$(bash tugrust/scripts/instance-id-from-cwd.sh debug)"
    DATE="$(date +%Y-%m-%d)"
    LOG="$HOME/Library/Application Support/Tug/instances/$INSTANCE_ID/Logs/tugcast.log.$DATE"
    if [ ! -f "$LOG" ]; then
        echo "no log for $INSTANCE_ID at $LOG — has the instance run today?"
        exit 1
    fi
    tail -F "$LOG"

# Tail today's release-instance log.
logs-release:
    #!/usr/bin/env bash
    set -euo pipefail
    INSTANCE_ID="$(bash tugrust/scripts/instance-id-from-cwd.sh release)"
    DATE="$(date +%Y-%m-%d)"
    LOG="$HOME/Library/Application Support/Tug/instances/$INSTANCE_ID/Logs/tugcast.log.$DATE"
    if [ ! -f "$LOG" ]; then
        echo "no log for $INSTANCE_ID at $LOG — has the instance run today?"
        exit 1
    fi
    tail -F "$LOG"

# Tug-aware wrapper around `git worktree remove`. Cleans up the
# worktree's instance state first (bundle, LaunchServices entry,
# per-instance data dir, optionally TCC), then removes the worktree.
# Eliminates the "did I forget to clean up first" failure mode.
worktree-remove WORKTREE *FLAGS:
    #!/usr/bin/env bash
    set -euo pipefail
    WORKTREE="{{WORKTREE}}"
    FLAGS="{{FLAGS}}"
    if [ ! -d "$WORKTREE" ]; then
        echo "error: $WORKTREE is not a directory" >&2
        exit 1
    fi
    if ! git worktree list | awk '{print $1}' | grep -qFx "$(cd "$WORKTREE" && pwd)"; then
        echo "error: $WORKTREE is not a registered git worktree" >&2
        echo "       run 'git worktree list' to see what's tracked" >&2
        exit 1
    fi
    BRANCH="$(git -C "$WORKTREE" rev-parse --abbrev-ref HEAD)"
    if [ "$BRANCH" = "HEAD" ]; then
        BRANCH="detached-$(git -C "$WORKTREE" rev-parse HEAD | cut -c1-8)"
    fi
    SLUG="$(bash tugrust/scripts/branch-slug.sh "$BRANCH")"
    INSTANCE_ID="debug-$SLUG"
    echo "==> worktree-remove: $WORKTREE"
    echo "    branch:      $BRANCH"
    echo "    instance ID: $INSTANCE_ID"
    tugrust/target/debug/tugutil instance remove "$INSTANCE_ID" $FLAGS
    git worktree remove --force "$WORKTREE"
    echo "==> Removed worktree $WORKTREE and its instance state ($INSTANCE_ID)."

# Use this during smoke runs (see archived
# `roadmap/archive/tugplan-tide-transcript-resume-smoke.md`) so
# the relevant `[dev::replay::started|progress|complete|error]`
# and `[dev::session-lifecycle event=...]` lines stand out without
# the full firehose. `--line-buffered` keeps grep's output flowing
# live even when the pipe stage downstream block-buffers.
# Tail tugcast log filtered to replay + lifecycle targets.
tail-replay:
    #!/usr/bin/env bash
    set -euo pipefail
    DATE="$(date +%Y-%m-%d)"
    LOG="$HOME/Library/Application Support/Tug/Logs/tugcast.log.$DATE"
    if [ ! -f "$LOG" ]; then
        echo "No log yet for $DATE at $LOG. Launch Tug.app with 'just app-debug' first."
        exit 1
    fi
    tail -F "$LOG" | grep --line-buffered -E "dev::replay::|dev::session-lifecycle"

# Remedial resource cleanup — diagnose and release resources leaked by
# crashed runs or out-of-band worktree deletion (`git worktree remove` /
# `rm -rf` instead of `tugutil dash join|release` / `instance remove`).
#
# Everything released is cross-referenced against the LIVE instance
# registry (a tmux server/session is kept iff one of its `cc-<id>`
# sessions names a running instance), so a developer's app-debug /
# app-release and an in-flight app-test are never touched. Sockets are
# lsof-guarded (only those NO process holds are removed).
#
# Releases (transient, cheap to recreate):
#   - orphaned per-instance tmux servers (`tug-<token>`) + legacy
#     default-server sessions (`cc-<id>`) with no live owner
#   - stale tugbank-notify / tugcast-ctl sockets no process holds
#   - tugcode / claude processes reparented to PID 1 (crashed-host zombies)
#
# Reports only (NOT released — removal deletes the possibly-shared app
# bundle, so run it deliberately):
#   - orphaned data dirs whose bundle is gone → `tugutil instance prune`
#
# Subsumes the former `zombies` / `zombie-cleanup` recipes — the PID-1
# process reap is the "processes" section here, now cross-referenced and
# bundled with the other leaked resources.
#
# Usage (diagnose by default, like the old `zombies`):
#   just reap          # diagnose only — report what's leaked, change nothing
#   just reap apply    # release everything reported (the old `zombie-cleanup`+)
#
# Diagnose/release leaked Tug resources; safe — never touches a live instance.
reap *MODE:
    #!/usr/bin/env bash
    # No `set -e` — keep going past per-item failures so one stuck reap
    # doesn't abort the sweep.
    set -uo pipefail
    DRY=1; [ "{{MODE}}" = "apply" ] && DRY=0

    # tugutil is the source of truth for which instances are LIVE. Without
    # it we cannot tell an orphan from a running instance, so it is a hard
    # dependency — build it if absent rather than risk reaping live state.
    TUGUTIL="tugrust/target/debug/tugutil"
    if [ ! -x "$TUGUTIL" ]; then
        echo "==> building tugutil (needed to identify live instances)…"
        (cd tugrust && cargo build -p tugutil) || { echo "error: could not build tugutil" >&2; exit 1; }
    fi
    # A read failure here must abort: reaping against an empty/unknown live
    # set would treat every running instance as an orphan.
    if ! LIST="$("$TUGUTIL" instance list 2>/dev/null)"; then
        echo "error: 'tugutil instance list' failed — refusing to reap blind" >&2
        exit 1
    fi
    LIVE_IDS="$(printf '%s\n' "$LIST" | awk 'NR>1 && $1!="" {print $1}')"
    is_live() { [ -n "$1" ] && printf '%s\n' "$LIVE_IDS" | grep -qxF "$1"; }

    if [ "$DRY" = 1 ]; then echo "== reap (diagnose — nothing will change) =="; else echo "== reap (apply) =="; fi
    echo "-- live instances (protected) --"
    if [ -n "$LIVE_IDS" ]; then printf '%s\n' "$LIVE_IDS" | sed 's/^/   /'; else echo "   (none running)"; fi

    # Per-section output is capped so a big backlog (hundreds of stale
    # sockets) doesn't bury the report; every item is still reaped.
    REAPED=0; PRINTED=0; CAP=12
    new_section() { PRINTED=0; echo "-- $1 --"; }
    reap() { # reap "<description>" <command...>
        local desc="$1"; shift
        REAPED=$((REAPED + 1))
        if [ "$PRINTED" -lt "$CAP" ]; then
            if [ "$DRY" = 1 ]; then echo "   WOULD reap: $desc"; else echo "   reap: $desc"; fi
            PRINTED=$((PRINTED + 1))
        elif [ "$PRINTED" -eq "$CAP" ]; then
            echo "   … (cap reached; remaining items are still reaped)"
            PRINTED=$((PRINTED + 1))
        fi
        [ "$DRY" = 1 ] || "$@" >/dev/null 2>&1 || true
    }

    # 1. tmux — private per-instance servers + legacy default-server sessions.
    new_section tmux
    TMUX_DIR="${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)"
    if [ -d "$TMUX_DIR" ]; then
        for sock in "$TMUX_DIR"/tug-*; do
            [ -e "$sock" ] || continue
            label="$(basename "$sock")"
            sessions="$(tmux -L "$label" list-sessions -F '#S' 2>/dev/null)"
            keep=0
            while IFS= read -r s; do
                [ -z "$s" ] && continue
                is_live "${s#cc-}" && keep=1
            done <<< "$sessions"
            if [ "$keep" = 0 ]; then
                summary="$(printf '%s' "$sessions" | tr '\n' ',' | sed 's/,$//')"
                reap "tmux server $label [${summary:-empty}]" sh -c "tmux -L '$label' kill-server; rm -f '$sock'"
            fi
        done
    fi
    while IFS= read -r s; do
        [ -z "$s" ] && continue
        is_live "${s#cc-}" || reap "default-server session $s" tmux kill-session -t "$s"
    done < <(tmux list-sessions -F '#S' 2>/dev/null | grep '^cc-' || true)

    # 2. sockets — lsof-guarded; only those NO live process holds.
    new_section sockets
    tmp="${TMPDIR:-/tmp}"; tmp="${tmp%/}"
    shopt -s nullglob
    for s in "$tmp"/tugbank-notify-*.sock "$tmp"/tugcast-ctl-*.sock; do
        [ -S "$s" ] || continue
        lsof -- "$s" >/dev/null 2>&1 || reap "socket $(basename "$s")" rm -f "$s"
    done
    shopt -u nullglob

    # 3. processes — tugcode / claude reparented to PID 1 (crashed host).
    new_section processes
    ZPIDS="$(ps -eo pid,ppid,command | awk '$2==1 && ($3 ~ /tugcode/ || ($3=="claude" && $0 ~ /stream-json/)) {print $1}')"
    if [ -n "$ZPIDS" ]; then
        for pid in $ZPIDS; do
            reap "zombie PID $pid" sh -c "kill -TERM $pid 2>/dev/null; sleep 1; kill -0 $pid 2>/dev/null && kill -KILL $pid 2>/dev/null"
        done
    else
        echo "   (none)"
    fi

    # 4. data dirs — REPORT ONLY, both modes. Removing a data dir goes
    #    through `tugutil instance remove`, which also unregisters and can
    #    `rm -rf` the (possibly shared) app bundle — far too heavy to fold
    #    into a routine reap. Surface the count and defer to the dedicated,
    #    deliberately-run command.
    new_section "data dirs"
    ORPHANS="$("$TUGUTIL" instance prune --json 2>/dev/null | grep -oE '"instance_id": *"[^"]*"' | sed -E 's/.*"([^"]*)"$/\1/')"
    if [ -n "$ORPHANS" ]; then
        n="$(printf '%s\n' "$ORPHANS" | grep -c .)"
        printf '%s\n' "$ORPHANS" | head -n "$CAP" | sed 's/^/   orphaned data dir: /'
        [ "$n" -gt "$CAP" ] && echo "   … (+$((n - CAP)) more)"
        echo "   → $n orphaned data dir(s) — remove deliberately with: tugutil instance prune"
    else
        echo "   (none)"
    fi

    if [ "$DRY" = 1 ]; then
        echo "== diagnose complete — $REAPED leaked resource(s) found (run 'just reap apply' to release) =="
    else
        echo "== done — $REAPED resource(s) released =="
    fi

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
# `code-sign-fingerprint` file ever gets out of sync (e.g. after
# manually re-issuing the Developer ID cert in Xcode).
#
# The sentinel lives in the per-project runtime-state dir (out of the
# repo), resolved via `tugutil state-dir`.
#
# Does NOT touch the Developer ID cert in the login keychain — that's
# the user's Apple-issued identity, not project-specific.
#
# Idempotent: reports "nothing to remove" and exits 0 if the
# sentinel doesn't exist.
teardown-dev-signing:
    #!/usr/bin/env bash
    set -euo pipefail
    SENTINEL_FILE="$(tugutil state-dir 2>/dev/null || tugrust/target/debug/tugutil state-dir)/code-sign-fingerprint"
    if [ -f "$SENTINEL_FILE" ]; then
        rm -f "$SENTINEL_FILE"
        echo "✓ Sentinel $SENTINEL_FILE cleared."
    else
        echo "Sentinel not present ($SENTINEL_FILE); nothing to remove."
    fi
    echo
    echo "Note: the Developer ID Application cert in the login keychain"
    echo "      is intentionally preserved. To remove it, use Keychain"
    echo "      Access manually (it's your Apple-issued identity, not a"
    echo "      project-scoped self-signed cert)."
    echo
    echo "Next: 'just build-app' will rebuild the sentinel on first run."

# Build the app-test bundle (Debug) end-to-end: Rust debug binaries,
# tugdeck deps + production dist, app-test deps, xcodebuild, and a
# re-sign with the user's Developer ID Application identity (per [D11])
# so the designated requirement is stable across rebuilds and the
# Accessibility grant persists. After this finishes, run `just app-test`.
#
# Always builds the dedicated app-test identity (`dev.tugtool.app.apptest`
# → `Tug-apptest.app`) so the one-time AX grant from `just app-test-grant`
# always matches — no `TUG_FORCE_BUNDLE_ID=…` prefix to remember. The
# interactive dev/release bundles are built by `app-debug` / `app-release`,
# which own their own identities; this recipe is app-test only.
#
# Prereqs (one-time per machine):
#   just setup-dev-signing                 # verifies Developer ID cert
build-app:
    #!/usr/bin/env bash
    set -euo pipefail

    # Pin the app-test identity unless the caller forced another (e.g.
    # app-test-grant). This is the ONLY identity app-test ever uses.
    : "${TUG_FORCE_BUNDLE_ID:=dev.tugtool.app.apptest}"
    export TUG_FORCE_BUNDLE_ID

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

    # PRODUCT_NAME names the built `.app` per variant (Tug-apptest under
    # TUG_FORCE_BUNDLE_ID=…apptest) so each variant is its own bundle file
    # that never clobbers or re-signs another. Matches bundle-id-from-cwd.sh.
    PRODUCT_NAME="$(bash tugrust/scripts/product-name-from-cwd.sh debug)"
    echo "==> [4/5] Build ${PRODUCT_NAME}.app (Debug)"
    find tugapp/Sources -name '*.swift' -exec touch {} +
    # xcodebuild is very noisy (~800 lines of SwiftDriver/SwiftCompile
    # phase headers + indented invocations) even on a clean build.
    # Capture the full log; on success show only the signal (warnings,
    # errors, BUILD banner). On failure, dump the full log so the user
    # can diagnose.
    XCODE_LOG="$(mktemp -t tugapp-xcode.XXXX.log)"
    if xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug \
        -configuration Debug -destination 'platform=macOS,arch=arm64' \
        PRODUCT_NAME="$PRODUCT_NAME" build \
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
        -showBuildSettings 2>/dev/null | awk '/ BUILT_PRODUCTS_DIR /{print $3}')/${PRODUCT_NAME}.app"
    APP_BIN="$APP_DIR/Contents/MacOS/${PRODUCT_NAME}"
    [ -x "$APP_BIN" ] || { echo "${PRODUCT_NAME}.app binary missing: $APP_BIN"; exit 1; }

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
    SENTINEL_DIR="$(tugutil state-dir 2>/dev/null || tugrust/target/debug/tugutil state-dir)"
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

    echo "    ${PRODUCT_NAME}.app binary: $APP_BIN"
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
#   just setup-dev-signing                 # one-time; Developer ID cert
#   just build-app                         # build + sign Tug.app
#
# Usage:
#   just app-test                          # full sweep
#   just app-test at0001-tab-switch-fc.test.ts
#                                          # single file (bare name)
#   just app-test tests/app-test/at0001-tab-switch-fc.test.ts
#                                          # repo-relative path also works
#   just app-test harness-smoke/smoke.test.ts at0003-pane-activation.test.ts
#                                          # specific files in order
#
# This recipe does NOT re-sign the bundle. `build-app` / `app-debug`
# seal it with the Developer ID Application identity, whose designated
# requirement is stable across rebuilds (it anchors to Apple's
# intermediate, not a per-build cdhash), so the Accessibility grant for
# `dev.tugtool.app.debug` survives. Native-event tests need that grant
# for `CGEvent.post`; if AX is missing the harness fails the preflight
# with the bundle id to add in System Settings.
#
# Teardown: each launch is its own `apptest-<uuid>` instance. The
# harness signals the GUI app by PID (`getHostPid` over RPC) on
# `app.close()`; tugcast then self-exits via its parent-watch. The
# `tugutil instance stop` sweeps below are the backstop for a test that
# panics before `close()`.
app-test *FILES:
    #!/usr/bin/env bash
    # Deliberately NOT `set -e` — we want to keep iterating past per-
    # file failures so the summary captures every file's status.
    set -uo pipefail

    # App-test always drives the dedicated `dev.tugtool.app.apptest`
    # identity — the same one `build-app` produces and `app-test-grant`
    # granted AX to. This is baked in (no env-var prefix) so the build
    # and the run can never disagree on which bundle to launch.
    : "${TUG_FORCE_BUNDLE_ID:=dev.tugtool.app.apptest}"
    export TUG_FORCE_BUNDLE_ID

    PRODUCT_NAME="$(bash tugrust/scripts/product-name-from-cwd.sh debug)"
    APP_DIR="$(xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug \
        -configuration Debug -destination 'platform=macOS,arch=arm64' \
        -showBuildSettings 2>/dev/null | awk '/ BUILT_PRODUCTS_DIR /{print $3}')/${PRODUCT_NAME}.app"
    APP_BIN="$APP_DIR/Contents/MacOS/${PRODUCT_NAME}"
    if [ ! -x "$APP_BIN" ]; then
        echo "error: ${PRODUCT_NAME}.app not built at $APP_BIN" >&2
        echo "       Run 'just build-app' first." >&2
        exit 1
    fi

    # Surface the identity we're about to drive and confirm the built
    # bundle matches it. The Accessibility (AX) grant is keyed on this
    # bundle ID's designated requirement; a mismatch fails the
    # native-event preflight. The grant is given once via
    # `just app-test-grant` and carries across every worktree.
    # See tuglaws/code-signing-mac.md.
    BUILT_BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw "$APP_DIR/Contents/Info.plist" 2>/dev/null || echo '?')"
    echo "==> app-test bundle id: $BUILT_BUNDLE_ID (identity: $TUG_FORCE_BUNDLE_ID)"
    if [ "$BUILT_BUNDLE_ID" != "$TUG_FORCE_BUNDLE_ID" ]; then
        echo "[warn] built bundle is $BUILT_BUNDLE_ID but app-test drives $TUG_FORCE_BUNDLE_ID." >&2
        echo "       Run 'just build-app' to rebuild the app-test bundle." >&2
    fi

    # Refresh tugdeck/dist so the harness (which loads prod-built
    # static files via tugcast's ServeDir, not Vite — see the
    # TUGAPP_APP_TEST branch in AppDelegate.loadPreferences)
    # reflects current source.
    (cd tugdeck && bun run build >/dev/null)

    # Clean slate before the first spawn: wipe any apptest-* data
    # dirs from earlier runs and stop any apptest-* tugcasts that
    # are still alive. Other instances (developer's `app-debug` /
    # `app-release`, harness colleagues' parallel `app-test` runs)
    # are untouched — pkill -x Tug would have killed them all.
    rm -rf "$HOME/Library/Application Support/Tug/instances/apptest-"* 2>/dev/null || true
    while read -r ID; do
        case "$ID" in apptest-*)
            tugrust/target/debug/tugutil instance stop "$ID" --timeout 2 >/dev/null 2>&1 || true ;;
        esac
    done < <(tugrust/target/debug/tugutil instance list 2>/dev/null | tail -n +2 | awk '{print $1}')
    sleep 0.3

    # Reap orphaned per-instance tmux servers from ungracefully-killed
    # app-test runs (and stale empty socket files tmux leaves behind
    # after a graceful kill-server). Each app-test instance owns a
    # private `tmux -L tug-<token>` server; a graceful close tears it
    # down (tugcast's shutdown), but a SIGKILLed run leaks the whole
    # server. A private server hosting only `cc-apptest-*` sessions (or
    # none) is an app-test orphan — reap it. Dev/release private servers
    # host `cc-debug-*` / `cc-release-*` sessions and are NEVER matched,
    # so a developer's running `app-debug` tmux is untouched. Run both
    # before the first spawn and in cleanup so nothing accrues per run.
    reap_orphan_tmux_servers() {
        local dir="${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)"
        [ -d "$dir" ] || return 0
        local sock label sessions
        for sock in "$dir"/tug-*; do
            [ -e "$sock" ] || continue
            label="$(basename "$sock")"
            sessions="$(tmux -L "$label" list-sessions -F '#S' 2>/dev/null)"
            if [ -z "$sessions" ] || ! printf '%s\n' "$sessions" | grep -qv '^cc-apptest-'; then
                tmux -L "$label" kill-server 2>/dev/null || true
                rm -f "$sock" 2>/dev/null || true
            fi
        done
    }
    reap_orphan_tmux_servers

    # No cross-instance socket sweep. On graceful close each owner
    # unlinks its own sockets (ProcessManager unlinks the control socket;
    # tugcast unlinks its notify socket). A crash can leave orphans, but
    # every app-test launch derives its socket names from a per-launch
    # `apptest-<uuid>` (→ unique short token), so an orphan can never
    # collide with a future run — it's a harmless dead file that $TMPDIR
    # reaps on its own schedule. We deliberately do NOT glob-and-remove
    # sockets here: the only such glob that ever existed
    # (`tugcast-ctl-*.sock`) was unscoped and could reach a live
    # dev/release instance's control socket. Isolation > tidiness.

    TMPOUT="$(mktemp -t app-test.XXXXXX)"
    cleanup() {
        # Targeted teardown — stop only the apptest-* instances the
        # harness minted. A developer's separately-running app-debug
        # session continues unaffected (and `instance stop` is now
        # identity-checked, so a recycled PID is never signalled).
        while read -r ID; do
            case "$ID" in apptest-*)
                tugrust/target/debug/tugutil instance stop "$ID" --timeout 2 >/dev/null 2>&1 || true ;;
            esac
        done < <(tugrust/target/debug/tugutil instance list 2>/dev/null | tail -n +2 | awk '{print $1}')
        # Reap any private tmux servers (and stale socket files) the
        # stopped apptest instances left behind, so a run leaves nothing.
        reap_orphan_tmux_servers
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
        FILES=(harness-smoke/smoke.test.ts harness-smoke/smoke-native.test.ts harness-smoke/smoke-em.test.ts harness-smoke/smoke-cold-boot.test.ts harness-smoke/smoke-app-reload.test.ts harness-smoke/smoke-capture-phase-save.test.ts at0001-tab-switch-fc.test.ts at0001-rapid-cadence.test.ts at0002-tab-switch-em.test.ts at0003-pane-activation.test.ts at0003-rapid-cadence.test.ts at0016-tab-close-handoff.test.ts at0016-rapid-cadence.test.ts at0006-cross-pane-drag.test.ts at0006-em-cross-pane.test.ts at0007-card-detach.test.ts at0007-em-card-detach.test.ts at0009-em-inactive-mount.test.ts at0021-drag-aborted.test.ts at0004-app-resign-return.test.ts at0005-app-hide-unhide.test.ts at0010-markdown-selection.test.ts at0010-cold-boot-selection.test.ts at0014-scroll-persistence.test.ts at0014-cold-boot-scroll.test.ts at0017-savestate-rpc-parity.test.ts at0018-async-content-race.test.ts at0019-pane-teardown-flush.test.ts at0020-overlay-focus-return.test.ts at0022-caret-visibility.test.ts at0023-cross-card-selection.test.ts at0024-prompt-state-roundtrip.test.ts at0025-prompt-deactivated-roundtrip.test.ts at0026-overlay-persistence.test.ts at0027-layout-state-persistence.test.ts at0030-virtual-focus.test.ts at0032-em-cold-boot-selection.test.ts at0033-em-fresh-card-activation.test.ts at0034-em-focus-after-move.test.ts at0035-em-app-switch-selection.test.ts at0035-dev-app-switch-selection.test.ts at0037-deck-wide-restore-consistency.test.ts at0038-deactivation-inactive-paint.test.ts at0078-dev-engine-focus-survives.test.ts at0080-dev-focus-card-switch.test.ts at0081-dev-focus-reload.test.ts)
        SWEEP_LABEL="full"
    else
        read -r -a FILES <<< "$FILES_INPUT"
        SWEEP_LABEL="explicit-files"
    fi

    # Normalize paths so a repo-root-relative path (e.g. the
    # `tests/app-test/at0001-...` form tab-completion produces) works the same as
    # a bare filename. The suite runs from tests/app-test/, so strip that prefix
    # (and any leading `./`) from each entry before bun sees it.
    for i in "${!FILES[@]}"; do
        f="${FILES[$i]}"
        f="${f#./}"
        f="${f#tests/app-test/}"
        FILES[$i]="$f"
    done

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

        # Between files, stop any apptest-* stragglers. The harness's
        # `app.close()` already targets the current instance; this is
        # defence-in-depth for the rare case where a test panics
        # before reaching `close`.
        while read -r ID; do
            case "$ID" in apptest-*)
                tugrust/target/debug/tugutil instance stop "$ID" --timeout 2 >/dev/null 2>&1 || true ;;
            esac
        done < <(tugrust/target/debug/tugutil instance list 2>/dev/null | tail -n +2 | awk '{print $1}')
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

# Everyday app-test entry point — ONE command, no env var to remember.
#
# Pins the AX-granted app-test identity (TUG_FORCE_BUNDLE_ID=
# dev.tugtool.app.apptest) for BOTH the build and the run, so the macOS
# Accessibility grant — given once via `just app-test-grant` — always
# matches and native-event tests pass. Builds the bundle automatically
# the first time (when it's missing), then runs the requested files.
#
#   just at                          # full sweep
#   just at at0000-smoke.test.ts     # one file
#   just at a.test.ts b.test.ts      # several, in order
#
# Changed Swift / Rust / harness source? The bundle is stale and `at`
# won't notice (it only auto-builds when the binary is ABSENT). Use
# `just at-build ...` to force a rebuild first, then run.
at *FILES:
    #!/usr/bin/env bash
    set -euo pipefail
    export TUG_FORCE_BUNDLE_ID=dev.tugtool.app.apptest
    PRODUCT_NAME="$(bash tugrust/scripts/product-name-from-cwd.sh debug)"
    APP_DIR="$(xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug \
        -configuration Debug -destination 'platform=macOS,arch=arm64' \
        -showBuildSettings 2>/dev/null | awk '/ BUILT_PRODUCTS_DIR /{print $3}')/${PRODUCT_NAME}.app"
    if [ ! -x "$APP_DIR/Contents/MacOS/${PRODUCT_NAME}" ]; then
        echo "==> ${PRODUCT_NAME}.app not built yet — building once (this is slow only the first time)…"
        just build-app
    fi
    just app-test {{FILES}}

# Force a fresh build of the app-test bundle, then run. Use after
# changing Swift / Rust / harness source, where `just at` would run
# against a stale bundle. Same pinned identity as `at`.
#
#   just at-build                       # rebuild + full sweep
#   just at-build at0000-smoke.test.ts  # rebuild + one file
at-build *FILES:
    #!/usr/bin/env bash
    set -euo pipefail
    export TUG_FORCE_BUNDLE_ID=dev.tugtool.app.apptest
    just build-app
    just app-test {{FILES}}

# One-time, reliable Accessibility grant for the app-test identity.
#
# macOS has no scripted way to grant Accessibility (the system TCC
# database is SIP-protected; `tccutil` only resets). Exactly one human
# gesture is required — but only ONCE, ever, because the grant is keyed
# on the bundle's designated requirement (identifier + team), which is
# path-independent. After this, every worktree build with the same
# TUG_FORCE_BUNDLE_ID inherits the grant, so unattended app-test runs
# (e.g. inside tugplug:implement) work without prompting.
#
# This builds the pinned-identity app, reveals it in Finder, and opens
# the Accessibility pane. Drag the revealed app into the list (or use
# "+"), and toggle it on. The entry is named "Tug (apptest)" so it's
# distinct from the interactive "Tug" debug instance.
app-test-grant:
    #!/usr/bin/env bash
    set -euo pipefail
    export TUG_FORCE_BUNDLE_ID="${TUG_FORCE_BUNDLE_ID:-dev.tugtool.app.apptest}"
    PRODUCT_NAME="$(bash tugrust/scripts/product-name-from-cwd.sh debug)"
    echo "==> Building ${PRODUCT_NAME}.app pinned to $TUG_FORCE_BUNDLE_ID"
    just build-app
    APP_DIR="$(xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug \
        -configuration Debug -destination 'platform=macOS,arch=arm64' \
        -showBuildSettings 2>/dev/null | awk '/ BUILT_PRODUCTS_DIR /{print $3}')/${PRODUCT_NAME}.app"
    echo "==> Revealing the app in Finder and opening the Accessibility pane"
    open -R "$APP_DIR"
    open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    echo
    echo "    One-time Accessibility grant:"
    echo "      1. In System Settings -> Privacy & Security -> Accessibility,"
    echo "         click \"+\" (or drag the Finder-highlighted ${PRODUCT_NAME}.app into the list)."
    echo "      2. Toggle \"${PRODUCT_NAME}\" ON."
    echo
    echo "    That's it -- forever. Every worktree build pinned to"
    echo "    $TUG_FORCE_BUNDLE_ID matches the same designated requirement"
    echo "    and inherits this grant."
    echo "      Verify with:  just app-test harness-smoke/smoke-native.test.ts"

# Three-file smoke: bridge basics + handshake + one AT scenario.
# Useful after a Swift / harness change or right after `just build-app`
# to confirm the pipeline still works without running the full sweep.
# Runtime ~20-30s (vs ~3min for the full sweep).
app-test-smoke: (app-test "harness-smoke/smoke.test.ts" "harness-smoke/version-handshake.test.ts" "at0001-tab-switch-fc.test.ts")

# Clean Debug xcodebuild artifacts (matches `app-debug`)
clean-debug:
    xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug -destination 'platform=macOS,arch=arm64' clean 2>/dev/null || true

# Clean Release xcodebuild artifacts (matches `app-release`)
clean-release:
    xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Release -destination 'platform=macOS,arch=arm64' clean 2>/dev/null || true

# Clean the Rust workspace target dir (shared by debug + release)
clean-rust:
    cd tugrust && cargo clean

# Wipe every build artifact: Debug + Release xcodebuild outputs and Rust target/
clean-all: clean-debug clean-release clean-rust
