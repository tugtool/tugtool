import { describe, it, expect } from "bun:test";

import {
  sessionSpawnErrorStore,
  spawnErrorMessage,
} from "../session-spawn-error-store";

describe("sessionSpawnErrorStore", () => {
  it("set then get returns the recorded error", () => {
    sessionSpawnErrorStore.set("card-set", { reason: "does_not_exist" });
    expect(sessionSpawnErrorStore.get("card-set")).toEqual({
      reason: "does_not_exist",
    });
    sessionSpawnErrorStore.clear("card-set");
  });

  it("get returns null for an unknown card", () => {
    expect(sessionSpawnErrorStore.get("card-unknown")).toBeNull();
  });

  it("clear removes the recorded error", () => {
    sessionSpawnErrorStore.set("card-clear", { reason: "permission_denied" });
    sessionSpawnErrorStore.clear("card-clear");
    expect(sessionSpawnErrorStore.get("card-clear")).toBeNull();
  });

  it("notifies subscribers on set and clear, scoped per card", () => {
    let aTicks = 0;
    let bTicks = 0;
    const unsubA = sessionSpawnErrorStore.subscribe("card-a", () => {
      aTicks += 1;
    });
    const unsubB = sessionSpawnErrorStore.subscribe("card-b", () => {
      bTicks += 1;
    });
    sessionSpawnErrorStore.set("card-a", { reason: "does_not_exist" });
    expect(aTicks).toBe(1);
    expect(bTicks).toBe(0); // scoped — card-b's subscriber is untouched
    sessionSpawnErrorStore.clear("card-a");
    expect(aTicks).toBe(2);
    unsubA();
    unsubB();
    sessionSpawnErrorStore.set("card-a", { reason: "x" });
    expect(aTicks).toBe(2); // unsubscribed — no further ticks
    sessionSpawnErrorStore.clear("card-a");
  });

  it("clear on a card with no recorded error does not notify", () => {
    let ticks = 0;
    const unsub = sessionSpawnErrorStore.subscribe("card-noop", () => {
      ticks += 1;
    });
    sessionSpawnErrorStore.clear("card-noop");
    expect(ticks).toBe(0);
    unsub();
  });

  it("get returns a stable reference between mutations", () => {
    sessionSpawnErrorStore.set("card-stable", { reason: "does_not_exist" });
    expect(sessionSpawnErrorStore.get("card-stable")).toBe(
      sessionSpawnErrorStore.get("card-stable"),
    );
    sessionSpawnErrorStore.clear("card-stable");
  });
});

describe("spawnErrorMessage", () => {
  it("maps known reason codes to human copy", () => {
    expect(spawnErrorMessage("does_not_exist")).toBe(
      "The project directory no longer exists.",
    );
    expect(spawnErrorMessage("permission_denied")).toBe(
      "Permission denied for the project directory.",
    );
    expect(spawnErrorMessage("spawn_rate_limited")).toBe(
      "Too many sessions are starting at once. Try again in a moment.",
    );
  });

  it("falls back to a generic message for unknown codes", () => {
    expect(spawnErrorMessage("some_future_reason")).toBe(
      "The session could not be started.",
    );
  });
});
