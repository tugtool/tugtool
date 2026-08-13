/**
 * The session verdict adapter: which spelling is asked, and what the answer
 * means.
 *
 * Two claims, and both are corrections of the obvious implementation:
 *
 *  - The ledger has no `project/callsign` query key. It resolves a full uuid,
 *    a unique 8-char prefix, or a bare callsign matched against `tag` — a pair
 *    sent whole matches none of them and comes back unknown forever. So the
 *    pair is split and the CALLSIGN half is what is asked.
 *  - The project half is then evidence rather than decoration: a callsign that
 *    resolves under a different project is REFUTED, not confirmed. Without
 *    that check the prefix would add characters and nothing else, and the
 *    bare-callsign shape the detector rejects would be just as good.
 */

import { beforeEach, describe, expect, test } from "bun:test";

import { resolveSessionRef } from "@/lib/annotator/session-resolution";
import { sessionCitationStore } from "@/lib/session-citation-store";
import { normalizeSessionRow, type SessionRow } from "@/protocol";

const FULL = "f6e43925-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

function row(over: Partial<SessionRow> = {}): SessionRow {
  return normalizeSessionRow({
    session_id: FULL,
    workspace_key: "ws-1",
    project_dir: "/Users/dev/src/tugtool",
    created_at: 1,
    last_used_at: 2,
    turn_count: 3,
    last_user_prompt: null,
    state: "closed",
    card_id: null,
    name: null,
    tag: "kind-floor",
    ...over,
  } as Parameters<typeof normalizeSessionRow>[0]);
}

beforeEach(() => {
  sessionCitationStore.forgetAll();
});

describe("the verdict for a scanned candidate", () => {
  test("an unasked candidate is pending, and the ask is recorded", () => {
    // Pending is what reserves the run — the pass marks nothing and comes
    // back when the answer lands.
    expect(resolveSessionRef("tugtool/kind-floor")).toEqual({
      state: "pending",
    });
    // Asked once by the resolver itself, so nothing else has to remember to.
    expect(sessionCitationStore.getAnswer("kind-floor")).toEqual({
      status: "pending",
    });
  });

  test("a pair resolves through its CALLSIGN half, never the whole string", () => {
    sessionCitationStore.applyResolved({
      found: [{ queried: "kind-floor", session: row() }],
      unknown: [],
    });
    expect(resolveSessionRef("tugtool/kind-floor")).toEqual({
      state: "confirmed",
      // The FULL id, whatever the prose spelled — what a chip and a raise
      // both need.
      sessionId: FULL,
    });
  });

  test("a project half that disagrees with the answer refutes it", () => {
    // The same callsign, resolving under a different repository. Nothing is
    // marked: this sentence is not talking about that session.
    sessionCitationStore.applyResolved({
      found: [
        { queried: "kind-floor", session: row({ project_dir: "/src/other" }) },
      ],
      unknown: [],
    });
    expect(resolveSessionRef("tugtool/kind-floor")).toEqual({
      state: "refuted",
    });
  });

  test("a project half is compared by basename, not by the whole path", () => {
    // What the prose can spell is the repo's leaf name; the ledger holds an
    // absolute path.
    sessionCitationStore.applyResolved({
      found: [
        {
          queried: "kind-floor",
          session: row({ project_dir: "/Users/dev/src/tugtool/" }),
        },
      ],
      unknown: [],
    });
    expect(resolveSessionRef("tugtool/kind-floor")).toEqual({
      state: "confirmed",
      sessionId: FULL,
    });
  });

  test("a session the ledger does not hold is refuted", () => {
    sessionCitationStore.applyResolved({ found: [], unknown: ["kind-floor"] });
    expect(resolveSessionRef("tugtool/kind-floor")).toEqual({
      state: "refuted",
    });
  });

  test("a bare uuid has no project half to check, and needs none", () => {
    sessionCitationStore.applyResolved({
      found: [{ queried: FULL, session: row({ project_dir: "/src/other" }) }],
      unknown: [],
    });
    expect(resolveSessionRef(FULL)).toEqual({
      state: "confirmed",
      sessionId: FULL,
    });
  });
});
