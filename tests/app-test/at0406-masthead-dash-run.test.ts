/**
 * at0406-masthead-dash-run.test.ts — the bound dash as a run in the Session
 * card's masthead title, bound and unbound by the real CLI through the card's
 * own shell route.
 *
 * The whole loop is real. `tugutil dash bind` resolves the calling session
 * from `TUG_SESSION_ID` — which is exactly what the `$` shell route stamps on
 * the child — and POSTs `/api/dash` to the instance whose ledger owns that
 * session, so the session is seeded into this instance's ledger first
 * (`seedLedger`) or the command exits with `no session`. The run that appears
 * is driven by the dash's `bound_sessions` moving in the account-global
 * changeset aggregate, with no reload and no card involvement; `dash unbind`
 * takes it away the same way.
 *
 * The run is the identity's, not the masthead's — the masthead renders no
 * dash chrome of its own, which is why the pins here are all on the title's
 * grammar. Two things are pinned besides the name. The run sits inside the
 * title line's content box, i.e. inside the width the masthead already
 * reserves against the pane's control cluster, so it cannot collide with pane
 * chrome by construction. And the 72px chrome tier does not change height when
 * the run arrives: a card that reflows when a dash is bound would move the
 * transcript under the reader's eyes.
 *
 * The run also carries the dash plan's review state, as its own tone rather
 * than as a second glyph beside the first — neither register has room for two
 * marks. The dash drives a real stamped plan, so the run arrives unmarked;
 * editing the plan past its stamp is what makes the mark appear.
 *
 * The dash name is deliberately wider than the run's `max-inline-size` cap, so
 * it is always over-constrained and its elision is under test on every run.
 * What that pins is the *direction* of the truncation: text with no elidable
 * box of its own overflows a centred flex row in both directions and clips off
 * both ends, which shows up as a first character painting outside the box it
 * is supposed to be inside. This is the pin the retired masthead badge carried;
 * it lives here now, on the one surface in the app where a capped run is
 * actually observable.
 *
 * @covers tugdeck/src/components/tugways/session-masthead.tsx
 * @covers tugdeck/src/components/tugways/tug-session-identity.tsx
 * @covers tugdeck/src/lib/dash-session-index.ts
 * @covers tugdeck/src/lib/dash-review.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { launchTugApp, note, type App } from "./_harness";
import {
  createDash,
  makePlanStale,
  recordStampedPlan,
  releaseDash,
  tugutilPath,
} from "./dash-fixture";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

const SID = "at0406-session";
const CARD = '[data-card-id="A"]';
const PROMPT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
// The masthead renders in the pane title bar, ABOVE the card host — not
// inside the card element.
const MASTHEAD = '[data-slot="session-masthead"]';
const RUN = `${MASTHEAD} [data-slot="session-identity-dash"]`;
const SHELL_ROWS = `${CARD} [data-slot="session-transcript-shell-row"]`;

const PROJECT_DIR = realpathSync(resolve(import.meta.dir, "..", ".."));
// Wider than the run's `ch` cap — the name is always constrained, so the
// elision path is exercised rather than skipped.
const DASH_NAME = "at0406-run-elides-wide";
let planPath = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  const created = createDash(PROJECT_DIR, DASH_NAME, "at0406 fixture");
  // The dash drives a real plan, reviewed and stamped — so the chip's resting
  // state carries no review attribute at all, and the one that appears later
  // can only be the edit.
  planPath = recordStampedPlan(PROJECT_DIR, DASH_NAME, created.worktree);
});

afterAll(() => {
  if (!SHOULD_RUN) return;
  releaseDash(PROJECT_DIR, DASH_NAME);
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 900, height: 680 },
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

/** Run `command` through the card's `$` shell route and wait for its row to
 *  settle with an exit label — the route is what stamps `TUG_SESSION_ID`. */
async function shellAndSettle(
  app: App,
  command: string,
  expectedIndex: number,
): Promise<void> {
  await app.nativeClickAtElement(PROMPT);
  await app.nativeType(`/shell ${command}`);
  await new Promise((r) => setTimeout(r, 150));
  await app.nativeKey("Enter", ["cmd"]);
  await app.waitForCondition<boolean>(
    `(function(){
       var rows = document.querySelectorAll(${JSON.stringify(SHELL_ROWS)});
       if (rows.length !== ${expectedIndex + 1}) return false;
       var foot = rows[${expectedIndex}].querySelector('[data-slot="session-z1b-end-state"]');
       return foot !== null && foot.textContent.indexOf("exit") !== -1;
     })()`,
    { timeoutMs: 30_000 },
  );
}

const mastheadHeight = (app: App): Promise<number> =>
  app.evalJS<number>(
    `Math.round(document.querySelector(${JSON.stringify(MASTHEAD)}).getBoundingClientRect().height)`,
  );

describe.skipIf(!SHOULD_RUN)("AT0406: the masthead's dash run", () => {
  test(
    "a real dash bind paints the run on the title line and unbind takes it away",
    async () => {
      const app = await launchTugApp({ testName: "at0406-masthead-dash-run" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindSession("A", {
          tugSessionId: SID,
          projectDir: PROJECT_DIR,
          workspaceKey: PROJECT_DIR,
        });
        await app.awaitEngineReady("A", { timeoutMs: 15000 });
        // The bind verb resolves the instance whose ledger OWNS this session;
        // a client-side binding alone is invisible to it. After launch, not
        // before: tugcast demotes every `live` row to `closed` at startup.
        app.seedLedger({
          sessions: [
            {
              session_id: SID,
              workspace_key: PROJECT_DIR,
              project_dir: PROJECT_DIR,
              card_id: "A",
              name: "at0406 work",
            },
          ],
        });

        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MASTHEAD)}) !== null`,
          { timeoutMs: 10000 },
        );
        expect(await app.evalJS<number>(
          `document.querySelectorAll(${JSON.stringify(RUN)}).length`,
        )).toBe(0);
        const bareHeight = await mastheadHeight(app);

        // ── Bind, for real ────────────────────────────────────────────────
        await shellAndSettle(app, `${tugutilPath(PROJECT_DIR)} dash bind ${DASH_NAME}`, 0);
        note(
          "at0406 bind row",
          await app.evalJS<string>(
            `(document.querySelectorAll(${JSON.stringify(SHELL_ROWS)})[0]?.textContent ?? "").trim().slice(0, 400)`,
          ),
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(RUN)}) !== null`,
          { timeoutMs: 15000 },
        );

        const run = await app.evalJS<{
          text: string;
          inIdentity: boolean;
          title: string | null;
          overflowsLine: boolean;
        }>(
          `(() => {
             const run = document.querySelector(${JSON.stringify(RUN)});
             const identity = run.closest('[data-slot="tug-session-identity"]');
             const line = run.closest(".tug-session-row-name-line");
             const r = run.getBoundingClientRect();
             const l = line.getBoundingClientRect();
             return {
               text: (run.textContent ?? "").trim(),
               inIdentity: identity !== null,
               title: run.getAttribute("title"),
               overflowsLine: r.right > l.right + 1,
             };
           })()`,
        );
        expect(run.text).toBe(DASH_NAME);
        // Inside the identity itself — the run is part of the title's grammar,
        // not a slot beside it, which is what keeps it inside the width the
        // masthead reserves against the pane's control cluster.
        expect(run.inIdentity).toBe(true);
        expect(run.overflowsLine).toBe(false);
        expect(run.title).toBe(`Working on dash ${DASH_NAME}`);
        // The chrome tier does not grow to make room for the run.
        expect(await mastheadHeight(app)).toBe(bareHeight);

        // ── The name is wider than the cap; it must elide, not clip ───────
        // `firstGlyphInside` is where the name's first character actually
        // paints. Text with no elidable box of its own overflows a centred
        // flex row in both directions, putting that glyph to the LEFT of the
        // box it is supposed to be inside — the both-ends clip.
        const elision = await app.evalJS<{
          hasNameSpan: boolean;
          overflows: boolean;
          textOverflow: string;
          whiteSpace: string;
          firstGlyphInside: boolean;
        }>(
          `(() => {
             const run = document.querySelector(${JSON.stringify(RUN)});
             const span = run.querySelector(".tug-session-identity-dash-name");
             if (span === null) {
               return { hasNameSpan: false, overflows: false, textOverflow: "",
                        whiteSpace: "", firstGlyphInside: false };
             }
             const cs = getComputedStyle(span);
             const node = span.firstChild;
             const r = document.createRange();
             r.setStart(node, 0);
             r.setEnd(node, 1);
             const glyph = r.getBoundingClientRect();
             const box = span.getBoundingClientRect();
             return {
               hasNameSpan: true,
               overflows: span.scrollWidth > span.clientWidth,
               textOverflow: cs.textOverflow,
               whiteSpace: cs.whiteSpace,
               firstGlyphInside: glyph.left >= box.left - 1,
             };
           })()`,
        );
        note("at0406 dash run elision", JSON.stringify(elision));
        expect(elision.hasNameSpan).toBe(true);
        expect(elision.overflows).toBe(true);
        expect(elision.textOverflow).toBe("ellipsis");
        expect(elision.whiteSpace).toBe("nowrap");
        expect(elision.firstGlyphInside).toBe(true);

        const shot = await app.screenshot();
        note("at0406 masthead with the dash run", shot.path);

        // ── The plan drifts past its review; the run says so ──────────────
        // The mark is the run's own tone rather than a second glyph beside the
        // first, so the contract is the attribute.
        expect(
          await app.evalJS<string | null>(
            `document.querySelector(${JSON.stringify(RUN)}).getAttribute("data-review")`,
          ),
        ).toBeNull();
        makePlanStale(planPath);
        const nudge = join(PROJECT_DIR, "at0406-nudge.txt");
        writeFileSync(nudge, "at0406 recompose nudge\n");
        try {
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(RUN)})?.getAttribute("data-review") === "stale"`,
            { timeoutMs: 30000 },
          );
        } finally {
          rmSync(nudge, { force: true });
        }
        expect(
          await app.evalJS<string | null>(
            `document.querySelector(${JSON.stringify(RUN)}).getAttribute("title")`,
          ),
        ).toContain("changed since");
        // A tinted run is still the same run: no reflow of the chrome tier.
        expect(await mastheadHeight(app)).toBe(bareHeight);

        // ── Unbind, for real ──────────────────────────────────────────────
        await shellAndSettle(app, `${tugutilPath(PROJECT_DIR)} dash unbind`, 1);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(RUN)}) === null`,
          { timeoutMs: 15000 },
        );
        expect(await mastheadHeight(app)).toBe(bareHeight);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
