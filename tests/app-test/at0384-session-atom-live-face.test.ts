/**
 * at0384-session-atom-live-face.test.ts — a session atom in the transcript is
 * the identity chip, live, resolved by its callsign.
 *
 * ## What this gates
 *
 * A submitted prompt records a session reference as the backtick-`@` wire
 * marker and nothing else: `` `@tugtool/stocky-pixie` `` — no id, no type. On
 * replay the substrate synthesizer re-mints it as an atom typed `session`, and
 * what the transcript renders for it used to be a generic chip: the atom family's
 * key-washed pill with a speech-bubble glyph, which is a file atom wearing a
 * different icon. Spec S05 says a session atom is dot-led, in text ink; [P14]
 * says a mounted chip is a subscribed one.
 *
 *   A. **The chip is the identity component, not a look-alike.** The transcript
 *      row carries `[data-slot="tug-session-identity"][data-tier="chip"]` with a
 *      live phase indicator inside it — the one mark that says what the session
 *      is *doing*.
 *
 *   B. **It resolves, and the resolution comes from the ledger.** The chip holds
 *      a callsign and no id, so `resolve_sessions` has to answer for a *name* —
 *      the arm added to `SessionLedger::resolve_session_ids` for exactly this.
 *      The session is seeded into the real ledger with its tag and the chip must
 *      settle **not** `data-missing`; a chip that stayed dashed would mean the
 *      round trip never resolved, which is what the id-only ledger did.
 *
 *   C. **It reads as the title, not as the citation.** The run is the [P05]
 *      title grammar, prefix included — `tugtool/stocky-pixie` — and the wire
 *      marker's backtick-`@` spelling never survives as prose beside the chip.
 *
 * The composer's own pasted atom is a Canvas bake and stays one ([P14]); its
 * face is pinned in `at0376`, on the real pasteboard.
 *
 * @covers tugdeck/src/components/tugways/cards/tug-atom-text-body.tsx
 * @covers tugdeck/src/components/tugways/cards/tug-atom-markdown-body.tsx
 * @covers tugdeck/src/lib/session-atom-shape.ts
 * @covers tugdeck/src/lib/session-citation-store.ts
 * @covers tugrust/crates/tugcast/src/session_ledger.rs
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CODE_OUTPUT_FEED = 0x40; // FeedId.CODE_OUTPUT
const SID = "f6e43925-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const TAG = "stocky-pixie";
const PROJECT_DIR = "/Users/tester/src/tugtool";

const BODY = '[data-card-id="A"] [data-slot="tug-atom-markdown-body"]';
const CHIP = `${BODY} [data-slot="tug-session-identity"][data-tier="chip"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 900, height: 640 },
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

const userMsg = (text: string) => ({
  type: "add_user_message",
  tug_session_id: SID,
  content: [{ type: "text", text }],
});
const turnDone = (msgId: string) => ({
  type: "turn_complete",
  tug_session_id: SID,
  msg_id: msgId,
  result: "success",
});
const asstText = (msgId: string, text: string) => ({
  type: "assistant_text",
  tug_session_id: SID,
  msg_id: msgId,
  text,
  is_partial: false,
  rev: 0,
  seq: 0,
});
const replayStarted = () => ({ type: "replay_started", tug_session_id: SID });
const replayComplete = () => ({
  type: "replay_complete",
  tug_session_id: SID,
  count: 1,
  firstLoadedTurnIndex: 0,
  totalTurns: 1,
  hasOlder: false,
});

describe.skipIf(!SHOULD_RUN)("at0384 — the session atom's live face", () => {
  test(
    "a replayed session mention mounts the live identity chip and resolves by callsign",
    async () => {
      const app = await launchTugApp({ testName: "at0384-session-atom-live-face" });
      const ingest = (decoded: unknown) =>
        app.driveSession("A", {
          op: "ingestFrame",
          feedId: CODE_OUTPUT_FEED,
          decoded,
        });
      try {
        // The ledger's own row, written through the real spawn path with the
        // callsign on it — the only way `resolve_sessions` can answer for a
        // NAME. Seeded after launch so the startup sweep does not demote it out
        // from under the test.
        app.seedLedger({
          sessions: [
            {
              session_id: SID,
              workspace_key: PROJECT_DIR,
              project_dir: PROJECT_DIR,
              card_id: "A",
              tag: TAG,
            },
          ],
        });

        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          { timeoutMs: 30_000 },
        );
        await app.bindSession("A", {
          tugSessionId: SID,
          projectDir: PROJECT_DIR,
          sessionMode: "resume",
        });
        // The client's tag index is what tells the synthesizer that this
        // mention names a session rather than a file — the same push the
        // ledger sends on a real spawn.
        await app.evalJS<boolean>(
          `window.__tug.publishSessionUpdated(${JSON.stringify(
            JSON.stringify({
              session_id: SID,
              fields: { tag: TAG, name: null, name_user_set: false },
            }),
          )})`,
        );

        // The prompt as it persists: the marker, and no other record of what
        // the user referred to.
        await ingest(replayStarted());
        await ingest(userMsg(`pick up where \`@tugtool/${TAG}\` left off`));
        await ingest(asstText("m1", "on it"));
        await ingest(turnDone("m1"));
        await ingest(replayComplete());

        // ---- A. The chip is the identity component. ------------------------
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CHIP)}) !== null`,
          { timeoutMs: 15_000 },
        );
        const dots = await app.evalJS<number>(
          `document.querySelectorAll(${JSON.stringify(CHIP)} +
             ' [data-slot="tug-progress-indicator"]').length`,
        );
        // The dot is the session's mark on this register and the only thing
        // that can report what it is doing.
        expect(dots).toBe(1);
        // The generic atom family's chip is an inline `<svg>`; a session atom
        // must not be rendering as one.
        expect(
          await app.evalJS<number>(
            `document.querySelectorAll(${JSON.stringify(BODY)} + ' svg.tug-atom-chip').length`,
          ),
        ).toBe(0);

        // ---- B. And it resolved — through the callsign. ---------------------
        //
        // Wait for the ledger's answer rather than for the chip: an unanswered
        // citation is deliberately neither resolved nor dashed, so reading
        // `data-missing` before the round trip lands reads a state this test is
        // not about.
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CHIP)})
             .getAttribute("data-missing") !== "true"
           && document.querySelector(${JSON.stringify(CHIP)} +
                ' [data-slot="tug-progress-indicator"]') !== null`,
          { timeoutMs: 15_000 },
        );
        const chip = await app.evalJS<{ text: string; missing: string }>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(CHIP)});
            return {
              text: (el.textContent || "").trim(),
              missing: el.getAttribute("data-missing") || "",
            };
          })()`,
        );
        note("at0384 chip", JSON.stringify(chip));
        expect(chip.missing).not.toBe("true");

        // ---- C. It reads as the title, never as the citation. ---------------
        expect(chip.text).toContain(`tugtool/${TAG}`);
        // The marker is never left as prose beside it.
        expect(
          await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(BODY)}).textContent || "")`,
          ),
        ).not.toContain("@tugtool");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
