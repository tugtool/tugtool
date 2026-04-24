# `tests/in-app/`

In-app integration tests that drive a real `Tug.app` subprocess through
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
TUGAPP_IN_APP_TEST=1 bun test tests/in-app/

# Or a single file:
TUGAPP_IN_APP_TEST=1 bun test tests/in-app/_smoke.test.ts
```

Environment variables honored by `launchTugApp`:

| Variable               | Purpose                                                      |
|------------------------|--------------------------------------------------------------|
| `TUGAPP_IN_APP_TEST=1` | Enables the `describe.skipIf(!SHOULD_RUN)` gate in tests.    |
| `TUGAPP_DEBUG_PATH`    | Absolute path to the debug `Tug.app` binary (override).      |
| `TUGAPP_TEST_SOCKET`   | Reserved; set by the harness when spawning the subprocess.   |

Per-run log files are written under `tests/in-app/logs/` when a test
passes `testName` to `launchTugApp`; the directory is gitignored.

## Lifecycle model: one App per file, explicit reset

Each test file launches its own `App` via `launchTugApp()` and closes
it in a `finally` block. Inside a file, tests may share the `App` if
they call `app.reset()` between scenarios — but **no state is shared
across files**. This matches the Phase 2 bridge's single-connection
contract (see [D12] in the parent plan and the double-connect test
in `_double-connect.test.ts`).

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
blink, paint correctness, perceived snappiness, or
`isTrusted: true`-gated behaviors. See the "Fidelity limits" section
of the parent plan ([`roadmap/tugplan-in-app-bridge.md#fidelity-limits`](../../roadmap/tugplan-in-app-bridge.md#fidelity-limits))
for the full envelope. When a bug falls outside this envelope, mark
the residual as "manual verification required" in the test comment
and do not paper over it with a weaker proxy assertion.

## Adding a new test

1. **Name the file.** `tests/in-app/<scenario>.test.ts`. Files
   prefixed with `_` are reserved for harness-internal smoke and
   protocol tests (`_smoke.test.ts`, `_version-handshake.test.ts`,
   etc.).

2. **Gate on `TUGAPP_IN_APP_TEST=1`.** Use
   `describe.skipIf(!SHOULD_RUN)` at the top of every `describe` block.

3. **Import from `@/_harness`.** The path alias resolves to
   `tests/in-app/_harness/index.ts`. Key exports:

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

`tests/in-app/` forbids `setTimeout` and `setInterval` in test code
(the harness itself uses a `setTimeoutNative` alias internally — see
`_harness/index.ts`). Run the checker with:

```bash
cd tests/in-app && bun run lint:no-timers
```

Exit 0 is clean; exit 1 prints offending `file:line` locations. The
rationale: raw timers make flaky tests; use `app.waitForCondition` or
one of the typed wrappers that already wraps a timer with structured
timeout + error.

## Directory layout

```
tests/in-app/
  _harness/            # Bun-side harness library. Do not import from tests; use @/_harness.
  _smoke.test.ts       # Minimal launchTugApp → evalJS → close. Keep passing.
  _*.test.ts           # Harness-internal protocol/lifecycle tests.
  <scenario>.test.ts   # User-authored scenario tests.
  bunfig.toml          # [test] root = "." — no happy-dom preload.
  tsconfig.json        # Path alias @/_harness. tsc --noEmit must be clean.
  lint-no-timers.ts    # bun run lint:no-timers scanner.
  logs/                # Per-spawn stdout/stderr dumps. Gitignored.
```
