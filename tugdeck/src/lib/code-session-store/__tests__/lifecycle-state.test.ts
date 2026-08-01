/**
 * Pure-logic tests for `lifecycle-state.ts` — the session-card
 * lifecycle state-to-zone matrix encoded as `deriveLifecycleSnapshot`.
 *
 * Coverage:
 *  - `state` — one assertion per distinct matrix row (the ten
 *    lifecycle states), plus the precedence between overlapping
 *    signals (errored / replaying / interruptInFlight).
 *  - `submitButtonMode` — the matrix's Z5 column for every state, plus
 *    the TRANSPORT_DOWN (`reconnecting`) overlay effect.
 *  - `overlays` — `transport_down` and `pending_ask`, including that
 *    `pending_ask` leaves the state and Z5 column untouched.
 *  - [DT09] — `deriveLifecycleSnapshot` returns the previous reference
 *    when no matrix-relevant signal moved, a fresh one when any did.
 *  - `lifecycleSnapshotsEqual` — the structural-equality primitive.
 *
 * The derivation reads a narrow `LifecycleStoreSignals` shape (the
 * matrix-relevant subset of `CodeSessionSnapshot`); these tests supply
 * literals of that shape, the same data-in/data-out pattern
 * `end-state.test.ts` uses for `deriveContextWindows`. The hook that
 * wraps the derivation (`use-lifecycle-state.ts`) is React glue, left
 * to integration coverage per the no-fake-DOM rule.
 */

import { describe, expect, it } from "bun:test";

import {
  deriveLifecycleSnapshot,
  lifecycleSnapshotsEqual,
  type LifecycleStoreSignals,
  type SessionLifecycleSnapshot,
} from "../lifecycle-state";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** `LifecycleStoreSignals` with sane defaults (a never-used IDLE card
 *  on a healthy wire); override the fields a given row exercises. */
function signals(
  overrides: Partial<LifecycleStoreSignals> = {},
): LifecycleStoreSignals {
  return {
    phase: "idle",
    transportState: "online",
    interruptInFlight: false,
    transcript: [],
    pendingAsk: null,
    ...overrides,
  };
}

/** A transcript with one committed turn — splits COMPLETE from IDLE. */
const ONE_TURN: ReadonlyArray<unknown> = [{}];

function derive(
  s: LifecycleStoreSignals,
  previous?: SessionLifecycleSnapshot,
): SessionLifecycleSnapshot {
  return deriveLifecycleSnapshot(s, previous);
}

// ---------------------------------------------------------------------------
// state — one per matrix row
// ---------------------------------------------------------------------------

describe("deriveLifecycleSnapshot — lifecycle state per matrix row", () => {
  it("IDLE — idle phase, no committed turn", () => {
    expect(derive(signals({ phase: "idle" })).state).toBe("idle");
  });

  it("COMPLETE — idle phase with a committed turn", () => {
    expect(
      derive(signals({ phase: "idle", transcript: ONE_TURN })).state,
    ).toBe("complete");
  });

  it("SUBMITTING", () => {
    expect(derive(signals({ phase: "submitting" })).state).toBe("submitting");
  });

  it("AWAITING_FIRST_TOKEN", () => {
    expect(
      derive(signals({ phase: "awaiting_first_token" })).state,
    ).toBe("awaiting_first_token");
  });

  it("STREAMING", () => {
    expect(derive(signals({ phase: "streaming" })).state).toBe("streaming");
  });

  it("TOOL_WORK", () => {
    expect(derive(signals({ phase: "tool_work" })).state).toBe("tool_work");
  });

  it("AWAITING_USER — awaiting_approval phase", () => {
    expect(
      derive(signals({ phase: "awaiting_approval" })).state,
    ).toBe("awaiting_user");
  });

  it("INTERRUPTING — interruptInFlight over an in-flight phase", () => {
    expect(
      derive(signals({ phase: "streaming", interruptInFlight: true })).state,
    ).toBe("interrupting");
  });

  it("REPLAYING", () => {
    expect(derive(signals({ phase: "replaying" })).state).toBe("replaying");
  });

  it("ERRORED", () => {
    expect(derive(signals({ phase: "errored" })).state).toBe("errored");
  });
});

// ---------------------------------------------------------------------------
// state — precedence between overlapping signals
// ---------------------------------------------------------------------------

describe("deriveLifecycleSnapshot — state precedence", () => {
  it("ERRORED outranks an in-flight interrupt", () => {
    expect(
      derive(signals({ phase: "errored", interruptInFlight: true })).state,
    ).toBe("errored");
  });

  it("REPLAYING outranks an in-flight interrupt", () => {
    expect(
      derive(signals({ phase: "replaying", interruptInFlight: true })).state,
    ).toBe("replaying");
  });

  it("INTERRUPTING outranks AWAITING_USER (user is stopping the turn)", () => {
    expect(
      derive(
        signals({ phase: "awaiting_approval", interruptInFlight: true }),
      ).state,
    ).toBe("interrupting");
  });

  it("a committed transcript does not promote a non-idle phase to COMPLETE", () => {
    expect(
      derive(signals({ phase: "streaming", transcript: ONE_TURN })).state,
    ).toBe("streaming");
  });
});

// ---------------------------------------------------------------------------
// submitButtonMode — the Z5 column
// ---------------------------------------------------------------------------

describe("deriveLifecycleSnapshot — submitButtonMode (Z5 column)", () => {
  it("IDLE / COMPLETE / ERRORED → enabled Submit", () => {
    for (const s of [
      signals({ phase: "idle" }),
      signals({ phase: "idle", transcript: ONE_TURN }),
      signals({ phase: "errored" }),
    ]) {
      expect(derive(s).submitButtonMode).toEqual({
        kind: "submit",
        disabled: false,
      });
    }
  });

  it("SUBMITTING / AWAITING_FIRST_TOKEN / STREAMING / TOOL_WORK → Stop", () => {
    for (const phase of [
      "submitting",
      "awaiting_first_token",
      "streaming",
      "tool_work",
    ] as const) {
      expect(derive(signals({ phase })).submitButtonMode).toEqual({
        kind: "stop",
      });
    }
  });

  it("AWAITING_USER → awaiting_user (disabled)", () => {
    expect(
      derive(signals({ phase: "awaiting_approval" })).submitButtonMode,
    ).toEqual({ kind: "awaiting_user" });
  });

  it("INTERRUPTING → stopping (disabled)", () => {
    expect(
      derive(signals({ phase: "streaming", interruptInFlight: true }))
        .submitButtonMode,
    ).toEqual({ kind: "stopping" });
  });

  it("REPLAYING → restoring (disabled)", () => {
    expect(
      derive(signals({ phase: "replaying" })).submitButtonMode,
    ).toEqual({ kind: "restoring" });
  });

  it("TRANSPORT_DOWN overlay → reconnecting, overriding the base state", () => {
    // The wire is unusable — neither submit nor stop can reach it —
    // so `reconnecting` overrides whatever the base state would show.
    for (const transportState of ["offline", "restoring"] as const) {
      expect(
        derive(signals({ phase: "streaming", transportState }))
          .submitButtonMode,
      ).toEqual({ kind: "reconnecting" });
      expect(
        derive(signals({ phase: "idle", transportState })).submitButtonMode,
      ).toEqual({ kind: "reconnecting" });
    }
  });

});

// ---------------------------------------------------------------------------
// overlays
// ---------------------------------------------------------------------------

describe("deriveLifecycleSnapshot — overlays", () => {
  it("no overlays on a healthy idle card", () => {
    expect(derive(signals()).overlays.size).toBe(0);
  });

  it("transport_down for offline and restoring", () => {
    for (const transportState of ["offline", "restoring"] as const) {
      const { overlays } = derive(signals({ transportState }));
      expect(overlays.has("transport_down")).toBe(true);
      expect(overlays.size).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// [DT09] — reference stability
// ---------------------------------------------------------------------------

describe("deriveLifecycleSnapshot — [DT09] reference stability", () => {
  it("returns the previous reference when no matrix-relevant signal moved", () => {
    const first = derive(signals({ phase: "streaming" }));
    // A streaming `assistant_delta` mutates content but not the
    // matrix-relevant signals — modelled here as a second call with an
    // equal-but-distinct signals object (a fresh `transcript` array).
    const second = derive(signals({ phase: "streaming", transcript: [] }), first);
    expect(second).toBe(first);
  });

  it("returns a fresh reference when a matrix-relevant signal changes", () => {
    const first = derive(signals({ phase: "streaming" }));
    const afterPhase = derive(signals({ phase: "idle" }), first);
    expect(afterPhase).not.toBe(first);
    expect(afterPhase.state).toBe("idle");
  });

  it("a new overlay breaks reference stability", () => {
    const first = derive(signals({ phase: "streaming" }));
    const afterTransport = derive(
      signals({ phase: "streaming", transportState: "offline" }),
      first,
    );
    expect(afterTransport).not.toBe(first);
  });

  it("omitting `previous` always yields a fresh reference", () => {
    const a = derive(signals({ phase: "streaming" }));
    const b = derive(signals({ phase: "streaming" }));
    expect(b).not.toBe(a);
    expect(lifecycleSnapshotsEqual(a, b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// lifecycleSnapshotsEqual
// ---------------------------------------------------------------------------

describe("lifecycleSnapshotsEqual", () => {
  it("equal across distinct objects with the same matrix row", () => {
    expect(
      lifecycleSnapshotsEqual(
        derive(signals({ phase: "streaming" })),
        derive(signals({ phase: "streaming" })),
      ),
    ).toBe(true);
  });

  it("unequal on a different state", () => {
    expect(
      lifecycleSnapshotsEqual(
        derive(signals({ phase: "streaming" })),
        derive(signals({ phase: "tool_work" })),
      ),
    ).toBe(false);
  });

  it("unequal on a different overlay set", () => {
    expect(
      lifecycleSnapshotsEqual(
        derive(signals({ phase: "streaming" })),
        derive(signals({ phase: "streaming", transportState: "offline" })),
      ),
    ).toBe(false);
  });
});

describe("the pending_ask overlay", () => {
  const ASK = {
    requestId: "req-1",
    title: "3 of 20 app-tests will take the screen",
    description: null,
    options: [{ value: "run-all", label: "Run all" }],
  };

  it("rides alongside an idle session without changing its state", () => {
    const snap = derive(signals({ pendingAsk: ASK }));
    expect(snap.overlays.has("pending_ask")).toBe(true);
    expect(snap.state).toBe("idle");
  });

  // The reason this is an overlay and not a phase. Routing an ask through
  // `awaiting_approval` would flip Z5 to the disabled `awaiting_user` button,
  // killing the composer on a session that has no turn in flight at all.
  it("leaves the submit button alone", () => {
    expect(derive(signals({ pendingAsk: ASK })).submitButtonMode).toEqual({
      kind: "submit",
      disabled: false,
    });
  });

  it("does not disturb a live turn's state or button", () => {
    const snap = derive(signals({ phase: "streaming", pendingAsk: ASK }));
    expect(snap.state).toBe("streaming");
    expect(snap.submitButtonMode).toEqual({ kind: "stop" });
    expect(snap.overlays.has("pending_ask")).toBe(true);
  });

  it("coexists with transport_down", () => {
    const snap = derive(signals({ pendingAsk: ASK, transportState: "offline" }));
    expect(snap.overlays.has("pending_ask")).toBe(true);
    expect(snap.overlays.has("transport_down")).toBe(true);
  });

  it("is absent when nothing is pending", () => {
    expect(derive(signals()).overlays.has("pending_ask")).toBe(false);
  });

  it("makes two otherwise-identical rows unequal", () => {
    expect(
      lifecycleSnapshotsEqual(derive(signals()), derive(signals({ pendingAsk: ASK }))),
    ).toBe(false);
  });
});
