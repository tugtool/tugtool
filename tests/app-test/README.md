# `tests/app-test/`

Procedural reference for test authors working in `tests/app-test/`.

For the harness **architecture** — what it is, the trusted-event problem, lifecycle model, fidelity envelope, native-gesture rationale, accessibility-grant relationship, smoke vs. scenario classification — see [`tuglaws/app-test-harness.md`](../../tuglaws/app-test-harness.md). This README covers the procedural test-author workflow only.

**Related docs:**

- [`tuglaws/app-test-harness.md`](../../tuglaws/app-test-harness.md) —
  harness architecture reference. Read first if anything in this README
  feels under-explained.
- [`tuglaws/app-test-inventory.md`](../../tuglaws/app-test-inventory.md)
  — canonical AT-tag catalog. Every `at{NNNN}-*.test.ts` filename
  prefix MUST match an entry there.
- [`tuglaws/code-signing-mac.md`](../../tuglaws/code-signing-mac.md) —
  the `Tug Dev` signing pipeline that keeps the macOS Accessibility
  grant stable across rebuilds. Read this when AX is broken.
- [`roadmap/tugplan-in-app-bridge.md`](../../roadmap/tugplan-in-app-bridge.md)
  — design rationale, decisions ([D01]–[D14]), and transport / boot
  choreography.
- [`roadmap/tugplan-harness-extensions.md`](../../roadmap/tugplan-harness-extensions.md)
  — Phase A native-event family (CGEvent-backed gestures, keyboard,
  app-lifecycle), tugcode subprocess control.
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
| `APP_TEST_SKIP_RESIGN=1`  | Bypass the defensive re-sign in `just app-test`. Tests that need `CGEvent.post` will fail; tests that don't will pass. Diagnostic-only — see `tuglaws/code-signing-mac.md`. |

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

## Adding a new test

Canonical test shape:

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

Step-by-step:

1. **Decide: smoke or scenario?** See
   [`tuglaws/app-test-harness.md`](../../tuglaws/app-test-harness.md)
   for the classification rule. If you're adding a scenario, also add
   the inventory entry in
   [`tuglaws/app-test-inventory.md`](../../tuglaws/app-test-inventory.md)
   first — pick the next unused `AT{NNNN}` (high-water mark and "next
   available" are both at the top of the inventory).

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

7. **Within a single file, prefer `app.reset()`** over re-spawning
   when scenarios share the app — it is orders of magnitude faster
   than a subprocess boot. No state is shared across files.

8. **Prefer production code paths over synthetic events.** For focus,
   call `app.focusElement(selector)` — this uses the same `.focus()`
   path that production code takes, keeping the test inside the
   fidelity envelope. For trusted clicks/drags/keys, use
   `nativeClick` / `nativeDrag` / `nativeKey` — these post real
   `CGEvent`s and exercise WebKit's `isTrusted: true` paths that
   synthesized DOM events cannot reach.

9. **`holdModifier` for modifier-bracketed sequences.** Hold modifiers
   atomically Swift-side rather than driving them as separate events:

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
