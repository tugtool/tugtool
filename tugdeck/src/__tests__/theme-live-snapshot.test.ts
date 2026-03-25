import "./setup-rtl";

import { afterEach, describe, expect, it } from "bun:test";

import { snapshotLiveThemeTokens } from "@/components/tugways/theme-live-snapshot";

describe("theme live snapshot helper (thin)", () => {
  afterEach(() => {
    document.body.style.removeProperty("--tug-base");
    document.body.style.removeProperty("--tug-direct");
    document.body.style.removeProperty("--tug-ref");
  });

  it("captures raw values and resolves colors (direct + probe path)", () => {
    document.body.style.setProperty("--tug-base", "#224466");
    document.body.style.setProperty("--tug-direct", "#112233");
    document.body.style.setProperty("--tug-ref", "var(--tug-base)");

    const originalGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = ((el: Element) => {
      const style = originalGetComputedStyle(el);
      if (el === document.body) {
        return {
          ...style,
          getPropertyValue: (name: string) =>
            name === "--tug-ref" ? "var(--tug-base)" : style.getPropertyValue(name),
        } as CSSStyleDeclaration;
      }
      return style;
    }) as typeof getComputedStyle;

    const tokenNames = ["--tug-direct", "--tug-ref", "--tug-base"] as const;
    const required = new Set<string>(["--tug-ref", "--tug-direct"]);
    let snapshot: ReturnType<typeof snapshotLiveThemeTokens>;
    try {
      snapshot = snapshotLiveThemeTokens(tokenNames, required);
    } finally {
      globalThis.getComputedStyle = originalGetComputedStyle;
    }

    expect(snapshot.entries.length).toBe(3);
    expect(snapshot.entries.find((e) => e.name === "--tug-direct")?.rawValue).toBe("#112233");
    expect(snapshot.entries.find((e) => e.name === "--tug-ref")?.rawValue).toBe("var(--tug-base)");

    const direct = snapshot.resolvedMap["--tug-direct"];
    const ref = snapshot.resolvedMap["--tug-ref"];
    expect(direct).toBeDefined();
    expect(ref).toBeDefined();
    expect(direct.L).toBeGreaterThan(0);
    expect(ref.L).toBeGreaterThan(0);
  });
});
