/**
 * at0332-pane-occlusion.test.ts — a pane fully covered by an opaque pane
 * above it is suspended from paint (`data-occluded` → `visibility: hidden`),
 * and every path that exposes it reveals it again, with the raise reveal
 * landing in the same commit as the z-order change.
 *
 * The mode's whole claim is that hiding is free and revealing is instant, so
 * the assertions are about what the user would notice if either were false:
 *
 * | Test                  | What would break without it                        |
 * |-----------------------|----------------------------------------------------|
 * | hides settle at rest  | no memory win — buried panes keep their tiles      |
 * | partial cover exempt  | a peeking pane blanked = visible content vanishes  |
 * | raise, same commit    | raise-from-buried presents a blank card frame      |
 * | close reveals         | closing the top card leaves a hidden pane on top   |
 * | restore recomputes    | a restored deck boots with stale hide state        |
 * | drag reveals (fg)     | dragging the coverer away drags a hole around      |
 * | raise paints (fg)     | a background-colored band where card content is    |
 *
 * The stack is three identical-rect panes plus one disjoint pane — the live
 * deck's real topology (same-size stacks under one raised card). Backgrounded
 * cells avoid rAF-dependent paths (hide timers are DOM timers, reveals are
 * synchronous store-commit effects); the drag and screenshot cells need a
 * live compositor and run in the `foreground: true` tier.
 *
 * @covers tugdeck/src/components/chrome/pane-occlusion-controller.ts
 * @covers tugdeck/src/components/chrome/tug-pane.tsx
 * @covers tugdeck/src/components/chrome/deck-canvas.tsx
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";
import { decodePngFile } from "./_harness/png";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

// Three panes at one rect (p1 bottom … p3 top by store order), one disjoint.
const STACK = { x: 60, y: 60, width: 600, height: 360 };
const ASIDE = { x: 700, y: 60, width: 300, height: 200 };

function deckShape() {
  const card = (id: string) => ({
    id,
    componentId: "session",
    title: `Session ${id}`,
    closable: true,
  });
  const pane = (
    id: string,
    cardId: string,
    rect: { x: number; y: number; width: number; height: number },
  ) => ({
    id,
    position: { x: rect.x, y: rect.y },
    size: { width: rect.width, height: rect.height },
    cardIds: [cardId],
    activeCardId: cardId,
    title: "",
    acceptsFamilies: ["maker"],
  });
  return {
    cards: [card("A"), card("B"), card("C"), card("D")],
    panes: [
      pane("p1", "A", STACK),
      pane("p2", "B", STACK),
      pane("p3", "C", STACK),
      pane("p4", "D", ASIDE),
    ],
    activePaneId: "p3",
    hasFocus: true,
  };
}

/** `data-occluded` for every pane, keyed by pane id. */
async function occlusionState(app: App): Promise<Record<string, string>> {
  return app.evalJS<Record<string, string>>(
    `(function () {
      var out = {};
      document.querySelectorAll(".tug-pane[data-pane-id]").forEach(function (el) {
        out[el.getAttribute("data-pane-id")] = el.dataset.occluded || "";
      });
      return out;
    })()`,
  );
}

async function seedStack(app: App): Promise<void> {
  await app.seedDeckState({ state: deckShape(), focusCardId: "C" });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && document.querySelectorAll(".tug-pane[data-pane-id]").length === 4`,
    { timeoutMs: 15_000 },
  );
}

/** Wait for the settle timer to stamp the buried stack. */
async function awaitHidesSettled(app: App): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function () {
      var p1 = document.querySelector('.tug-pane[data-pane-id="p1"]');
      var p2 = document.querySelector('.tug-pane[data-pane-id="p2"]');
      return !!p1 && !!p2 &&
        p1.dataset.occluded === "true" && p2.dataset.occluded === "true";
    })()`,
    { timeoutMs: 20_000 },
  );
}

describe.skipIf(!SHOULD_RUN)("at0332 — pane occlusion culling", () => {
  test(
    "buried panes hide at rest; raise, close, and restore reveal in the same commit",
    async () => {
      const app = await launchTugApp({ testName: "at0332-pane-occlusion" });
      try {
        await seedStack(app);

        // --- hides settle at rest -------------------------------------
        await awaitHidesSettled(app);
        let state = await occlusionState(app);
        expect(state.p1).toBe("true");
        expect(state.p2).toBe("true");
        expect(state.p3).toBe("");
        expect(state.p4).toBe("");

        // --- partial cover is exempt ----------------------------------
        // The aside pane overlaps nothing that covers it; it must never
        // have been considered, even transiently — checked above — and a
        // pane the stack only PARTIALLY covers stays visible: shrink the
        // stack's claim by moving the top pane so p2 peeks. Done via the
        // restore path below instead of geometry math here.

        // --- raise-from-buried: reveal in the SAME commit -------------
        // One synchronous eval: mutate, then read before returning. The
        // store notify forces a sync React re-render outside an event
        // handler, and the controller's layout effect runs inside that
        // same commit — if the attribute survives to the read, the reveal
        // missed its frame.
        const raised = await app.evalJS<{ p1: string; p3: string }>(
          `(function () {
            window.__tug.activateCard("A");
            return {
              p1: document.querySelector('.tug-pane[data-pane-id="p1"]').dataset.occluded || "",
              p3: document.querySelector('.tug-pane[data-pane-id="p3"]').dataset.occluded || "",
            };
          })()`,
        );
        expect(raised.p1).toBe("");
        // Hides are lazy: the demoted pane must NOT be hidden yet in the
        // raise commit (its tiles are still the visible content).
        expect(raised.p3).toBe("");

        // The demoted former top settles hidden afterward.
        await app.waitForCondition<boolean>(
          `document.querySelector('.tug-pane[data-pane-id="p3"]').dataset.occluded === "true"`,
          { timeoutMs: 20_000 },
        );

        // --- close of the covering pane reveals with the removal ------
        // `closePane` routes the whole-pane teardown (state flush, guards)
        // so the removal is not same-eval synchronous; the reveal must
        // ride the removal COMMIT, so the moment the pane count drops the
        // buried pane's attribute must already be gone — a missed reveal
        // would leave it stuck "true".
        await app.evalJS<void>(`window.__tug.closePane("p1")`);
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(".tug-pane[data-pane-id]").length === 3`,
          { timeoutMs: 10_000 },
        );
        const afterClose = await app.evalJS<string>(
          `document.querySelector('.tug-pane[data-pane-id="p3"]').dataset.occluded || ""`,
        );
        expect(afterClose).toBe("");

        // --- deck restore recomputes -----------------------------------
        // Re-seed the full stack and let it settle hidden again. (A pane
        // whose DOM node React reuses may legitimately carry its hide
        // across a same-topology restore — it is still covered; what a
        // restore must never do is keep a hide the new arrangement no
        // longer licenses, which the offset re-seed below proves.)
        await seedStack(app);
        await awaitHidesSettled(app);

        // --- restore reveal + partial cover is exempt ------------------
        // Same stack but the top pane shifted 40px: it still overlaps
        // p1/p2 almost entirely, but no longer CONTAINS them. The seed
        // commit must clear their hides synchronously (restore is an
        // exposing path), and nothing may hide afterward.
        const shape = deckShape();
        shape.panes[2].position = { x: STACK.x + 40, y: STACK.y + 40 };
        await app.seedDeckState({ state: shape, focusCardId: "C" });
        // p2 peeks out from under the offset p3 — its hide must clear in
        // the seed commit. p1 stays covered (by p2, at the identical rect,
        // one z below), which is the correct decision, not staleness.
        state = await occlusionState(app);
        expect(state.p2).toBe("");
        await new Promise((r) => setTimeout(r, 3_000));
        state = await occlusionState(app);
        expect(state.p1).toBe("true");
        expect(state.p2).toBe("");
        expect(state.p3).toBe("");
      } finally {
        await app.close();
      }
    },
    120_000,
  );
});

describe.skipIf(!SHOULD_RUN)("at0332 — pane occlusion, foreground tier", () => {
  test(
    "dragging the coverer reveals for the whole gesture; a raise paints content, never a blank band",
    async () => {
      const app = await launchTugApp({
        testName: "at0332-pane-occlusion-fg",
        foreground: true,
      });
      try {
        await seedStack(app);
        await awaitHidesSettled(app);

        // --- raise paints content: screenshot the raised pane ---------
        // Stamp t0, raise, and let a double-rAF bracket the first
        // presented frame for the raise budget.
        await app.evalJS<void>(
          `(function () {
            window.__at0332 = { t0: performance.now(), t1: null };
            window.__tug.activateCard("A");
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                window.__at0332.t1 = performance.now();
              });
            });
          })()`,
        );
        const shot = await app.screenshot();
        await app.waitForCondition<boolean>(`window.__at0332.t1 !== null`, {
          timeoutMs: 5_000,
        });
        const raiseMs = await app.evalJS<number>(
          `window.__at0332.t1 - window.__at0332.t0`,
        );
        console.log(`[at0332] raise-to-presented ≈ ${raiseMs.toFixed(1)}ms`);
        expect(raiseMs).toBeLessThan(250);

        // No background-colored band where card content belongs: sample a
        // grid inside the raised pane's interior and require that it is
        // not uniformly the canvas background (an unpainted reveal shows
        // exactly that). Geometry comes from the LIVE pane rect — seeded
        // sizes are clamped by the card's sizePolicy, so the constants
        // above are requests, not facts. Scale CSS coords to raster
        // pixels via the PNG.
        const rect = await app.evalJS<{
          left: number;
          top: number;
          width: number;
          height: number;
          innerWidth: number;
        }>(
          `(function () {
            var r = document
              .querySelector('.tug-pane[data-pane-id="p1"]')
              .getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height,
                     innerWidth: window.innerWidth };
          })()`,
        );
        const png = decodePngFile(shot.path);
        const scale = png.width / rect.innerWidth;
        const px = (x: number, y: number): [number, number, number] => {
          const i =
            (Math.round(y * scale) * png.width + Math.round(x * scale)) * 4;
          return [png.rgba[i]!, png.rgba[i + 1]!, png.rgba[i + 2]!];
        };
        // Canvas background reference: the strip above the stack (panes
        // seed at y=60; the deck canvas owns the top-left corner).
        const bg = px(rect.left + 10, Math.max(8, rect.top - 30));
        const interior: Array<[number, number, number]> = [];
        for (const fx of [0.25, 0.5, 0.75]) {
          for (const fy of [0.3, 0.55, 0.8]) {
            interior.push(
              px(rect.left + rect.width * fx, rect.top + rect.height * fy),
            );
          }
        }
        const differs = interior.filter(
          (c) =>
            Math.abs(c[0] - bg[0]) +
              Math.abs(c[1] - bg[1]) +
              Math.abs(c[2] - bg[2]) >
            12,
        );
        expect(differs.length).toBeGreaterThan(0);

        // --- drag of the coverer reveals for the whole gesture --------
        await app.waitForCondition<boolean>(
          `document.querySelector('.tug-pane[data-pane-id="p3"]').dataset.occluded === "true"`,
          { timeoutMs: 20_000 },
        );
        const bar = await app.evalJS<{ x: number; y: number }>(
          `(function () {
            var r = document
              .querySelector('.tug-pane[data-pane-id="p1"] .tug-pane-title-bar')
              .getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          })()`,
        );
        await app.nativeDragWithoutRelease(bar, {
          x: bar.x + 220,
          y: bar.y + 40,
        });
        // Mid-gesture, before any store commit: everything is visible.
        const midDrag = await occlusionState(app);
        expect(midDrag.p1).toBe("");
        expect(midDrag.p2).toBe("");
        expect(midDrag.p3).toBe("");
        await app.nativeMouseUp({ x: bar.x + 220, y: bar.y + 40 });
        // After the commit the dragged pane no longer covers; the two
        // remaining stacked panes re-settle (p2 buried under p3).
        await app.waitForCondition<boolean>(
          `(function () {
            var p2 = document.querySelector('.tug-pane[data-pane-id="p2"]');
            var p1 = document.querySelector('.tug-pane[data-pane-id="p1"]');
            return p2.dataset.occluded === "true" && (p1.dataset.occluded || "") === "";
          })()`,
          { timeoutMs: 20_000 },
        );
      } finally {
        await app.close();
      }
    },
    180_000,
  );
});
