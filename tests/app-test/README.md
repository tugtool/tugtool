# `tests/app-test/`

App-test integration tests that drive a real `Tug.app` subprocess through
the DEBUG-only `TestHarness` Unix-socket bridge. Unlike the colocated
tests under `tugdeck/src/__tests__/`, these tests do **not** use
happy-dom — they talk to the actual WKWebView inside the launched app.

See the parent strategy doc [`roadmap/in-app-test-harness.md`](../../roadmap/in-app-test-harness.md)
and the Phase 2 plan [`roadmap/tugplan-in-app-bridge.md`](../../roadmap/tugplan-in-app-bridge.md)
for the design rationale, decisions ([D01]-[D13]), and transport / boot
choreography details.

## Running

Tests are gated on `TUGAPP_IN_APP_TEST=1`. Without it, every
`describe.skipIf(!SHOULD_RUN)` block is skipped, so the suite can be
safely included in CI and in local `bun x tsc --noEmit` checks even
without a built `Tug.app` binary.

To run the full suite locally:

```bash
# 1. Build the debug Tug.app binary.
cd tugapp && xcodebuild -scheme Tug -configuration Debug build

# 2. Run the in-app test suite from the repo root.
TUGAPP_IN_APP_TEST=1 bun test tests/app-test/

# Or a single file:
TUGAPP_IN_APP_TEST=1 bun test tests/app-test/smoke.test.ts
```

Environment variables honored by `launchTugApp`:

| Variable                  | Purpose                                                      |
|---------------------------|--------------------------------------------------------------|
| `TUGAPP_IN_APP_TEST=1`    | Enables the `describe.skipIf(!SHOULD_RUN)` gate in tests.    |
| `TUGAPP_DEBUG_PATH`       | Absolute path to the debug `Tug.app` binary (override).      |
| `TUGAPP_TUGCODE_BINARY`   | Absolute path to the tugcode binary (used by EM-card tests). |
| `TUGAPP_TEST_SOCKET`      | Reserved; set by the harness when spawning the subprocess.   |
| `TUGCODE_LIVE=1`          | Opt-in for live-mode tugcode smoke (`smoke-em-live.test.ts`); requires Anthropic credentials. Skipped by default. |

Per-run log files are written under `tests/app-test/logs/` when a test
passes `testName` to `launchTugApp`; the directory is gitignored.

## Running live-mode tugcode smoke

`tests/app-test/smoke-em-live.test.ts` exercises a real tugcode →
Claude Code → Anthropic API round-trip. Because it consumes API
credits and requires live credentials, it is gated behind
`TUGCODE_LIVE=1` and stays out of the default `just test-in-app-fast`
sweep. The default `just test-in-app-fast` run skips this file
deterministically — you do not need to opt out.

To run it locally:

```bash
# 1. Ensure your Anthropic credentials are set up the way Claude Code
#    expects (typically ANTHROPIC_API_KEY or `claude login`'s
#    persisted creds).
# 2. Run with both gates open:
TUGCODE_LIVE=1 just test-in-app-fast smoke-em-live.test.ts
```

The test sends a single deterministic prompt ("Reply with the single
word: ack.") so token cost stays in single digits per run. First-token
latency is allowed up to 20s for cold-start claude; full-turn up to
60s. Failure surfaces the last 50 lines of tugcode's stdout/stderr to
stderr so credentials issues / API errors are diagnosable without
spelunking through `$TMPDIR`.

## Lifecycle model: one App per file, explicit reset

Each test file launches its own `App` via `launchTugApp()` and closes
it in a `finally` block. Inside a file, tests may share the `App` if
they call `app.reset()` between scenarios — but **no state is shared
across files**. This matches the Phase 2 bridge's single-connection
contract (see [D12] in the parent plan and the double-connect test
in `double-connect.test.ts`).

Canonical shape:

```ts
import { describe, expect, test } from "bun:test";
import { launchTugApp } from "@/_harness";

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

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
the "Fidelity limits" section of the parent plan
([`roadmap/tugplan-in-app-bridge.md#fidelity-limits`](../../roadmap/tugplan-in-app-bridge.md#fidelity-limits))
for the full envelope. When a bug falls outside this envelope, mark
the residual as "manual verification required" in the test comment
and do not paper over it with a weaker proxy assertion.

## Phase A surface: native gestures, keyboard, introspection

Beyond the JS-synthesized gesture drivers (`app.click`, `app.type`,
`app.focusElement`), the Phase A harness exposes a trusted-event
family backed by Swift's `CGEvent.post` ([D02] + [Q05]):

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
| `holdModifier(mods, async thunk)` | Press modifiers, run inner verbs, release — all in one atomic Swift-side call (see below). |

**`holdModifier` pattern:**

```ts
// Hold Cmd while executing multiple keystrokes as one sequence.
await app.holdModifier(["cmd"], async (inner) => {
  await inner.rpcCall("nativeKey", { key: "a" });     // Cmd+A
  await inner.rpcCall("nativeKey", { key: "c" });     // Cmd+C
});

// Simpler shape for a single inner keystroke: just pass the
// modifier directly to `nativeKey`.
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

Protocol-only tests (`smoke.test.ts`, `double-connect.test.ts`,
`log-capture.test.ts`, `wait-for-condition.test.ts`) pass
`skipAccessibilityPreflight: true` so they stay independent of the
grant state. Scenario tests (AT0001/AT0003/AT0016, and the Phase A
`smoke-native.test.ts`) leave the default strict — if the grant is
missing, the failure attribution is instant.

See [`scripts/setup-dev-signing.sh`](../../scripts/setup-dev-signing.sh)
for the one-time stable-signing setup ([D14]) that makes the grant
persist across rebuilds.

## Adding a new test

1. **Name the file.** `tests/app-test/<scenario>.test.ts`. Files
   prefixed with `_` are reserved for harness-internal smoke and
   protocol tests (`smoke.test.ts`, `version-handshake.test.ts`,
   etc.).

2. **Gate on `TUGAPP_IN_APP_TEST=1`.** Use
   `describe.skipIf(!SHOULD_RUN)` at the top of every `describe` block.

3. **Import from `@/_harness`.** The path alias resolves to
   `tests/app-test/_harness/index.ts`. Key exports:

   - `launchTugApp(opts)` — spawn + connect + version handshake.
   - `App` class — `evalJS`, `waitForCondition`, `close`, plus typed
     wrappers (`click`, `type`, `focusElement`, `reset`,
     `seedDeckState`, `getActive`, `getFocused`, `getCaret`,
     `getFormControlValue`, `getDeckTrace`, `markDeckTrace`,
     `expectFocusedCard`, `expectCaret`, ...).
   - `toContainOrderedSubset` / `registerSubsetMatcher()` — partial
     ordered-subset matcher for deck-trace assertions.
   - `EXPECTED_SURFACE_VERSION` — pinned `window.__tug` surface
     version; must match tugdeck and the Swift bridge.

4. **Drive, assert, close.** Seed state, drive gestures through the
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

5. **Always close in `finally`.** Orphaned subprocesses accumulate
   across runs and exhaust socket paths.

6. **Prefer production code paths over synthetic events where
   possible.** For focus, call `app.focusElement(selector)` — this
   uses the same `.focus()` path that production code takes, keeping
   the test inside the fidelity envelope. See the `m01/m03/m16`
   tests added in Phase 3 for reference patterns.

## Lint: no raw timers

`tests/app-test/` forbids `setTimeout` and `setInterval` in test code
(the harness itself uses a `setTimeoutNative` alias internally — see
`_harness/index.ts`). Run the checker with:

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
  _harness/            # Bun-side harness library. Do not import from tests; use @/_harness.
  smoke.test.ts       # Minimal launchTugApp → evalJS → close. Keep passing.
  _*.test.ts           # Harness-internal protocol/lifecycle tests.
  <scenario>.test.ts   # User-authored scenario tests.
  bunfig.toml          # [test] root = "." — no happy-dom preload.
  tsconfig.json        # Path alias @/_harness. tsc --noEmit must be clean.
  lint-no-timers.ts    # bun run lint:no-timers scanner.
  logs/                # Per-spawn stdout/stderr dumps. Gitignored.
```
