import { describe, it, expect } from "bun:test";

import {
  tideSpawnErrorStore,
  spawnErrorMessage,
} from "../dev-spawn-error-store";

describe("tideSpawnErrorStore", () => {
  it("set then get returns the recorded error", () => {
    tideSpawnErrorStore.set("card-set", { reason: "does_not_exist" });
    expect(tideSpawnErrorStore.get("card-set")).toEqual({
      reason: "does_not_exist",
    });
    tideSpawnErrorStore.clear("card-set");
  });

  it("get returns null for an unknown card", () => {
    expect(tideSpawnErrorStore.get("card-unknown")).toBeNull();
  });

  it("clear removes the recorded error", () => {
    tideSpawnErrorStore.set("card-clear", { reason: "permission_denied" });
    tideSpawnErrorStore.clear("card-clear");
    expect(tideSpawnErrorStore.get("card-clear")).toBeNull();
  });

  it("notifies subscribers on set and clear, scoped per card", () => {
    let aTicks = 0;
    let bTicks = 0;
    const unsubA = tideSpawnErrorStore.subscribe("card-a", () => {
      aTicks += 1;
    });
    const unsubB = tideSpawnErrorStore.subscribe("card-b", () => {
      bTicks += 1;
    });
    tideSpawnErrorStore.set("card-a", { reason: "does_not_exist" });
    expect(aTicks).toBe(1);
    expect(bTicks).toBe(0); // scoped — card-b's subscriber is untouched
    tideSpawnErrorStore.clear("card-a");
    expect(aTicks).toBe(2);
    unsubA();
    unsubB();
    tideSpawnErrorStore.set("card-a", { reason: "x" });
    expect(aTicks).toBe(2); // unsubscribed — no further ticks
    tideSpawnErrorStore.clear("card-a");
  });

  it("clear on a card with no recorded error does not notify", () => {
    let ticks = 0;
    const unsub = tideSpawnErrorStore.subscribe("card-noop", () => {
      ticks += 1;
    });
    tideSpawnErrorStore.clear("card-noop");
    expect(ticks).toBe(0);
    unsub();
  });

  it("get returns a stable reference between mutations", () => {
    tideSpawnErrorStore.set("card-stable", { reason: "does_not_exist" });
    expect(tideSpawnErrorStore.get("card-stable")).toBe(
      tideSpawnErrorStore.get("card-stable"),
    );
    tideSpawnErrorStore.clear("card-stable");
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
