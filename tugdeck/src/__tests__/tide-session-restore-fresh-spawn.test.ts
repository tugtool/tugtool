/**
 * `tide-session-restore` — zero-turn fresh-spawn restore hold.
 *
 * On a cold relaunch, `restoreTideSessions` resolves each ledger
 * binding by `turn_count`: `> 0` resumes the JSONL, `=== 0` fires a
 * fresh `spawn_session(mode=new)` under the same project. The fresh
 * path mints a new session — there is nothing to "restore" — but the
 * card is still mid-bind: until `spawn_session_ok` lands, an unbound
 * tide card with no `tideRestoreRegistry` entry falls straight through
 * to the project picker, flashing its `TugSheet` for the round-trip.
 *
 * These tests pin the production wire that closes that window: the
 * zero-turn branch arms a `tideRestoreRegistry` hold (so
 * `TideCardContent` shows the quiet `TideRestoring` backdrop), and
 * `notifySpawnRejected` drops the hold when tugcast rejects the spawn
 * so the card can fall through to the picker + its error banner.
 *
 * The bus + restore module are real; only the transport
 * (`connection`) is a no-op stub.
 */

import { describe, it, expect, afterEach } from "bun:test";

import type { TugConnection } from "@/connection";
import {
  restoreTideSessions,
  notifySpawnRejected,
  tideRestoreRegistry,
} from "@/lib/tide-session-restore";
import { publishListCardBindingsOk } from "@/lib/tide-session-ledger-events";
import type { CardBinding } from "@/protocol";

// The restore pass only reaches the transport for `send` (the
// `spawn_session` frame), `onFrame` (the SESSION_STATE subscriber),
// and `sendControlFrame` (the `list_card_bindings` request). All three
// are no-ops here — the test drives the response directly via the bus.
const fakeConnection = {
  send: (_feedId: number, _payload: Uint8Array, _flags?: number) => {},
  onFrame: (_feedId: number, _cb: (payload: Uint8Array) => void) => () => {},
  sendControlFrame: (_action: string, _payload: unknown) => {},
} as unknown as TugConnection;

interface FakeCard {
  id: string;
  componentId: string;
}

function createFakeDeck(cards: FakeCard[]) {
  const snapshot = { cards };
  return {
    subscribe(_cb: () => void): () => void {
      return () => {};
    },
    getSnapshot(): { cards: FakeCard[] } {
      return snapshot;
    },
  };
}

function zeroTurnBinding(cardId: string, projectDir: string): CardBinding {
  return {
    card_id: cardId,
    session_id: `sess-${cardId}`,
    project_dir: projectDir,
    state: "closed",
    turn_count: 0,
  };
}

function zeroTurnLiveBinding(
  cardId: string,
  projectDir: string,
): CardBinding {
  return {
    card_id: cardId,
    session_id: `sess-${cardId}`,
    project_dir: projectDir,
    state: "live",
    turn_count: 0,
    is_alive: true,
  };
}

const TOUCHED_CARD_IDS = new Set<string>();

function runRestore(cardId: string, projectDir: string): void {
  TOUCHED_CARD_IDS.add(cardId);
  const deck = createFakeDeck([{ id: cardId, componentId: "tide" }]);
  restoreTideSessions(
    deck as unknown as Parameters<typeof restoreTideSessions>[0],
    fakeConnection,
  );
  publishListCardBindingsOk({ bindings: [zeroTurnBinding(cardId, projectDir)] });
}

afterEach(() => {
  // Drop registry entries (and their armed timeout timers) so a
  // zero-turn hold from one test cannot leak into the next.
  for (const id of TOUCHED_CARD_IDS) tideRestoreRegistry._clear(id);
  TOUCHED_CARD_IDS.clear();
});

describe("tide-session-restore — zero-turn fresh-spawn hold", () => {
  it("arms a restore-registry hold for a zero-turn binding", () => {
    const cardId = "tide-fresh-card-1";
    const projectDir = "/work/fresh-spawn";
    expect(tideRestoreRegistry.has(cardId)).toBe(false);

    runRestore(cardId, projectDir);

    // Without the hold the card would fall through to the picker the
    // instant the pass gate settles; the entry keeps it on the quiet
    // `TideRestoring` backdrop until the bind lands.
    expect(tideRestoreRegistry.has(cardId)).toBe(true);
    expect(tideRestoreRegistry.get(cardId)?.projectDir).toBe(projectDir);
  });

  it("notifySpawnRejected drops the hold so the picker can present", () => {
    const cardId = "tide-fresh-card-2";
    runRestore(cardId, "/work/missing-dir");
    expect(tideRestoreRegistry.has(cardId)).toBe(true);

    // tugcast rejected the spawn (e.g. the project directory is gone).
    notifySpawnRejected(cardId);

    expect(tideRestoreRegistry.has(cardId)).toBe(false);
  });

  it("notifySpawnRejected is a no-op for a card with no hold", () => {
    expect(() => notifySpawnRejected("tide-card-never-restored")).not.toThrow();
  });

  it("zero-turn binding with is_alive=true takes the resume path (in-flight first turn)", () => {
    // This is the in-flight-first-turn case: the user submitted, claude
    // is mid-response or blocked on a permission/question
    // control_request, the live tugcode subprocess holds runtime state,
    // but no turn has committed to JSONL yet. `turn_count` is zero but
    // `is_alive` is true; the gate must resume (not fresh-spawn) so the
    // card rejoins the live session.
    const cardId = "tide-inflight-card";
    const projectDir = "/work/inflight";
    TOUCHED_CARD_IDS.add(cardId);

    const deck = createFakeDeck([{ id: cardId, componentId: "tide" }]);
    restoreTideSessions(
      deck as unknown as Parameters<typeof restoreTideSessions>[0],
      fakeConnection,
    );
    publishListCardBindingsOk({
      bindings: [zeroTurnLiveBinding(cardId, projectDir)],
    });

    // Resume path arms the same hold as turn_count > 0; without the
    // hold the card would fall through to the picker before the bind
    // ack lands.
    expect(tideRestoreRegistry.has(cardId)).toBe(true);
    expect(tideRestoreRegistry.get(cardId)?.tugSessionId).toBe(
      `sess-${cardId}`,
    );
  });
});
