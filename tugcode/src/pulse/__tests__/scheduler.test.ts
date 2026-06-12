/**
 * BeatScheduler — the beat discipline against a fake clock. Times are
 * plain numbers; no timers, no Date.now.
 */

import { describe, expect, test } from "bun:test";

import { BeatScheduler } from "../scheduler";
import type { PulseFact } from "../types";

const OPTS = {
  coalesceMs: 1_000,
  minIntervalMs: 5_000,
  staleMs: 3_000,
  maxFactsPerBeat: 3,
  maxPending: 5,
};

function fact(text: string, scope = "s1"): PulseFact {
  return {
    type: "pulse_fact",
    source: "test",
    scope,
    kind: "note",
    fact: text,
    at: 0,
  };
}

describe("BeatScheduler", () => {
  test("idle is silent — no facts, no beat", () => {
    const sched = new BeatScheduler(OPTS);
    expect(sched.takeBeat(10_000)).toBeNull();
  });

  test("a burst coalesces into one beat after the gather window", () => {
    const sched = new BeatScheduler(OPTS);
    sched.addFact(fact("a"), 1_000);
    sched.addFact(fact("b"), 1_200);
    sched.addFact(fact("c"), 1_400);
    // Before the coalesce window closes: nothing.
    expect(sched.takeBeat(1_900)).toBeNull();
    // After: one beat carrying the whole burst.
    const beat = sched.takeBeat(2_000);
    expect(beat).not.toBeNull();
    expect(beat!.facts.map((f) => f.fact)).toEqual(["a", "b", "c"]);
    // And the queue is drained.
    sched.resolveBeat(beat!.id, 2_100);
    expect(sched.takeBeat(10_000)).toBeNull();
  });

  test("a second beat waits out the minimum interval", () => {
    const sched = new BeatScheduler(OPTS);
    sched.addFact(fact("a"), 1_000);
    const first = sched.takeBeat(2_000)!;
    sched.resolveBeat(first.id, 2_500);
    sched.addFact(fact("b"), 2_600);
    // Coalesce-ready at 3600, but interval-ready only at 7000.
    expect(sched.takeBeat(3_700)).toBeNull();
    expect(sched.takeBeat(6_900)).toBeNull();
    const second = sched.takeBeat(7_000);
    expect(second).not.toBeNull();
    expect(second!.facts.map((f) => f.fact)).toEqual(["b"]);
  });

  test("single in-flight: no new beat while a reply is pending", () => {
    const sched = new BeatScheduler(OPTS);
    sched.addFact(fact("a"), 1_000);
    const first = sched.takeBeat(2_000)!;
    sched.addFact(fact("b"), 2_100);
    // Interval satisfied way later, but the beat is still in flight
    // within the stale window.
    expect(sched.takeBeat(4_900)).toBeNull();
    sched.resolveBeat(first.id, 4_950);
    expect(sched.takeBeat(7_000)).not.toBeNull();
  });

  test("a fresh reply emits; a stale reply is dropped", () => {
    const sched = new BeatScheduler(OPTS);
    sched.addFact(fact("a"), 1_000);
    const fresh = sched.takeBeat(2_000)!;
    expect(sched.resolveBeat(fresh.id, 4_900).emit).toBe(true);

    sched.addFact(fact("b"), 5_000);
    const late = sched.takeBeat(7_000)!;
    // Reply lands past the stale window: dropped.
    expect(sched.resolveBeat(late.id, 10_100).emit).toBe(false);
  });

  test("a dead in-flight beat stops blocking after the stale window", () => {
    const sched = new BeatScheduler(OPTS);
    sched.addFact(fact("a"), 1_000);
    const dead = sched.takeBeat(2_000)!;
    sched.addFact(fact("b"), 2_100);
    // Past stale + interval: the dead beat is abandoned and the next fires.
    const next = sched.takeBeat(7_500);
    expect(next).not.toBeNull();
    expect(next!.facts.map((f) => f.fact)).toEqual(["b"]);
    // The dead beat's straggler reply is refused.
    expect(sched.resolveBeat(dead.id, 7_600).emit).toBe(false);
    // And resolving the live beat still works.
    expect(sched.resolveBeat(next!.id, 7_700).emit).toBe(true);
  });

  test("digest bound keeps the NEWEST facts", () => {
    const sched = new BeatScheduler(OPTS);
    for (let i = 1; i <= 5; i++) sched.addFact(fact(`f${i}`), 1_000 + i);
    const beat = sched.takeBeat(3_000)!;
    expect(beat.facts.map((f) => f.fact)).toEqual(["f3", "f4", "f5"]);
    expect(sched.droppedFacts).toBe(2);
  });

  test("pending bound drops oldest as the queue floods", () => {
    const sched = new BeatScheduler(OPTS);
    for (let i = 1; i <= 8; i++) sched.addFact(fact(`f${i}`), 1_000 + i);
    expect(sched.pendingCount()).toBe(5);
    const beat = sched.takeBeat(3_000)!;
    // maxPending 5 kept f4..f8; maxFactsPerBeat 3 keeps the newest 3.
    expect(beat.facts.map((f) => f.fact)).toEqual(["f6", "f7", "f8"]);
  });
});
