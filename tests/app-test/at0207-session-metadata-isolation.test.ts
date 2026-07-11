/**
 * at0207-session-metadata-isolation.test.ts — two live sessions, one shared
 * SESSION_SIDEBAND broadcast: each card's Z2 model indicator reflects ONLY
 * its own session ([AT0207]).
 *
 * ## Why this exists
 *
 * SESSION_SIDEBAND is a single broadcast shared by every session; isolation
 * is a client-side contract ([D06]/[D11]): tugcast splices `tug_session_id`
 * into every frame and the per-card FeedStore filters on it. That filter was
 * missing — any session's `system_metadata` rewrote every card's model /
 * mode / catalog, so switching the model in one card flipped the OTHER
 * card's Z2 indicator.
 *
 * at0200 pins isolation at the state layer (persistence, seeding, defaults)
 * but drives metadata via `ingestSessionMetadata` — per-card injection that
 * bypasses the shared wire, which is exactly why the transport leak survived
 * it. This test drives the REAL chain: two fixture JSONLs on disk, two
 * genuine `spawn_session(mode=resume)` calls over the live connection, two
 * real tugcode subprocesses replaying through tugcast's `CODE_OUTPUT →
 * SESSION_SIDEBAND` fan-out onto the one shared broadcast. Card A resolves
 * its model first; then card B's replay floods the wire with session-B
 * frames (system_metadata + the live-claude handshake that follows). The
 * assertion is that card A's model chip does not move.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)` — same vehicle as at0192.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

// Fixed, UUID-shaped claude/tug session ids. The fixture JSONLs are named
// `<SID>.jsonl`; the un-forked resume resolves the claude id to the tug
// session id, so the two are identical here. Distinct models per session so
// contamination is unambiguous in the rendered chips.
const SID_A = "a7c0d1ea-0000-4000-8000-0000000000aa";
const SID_B = "a7c0d1ea-0000-4000-8000-0000000000bb";
const MODEL_A = "claude-opus-4-8";
const MODEL_B = "claude-sonnet-4-6";

/**
 * Encode an absolute project dir the way claude names its per-project
 * subdir under `~/.claude/projects/` — mirrors tugcode's `encodeProjectDir`
 * (every character outside `[A-Za-z0-9-]` → `-`). Kept inline so the
 * app-test graph does not import tugcode.
 */
const encodeProjectDir = (absDir: string): string =>
  absDir.replace(/[^A-Za-z0-9-]/g, "-");

/**
 * A minimal two-turn session JSONL carrying a real `message.model`. The
 * lines carry claude's own session-JSONL fields (`uuid` / `parentUuid`
 * chain, `sessionId`, `cwd`, …) because `claude --resume <id>` reads the
 * SAME file — a thin fixture parses for tugcode but makes claude report
 * "No conversation found" and `resume_failed`. `cwd` must equal the
 * resolved project dir, so the fixture is built per-run.
 */
function buildFixtureJsonl(cwd: string, sessionId: string, model: string): string {
  const base = {
    isSidechain: false,
    userType: "external",
    cwd,
    sessionId,
    version: "2.1.105",
    gitBranch: "main",
  };
  const suffix = sessionId.slice(-2);
  const lines = [
    {
      ...base,
      parentUuid: null,
      type: "user",
      uuid: `00000000-0000-4000-8000-0000000${suffix}c01`,
      timestamp: "2026-06-17T10:00:00.000Z",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
    },
    {
      ...base,
      parentUuid: `00000000-0000-4000-8000-0000000${suffix}c01`,
      type: "assistant",
      uuid: `00000000-0000-4000-8000-0000000${suffix}c02`,
      timestamp: "2026-06-17T10:00:01.000Z",
      message: {
        id: `msg-iso-${suffix}`,
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "text", text: "hi there" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 1200,
          output_tokens: 50,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 8000,
        },
      },
    },
  ];
  return lines.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

let projectDir = "";
let fixtureDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  // realpath: macOS `mkdtemp` returns `/var/folders/…` but tugcode (and
  // claude) resolve `/var` → `/private/var` before encoding the
  // claude-projects subdir — encode + spawn against the SAME resolved string.
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "at0207-proj-")));
  fixtureDir = join(homedir(), ".claude", "projects", encodeProjectDir(projectDir));
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    join(fixtureDir, `${SID_A}.jsonl`),
    buildFixtureJsonl(projectDir, SID_A, MODEL_A),
  );
  writeFileSync(
    join(fixtureDir, `${SID_B}.jsonl`),
    buildFixtureJsonl(projectDir, SID_B, MODEL_B),
  );
});

afterAll(() => {
  if (projectDir !== "" && existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
  // Remove only the unique per-test encoded subdir we created.
  if (fixtureDir !== "" && existsSync(fixtureDir)) {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

/** One pane per card, side by side, so both Z2 rows render concurrently. */
function deckShape() {
  const cardIds = ["A", "B"];
  return {
    cards: cardIds.map((id) => ({
      id,
      componentId: "dev",
      title: `Dev ${id}`,
      closable: true,
    })),
    panes: cardIds.map((id, i) => ({
      id: `p${i + 1}`,
      position: { x: 40 + i * 660, y: 40 },
      size: { width: 640, height: 560 },
      cardIds: [id],
      activeCardId: id,
      title: "",
      acceptsFamilies: ["maker"],
    })),
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** JS expression reading a card's ACTIVE model-chip face (sizers are hidden). */
const modelChipJs = (cardId: string): string => `(() => {
  const el = document.querySelector('[data-card-id="${cardId}"] [data-slot="model-chip"] [data-slot="model-value"] [data-tug-stable="active"]');
  return el ? (el.textContent || '').trim() : '';
})()`;

describe.skipIf(!SHOULD_RUN)(
  "AT0207: SESSION_SIDEBAND session isolation across two live cards",
  () => {
    test(
      "card B's real replay traffic never moves card A's model chip",
      async () => {
        const app = await launchTugApp({
          testName: "at0207-session-metadata-isolation",
        });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
            { timeoutMs: 15_000 },
          );

          // Session A up first, alone on the wire — its replayed model
          // resolves the card-A chip.
          await app.spawnSessionResume("A", { tugSessionId: SID_A, projectDir });
          await app.waitForCondition<boolean>(
            `${modelChipJs("A")}.includes("Opus")`,
            { timeoutMs: 20_000 },
          );
          const cardABefore = await app.evalJS<string>(modelChipJs("A"));

          // Session B joins the SAME broadcast. Its replay emits session-B
          // system_metadata (+ the live handshake's session_capabilities)
          // onto the shared feed while card A sits bound and listening —
          // the contamination vector the [D06]/[D11] filter must block.
          await app.spawnSessionResume("B", { tugSessionId: SID_B, projectDir });
          await app.waitForCondition<boolean>(
            `${modelChipJs("B")}.includes("Sonnet")`,
            { timeoutMs: 20_000 },
          );

          // Card B resolved its own model — not card A's.
          const cardB = await app.evalJS<string>(modelChipJs("B"));
          expect(cardB.includes("Sonnet")).toBe(true);
          expect(cardB.includes("Opus")).toBe(false);

          // Card A is untouched by session B's frames — both immediately
          // after B lands and after the post-resume live handshake settles.
          expect(await app.evalJS<string>(modelChipJs("A"))).toBe(cardABefore);
          await new Promise((r) => setTimeout(r, 2_000));
          expect(
            await app.evalJS<string>(modelChipJs("A")),
            "card A's model chip must not move on session B's traffic",
          ).toBe(cardABefore);

          process.stdout.write(
            `[at0207] card A "${cardABefore}" · card B "${cardB}"\n`,
          );
          process.stdout.write("VERDICT: PASS\n");
        } catch (err) {
          process.stdout.write("VERDICT: FAIL\n");
          const DIAG_JS = `JSON.stringify((() => {
            const read = (id) => {
              const card = document.querySelector('[data-card-id="' + id + '"]');
              const q = (sel) => !!(card && card.querySelector(sel));
              const txt = (sel) => {
                const el = card && card.querySelector(sel);
                return el ? (el.textContent || '').trim() : null;
              };
              return {
                hasCard: !!card,
                picker: q('[data-slot="dev-card-picker"]'),
                body: q('[data-slot="dev-card"]'),
                spawnError: q('[data-testid="dev-card-spawn-error-retry"]'),
                model: txt('[data-slot="model-value"] [data-tug-stable="active"]'),
              };
            };
            return { A: read("A"), B: read("B") };
          })())`;
          try {
            const diag = await app.evalJS<string>(DIAG_JS);
            process.stderr.write(`\n[at0207] tugdeck state:\n${diag}\n`);
          } catch (probeErr) {
            process.stderr.write(`\n[at0207] diag probe failed: ${String(probeErr)}\n`);
          }
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0207] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
