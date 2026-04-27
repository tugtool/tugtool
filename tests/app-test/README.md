# `tests/app-test/`

App-test integration tests that drive a real `Tug.app` subprocess
through the DEBUG-only `TestHarness` Unix-socket bridge. Unlike the
colocated tests under `tugdeck/src/__tests__/`, these tests do **not**
use happy-dom — they talk to the actual WKWebView inside the launched
app.

**Related docs:**

- [`roadmap/tugplan-in-app-bridge.md`](../../roadmap/tugplan-in-app-bridge.md)
  — design rationale, decisions ([D01]–[D14]), and transport / boot
  choreography.
- [`roadmap/tugplan-harness-extensions.md`](../../roadmap/tugplan-harness-extensions.md)
  — Phase A native-event family (CGEvent-backed gestures, keyboard,
  app-lifecycle), tugcode subprocess control.
- [`tuglaws/app-test-inventory.md`](../../tuglaws/app-test-inventory.md)
  — canonical AT-tag catalog. Every `at{NNNN}-*.test.ts` filename
  prefix MUST match an entry there.
- [`roadmap/tugplan-app-test-cleanup.md`](../../roadmap/tugplan-app-test-cleanup.md)
  — the 2026-04-27 cleanup that produced the current naming.

## Running

```bash
# 1. One-time per machine: install the 'Tug Dev' code-signing identity.
just setup-dev-signing

# 2. Build (and re-sign) Tug.app + Rust binaries + tugdeck dist.
#    Re-run only when Swift / Rust sources change.
just build-app

# 3. Run the full app-test sweep.
just app-test

# Run a single file:
just app-test at0001-tab-switch-fc.test.ts
just app-test harness-smoke/smoke.test.ts

# Run a list of specific files in order:
just app-test harness-smoke/smoke.test.ts at0003-pane-activation.test.ts
```

`just app-test` ends every run with a structured summary block whose
last stdout line is exactly `VERDICT: PASS  (...)` or `VERDICT: FAIL
(...)`. Recipe exit code matches the verdict — 0 iff PASS. To check
pass/fail programmatically:

```bash
just app-test 2>/dev/null | tail -n 1   # → VERDICT: PASS  (47/47 ...)
```

The summary also lists every file with `[PASS]` / `[FAIL]` / `[SKIP]`
/ `[ERR]` and per-file `(passed/total)` counts, plus a `Failures:`
block when any file fails. See
[`roadmap/tugplan-app-test-cleanup.md#s01-summary-format`](../../roadmap/tugplan-app-test-cleanup.md#s01-summary-format)
for the contract.

## Environment variables

| Variable                  | Purpose                                                      |
|---------------------------|--------------------------------------------------------------|
| `TUGAPP_APP_TEST=1`    | Enables the `describe.skipIf(!SHOULD_RUN)` gate. Set by the just-recipe; tests should never set it themselves. |
| `TUGAPP_DEBUG_PATH`       | Absolute path to the debug `Tug.app` binary. Set by the just-recipe via xcodebuild's settings query. |
| `TUGAPP_TUGCODE_BINARY`   | Absolute path to the bun-compiled `tugcode` binary. Used by EM-card / live-mode tests. |
| `TUGAPP_TUGBANK_BINARY`   | Absolute path to the `tugbank` CLI. Used by cold-boot disk-side reads in `_harness/tugbank-helpers.ts`. |
| `TUGAPP_TEST_SOCKET`      | Reserved; set by the harness when spawning the subprocess.   |
| `TUGCODE_LIVE=1`          | Opt-in for live-mode tugcode smoke (`harness-smoke/smoke-em-live.test.ts`); requires Anthropic credentials. Skipped by default. |

Per-run log files are written under `tests/app-test/logs/` when a
test passes `testName` to `launchTugApp`; the directory is gitignored.

## Live-mode tugcode smoke

`tests/app-test/harness-smoke/smoke-em-live.test.ts` exercises a real
tugcode → Claude Code → Anthropic API round-trip. Because it consumes
API credits and requires live credentials, it is double-gated behind
`TUGCODE_LIVE=1` and stays out of the default `just app-test` sweep.

```bash
# Anthropic credentials must already be set (ANTHROPIC_API_KEY or
# `claude login`'s persisted creds).
TUGCODE_LIVE=1 just app-test harness-smoke/smoke-em-live.test.ts
```

The test sends a single deterministic prompt ("Reply with the single
word: ack.") so token cost stays in single digits per run. First-token
latency is allowed up to 20s for cold-start claude; full-turn up to
60s. Failure surfaces the last 50 lines of tugcode's stdout/stderr to
stderr.

## Lifecycle model: one App per file, explicit reset

Each test file launches its own `App` via `launchTugApp()` and closes
it in a `finally` block. Inside a file, tests may share the `App` if
they call `app.reset()` between scenarios — but **no state is shared
across files**. This matches the bridge's single-connection contract
([D12] in `tugplan-in-app-bridge.md` and the regression gate in
`harness-smoke/double-connect.test.ts`).

Canonical shape:

```ts
import { describe, expect, test } from "bun:test";
import { launchTugApp } from "@/_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

describe.skipIf(!SHOULD_RUN)("my scenario", () => {
  test("does the thing", async () => {
    const app = await launchTugApp({ testName: "my-scenario" });
    try {
      await app.seedDeckState({ /* ... */ });
      await app.click({ selector: "[data-card-id='a']" });
      const focused = await app.getFocused();
      expect(focused?.cardId).toBe("a");
    } finally {
      await app.close();
    }
  });
});
```

Why a fresh app per file:

- Crash isolation — one test file's hang does not poison the next.
- The WKUserScript that sets `window.__tugTestMode = true` runs only
  at process start; we cannot "downgrade" a live WebView.
- Log files rotate per spawn; failed-test diagnostics stay scoped.

Within a single file, prefer `app.reset()` over re-spawning when
scenarios share the app — it is orders of magnitude faster than a
subprocess boot.

## Fidelity envelope

The harness is **not a visual renderer**. It cannot assert caret
blink, paint correctness, or perceived snappiness. It *can* drive
`isTrusted: true` paths (WebKit's hardware-event default-focus, drag
selection, double-click-to-select-word, modifier-key combinations)
via the Phase A native-gesture family — see the next section. See
the "Fidelity limits" section of `tugplan-in-app-bridge.md` for the
full envelope. When a bug falls outside this envelope, mark the
residual as "manual verification required" in the test comment and
do not paper over it with a weaker proxy assertion.

## Phase A surface: native gestures, keyboard, introspection

Beyond the JS-synthesized gesture drivers (`app.click`, `app.type`,
`app.focusElement`), the harness exposes a trusted-event family
backed by Swift's `CGEvent.post` ([D02] + [Q05]):

**Native gestures** (point is `{x, y}` in CSS viewport coords):

| Method | Purpose |
|--------|---------|
| `nativeClick(point, opts?)` / `nativeClickAtElement(selector, opts?)` | Single trusted click. `opts`: `button`, `clickCount`, `mouseDownDelayMs`, `mouseUpDelayMs`. |
| `nativeDoubleClick(point)` / `nativeDoubleClickAtElement(selector)` | Pinned 80ms-interval double click; drives WebKit word-select. |
| `nativeRightClick(point)` / `nativeRightClickAtElement(selector)` | Right-button click for context-menu paths. |
| `nativeDrag(from, to, opts?)` / `nativeDragElement(fromSel, to, opts?)` | Endpoint-only drag (mouseDown → one mouseDragged → mouseUp). |
| `nativeMouseDown(point)` / `nativeMouseUp(point)` | Primitives — reach for these only when a click isn't atomic enough. |

**Native keyboard:**

| Method | Purpose |
|--------|---------|
| `nativeKey(key, modifiers?)` | One keystroke. `key` is a VirtualKeyMap entry (`"a"`, `"!"`, `"Enter"`, `"ArrowLeft"`, etc.). `modifiers` is a subset of `["cmd", "shift", "alt", "ctrl"]`. |
| `nativeType(text)` | ASCII string typed keystroke-by-keystroke. Non-ASCII rejects with `NativeTypeAsciiOnlyError`. |
| `holdModifier(mods, async thunk)` | Press modifiers, run inner verbs, release — all in one atomic Swift-side call. |

**`holdModifier` pattern:**

```ts
// Hold Cmd while executing multiple keystrokes as one sequence.
await app.holdModifier(["cmd"], async (inner) => {
  await inner.rpcCall("nativeKey", { key: "a" });     // Cmd+A
  await inner.rpcCall("nativeKey", { key: "c" });     // Cmd+C
});

// Simpler shape for a single inner keystroke: just pass the
// modifier directly to nativeKey.
await app.nativeKey("a", ["cmd"]);
```

Inner verbs inside a `holdModifier` thunk must be native gestures
only — `evalJS` / `waitForCondition` / nested `holdModifier` all
reject. Flatten modifier sets (`["cmd", "shift"]`) instead of
nesting scopes.

**Introspection** (pure DOM reads; no CGEvent):

| Method | Returns |
|--------|---------|
| `getElementText(selector)` | `textContent` (or `.value` for form controls). |
| `getElementValue(selector)` | `.value` of `<input>` / `<textarea>` / `<select>`. |
| `getElementAttribute(selector, name)` | `attribute` or `null`. |
| `getElementBounds(selector)` | Viewport-rel `{x, y, width, height}`. |
| `getElementScreenBounds(selector)` | Screen-CG `{x, y, width, height}` via `CoordMapping`. |
| `getElementState(selector)` | `{tagName, disabled, readOnly, checked, visible, isFocused}`. |
| `getActiveElement()` | `{tagName, id, cardId, persistKey, selector}` or `null`. |
| `getSelection(cardId?)` | Selection snapshot (form-control or contentEditable range). |
| `getComputedStyleValue(selector, property)` | Resolved CSS value. |

## Accessibility permission preflight

Phase A's trusted events are posted via `CGEvent.post`, which
requires Tug.app to hold the macOS Accessibility grant (System
Settings → Privacy & Security → Accessibility). `launchTugApp`
preflights this on every spawn and throws
`AccessibilityPermissionMissingError` if the grant is missing,
with actionable guidance naming the bundle path / id + a
`tccutil reset` recipe for stale grants.

Protocol-only tests in `harness-smoke/` (`smoke.test.ts`,
`double-connect.test.ts`, `log-capture.test.ts`,
`wait-for-condition.test.ts`) pass `skipAccessibilityPreflight: true`
so they stay independent of the grant state. Scenario tests
(`at{NNNN}-*.test.ts`, plus `harness-smoke/smoke-native.test.ts`)
leave the default strict — if the grant is missing, the failure
attribution is instant.

See [`scripts/setup-dev-signing.sh`](../../scripts/setup-dev-signing.sh)
for the one-time stable-signing setup ([D14]) that makes the grant
persist across rebuilds. When the grant breaks unexpectedly, see
the next section.

## Accessibility grant failure modes

The macOS Accessibility (TCC) grant is keyed to the bundle's code-
signing **designated requirement (DR)** — a string composed of the
bundle identifier plus the cert's leaf hash, not the binary's content
hash. Two builds signed by the same `Tug Dev` cert share a DR and
share a grant; anything that changes the DR forces a re-grant.

When `just app-test` starts failing with
`AccessibilityPermissionMissingError` or every CGEvent-backed test
silently no-ops, walk this checklist.

### What can invalidate the grant

1. **`Tug Dev` cert deleted and re-created.** A new self-signed cert
   has a different private key → different leaf hash → different DR.
   The fingerprint sentinel at `.tugtool/code-sign-fingerprint`
   detects this and `just app-test` prints a `[warn] code-sign
   fingerprint drift detected` diagnostic.
2. **`Tug.app` bundle moved or renamed.** TCC grants are also keyed
   to bundle path / identifier; moving the build product or editing
   the bundle id in `project.pbxproj` will invalidate the grant.
3. **Bare `xcodebuild` between runs.** Running an Xcode IDE Build
   (or `xcodebuild` directly without going through `just build-app`)
   re-signs ad-hoc, which produces a wholly different DR. `just
   app-test`'s defensive re-sign handles this transparently — but
   only if the `Tug Dev` cert is still installed.
4. **macOS major upgrade.** A major version bump can occasionally
   wipe TCC entries. Diagnoses as a one-shot re-grant requirement.
5. **Manual revoke.** System Settings → Privacy & Security →
   Accessibility, untoggling Tug.app.

### Diagnosis checklist

When AX is broken, work through these in order:

1. **Confirm the identity is still installed:**
   ```sh
   security find-identity -p codesigning | grep "Tug Dev"
   ```
   If empty → run `just setup-dev-signing` to recreate, then
   `just build-app` to re-sign.

2. **Confirm the bundle's DR matches the sentinel:**
   ```sh
   APP_DIR="$(xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug \
       -configuration Debug -destination 'platform=macOS,arch=arm64' \
       -showBuildSettings 2>/dev/null \
       | awk '/ BUILT_PRODUCTS_DIR /{print $3}')/Tug.app"
   diff <(codesign -d -r- "$APP_DIR" 2>&1 | awk -F'=> ' '/^designated/{print $2; exit}') \
        .tugtool/code-sign-fingerprint
   ```
   Empty diff → fingerprint is fresh. Non-empty → drift; the AX grant
   is almost certainly invalidated.

3. **Confirm Accessibility shows Tug.app and is enabled:** open
   System Settings → Privacy & Security → Accessibility. If Tug.app
   isn't listed, run `just app-test harness-smoke/smoke-native.test.ts`
   once to trigger the system grant dialog. If it's listed but
   greyed-out or untoggled, toggle it on.

4. **If the grant is stale and re-toggling doesn't work, reset and
   re-grant:**
   ```sh
   tccutil reset Accessibility dev.tugtool.app
   ```
   Then run `just app-test harness-smoke/smoke-native.test.ts` to
   trigger the dialog fresh.

### Last-resort bypass

If you need to run the harness without the AX-grant dance — e.g.,
during initial onboarding before `just setup-dev-signing` has run, or
when diagnosing whether the re-sign step itself is the culprit — set:

```sh
APP_TEST_SKIP_RESIGN=1 just app-test
```

`app-test` will skip the re-sign entirely. Tests that need
`CGEvent.post` (every `at*` scenario, plus `smoke-native.test.ts`)
will fail; tests that don't need AX (`smoke.test.ts`,
`double-connect.test.ts`, `version-handshake.test.ts`,
`wait-for-condition.test.ts`, `smoke-em.test.ts`) will pass.

## Smoke vs. scenario tests

Two test categories live in this directory:

### `harness-smoke/<name>.test.ts` — primitive gates

Pin a single harness primitive — RPC handshake, evalJS error
translation, native-CGEvent click round-trip, app-reload,
cold-boot/quitGracefully, capture-phase save invariant, etc. They
exist so a primitive regression can be diagnosed without the
attribution being conflated with an `at{NNNN}` scenario regression.

Smoke tests are not numbered. The filename describes what the gate
asserts. Add a smoke test only when (a) it pins a harness primitive
that AT scenarios depend on, AND (b) failure attribution would be
muddled without a separate gate.

### `at{NNNN}-<slug>.test.ts` — AT-numbered scenarios

Every AT-numbered file gates a regression case enumerated in
[`tuglaws/app-test-inventory.md`](../../tuglaws/app-test-inventory.md).
The `at{NNNN}` prefix MUST match an inventory entry. To add a new
scenario, add the inventory entry first (pick the next unused
`AT{NNNN}` — high-water mark and "next available" are both at the top
of the inventory), THEN write the test.

## Adding a new test

1. **Decide: smoke or scenario?** See above. If you're adding an
   AT-tag, also add the inventory entry first.

2. **Name the file.**
   - Scenario: `tests/app-test/at{NNNN}-<slug>.test.ts`.
   - Smoke: `tests/app-test/harness-smoke/<descriptive>.test.ts`.

3. **Gate on `TUGAPP_APP_TEST=1`.** Use
   `describe.skipIf(!SHOULD_RUN)` at the top of every `describe`
   block. Without it, `bun x tsc --noEmit` runs are forced to skip
   too, which keeps CI honest.

4. **Import from `@/_harness`.** The path alias resolves to
   `tests/app-test/_harness/index.ts` regardless of subdirectory
   depth. Key exports:

   - `launchTugApp(opts)` — spawn + connect + version handshake.
   - `App` class — `evalJS`, `waitForCondition`, `close`, plus typed
     wrappers (`click`, `type`, `focusElement`, `reset`,
     `seedDeckState`, `getActiveCardId`, `getFocusedCardId`,
     `getCaretState`, `getFormControlValue`, `getDeckTrace`,
     `markDeckTrace`, `expectFocusedCard`, `expectCaret`, the full
     native-gesture family, `simulateApp*` lifecycle verbs,
     `appReload`, `quitGracefully`, `startTugcode` / `stopTugcode`,
     ...).
   - `toContainOrderedSubset` / `registerSubsetMatcher()` — partial
     ordered-subset matcher for deck-trace assertions.
   - `EXPECTED_SURFACE_VERSION` — pinned `window.__tug` surface
     version; must match tugdeck and the Swift bridge.

5. **Drive, assert, close.** Seed state, drive gestures through the
   typed wrappers, assert against both `__tug` state reads and the
   deck-trace ring:

   ```ts
   const mark = await app.markDeckTrace();
   await app.click({ selector: "[data-tab='b']" });
   const trace = await app.getDeckTrace({ since: mark });
   expect(trace).toContainOrderedSubset([
     { kind: "fr-flip" },
     { kind: "destination-flip", cardId: "b", to: true },
     { kind: "focus-call", cardId: "b" },
   ]);
   ```

   Call `registerSubsetMatcher()` once at module load to enable the
   `expect(...).toContainOrderedSubset(...)` fluent form.

6. **Always close in `finally`.** Orphaned subprocesses accumulate
   across runs and exhaust socket paths.

7. **Prefer production code paths over synthetic events.** For focus,
   call `app.focusElement(selector)` — this uses the same `.focus()`
   path that production code takes, keeping the test inside the
   fidelity envelope. For trusted clicks/drags/keys, use
   `nativeClick` / `nativeDrag` / `nativeKey` — these post real
   `CGEvent`s and exercise WebKit's `isTrusted: true` paths that
   synthesized DOM events cannot reach.

## Lint: no raw timers

`tests/app-test/` forbids `setTimeout` and `setInterval` in test code
(the harness itself uses a `setTimeoutNative` alias internally —
see `_harness/index.ts`). Run the checker with:

```bash
cd tests/app-test && bun run lint:no-timers
```

Exit 0 is clean; exit 1 prints offending `file:line` locations. The
rationale: raw timers make flaky tests; use `app.waitForCondition` or
one of the typed wrappers that already wraps a timer with structured
timeout + error.

## Directory layout

```
tests/app-test/
  _harness/                   # Bun-side harness library. Imported via @/_harness.
  harness-smoke/              # Primitive gates: smoke + protocol tests.
    smoke.test.ts             # Minimal launchTugApp → evalJS → close.
    smoke-native.test.ts      # CGEvent click / type / Cmd+A / drag / double-click.
    smoke-em.test.ts          # EM-card observation surface (engine-ready, getEmCardState).
    smoke-em-live.test.ts     # Opt-in (TUGCODE_LIVE=1) Anthropic round-trip.
    smoke-app-reload.test.ts  # appReload primitive.
    smoke-cold-boot.test.ts   # quitGracefully + tugbankRead two-process round-trip.
    smoke-capture-phase-save.test.ts  # [A9] capture-phase save invariant.
    double-connect.test.ts    # Single-client transport guarantee.
    log-capture.test.ts       # Per-test log file capture.
    version-handshake.test.ts # EXPECTED_SURFACE_VERSION mismatch error.
    wait-for-condition.test.ts # evalJS error translation, timeout, immediate-truthy.
  at{NNNN}-<slug>.test.ts     # AT-numbered scenario tests; prefix must match inventory.
  bunfig.toml                 # [test] root = "." — no happy-dom preload.
  tsconfig.json               # Path alias @/_harness. tsc --noEmit must be clean.
  lint-no-timers.ts           # bun run lint:no-timers scanner.
  logs/                       # Per-spawn stdout/stderr dumps. Gitignored.
```

## TUGAPP_APP_TEST naming note

The Swift-side gate env var is still named `TUGAPP_APP_TEST=1`
even though the directory is now `tests/app-test/`. Renaming the env
var requires a coordinated Swift change with code-signing
implications — deferred. See
[`roadmap/tugplan-app-test-cleanup.md`](../../roadmap/tugplan-app-test-cleanup.md)
[D06].
