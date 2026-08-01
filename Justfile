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
    bun build --compile tugcode/src/pulse/main-pulse.ts --outfile tugrust/target/debug/tugpulse
    # Only the main checkout owns ~/.local/bin. A linked worktree (a dash under
    # .tug/worktrees/) builds its own ephemeral binaries; pointing the global
    # symlinks at them would dangle every tug* tool the moment the dash is torn
    # down. A linked worktree's --git-dir differs from its --git-common-dir.
    if [ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ]; then
        mkdir -p ~/.local/bin
        # The tug/tugdash/tugmark binaries are gone (tug is now tugutil;
        # tugdash/tugmark were folded in); drop any stale symlinks so they
        # don't dangle after this rebuild.
        rm -f ~/.local/bin/tug ~/.local/bin/tugdash ~/.local/bin/tugmark
        for bin in tugcast tugexec tugutil tugcode tugpulse tugrelaunch tugbank; do
            ln -sf "$(pwd)/tugrust/target/debug/$bin" ~/.local/bin/"$bin"
        done
    else
        echo "[build] linked worktree — skipping ~/.local/bin symlinks (main checkout owns them)"
    fi

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

# Vendor IBM Plex woff2 faces from npm into tugdeck/public/fonts (no runtime web loading).
# No args = all phase-1 script families; pass a package short name to fetch one (e.g. plex-math).
fetch-fonts *ARGS:
    cd tugdeck && bun run scripts/fetch-fonts.ts {{ARGS}}

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

# Inspect a Tug ledger database SAFELY: copies db + WAL/shm to a temp dir
# and opens sqlite3 there. NEVER point sqlite3 (Apple's build) at the live
# files — a foreign SQLite participating in WAL recovery/checkpointing on
# a live ledger is a corruption vector (2026-07-27 incident). Pass a name
# (changes / sessions / shell_exchanges) or an absolute .db path; any
# extra args go to sqlite3 (e.g. a quoted SQL string).
db-inspect DB *ARGS:
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{DB}}" in
        /*) src="{{DB}}" ;;
        *)  src="$HOME/Library/Application Support/Tug/{{DB}}.db" ;;
    esac
    [ -f "$src" ] || { echo "no such database: $src" >&2; exit 1; }
    tmp="$(mktemp -d /tmp/tug-db-inspect.XXXXXX)"
    cp -p "$src" "$tmp/"
    for ext in -wal -shm; do
        [ -f "$src$ext" ] && cp -p "$src$ext" "$tmp/"
    done
    db="$tmp/$(basename "$src")"
    echo "inspecting COPY at $db (live files untouched)" >&2
    if [ -n {{ quote(ARGS) }} ]; then
        sqlite3 "$db" {{ quote(ARGS) }}
    else
        sqlite3 "$db"
    fi

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
# Build every WASM crate under tugdeck/crates/.
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
# Build a Debug bundle and (re)launch the cwd-derived debug instance.
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
    export TUG_PRODUCT_NAME="$(bash tugrust/scripts/product-name-from-cwd.sh debug)"
    PRODUCT_NAME="$TUG_PRODUCT_NAME"
    echo "==> Quitting prior $INSTANCE_ID, if running"
    bash tugrust/scripts/quit-tug-bundle.sh "$BUNDLE_ID" "$INSTANCE_ID"
    # Debug bundles serve the frontend via Vite HMR — no `bun run build`
    # is needed here. The xcodebuild build phase tolerates an empty
    # tugdeck/dist; release builds (`app-release`) run the full vite
    # build before xcodebuild.
    # Touch Swift sources so xcodebuild detects changes on this mount.
    find tugapp/Sources -name '*.swift' -exec touch {} +
    # TUG_PRODUCT_NAME gives each variant its own `.app` (Tug-debug.app /
    # Tug-worktree.app) AND `-derivedDataPath` gives it its own build
    # directory, so build outputs are fully isolated — building the
    # app-test bundle never clobbers this debug bundle, and vice-versa.
    # The default DerivedData is shared per-project, so without this every
    # variant overwrites the same target product. See derived-data-path.sh.
    # It travels as an environment variable that the Tug target's PRODUCT_NAME
    # setting reads, NOT as an xcodebuild command-line setting: a command-line
    # setting applies to every target in the graph, so the SPM packages'
    # resource-bundle targets would all take the same name and collide
    # ("Multiple commands produce ....bundle").
    DERIVED="$(bash tugrust/scripts/derived-data-path.sh debug)"
    xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug -destination 'platform=macOS,arch=arm64' -derivedDataPath "$DERIVED" build
    APP_DIR="$DERIVED/Build/Products/Debug/${PRODUCT_NAME}.app"
    echo "==> Re-signing with Developer ID for stable AX grant"
    bash tugrust/scripts/sign-bundle.sh "$APP_DIR"
    # Non-blocking orphan-detection preamble so users get a nudge to
    # clean up bundle-less data dirs without ever failing the build.
    if tugrust/target/debug/tugutil host instance prune --json 2>/dev/null | grep -q instance_id; then
        echo "[warn] orphaned per-instance data dirs detected. Run 'tugutil host instance prune' to clean up." >&2
    fi
    # Seed the per-instance source-tree-path so the first launch knows
    # where to find tugdeck/, tugcode, etc. AppDelegate also falls
    # back to BuildInfo.sourceTree (capture-build-info.sh writes
    # $SRCROOT into Info.plist), but writing it explicitly here keeps
    # the user's chosen tree wins over any stale build-time value.
    tugrust/target/debug/tugbank --instance "$INSTANCE_ID" write dev.tugtool.app source-tree-path "$(pwd)" >/dev/null
    echo "==> Launching $INSTANCE_ID ($APP_DIR)"
    # Scrub the launching instance's identity/resource env: `open`
    # propagates the caller's environment, so a launch from inside a Dev
    # card would otherwise hand the new bundle the host's TUG_INSTANCE_ID.
    env -u TUG_INSTANCE_ID -u TUG_BUNDLE_PATH -u TUGCAST_RESOURCE_ROOT open "$APP_DIR"

# Build a Release bundle and (re)launch the cwd-derived release
# instance. Quit-prior runs first for the same reason as app-debug.
# Build a Release bundle and (re)launch the cwd-derived release instance.
app-release: build wasm
    #!/usr/bin/env bash
    set -euo pipefail
    # Dev loop = cwd-derived identity; the forced bundle id is app-test-only.
    unset TUG_FORCE_BUNDLE_ID
    INSTANCE_ID="$(bash tugrust/scripts/instance-id-from-cwd.sh release)"
    BUNDLE_ID="$(bash tugrust/scripts/bundle-id-from-cwd.sh release)"
    export TUG_PRODUCT_NAME="$(bash tugrust/scripts/product-name-from-cwd.sh release)"
    PRODUCT_NAME="$TUG_PRODUCT_NAME"
    echo "==> Quitting prior $INSTANCE_ID, if running"
    bash tugrust/scripts/quit-tug-bundle.sh "$BUNDLE_ID" "$INSTANCE_ID"
    # Compile the shared release inputs (Rust binaries, tugcode/tugpulse,
    # tugdeck assets) — the same script build-app.sh uses, so the developer
    # launch build and the distribution build can't drift on what they compile.
    # The xcodebuild copy phase reads these from tugrust/target/release/.
    bash tugrust/scripts/build-release-inputs.sh
    find tugapp/Sources -name '*.swift' -exec touch {} +
    DERIVED="$(bash tugrust/scripts/derived-data-path.sh release)"
    xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Release -destination 'platform=macOS,arch=arm64' -derivedDataPath "$DERIVED" build
    APP_DIR="$DERIVED/Build/Products/Release/${PRODUCT_NAME}.app"
    echo "==> Re-signing with Developer ID"
    bash tugrust/scripts/sign-bundle.sh "$APP_DIR"
    # Seed source-tree-path for the release instance too. AppDelegate
    # falls back to BuildInfo.sourceTree if the tugbank value is
    # missing, but release builds intentionally omit BuildSourceTree
    # ([D03]), so this write is the only path for release from a
    # developer checkout.
    tugrust/target/debug/tugbank --instance "$INSTANCE_ID" write dev.tugtool.app source-tree-path "$(pwd)" >/dev/null
    echo "==> Launching $INSTANCE_ID ($APP_DIR)"
    # Scrub the launching instance's identity/resource env: `open`
    # propagates the caller's environment, so a launch from inside a Dev
    # card would otherwise hand the new bundle the host's TUG_INSTANCE_ID.
    env -u TUG_INSTANCE_ID -u TUG_BUNDLE_PATH -u TUGCAST_RESOURCE_ROOT open "$APP_DIR"

# Relaunch the cwd-derived debug instance without rebuilding.
launch-debug:
    #!/usr/bin/env bash
    set -euo pipefail
    # Dev loop = cwd-derived identity; the forced bundle id is app-test-only.
    unset TUG_FORCE_BUNDLE_ID
    export TUG_PRODUCT_NAME="$(bash tugrust/scripts/product-name-from-cwd.sh debug)"
    PRODUCT_NAME="$TUG_PRODUCT_NAME"
    APP_DIR="$(bash tugrust/scripts/derived-data-path.sh debug)/Build/Products/Debug/${PRODUCT_NAME}.app"
    if [ ! -d "$APP_DIR" ]; then
        echo "error: ${PRODUCT_NAME}.app not built at $APP_DIR" >&2
        echo "       Run 'just app-debug' first." >&2
        exit 1
    fi
    INSTANCE_ID="$(bash tugrust/scripts/instance-id-from-cwd.sh debug)"
    BUNDLE_ID="$(bash tugrust/scripts/bundle-id-from-cwd.sh debug)"
    bash tugrust/scripts/quit-tug-bundle.sh "$BUNDLE_ID" "$INSTANCE_ID"
    # Scrub the launching instance's identity/resource env: `open`
    # propagates the caller's environment, so a launch from inside a Dev
    # card would otherwise hand the new bundle the host's TUG_INSTANCE_ID.
    env -u TUG_INSTANCE_ID -u TUG_BUNDLE_PATH -u TUGCAST_RESOURCE_ROOT open "$APP_DIR"

# Relaunch the cwd-derived release instance without rebuilding.
launch-release:
    #!/usr/bin/env bash
    set -euo pipefail
    # Dev loop = cwd-derived identity; the forced bundle id is app-test-only.
    unset TUG_FORCE_BUNDLE_ID
    export TUG_PRODUCT_NAME="$(bash tugrust/scripts/product-name-from-cwd.sh release)"
    PRODUCT_NAME="$TUG_PRODUCT_NAME"
    APP_DIR="$(bash tugrust/scripts/derived-data-path.sh release)/Build/Products/Release/${PRODUCT_NAME}.app"
    if [ ! -d "$APP_DIR" ]; then
        echo "error: ${PRODUCT_NAME}.app not built at $APP_DIR" >&2
        echo "       Run 'just app-release' first." >&2
        exit 1
    fi
    INSTANCE_ID="$(bash tugrust/scripts/instance-id-from-cwd.sh release)"
    BUNDLE_ID="$(bash tugrust/scripts/bundle-id-from-cwd.sh release)"
    bash tugrust/scripts/quit-tug-bundle.sh "$BUNDLE_ID" "$INSTANCE_ID"
    # Scrub the launching instance's identity/resource env: `open`
    # propagates the caller's environment, so a launch from inside a Dev
    # card would otherwise hand the new bundle the host's TUG_INSTANCE_ID.
    env -u TUG_INSTANCE_ID -u TUG_BUNDLE_PATH -u TUGCAST_RESOURCE_ROOT open "$APP_DIR"

# Stop the cwd-derived debug instance (idempotent). Quits the GUI app
# AND the tugcast registry entry — `just app-debug` then re-launches
# fresh, instead of LaunchServices bringing the previous (stale)
# Tug.app to front.
# Stop the cwd-derived debug instance (idempotent).
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
        # Fall back to plain `tugutil host instance stop` if the plist
        # can't be read (registry entry without a live bundle).
        BUNDLE_ID=""
        if [ -n "$BUNDLE_PATH" ] && [ -f "$BUNDLE_PATH/Contents/Info.plist" ]; then
            BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$BUNDLE_PATH/Contents/Info.plist" 2>/dev/null || true)"
        fi
        if [ -n "$BUNDLE_ID" ]; then
            bash tugrust/scripts/quit-tug-bundle.sh "$BUNDLE_ID" "$ID"
        else
            tugrust/target/debug/tugutil host instance stop "$ID" --timeout 5 || true
        fi
    done < <(tugrust/target/debug/tugutil host instance list 2>/dev/null | tail -n +2)

# One-line wrapper around `tugutil host instance list`. Forwards any extra
# args (e.g. `--json`).
# List running Tug instances (wraps `tugutil host instance list`).
instances *FLAGS:
    tugrust/target/debug/tugutil host instance list {{FLAGS}}

# Profile what the cwd-derived debug instance's renderer does per frame.
#
# MODE is `resize` (drive a paced window resize while sampling — the
# jank the user feels) or `idle` (steady state). The verdict reports
# main-thread busy share and the sample counts of the frames motion
# residency turns on: keyframe blending in style resolution, and the
# compositing walk it triggers. See tuglaws/motion-residency.md.
#
# This is a hand tool, not a gate — `sample` numbers move with machine
# load. Compare a before and an after taken minutes apart, not across
# days. Resize mode needs accessibility permission for this terminal.
# Profile the debug instance's renderer (MODE = resize | idle).
perf-resize-profile MODE="resize" SECONDS="6":
    #!/usr/bin/env bash
    set -euo pipefail
    unset TUG_FORCE_BUNDLE_ID
    BUNDLE_ID="$(bash tugrust/scripts/bundle-id-from-cwd.sh debug)"
    bash scripts/perf-resize-profile.sh "$BUNDLE_ID" {{MODE}} {{SECONDS}}

# Tail the debug instance's newest tugcast + tugapp logs.
logs-debug:
    #!/usr/bin/env bash
    set -euo pipefail
    INSTANCE_ID="$(bash tugrust/scripts/instance-id-from-cwd.sh debug)"
    bash tugrust/scripts/tail-instance-logs.sh "$INSTANCE_ID"

# Tail the release instance's newest tugcast + tugapp logs.
logs-release:
    #!/usr/bin/env bash
    set -euo pipefail
    INSTANCE_ID="$(bash tugrust/scripts/instance-id-from-cwd.sh release)"
    bash tugrust/scripts/tail-instance-logs.sh "$INSTANCE_ID"

# Tug-aware wrapper around `git worktree remove`. Cleans up the
# worktree's instance state first (bundle, LaunchServices entry,
# per-instance data dir, optionally TCC), then removes the worktree.
# Eliminates the "did I forget to clean up first" failure mode.
# Tug-aware `git worktree remove` — tears down instance state first.
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
    tugrust/target/debug/tugutil host instance remove "$INSTANCE_ID" $FLAGS
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
    INSTANCE_ID="$(bash tugrust/scripts/instance-id-from-cwd.sh debug)"
    LOGS="$HOME/Library/Application Support/Tug/instances/$INSTANCE_ID/Logs"
    LOG="$(ls -t "$LOGS"/tugcast.log.* 2>/dev/null | head -1 || true)"
    if [ -z "$LOG" ]; then
        echo "no log for $INSTANCE_ID in $LOGS. Launch Tug.app with 'just app-debug' first."
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
#   - orphaned data dirs whose bundle is gone → `tugutil host instance prune`
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

    # tugutil host instance is the source of truth for which instances are LIVE. Without
    # it we cannot tell an orphan from a running instance, so it is a hard
    # dependency — build it if absent rather than risk reaping live state.
    TUGUTIL="tugrust/target/debug/tugutil"
    if [ ! -x "$TUGUTIL" ]; then
        echo "==> building tug (needed to identify live instances)…"
        (cd tugrust && cargo build -p tugutil) || { echo "error: could not build tugutil" >&2; exit 1; }
    fi
    # A read failure here must abort: reaping against an empty/unknown live
    # set would treat every running instance as an orphan.
    if ! LIST="$("$TUGUTIL" host instance list 2>/dev/null)"; then
        echo "error: 'tugutil host instance list' failed — refusing to reap blind" >&2
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
    #    through `tugutil host instance remove`, which also unregisters and can
    #    `rm -rf` the (possibly shared) app bundle — far too heavy to fold
    #    into a routine reap. Surface the count and defer to the dedicated,
    #    deliberately-run command.
    new_section "data dirs"
    ORPHANS="$("$TUGUTIL" host instance prune --json 2>/dev/null | grep -oE '"instance_id": *"[^"]*"' | sed -E 's/.*"([^"]*)"$/\1/')"
    if [ -n "$ORPHANS" ]; then
        n="$(printf '%s\n' "$ORPHANS" | grep -c .)"
        printf '%s\n' "$ORPHANS" | head -n "$CAP" | sed 's/^/   orphaned data dir: /'
        [ "$n" -gt "$CAP" ] && echo "   … (+$((n - CAP)) more)"
        echo "   → $n orphaned data dir(s) — remove deliberately with: tugutil host instance prune"
    else
        echo "   (none)"
    fi

    if [ "$DRY" = 1 ]; then
        echo "== diagnose complete — $REAPED leaked resource(s) found (run 'just reap apply' to release) =="
    else
        echo "== done — $REAPED resource(s) released =="
    fi

# Render the styled DMG background art (resources/dmg-preview.svg) into the
# multi-representation HiDPI TIFF the dmgbuild step consumes. Two reps —
# 720x460 @1x + 1440x920 @2x — combined via `tiffutil -cathidpicheck`.
# Re-run after editing the SVG; the live app/Applications icons are NOT
# painted in (Finder draws them), so only the art changes here.
# Render resources/dmg-preview.svg into the HiDPI dmg-background.tiff (run after editing the SVG).
dmg-background:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v rsvg-convert &>/dev/null; then
        echo "error: rsvg-convert not found (brew install librsvg)" >&2
        exit 1
    fi
    SRC=resources/dmg-preview.svg
    OUT=resources/dmg-background.tiff
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    rsvg-convert -w 720  -h 460 "$SRC" -o "$TMP/bg-1x.png"
    rsvg-convert -w 1440 -h 920 "$SRC" -o "$TMP/bg-2x.png"
    tiffutil -cathidpicheck "$TMP/bg-1x.png" "$TMP/bg-2x.png" -out "$OUT"
    echo "==> wrote $OUT"
    tiffutil -info "$OUT" | grep -iE "image width|image length"

# Build unsigned DMG (no Developer ID, no notarization). Fastest
# distribution-shape artifact; suitable for sharing a build locally
# (e.g., to a tester on the same Mac) but Gatekeeper will reject it
# on a clean machine.
# Build an unsigned Tug.dmg — fast; local testing only (Gatekeeper blocks it on other Macs).
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
# Build a signed + notarized Tug.dmg — the canonical shippable build.
notarize:
    tugrust/scripts/build-app.sh

# Build a Tug.dmg and stage it on the external VM-lab disk for the
# share-into-guest step (`lab-run <run> --dir=drop:/Volumes/Lab-A/share`).
# Default mode is the canonical signed+notarized build (installs like a
# real customer download on a clean VM). Pass `unsigned` for the fast
# variant — Gatekeeper will block it on a fresh guest, so bypass with a
# right-click → Open inside the VM.
#
#   just lab-dmg            # signed + notarized
#   just lab-dmg unsigned   # fast, unsigned
#
# Override the staging dir with LAB_SHARE=/some/path.
#
# Build Tug.dmg and stage it on the VM-lab disk (MODE: notarized|unsigned).
lab-dmg MODE="notarized":
    #!/usr/bin/env bash
    set -euo pipefail
    LAB_SHARE="${LAB_SHARE:-/Volumes/Lab-A/share}"
    LAB_ROOT="$(dirname "$LAB_SHARE")"
    if [ ! -d "$LAB_ROOT" ]; then
        echo "error: VM-lab disk not mounted (missing $LAB_ROOT)" >&2
        exit 1
    fi
    case "{{MODE}}" in
        notarized) tugrust/scripts/build-app.sh ;;
        unsigned)  tugrust/scripts/build-app.sh --skip-sign --skip-notarize ;;
        *) echo "unknown mode: {{MODE}} (use 'notarized' or 'unsigned')" >&2; exit 1 ;;
    esac
    mkdir -p "$LAB_SHARE"
    cp -f products/Tug.dmg "$LAB_SHARE/Tug.dmg"
    echo "==> staged for the VM lab: $LAB_SHARE/Tug.dmg"
    ls -lh "$LAB_SHARE/Tug.dmg"

# VM-lab (Tart) recipes — thin wrappers over scripts/lab/*, vendored into the
# repo from the former /Volumes/Lab-A/bin copies (now a stale mirror). LAB_ROOT
# (default /Volumes/Lab-A) and TART_HOME (default $LAB_ROOT/tart) parameterize
# the lab disk so the workflow rides version-controlled tooling, not disk-local
# one-offs.
#
#   just lab-ls                        # bases + runs + lab-disk free space
#   just lab-new sequoia [run]         # clone base-sequoia -> run-<run>
#   just lab-run <run> [tart flags]    # boot a run (e.g. --dir=drop:$LAB_SHARE)
#   just lab-wipe <run> | --all        # delete throwaway run(s); bases untouched

# List golden bases, throwaway runs, and lab-disk free space.
lab-ls:
    scripts/lab/lab-ls

# Clone a golden base into a throwaway run (lab-new <base> [run]).
lab-new *ARGS:
    scripts/lab/lab-new {{ARGS}}

# Boot a run VM; extra args pass through to `tart run`.
lab-run *ARGS:
    scripts/lab/lab-run {{ARGS}}

# Delete a throwaway run (lab-wipe <run> | --all); golden bases untouched.
lab-wipe *ARGS:
    scripts/lab/lab-wipe {{ARGS}}

# The one reliable inner loop ([P02]): build an unsigned Tug.dmg, stage it to
# the lab share, wipe any prior run for this OS, clone a fresh factory-fresh
# guest, and boot it with the share mounted — in one command. There is
# deliberately NO install-into-running-VM path: VirtioFS caching + a stale
# /Applications/Tug.app make reinstall-in-place unreliable, so every cycle
# boots a fresh clone. The run for OS <x> is run-<x> (replacing the prior one).
#
#   just lab-cycle sequoia
#
# Inside the booted guest, the dmg appears at:
#   /Volumes/My Shared Files/drop/Tug.dmg
# Build + stage an unsigned dmg, then boot a fresh clone with it mounted (the inner loop).
lab-cycle OS="sequoia":
    #!/usr/bin/env bash
    set -euo pipefail
    # Export so the nested lab-dmg recipe and scripts/lab/* honor overrides.
    export LAB_SHARE="${LAB_SHARE:-/Volumes/Lab-A/share}"
    export LAB_ROOT="${LAB_ROOT:-/Volumes/Lab-A}"
    [ -n "${TART_HOME:-}" ] && export TART_HOME
    if [ ! -d "$LAB_ROOT" ]; then
        echo "error: VM-lab disk not mounted (missing $LAB_ROOT)" >&2
        exit 1
    fi
    echo "==> [1/4] Build + stage unsigned Tug.dmg -> $LAB_SHARE"
    just lab-dmg unsigned
    echo "==> [2/4] Wipe any prior run-{{OS}} (fresh-clone discipline)"
    scripts/lab/lab-wipe {{OS}} || true
    echo "==> [3/4] Clone a fresh run-{{OS}} from base-{{OS}}"
    scripts/lab/lab-new {{OS}}
    echo "==> [4/4] Boot run-{{OS}} with the share mounted"
    echo "    In the guest, install from: /Volumes/My Shared Files/drop/Tug.dmg"
    exec scripts/lab/lab-run {{OS}} --dir=drop:"$LAB_SHARE"

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
# Verify a Developer ID Application cert is installed (one-time per machine).
setup-dev-signing:
    scripts/setup-dev-signing.sh

# Clear the per-machine code-sign drift sentinel. Use this if the
# `code-sign-fingerprint` file ever gets out of sync (e.g. after
# manually re-issuing the Developer ID cert in Xcode).
#
# The sentinel lives in the per-project runtime-state dir (out of the
# repo), resolved via `tugutil host state-dir`.
#
# Does NOT touch the Developer ID cert in the login keychain — that's
# the user's Apple-issued identity, not project-specific.
#
# Idempotent: reports "nothing to remove" and exits 0 if the
# sentinel doesn't exist.
# Clear the per-machine code-sign drift sentinel.
teardown-dev-signing:
    #!/usr/bin/env bash
    set -euo pipefail
    SENTINEL_FILE="$(tugutil host state-dir 2>/dev/null || tugrust/target/debug/tugutil host state-dir)/code-sign-fingerprint"
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
# Build the signed app-test bundle (stable bundle id) for 'just app-test'.
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
    bun build --compile tugcode/src/pulse/main-pulse.ts --outfile tugrust/target/debug/tugpulse

    echo "==> [2/5] tugdeck deps + prebuilt dist"
    (cd tugdeck && bun install && bun run build)

    echo "==> [3/5] tests/app-test deps"
    (cd tests/app-test && bun install)

    # PRODUCT_NAME names the built `.app` per variant (Tug-apptest under
    # TUG_FORCE_BUNDLE_ID=…apptest) so each variant is its own bundle file
    # that never clobbers or re-signs another. Matches bundle-id-from-cwd.sh.
    export TUG_PRODUCT_NAME="$(bash tugrust/scripts/product-name-from-cwd.sh debug)"
    PRODUCT_NAME="$TUG_PRODUCT_NAME"
    # Per-variant derivedDataPath isolates this build from the interactive
    # app-debug build (and every other variant): they no longer share one
    # DerivedData and so never clobber each other's `.app`.
    DERIVED="$(bash tugrust/scripts/derived-data-path.sh debug)"
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
        -derivedDataPath "$DERIVED" build \
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
    APP_DIR="$DERIVED/Build/Products/Debug/${PRODUCT_NAME}.app"
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
    SENTINEL_DIR="$(tugutil host state-dir 2>/dev/null || tugrust/target/debug/tugutil host state-dir)"
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

# Run app-tests by name: build-if-needed, then run the given files.
#
# NOT the everyday command — that's `just app-test-changed`, which
# derives its selection from your diff via each test's `@covers` header.
# Reach for `app-test` when you already know which files you want, and
# for the no-argument CORE tier (~20 tests, one per load-bearing
# surface) when you want a fast broad read on the app's health. The
# core tier is deliberately NOT everything: `just app-test-all` runs
# every file.
#
# Builds the dedicated app-test bundle (`dev.tugtool.app.apptest` →
# Tug-apptest.app) ONLY when it's missing, then launches each test file
# as its own Tug.app subprocess via `launchTugApp`. Output streams
# per-file; the last line is exactly `VERDICT: PASS` / `VERDICT: FAIL`
# (recipe exit code matches, greppable via `tail -n 1`).
#
# Fully isolated from your interactive instances AND from other
# worktrees: the bundle has its own identity, its own per-worktree
# DerivedData (so a build here never clobbers a live `app-debug`
# bundle or another worktree's app-test bundle), its own port window /
# sockets / private tmux server, and `apptest-<wtslug>-<uuid>`
# per-launch runtime state whose destructive sweeps match only this
# worktree's prefix. Whole invocations are serialized machine-wide by
# a port gate (`tugutil host gate --name apptest`) — native input and app
# activation are login-session singletons, so only one app-test run
# ever drives them at a time; a second invocation queues with a
# visible "held by <worktree>" message. AX is granted once via
# `just app-test-grant` and covers every worktree's bundle (the TCC
# grant keys on the path-independent designated requirement).
#
# Prereq (one-time per machine): `just setup-dev-signing`.
#
# Usage:
#   just app-test-changed                          # <- the everyday command
#   just app-test                                  # the ~20-test core tier
#   just app-test at0001-tab-switch-fc.test.ts     # one file (bare name or repo path)
#   just app-test harness-smoke/smoke.test.ts at0003-pane-activation.test.ts
#   just app-test-all                              # every test file
#
# Changed Swift / Rust / harness source? `app-test` only builds when the
# bundle is ABSENT — use `just app-test-build` to force a fresh build.
#
# Tests run in the BACKGROUND and leave your machine alone. They start
# immediately and never wait for you.
#
# The few whose subject is activation itself declare `@foreground` and really do
# take over the screen. When a run contains any of those, it raises the question
# in the Session card right away, runs every background test while you decide,
# and saves the screen-takers for last — so by the time the answer matters, it
# is usually already in. Declining skips them; the background run has already
# happened either way.
#
# Set TUG_APPTEST_ASSUME to answer ahead of time and raise nothing:
#
#   TUG_APPTEST_ASSUME=all         run everything, screen-takers included
#   TUG_APPTEST_ASSUME=background  skip the screen-takers, keep working
#   TUG_APPTEST_ASSUME=cancel      run nothing at all
#
# Scripted and non-interactive runs should set it. With no Tug instance to ask,
# a run proceeds after naming the tests that will take the screen — blocking a
# terminal-only run that could never show a dialog is worse.
#
# Build the app-test bundle if missing, then run the given files (core tier if none).
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

    # Worktree identity. Scopes the per-launch instance ids
    # (apptest-<wtslug>-<uuid>, minted by the harness from
    # TUG_APPTEST_ID_PREFIX) and every destructive sweep below to THIS
    # worktree, so one worktree's run can never stop another worktree's
    # instances, wipe its data dirs, or reap its tmux server. Same
    # branch → slug derivation as bundle-id-from-cwd.sh.
    if BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" && [ "$BRANCH" != "HEAD" ]; then :; else
        SHA="$(git rev-parse HEAD 2>/dev/null | cut -c1-8)"
        BRANCH="detached-${SHA:-unknown}"
    fi
    WTSLUG="$(bash tugrust/scripts/branch-slug.sh "$BRANCH")"
    export TUG_APPTEST_ID_PREFIX="apptest-${WTSLUG}"

    # One app-test invocation at a time, machine-wide. Native CGEvent
    # input, app activation, and key-window status are login-session
    # singletons — two concurrent runs would interleave each other's
    # gestures no matter how well files and ports are namespaced. The
    # gate is a localhost port bind (tugutil host gate; kernel-released on
    # any death, no lock file): the whole invocation — clean slate,
    # build-if-missing, dist refresh, every file, exit cleanup — runs
    # under it, so one run completes before the next begins. A waiting
    # invocation prints who holds the gate and since when.
    if [ "${TUG_APPTEST_GATED:-}" != "1" ]; then
        if [ ! -x tugrust/target/debug/tugutil ]; then
            echo "==> building tug (needed for the app-test gate)…"
            (cd tugrust && cargo build -p tugutil >/dev/null)
        fi

        # Most tests now run in the background and are nobody's business but
        # this shell's. A few genuinely cannot — their subject IS activation —
        # so they launch with `foreground: true` and take the screen. Those get
        # announced first, because a run that seizes the machine mid-thought
        # with no warning is the thing this gate exists to prevent.
        #
        # The question is RAISED here and answered later. It does not block:
        # the background tests start immediately and the screen-takers are run
        # last, by which time the answer has usually already arrived. Anything
        # that needed no permission must never wait on something that did.
        #
        # It is raised before the gate re-exec, and never while holding the
        # gate — a run waiting on a human would otherwise block every other
        # worktree's run for as long as the dialog sat unanswered. The asker is
        # a detached process; the answer reaches the gated child through a file
        # named in $TUG_APPTEST_ASK_OUT.
        #
        # TUG_APPTEST_ASSUME=all|background|cancel answers ahead of time and
        # raises nothing. `cancel` is checked here, before any work starts,
        # because as an explicit directive it means "run nothing" — whereas
        # declining the DIALOG only skips the screen-takers, the background run
        # having already happened.
        if [ "${TUG_APPTEST_ASSUME:-}" = "cancel" ]; then
            echo "==> TUG_APPTEST_ASSUME=cancel — nothing was run." >&2
            exit 1
        fi

        if [ -z "${TUG_APPTEST_ASSUME:-}" ]; then
            if [ -z "{{FILES}}" ]; then
                ASK_FILES="$(cd tests/app-test && bun scripts/select-tests.ts --core)"
            else
                ASK_FILES="$(printf '%s\n' {{FILES}})"
            fi
            FG_FILES="$(cd tests/app-test && bun scripts/select-tests.ts --foreground $ASK_FILES)"

            if [ -n "$FG_FILES" ]; then
                FG_COUNT="$(printf '%s\n' "$FG_FILES" | grep -c .)"
                ALL_COUNT="$(printf '%s\n' "$ASK_FILES" | grep -c .)"
                BG_COUNT=$((ALL_COUNT - FG_COUNT))
                FG_LIST="$(printf '%s\n' "$FG_FILES" | sed 's/\.test\.ts$//' | paste -sd ',' - | sed 's/,/, /g')"

                # Two choices, because by the time this is answered the
                # background run is already under way — "cancel everything" is
                # no longer a coherent thing to offer. Declining is last, which
                # is what the dialog preselects.
                if [ "$BG_COUNT" -gt 0 ]; then
                    RUN_DESC="The other $BG_COUNT are running now either way"
                    SKIP_LABEL="Skip them"
                else
                    RUN_DESC="Nothing else is in this run"
                    SKIP_LABEL="Skip them — run nothing"
                fi

                ASK_OUT="$(mktemp -t apptest-ask.XXXXXX)"
                export TUG_APPTEST_ASK_OUT="$ASK_OUT"
                (
                    CHOICE="$(tugrust/target/debug/tugutil host ask \
                        ${TUG_INSTANCE:+--instance "$TUG_INSTANCE"} \
                        --title "$FG_COUNT app-test(s) want to take over the screen" \
                        --description "$FG_LIST" \
                        --option "run-all:Run them:$RUN_DESC" \
                        --option "background:$SKIP_LABEL:Keeps the screen yours" \
                        2>/dev/null)"
                    ASK_STATUS=$?
                    printf '%s\n%s\n' "$ASK_STATUS" "$CHOICE" > "$ASK_OUT.part"
                    # Rename so the reader never sees a half-written answer.
                    mv "$ASK_OUT.part" "$ASK_OUT.done"
                ) &
                # Hand the asker's pid forward so the gated child can reap it.
                # `disown` detaches it from THIS shell, which `exec` is about to
                # replace; without the pid, a ^C'd run would leave the question
                # standing in the Session card with nobody left to hear it.
                export TUG_APPTEST_ASK_PID=$!
                disown 2>/dev/null || true
            fi
        fi

        export TUG_APPTEST_GATED=1
        exec tugrust/target/debug/tugutil host gate run --name apptest --label "$WTSLUG" -- just app-test {{FILES}}
    fi
    echo "==> app-test instance prefix: $TUG_APPTEST_ID_PREFIX"

    export TUG_PRODUCT_NAME="$(bash tugrust/scripts/product-name-from-cwd.sh debug)"
    PRODUCT_NAME="$TUG_PRODUCT_NAME"
    APP_DIR="$(bash tugrust/scripts/derived-data-path.sh debug)/Build/Products/Debug/${PRODUCT_NAME}.app"
    APP_BIN="$APP_DIR/Contents/MacOS/${PRODUCT_NAME}"
    # Build-if-missing: one command does the whole thing. Only builds when
    # the bundle is ABSENT — changed Swift/Rust/harness source needs an
    # explicit `just app-test-build` to force a fresh build. The build
    # goes to the app-test variant's own DerivedData, never touching a
    # live `app-debug` bundle.
    if [ ! -x "$APP_BIN" ]; then
        echo "==> ${PRODUCT_NAME}.app not built yet — building once (slow only the first time)…"
        just build-app
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
    # reflects current source. A failed build MUST abort the run:
    # continuing would silently test whatever stale dist is on disk,
    # producing verdicts about old code.
    if ! (cd tugdeck && bun run build >/dev/null); then
        echo "[app-test] tugdeck dist build FAILED — aborting; a stale dist would test old code." >&2
        echo "           Run 'cd tugdeck && bunx vite build' to see the build error." >&2
        exit 1
    fi

    # Clean slate before the first spawn: wipe THIS WORKTREE's
    # apptest data dirs from earlier runs and stop any of its tugcasts
    # that are still alive. Every match is scoped to
    # $TUG_APPTEST_ID_PREFIX — another worktree's instances, like a
    # developer's `app-debug` / `app-release`, are structurally out of
    # reach (and the gate above means none should be running anyway).
    rm -rf "$HOME/Library/Application Support/Tug/instances/${TUG_APPTEST_ID_PREFIX}-"* 2>/dev/null || true
    while read -r ID; do
        case "$ID" in "${TUG_APPTEST_ID_PREFIX}-"*)
            tugrust/target/debug/tugutil host instance stop "$ID" --timeout 2 >/dev/null 2>&1 || true ;;
        esac
    done < <(tugrust/target/debug/tugutil host instance list 2>/dev/null | tail -n +2 | awk '{print $1}')
    # Registry-blind orphan backstop. An app that spawned but hung
    # BEFORE its test socket accepted (e.g. a mid-run dist rebuild
    # broke the splash load) is invisible to every layer above: the
    # harness's connect-failure catch kills only the `open -n -W`
    # wrapper (it never learned the GUI PID), and the instance-registry
    # stop above never saw it (registration happens later in boot).
    # Kill by EXACT binary path: the apptest bundle lives in THIS
    # worktree's own DerivedData, and the gate guarantees no
    # legitimate instance of it is running when a sweep starts — so a
    # path-scoped pkill reaps exactly this orphan class and can never
    # touch a developer's real Tug.app or another worktree's bundle.
    pkill -f "$APP_BIN" 2>/dev/null || true
    sleep 0.3

    # Reap orphaned per-instance tmux servers from ungracefully-killed
    # app-test runs (and stale empty socket files tmux leaves behind
    # after a graceful kill-server). Each app-test instance owns a
    # private `tmux -L tug-<token>` server; a graceful close tears it
    # down (tugcast's shutdown), but a SIGKILLed run leaks the whole
    # server. A private server hosting only THIS WORKTREE's
    # `cc-${TUG_APPTEST_ID_PREFIX}-*` sessions is our orphan — reap it.
    # Another worktree's apptest sessions, and dev/release servers
    # (`cc-debug-*` / `cc-release-*`), are NEVER matched.
    #
    # A server with NO sessions stays in scope deliberately: an empty
    # server cannot be attributed to a worktree, and the gate
    # guarantees no other app-test run is live while we sweep — so an
    # empty tug-* server here is a dead orphan, not someone's
    # mid-boot server. Run both before the first spawn and in cleanup
    # so nothing accrues per run.
    reap_orphan_tmux_servers() {
        local dir="${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)"
        [ -d "$dir" ] || return 0
        local sock label sessions
        for sock in "$dir"/tug-*; do
            [ -e "$sock" ] || continue
            label="$(basename "$sock")"
            sessions="$(tmux -L "$label" list-sessions -F '#S' 2>/dev/null)"
            if [ -z "$sessions" ] || ! printf '%s\n' "$sessions" | grep -qv "^cc-${TUG_APPTEST_ID_PREFIX}-"; then
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
    # `apptest-<wtslug>-<uuid>` (→ unique short token), so an orphan can
    # never collide with a future run — it's a harmless dead file that
    # $TMPDIR reaps on its own schedule. We deliberately do NOT
    # glob-and-remove sockets here: the only such glob that ever existed
    # (`tugcast-ctl-*.sock`) was unscoped and could reach a live
    # dev/release instance's control socket. Isolation > tidiness.

    TMPOUT="$(mktemp -t app-test.XXXXXX)"
    cleanup() {
        # Targeted teardown — stop only THIS WORKTREE's apptest
        # instances. Another worktree's run and a developer's
        # separately-running app-debug session continue unaffected
        # (and `instance stop` is identity-checked, so a recycled PID
        # is never signalled).
        while read -r ID; do
            case "$ID" in "${TUG_APPTEST_ID_PREFIX}-"*)
                tugrust/target/debug/tugutil host instance stop "$ID" --timeout 2 >/dev/null 2>&1 || true ;;
            esac
        done < <(tugrust/target/debug/tugutil host instance list 2>/dev/null | tail -n +2 | awk '{print $1}')
        # Registry-blind orphan backstop (same rationale as the
        # clean-slate copy above): reap any apptest app that hung
        # before registering, by its worktree-scoped binary path.
        pkill -f "$APP_BIN" 2>/dev/null || true
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
        # The CORE tier: one test per load-bearing surface, not a sweep. The
        # list itself lives in select-tests.ts, because the pre-gate approval
        # check above has to know which files a bare `just app-test` will run
        # before this point in the recipe is ever reached.
        read -r -a FILES <<< "$(bun scripts/select-tests.ts --core | tr '\n' ' ')"
        SWEEP_LABEL="core"
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

    # Background tests never wait on anybody. Screen-taking ones go LAST, and
    # the question about them is answered while the background work is already
    # running — a test that needs no permission must never be held up by one
    # that does.
    #
    # The reordering happens here rather than before the gate re-exec because
    # that exec re-passes `{{FILES}}` — a just template variable, not a shell
    # one — so the pre-gate shell has no way to hand a reordered list forward.
    # It hands the pending question forward instead ($TUG_APPTEST_ASK_OUT), and
    # this is where the answer is collected.
    FG_FILES="$(bun scripts/select-tests.ts --foreground "${FILES[@]}")"
    declare -a FG_QUEUE=()
    if [ -n "$FG_FILES" ]; then
        declare -a BG_QUEUE=()
        for f in "${FILES[@]}"; do
            if printf '%s\n' "$FG_FILES" | grep -qx "$f"; then
                FG_QUEUE+=("$f")
            else
                BG_QUEUE+=("$f")
            fi
        done
        FILES=("${BG_QUEUE[@]}" "${FG_QUEUE[@]}")
        if [ "${#BG_QUEUE[@]}" -gt 0 ]; then
            echo "==> running ${#BG_QUEUE[@]} background test(s) now; the ${#FG_QUEUE[@]} that take the screen come last."
        fi
    fi

    # A ^C (or any other death) must not leave the question standing in the
    # Session card with this run gone. Kill the detached asker — that drops its
    # HTTP request, tugcast clears the pending entry, and the dialog's Escape is
    # all that is left to tidy — and take the handoff files with it. Harmless
    # when the answer already landed: the pid is reaped and the files are gone.
    cleanup_pending_ask() {
        [ -n "${TUG_APPTEST_ASK_PID:-}" ] && kill "$TUG_APPTEST_ASK_PID" 2>/dev/null
        [ -n "${TUG_APPTEST_ASK_OUT:-}" ] && rm -f \
            "$TUG_APPTEST_ASK_OUT" "$TUG_APPTEST_ASK_OUT.part" "$TUG_APPTEST_ASK_OUT.done" \
            2>/dev/null
        return 0
    }
    trap cleanup_pending_ask EXIT INT TERM

    # Collect the answer to the question raised before the gate. Called just
    # before the first screen-taking test, so the background run has already had
    # however long it took as thinking time. Sets FG_DECISION to run|skip.
    FG_DECISION=""
    resolve_foreground_decision() {
        [ -n "$FG_DECISION" ] && return 0
        case "${TUG_APPTEST_ASSUME:-}" in
            all)        FG_DECISION=run;  return 0 ;;
            background) FG_DECISION=skip; return 0 ;;
        esac
        local out="${TUG_APPTEST_ASK_OUT:-}"
        if [ -z "$out" ]; then
            FG_DECISION=run
            return 0
        fi
        # The ask carries its own timeout, so this waits for it to land rather
        # than racing it. The ceiling is a backstop against a killed asker.
        local waited=0
        while [ ! -f "$out.done" ]; do
            if [ "$waited" -ge 660 ]; then
                echo "==> the approval request never came back — skipping the screen-takers." >&2
                FG_DECISION=skip
                return 0
            fi
            [ "$waited" -eq 0 ] && echo "==> waiting on your answer about the ${#FG_QUEUE[@]} test(s) that take the screen…"
            sleep 1
            waited=$((waited + 1))
        done
        local status choice
        status="$(sed -n '1p' "$out.done")"
        choice="$(sed -n '2p' "$out.done")"
        rm -f "$out.done" "$out" 2>/dev/null || true
        case "$status:$choice" in
            # Exit 3 is "nobody to ask", not a refusal. A terminal-only run
            # could never have shown a dialog, and the developer typed the
            # command themselves — so it proceeds, having said so.
            3:*)
                echo "==> no Tug instance to ask — these take the screen: $(printf '%s\n' "${FG_QUEUE[@]}" | sed 's/\.test\.ts$//' | paste -sd ',' - | sed 's/,/, /g')" >&2
                FG_DECISION=run ;;
            0:run-all)
                FG_DECISION=run ;;
            # Declined. Note this also covers "the deck had no card to show it
            # on" — the store answers with the declining option rather than
            # leaving this run blocked, so a $TUG_SESSION_ID pointing at some
            # other instance lands here. Skipping is the safe reading either
            # way, and the summary lists every skipped file.
            0:*)
                echo "==> skipping the ${#FG_QUEUE[@]} test(s) that take the screen." >&2
                FG_DECISION=skip ;;
            *)
                echo "==> the approval request failed — skipping the screen-takers." >&2
                FG_DECISION=skip ;;
        esac
    }

    declare -a RESULT_ROWS=()
    declare -a FAILURE_BLOCKS=()
    START_EPOCH="$(date +%s)"

    for f in "${FILES[@]}"; do
        # The screen-takers are last in the list, so this resolves once, after
        # every background test has already run.
        if [ "${#FG_QUEUE[@]}" -gt 0 ] && printf '%s\n' "${FG_QUEUE[@]}" | grep -qx "$f"; then
            resolve_foreground_decision
            if [ "$FG_DECISION" = "skip" ]; then
                echo "---- $f (skipped — takes the screen) ----"
                RESULT_ROWS+=("SKIP:$f:0:0")
                continue
            fi
        fi
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

        # Between files, stop any of THIS WORKTREE's apptest
        # stragglers. The harness's `app.close()` already targets the
        # current instance; this is defence-in-depth for the rare case
        # where a test panics before reaching `close`.
        while read -r ID; do
            case "$ID" in "${TUG_APPTEST_ID_PREFIX}-"*)
                tugrust/target/debug/tugutil host instance stop "$ID" --timeout 2 >/dev/null 2>&1 || true ;;
            esac
        done < <(tugrust/target/debug/tugutil host instance list 2>/dev/null | tail -n +2 | awk '{print $1}')
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

# Run the app-tests that cover your working diff.
#
# Every `*.test.ts` declares the source it exercises with `@covers`
# lines in its header docblock. This recipe reads the changed files out
# of `git status`, resolves them through those declarations, prints the
# selection with the changed file that pulled each test in, and runs
# exactly that set. This — not `just app-test` — is the everyday
# command: it names what it is testing and why.
#
#   just app-test-changed                        # from the working diff
#   just app-test-changed tugdeck/src/lib/lens-store/index.ts   # from explicit paths
#
# A few paths run before any test's first assertion (the harness, the deck
# entry point), so no `@covers` line can scope them; the selector prints a
# CORE TIER ADVISED advisory in that case, and `just app-test` — the ~20-file
# core tier — is the honest answer to it.
#
# Run the app-tests whose @covers match your working diff.
app-test-changed *PATHS:
    #!/usr/bin/env bash
    set -uo pipefail
    FILES="$(cd tests/app-test && bun scripts/select-tests.ts {{PATHS}})"
    STATUS=$?
    # Exit 3 = the selection blew the budget. The script already explained itself
    # and printed the would-be selection; stop here rather than silently running a
    # sweep's worth of tests (or, worse, reporting "nothing to run").
    if [ "$STATUS" -eq 3 ]; then
        exit 1
    fi
    if [ "$STATUS" -ne 0 ]; then
        echo "==> select-tests failed (status $STATUS)." >&2
        exit "$STATUS"
    fi
    if [ -z "$FILES" ]; then
        echo "==> no app-test covers the changed files — nothing to run."
        exit 0
    fi
    just app-test $FILES

# Print the app-test selection for the working diff without running it.
app-test-select *PATHS:
    @cd tests/app-test && bun scripts/select-tests.ts --print {{PATHS}}

# Reach for this when a harness or app-shell change invalidates
# coverage-based selection, or before landing substantial work.
#
# Every app-test file, in run order. Slow — one Tug.app launch per file.
app-test-all:
    #!/usr/bin/env bash
    set -uo pipefail
    FILES="$(cd tests/app-test && { ls harness-smoke/*.test.ts | sort; ls *.test.ts | sort; })"
    just app-test $FILES

# An unannotated test can never be selected by `app-test-changed`, so it
# silently stops guarding its surface — this is the guard against that
# drift, along with a check that every @covers path still resolves.
#
# Lint the @covers declarations across every app-test file.
app-test-covers-check:
    @cd tests/app-test && bun scripts/select-tests.ts --check

# A test that takes the screen declares it with `@foreground`; the app-test
# recipe reads that declaration before it launches anything, so it can warn
# before a run seizes the machine. The declaration is only worth trusting if
# it matches behavior, which is what this checks — in both directions. An
# untagged `foreground: true` seizes the screen unannounced; a tag with no
# such launch prompts about a test that was never disruptive.
app-test-foreground-check:
    @cd tests/app-test && bun scripts/select-tests.ts --foreground-check

# Score the local model's PULSE session headlines against a RUNNING instance.
#
# Frozen digests go over the control socket to the live app, so what gets
# scored is the shipped prompt + the resident model + tugcast's
# `headline_register` together. On-demand, not part of `just test`: it needs an
# instance up with a model installed, and it spends real inference.
#
# Run it after touching `LocalModelPrompts.summarize` or `headline_register` —
# both change what lands on the strip, and neither has a unit test that can
# tell you whether the wording got better.
#
#   just app-debug          # then, once it is up:
#   just model-eval
#   just model-eval release-main
model-eval INSTANCE="debug-main":
    @python3 tests/model-eval/run.py {{INSTANCE}}

# The same scoring for the idle collapse's past-tense lane.
#
# A separate recipe rather than a flag because it is a separate measurement:
# different fixtures (`corpus/*.done.txt`), a different task on the wire
# (`summarize_done`), and a different half of `verbs.txt` deciding whether the
# opener is a verb. A pack can be fine at one and bad at the other — the 1.2B
# LFM2.5 scored 5/13 on intents and 2/13 here — so a run that reported one
# number for both would hide exactly the difference worth seeing.
#
#   just model-eval-done
model-eval-done INSTANCE="debug-main":
    @python3 tests/model-eval/run.py {{INSTANCE}} --retrospective

# Score shell routing against a RUNNING instance: did that line mean the shell?
#
# The one local-model harness with ground truth, so unlike `model-eval` it is a
# gate rather than a rate — and the gate is one-sided. It fails only on a false
# SHELL, the verdict that already ran a command nobody asked for; a command sent
# to Claude instead costs one keystroke and is reported without failing.
#
# Run it after touching `LocalModelPrompts.classify`, the verdict parse in
# `LocalModelService`, or `shell-line-classifier.ts`.
#
#   just model-classify
#   just model-classify release-main
model-classify INSTANCE="debug-main":
    @python3 tests/model-eval/classify.py {{INSTANCE}}

# Is the live local-model path answering, and inside its ceiling?
#
# On-demand, not CI: it needs a downloaded pack and real hardware. Without
# either it skips with exit 0 and names the remedy. Asks nothing about what
# the headline says — that is `just model-eval`'s question.
#
#   just model-liveness
#   just model-liveness release-main
model-liveness INSTANCE="debug-main":
    @python3 tests/model-eval/liveness.py {{INSTANCE}}

# What accumulated logs say about the local model: how fast, how often it
# fails, how often the register normalizer had to step in, and how often the
# headline actually changed. Reads both log files in the instance's Logs
# directory; the numbers are only as good as the usage behind them.
#
#   just model-stats
#   just model-stats release-main
model-stats INSTANCE="debug-main":
    @python3 tests/model-eval/analyze.py {{INSTANCE}}

# Force a fresh app-test build, then run. Use after changing Swift /
# Rust / harness source — `just app-test` only builds when the bundle is
# ABSENT, so it would otherwise run against a stale bundle. The build
# goes to the app-test variant's own DerivedData and never touches a
# live `app-debug` bundle.
#
#   just app-test-build                       # rebuild + the core tier
#   just app-test-build at0000-smoke.test.ts  # rebuild + one file
#
# Force a fresh app-test build, then run the given files (core tier if none).
app-test-build *FILES:
    #!/usr/bin/env bash
    set -euo pipefail
    export TUG_FORCE_BUNDLE_ID=dev.tugtool.app.apptest
    # build-app runs OUTSIDE the app-test gate, which is fine: it
    # targets this worktree's own per-worktree DerivedData, so it can
    # never clobber a bundle another worktree's gated run is executing.
    # The `just app-test` call below re-execs itself under the gate.
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
# One-time Accessibility grant for the app-test identity.
app-test-grant:
    #!/usr/bin/env bash
    set -euo pipefail
    export TUG_FORCE_BUNDLE_ID="${TUG_FORCE_BUNDLE_ID:-dev.tugtool.app.apptest}"
    export TUG_PRODUCT_NAME="$(bash tugrust/scripts/product-name-from-cwd.sh debug)"
    PRODUCT_NAME="$TUG_PRODUCT_NAME"
    echo "==> Building ${PRODUCT_NAME}.app pinned to $TUG_FORCE_BUNDLE_ID"
    just build-app
    APP_DIR="$(bash tugrust/scripts/derived-data-path.sh debug)/Build/Products/Debug/${PRODUCT_NAME}.app"
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
# Fast smoke: bridge + handshake + one AT scenario (~20-30s).
app-test-smoke: (app-test "harness-smoke/smoke.test.ts" "harness-smoke/version-handshake.test.ts" "at0001-tab-switch-fc.test.ts")

# Remove the interactive debug build's per-variant DerivedData (matches
# `app-debug` — the cwd-derived debug variant, e.g. Tug-debug / Tug-worktree).
# Remove the interactive debug build's per-variant DerivedData.
clean-debug:
    #!/usr/bin/env bash
    set -euo pipefail
    unset TUG_FORCE_BUNDLE_ID
    rm -rf "$(bash tugrust/scripts/derived-data-path.sh debug)"

# Remove the interactive release build's per-variant DerivedData (matches
# `app-release`).
# Remove the interactive release build's per-variant DerivedData.
clean-release:
    #!/usr/bin/env bash
    set -euo pipefail
    unset TUG_FORCE_BUNDLE_ID
    rm -rf "$(bash tugrust/scripts/derived-data-path.sh release)"

# Clean the Rust workspace target dir (shared by debug + release)
clean-rust:
    cd tugrust && cargo clean

# Wipe every build artifact: ALL per-variant Xcode DerivedData (debug,
# release, apptest, worktree — plus the legacy shared per-project default)
# and the Rust target/.
# Wipe every build artifact: all per-variant DerivedData + the Rust target/.
clean-all: clean-rust
    #!/usr/bin/env bash
    set -euo pipefail
    DD="${HOME}/Library/Developer/Xcode/DerivedData"
    # Named per-variant dirs (Tug, Tug-debug, Tug-apptest, Tug-worktree, …)
    # plus the legacy shared `Tug-<projecthash>` default that predates the
    # per-variant split.
    rm -rf "$DD"/Tug "$DD"/Tug-* 2>/dev/null || true
    echo "cleaned all Tug DerivedData under $DD"
