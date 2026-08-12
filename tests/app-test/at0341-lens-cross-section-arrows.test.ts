/**
 * at0341-lens-cross-section-arrows.test.ts — the Lens's arrows point where they
 * say: Down goes down the column, Right goes along a band, and the ring crosses
 * section boundaries in both.
 *
 * The Lens is a stack of sections, each a band (the band, its filter field, its
 * own controls, its fold cue — a ROW, read left to right) over a body (a COLUMN
 * of rows). It used to declare no spatial order at all and ride the liveliness
 * net, which is a linear walk: Down and Right both meant "next stop", so Down on
 * a band stepped sideways into that band's filter field instead of dropping into
 * the rows underneath it. The Lens now declares a plane
 * (`lens-spatial-order.ts`), and this pins what the four arrows do on it, end to
 * end on the real Lens with real keystrokes, reading the ENGINE key view
 * (`data-key-view-kbd`).
 *
 * It also pins the empty-input release: an empty `TugFilterField` spends its
 * arrows on movement (a field is not a wall), while a field holding a query
 * keeps them for its caret. That second half is asserted on the KEY VIEW
 * rather than the ring, because typing the query is itself the caret grant and
 * a caret is mode OFF for paint — the field keeps the arrows and wears no ring
 * while it does.
 *
 * The second test is the DRIFT GATE, and it names no section at all: it asks
 * the running Lens which sections it is rendering and holds each of them to the
 * two claims the plane makes — Down leaves a band, Right stays on it. The plane
 * is derived from what registers rather than from a table anyone maintains
 * (`lens-spatial-order.ts`), so a section added later, or a control added to an
 * existing band, is covered here the day it registers with no edit to this file.
 *
 * @covers tugdeck/src/components/tugways/focus-manager.ts
 * @covers tugdeck/src/components/tugways/responder-chain-provider.tsx
 * @covers tugdeck/src/components/tugways/responder-chain-provider.tsx
 * @covers tugdeck/src/components/tugways/tug-list-view.tsx
 * @covers tugdeck/src/components/tugways/tug-filter-field.tsx
 * @covers tugdeck/src/components/lens/lens-spatial-order.ts
 * @covers tugdeck/src/components/lens/
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp, note, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const JOTS_LIST = ".jots-card .jots-list";
const ROWS = 4;

function priorCardDeck() {
  return {
    cards: [
      { id: "A", componentId: "gallery-accordion", title: "Accordion", closable: true },
    ],
    panes: [
      {
        id: "pA",
        position: { x: 60, y: 60 },
        size: { width: 520, height: 420 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "pA",
    hasFocus: true,
  };
}

/**
 * Where the keyboard ring rests, as a short address a failure can be read
 * from: the Lens section that contains it, and which of that section's stops it
 * is — the band itself, its filter field, one of its own controls, its fold
 * cue, or its body. The fold cue is named apart from the section's other
 * controls because it is the band's last stop, and several assertions here are
 * about reaching exactly it.
 */
const addressOf = (selector: string): string => `(function(){
  var el = document.querySelector('${selector}');
  if (el === null) return null;
  var section = el.closest('.lens-section');
  var kind = section === null ? "?" : (section.getAttribute("data-lens-section") || "?");
  var part = el.closest('[data-slot="tug-filter-field"]') !== null
    ? "filter"
    : el.closest('[data-slot="block-fold-cue"]') !== null
      ? "fold"
      : el.closest(".tug-list-view") !== null
        ? "list"
        : el.matches(".tool-call-header")
          ? "band"
          : el.closest(".tool-call-header") !== null
            ? "action"
            : "other";
  return kind + ":" + part;
})()`;

/** Where the painted ring rests — present only while the mode is painting. */
const RING_ADDRESS = addressOf("[data-key-view-kbd]");

/**
 * Where the KEY VIEW rests, painted or not. The same address, read off the
 * mark that carries position rather than the one that carries paint: a text
 * stop that has been granted the caret is still the key view, but it wears no
 * ring, because a caret is mode OFF for paint ([P04]).
 */
const KEY_VIEW_ADDRESS = addressOf("[data-key-view]");

async function ringAddress(app: App): Promise<string | null> {
  return app.evalJS<string | null>(RING_ADDRESS);
}

async function waitRing(app: App, address: string): Promise<void> {
  await app.waitForCondition<boolean>(
    `${RING_ADDRESS} === ${JSON.stringify(address)}`,
    { timeoutMs: 3_000 },
  );
}

/** Press `key`, then assert where the ring came to rest. */
async function step(app: App, key: string, address: string): Promise<void> {
  await app.nativeKey(key);
  await waitRing(app, address);
}

/** Press `key` and read where the ring landed, without saying in advance. */
async function press(app: App, key: string): Promise<string | null> {
  await app.nativeKey(key);
  // The plane resolves synchronously and the projection is a layout effect, so
  // one settle is enough; a wrong landing shows up as a wrong address, never as
  // a flake, because every assertion here is on the value read back.
  await new Promise<void>((r) => setTimeout(r, 60));
  return ringAddress(app);
}

/** The section kinds the Lens is currently rendering, top to bottom. */
const RENDERED_SECTIONS = `Array.prototype.map.call(
  document.querySelectorAll('.lens-content .lens-section[data-lens-section]'),
  function (el) { return el.getAttribute("data-lens-section"); }
)`;

/** The band-level parts — everything that sits ON a band rather than under it. */
const BAND_PARTS = ["band", "filter", "action", "fold"];

describe.skipIf(!SHOULD_RUN)("at0341 — Lens arrows point where they say", () => {
  test(
    "Down runs the column and crosses sections, Right runs the band, and an empty filter field passes arrows through",
    async () => {
      const tugbankPath = mkTempTugbank();
      const filesDir = mkdtempSync(join(tmpdir(), "tug-at0341-"));
      const jotsPath = join(filesDir, "jots.json");
      writeFileSync(
        jotsPath,
        `${JSON.stringify(
          {
            version: 1,
            jots: Array.from({ length: ROWS }, (_, i) => ({
              id: `s${i}`,
              text: `row-${i} jot handle`,
            })),
          },
          null,
          2,
        )}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0341-lens-cross-section-arrows",
          env: { TUGBANK_PATH: tugbankPath, TUG_JOTS_PATH: jotsPath },
        });
        try {
          await app.seedDeckState({ state: priorCardDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5_000 },
          );

          // ⌘L seeds the first expanded section with navigable content — Cards,
          // which holds the one open card.
          await app.dispatchControlAction("focus-lens");
          await waitRing(app, "cards:list");

          // ---- Left off a body returns to its own band. ----
          //
          // Declared as a seam rather than an override, so it fires only where
          // nothing else claims the arrow: a vertical-axis list declines
          // horizontal arrows, while a horizontal group (the Layouts tiles)
          // keeps them for its own cursor and never sees it.
          await step(app, "ArrowLeft", "cards:band");

          // ---- Right runs the band, and never leaves it. ----
          //
          // Walked rather than enumerated: what the plane claims is that the
          // band is a closed RING — every Right lands on something that sits ON
          // the band, and the walk comes back to the band itself rather than
          // dead-ending or spilling into the rows. Which stops a band offers is
          // that section's business and changes as controls are added.
          const bandStops: string[] = [];
          for (let i = 0; i < 6; i += 1) {
            const at = await press(app, "ArrowRight");
            expect(at).not.toBeNull();
            const [kind, part] = (at as string).split(":");
            expect(kind).toBe("cards");
            expect(BAND_PARTS).toContain(part);
            bandStops.push(part);
            if (part === "band" && i > 0) break;
          }
          expect(bandStops[bandStops.length - 1]).toBe("band");
          // More than one stop, or the "ring" claim is vacuous.
          expect(bandStops.length).toBeGreaterThan(1);

          // ---- The headline: Down on a band means DOWN. ----
          //
          // The band's controls are to its right, so Down passes them and lands
          // in the section's rows — the thing the band is a header for. Under
          // the linear net this landed on the filter field, one step to the
          // right, which is the complaint the declared plane answers.
          await step(app, "ArrowDown", "cards:list");

          // The Cards list's cursor sits on its one pane row, which is also its
          // last, so Down runs off the list's edge. Before the liveliness net
          // this clamped and the ring never left the section; now it crosses to
          // the next section's BAND, which is where that section starts.
          await step(app, "ArrowDown", "layouts:band");

          // Down from the band reaches that section's body — the Layouts tiles,
          // which are a grid rather than a list and so address as neither.
          await step(app, "ArrowDown", "layouts:other");

          // ---- Up retraces the column. ----
          //
          // Up climbs back through the section's body to the band above it —
          // the band, not whatever stop it was last on, because a vertical arrow
          // enters a row at its leading member — and on into the section above
          // at its BODY. Walked rather than counted: how many rows a section's
          // body has is that section's business (Layouts alone has four groups,
          // several of them grids), and the claim is that the column ENDS at the
          // band, not that it is one step deep.
          const climb: string[] = [];
          for (let i = 0; i < 12; i += 1) {
            const at = await press(app, "ArrowUp");
            expect(at).not.toBeNull();
            climb.push(at as string);
            if (at === "layouts:band") break;
            // Every stop on the way up is still inside the section's body —
            // the climb may not leak sideways into another section.
            expect(at).toBe("layouts:other");
          }
          expect(climb[climb.length - 1]).toBe("layouts:band");
          await step(app, "ArrowUp", "cards:list");

          // A filter field with a query is a different animal: the caret owns
          // the arrows again. Land on the field and type.
          await step(app, "ArrowLeft", "cards:band");
          await step(app, "ArrowRight", "cards:filter");
          await app.nativeType("Accordion");
          await app.waitForCondition<boolean>(
            `document.querySelector('.lens-section[data-lens-section="cards"] .tug-filter-field-input')?.value === "Accordion"`,
            { timeoutMs: 3_000 },
          );

          // Up is the field's now — the keyboard does not leave.
          //
          // Read as the KEY VIEW, not as the ring, and that distinction is the
          // point rather than a workaround. Typing into a parked text stop IS
          // the grant ([P12] #printable-grant): the caret lands, and a caret is
          // mode OFF for paint, so the ring stands down the instant the query
          // exists. This assertion asked for the ring and so asserted the
          // opposite of the rule the keystroke before it invokes — it could
          // only have passed in a build where typing left the field parked.
          // What it MEANS to claim is that the arrow moved nothing, and the
          // key view is the mark that carries position in both modes.
          await app.nativeKey("ArrowUp");
          await new Promise<void>((r) => setTimeout(r, 250));
          const settled = await app.evalJS<{
            keyView: string | null;
            ring: string | null;
            caretInField: boolean;
          }>(`(function () {
            return {
              keyView: ${KEY_VIEW_ADDRESS},
              ring: ${RING_ADDRESS},
              caretInField: document.activeElement === document.querySelector(
                '.lens-section[data-lens-section="cards"] .tug-filter-field-input'
              ),
            };
          })()`);
          note(`after typing + ArrowUp: ${JSON.stringify(settled)}`);
          expect(
            settled.keyView,
            "a field holding a query keeps Up for its caret — the key view does not move",
          ).toBe("cards:filter");
          expect(
            settled.caretInField,
            "…and the caret is really in that field, not merely addressed at it",
          ).toBe(true);
          expect(
            settled.ring,
            "no ring beside a live caret — typing granted it, and a caret is mode OFF",
          ).toBeNull();

          // The whole tour is keyboard-only: every landing came through the
          // engine, with no raw focus write behind its back.
          const report = await app.evalJS<{
            violations: number;
            steals: Record<string, number>;
          } | null>(`window.__tug.getFocusInvariantReport()`);
          expect(report).not.toBeNull();
          expect(report!.violations).toBe(0);
          expect(Object.keys(report!.steals)).toEqual([]);
        } finally {
          await app.close();
        }
      } finally {
        rmSync(filesDir, { recursive: true, force: true });
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "every section the Lens renders obeys the plane — Down leaves its band, Right stays on it",
    async () => {
      // THE DRIFT GATE. The test above names three sections because it walks a
      // specific route; this one names none. It asks the running Lens which
      // sections it is rendering and holds each of them to the two claims the
      // plane makes, so a section added later — or a control added to an
      // existing band — is covered the day it registers, with no edit here.
      //
      // Both claims are about DIRECTION, which is the whole point: under the
      // liveliness net a band's Down and Right were the same key, and the way
      // that reads on screen is a Down that steps sideways into the band's own
      // filter field instead of into the rows the band is a header for.
      const tugbankPath = mkTempTugbank();
      const filesDir = mkdtempSync(join(tmpdir(), "tug-at0341-drift-"));
      const jotsPath = join(filesDir, "jots.json");
      writeFileSync(
        jotsPath,
        `${JSON.stringify(
          {
            version: 1,
            jots: Array.from({ length: ROWS }, (_, i) => ({
              id: `s${i}`,
              text: `row-${i} jot handle`,
            })),
          },
          null,
          2,
        )}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0341-lens-plane-drift",
          env: { TUGBANK_PATH: tugbankPath, TUG_JOTS_PATH: jotsPath },
        });
        try {
          await app.seedDeckState({ state: priorCardDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5_000 },
          );
          await app.dispatchControlAction("focus-lens");
          await waitRing(app, "cards:list");

          const kinds = await app.evalJS<string[]>(RENDERED_SECTIONS);
          expect(kinds.length).toBeGreaterThan(1);
          note("sections", kinds.join(", "));

          // Walk the column with Down, probing each band as it is reached. The
          // walk wraps at the bottom, so a full lap reaches every band whatever
          // the ring started on; the budget is a runaway guard, not a count.
          const probed = new Set<string>();
          const trail: string[] = [];
          for (let i = 0; i < 60 && probed.size < kinds.length; i += 1) {
            const at = await ringAddress(app);
            if (at === null) throw new Error(`ring left the Lens at step ${i}`);
            const [kind, part] = at.split(":");
            if (part !== "band" || probed.has(kind)) {
              await app.nativeKey("ArrowDown");
              await new Promise<void>((r) => setTimeout(r, 60));
              continue;
            }
            probed.add(kind);

            // (1) Right stays on this band. Every band has at least its fold
            // cue beside it, so there is always somewhere to the right to go —
            // and it must be on this section, never the next one's.
            const right = await press(app, "ArrowRight");
            expect(right).not.toBeNull();
            expect(right!.split(":")[0]).toBe(kind);
            expect(right!.split(":")[1]).not.toBe("list");
            // Back, so Down is measured from the band itself.
            const back = await press(app, "ArrowLeft");
            expect(back).toBe(`${kind}:band`);

            // (2) Down LEAVES the band. Either into this section's own body, or
            // — for a section that is folded or empty — onto the next section.
            // What it may never be is another stop on the same band, which is
            // exactly what the linear walk used to give.
            const down = await press(app, "ArrowDown");
            expect(down).not.toBeNull();
            const [downKind, downPart] = down!.split(":");
            trail.push(`${kind}:band ↓ ${down}`);
            if (downKind === kind) {
              expect(BAND_PARTS).not.toContain(downPart);
            } else {
              expect(kinds).toContain(downKind);
            }
          }
          note("Down off each band", trail.join("  |  "));
          expect([...probed].sort()).toEqual([...kinds].sort());
        } finally {
          await app.close();
        }
      } finally {
        rmSync(filesDir, { recursive: true, force: true });
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
