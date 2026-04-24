/**
 * _smoke-native.test.ts — Phase A native-gesture smoke test.
 *
 * ## Status
 *
 * SCAFFOLD ONLY (Step 2 of tugplan-harness-extensions).
 *
 * Step 2 landed the Swift-side `NativeEventHandlers.swift` +
 * `VirtualKeyMap.swift` and extended the RPC dispatch table with
 * the new verbs, but left the TS-side `__tug.native*` surface
 * methods and the `App` class wrappers for Step 3. Without those
 * wrappers, there's nothing to smoke-test end-to-end from the
 * harness yet — the verbs are reachable via `rpc.call`, but test
 * authors shouldn't be reaching past the typed facade.
 *
 * Step 3's #step-3 tasks fill in this file's body with five tests:
 *
 *   1. **trusted click** — `nativeClickAtElement("button#…")`; a
 *      one-shot listener records `isTrusted`; assert `true`.
 *   2. **type** — click into an input, `nativeType("hello")`;
 *      assert `input.value === "hello"`.
 *   3. **Cmd+A** — click into an input with pre-filled text,
 *      `nativeKey("a", ["cmd"])`; assert full-range selection
 *      ([Q05]'s resolution pattern).
 *   4. **endpoint drag** — seed a contentEditable with text,
 *      `nativeDrag` from char-0 bounding rect to char-5 bounding
 *      rect; assert selection length == 5.
 *   5. **double-click word** — seed an input with "hello world",
 *      `nativeDoubleClickAtElement`; assert WebKit's word-select
 *      produced "hello" as the selection.
 *
 * ## Why this file exists now
 *
 * Step 2 commits independently of Step 3. The scaffold here means
 * Step 3's smoke test lands as a file-body edit instead of a new
 * file + xcodebuild + import churn. The `describe.skip` wrapper
 * below keeps this file inert until Step 3 flips it on; CI won't
 * fail for lack of a smoke-test body.
 */

import { describe, expect, test } from "bun:test";

// The whole suite stays skipped until Step 3 implements the TS
// surface methods (`App.nativeClickAtElement`, `App.nativeType`,
// `App.nativeKey`, `App.nativeDrag`, `App.nativeDoubleClickAtElement`).
// Each test below is a stub; Step 3 replaces their bodies per the
// list above.
describe.skip("phase A native-gesture smoke (Step 3)", () => {
  test("trusted click: nativeClickAtElement delivers isTrusted=true mousedown", () => {
    expect(true).toBe(true);
  });
  test("type: nativeType inserts ASCII text into focused input", () => {
    expect(true).toBe(true);
  });
  test("Cmd+A: nativeKey('a', ['cmd']) selects full input value", () => {
    expect(true).toBe(true);
  });
  test("endpoint drag: nativeDrag produces a painted selection", () => {
    expect(true).toBe(true);
  });
  test("double-click: nativeDoubleClickAtElement selects the clicked word", () => {
    expect(true).toBe(true);
  });
});
