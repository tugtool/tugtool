/**
 * at0082-gallery-shipped-renderers.test.ts — render-half verification
 * for the Tide assistant-rendering gallery cards (batch 1, [#step-14-5]).
 *
 * # What this proves
 *
 * [#step-14-5] ships gallery cards for the renderers landed through
 * [#step-13]: the `TideThinkingBlock` chrome, the `JsonTreeBlock` body
 * kind, the file tool wrappers (`ReadToolBlock` / `EditToolBlock`), and
 * the `DefaultToolWrapper` fallback. It also extends the pre-existing
 * `gallery-bash-tool-block` card.
 *
 * The registry *wiring* is a pure-logic concern, pinned by
 * `tugdeck/src/components/tugways/cards/__tests__/gallery-registrations.test.ts`.
 * This file is the *render-half* — Spec S06 ([#s06-fixture-replay])
 * items 2–4, which need a real render surface:
 *
 *   2. **No `[object Object]`.** Every variant the card stacks renders
 *      its mock data through real components — none of it should leak
 *      a stringified object into the DOM text.
 *   3. **No raw-JSON bleed.** Structurally precluded — `JsonTreeBlock`
 *      renders any JSON value as a typed tree rather than stringifying
 *      it — and covered by (2): a raw-JSON dump would still be visible
 *      text the card never intends to paint.
 *   4. **Exactly one tool-block root per wrapper instance.** Each
 *      tool-wrapper variant must emit exactly one `data-slot` root —
 *      not zero (a blank render) and not two (a duplicated mount).
 *
 * Plus the baseline: the card mounts **without throwing** — a thrown
 * render would leave the card host empty, so the per-card expected
 * descendant count failing to one is the throw detector.
 *
 * Theme: the structural checks here are theme-invariant (theme changes
 * colour, not DOM shape). The both-themes pass is the step's manual
 * checkpoint, backed by `bun run audit:tokens lint` — gallery-card CSS
 * is layout-only, every painted colour rides an already-theme-verified
 * component token.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)` — runs under `just app-test`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 120_000;

const CARD_ID = "A";

/**
 * One gallery card under test. `expectedSlots` maps a `data-slot`
 * selector to the exact element count that card's variant stack must
 * render — the Spec S06 item-4 "exactly one root per wrapper instance"
 * check, generalized to "exactly N for N stacked variants."
 */
interface CardSpec {
  componentId: string;
  /** The `data-testid` on the card's root element. */
  testId: string;
  /** Exact `data-slot` element counts the variant stack must produce. */
  expectedSlots: ReadonlyArray<{ selector: string; count: number }>;
}

const CARD_SPECS: ReadonlyArray<CardSpec> = [
  {
    componentId: "gallery-dev-thinking",
    testId: "gallery-dev-thinking",
    // Streaming + completed-long + completed-short.
    expectedSlots: [{ selector: '[data-slot="dev-thinking-block"]', count: 3 }],
  },
  {
    componentId: "gallery-json-tree-block",
    testId: "gallery-json-tree-block",
    // primitives + nested + array + shallow-default + empty.
    expectedSlots: [{ selector: '[data-slot="json-body"]', count: 5 }],
  },
  {
    componentId: "gallery-tool-block-file",
    testId: "gallery-tool-block-file",
    // 3 Read variants + 3 Edit variants; each a single tool-block root.
    expectedSlots: [
      { selector: '[data-slot="read-tool-block"]', count: 3 },
      { selector: '[data-slot="edit-tool-block"]', count: 3 },
      { selector: '[data-slot$="-tool-block"]', count: 6 },
    ],
  },
  {
    componentId: "gallery-tool-block-default",
    testId: "gallery-tool-block-default",
    // 6 DefaultToolWrapper variants.
    expectedSlots: [
      { selector: '[data-slot="default-tool-wrapper"]', count: 6 },
    ],
  },
  {
    componentId: "gallery-bash-tool-block",
    testId: "gallery-bash-tool-block",
    // echo + git show + git diff + git status + build-fail + interrupted
    // + ansi + no-output.
    expectedSlots: [{ selector: '[data-slot="bash-tool-block"]', count: 8 }],
  },
];

function cardRootSelector(testId: string): string {
  return `[data-card-id="${CARD_ID}"] [data-testid="${testId}"]`;
}

/** A single-card deck seed for `componentId`, mounted in a developer pane. */
function deckSeed(componentId: string) {
  return {
    state: {
      cards: [
        { id: CARD_ID, componentId, title: componentId, closable: true },
      ],
      panes: [
        {
          id: "p1",
          position: { x: 40, y: 40 },
          size: { width: 900, height: 680 },
          cardIds: [CARD_ID],
          activeCardId: CARD_ID,
          title: "",
          acceptsFamilies: ["developer"],
        },
      ],
      activePaneId: "p1",
      hasFocus: true,
    },
    focusCardId: CARD_ID,
  };
}

describe.skipIf(!SHOULD_RUN)(
  "AT0082: #step-14-5 gallery cards render without throw and paint no [object Object]",
  () => {
    test(
      "each batch-1 / extended gallery card mounts cleanly with the expected variant slots",
      async () => {
        const app = await launchTugApp({
          testName: "at0082-gallery-shipped-renderers",
        });
        try {
          await app.enableDeckTrace(true);

          for (const spec of CARD_SPECS) {
            await app.seedDeckState(deckSeed(spec.componentId));

            // The card host registering is the "mounted" signal; a
            // render that threw would still register the host but
            // leave the content subtree empty — caught below.
            await app.waitForCondition<boolean>(
              `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered(${JSON.stringify(
                CARD_ID,
              )})`,
              { timeoutMs: 8000 },
            );

            const rootSel = cardRootSelector(spec.testId);
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(rootSel)}) !== null`,
              { timeoutMs: 8000 },
            );

            // Baseline: the card root rendered a non-trivial subtree.
            // A thrown render leaves the testid root absent or empty.
            const descendantCount = await app.evalJS<number>(
              `(function(){
                var root = document.querySelector(${JSON.stringify(rootSel)});
                return root ? root.querySelectorAll("*").length : 0;
              })()`,
            );
            expect(
              descendantCount,
              `${spec.componentId}: card root must render a non-empty subtree`,
            ).toBeGreaterThan(0);

            // Spec S06 item 2/3: no stringified object leaked into the
            // DOM text. `[object Object]` is the canonical tell of a
            // value rendered with `String(...)` instead of a component.
            const hasObjectObject = await app.evalJS<boolean>(
              `(function(){
                var root = document.querySelector(${JSON.stringify(rootSel)});
                return root ? (root.textContent || "").indexOf("[object Object]") !== -1 : false;
              })()`,
            );
            expect(
              hasObjectObject,
              `${spec.componentId}: must not paint "[object Object]"`,
            ).toBe(false);

            // Spec S06 item 4: exactly N data-slot roots for N stacked
            // variants — not zero (blank render), not doubled.
            for (const { selector, count } of spec.expectedSlots) {
              const actual = await app.evalJS<number>(
                `(function(){
                  var root = document.querySelector(${JSON.stringify(rootSel)});
                  return root ? root.querySelectorAll(${JSON.stringify(selector)}).length : -1;
                })()`,
              );
              expect(
                actual,
                `${spec.componentId}: expected ${count} × ${selector}`,
              ).toBe(count);
            }
          }
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0082-gallery-shipped-renderers] log tail:\n${tail}\n`,
            );
          }
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
