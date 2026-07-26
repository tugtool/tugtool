/**
 * at0276-lens-side-persists.test.ts — a Lens side chosen in the Layouts
 * section survives a quit and relaunch.
 *
 * The side used to live in an app-wide preference of its own
 * (`dev.tugtool.lens/anchorSide`); it now rides the deck's layout blob as
 * `imposition.lens`. That move puts the durability of the user's choice on a
 * new path — `setImpositionLens` → `scheduleSave` → `serialize` → tugbank →
 * `deserialize` → `_createLensPane` — and a serialize/parse asymmetry
 * anywhere along it would lose the choice silently on the next launch.
 *
 * Nothing else proves that round-trip. `at0275` drives the picker and asserts
 * the *live* flip, which never leaves memory. The migration unit tests in
 * `layout-tree.test.ts` cover *legacy* blobs — the string `imposition` and the
 * retired pane `anchor` — not a blob this build wrote. This test closes that
 * gap end to end, against the real app and the real control.
 *
 * | Phase | Action                                          | Assertion                        |
 * |-------|-------------------------------------------------|----------------------------------|
 * | A     | open the Lens, click "Lens on left" in Layouts, | the layout blob on disk carries  |
 * |       | let the save debounce land, quit gracefully     | `imposition.lens === "left"`     |
 * | B     | relaunch with `restoreInTestMode` — no seeding, | the Lens mounts on the left      |
 * |       | no clicks                                       |                                  |
 *
 * @covers tugdeck/src/serialization.ts
 * @covers tugdeck/src/deck-manager.ts
 * @covers tugdeck/src/lib/layout-imposer.ts
 * @covers tugdeck/src/components/lens/sections/layouts-section.tsx
 * @covers tugdeck/src/components/lens/layout-miniature.tsx
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
  tugbankRead,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SECTION = '[data-testid="lens-layouts-section"]';
const LEFT_SEGMENT = `${SECTION} [data-testid="lens-layouts-side"] [data-radio-value="left"]`;

/** `scheduleSave`'s debounce, with room for the PUT to reach tugbank. */
const SAVE_SETTLE_MS = 1_500;

const settle = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Wait for the Lens pane to be mounted holding `side`. */
async function waitForLensOn(app: App, side: "left" | "right"): Promise<void> {
  await app.waitForCondition<boolean>(
    `document.querySelector('.tug-pane[data-lens="${side}"]') !== null`,
    { timeoutMs: 10_000 },
  );
}

describe.skipIf(!SHOULD_RUN)("at0276 — the Lens side survives a relaunch", () => {
  test(
    "choosing Lens on left in the Layouts section outlives a quit",
    async () => {
      const tugbankPath = mkTempTugbank();
      try {
        seedTugbankForLaunch(tugbankPath);

        // ── Phase A: choose the side through the real control, then quit. ──
        {
          const app = await launchTugApp({
            testName: "at0276-lens-side-persists-A",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await app.dispatchControlAction("toggle-lens");
            await waitForLensOn(app, "right");
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(LEFT_SEGMENT)}) !== null`,
              { timeoutMs: 8_000 },
            );

            await app.nativeClickAtElement(LEFT_SEGMENT);
            await waitForLensOn(app, "left");

            // The write is debounced, so give it time to reach disk before
            // the quit — otherwise this would pass for the wrong reason.
            await settle(SAVE_SETTLE_MS);
            await app.quitGracefully();
          } catch (e) {
            await app.close().catch(() => undefined);
            throw e;
          }
        }

        // ── Phase A disk assertion: the choice is in the layout blob, and
        //    in the record rather than a stray pane field. ──
        const onDisk = tugbankRead<{
          imposition?: { lens?: string; kind?: string };
          panes?: Array<Record<string, unknown>>;
        }>(tugbankPath, "dev.tugtool.deck.layout", "layout");
        expect(onDisk).not.toBeNull();
        expect(onDisk!.value.imposition?.lens).toBe("left");
        // The retired pane field is not written back — a build that still
        // emitted it would keep working while quietly re-arming the
        // two-sources-of-truth problem the record replaced.
        for (const pane of onDisk!.value.panes ?? []) {
          expect(pane["anchor"]).toBeUndefined();
        }

        // ── Phase B: relaunch against the same tugbank. No seeding, no
        //    clicks — the restore path is what is under test. ──
        {
          const app = await launchTugApp({
            testName: "at0276-lens-side-persists-B",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
            restoreInTestMode: true,
          });
          try {
            await waitForLensOn(app, "left");
            expect(
              await app.evalJS<number>(
                `document.querySelectorAll('.tug-pane[data-lens="right"]').length`,
              ),
            ).toBe(0);
          } finally {
            await app.close();
          }
        }
      } finally {
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
