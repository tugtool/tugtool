import { describe, it, expect } from "bun:test";

import { RouteLifecycle } from "../route-lifecycle";

// The class is route-model-agnostic — these string values stand in for
// whatever route identifiers `TugPromptEntry` will seed it with.

describe("RouteLifecycle — store surface", () => {
  it("getRoute returns the seeded initial route", () => {
    expect(new RouteLifecycle("command").getRoute()).toBe("command");
  });

  it("setRoute commits — getRoute reflects the new route", () => {
    const lifecycle = new RouteLifecycle("code");
    lifecycle.setRoute("shell");
    expect(lifecycle.getRoute()).toBe("shell");
  });

  it("a store listener fires on commit and sees the committed route", () => {
    const lifecycle = new RouteLifecycle("code");
    const observed: string[] = [];
    lifecycle.subscribe(() => {
      observed.push(lifecycle.getRoute());
    });
    lifecycle.setRoute("shell");
    expect(observed).toEqual(["shell"]);
  });
});

describe("RouteLifecycle — delegate / observer surface", () => {
  it("routeWillChange fires before the commit with (prev, next)", () => {
    const lifecycle = new RouteLifecycle("code");
    const seen: Array<{ prev: string; next: string; routeAtFire: string }> = [];
    lifecycle.observeRouteWillChange((prev, next) => {
      seen.push({ prev, next, routeAtFire: lifecycle.getRoute() });
    });
    lifecycle.setRoute("shell");
    expect(seen).toEqual([
      { prev: "code", next: "shell", routeAtFire: "code" },
    ]);
  });

  it("routeDidChange fires after the commit with (prev, next)", () => {
    const lifecycle = new RouteLifecycle("code");
    const seen: Array<{ prev: string; next: string; routeAtFire: string }> = [];
    lifecycle.observeRouteDidChange((prev, next) => {
      seen.push({ prev, next, routeAtFire: lifecycle.getRoute() });
    });
    lifecycle.setRoute("shell");
    expect(seen).toEqual([
      { prev: "code", next: "shell", routeAtFire: "shell" },
    ]);
  });

  it("fires will, then the store notify, then did", () => {
    const lifecycle = new RouteLifecycle("code");
    const log: string[] = [];
    lifecycle.observeRouteWillChange(() => log.push("will"));
    lifecycle.subscribe(() => log.push("store"));
    lifecycle.observeRouteDidChange(() => log.push("did"));
    lifecycle.setRoute("shell");
    expect(log).toEqual(["will", "store", "did"]);
  });

  it("observers fire in subscription order", () => {
    const lifecycle = new RouteLifecycle("code");
    const order: number[] = [];
    lifecycle.observeRouteDidChange(() => order.push(1));
    lifecycle.observeRouteDidChange(() => order.push(2));
    lifecycle.observeRouteDidChange(() => order.push(3));
    lifecycle.setRoute("shell");
    expect(order).toEqual([1, 2, 3]);
  });

  it("carries the correct (prev, next) across consecutive changes", () => {
    const lifecycle = new RouteLifecycle("code");
    const pairs: Array<[string, string]> = [];
    lifecycle.observeRouteDidChange((prev, next) => pairs.push([prev, next]));
    lifecycle.setRoute("shell");
    lifecycle.setRoute("command");
    lifecycle.setRoute("code");
    expect(pairs).toEqual([
      ["code", "shell"],
      ["shell", "command"],
      ["command", "code"],
    ]);
  });
});

describe("RouteLifecycle — same-route setRoute", () => {
  it("fires nothing on any channel and leaves the route unchanged", () => {
    const lifecycle = new RouteLifecycle("code");
    const log: string[] = [];
    lifecycle.observeRouteWillChange(() => log.push("will"));
    lifecycle.subscribe(() => log.push("store"));
    lifecycle.observeRouteDidChange(() => log.push("did"));
    lifecycle.setRoute("code");
    expect(log).toEqual([]);
    expect(lifecycle.getRoute()).toBe("code");
  });
});

describe("RouteLifecycle — unsubscribe", () => {
  it("an unsubscribed observer or listener stops receiving changes", () => {
    const lifecycle = new RouteLifecycle("code");
    let willTicks = 0;
    let didTicks = 0;
    let storeTicks = 0;
    const unsubWill = lifecycle.observeRouteWillChange(() => {
      willTicks += 1;
    });
    const unsubDid = lifecycle.observeRouteDidChange(() => {
      didTicks += 1;
    });
    const unsubStore = lifecycle.subscribe(() => {
      storeTicks += 1;
    });

    lifecycle.setRoute("shell");
    expect([willTicks, didTicks, storeTicks]).toEqual([1, 1, 1]);

    unsubWill();
    unsubDid();
    unsubStore();

    lifecycle.setRoute("command");
    expect([willTicks, didTicks, storeTicks]).toEqual([1, 1, 1]);
  });
});

describe("RouteLifecycle — error isolation", () => {
  it("an observer that throws does not break the change sequence", () => {
    const lifecycle = new RouteLifecycle("code");
    const log: string[] = [];
    lifecycle.observeRouteWillChange(() => {
      throw new Error("boom");
    });
    lifecycle.observeRouteWillChange(() => log.push("will-2"));
    lifecycle.subscribe(() => log.push("store"));
    lifecycle.observeRouteDidChange(() => log.push("did"));

    lifecycle.setRoute("shell");

    // The throwing observer is isolated; the route still commits and
    // every other channel still fires.
    expect(log).toEqual(["will-2", "store", "did"]);
    expect(lifecycle.getRoute()).toBe("shell");
  });
});
