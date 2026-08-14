/**
 * plan-review-controller.test.ts — the borrow machine.
 *
 * The beats that matter are all orderings, so the fakes here are a session
 * store whose phase the test drives by hand and a metadata store that records
 * what the chip was told. Nothing renders; the controller is pure over two
 * subscriptions, which is what makes park → arm → run → release assertable at
 * all.
 *
 * The one that would silently ruin the feature is `armed does not release on
 * the idle it was submitted from`: at the instant `send()` returns, the phase
 * has not moved, so a machine that released on "next idle" would give the
 * model back before the review ever started and run the whole thing on the
 * model it just returned.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { CapabilityModel } from "@/lib/session-metadata-store";
import type { CodeSessionPhase } from "@/lib/code-session-store/types";
import { setTugbankClient } from "@/lib/tugbank-singleton";
import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";
import {
  PlanReviewController,
  REVIEW_PLAN_COMMAND,
  evaluatePlanReviewGate,
  readLastReviewedPlan,
  resolvePlanReviewTarget,
  sessionModelKnown,
  type PlanReviewNotice,
} from "@/lib/plan-review-controller";
import { PLAN_REVIEW_LAST_DOMAIN } from "@/lib/model-domains";
import {
  planReviewRequestStore,
  _resetPlanReviewRequestStoreForTest,
} from "@/lib/plan-review-request-store";

/**
 * An account whose `default` row names no concrete model of its own, so a
 * session on `sonnet` reads as `sonnet` and `opus` is a genuinely different
 * row. The collapsing case gets its own fixture below.
 */
const ROWS: CapabilityModel[] = [
  { value: "default", displayName: "Default (recommended)", description: "Chosen for you" },
  { value: "opus", displayName: "Opus 5", description: "Opus 5" },
  { value: "sonnet", displayName: "Sonnet 5", description: "Sonnet 5" },
];

/** An account whose `default` IS Opus — the [P03] no-op case. */
const OPUS_DEFAULT: CapabilityModel[] = [
  { value: "default", displayName: "Default (recommended)", description: "Opus 5" },
  { value: "opus", displayName: "Opus 5", description: "Opus 5" },
];

const PLAN = "/abs/roadmap/plan.md";

/**
 * Every controller a test builds, disposed in `afterEach`. The request store is
 * a module singleton, so a controller left subscribed by a failing test would
 * take the next test's request out from under it and turn one failure into a
 * cascade.
 */
const live: PlanReviewController[] = [];

/** The most recent notice, or undefined — `Array.at` is past this lib target. */
function lastNotice(h: Harness): PlanReviewNotice | undefined {
  return h.notices[h.notices.length - 1];
}

interface Harness {
  controller: PlanReviewController;
  /** Selectors handed to `model_change`, in order. */
  sent: string[];
  /** Turn submissions: `[text, atoms]`. */
  turns: Array<{ text: string; atoms: unknown[] }>;
  notices: PlanReviewNotice[];
  /** Move the session's turn phase and notify. */
  setPhase: (phase: CodeSessionPhase) => void;
  /** Put a user's queued send in the way. */
  queue: (n: number) => void;
  /** Drop or restore the wire. `canSubmit` is phase AND transport ([D01]). */
  setOnline: (online: boolean) => void;
  latch: (planPath?: string) => void;
}

function harness(
  options: {
    rows?: CapabilityModel[];
    model?: string | null;
    reviewSelector?: string;
    /** Whether `send()` moves the phase, as a real submission does. */
    sendStartsTurn?: boolean;
  } = {},
): Harness {
  const rows = options.rows ?? ROWS;
  const sent: string[] = [];
  const turns: Array<{ text: string; atoms: unknown[] }> = [];
  const notices: PlanReviewNotice[] = [];
  const sessionListeners = new Set<() => void>();

  let phase: CodeSessionPhase = "streaming";
  let online = true;
  let queuedSends: unknown[] = [];
  let model: string | null = options.model === undefined ? "sonnet" : options.model;

  const notifySession = (): void => {
    for (const listener of [...sessionListeners]) listener();
  };

  const codeSessionStore = {
    subscribe: (listener: () => void) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    getSnapshot: () => ({
      phase,
      canSubmit: (phase === "idle" || phase === "errored") && online,
      queuedSends,
    }),
    setModel: (selector: string) => {
      sent.push(selector);
      // The real store dispatches and notifies from inside `setModel`. That
      // re-entrancy is what caught the double submit: with the phase still
      // `parked` across the borrow, the borrow's own frame re-entered the
      // observer on a still-submittable session and sent the review twice.
      notifySession();
    },
    send: (text: string, atoms: unknown[]) => {
      turns.push({ text, atoms });
      if (options.sendStartsTurn !== false) {
        phase = "submitting";
        notifySession();
      }
    },
  };

  const sessionMetadataStore = {
    getSnapshot: () => ({ models: rows, model }),
    applyModel: (selector: string) => {
      model = selector;
    },
  };

  const controller = new PlanReviewController({
    cardId: "card-1",
    codeSessionStore: codeSessionStore as never,
    sessionMetadataStore: sessionMetadataStore as never,
    reviewSelector: () => options.reviewSelector ?? "opus",
  });
  controller.setNotifier((notice) => notices.push(notice));
  live.push(controller);

  return {
    controller,
    sent,
    turns,
    notices,
    setPhase: (next) => {
      phase = next;
      notifySession();
    },
    queue: (n) => {
      queuedSends = Array.from({ length: n }, (_, i) => i);
      notifySession();
    },
    setOnline: (next) => {
      online = next;
      notifySession();
    },
    latch: (planPath = PLAN) => planReviewRequestStore.latch("card-1", planPath),
  };
}

/**
 * What the fake tugbank recorded, so the last-reviewed write is assertable.
 * The submit path writes it optimistically into the cache and PUTs; there is
 * no server here, so the PUT is caught below.
 */
let written: { domain: string; key: string; value: string }[] = [];
let stored: Map<string, string>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  _resetPlanReviewRequestStoreForTest();
  written = [];
  stored = new Map();
  setTugbankClient({
    get: (domain: string, key: string) => {
      const value = stored.get(`${domain}/${key}`);
      return value === undefined ? undefined : { kind: "string", value };
    },
    setLocalValue: (domain: string, key: string, entry: { value: string }) => {
      stored.set(`${domain}/${key}`, entry.value);
      written.push({ domain, key, value: entry.value });
    },
  } as never);
  // The controller PUTs its last-reviewed path. There is no server in a unit
  // test and a relative URL has no origin to resolve against, so stand in for
  // the transport rather than let the machine under test depend on it.
  globalThis.fetch = (() =>
    Promise.resolve(new Response("{}"))) as unknown as typeof fetch;
});

afterEach(() => {
  for (const controller of live.splice(0)) controller.dispose();
  _resetPlanReviewRequestStoreForTest();
  setTugbankClient(null);
  globalThis.fetch = realFetch;
});

describe("evaluatePlanReviewGate", () => {
  test("an idle card with a known model may review", () => {
    expect(
      evaluatePlanReviewGate({ phase: { kind: "idle" }, sessionModelKnown: true }),
    ).toEqual({ ok: true });
  });

  test("a review already under way refuses, at every non-idle phase", () => {
    for (const phase of [
      { kind: "parked", planPath: PLAN },
      { kind: "armed", planPath: PLAN, borrowedFrom: null },
      { kind: "running", planPath: PLAN, borrowedFrom: "sonnet" },
    ] as const) {
      expect(evaluatePlanReviewGate({ phase, sessionModelKnown: true })).toEqual({
        ok: false,
        reason: "already-reviewing",
      });
    }
  });

  test("already-reviewing outranks an unknown model", () => {
    expect(
      evaluatePlanReviewGate({
        phase: { kind: "running", planPath: PLAN, borrowedFrom: null },
        sessionModelKnown: false,
      }),
    ).toEqual({ ok: false, reason: "already-reviewing" });
  });

  test("an unknown session model refuses", () => {
    expect(
      evaluatePlanReviewGate({ phase: { kind: "idle" }, sessionModelKnown: false }),
    ).toEqual({ ok: false, reason: "model-unknown" });
  });
});

describe("sessionModelKnown", () => {
  test("a live capability list is enough", () => {
    expect(sessionModelKnown({ models: ROWS, model: null })).toBe(true);
  });
  test("a replayed model id is enough", () => {
    expect(sessionModelKnown({ models: [], model: "sonnet" })).toBe(true);
  });
  test("neither is not", () => {
    expect(sessionModelKnown({ models: [], model: null })).toBe(false);
  });
});

describe("park and submit", () => {
  test("a request arriving mid-turn parks — it is not refused", () => {
    const h = harness();
    h.latch();
    expect(h.controller.getSnapshot()).toEqual({ kind: "parked", planPath: PLAN });
    expect(h.turns).toEqual([]);
    expect(h.notices.filter((n) => n.kind === "caution")).toEqual([]);
    h.controller.dispose();
  });

  test("the parked request submits when the devise turn settles", () => {
    const h = harness();
    h.latch();
    h.setPhase("idle");
    expect(h.turns.length).toBe(1);
    expect(h.controller.getSnapshot().kind).toBe("running");
    h.controller.dispose();
  });

  test("the submission is a command atom with the plan path as its tail", () => {
    const h = harness();
    h.latch();
    h.setPhase("idle");
    const [turn] = h.turns;
    // Never a literal "/tugplug:plan-review …" — the command lives in the
    // atom, and `submission.text` carries only the placeholder plus the tail.
    expect(turn.text).toBe(`${TUG_ATOM_CHAR} ${PLAN}`);
    expect(turn.atoms).toEqual([
      {
        kind: "atom",
        type: "command",
        label: REVIEW_PLAN_COMMAND,
        value: REVIEW_PLAN_COMMAND,
      },
    ]);
    h.controller.dispose();
  });

  test("the borrow's own frame does not submit the review a second time", () => {
    const h = harness();
    h.latch();
    h.setPhase("idle");
    expect(h.turns.length).toBe(1);
    h.controller.dispose();
  });

  test("a request landing after the turn already settled submits at once", () => {
    const h = harness();
    h.setPhase("idle");
    h.latch();
    expect(h.turns.length).toBe(1);
    h.controller.dispose();
  });

  test("a parked request is dropped when the user queues a turn of their own", () => {
    const h = harness();
    h.latch();
    h.queue(1);
    expect(h.controller.getSnapshot()).toEqual({ kind: "idle" });
    expect(h.turns).toEqual([]);
    expect(lastNotice(h)?.kind).toBe("caution");
    expect(lastNotice(h)?.message).toContain("submitted something else");
    h.controller.dispose();
  });

  test("a parked request is dropped when a turn it did not submit starts", () => {
    // Submitting from a settled session sends straight out instead of
    // queueing, so `queuedSends` stays empty and the queue guard never sees
    // it. The park has to notice the turn itself. Offline is how a settled
    // beat reaches a park without submitting it — `canSubmit` is phase AND
    // transport — which is what puts the park in that position at all.
    const h = harness();
    h.setOnline(false);
    h.latch();
    h.setPhase("idle");
    expect(h.controller.getSnapshot()).toEqual({ kind: "parked", planPath: PLAN });
    expect(h.turns).toEqual([]);

    h.setPhase("streaming");
    expect(h.controller.getSnapshot()).toEqual({ kind: "idle" });
    expect(h.turns).toEqual([]);
    expect(h.sent).toEqual([]);
    expect(lastNotice(h)?.kind).toBe("caution");
    expect(lastNotice(h)?.message).toContain("submitted something else");
  });

  test("a park that only waited out the wire still submits", () => {
    // The counterpart: a settled beat the park sat through is not by itself
    // evidence of a user turn, so reconnecting submits rather than abandons.
    const h = harness();
    h.setOnline(false);
    h.latch();
    h.setPhase("idle");
    expect(h.turns).toEqual([]);

    h.setOnline(true);
    expect(h.turns.length).toBe(1);
    expect(h.sent).toEqual(["opus"]);
  });

  test("a second request while one is under way is refused, not queued", () => {
    const h = harness();
    h.latch();
    h.latch("/abs/roadmap/other.md");
    expect(h.controller.getSnapshot()).toEqual({ kind: "parked", planPath: PLAN });
    expect(lastNotice(h)?.message).toContain("already under way");
    h.controller.dispose();
  });

  test("a request on a session with no model knowledge is refused", () => {
    const h = harness({ rows: [], model: null });
    h.latch();
    expect(h.controller.getSnapshot()).toEqual({ kind: "idle" });
    expect(lastNotice(h)?.message).toContain("isn't known");
    h.controller.dispose();
  });
});

describe("the borrow", () => {
  test("a different catalog row is borrowed and given back on settle", () => {
    const h = harness();
    h.latch();
    h.setPhase("idle");
    expect(h.sent).toEqual(["opus"]);
    h.setPhase("streaming");
    h.setPhase("idle");
    expect(h.sent).toEqual(["opus", "sonnet"]);
    expect(h.controller.getSnapshot()).toEqual({ kind: "idle" });
    h.controller.dispose();
  });

  test("a card already on the review model's row performs no model_change", () => {
    // The account default IS Opus, and the session is on `default`.
    const h = harness({ rows: OPUS_DEFAULT, model: null });
    h.latch();
    h.setPhase("idle");
    expect(h.sent).toEqual([]);
    expect(h.turns.length).toBe(1);
    h.setPhase("idle");
    expect(h.sent).toEqual([]);
    h.controller.dispose();
  });

  test("an unresolvable review selector runs the review with no borrow", () => {
    const h = harness({ reviewSelector: "nonesuch-9" });
    h.latch();
    h.setPhase("idle");
    expect(h.sent).toEqual([]);
    expect(h.turns.length).toBe(1);
    expect(h.notices.some((n) => n.message.includes("isn't available"))).toBe(true);
    h.controller.dispose();
  });

  test("the announcement names the model before the turn goes out", () => {
    const h = harness();
    h.latch();
    h.setPhase("idle");
    const announce = h.notices.find((n) => n.kind === "announce");
    expect(announce?.message).toContain("Opus 5");
    h.controller.dispose();
  });
});

describe("release", () => {
  test("armed does not release on the idle it was submitted from", () => {
    // The whole reason for the three-beat shape: at submit time the session is
    // idle, and it is still idle for the notification `send()` itself fires.
    const h = harness();
    h.latch();
    h.setPhase("idle");
    // The turn started (the fake's `send` moved the phase), so the borrow is
    // still out.
    expect(h.sent).toEqual(["opus"]);
    expect(h.controller.getSnapshot().kind).toBe("running");
    h.controller.dispose();
  });

  test("an interrupted turn restores the model exactly as a completed one does", () => {
    const h = harness();
    h.latch();
    h.setPhase("idle");
    h.setPhase("streaming");
    h.setPhase("idle"); // an interrupt lands the session back at idle
    expect(h.sent).toEqual(["opus", "sonnet"]);
    h.controller.dispose();
  });

  test("an errored turn restores the model", () => {
    const h = harness();
    h.latch();
    h.setPhase("idle");
    h.setPhase("errored");
    expect(h.sent).toEqual(["opus", "sonnet"]);
    h.controller.dispose();
  });

  test("a second settle sends no second model_change", () => {
    const h = harness();
    h.latch();
    h.setPhase("idle");
    h.setPhase("idle");
    h.setPhase("idle");
    expect(h.sent).toEqual(["opus", "sonnet"]);
  });

  test("unmount after the review turn ended gives the model back at once", () => {
    const h = harness({ sendStartsTurn: false });
    h.latch();
    h.setPhase("idle");
    expect(h.sent).toEqual(["opus", "sonnet"]);
    h.controller.dispose();
    expect(h.sent).toEqual(["opus", "sonnet"]);
  });

  test("unmount mid-turn gives the model back when the turn settles", () => {
    // `CodeSessionStore.setModel` has no `canSubmit` gate of its own, so
    // releasing here would put a `model_change` on the wire mid-flight and
    // rest on claude honoring it there. The release waits out the turn it was
    // borrowed for instead — on a subscription that outlives the controller,
    // because an unmount mid-review is exactly the case it exists for.
    const h = harness();
    h.latch();
    h.setPhase("idle");
    expect(h.sent).toEqual(["opus"]);
    expect(h.controller.getSnapshot().kind).toBe("running");

    h.controller.dispose();
    expect(h.sent).toEqual(["opus"]);

    h.setPhase("idle");
    expect(h.sent).toEqual(["opus", "sonnet"]);
  });

  test("the deferred release fires once, however many beats follow", () => {
    const h = harness();
    h.latch();
    h.setPhase("idle");
    h.controller.dispose();
    h.setPhase("idle");
    h.setPhase("streaming");
    h.setPhase("idle");
    expect(h.sent).toEqual(["opus", "sonnet"]);
  });

  test("a submission that never becomes a turn does not strand the borrow", () => {
    const h = harness({ sendStartsTurn: false });
    h.latch();
    h.setPhase("idle");
    expect(h.turns.length).toBe(1);
    expect(h.sent).toEqual(["opus", "sonnet"]);
    expect(h.controller.getSnapshot()).toEqual({ kind: "idle" });
    h.controller.dispose();
  });
});

describe("dispose", () => {
  test("leaves nothing subscribed to the request store or the session", () => {
    const h = harness();
    h.controller.dispose();
    // A request latched after dispose must not wake a disposed controller.
    h.latch();
    expect(h.controller.getSnapshot()).toEqual({ kind: "idle" });
    expect(h.turns).toEqual([]);
    // And neither must a session beat.
    h.setPhase("idle");
    expect(h.turns).toEqual([]);
  });
});

describe("resolvePlanReviewTarget", () => {
  const PROJECT = "/Users/x/src/proj";
  const DASH = { worktree: ".tug/worktrees/fix", planPath: "roadmap/dash-plan.md" };

  test("an explicit argument wins, absolute or project-relative", () => {
    expect(
      resolvePlanReviewTarget({
        args: "/elsewhere/plan.md",
        projectDir: PROJECT,
        lastReviewed: "/abs/last.md",
        boundDash: DASH,
      }),
    ).toEqual({ path: "/elsewhere/plan.md" });

    expect(
      resolvePlanReviewTarget({
        args: "  roadmap/typed.md  ",
        projectDir: PROJECT,
        lastReviewed: "/abs/last.md",
        boundDash: DASH,
      }),
    ).toEqual({ path: `${PROJECT}/roadmap/typed.md` });
  });

  test("bare: last-reviewed beats a bound dash naming a different plan", () => {
    expect(
      resolvePlanReviewTarget({
        args: "",
        projectDir: PROJECT,
        lastReviewed: "/abs/last.md",
        boundDash: DASH,
      }),
    ).toEqual({ path: "/abs/last.md" });
  });

  test("bare with nothing reviewed: the dash composes project/worktree/plan", () => {
    expect(
      resolvePlanReviewTarget({
        args: "",
        projectDir: PROJECT,
        lastReviewed: null,
        boundDash: DASH,
      }),
    ).toEqual({ path: `${PROJECT}/.tug/worktrees/fix/roadmap/dash-plan.md` });
  });

  test("bare with nothing resolvable refuses", () => {
    expect(
      resolvePlanReviewTarget({
        args: "",
        projectDir: PROJECT,
        lastReviewed: null,
        boundDash: null,
      }),
    ).toEqual({ refused: true });
  });

  test("a trailing slash on the project root does not double up", () => {
    expect(
      resolvePlanReviewTarget({
        args: "roadmap/p.md",
        projectDir: `${PROJECT}/`,
        lastReviewed: null,
        boundDash: null,
      }),
    ).toEqual({ path: `${PROJECT}/roadmap/p.md` });
  });
});

describe("the last-reviewed record", () => {
  test("a review records its plan, in its own card-keyed domain", () => {
    const h = harness();
    h.latch();
    h.setPhase("idle");
    expect(h.turns.length).toBe(1);
    expect(written).toEqual([
      { domain: PLAN_REVIEW_LAST_DOMAIN, key: "card-1", value: PLAN },
    ]);
    // …and it reads straight back out of the cache, which is what makes a
    // later bare `/plan-review` synchronous.
    expect(readLastReviewedPlan("card-1")).toBe(PLAN);
    expect(readLastReviewedPlan("card-2")).toBeNull();
  });

  test("recording the path is not a model write ([D137])", () => {
    const h = harness();
    h.latch();
    h.setPhase("idle");
    // The borrow still went out over the wire and nothing touched dev.model.
    expect(h.sent).toEqual(["opus"]);
    expect(written.every((w) => w.domain === PLAN_REVIEW_LAST_DOMAIN)).toBe(true);
  });
});
