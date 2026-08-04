/**
 * at0333-changes-hunk-ids.test.ts — hunk identity from git to the DOM.
 *
 * A hunk election is only as trustworthy as the id it names, and that id is
 * computed in Rust and nowhere else: the deck receives it alongside the diff
 * text and never re-derives one. This drives the whole path over the real
 * aggregate and a really-dirty checkout — edit one tracked file in two places
 * far enough apart that git emits two hunks, expand its row in the Changes
 * shade, and assert the rendered hunk bands carry distinct server-supplied
 * ids, one per hunk, in order.
 *
 * The dirty file is an existing *tracked* file, deliberately: the diff wire
 * serves no ids for a created file, whose chunk it synthesizes from
 * `--no-index` rather than reading out of the index — the landing engine
 * cannot address such a hunk, so the deck must not be handed one to offer.
 * The file's bytes are captured before the edit and restored afterwards.
 *
 * **Not driven here:** the election checkbox and the partial landing. Those
 * render on *session-entry* rows, and a session entry is unreachable from an
 * app-test — `bindSession` is a synthetic client-side binding the ledger knows
 * nothing about, the same wall at0332 and at0253 record. The checkbox's
 * destination is covered at the Rust round-trip layer (`commit.rs`: elected
 * hunk lands alone, mixed whole+partial landing, drift refusal, dirty-index
 * refusal; `feeds/changeset.rs`: the `changeset_commit` election round trip).
 *
 * @covers tugdeck/src/components/tugways/tug-changes-list.tsx
 * @covers tugdeck/src/components/tugways/body-kinds/diff-block.tsx
 * @covers tugdeck/src/lib/git-diff-store.ts
 * @covers tugrust/crates/tugcast/src/feeds/git.rs
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0333-session";
const CARD = '[data-card-id="A"]';
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const USER_ROWS = `${CARD} [data-testid="session-card-transcript-user-body"]`;
const SHEET = `${CARD} .session-view-pane[data-view="changes"] [data-slot="tug-sheet"]`;

// As in at0332: the registry keys a workspace by the canonical project dir, so
// the dirty file has to live in this checkout — a synthetic temp repo never
// composes into the aggregate.
const PROJECT_DIR = realpathSync(resolve(import.meta.dir, "..", ".."));
// A long, stable doc with no runtime role. Two edits ~50 lines apart leave
// git's default context windows disjoint, so it emits two hunks.
const DIRTY_FILE = "tests/app-test/README.md";
const dirtyPath = join(PROJECT_DIR, DIRTY_FILE);

let original = "";

const FILE_ROW =
  `${SHEET} [data-testid="tug-changes-list-file-block"][data-path="${DIRTY_FILE}"]`;

beforeAll(() => {
  if (!SHOULD_RUN) return;
  original = readFileSync(dirtyPath, "utf8");
  const lines = original.split("\n");
  // Two marker lines with a wide gap between them. Anchored to line indices
  // rather than content so the edit survives any rewording of the doc.
  const first = 5;
  const second = Math.min(first + 60, lines.length - 1);
  lines.splice(second, 0, "<!-- at0333 second marker -->");
  lines.splice(first, 0, "<!-- at0333 first marker -->");
  writeFileSync(dirtyPath, lines.join("\n"));
});

afterAll(() => {
  if (original.length > 0) writeFileSync(dirtyPath, original);
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

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!SHOULD_RUN)("AT0333: hunk ids reach the rendered diff", () => {
  test(
    "a two-hunk tracked file renders one distinct server-supplied id per hunk band",
    async () => {
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath, { sourceTreePath: PROJECT_DIR });
      const app = await launchTugApp({
        testName: "at0333-changes-hunk-ids",
        env: { TUGBANK_PATH: tugbankPath },
      });
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

        // One committed turn so the card is a live, non-empty session.
        await app.driveSession("A", { op: "send", text: "hello" });
        await app.driveSession("A", {
          op: "ingestFrame",
          feedId: 0x40,
          decoded: { tug_session_id: SID, type: "prompt_anchor", promptUuid: "uuid-1" },
        });
        await app.driveSession("A", {
          op: "ingestFrame",
          feedId: 0x40,
          decoded: { tug_session_id: SID, type: "turn_complete", msg_id: "m1", result: "success" },
        });
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length === 1`,
          { timeoutMs: 8000 },
        );

        // ── Raise the changes sheet ────────────────────────────────────────
        await app.nativeClickAtElement(PROMPT_INPUT);
        await app.nativeType("/commit");
        await settle();
        await app.nativeKey("Escape"); // dismiss the completion popup
        await settle();
        await app.nativeKey("Return", ["cmd"]);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SHEET)}) !== null`,
          { timeoutMs: 8000 },
        );

        // ── The edited file arrives in the shade ───────────────────────────
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(FILE_ROW)}) !== null`,
          { timeoutMs: 20000 },
        );

        // Expand it. The fold cue is the row's own affordance, so click it
        // rather than the row hit area (which the trailing cluster masks).
        //
        // The click is retried against the row's own expanded bit rather than
        // fired once and trusted: an aggregate recompute can re-render the
        // list between finding the cue and hitting it, and on a loaded machine
        // that lands the click on nothing. Re-clicking only while still
        // collapsed can't toggle it back shut.
        const isExpanded = async (): Promise<boolean> =>
          app.evalJS<boolean>(
            `document.querySelector(${JSON.stringify(
              `${FILE_ROW}[data-expanded="true"]`,
            )}) !== null`,
          );
        for (let attempt = 0; attempt < 4; attempt += 1) {
          if (await isExpanded()) break;
          await app.nativeClickAtElement(
            `${FILE_ROW} [data-slot="tug-changes-list-fold"]`,
          );
          await settle(500);
        }
        expect(await isExpanded()).toBe(true);

        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(
            `${FILE_ROW} [data-slot="diff-hunk"]`,
          )}).length >= 2`,
          { timeoutMs: 25000 },
        );

        const ids = await app.evalJS<(string | null)[]>(
          `Array.from(
             document.querySelectorAll(${JSON.stringify(
               `${FILE_ROW} [data-slot="diff-hunk"]`,
             )}),
           ).map((el) => el.getAttribute("data-hunk-id"))`,
        );
        expect(ids.length).toBeGreaterThanOrEqual(2);
        // Every band carries an id — a missing one would mean the deck had to
        // invent identity, which is exactly what the wire exists to prevent.
        for (const id of ids) {
          expect(typeof id).toBe("string");
          expect(id).toMatch(/^[0-9a-f]{16}(#\d+)?$/);
        }
        expect(new Set(ids).size).toBe(ids.length);
      } finally {
        await app.close();
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
