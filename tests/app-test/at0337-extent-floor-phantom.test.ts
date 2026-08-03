/**
 * at0337-extent-floor-phantom.test.ts — a list that fits its scrollport does
 * not scroll.
 *
 * ## What this gates
 *
 * The extent floor pins a scroller's scrollable extent at the last settled
 * value so it cannot dip mid-mutation, and it does that by BEING scroll
 * overflow: an out-of-flow element whose height the commit bracket owns.
 * Out of flow is what makes it work and also what makes it dangerous — it adds
 * scroll extent while adding no layout height, so a floor standing above the
 * content is invisible to every layout the surrounding UI performs. The
 * section around it stays correctly content-sized, no flex rule is violated,
 * and the only symptom is a scrollbar on a list that fits and a scroll gesture
 * that travels into empty background.
 *
 * That is not a hypothetical. The floor's extent used to be recovered as a
 * measured bottom edge plus a *remembered* pad — the gap between the scroller's
 * extent and its last in-flow edge, re-derived only on commits where
 * `scrollHeight` was content-defined. Capture that gap on a commit where the
 * rows have left but the extent has not yet followed them down and the
 * remembered number is a whole group's height rather than a pad; every commit
 * after it adds that number back to a correctly measured edge, so the recovery
 * RAISES the floor instead of lowering it and the scroller settles at
 * `content + pad` — a fixed point it never leaves.
 *
 * So this measures the invariant rather than the mechanism: after the list
 * SHRINKS — the case where a floor can be left standing above the content —
 * the scroller's extent is its content's extent, and there is nothing to
 * scroll. The Lens Cards section is the fixture because its list shrinks by
 * whole groups as panes close, which is the shape that produced the defect.
 *
 * @covers tugdeck/src/components/tugways/tug-list-view.tsx
 * @covers tugdeck/src/components/lens/sections/cards-section.tsx
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARDS = '.lens-section[data-lens-section="cards"]';

/**
 * The Cards list's scroll extent against its in-flow content extent.
 *
 * `windowH` is the rendered rows' own box; anything `scrollHeight` reports
 * beyond it is extent that no content occupies, which is the whole quantity
 * under test. The floor's own style height comes along so a failure names the
 * culprit instead of just the symptom.
 */
const EXTENT = `(function(){
  var cards = document.querySelector('${CARDS}');
  var list = cards === null ? null : cards.querySelector(".tug-list-view");
  var win = cards === null ? null : cards.querySelector(".tug-list-view-window");
  var floor = cards === null ? null : cards.querySelector(".tug-list-view-floor");
  if (list === null || win === null) return null;
  var winH = Math.round(win.getBoundingClientRect().height);
  return {
    client: list.clientHeight,
    scroll: list.scrollHeight,
    content: winH,
    phantom: list.scrollHeight - winH,
    floor: floor === null ? "" : floor.style.height,
    rows: cards.querySelectorAll(".tug-list-view-cell").length
  };
})()`;

interface Extent {
  client: number;
  scroll: number;
  content: number;
  phantom: number;
  floor: string;
  rows: number;
}

const SESSIONS = ["S0", "S1"];
const FILES = ["T0", "T1"];

/** One pane per card, so a close takes a whole pane row out of the list. */
function deckShape() {
  const all = [...SESSIONS, ...FILES];
  return {
    cards: [
      ...SESSIONS.map((id) => ({
        id,
        componentId: "session",
        title: id,
        closable: true,
      })),
      ...FILES.map((id) => ({
        id,
        componentId: "text",
        title: id,
        closable: true,
      })),
    ],
    panes: all.map((id, i) => ({
      id: `p${i}`,
      position: { x: 30 + i * 14, y: 30 + i * 14 },
      size: { width: 560, height: 360 },
      cardIds: [id],
      activeCardId: id,
      title: "",
      acceptsFamilies: ["standard", "maker"],
    })),
    activePaneId: "p0",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)("AT0337: extent floor leaves no phantom", () => {
  test(
    "a Lens list that loses a group ends up with nothing to scroll",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0337-"));
      const cardStates: Record<string, unknown> = {};
      for (const id of FILES) {
        const file = path.join(dir, `${id}.txt`);
        fs.writeFileSync(file, `content ${id}\n`, "utf8");
        cardStates[id] = {
          content: { path: file, anchor: { line: 1, ch: 0 }, scrollTop: 0 },
        };
      }
      const app = await launchTugApp({ testName: "at0337-extent-floor" });
      try {
        await app.seedDeckState({
          state: deckShape() as never,
          cardStates: cardStates as never,
          focusCardId: "S0",
        });
        await app.evalJS<null>(
          `(window.__tug.dispatchControlAction("toggle-lens"), null)`,
        );
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("S0")`,
          { timeoutMs: 20_000 },
        );
        // Bound sessions render the three-line monitor row rather than the
        // one-line fallback, so the SESSIONS group is tall enough that losing
        // the FILES group is a real shrink.
        await app.bindSession("S0", { tugSessionId: "at0337-session-zero" });
        await app.bindSession("S1", { tugSessionId: "at0337-session-one" });
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(`${CARDS} .tug-list-view-cell`)}).length >= 6`,
          { timeoutMs: 20_000 },
        );

        const full = await app.evalJS<Extent>(EXTENT);
        expect(full.phantom, "a freshly mounted list has no phantom extent").toBe(0);

        // Close both file panes: the FILES group header and its rows leave, and
        // the floor is standing at the taller extent when they do.
        await app.evalJS<null>(`(window.__tug.closePane("p2"), null)`);
        await app.evalJS<null>(`(window.__tug.closePane("p3"), null)`);
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(`${CARDS} .tug-list-view-cell`)}).length === 3`,
          { timeoutMs: 15_000 },
        );

        // Settled, not instantaneous. A removal takes a commit to land and
        // another for the bracket to rebase against the shorter document; the
        // invariant is about where the scroller comes to rest, not about the
        // frame in between. Read until two consecutive readings agree.
        let shrunk = await app.evalJS<Extent>(EXTENT);
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 250));
          const next = await app.evalJS<Extent>(EXTENT);
          if (next.scroll === shrunk.scroll && next.content === shrunk.content) {
            shrunk = next;
            break;
          }
          shrunk = next;
        }
        expect(shrunk.content, "the list really did shrink").toBeLessThan(
          full.content,
        );
        expect(
          shrunk.phantom,
          `scroll extent ${shrunk.scroll} vs content ${shrunk.content} ` +
            `(floor ${shrunk.floor})`,
        ).toBe(0);
        // The reading the user actually gets: a list this short has nothing
        // to scroll, so no scrollbar and no gesture travel.
        expect(
          shrunk.scroll,
          "a list that fits its port is not scrollable",
        ).toBeLessThanOrEqual(shrunk.client);
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
