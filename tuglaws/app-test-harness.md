# The App-Test Harness

*The integration-test harness that drives a real `Tug.app` subprocess via the DEBUG-only `TestHarness` Unix-socket bridge. Why it exists, what it can and cannot assert, the lifecycle model, the trusted-event surface, and how it relates to the macOS code-signing pipeline. Read this before changing the harness, before classifying a new test as smoke vs. scenario, or before claiming a behavior has been "covered" by app-test.*

*Cross-references: `[D##]` → [design-decisions.md](design-decisions.md). `[L##]` → [tuglaws.md](tuglaws.md). Harness-internal `[D##]` references resolve in [`roadmap/tugplan-in-app-bridge.md`](../roadmap/tugplan-in-app-bridge.md) and [`roadmap/tugplan-harness-extensions.md`](../roadmap/tugplan-harness-extensions.md).*

---

## What the harness is

The app-test harness is a Bun-side test driver that launches `Tug.app` as a subprocess and talks to it over a Unix-domain socket exposed by a DEBUG-only `TestHarness` listener inside the app. From a test author's perspective, it looks like a normal `bun:test` file: import `launchTugApp` from `@/_harness`, call it inside an `async test(...)`, drive gestures and DOM reads through the returned `App` object, close the app in a `finally` block.

What makes the harness interesting is what is on the other end of that socket. It is not a fake DOM, not a headless rendering shim. It is the real `Tug.app` bundle running the real WKWebView, hosting the real tugdeck bundle, executing the real production JavaScript. The harness is the only test surface in the repo that exercises the actual WebKit code paths that ship to users — selection rendering, gesture focus-lock, drag-to-select, double-click word boundaries, modifier-key accelerators, scroll containers, paint timing.

The colocated unit tests under `tugdeck/src/__tests__/` are pure-logic tests (stores, protocol, math, validators) — no DOM. Anything that depends on WebKit's `isTrusted: true` paths, on focus surviving a real gesture, or on the timing of WebKit's gesture focus-lock belongs in app-test.

---

## The trusted-event problem

Most JavaScript test environments synthesize events: `new MouseEvent("click", { ... })`, `dispatchEvent`. Synthesized events have `event.isTrusted === false`. WebKit (and every other browser engine) gates several behaviors on `isTrusted: true`:

- **Default focus on click.** Clicking an element does not move focus to it unless the click is trusted. A synthesized click on `<input>` will fire the click handler but the input will not receive focus.
- **Drag selection.** Mouse-down + mouse-move + mouse-up only initiates a text selection range when the events are trusted.
- **Double-click word selection.** WebKit's word-boundary detection only fires on trusted double-clicks within a tight time window.
- **Modifier-key accelerators.** Cmd+A select-all, Cmd+C copy, Cmd+V paste — the keyboard shortcuts WebKit handles internally — only fire on trusted key events.

A test that synthesizes events lives in a different universe from the user. It can drive `onClick`, but it cannot drive default-focus-on-click. It can dispatch `keydown`, but it cannot drive Cmd+A selection. The harness exists because trusted-event paths are first-class user behavior in tugdeck, and a test surface that cannot drive them cannot prove the app works.

The harness solves this by posting events at the **OS level**, via Swift's `CGEvent.post` ([D02] in `tugplan-in-app-bridge.md`). A `CGEvent` posted from Swift is indistinguishable from a hardware event as far as WebKit is concerned: `isTrusted` is `true`, default-focus runs, drag selection initiates, Cmd+A reaches the selection model. This is the entire reason the harness exists as a subprocess driver instead of an in-process fake-DOM shim.

---

## Lifecycle model: one App per file

Each test file launches its own `App` via `launchTugApp()` and closes it in a `finally` block. Inside a single file, tests may share the `App` if they call `app.reset()` between scenarios — but **no state is shared across files**. This matches the bridge's single-connection contract ([D12] in `tugplan-in-app-bridge.md`) and the regression gate in `harness-smoke/double-connect.test.ts`.

The reasons are not arbitrary:

- **Crash isolation.** One test file's hang or assertion failure does not poison the next. The harness can leave a subprocess in any state — including wedged — and the next file starts from a clean process boot.
- **WKUserScript injection is one-shot.** The script that sets `window.__tugTestMode = true` runs at process start via `WKUserScript`. There is no API to "downgrade" a live WebView back to non-test mode. To get a fresh non-test-mode WebView, you spawn a new app.
- **Per-spawn log files.** Stdout / stderr capture rotates per spawn. Failed-test diagnostics stay scoped to the file that produced them.

Within a single file, prefer `app.reset()` over re-spawning. Reset clears tugdeck state, resets the responder chain, and restores the deck to a known baseline — orders of magnitude faster than a subprocess boot. The pattern matters because some flake patterns surface only when state leaks between scenarios; reset makes that leak detectable.

---

## Fidelity envelope

The harness is a behavioral driver, not a visual renderer. It cannot assert:

- **Caret blink.** WebKit owns the blink timer; the harness has no surface to read paint state.
- **Paint correctness.** The harness reads DOM and computed styles, not rendered pixels. A bug where the right element is in the right position with the right styles but the wrong color is invisible to app-test.
- **Perceived snappiness.** The harness times state transitions, not perceived latency. A 100ms vs. 500ms paint delay is the same to app-test if the underlying state change is symmetric.
- **GPU compositor behavior.** Transform-related bugs that manifest only under hardware acceleration are out of envelope.

What the harness *can* assert is the union of:

- **DOM state.** Element presence, attributes, computed styles, bounds, focus, selection.
- **`__tug` state reads.** Active card, focused card, deck state, EM-card state, deck-trace ring.
- **Trusted gesture outcomes.** Default-focus on click, drag selection range, double-click word boundary, modifier-key behavior.
- **Lifecycle ordering.** When a will/did pair fires, when `onCardActivated` runs, when capture-phase save invariants hold.
- **Subprocess-level guarantees.** Cold-boot persistence, app-reload state restoration, `quitGracefully` flush, cross-process tugbank reads.

When a bug falls outside the envelope, mark the residual as "manual verification required" in the test comment. Do not paper over an out-of-envelope assertion with a weaker proxy — a passing weaker proxy is worse than an honest skip, because the skip surfaces in code review while the proxy hides indefinitely.

The full envelope spec lives in the "Fidelity limits" section of [`roadmap/tugplan-in-app-bridge.md`](../roadmap/tugplan-in-app-bridge.md).

---

## The Phase A surface: native gestures, keyboard, introspection

The harness exposes two parallel families of input verbs:

- **Synthesized JS gestures** (`app.click`, `app.type`, `app.focusElement`) — fast, reliable, but `isTrusted: false`. Use these when the assertion is about a JS handler running, not about a WebKit gesture path.
- **Native CGEvent gestures** (`app.nativeClick`, `app.nativeKey`, `app.nativeDrag`, etc.) — backed by Swift's `CGEvent.post` per [D02] + [Q05] in `tugplan-in-app-bridge.md`. These post real OS events that WebKit treats as hardware. Use these when the assertion is about default-focus, selection, or any `isTrusted: true` path.

Native gestures cover single click, double click, right click, drag (endpoint-only), mouse-down / mouse-up primitives, key press with modifiers, and ASCII typing. The `holdModifier(mods, async thunk)` shape lets a test wrap a sequence of inner verbs in a modifier-pressed scope, executed atomically Swift-side so the modifier state cannot drift between the outer test and the inner gesture sequence. Inner verbs inside a `holdModifier` thunk are restricted to native gestures only — `evalJS` / `waitForCondition` / nested `holdModifier` reject. The restriction is intentional: a `holdModifier` block must complete deterministically, and a JS-side wait inside it would let modifier state outlive the intended scope.

Introspection is pure DOM reads. `getElementText`, `getElementValue`, `getElementAttribute`, `getElementBounds`, `getElementState`, `getActiveElement`, `getSelection`, `getComputedStyleValue` — all run via `evalJS` against the live WebView's DOM. None of these post events; they observe.

The procedural details (the typed wrappers' signatures, the worked examples, the `markDeckTrace` pattern) are in [`tests/app-test/README.md`](../tests/app-test/README.md). This document explains why the surface exists and what it costs to extend; the README explains how to use it.

---

## The accessibility-grant relationship

Posting a `CGEvent` requires `Tug.app` to hold the macOS Accessibility (TCC) grant — System Settings → Privacy & Security → Accessibility, with `Tug.app` toggled on. Without the grant, `CGEvent.post` silently no-ops: every native gesture appears to succeed, but no event reaches the WebView, every assertion fails, and the failure attribution is misleading because the verbs returned `void` rather than throwing.

The harness preflights the grant on every `launchTugApp` call and throws `AccessibilityPermissionMissingError` with actionable guidance (the bundle path / id, the `tccutil reset` recipe for stale grants) when the preflight fails. Protocol-only smoke tests (`harness-smoke/smoke.test.ts`, `double-connect.test.ts`, `log-capture.test.ts`, `wait-for-condition.test.ts`) opt out of the preflight via `skipAccessibilityPreflight: true` so they remain runnable on machines that have not yet completed the one-time grant dance. Scenario tests (`at{NNNN}-*.test.ts`) and `harness-smoke/smoke-native.test.ts` keep the default strict preflight — if the grant is missing, the failure attribution is instant.

The grant is not keyed to the `Tug.app` filename or the bundle id alone. macOS's TCC database keys grants on the bundle's **designated requirement (DR)** — a string composed of the bundle identifier *plus* the leaf hash of the certificate that signed the bundle. Two binaries signed by the same identity share a DR and share a grant; anything that changes the signature invalidates the grant. Xcode's default ad-hoc signing produces a fresh random signature on every `xcodebuild` invocation, which would mean re-granting Accessibility every minute in a tight test-edit loop.

The fix is the `Tug Dev` self-signed identity from the code-signing pipeline. `just build-app` re-signs the bundle with the developer's `Tug Dev` identity after `xcodebuild` completes; `just app-test` re-signs defensively per invocation if the bundle's current DR drifts from the sentinel at `.tugtool/code-sign-fingerprint`. Same identity → same DR → grant persists. The escape hatch `APP_TEST_SKIP_RESIGN=1 just app-test` skips the re-sign for the rare case where the re-sign step itself is what you want to investigate; tests that need `CGEvent.post` will fail under that flag, tests that don't will pass. The deep dive on signing — why self-signed, what invalidates the grant, the DR drift detection mechanism — lives in [code-signing-mac.md](code-signing-mac.md). This document only points there.

---

## Smoke vs. scenario classification

Two test categories live under `tests/app-test/`:

### `harness-smoke/<name>.test.ts` — primitive gates

Smoke tests pin a single harness primitive: RPC handshake, evalJS error translation, native CGEvent click round-trip, app-reload, cold-boot / `quitGracefully`, capture-phase save invariant. They exist so a primitive regression can be diagnosed without the attribution being conflated with a scenario regression. If `smoke.test.ts` fails, the bridge transport is broken; if `at0001-tab-switch-fc.test.ts` fails *and* `smoke.test.ts` passes, the bug is in the scenario path, not the harness.

Smoke tests are not numbered. The filename describes what the gate asserts. Add a smoke test only when (a) it pins a harness primitive that AT scenarios depend on, AND (b) failure attribution would be muddled without a separate gate. A smoke test for behavior already covered by a scenario adds noise without diagnostic value.

### `at{NNNN}-<slug>.test.ts` — AT-numbered scenarios

Every AT-numbered file gates a regression case enumerated in [app-test-inventory.md](app-test-inventory.md). The `at{NNNN}` prefix MUST match an inventory entry. The AT-tag is the durable identifier; the slug after it can be re-edited as the test's framing evolves. To add a new scenario, add the inventory entry first (next-available `AT{NNNN}` is tracked at the top of the inventory), then write the test. The order matters because the inventory entry is the spec the test is gating; writing the test first invites the test to drift away from the case the inventory was supposed to cover.

The inventory-vs-test relationship is the durable one. Filenames change when the slug stops matching the framing; AT-tags do not. The reverse mapping (inventory entry → which test file gates it) is provided by the AT-tag prefix; the forward mapping (test file → which inventory entry it gates) is in the test's `describe` block as a natural-language reference and in the file header as a comment.

---

## Files

Primary canonical authority — the harness JS surface.

- [`tests/app-test/_harness/index.ts`](../tests/app-test/_harness/index.ts) — `launchTugApp`, the `App` class with all typed wrappers (`click`, `type`, `focusElement`, `reset`, `seedDeckState`, `nativeClick`, `nativeKey`, `nativeDrag`, `holdModifier`, `appReload`, `quitGracefully`, `startTugcode` / `stopTugcode`, deck-trace verbs). `EXPECTED_SURFACE_VERSION` lives here.
- [`tests/app-test/_harness/client.ts`](../tests/app-test/_harness/client.ts) — Unix-socket transport. Single-connection guarantee per [D12].
- [`tests/app-test/_harness/rpc.ts`](../tests/app-test/_harness/rpc.ts) — Length-prefixed JSON RPC framing and request / response correlation.
- [`tests/app-test/_harness/errors.ts`](../tests/app-test/_harness/errors.ts) — Typed error hierarchy. `AccessibilityPermissionMissingError`, `NativeTypeAsciiOnlyError`, etc.
- [`tests/app-test/_harness/matchers.ts`](../tests/app-test/_harness/matchers.ts) — `toContainOrderedSubset` partial-ordered-subset matcher; `registerSubsetMatcher()`.
- [`tests/app-test/_harness/types.ts`](../tests/app-test/_harness/types.ts) — Surface types shared between Bun-side and Swift-side JSON shapes.

Swift-side bridge — the in-app responder.

- [`tugapp/Sources/TestHarness/TestHarnessListener.swift`](../tugapp/Sources/TestHarness/TestHarnessListener.swift) — Unix-socket listener. DEBUG-only.
- [`tugapp/Sources/TestHarness/TestHarnessConnection.swift`](../tugapp/Sources/TestHarness/TestHarnessConnection.swift) — Per-connection request handler. `surfaceVersion` constant for the version handshake.
- [`tugapp/Sources/TestHarness/TestHarnessBridge.swift`](../tugapp/Sources/TestHarness/TestHarnessBridge.swift) — Bridge between socket RPC and the app's responder chain / WKWebView / native gesture surface.
- [`tugapp/Sources/TestHarness/TestHarnessUserScript.swift`](../tugapp/Sources/TestHarness/TestHarnessUserScript.swift) — `WKUserScript` injecting `window.__tugTestMode = true` at WebView boot.

Build / signing pipeline.

- [`Justfile`](../Justfile) — `just app-test`, `just build-app`, `just setup-dev-signing`, the `APP_TEST_SKIP_RESIGN=1` opt-out path.
- [`scripts/setup-dev-signing.sh`](../scripts/setup-dev-signing.sh) — One-shot machine setup for the `Tug Dev` identity.
- `.tugtool/code-sign-fingerprint` — DR sentinel; regenerated by `just build-app`, read by `just app-test`.

Procedural reference for test authors.

- [`tests/app-test/README.md`](../tests/app-test/README.md) — Running, environment variables, adding a new test, lint, directory layout. The architecture moved here; the README is procedure.

---

## Cross-Links

- [app-test-inventory.md](app-test-inventory.md) — The AT-tag catalog. Scenario tests gate the cases enumerated there; the harness is the engine that runs them.
- [code-signing-mac.md](code-signing-mac.md) — The signing pipeline that keeps the AX grant stable across rebuilds. The harness depends on it transitively for every native-gesture test.
- [`roadmap/tugplan-in-app-bridge.md`](../roadmap/tugplan-in-app-bridge.md) — Design rationale. Decisions [D01]–[D14], transport choreography, the trusted-event problem in detail, the fidelity-envelope spec.
- [`roadmap/tugplan-harness-extensions.md`](../roadmap/tugplan-harness-extensions.md) — Phase A native-event family (CGEvent gestures, keyboard, app-lifecycle), tugcode subprocess control.
- [`roadmap/tugplan-app-test-cleanup.md`](../roadmap/tugplan-app-test-cleanup.md) — The 2026-04-27 cleanup that produced the current `tests/app-test/` layout and the `at{NNNN}-` filename convention.
- [tuglaws.md](tuglaws.md) — [L11] (responder chain — the action paths the harness exercises end-to-end), [L23] (state preservation across bookkeeping — the contract `harness-smoke/smoke-capture-phase-save.test.ts` gates).
- [state-preservation.md](state-preservation.md) — The [A9] protocol whose capture-phase invariant is gated by `harness-smoke/smoke-capture-phase-save.test.ts`.
- [lifecycle-delegates.md](lifecycle-delegates.md) — The deck-level event pipe whose ordering is exercised by AT0008 / AT0019 and the cross-card scenarios.
