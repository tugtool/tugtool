/**
 * at0392-card-chrome-tiers.test.ts — the deck's three chrome tiers, measured
 * on the real thing.
 *
 * A pane's title bar says what kind of card it is holding: 36px tinted for a
 * utility card, a 72px masthead for a document, 32px and flush for a rail.
 * Which tier a pane wears is a live derivation — from the active card's
 * masthead payload, and from its registered `layoutRole` — so it is only
 * falsifiable against a running deck.
 *
 * What is asserted here, and why each one needs the app:
 *
 *   1. **The document tier.** A Text card bound to a real file wears a 72px
 *      bar carrying its name, its path, and its save state; typing moves the
 *      save line. The old chrome (the top bar, the status bar's save cell) is
 *      gone rather than merely hidden.
 *   2. **The control-cluster reserve.** The masthead frame deliberately runs
 *      out under the pane's controls so its last line can use the full width,
 *      and each line above reserves the cluster back for itself. The cluster's
 *      width is measured at runtime and grows with a stack badge, so the only
 *      honest test is a real cluster and a name long enough to reach it.
 *   3. **The `…` menu is the command table's.** A clean titled buffer's Save
 *      row is disabled and carries ⌘S — the same answers File ▸ Save gets,
 *      because they are the same entry.
 *   4. **One height for a card's whole life.** A Diff pane is 72px before its
 *      diff resolves and after. Chrome that grew on data arrival would jump
 *      the body while the user was reading it.
 *   5. **Two channels, one card.** A scoped Diff pop-out names its file on
 *      the masthead while its tab still says "Diff" — the reason the store
 *      has a masthead-only setter beside the one that renames the card.
 *   6. **The rail tier.** A pinned Lens is 32px, flush on the pane's own
 *      ground, uppercase and tracked, with both stripe bands drawn — and the
 *      height is published on the PANE, so the scrim and the banner seat
 *      below the bar rather than 4px into it.
 *
 * The stripes are read as their published ink knobs rather than as pixels: a
 * 1px gradient under a transition returns interpolated colors mid-flight, and
 * the knob is the un-animated fact the gradient is drawn from.
 *
 * @covers tugdeck/src/components/tugways/card-masthead.tsx
 * @covers tugdeck/src/components/tugways/card-masthead.css
 * @covers tugdeck/src/components/tugways/masthead-frame.css
 * @covers tugdeck/src/components/tugways/tug-pane.css
 * @covers tugdeck/src/components/chrome/tug-pane.tsx
 * @covers tugdeck/src/lib/pane-title-bar-menu-store.ts
 * @covers tugdeck/src/lib/card-title-store.ts
 * @covers tugdeck/src/components/tugways/cards/text-card.tsx
 * @covers tugdeck/src/components/tugways/cards/diff-card.tsx
 * @covers tugdeck/src/components/tugways/tug-path.tsx
 *
 * The File viewer's masthead is asserted in `at0310-file-view-open`, where the
 * real PNG and PDF fixtures already are — the page count needs a real
 * document, and a `@covers` line here would claim a coverage this file does
 * not provide.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { launchTugApp, note, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const PANE = '[data-pane-id="p1"]';
const TITLE_BAR = `${PANE} .tug-pane-title-bar`;
const CONTROLS = `${TITLE_BAR} .tug-pane-title-bar-controls`;
const MASTHEAD_TITLE = `${PANE} [data-testid="card-masthead-title"]`;
const MASTHEAD_DESCRIPTION = `${PANE} [data-testid="card-masthead-description"]`;
const MASTHEAD_DETAIL = `${PANE} [data-testid="card-masthead-detail"]`;
/** The row's own title box — what the reserve makes stop short. */
const ROW_TITLE = `${PANE} .tug-pane-title-bar .tug-list-row-title`;
const ROW_DESCRIPTION = `${PANE} .tug-pane-title-bar .tug-session-row-description`;
const MENU_BUTTON = `${PANE} [data-testid="tug-pane-title-bar-menu-button"]`;
const CARD = '[data-card-id="A"]';
const EDITOR_CONTENT = `${CARD} [data-slot="tug-text-card-editor"] .cm-content`;

/** The tiers, as the themes declare them. */
const MASTHEAD_HEIGHT = 72;
const RAIL_HEIGHT = 32;
const UTILITY_HEIGHT = 36;

/**
 * A name long enough to fill the tier. Short titles pass a broken reserve
 * trivially — the collision only shows when the line reaches the cluster.
 */
const LONG_NAME =
  "a-deliberately-long-document-name-that-fills-the-masthead-tier.md";

/**
 * A repo path for the scoped-pop-out case. The masthead's name and path lines
 * are read straight off the descriptor, so they are right whether or not git
 * has anything to say about the file — only the `+added −removed` detail waits
 * on the payload.
 */
const SCOPED_FILE = "tugdeck/src/lib/git-diff-store.ts";
/** The project the scoped path is relative to. */
const SCOPED_ROOT = "/Users/tester/src/tugtool";

function textDeck() {
  return {
    cards: [{ id: "A", componentId: "text", title: "File", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 720, height: 520 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["standard"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

function diffDeck() {
  return {
    cards: [{ id: "A", componentId: "diff", title: "Diff", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 720, height: 520 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["standard"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** A utility card beside a pinned Lens: the rail tier, and the 36px control. */
function railDeck() {
  return {
    cards: [
      { id: "A", componentId: "gallery-accordion", title: "Accordion", closable: true },
      { id: "L", componentId: "lens", title: "Lens", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 500, height: 400 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
      {
        id: "pLens",
        position: { x: 0, y: 0 },
        size: { width: 420, height: 900 },
        cardIds: ["L"],
        activeCardId: "L",
        title: "Lens",
        acceptsFamilies: [],
      },
    ],
    activePaneId: "p1",
    imposition: { lens: "right" },
    hasFocus: true,
  };
}

/**
 * The tier a title bar is wearing.
 *
 * The bar's `height` is a CONTENT-box height and its divider is a 1px
 * `border-bottom` beneath it, so the border box measures one pixel more than
 * the token says. That is deliberate — block padding on the bar would make
 * the tier taller than its token — so the divider is subtracted back out
 * rather than being written into the expected numbers, where it would read as
 * "72px means 73".
 */
async function tierOf(app: App, selector: string): Promise<number> {
  return app.evalJS<number>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const border = parseFloat(getComputedStyle(el).borderBottomWidth) || 0;
      return el.getBoundingClientRect().height - border;
    })()`,
  );
}

async function textOf(app: App, selector: string): Promise<string> {
  return app.evalJS<string>(
    `document.querySelector(${JSON.stringify(selector)}).innerText`,
  );
}

async function countOf(app: App, selector: string): Promise<number> {
  return app.evalJS<number>(
    `document.querySelectorAll(${JSON.stringify(selector)}).length`,
  );
}

async function typeIntoEditor(app: App, text: string): Promise<void> {
  const ok = await app.evalJS<boolean>(
    `(function(){
      var el = document.querySelector('${EDITOR_CONTENT}');
      if (!el) return false;
      el.focus();
      return document.execCommand("insertText", false, ${JSON.stringify(text)});
    })()`,
  );
  if (!ok) throw new Error("[at0392] typeIntoEditor: insertText not handled");
}

describe.skipIf(!SHOULD_RUN)("at0392 — the three chrome tiers", () => {
  test(
    "a Text card wears the document masthead, and its lines stop short of the controls",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0392-"));
      const file = path.join(dir, LONG_NAME);
      fs.writeFileSync(file, "alpha\nbeta\n", "utf8");
      const app = await launchTugApp({ testName: "at0392-document-tier" });
      try {
        await app.seedDeckState({
          state: textDeck(),
          cardStates: {
            A: { content: { path: file, anchor: { line: 1, ch: 0 }, scrollTop: 0 } },
          },
          focusCardId: "A",
        });
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector('${EDITOR_CONTENT}');
            return el !== null && el.innerText.indexOf("alpha") !== -1;
          })()`,
          { timeoutMs: 15_000 },
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MASTHEAD_DETAIL)}) !== null`,
          { timeoutMs: 8_000 },
        );

        // ---- The tier ----
        expect(await tierOf(app, TITLE_BAR)).toBeCloseTo(MASTHEAD_HEIGHT, 0);
        expect(await textOf(app, MASTHEAD_TITLE)).toBe(LONG_NAME);
        // The path clips its HEAD, so what survives is the tail — the
        // filename the reader is looking for.
        expect(await textOf(app, MASTHEAD_DESCRIPTION)).toContain(LONG_NAME);
        expect(await textOf(app, MASTHEAD_DETAIL)).toStartWith("Saved");

        // ---- The old chrome is gone, not hidden ----
        expect(await countOf(app, '[data-slot="text-card-top-bar"]')).toBe(0);
        expect(
          await countOf(app, '[data-testid="text-card-status-save"]'),
        ).toBe(0);

        // ---- The reserve ----
        //
        // The frame runs out under the cluster so the LAST line can use the
        // full width; the two lines above take the cluster back for
        // themselves. Both must stop before the cluster starts.
        // Measured at the CONTENT box, not the border box: the reserve is a
        // `padding-inline-end`, so on the element that carries it the padding
        // is inside the rect and the border box still reaches the frame's
        // edge. Where the text can go is the content box, and that is the
        // thing the collision was about.
        const edges = await app.evalJS<{
          title: number;
          description: number;
          controls: number;
        }>(
          `(() => {
            const contentRight = (s) => {
              const el = document.querySelector(s);
              const pad = parseFloat(getComputedStyle(el).paddingRight) || 0;
              return el.getBoundingClientRect().right - pad;
            };
            return {
              title: contentRight(${JSON.stringify(ROW_TITLE)}),
              description: contentRight(${JSON.stringify(ROW_DESCRIPTION)}),
              controls: document
                .querySelector(${JSON.stringify(CONTROLS)})
                .getBoundingClientRect().left,
            };
          })()`,
        );
        note(
          "at0392 reserve",
          `title ${Math.round(edges.title)} / description ${Math.round(edges.description)} < controls ${Math.round(edges.controls)}`,
        );
        expect(edges.title).toBeLessThanOrEqual(edges.controls);
        expect(edges.description).toBeLessThanOrEqual(edges.controls);

        // ---- The `…` menu answers from the command table ----
        //
        // Asked while the buffer is CLEAN, which is the interesting state:
        // Save is dirty-gated, so its row must be dim — and dim for the
        // registry's reason, not a card's opinion. The check is against the
        // native File ▸ Save item rather than an expectation typed here,
        // because "the row agrees with the menu bar" is the actual claim.
        await app.nativeClickAtElement(MENU_BUTTON);
        await app.waitForCondition<boolean>(
          `!!Array.from(document.querySelectorAll('.tug-menu-item')).find(n => n.textContent && n.textContent.indexOf("Save") === 0)`,
          { timeoutMs: 8_000 },
        );
        const saveRow = await app.evalJS<{
          disabled: boolean;
          shortcut: string | null;
        }>(
          `(() => {
            const row = Array.from(document.querySelectorAll('.tug-menu-item'))
              .find(n => n.textContent && n.textContent.indexOf("Save") === 0);
            const chip = row.querySelector('.tug-menu-item-shortcut');
            return {
              disabled: row.hasAttribute('data-disabled'),
              shortcut: chip === null ? null : chip.textContent,
            };
          })()`,
        );
        const menuSave = await app.menuItemState("file.save");
        note("at0392 save row", `${saveRow.shortcut} disabled=${saveRow.disabled}`);
        expect(saveRow.disabled).toBe(true);
        // `MenuItemState` is a union on `found`, so the narrowing is the
        // assertion: an absent File ▸ Save is exactly the disagreement this
        // comparison exists to catch, and it must fail rather than typecheck
        // its way into reading `enabled` off the not-found arm.
        if (!menuSave.found) throw new Error("File ▸ Save is not in the native menu");
        expect(saveRow.disabled).toBe(menuSave.enabled === false);
        // The chord is shown, and it is the one the table holds.
        expect(saveRow.shortcut).not.toBeNull();

        // Dismiss the menu before touching the editor.
        await app.evalJS<boolean>(
          `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }))`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelectorAll('.tug-menu-item').length === 0`,
          { timeoutMs: 5_000 },
        );

        // ---- The save line is live ----
        await typeIntoEditor(app, "gamma\n");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MASTHEAD_DETAIL)}).innerText.indexOf("Edited") === 0`,
          { timeoutMs: 8_000 },
        );
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a Diff pane is 72px before its diff resolves and after",
    async () => {
      const app = await launchTugApp({ testName: "at0392-height-stability" });
      try {
        await app.seedDeckState({
          state: diffDeck(),
          cardStates: {
            A: { content: { descriptor: { kind: "head" } } },
          },
          focusCardId: "A",
        });
        // The masthead is published from MOUNT, so the tier is right before
        // any diff has come back.
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MASTHEAD_TITLE)}) !== null`,
          { timeoutMs: 15_000 },
        );
        const before = await tierOf(app, TITLE_BAR);
        expect(before).toBeCloseTo(MASTHEAD_HEIGHT, 0);
        expect(await textOf(app, MASTHEAD_TITLE)).toBe("Project Diff");

        // Let the request settle either way — resolved or refused, the tier
        // must not have moved.
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-slot="diff-card"], .diff-card-notice, .diff-card') !== null`,
          { timeoutMs: 15_000 },
        ).catch(() => {});
        await new Promise((r) => setTimeout(r, 1_500));
        const after = await tierOf(app, TITLE_BAR);
        note("at0392 diff tier", `${Math.round(before)} → ${Math.round(after)}`);
        expect(after).toBeCloseTo(MASTHEAD_HEIGHT, 0);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a scoped Diff pop-out names its file on the masthead and keeps 'Diff' on its tab",
    async () => {
      const app = await launchTugApp({ testName: "at0392-scoped-diff" });
      try {
        // Two cards so the pane has a tab bar to read: the masthead and the
        // tab are the two channels this case is about, and only a stacked
        // pane shows both at once.
        await app.seedDeckState({
          state: {
            cards: [
              { id: "A", componentId: "diff", title: "Diff", closable: true },
              {
                id: "B",
                componentId: "gallery-accordion",
                title: "Accordion",
                closable: true,
              },
            ],
            panes: [
              {
                id: "p1",
                position: { x: 40, y: 40 },
                size: { width: 760, height: 520 },
                cardIds: ["A", "B"],
                activeCardId: "A",
                title: "",
                acceptsFamilies: ["standard", "maker"],
              },
            ],
            activePaneId: "p1",
            hasFocus: true,
          },
          cardStates: {
            A: {
              content: {
                // With a root, as every scoped pop-out `tug-changes-list`
                // builds carries one. The root is what turns git's
                // repo-relative path into the path the reader knows.
                descriptor: {
                  kind: "head",
                  root: SCOPED_ROOT,
                  paths: [SCOPED_FILE],
                },
              },
            },
          },
          focusCardId: "A",
        });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MASTHEAD_TITLE)}) !== null`,
          { timeoutMs: 15_000 },
        );

        // The masthead says which file — `setMasthead`, the sidecar-only
        // publish that exists for exactly this case.
        expect(await textOf(app, MASTHEAD_TITLE)).toBe("git-diff-store.ts");

        // And the second line says WHERE, which is a different fact from the
        // first. Git's own path is repo-relative, so a file at the repo root
        // would put the filename on both lines and spend one saying nothing;
        // the descriptor's root is what resolves it.
        const scopedPath = await app.evalJS<{
          text: string;
          head: string;
          tail: string;
        }>(`(() => {
             const el = document.querySelector(${JSON.stringify(MASTHEAD_DESCRIPTION)});
             return {
               text: el.textContent,
               head: el.querySelector(".tug-path-head").textContent,
               tail: el.querySelector(".tug-path-tail").textContent,
             };
           })()`);
        note("at0392 scoped path", JSON.stringify(scopedPath));
        expect(scopedPath.text).toBe(`${SCOPED_ROOT}/${SCOPED_FILE}`);
        expect(scopedPath.text).not.toBe(await textOf(app, MASTHEAD_TITLE));
        // Split for a middle ellipsis: the filename is the run that stays.
        expect(scopedPath.tail).toBe("/git-diff-store.ts");

        // And the TAB still says "Diff". The title override REPLACES the
        // registry string, so publishing one here would rename the tab after
        // the file — which is the reason the masthead has a setter of its own
        // rather than riding the string channel.
        expect(
          await textOf(app, `${PANE} [data-testid="tug-tab-A"]`),
        ).toContain("Diff");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a pinned Lens wears the rail tier, and a utility card is unchanged at 36px",
    async () => {
      const app = await launchTugApp({ testName: "at0392-rail-tier" });
      try {
        await app.seedDeckState({ state: railDeck(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `document.querySelector('.tug-pane[data-pane-id="pLens"][data-role="sidebar"]') !== null`,
          { timeoutMs: 15_000 },
        );

        const rail = await app.evalJS<{
          paneHeightProperty: string;
          barHeight: number;
          textTransform: string;
          letterSpacing: string;
          stripeInk: string;
          labelInk: string;
          iconInk: string;
          flush: boolean;
          utilityHeight: number;
        }>(
          `(() => {
            const pane = document.querySelector('.tug-pane[data-pane-id="pLens"]');
            const bar = pane.querySelector('.tug-pane-title-bar');
            const label = bar.querySelector('.tug-pane-title');
            const barStyle = getComputedStyle(bar);

            // Flushness, decided by painting: a probe carrying the pane's own
            // ground resolves to the same used color the bar has to match.
            // Comparing token TEXT would compare two spellings of a color.
            const probe = document.createElement('div');
            probe.style.backgroundColor = 'var(--tugx-pane-bg)';
            pane.appendChild(probe);
            const paneGround = getComputedStyle(probe).backgroundColor;
            probe.remove();

            return {
              paneHeightProperty: getComputedStyle(pane)
                .getPropertyValue('--tugx-pane-chrome-height').trim(),
              // Content-box tiers: the 1px divider is a border BELOW the
              // tier, so it comes back out of both measurements.
              barHeight:
                bar.getBoundingClientRect().height -
                (parseFloat(barStyle.borderBottomWidth) || 0),
              textTransform: getComputedStyle(label).textTransform,
              letterSpacing: getComputedStyle(label).letterSpacing,
              stripeInk: barStyle.getPropertyValue('--tugx-rail-stripe-ink').trim(),
              labelInk: barStyle.getPropertyValue('--tugx-rail-label-ink').trim(),
              iconInk: barStyle.getPropertyValue('--tugx-rail-icon-ink').trim(),
              flush: barStyle.backgroundColor === paneGround,
              utilityHeight: (() => {
                const b = document.querySelector('.tug-pane[data-pane-id="p1"] .tug-pane-title-bar');
                return b.getBoundingClientRect().height -
                  (parseFloat(getComputedStyle(b).borderBottomWidth) || 0);
              })(),
            };
          })()`,
        );
        note("at0392 rail", JSON.stringify(rail));

        // The height is a PANE fact, not just the bar's — that is what seats
        // the scrim, the sheet clip, and the banner below a 32px bar.
        expect(rail.paneHeightProperty).toBe(`${RAIL_HEIGHT}px`);
        expect(rail.barHeight).toBeCloseTo(RAIL_HEIGHT, 0);

        // A tracked, uppercase label rather than a card's sentence-case name.
        expect(rail.textTransform).toBe("uppercase");
        expect(rail.letterSpacing).not.toBe("normal");
        expect(rail.letterSpacing).not.toBe("0px");

        // Flush on the pane's own ground: a rail is one panel, not a card
        // with a lid.
        expect(rail.flush).toBe(true);

        // The stripes' ink is published as a knob, so the two focus states
        // are stated once as a pair. Reading the knob rather than the 1px
        // gradient also survives a transition in flight.
        expect(rail.stripeInk.length).toBeGreaterThan(0);
        expect(rail.labelInk.length).toBeGreaterThan(0);
        expect(rail.iconInk.length).toBeGreaterThan(0);

        // The utility tier is untouched.
        expect(rail.utilityHeight).toBeCloseTo(UTILITY_HEIGHT, 0);

        // `data-role` and `data-lens` are two different bits, and a rail on
        // its pin carries both. That they can come apart — rail chrome with
        // no side — is what a released rail proves, and at0230 owns the drag
        // that releases one.
        expect(
          await countOf(app, '.tug-pane[data-pane-id="pLens"][data-lens="right"]'),
        ).toBe(1);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
