/**
 * TEMPORARY screenshot probe — deleted right after the run.
 *
 * @covers tugdeck/src/components/lens/lens-section-band.tsx
 */

import { describe, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const SNIPPETS = [
  { id: "s-a", text: "zebra harmonica calibration" },
  { id: "s-b", text: "quokka telemetry sweep" },
  { id: "s-c", text: "marmot ledger reconciliation" },
];

const ROWS = ".lens-snippets-list .tug-list-row";

describe.skipIf(!SHOULD_RUN)("tmp shot", () => {
  test(
    "shot",
    async () => {
      const tugbankPath = mkTempTugbank();
      const dir = mkdtempSync(join(tmpdir(), "tug-tmp-shot-"));
      const snippetsPath = join(dir, "snippets.json");
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({ version: 1, snippets: SNIPPETS }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "tmp-shot",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
          persistInTestMode: true,
        });
        try {
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });
          await app.dispatchControlAction("focus-lens");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(ROWS)}).length >= 3`,
            { timeoutMs: 8_000 },
          );
          await new Promise<void>((r) => setTimeout(r, 800));
          // Keyboard cursor should be on the snippets list; capture it.
          const cursor = await app.evalJS<number>(
            `document.querySelectorAll('.lens-snippets-list .tug-list-view-cell[data-key-cursor]').length`,
          );
          console.log("[tmp] key-cursor cells:", cursor);

          const b = await app.getElementBounds(
            `${ROWS}:nth-of-type(1)`,
          ).catch(() => app.getElementBounds(ROWS));
          const point = { x: b.x + b.width / 3, y: b.y + b.height / 2 };
          await app.nativeMouseDown(point);
          await new Promise<void>((r) => setTimeout(r, 250));
          const shot = await app.screenshot();
          copyFileSync(shot.path, "/tmp/lens-press.png");
          await app.nativeMouseUp(point);
          console.log("[tmp] shot at /tmp/lens-press.png");
        } finally {
          await app.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
        rmTempTugbank(tugbankPath);
      }
    },
    120_000,
  );
});
