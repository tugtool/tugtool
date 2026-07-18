import { describe, it, expect } from "bun:test";

import { ShadeViewController } from "../shade-view-controller";

describe("ShadeViewController — snapshot", () => {
  it("rests at 'none'", () => {
    expect(new ShadeViewController().getSnapshot()).toBe("none");
  });

  it("show commits the view", () => {
    const c = new ShadeViewController();
    c.show("changes");
    expect(c.getSnapshot()).toBe("changes");
  });

  it("hide returns to 'none'", () => {
    const c = new ShadeViewController();
    c.show("history");
    c.hide();
    expect(c.getSnapshot()).toBe("none");
  });
});

describe("ShadeViewController — mutual exclusion", () => {
  it("show swaps from the other Shade", () => {
    const c = new ShadeViewController();
    c.show("changes");
    c.show("history");
    expect(c.getSnapshot()).toBe("history");
  });
});

describe("ShadeViewController — toggle", () => {
  it("toggles a hidden Shade on", () => {
    const c = new ShadeViewController();
    c.toggle("changes");
    expect(c.getSnapshot()).toBe("changes");
  });

  it("toggles the showing Shade off", () => {
    const c = new ShadeViewController();
    c.show("changes");
    c.toggle("changes");
    expect(c.getSnapshot()).toBe("none");
  });

  it("toggles between Shades (the other is up → swap, not hide)", () => {
    const c = new ShadeViewController();
    c.show("changes");
    c.toggle("history");
    expect(c.getSnapshot()).toBe("history");
  });
});

describe("ShadeViewController — subscription", () => {
  it("fires a listener on commit", () => {
    const c = new ShadeViewController();
    let fires = 0;
    c.subscribe(() => {
      fires += 1;
    });
    c.show("changes");
    expect(fires).toBe(1);
  });

  it("does not fire when show is idempotent", () => {
    const c = new ShadeViewController();
    c.show("changes");
    let fires = 0;
    c.subscribe(() => {
      fires += 1;
    });
    c.show("changes");
    expect(fires).toBe(0);
  });

  it("does not fire when hide is a no-op from 'none'", () => {
    const c = new ShadeViewController();
    let fires = 0;
    c.subscribe(() => {
      fires += 1;
    });
    c.hide();
    expect(fires).toBe(0);
  });

  it("stops firing after unsubscribe", () => {
    const c = new ShadeViewController();
    let fires = 0;
    const unsubscribe = c.subscribe(() => {
      fires += 1;
    });
    c.show("changes");
    unsubscribe();
    c.show("history");
    expect(fires).toBe(1);
  });
});
