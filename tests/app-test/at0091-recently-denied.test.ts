/**
 * at0091-recently-denied.test.ts — the `/permissions` Recently-denied tab
 * surfaces a turn's `permission_denials` and promotes one to a rule ([AT0091]).
 *
 * ## Why this exists
 *
 * Denied tool calls (permission rule OR auto-mode classifier) ride the
 * `cost_update` frame's `permission_denials[]`; the dev card accumulates them
 * per session and lists them in the Recently-denied tab, each with one-click
 * promote to a local Allow/Ask/Deny rule. The wire shape was captured in
 * `roadmap/transport-exploration.md`. This drives the **tugdeck half** end to
 * end without needing a real (rare, classifier-gated) denial: it injects a
 * synthetic `cost_update` frame through the store's real
 * `frameToEvent → dispatch` path (`driveDevSession`/`ingestFrame`), opens the
 * editor, and asserts the row renders + promoting it writes the rule file. The
 * tugcode emit half is covered by `tugcode/src/__tests__/session.test.ts`.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const SHEET = '[data-slot="tug-sheet"]';
const DENIED_LIST = `${SHEET} [data-slot="recently-denied-list"]`;
const CODE_OUTPUT_FEED = 0x40; // FeedId.CODE_OUTPUT
const TUG_SESSION_ID = "test-session-A"; // bindDevSession default
const DENIED_MATCHER = "Bash(at0091-denied-cmd)";

let projectDir = "";
const settingsPath = (): string => join(projectDir, ".claude", "settings.local.json");

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0091-denied-"));
});
afterAll(() => {
  if (projectDir !== "" && existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true });
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** The `permissions.deny` array on disk, or `[]` when the file is absent. */
function denyRules(): string[] {
  const path = settingsPath();
  if (!existsSync(path)) return [];
  const root = JSON.parse(readFileSync(path, "utf-8")) as { permissions?: { deny?: unknown } };
  const deny = root.permissions?.deny;
  return Array.isArray(deny) ? deny.filter((e): e is string => typeof e === "string") : [];
}

describe.skipIf(!SHOULD_RUN)(
  "AT0091: Recently-denied tab surfaces permission_denials + promotes to a rule",
  () => {
    test(
      "ingested cost_update denial renders in Recently denied; Deny promotes it to a rule",
      async () => {
        const app = await launchTugApp({ testName: "at0091-recently-denied" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindDevSession("A", { projectDir });
          await app.awaitEngineReady("A");

          // Inject a synthetic cost_update carrying one denial through the
          // store's real frameToEvent → dispatch path.
          await app.driveDevSession("A", {
            op: "ingestFrame",
            feedId: CODE_OUTPUT_FEED,
            decoded: {
              type: "cost_update",
              tug_session_id: TUG_SESSION_ID,
              total_cost_usd: 0.01,
              permission_denials: [
                {
                  tool_name: "Bash",
                  tool_use_id: "at0091-tu-1",
                  tool_input: { command: "at0091-denied-cmd" },
                },
              ],
            },
          });

          // Open the editor (raw-text local-command submit). Paced keystrokes
          // (one batch, ~40ms apart) so the OS doesn't drop keys under load.
          await app.nativeClickAtElement(PROMPT_INPUT);
          await app.nativeType("/permissions");
          await new Promise((r) => setTimeout(r, 200));
          await app.nativeKey("Escape");
          await new Promise((r) => setTimeout(r, 200));
          await app.nativeKey("Return", ["cmd"]);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SHEET)}) !== null`,
            { timeoutMs: 6000 },
          );

          // Switch to the Recently-denied tab.
          await app.evalJS<void>(
            `document.querySelector(${JSON.stringify(`${SHEET} .tug-tab[data-testid="tug-tab-recentlyDenied"]`)}).click()`,
          );

          // The denial renders as a row showing its derived matcher.
          await app.waitForCondition<boolean>(
            `Array.from(document.querySelectorAll(${JSON.stringify(`${DENIED_LIST} .permission-rule-matcher`)})).some(function(el){return el.textContent.trim() === ${JSON.stringify(DENIED_MATCHER)};})`,
            { timeoutMs: 4000 },
          );

          // Promote it: click the row's "Deny" button → writes a deny rule.
          expect(denyRules(), "no deny rule before promote").not.toContain(DENIED_MATCHER);
          await app.evalJS<void>(
            `(function(){
              var rows = document.querySelectorAll(${JSON.stringify(`${DENIED_LIST} .tug-list-row`)});
              for (var i = 0; i < rows.length; i++) {
                var m = rows[i].querySelector('.permission-rule-matcher');
                if (m && m.textContent.trim() === ${JSON.stringify(DENIED_MATCHER)}) {
                  var btns = Array.from(rows[i].querySelectorAll('button'));
                  var deny = btns.find(function(b){return b.textContent.trim() === 'Deny';});
                  if (!deny) throw new Error('Deny button not found on denial row');
                  deny.click();
                  return;
                }
              }
              throw new Error('denial row not found');
            })()`,
          );

          const deadline = Date.now() + 8000;
          let last: string[] = [];
          while (Date.now() < deadline) {
            last = denyRules();
            if (last.includes(DENIED_MATCHER)) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          expect(last, "Deny promote must write the matcher to settings.local.json").toContain(
            DENIED_MATCHER,
          );

          process.stdout.write("VERDICT: PASS\n");
        } catch (err) {
          process.stdout.write("VERDICT: FAIL\n");
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0091] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
