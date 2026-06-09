/**
 * at0149-dialog-enter-after-tab.test.ts — Return commits the card-modal dialog's
 * default action while the keyboard is on the scope radio group (and after a Tab
 * tour back to Allow).
 *
 * ## Why this exists
 *
 * The reported bug: with the keyboard on the **scope radio group** (the group
 * ringed, Allow showing its persistent default-ring), Return did NOTHING — the
 * radio group was a *deferred-commit* item-group, so its act-dispatch consumed
 * Enter (to confirm a cursor move) instead of letting it bubble to the ringed
 * Allow. The fix is component-level: a mutually-exclusive group
 * (`TugRadioGroup`/`TugChoiceGroup`) is **selection-follows-cursor** — arrows move
 * the selection immediately, and the group does NOT consume `Enter`, so Return
 * falls through to the scope's default button.
 *
 * The walk is driven with **synthetic keydown events dispatched on `document`** —
 * these traverse the EXACT handler chain a human keypress does (the capture-phase
 * `focusWalkListener` → act-dispatch → bubble default-button stage in
 * `responder-chain-provider`); the activation is the engine's own
 * default-button `click()`, so the path is faithful and RPC-drivable unattended.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0149-session";
const FEED_CODE_OUTPUT = 0x40;

const CARD = '[data-card-id="A"]';
const DIALOG = `${CARD} [data-slot="dev-permission-dialog"]`;
const ALLOW = `${DIALOG} .tug-inline-dialog-actions .tug-button-primary-action`;
const SCOPE = `${DIALOG} [data-slot="tug-radio-group"]`;
const SCOPE_CHECKED = `${SCOPE} [data-slot="tug-radio-item"][data-state="checked"]`;

function controlRequestForward(): Record<string, unknown> {
  return {
    type: "control_request_forward",
    tug_session_id: SID,
    request_id: "at0149-perm-1",
    is_question: false,
    tool_name: "Bash",
    input: { command: "tokei" },
    permission_suggestions: [
      { behavior: "allow", destination: "project", type: "addRules", rules: [{ toolName: "Bash" }] },
    ],
  };
}

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      { id: "p1", position: { x: 40, y: 40 }, size: { width: 820, height: 620 }, cardIds: ["A"], activeCardId: "A", title: "", acceptsFamilies: ["developer"] },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

function dispatchKey(app: App, key: string): Promise<unknown> {
  // Dispatch on the focused element (like a real keypress): the event bubbles up
  // through the focused component's React `onKeyDown` (arrow cursor handling) AND
  // reaches the document-level capture listeners (Tab walk / act-dispatch /
  // default-button) — the EXACT chain a human key traverses.
  return app.evalJS(
    `(function(){ var t = document.activeElement || document; t.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true})); return true; })()`,
  );
}

function dialogPresent(app: App): Promise<boolean> {
  return app.evalJS<boolean>(`document.querySelector(${JSON.stringify(DIALOG)}) !== null`);
}

function hasAttr(app: App, selector: string, attr: string): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){var el=document.querySelector(${JSON.stringify(selector)});return el!==null && el.hasAttribute(${JSON.stringify(attr)});})()`,
  );
}

function textOf(app: App, selector: string): Promise<string | null> {
  return app.evalJS<string | null>(
    `(function(){var el=document.querySelector(${JSON.stringify(selector)});return el?el.textContent:null;})()`,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function presentPermission(app: App): Promise<void> {
  await app.driveDevSession("A", { op: "send", text: "count lines with tokei" });
  await app.driveDevSession("A", {
    op: "ingestFrame",
    feedId: FEED_CODE_OUTPUT,
    decoded: { type: "assistant_text", tug_session_id: SID, msg_id: "at0149-m1", text: "x", is_partial: true, rev: 0, seq: 0 },
  });
  await app.driveDevSession("A", { op: "ingestFrame", feedId: FEED_CODE_OUTPUT, decoded: controlRequestForward() });
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(DIALOG)}) !== null`,
    { timeoutMs: 6000 },
  );
  // Seeded on Allow (the recommended default).
  await app.waitForCondition<boolean>(
    `(function(){var el=document.querySelector(${JSON.stringify(ALLOW)});return el!==null && el.hasAttribute("data-key-view-kbd");})()`,
    { timeoutMs: 4000 },
  );
}

describe.skipIf(!SHOULD_RUN)(
  "AT0149: Return commits the dialog default while the keyboard is on the scope group",
  () => {
    test(
      "scope group is selection-follows-cursor; Return on it commits Allow (the reported bug)",
      async () => {
        const app = await launchTugApp({ testName: "at0149-dialog-enter-after-tab" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindDevSession("A", { tugSessionId: SID });
          await app.awaitEngineReady("A");
          await presentPermission(app);

          // Tab to the scope radio group (Allow → Deny → scope group).
          await dispatchKey(app, "Tab"); await sleep(120); // → Deny
          await dispatchKey(app, "Tab"); await sleep(150); // → scope group
          expect(
            await hasAttr(app, SCOPE, "data-key-view-kbd"),
            "the scope radio group holds the keyboard ring",
          ).toBe(true);
          // The scope group opens checked on "Allow once".
          expect(
            (await textOf(app, SCOPE_CHECKED)) ?? "",
            "scope group opens checked on Allow once",
          ).toContain("Allow once");
          // Selection-follows-cursor: ArrowDown selects "Allow for this project"
          // IMMEDIATELY — no deferred confirm step.
          await dispatchKey(app, "ArrowDown"); await sleep(150);
          expect(
            (await textOf(app, SCOPE_CHECKED)) ?? "",
            "ArrowDown selects the next scope immediately (no confirm needed)",
          ).toContain("Allow for this project");
          // Allow shows its persistent default-ring while the keyboard is on the
          // (non-button) scope group.
          expect(
            await hasAttr(app, ALLOW, "data-default-ring"),
            "Allow shows its default-ring while the keyboard is on the scope group",
          ).toBe(true);

          // THE REPORTED BUG: Return here must commit Allow — the radio group does
          // NOT consume Enter, so it bubbles to the ringed default button.
          await dispatchKey(app, "Enter");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(DIALOG)}) === null`,
            { timeoutMs: 4000 },
          );
          expect(
            await dialogPresent(app),
            "Return while on the scope group commits Allow (dialog dismisses)",
          ).toBe(false);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0149-dialog-enter-after-tab] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
