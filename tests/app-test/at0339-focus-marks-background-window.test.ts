/**
 * at0339-focus-marks-background-window.test.ts — every keyboard focus mark goes
 * quiet while the OS window is not foreground, the CONTAINER mark included.
 *
 * `focus-ring.css` gates the focus language on `data-app-active`, which
 * `DeckManager.setHasFocus` projects onto `<html>`. Both marks under test are
 * strokes: the cursor item wears the full-accent element ring and the group
 * container wears the toned container ring ([D122]). The suppression has to
 * reach both — a container mark that kept painting behind an inactive window is
 * the leak this pins, and it is invisible to a test that only watches the leaf.
 *
 * The radio group is the instrument because it is the item-group archetype
 * whose container mark is authored directly in its own CSS, so a suppression
 * that fails to reach component-authored container marks shows up here first.
 *
 * The suppression is anchored on `html` rather than on the bare attribute, and
 * that is load-bearing: `[data-app-active="false"] [data-key-view-kbd]` and
 * `.tug-radio-group[data-key-view-kbd]` are both specificity (0,2,0), so the
 * winner would fall through to Vite's CSS emission order. Naming `<html>` takes
 * the suppression to (0,2,1) and it wins permanently. This test is what catches
 * that tie being lost.
 *
 * All assertions are computed-style reads — not rAF-dependent, so nothing here
 * needs the window visible. The FOREGROUND tier is required for a different
 * reason: the subject is a real `NSApp` resign / become-active cycle, and only
 * an app that is genuinely active can resign. The pid-mode default never
 * activates, so `document.hasFocus()` never becomes true and the mark under
 * test never paints in the first place. Same rationale as at0004.
 *
 * `deck-manager.ts` is deliberately NOT declared here even though it owns the
 * `data-app-active` projection: it is this test's dependency, not its subject,
 * and that module already sits at the fanout budget — a @covers line for every
 * test that merely reads a bit it projects would turn `app-test-changed` into a
 * sweep. The projection itself is covered by at0004.
 *
 * @foreground
 * @covers tugdeck/styles/focus-ring.css
 * @covers tugdeck/src/components/tugways/tug-radio-group.css
 * @covers tugdeck/src/components/tugways/cards/gallery-radio-group.tsx
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="radio-focus-title"]`;
const DEMO = `${CARD} [data-testid="radio-focus-demo"]`;
const GROUP = `${DEMO} [data-slot="tug-radio-group"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-radio-group", title: "Radio", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 620 },
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

// The container's stroke plus the cursor item's stroke, read together: the
// suppression has to take BOTH marks down, and a rule that only reached one of
// them would still pass a single-element probe. `backgroundImage` stays in the
// probe as the marks-once guard — the container wears a stroke, not a wash.
const MARKS_PROBE = `(function(){
  var g = document.querySelector(${JSON.stringify(GROUP)});
  if (!g) return null;
  var gcs = getComputedStyle(g);
  var cur = document.querySelector(${JSON.stringify(DEMO)} + " [data-radio-value][data-key-cursor]");
  return {
    containerBackgroundImage: gcs.backgroundImage,
    containerOutline: gcs.outlineWidth,
    keyboardReached: g.hasAttribute("data-key-view-kbd"),
    cursorOutline: cur ? getComputedStyle(cur).outlineWidth : null,
    appActive: document.documentElement.getAttribute("data-app-active"),
  };
})()`;

interface MarksProbe {
  containerBackgroundImage: string;
  containerOutline: string;
  keyboardReached: boolean;
  cursorOutline: string | null;
  appActive: string | null;
}

describe.skipIf(!SHOULD_RUN)("AT0339: focus marks stand down in a background window", () => {
  test(
    "container ring and cursor ring both vanish on resign and both return on activate",
    async () => {
      const app = await launchTugApp({
        // Foreground: an app that was never active cannot resign, and the
        // marks under test only paint while `data-app-active` reads true.
        foreground: true,
        testName: "at0339-focus-marks-background-window",
      });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(TITLE)}) !== null`,
          { timeoutMs: 8000 },
        );

        await app.nativeClickAtElement(TITLE);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 10000 });
        // The marks below only exist while the app reads as foreground. Guard on
        // the projected bit rather than on the click, so a machine that hands
        // activation back slowly cannot make the "marks are painted" assertion
        // race the very suppression this test is about.
        await app.waitForCondition<boolean>(
          `document.documentElement.getAttribute("data-app-active") === "true"`,
          { timeoutMs: 6000 },
        );

        // (1) Tab → the group takes the key view and wears the toned container
        // ring, with the full-accent element ring on the cursor item.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(
          `(function(){var g=document.querySelector(${JSON.stringify(GROUP)});return g && g.hasAttribute("data-key-view-kbd");})()`,
          { timeoutMs: 6000 },
        );
        const foreground = await app.evalJS<MarksProbe>(MARKS_PROBE);
        expect(foreground?.appActive).toBe("true");
        expect(foreground?.keyboardReached).toBe(true);
        expect(parseFloat(foreground?.containerOutline ?? "0")).toBeGreaterThan(0);
        expect(parseFloat(foreground?.cursorOutline ?? "0")).toBeGreaterThan(0);
        // The container marks once: a stroke, never also a background layer.
        expect(foreground?.containerBackgroundImage).toBe("none");

        // (2) Resign → every mark goes quiet. The engine attributes STAY on the
        // elements (the keyboard has not moved, only the window's activation),
        // so this is purely a paint assertion — which is the point: a rule that
        // suppressed the attributes instead would break the focus model.
        await app.simulateAppResign();
        await app.waitForCondition<boolean>(
          `document.documentElement.getAttribute("data-app-active") === "false"`,
          { timeoutMs: 6000 },
        );
        const background = await app.evalJS<MarksProbe>(MARKS_PROBE);
        expect(background?.keyboardReached).toBe(true);
        expect(background?.containerBackgroundImage).toBe("none");
        expect(background?.containerOutline).toBe("0px");
        expect(background?.cursorOutline).toBe("0px");

        // (3) Activate → the marks come back exactly as they were. Without this
        // half, a suppression that never lifted would also pass step (2).
        await app.simulateAppBecomeActive();
        await app.waitForCondition<boolean>(
          `document.documentElement.getAttribute("data-app-active") === "true"`,
          { timeoutMs: 6000 },
        );
        const returned = await app.evalJS<MarksProbe>(MARKS_PROBE);
        expect(parseFloat(returned?.containerOutline ?? "0")).toBeGreaterThan(0);
        expect(returned?.containerOutline).toBe(foreground?.containerOutline ?? "");
        expect(parseFloat(returned?.cursorOutline ?? "0")).toBeGreaterThan(0);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
