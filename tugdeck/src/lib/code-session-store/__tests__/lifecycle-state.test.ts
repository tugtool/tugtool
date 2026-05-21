/**
 * Pure-logic tests for `lifecycle-state.ts` — the tide-card
 * lifecycle state-to-zone matrix encoded as `deriveLifecycleSnapshot`.
 *
 * Coverage:
 *  - `state` — one assertion per distinct matrix row (the ten
 *    lifecycle states), plus the precedence between overlapping
 *    signals (errored / replaying / interruptInFlight).
 *  - `submitButtonMode` — the matrix's Z5 column for every state, plus
 *    the TRANSPORT_DOWN (`reconnecting`) overlay effect. QUEUED_NEXT_TURN
 *    no longer bears on Z5 — a mid-turn submit queues instead of
 *    changing the primary button.
 *  - `overlays` — `transport_down` / `queued_next`.
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
  type TideLifecycleSnapshot,
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
    queuedSends: [],
    transcript: [],
    ...overrides,
  };
}

/** A transcript with one committed turn — splits COMPLETE from IDLE. */
const ONE_TURN: ReadonlyArray<unknown> = [{}];

function derive(
  s: LifecycleStoreSignals,
  previous?: TideLifecycleSnapshot,
): TideLifecycleSnapshot {
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

  it("QUEUED_NEXT_TURN does not change the in-flight Stop button", () => {
    // A mid-turn submit queues rather than overriding Z5 — the primary
    // button stays Stop regardless of how many sends are queued.
    expect(
      derive(signals({ phase: "streaming", queuedSends: [{}] }))
        .submitButtonMode,
    ).toEqual({ kind: "stop" });
  });

  it("QUEUED_NEXT_TURN does not change the idle Submit button", () => {
    expect(
      derive(signals({ phase: "idle", queuedSends: [{}, {}] }))
        .submitButtonMode,
    ).toEqual({ kind: "submit", disabled: false });
  });

  it("TRANSPORT_DOWN outranks QUEUED_NEXT_TURN", () => {
    expect(
      derive(
        signals({
          phase: "streaming",
          queuedSends: [{}],
          transportState: "offline",
        }),
      ).submitButtonMode,
    ).toEqual({ kind: "reconnecting" });
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
    }
  });

  it("queued_next when the queue is non-empty", () => {
    expect(
      derive(signals({ queuedSends: [{}] })).overlays.has("queued_next"),
    ).toBe(true);
    expect(
      derive(signals({ queuedSends: [] })).overlays.has("queued_next"),
    ).toBe(false);
  });

  it("both overlays coexist", () => {
    const { overlays } = derive(
      signals({ transportState: "offline", queuedSends: [{}] }),
    );
    expect([...overlays].sort()).toEqual(["queued_next", "transport_down"]);
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
    const afterQueue = derive(
      signals({ phase: "streaming", queuedSends: [{}] }),
      first,
    );
    expect(afterQueue).not.toBe(first);
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
        derive(signals({ phase: "streaming", queuedSends: [{}] })),
      ),
    ).toBe(false);
  });

  it("equal submitButtonMode across queue depth, but unequal snapshots", () => {
    // A queued send no longer changes Z5 — idle with and without a
    // queue resolves to the same `submitButtonMode`. The snapshots
    // still differ, on the `queued_next` overlay.
    const plain = derive(signals({ phase: "idle" }));
    const queued = derive(signals({ phase: "idle", queuedSends: [{}] }));
    expect(queued.submitButtonMode).toEqual(plain.submitButtonMode);
    expect(lifecycleSnapshotsEqual(plain, queued)).toBe(false);
  });
});
