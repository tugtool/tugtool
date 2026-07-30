/**
 * changeset-verb-store — the `changeset_claim` round trip ([D120]).
 *
 * A claim's success shows itself (the rows migrate on the next aggregate
 * recompute), so the state machine exists for the failures: a guard's refusal,
 * and the `_ok` reply that reports fewer claimed paths than were asked for.
 * Both used to land in silence, which is what made a dead claim read as a
 * button that never registered.
 *
 * Drives the real store through a fake `TugConnection`: the frame handler the
 * store registers is captured and invoked with encoded CONTROL payloads, so
 * these exercise `_onControl` itself rather than a stand-in.
 */

import { describe, test, expect, beforeEach } from "bun:test";

import { ChangesetVerbStore } from "../changeset-verb-store";

const ENTRY = "session:s1";
const PROJECT = "/proj";

interface Sent {
  action: string;
  body: Record<string, unknown>;
}

/** A fake connection that captures the CONTROL handler and every send. */
function harness(): {
  store: ChangesetVerbStore;
  sent: Sent[];
  reply: (body: Record<string, unknown>) => void;
} {
  let handler: ((payload: Uint8Array) => void) | null = null;
  const sent: Sent[] = [];
  const conn = {
    onFrame: (_feed: number, cb: (payload: Uint8Array) => void) => {
      handler = cb;
      return () => {};
    },
    sendControlFrame: (action: string, body: Record<string, unknown>) => {
      sent.push({ action, body });
    },
  } as never;
  const store = new ChangesetVerbStore(conn);
  const reply = (body: Record<string, unknown>): void => {
    if (handler === null) throw new Error("no CONTROL handler registered");
    handler(new TextEncoder().encode(JSON.stringify(body)));
  };
  return { store, sent, reply };
}

let h: ReturnType<typeof harness>;
beforeEach(() => {
  h = harness();
});

describe("changeset claim round trip", () => {
  test("claim sends the verb and holds the entry pending", () => {
    h.store.claim(ENTRY, PROJECT, "s1", ["a.rs", "b.rs"]);

    expect(h.sent).toEqual([
      {
        action: "changeset_claim",
        body: { project_dir: PROJECT, session_id: "s1", files: ["a.rs", "b.rs"] },
      },
    ]);
    expect(h.store.claimState(ENTRY)).toEqual({
      phase: "pending",
      error: null,
      claimed: null,
      requested: 2,
    });
  });

  test("an empty path list is not a round trip", () => {
    h.store.claim(ENTRY, PROJECT, "s1", []);
    expect(h.sent).toEqual([]);
    expect(h.store.claimState(ENTRY).phase).toBe("idle");
  });

  test("claiming every requested path settles done with its receipt", () => {
    h.store.claim(ENTRY, PROJECT, "s1", ["a.rs", "b.rs"]);
    h.reply({ action: "changeset_claim_ok", project_dir: PROJECT, claimed: 2 });

    expect(h.store.claimState(ENTRY)).toEqual({
      phase: "done",
      error: null,
      claimed: 2,
      requested: 2,
    });
  });

  test("an _ok that claimed nothing is an error, not a success", () => {
    // The server counts writes and only warns on a failed one, so `claimed: 0`
    // is a claim that did nothing while reporting ok — the silent-failure hole.
    h.store.claim(ENTRY, PROJECT, "s1", ["a.rs", "b.rs"]);
    h.reply({ action: "changeset_claim_ok", project_dir: PROJECT, claimed: 0 });

    const state = h.store.claimState(ENTRY);
    expect(state.phase).toBe("error");
    expect(state.claimed).toBe(0);
    expect(state.error).toContain("refused all 2 files");
  });

  test("a partial claim is an error carrying both counts", () => {
    h.store.claim(ENTRY, PROJECT, "s1", ["a.rs", "b.rs", "c.rs"]);
    h.reply({ action: "changeset_claim_ok", project_dir: PROJECT, claimed: 2 });

    const state = h.store.claimState(ENTRY);
    expect(state.phase).toBe("error");
    expect(state.error).toBe(
      "Only 2 of 3 files were claimed; the ledger refused the rest.",
    );
  });

  test("a guard refusal surfaces its detail", () => {
    h.store.claim(ENTRY, PROJECT, "s1", ["a.rs"]);
    h.reply({
      action: "changeset_claim_err",
      project_dir: PROJECT,
      detail: "not an open project",
    });

    expect(h.store.claimState(ENTRY)).toEqual({
      phase: "error",
      error: "not an open project",
      claimed: 0,
      requested: 1,
    });
  });

  test("a detail-less refusal still reads as a failure", () => {
    h.store.claim(ENTRY, PROJECT, "s1", ["a.rs"]);
    h.reply({ action: "changeset_claim_err", project_dir: PROJECT });
    expect(h.store.claimState(ENTRY).error).toBe("claim failed");
  });

  test("a reply for a project with nothing in flight is ignored", () => {
    h.reply({ action: "changeset_claim_ok", project_dir: "/other", claimed: 1 });
    expect(h.store.claimState(ENTRY).phase).toBe("idle");
  });

  test("a second reply after the first settles does not re-settle the entry", () => {
    // The in-flight correlation is consumed by the first reply, so a duplicate
    // broadcast cannot overwrite a settled round trip.
    h.store.claim(ENTRY, PROJECT, "s1", ["a.rs"]);
    h.reply({ action: "changeset_claim_ok", project_dir: PROJECT, claimed: 1 });
    h.reply({ action: "changeset_claim_ok", project_dir: PROJECT, claimed: 0 });

    expect(h.store.claimState(ENTRY).phase).toBe("done");
  });

  test("a retry clears the prior error before the next reply", () => {
    h.store.claim(ENTRY, PROJECT, "s1", ["a.rs"]);
    h.reply({ action: "changeset_claim_err", project_dir: PROJECT, detail: "no ledger" });
    expect(h.store.claimState(ENTRY).phase).toBe("error");

    h.store.claim(ENTRY, PROJECT, "s1", ["a.rs"]);
    expect(h.store.claimState(ENTRY)).toMatchObject({ phase: "pending", error: null });
  });

  test("clearClaim returns the entry to idle", () => {
    h.store.claim(ENTRY, PROJECT, "s1", ["a.rs"]);
    h.reply({ action: "changeset_claim_err", project_dir: PROJECT, detail: "no ledger" });
    h.store.clearClaim(ENTRY);
    expect(h.store.claimState(ENTRY)).toEqual({
      phase: "idle",
      error: null,
      claimed: null,
      requested: null,
    });
  });

  test("subscribers are notified on send and on settle", () => {
    let ticks = 0;
    h.store.subscribe(() => {
      ticks += 1;
    });
    h.store.claim(ENTRY, PROJECT, "s1", ["a.rs"]);
    expect(ticks).toBe(1);
    h.reply({ action: "changeset_claim_ok", project_dir: PROJECT, claimed: 1 });
    expect(ticks).toBe(2);
  });

  test("a claim round trip leaves commit state untouched", () => {
    h.store.claim(ENTRY, PROJECT, "s1", ["a.rs"]);
    h.reply({ action: "changeset_claim_err", project_dir: PROJECT, detail: "no ledger" });
    expect(h.store.commitState(ENTRY).phase).toBe("idle");
  });
});
