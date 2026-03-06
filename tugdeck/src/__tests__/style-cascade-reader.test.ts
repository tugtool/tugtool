/**
 * StyleCascadeReader unit tests -- Step 2.
 *
 * Tests cover:
 * - getDeclared returns source: 'preview' when property is in an active transaction's preview set
 * - getDeclared returns source: 'inline' when property is set via element.style but no active transaction
 * - getDeclared returns source: 'token' for custom properties (--prefixed) resolved from document root
 * - getDeclared returns source: 'class' for computed-only properties not from inline or token
 * - getDeclared returns null for properties with no value at any layer
 * - getComputed returns the computed style value
 * - getTokenValue reads from document.documentElement computed style
 *
 * Mock strategy for happy-dom:
 * happy-dom does not process CSS stylesheets or resolve custom properties through
 * the cascade -- getComputedStyle() returns empty strings for --prefixed properties.
 * StyleCascadeReader accepts a getComputedStyle function via its constructor for
 * testability, so tests pass a controlled fake implementation directly without
 * relying on global spy patching (which is unreliable in bun test worker contexts).
 *
 * Note: This test file does not import setup-rtl because it tests only the
 * TypeScript module logic and plain DOM APIs -- no React rendering needed.
 * happy-dom is preloaded via bunfig.toml.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Window } from "happy-dom";

import {
  StyleCascadeReader,
  styleCascadeReader,
} from "@/components/tugways/style-cascade-reader";
import {
  MutationTransactionManager,
  mutationTransactionManager,
} from "@/components/tugways/mutation-transaction";

// ---------------------------------------------------------------------------
// Test environment setup
// ---------------------------------------------------------------------------

const happyWindow = new Window({ url: "http://localhost/" });

(global as any).document = happyWindow.document;
(global as any).window = happyWindow;
(global as any).HTMLElement = happyWindow.HTMLElement;
(global as any).Element = happyWindow.Element;
(global as any).Node = happyWindow.Node;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal HTMLElement with a real style object.
 */
function makeElement(): HTMLElement {
  return happyWindow.document.createElement("div") as unknown as HTMLElement;
}

/**
 * Build a fake getComputedStyle function for test injection.
 *
 * `perElement` maps each element reference to the property values it should
 * return. Elements not in the map get an empty-string result for all properties.
 *
 * This avoids relying on global spy patching, which is unreliable in bun test
 * worker contexts (bun 1.3.9).
 */
function makeFakeGetComputedStyle(
  perElement: Map<Element, Record<string, string>>
): (elt: Element) => CSSStyleDeclaration {
  return (elt: Element): CSSStyleDeclaration => {
    const values = perElement.get(elt) ?? {};
    return {
      getPropertyValue(prop: string): string {
        return values[prop] ?? "";
      },
    } as unknown as CSSStyleDeclaration;
  };
}

/**
 * Build a StyleCascadeReader instance with a controlled getComputedStyle.
 *
 * Convenience wrapper: pass a Map of element -> property values. The reader
 * uses the given manager (defaults to the module-level singleton).
 */
function makeReader(
  perElement: Map<Element, Record<string, string>>,
  manager: MutationTransactionManager = mutationTransactionManager
): StyleCascadeReader {
  return new StyleCascadeReader(manager, makeFakeGetComputedStyle(perElement));
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mutationTransactionManager.reset();
});

afterEach(() => {
  mutationTransactionManager.reset();
});

// ---------------------------------------------------------------------------
// getDeclared – source: 'preview'
// ---------------------------------------------------------------------------

describe("StyleCascadeReader.getDeclared – preview source", () => {
  it("returns source: 'preview' and the current inline value when property is in active transaction preview set", () => {
    const el = makeElement();

    // Begin a transaction and preview background-color
    const tx = mutationTransactionManager.beginTransaction(el, ["background-color"]);
    tx.preview("background-color", "cornflowerblue");

    // Use a reader wired to mutationTransactionManager (no computed mock needed
    // because preview short-circuits before computed style is consulted)
    const reader = makeReader(new Map());
    const result = reader.getDeclared(el, "background-color");

    expect(result).not.toBeNull();
    expect(result!.source).toBe("preview");
    expect(result!.value).toBe("cornflowerblue");
  });

  it("returns preview even when a getComputedStyle value also exists", () => {
    const el = makeElement();

    // Mock computed style to also have a value for background-color
    const computed = new Map<Element, Record<string, string>>();
    computed.set(el, { "background-color": "red" });
    const reader = makeReader(computed);

    const tx = mutationTransactionManager.beginTransaction(el, ["background-color"]);
    tx.preview("background-color", "blue");

    const result = reader.getDeclared(el, "background-color");
    expect(result!.source).toBe("preview");
    expect(result!.value).toBe("blue");
  });

  it("returns preview for a custom property (--prefixed) that is being previewed", () => {
    const el = makeElement();
    const tx = mutationTransactionManager.beginTransaction(el, ["--my-color"]);
    tx.preview("--my-color", "#ff0000");

    const reader = makeReader(new Map());
    const result = reader.getDeclared(el, "--my-color");
    expect(result!.source).toBe("preview");
    expect(result!.value).toBe("#ff0000");
  });

  it("uses the singleton styleCascadeReader for preview detection (integration smoke test)", () => {
    const el = makeElement();
    const tx = mutationTransactionManager.beginTransaction(el, ["opacity"]);
    tx.preview("opacity", "0.8");

    // styleCascadeReader is wired to mutationTransactionManager by default
    const result = styleCascadeReader.getDeclared(el, "opacity");
    expect(result!.source).toBe("preview");
    expect(result!.value).toBe("0.8");
  });
});

// ---------------------------------------------------------------------------
// getDeclared – source: 'inline'
// ---------------------------------------------------------------------------

describe("StyleCascadeReader.getDeclared – inline source", () => {
  it("returns source: 'inline' when property is set via element.style and no active transaction", () => {
    const el = makeElement();
    el.style.setProperty("background-color", "salmon");

    const reader = makeReader(new Map());
    const result = reader.getDeclared(el, "background-color");

    expect(result).not.toBeNull();
    expect(result!.source).toBe("inline");
    expect(result!.value).toBe("salmon");
  });

  it("returns inline even when getComputedStyle also returns a value", () => {
    const el = makeElement();
    el.style.setProperty("color", "navy");

    const computed = new Map<Element, Record<string, string>>();
    computed.set(el, { color: "rgb(0,0,128)" });
    const reader = makeReader(computed);

    const result = reader.getDeclared(el, "color");
    expect(result!.source).toBe("inline");
    expect(result!.value).toBe("navy");
  });

  it("does NOT return inline when element.style value is empty string", () => {
    // background-color not set inline; getComputedStyle returns nothing
    const el = makeElement();
    const reader = makeReader(new Map());

    const result = reader.getDeclared(el, "background-color");
    expect(result).toBeNull();
  });

  it("returns inline after a transaction is committed (preview gone, inline value stays)", () => {
    const el = makeElement();
    mutationTransactionManager.beginTransaction(el, ["opacity"]);
    const tx = mutationTransactionManager.getActiveTransaction(el)!;
    tx.preview("opacity", "0.5");

    // commit: value stays in place, transaction removed
    mutationTransactionManager.commitTransaction(el);

    // Now opacity is an inline value (no active transaction)
    const reader = makeReader(new Map());
    const result = reader.getDeclared(el, "opacity");
    expect(result!.source).toBe("inline");
    expect(result!.value).toBe("0.5");
  });
});

// ---------------------------------------------------------------------------
// getDeclared – source: 'token'
// ---------------------------------------------------------------------------

describe("StyleCascadeReader.getDeclared – token source", () => {
  it("returns source: 'token' for a --prefixed custom property whose computed value matches document root", () => {
    const el = makeElement();
    // No inline value for --brand-color

    // Both element and documentElement return the same value
    const computed = new Map<Element, Record<string, string>>();
    computed.set(el, { "--brand-color": "#3b82f6" });
    computed.set(document.documentElement, { "--brand-color": "#3b82f6" });
    const reader = makeReader(computed);

    const result = reader.getDeclared(el, "--brand-color");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("token");
    expect(result!.value).toBe("#3b82f6");
  });

  it("returns source: 'class' (not 'token') when element has a different custom property value than root", () => {
    const el = makeElement();

    const computed = new Map<Element, Record<string, string>>();
    computed.set(el, { "--accent-color": "#ef4444" });
    computed.set(document.documentElement, { "--accent-color": "#3b82f6" });
    const reader = makeReader(computed);

    const result = reader.getDeclared(el, "--accent-color");
    expect(result!.source).toBe("class");
    expect(result!.value).toBe("#ef4444");
  });

  it("returns null (not 'token') when custom property has no computed value on the element", () => {
    const el = makeElement();
    const reader = makeReader(new Map());

    const result = reader.getDeclared(el, "--missing-token");
    expect(result).toBeNull();
  });

  it("does NOT apply token detection to non-prefixed properties even if computed matches root", () => {
    const el = makeElement();

    const computed = new Map<Element, Record<string, string>>();
    computed.set(el, { "font-size": "16px" });
    computed.set(document.documentElement, { "font-size": "16px" });
    const reader = makeReader(computed);

    // font-size doesn't start with --, so token detection is skipped
    const result = reader.getDeclared(el, "font-size");
    expect(result!.source).toBe("class");
  });
});

// ---------------------------------------------------------------------------
// getDeclared – source: 'class'
// ---------------------------------------------------------------------------

describe("StyleCascadeReader.getDeclared – class source", () => {
  it("returns source: 'class' for a computed-only value not from inline or token", () => {
    const el = makeElement();
    // No inline style set

    const computed = new Map<Element, Record<string, string>>();
    computed.set(el, { "font-size": "14px" });
    // documentElement has no value for font-size (so element != root for custom props)
    const reader = makeReader(computed);

    const result = reader.getDeclared(el, "font-size");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("class");
    expect(result!.value).toBe("14px");
  });

  it("returns source: 'class' for a --prefixed property whose value differs from root", () => {
    const el = makeElement();

    const computed = new Map<Element, Record<string, string>>();
    computed.set(el, { "--spacing": "8px" });
    computed.set(document.documentElement, { "--spacing": "4px" });
    const reader = makeReader(computed);

    const result = reader.getDeclared(el, "--spacing");
    expect(result!.source).toBe("class");
    expect(result!.value).toBe("8px");
  });
});

// ---------------------------------------------------------------------------
// getDeclared – null (no value found)
// ---------------------------------------------------------------------------

describe("StyleCascadeReader.getDeclared – null fallback", () => {
  it("returns null when no value exists at any layer", () => {
    const el = makeElement();
    // No inline style, no computed value

    const reader = makeReader(new Map());

    const result = reader.getDeclared(el, "background-color");
    expect(result).toBeNull();
  });

  it("returns null for a completely unknown custom property with no computed value", () => {
    const el = makeElement();
    const reader = makeReader(new Map());

    const result = reader.getDeclared(el, "--nonexistent-token");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getComputed
// ---------------------------------------------------------------------------

describe("StyleCascadeReader.getComputed", () => {
  it("returns the computed style value for a property", () => {
    const el = makeElement();

    const computed = new Map<Element, Record<string, string>>();
    computed.set(el, { "font-weight": "700" });
    const reader = makeReader(computed);

    const value = reader.getComputed(el, "font-weight");
    expect(value).toBe("700");
  });

  it("returns empty string when the property has no computed value", () => {
    const el = makeElement();
    const reader = makeReader(new Map());

    const value = reader.getComputed(el, "background-color");
    expect(value).toBe("");
  });

  it("passes the element (not documentElement) to getComputedStyle", () => {
    const el = makeElement();
    const calls: Element[] = [];

    const fakeGetComputedStyle = (elt: Element): CSSStyleDeclaration => {
      calls.push(elt);
      return { getPropertyValue: () => "green" } as unknown as CSSStyleDeclaration;
    };

    const reader = new StyleCascadeReader(mutationTransactionManager, fakeGetComputedStyle);
    reader.getComputed(el, "color");

    expect(calls.length).toBe(1);
    expect(calls[0]).toBe(el);
  });
});

// ---------------------------------------------------------------------------
// getTokenValue
// ---------------------------------------------------------------------------

describe("StyleCascadeReader.getTokenValue", () => {
  it("reads from document.documentElement computed style", () => {
    const calls: Element[] = [];
    const fakeGetComputedStyle = (elt: Element): CSSStyleDeclaration => {
      calls.push(elt);
      return {
        getPropertyValue: (prop: string) => (prop === "--primary" ? "#1d4ed8" : ""),
      } as unknown as CSSStyleDeclaration;
    };

    const reader = new StyleCascadeReader(mutationTransactionManager, fakeGetComputedStyle);
    const value = reader.getTokenValue("--primary");

    expect(value).toBe("#1d4ed8");
    expect(calls.length).toBe(1);
    expect(calls[0]).toBe(document.documentElement);
  });

  it("returns empty string when the token is not defined on documentElement", () => {
    const reader = makeReader(new Map());
    const value = reader.getTokenValue("--undefined-token");
    expect(value).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Constructor injection (testability)
// ---------------------------------------------------------------------------

describe("StyleCascadeReader – constructor injection", () => {
  it("uses the injected manager for preview detection, not the global singleton", () => {
    const localManager = new MutationTransactionManager();
    const localReader = new StyleCascadeReader(localManager);
    const el = makeElement();

    // Start a preview on the local manager
    const tx = localManager.beginTransaction(el, ["color"]);
    tx.preview("color", "tomato");

    // Local reader sees the preview
    const localResult = localReader.getDeclared(el, "color");
    expect(localResult!.source).toBe("preview");

    // Global singleton reader uses mutationTransactionManager -- no preview there
    // The inline style IS set (preview wrote it), so the global reader sees inline
    const globalResult = styleCascadeReader.getDeclared(el, "color");
    expect(globalResult!.source).toBe("inline");

    localManager.reset();
  });

  it("uses the injected getComputedStyle function, not the global one", () => {
    const el = makeElement();
    let injectedWasCalled = false;

    const customGetComputedStyle = (elt: Element): CSSStyleDeclaration => {
      injectedWasCalled = true;
      return { getPropertyValue: () => "" } as unknown as CSSStyleDeclaration;
    };

    const reader = new StyleCascadeReader(mutationTransactionManager, customGetComputedStyle);
    reader.getComputed(el, "color");

    expect(injectedWasCalled).toBe(true);
  });
});
