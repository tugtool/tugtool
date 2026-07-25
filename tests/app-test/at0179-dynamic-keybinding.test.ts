/**
 * at0179-dynamic-keybinding.test.ts — a dynamic, context-scoped keybinding
 * (useKeybindings) fires only while its scope is in context.
 *
 * Step 5 adds a dynamic keybinding registry alongside the static map ([P11]):
 * Stage 1 resolves in-context bindings (innermost-first along the
 * first-responder walk) before the static global `KEYBINDINGS`. The gallery
 * `Dynamic Keybinding` panel registers ⇧⌘Y → submit via `useKeybindings`,
 * handled by its own responder to bump a visible counter.
 *
 * End-to-end proof in the real app:
 *   - with focus elsewhere (the panel's responder NOT on the first-responder
 *     walk), ⇧⌘Y resolves to nothing → the count stays 0 (context-scoped);
 *   - after clicking the panel (its responder becomes first responder), ⇧⌘Y
 *     resolves to the dynamic binding, dispatches `submit` through the chain to
 *     the panel's handler → the count increments.
 *
 * Delivery is a synthetic `KeyboardEvent` — the canonical keybinding-test
 * pattern (see app-test README §10): `matchKeybinding` /
 * `resolveKeybinding` key only on `event.code` + modifiers and ignore
 * `isTrusted`, so a synthetic keydown exercises the exact Stage-1 path without
 * the OS input stack between.
 *
 * Coverage split: the resolution precedence (innermost-beats-ancestor,
 * off-walk-doesn't-match, unregister) is pinned in pure-logic
 * `keybinding-registry.test.ts`; that static global bindings still fire is
 * covered by the existing static-chord app-tests (at0085 ⇧⌘C, at0177 ⇧⌘P,
 * at0043 ⌘A/⌘C), which remain green after the dynamic layer was added.
 *
 * @covers tugdeck/src/components/tugways/keybinding-map.ts
 * @covers tugdeck/src/components/tugways/hooks/
 * @covers tugdeck/src/components/tugways/focus-manager.ts
 * @covers tugdeck/src/components/tugways/cards/gallery-chain-actions.tsx
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const DEMO = `${CARD} [data-testid="keybinding-demo"]`;
const DEMO_TARGET = `${CARD} [data-testid="keybinding-demo-target"]`;
const DEMO_COUNT = `${CARD} [data-testid="keybinding-demo-count"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-chain-actions", title: "Chain", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 520 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

const COUNT_EXPR = `(function(){ var e = document.querySelector(${JSON.stringify(DEMO_COUNT)}); return e ? e.textContent : null; })()`;

// Dispatch ⇧⌘Y as a synthetic keydown on the focused element.
const DISPATCH_CHORD = `(function(){
  var t = document.activeElement || document;
  return t.dispatchEvent(new KeyboardEvent("keydown", {
    code: "KeyY", key: "Y", metaKey: true, shiftKey: true,
    bubbles: true, cancelable: true, composed: true,
  }));
})()`;

describe.skipIf(!SHOULD_RUN)("AT0179: dynamic context-scoped keybinding", () => {
  test(
    "⇧⌘Y fires only when the registering panel is in context",
    async () => {
      const app = await launchTugApp({ testName: "at0179-dynamic-keybinding" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(DEMO)}) !== null`,
          { timeoutMs: 8000 },
        );
        await app.waitForCondition<boolean>(`${COUNT_EXPR} === "0"`, { timeoutMs: 6000 });

        // Out of context: the panel's responder is not the first responder, so
        // ⇧⌘Y resolves to nothing and the count stays 0.
        await app.evalJS<boolean>(DISPATCH_CHORD);
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(await app.evalJS<string | null>(COUNT_EXPR)).toBe("0");

        // Bring the panel into context (its responder becomes first responder).
        await app.nativeClickAtElement(DEMO_TARGET);
        await app.waitForCondition<boolean>(
          // "In context" is a RESPONDER CHAIN fact, not a DOM-focus fact: the
          // chord resolves against the first responder. Under the engine route
          // `activeElement` parks on the key sink outside this panel, so DOM
          // containment never becomes true even though the panel is exactly as
          // in-context as the chord needs. Read the chain's own marker, and keep
          // containment as the dom-granted alternative.
          `(function(){
             var t = document.querySelector(${JSON.stringify(DEMO_TARGET)});
             if (t === null) return false;
             if (t.contains(document.activeElement)) return true;
             var fr = document.querySelector("[data-first-responder]");
             return fr !== null && (t.contains(fr) || fr.contains(t));
           })()`,
          { timeoutMs: 6000 },
        );

        // In context: ⇧⌘Y now resolves to the dynamic binding and bumps the count.
        await app.evalJS<boolean>(DISPATCH_CHORD);
        await app.waitForCondition<boolean>(`${COUNT_EXPR} === "1"`, { timeoutMs: 6000 });
        // A second press confirms repeatability.
        await app.evalJS<boolean>(DISPATCH_CHORD);
        await app.waitForCondition<boolean>(`${COUNT_EXPR} === "2"`, { timeoutMs: 6000 });
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
