/**
 * Pin what a Gazette ref chip resolves to — the command payload, not the
 * pixels. Each kind must reach an EXISTING verb: a path goes out as
 * `open-file`, a sha as `open-diff`'s commit descriptor, a session as a raise
 * of the card bound to it. A ref with nowhere to go is inert and says why.
 */

import { describe, expect, it } from "bun:test";

import { gazetteRefIntent } from "@/lib/gazette-ref-action";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import type { GazetteRef } from "@/protocol";

/** A deck holding one session card, for the session-ref cases. */
const deck = (sessionId: string, cardId: string) => (id: string) =>
  id === sessionId ? cardId : null;

const noDeck = (): string | null => null;

describe("gazetteRefIntent", () => {
  it("a file ref opens the path through the app's one open verb", () => {
    const ref: GazetteRef = { kind: "file", target: "tugdeck/src/x.css" };
    expect(gazetteRefIntent(ref, noDeck)).toEqual({
      kind: "dispatch",
      action: TUG_ACTIONS.OPEN_FILE,
      payload: { path: "tugdeck/src/x.css" },
    });
  });

  it("plan and brief are files — the kind says what, not how", () => {
    for (const kind of ["plan", "brief"] as const) {
      const intent = gazetteRefIntent(
        { kind, target: "roadmap/gazette-plan.md" },
        noDeck,
      );
      expect(intent).toEqual({
        kind: "dispatch",
        action: TUG_ACTIONS.OPEN_FILE,
        payload: { path: "roadmap/gazette-plan.md" },
      });
    }
  });

  it("a commit ref opens the diff's commit flavor, unrooted", () => {
    const intent = gazetteRefIntent(
      { kind: "commit", target: "a597790b0" },
      noDeck,
    );
    expect(intent).toEqual({
      kind: "dispatch",
      action: TUG_ACTIONS.OPEN_DIFF,
      // No `root`: the diff store falls back to the card's project dir, so the
      // descriptor must NOT pin one here.
      payload: { descriptor: { kind: "commit", sha: "a597790b0" } },
    });
  });

  it("a session ref raises the card bound to that session", () => {
    const intent = gazetteRefIntent(
      { kind: "session", target: "sess-a" },
      deck("sess-a", "card-7"),
    );
    expect(intent).toEqual({ kind: "raise-card", cardId: "card-7" });
  });

  it("a session with no card open is inert and says so", () => {
    const intent = gazetteRefIntent(
      { kind: "session", target: "sess-gone" },
      deck("sess-a", "card-7"),
    );
    expect(intent.kind).toBe("inert");
    if (intent.kind === "inert") {
      expect(intent.reason.length).toBeGreaterThan(0);
    }
  });

  it("an empty target is inert whatever its kind claims", () => {
    for (const kind of ["file", "commit", "session", "plan", "brief"] as const) {
      expect(gazetteRefIntent({ kind, target: "" }, noDeck).kind).toBe("inert");
    }
  });
});
