/**
 * at0254-lens-snippet-editor-growth.test.ts — the Lens snippet editor must use
 * the Lens's free space, and must never scroll the user's caret out of view.
 *
 * Two invariants, both measured on the live DOM against a real snippets file:
 *
 *  1. **The editing section grows into free space.** Opening a snippet's editor
 *     grows the Snippets section to claim the Lens's available height (the
 *     `:has(.snippet-editor)` flex-grow), instead of leaving the editor pinched
 *     in a content-sized share with the tail scrolled off — the failure the
 *     one-scroll rail produced.
 *
 *  2. **The caret stays in view while editing a snippet taller than the Lens.**
 *     The editor grows uncapped and the Lens list is the single scroller; a
 *     snippet taller than the Lens makes the LIST scroll, and SnippetsBody
 *     reveals the caret into the list on every edit. So typing at the tail of a
 *     very long snippet keeps the caret on-screen — it can never scroll off.
 *
 * Runs against an isolated snippets file (`TUG_SNIPPETS_PATH`).
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

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

describe.skipIf(!SHOULD_RUN)("at0254 — Lens snippet editor growth + caret", () => {
  test(
    "opening a long snippet grows the section; editing its tail keeps the caret in view",
    async () => {
      const tugbankPath = mkTempTugbank();
      const dir = mkdtempSync(join(tmpdir(), "tug-at0254-"));
      const snippetsPath = join(dir, "snippets.json");
      // A few short snippets, then one snippet whose body is taller than the
      // whole Lens — its open editor forces the list to scroll.
      const longText = Array.from(
        { length: 80 },
        (_, i) => `line ${i} of the pasted multi-line snippet body`,
      ).join("\n");
      const snippets = [
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `s${i}`,
          text: `short snippet ${i}`,
        })),
        { id: "long", text: longText },
      ];
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({ version: 1, snippets }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0254-lens-snippet-editor-growth",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
          persistInTestMode: true,
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
            `document.querySelector('.lens-snippets-list .snippet-row-content[data-snippet-id="long"]') !== null`,
            { timeoutMs: 5_000 },
          );

          // The Snippets section's height at rest — content-sized, well short of
          // the Lens (the other bands + free space are below it).
          const restHeight = await app.evalJS<number>(
            `Math.round(document.querySelector('.lens-section[data-lens-section="snippets"]').getBoundingClientRect().height)`,
          );

          // Open the long snippet's editor.
          await app.nativeDoubleClickAtElement(
            `.lens-snippets-list .snippet-row-content[data-snippet-id="long"] .snippet-row-incipit`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector('.snippet-editor .cm-content') !== null`,
            { timeoutMs: 4_000 },
          );

          // 1. The section grew to claim the free Lens space (well past its rest
          //    height) — the editor is no longer pinched into a content share.
          await app.waitForCondition<boolean>(
            `Math.round(document.querySelector('.lens-section[data-lens-section="snippets"]').getBoundingClientRect().height) > ${restHeight + 300}`,
            { timeoutMs: 3_000 },
          );

          // The list — not the editor — is the scroller (editor grows uncapped).
          expect(
            await app.evalJS<string>(
              `getComputedStyle(document.querySelector('.snippet-editor .cm-scroller')).overflowY`,
            ),
          ).toBe("hidden");

          // 2. Move the caret to the document end and type — editing at the tail
          //    of a snippet taller than the Lens. The caret must stay in view.
          await app.nativeKey("ArrowDown", ["cmd"]);
          await app.nativeType(" EDITED");
          await app.waitForCondition<boolean>(
            `(() => {
              const cur = document.querySelector('.snippet-editor .tug-text-editor-caret');
              const list = document.querySelector('.lens-snippets-list');
              if (cur === null || list === null) return false;
              const c = cur.getBoundingClientRect();
              const l = list.getBoundingClientRect();
              return c.top >= l.top - 1 && c.bottom <= l.bottom + 1;
            })()`,
            { timeoutMs: 3_000 },
          );

          // The list genuinely scrolled to follow the caret (the tail is far
          // below the top), proving the reveal — not a coincidental fit.
          expect(
            await app.evalJS<boolean>(
              `document.querySelector('.lens-snippets-list').scrollTop > 200`,
            ),
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
