/**
 * at0256-lens-focus-carrier.test.ts — the Snippets list never loses its focus
 * carrier to a keyboard gesture.
 *
 * The invariant ([P02], the carrier rule): while the Lens is keyboard-active,
 * exactly one carrier is present — the list's perimeter RING (`data-key-view-kbd`
 * on the container) while navigating, or an in-row editor's CARET while editing.
 * No `return` / `escape` / `space` / typing may leave the list with neither.
 *
 * This is enforced STRUCTURALLY: on an editor close the list reclaims the key
 * view (`TugListViewHandle.reclaimKeyView`, driven off the `editingId → null`
 * transition), so it does not depend on the engine ascend, the editor's
 * blur-commit, and any row-discard re-render all converging.
 *
 * @foreground
 * @covers tugdeck/src/components/lens/sections/snippets-section.tsx
 * @covers tugdeck/src/components/tugways/focus-manager.ts
 * @covers tugdeck/src/components/tugways/tug-list-view.tsx
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

function priorCardDeck() {
  return {
    cards: [
      { id: "A", componentId: "gallery-accordion", title: "Accordion", closable: true },
    ],
    panes: [
      {
        id: "pA",
        position: { x: 60, y: 60 },
        size: { width: 520, height: 620 },
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

const KBD = `document.querySelector('.lens-snippets-list')?.hasAttribute('data-key-view-kbd') === true`;
const EDITOR = `document.querySelector('.snippet-editor .cm-content') !== null`;
// The carrier invariant: the list holds the ring XOR an editor holds the caret.
const HAS_CARRIER = `((${KBD}) !== (${EDITOR}))`;

describe.skipIf(!SHOULD_RUN)("at0256 — Lens focus carrier is never lost", () => {
  test(
    "click / space / escape / enter / typing always leave a carrier on the list",
    async () => {
      const tugbankPath = mkTempTugbank();
      const dir = mkdtempSync(join(tmpdir(), "tug-at0256-"));
      const snippetsPath = join(dir, "snippets.json");
      const snippets = Array.from({ length: 8 }, (_, i) => ({
        id: `s${i}`,
        text: `short snippet number ${i}`,
      }));
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({ version: 1, snippets }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0256-lens-focus-carrier",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
          persistInTestMode: true,
          // `document.hasFocus()` — which this test waits on — is tied by
          // WebKit to application activation, so this one launches
          // foreground.
          foreground: true,
        });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: priorCardDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5_000 },
          );
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });
          await app.dispatchControlAction("toggle-lens");
          await app.waitForCondition<boolean>(
            `document.querySelector('.lens-snippets-list .snippet-row-content[data-snippet-id="s2"]') !== null`,
            { timeoutMs: 5_000 },
          );

          // Click a snippet (first click activates the Lens, second lands kbd) —
          // the list wears the ring.
          await app.nativeClickAtElement(
            `.lens-snippets-list .snippet-row-content[data-snippet-id="s0"] .snippet-row-label`,
          );
          await app.nativeClickAtElement(
            `.lens-snippets-list .snippet-row-content[data-snippet-id="s2"] .snippet-row-label`,
          );
          expect(await app.evalJS<boolean>(KBD)).toBe(true);

          // Space → a new snippet editor opens (the CARET is now the carrier; the
          // list gives up the ring). Escape → cancels the empty snippet, and the
          // list RECLAIMS the ring. Neither step leaves the list carrier-less.
          await app.nativeKey(" ");
          await app.waitForCondition<boolean>(EDITOR, { timeoutMs: 4_000 });
          // The snippet editor is a dom-granted text surface — containment of
          // `document.activeElement` is the correct read for the grant.
          await app.waitForCondition<boolean>(
            `document.querySelector('.snippet-editor')?.contains(document.activeElement) === true`,
            { timeoutMs: 3_000 },
          );
          expect(await app.evalJS<boolean>(HAS_CARRIER)).toBe(true);

          await app.nativeKey("Escape", []);
          await app.waitForCondition<boolean>(
            `document.querySelector('.snippet-editor') === null`,
            { timeoutMs: 4_000 },
          );
          // The ring is back on the list — focus was NOT lost.
          expect(
            await app.waitForCondition<boolean>(KBD, { timeoutMs: 2_000 }),
          ).toBe(true);
          expect(await app.evalJS<boolean>(HAS_CARRIER)).toBe(true);

          // Direct keys on the focused list keep the ring: Escape (no editor),
          // and alphanumeric typing (no binding) must not drop the carrier.
          await app.nativeKey("Escape", []);
          expect(await app.evalJS<boolean>(KBD)).toBe(true);
          await app.nativeType("x");
          expect(await app.evalJS<boolean>(HAS_CARRIER)).toBe(true);

          // Enter opens the cursor row's editor (caret carrier); Escape closes it
          // and the list reclaims the ring.
          await app.waitForCondition<boolean>(KBD, { timeoutMs: 2_000 });
          await app.nativeKey("Enter");
          await app.waitForCondition<boolean>(EDITOR, { timeoutMs: 4_000 });
          expect(await app.evalJS<boolean>(HAS_CARRIER)).toBe(true);
          await app.nativeKey("Escape", []);
          await app.waitForCondition<boolean>(
            `document.querySelector('.snippet-editor') === null`,
            { timeoutMs: 4_000 },
          );
          expect(
            await app.waitForCondition<boolean>(KBD, { timeoutMs: 2_000 }),
          ).toBe(true);
        } finally {
          await app.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
