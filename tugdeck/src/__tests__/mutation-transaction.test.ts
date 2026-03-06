/**
 * MutationTransaction and MutationTransactionManager unit tests -- Step 1.
 *
 * Tests cover:
 * - begin() snapshots current inline style values (including empty string for unset)
 * - preview() sets inline style values on the target element
 * - commit() marks transaction inactive; values remain in DOM
 * - cancel() restores all snapshotted values; element returns to original state
 * - Manager auto-cancels previous transaction when new one begins on same element
 * - Manager tracks independent transactions on different elements
 * - isPreviewProperty() returns true for previewed properties, false for others
 * - cancelAll() cancels all active transactions across all elements
 * - commitTransaction(target) delegates to commit() and removes transaction from Map
 * - cancelTransaction(target) delegates to cancel(), restores values, and removes transaction from Map
 * - commitTransaction/cancelTransaction are no-ops when no active transaction exists
 * - reset() clears all transactions and resets the ID counter
 * - preview() throws Error when called with a property not declared in begin()
 *
 * Note: This test file does not import setup-rtl because it tests only the
 * TypeScript module logic and plain DOM APIs -- no React rendering needed.
 * happy-dom is preloaded via bunfig.toml.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Window } from "happy-dom";

import {
  MutationTransaction,
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
(global as any).CSSStyleDeclaration = (happyWindow as any).CSSStyleDeclaration;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal HTMLElement with a real style object.
 */
function makeElement(): HTMLElement {
  return happyWindow.document.createElement("div") as unknown as HTMLElement;
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
// MutationTransaction direct tests
// ---------------------------------------------------------------------------

describe("MutationTransaction – begin()", () => {
  it("snapshots an empty string for a property not currently set inline", () => {
    const el = makeElement();
    const tx = new MutationTransaction("tx-test", el);
    tx.begin(["background-color"]);

    // The element has no inline background-color, so the snapshot stores ""
    // We can verify this by canceling immediately and checking no style is set
    tx.cancel();
    expect(el.style.getPropertyValue("background-color")).toBe("");
  });

  it("snapshots the current inline value for a property that is set", () => {
    const el = makeElement();
    el.style.setProperty("background-color", "red");

    const tx = new MutationTransaction("tx-test", el);
    tx.begin(["background-color"]);

    // Change the value so cancel has something to restore
    el.style.setProperty("background-color", "blue");

    tx.cancel();
    expect(el.style.getPropertyValue("background-color")).toBe("red");
  });

  it("snapshots multiple properties independently", () => {
    const el = makeElement();
    el.style.setProperty("left", "10px");
    el.style.setProperty("top", "20px");

    const tx = new MutationTransaction("tx-test", el);
    tx.begin(["left", "top"]);

    el.style.setProperty("left", "100px");
    el.style.setProperty("top", "200px");

    tx.cancel();
    expect(el.style.getPropertyValue("left")).toBe("10px");
    expect(el.style.getPropertyValue("top")).toBe("20px");
  });

  it("marks the transaction as active after begin()", () => {
    const el = makeElement();
    const tx = new MutationTransaction("tx-test", el);
    expect(tx.isActive).toBe(false);
    tx.begin(["background-color"]);
    expect(tx.isActive).toBe(true);
  });
});

describe("MutationTransaction – preview()", () => {
  it("sets the inline style value on the target element", () => {
    const el = makeElement();
    const tx = new MutationTransaction("tx-test", el);
    tx.begin(["background-color"]);

    tx.preview("background-color", "blue");
    expect(el.style.getPropertyValue("background-color")).toBe("blue");
  });

  it("adds the property to previewedProperties after preview()", () => {
    const el = makeElement();
    const tx = new MutationTransaction("tx-test", el);
    tx.begin(["background-color", "opacity"]);

    expect(tx.previewedProperties.has("background-color")).toBe(false);
    tx.preview("background-color", "green");
    expect(tx.previewedProperties.has("background-color")).toBe(true);
    expect(tx.previewedProperties.has("opacity")).toBe(false);
  });

  it("throws Error when property was not declared in begin()", () => {
    const el = makeElement();
    const tx = new MutationTransaction("tx-test", el);
    tx.begin(["background-color"]);

    expect(() => tx.preview("color", "red")).toThrow(
      /property "color" was not declared in begin\(\)/
    );
  });

  it("can preview multiple declared properties", () => {
    const el = makeElement();
    const tx = new MutationTransaction("tx-test", el);
    tx.begin(["left", "top"]);

    tx.preview("left", "50px");
    tx.preview("top", "75px");

    expect(el.style.getPropertyValue("left")).toBe("50px");
    expect(el.style.getPropertyValue("top")).toBe("75px");
    expect(tx.previewedProperties.size).toBe(2);
  });
});

describe("MutationTransaction – commit()", () => {
  it("marks transaction inactive after commit()", () => {
    const el = makeElement();
    const tx = new MutationTransaction("tx-test", el);
    tx.begin(["background-color"]);
    tx.preview("background-color", "purple");

    expect(tx.isActive).toBe(true);
    tx.commit();
    expect(tx.isActive).toBe(false);
  });

  it("leaves the previewed values in place after commit()", () => {
    const el = makeElement();
    const tx = new MutationTransaction("tx-test", el);
    tx.begin(["background-color"]);
    tx.preview("background-color", "purple");
    tx.commit();

    expect(el.style.getPropertyValue("background-color")).toBe("purple");
  });
});

describe("MutationTransaction – cancel()", () => {
  it("restores original inline style values after cancel()", () => {
    const el = makeElement();
    el.style.setProperty("background-color", "red");

    const tx = new MutationTransaction("tx-test", el);
    tx.begin(["background-color"]);
    tx.preview("background-color", "blue");

    tx.cancel();
    expect(el.style.getPropertyValue("background-color")).toBe("red");
  });

  it("removes inline style property when original was unset (empty string)", () => {
    const el = makeElement();
    // background-color was not set inline initially

    const tx = new MutationTransaction("tx-test", el);
    tx.begin(["background-color"]);
    tx.preview("background-color", "yellow");

    expect(el.style.getPropertyValue("background-color")).toBe("yellow");

    tx.cancel();
    expect(el.style.getPropertyValue("background-color")).toBe("");
  });

  it("marks transaction inactive after cancel()", () => {
    const el = makeElement();
    const tx = new MutationTransaction("tx-test", el);
    tx.begin(["background-color"]);
    tx.cancel();
    expect(tx.isActive).toBe(false);
  });

  it("restores multiple properties atomically", () => {
    const el = makeElement();
    el.style.setProperty("left", "10px");
    // top was not set inline

    const tx = new MutationTransaction("tx-test", el);
    tx.begin(["left", "top"]);
    tx.preview("left", "999px");
    tx.preview("top", "999px");

    tx.cancel();
    expect(el.style.getPropertyValue("left")).toBe("10px");
    expect(el.style.getPropertyValue("top")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// MutationTransactionManager tests
// ---------------------------------------------------------------------------

describe("MutationTransactionManager – beginTransaction()", () => {
  it("creates a new transaction and returns it", () => {
    const el = makeElement();
    const tx = mutationTransactionManager.beginTransaction(el, ["background-color"]);

    expect(tx).toBeInstanceOf(MutationTransaction);
    expect(tx.isActive).toBe(true);
    expect(tx.target).toBe(el);
  });

  it("auto-generates incrementing IDs (tx-1, tx-2, ...)", () => {
    const el1 = makeElement();
    const el2 = makeElement();

    const tx1 = mutationTransactionManager.beginTransaction(el1, ["left"]);
    const tx2 = mutationTransactionManager.beginTransaction(el2, ["top"]);

    expect(tx1.id).toBe("tx-1");
    expect(tx2.id).toBe("tx-2");
  });

  it("auto-cancels previous transaction on same element", () => {
    const el = makeElement();
    el.style.setProperty("background-color", "red");

    const tx1 = mutationTransactionManager.beginTransaction(el, ["background-color"]);
    tx1.preview("background-color", "blue");

    // Starting a new transaction should cancel tx1, restoring original value
    mutationTransactionManager.beginTransaction(el, ["background-color"]);

    // After auto-cancel, original value is restored before new snapshot
    // The new transaction then snapshots the restored value ("red")
    // We verify by canceling the new transaction
    mutationTransactionManager.cancelTransaction(el);
    expect(el.style.getPropertyValue("background-color")).toBe("red");
  });

  it("auto-cancels only the transaction on the same element, not others", () => {
    const el1 = makeElement();
    const el2 = makeElement();

    el1.style.setProperty("left", "10px");
    el2.style.setProperty("top", "20px");

    const tx1 = mutationTransactionManager.beginTransaction(el1, ["left"]);
    tx1.preview("left", "100px");

    const tx2 = mutationTransactionManager.beginTransaction(el2, ["top"]);
    tx2.preview("top", "200px");

    // Begin a new transaction on el1 -- should cancel tx1 (restoring el1)
    // but NOT cancel tx2
    mutationTransactionManager.beginTransaction(el1, ["left"]);

    expect(el1.style.getPropertyValue("left")).toBe("10px"); // restored by cancel
    expect(el2.style.getPropertyValue("top")).toBe("200px"); // tx2 still active
  });
});

describe("MutationTransactionManager – getActiveTransaction()", () => {
  it("returns the active transaction for an element", () => {
    const el = makeElement();
    const tx = mutationTransactionManager.beginTransaction(el, ["left"]);

    expect(mutationTransactionManager.getActiveTransaction(el)).toBe(tx);
  });

  it("returns null for an element with no active transaction", () => {
    const el = makeElement();
    expect(mutationTransactionManager.getActiveTransaction(el)).toBeNull();
  });

  it("returns null after the transaction is committed", () => {
    const el = makeElement();
    mutationTransactionManager.beginTransaction(el, ["left"]);
    mutationTransactionManager.commitTransaction(el);

    expect(mutationTransactionManager.getActiveTransaction(el)).toBeNull();
  });
});

describe("MutationTransactionManager – commitTransaction()", () => {
  it("delegates to transaction.commit() and removes from Map", () => {
    const el = makeElement();
    const tx = mutationTransactionManager.beginTransaction(el, ["background-color"]);
    tx.preview("background-color", "orange");

    mutationTransactionManager.commitTransaction(el);

    expect(tx.isActive).toBe(false);
    expect(mutationTransactionManager.getActiveTransaction(el)).toBeNull();
    expect(el.style.getPropertyValue("background-color")).toBe("orange");
  });

  it("is a no-op when no active transaction exists", () => {
    const el = makeElement();
    expect(() => mutationTransactionManager.commitTransaction(el)).not.toThrow();
  });
});

describe("MutationTransactionManager – cancelTransaction()", () => {
  it("delegates to transaction.cancel(), restores values, and removes from Map", () => {
    const el = makeElement();
    el.style.setProperty("background-color", "red");

    const tx = mutationTransactionManager.beginTransaction(el, ["background-color"]);
    tx.preview("background-color", "blue");

    mutationTransactionManager.cancelTransaction(el);

    expect(tx.isActive).toBe(false);
    expect(mutationTransactionManager.getActiveTransaction(el)).toBeNull();
    expect(el.style.getPropertyValue("background-color")).toBe("red");
  });

  it("is a no-op when no active transaction exists", () => {
    const el = makeElement();
    expect(() => mutationTransactionManager.cancelTransaction(el)).not.toThrow();
  });
});

describe("MutationTransactionManager – isPreviewProperty()", () => {
  it("returns true for a property that has been previewed", () => {
    const el = makeElement();
    const tx = mutationTransactionManager.beginTransaction(el, ["background-color"]);
    tx.preview("background-color", "blue");

    expect(mutationTransactionManager.isPreviewProperty(el, "background-color")).toBe(true);
  });

  it("returns false for a declared-but-not-yet-previewed property", () => {
    const el = makeElement();
    mutationTransactionManager.beginTransaction(el, ["background-color", "opacity"]);

    expect(mutationTransactionManager.isPreviewProperty(el, "opacity")).toBe(false);
  });

  it("returns false for a property not related to any active transaction", () => {
    const el = makeElement();
    mutationTransactionManager.beginTransaction(el, ["background-color"]);

    expect(mutationTransactionManager.isPreviewProperty(el, "color")).toBe(false);
  });

  it("returns false when no active transaction exists for the element", () => {
    const el = makeElement();
    expect(mutationTransactionManager.isPreviewProperty(el, "background-color")).toBe(false);
  });
});

describe("MutationTransactionManager – cancelAll()", () => {
  it("cancels all active transactions and restores original values", () => {
    const el1 = makeElement();
    const el2 = makeElement();
    el1.style.setProperty("background-color", "red");
    el2.style.setProperty("left", "10px");

    const tx1 = mutationTransactionManager.beginTransaction(el1, ["background-color"]);
    const tx2 = mutationTransactionManager.beginTransaction(el2, ["left"]);
    tx1.preview("background-color", "blue");
    tx2.preview("left", "100px");

    mutationTransactionManager.cancelAll();

    expect(tx1.isActive).toBe(false);
    expect(tx2.isActive).toBe(false);
    expect(el1.style.getPropertyValue("background-color")).toBe("red");
    expect(el2.style.getPropertyValue("left")).toBe("10px");
    expect(mutationTransactionManager.getActiveTransaction(el1)).toBeNull();
    expect(mutationTransactionManager.getActiveTransaction(el2)).toBeNull();
  });

  it("is a no-op when no active transactions exist", () => {
    expect(() => mutationTransactionManager.cancelAll()).not.toThrow();
  });
});

describe("MutationTransactionManager – reset()", () => {
  it("clears all transactions and resets the ID counter", () => {
    const el = makeElement();
    mutationTransactionManager.beginTransaction(el, ["left"]);

    mutationTransactionManager.reset();

    expect(mutationTransactionManager.getActiveTransaction(el)).toBeNull();

    // After reset, the next transaction should be tx-1 again
    const el2 = makeElement();
    const tx = mutationTransactionManager.beginTransaction(el2, ["top"]);
    expect(tx.id).toBe("tx-1");
  });

  it("restores values of active transactions during reset", () => {
    const el = makeElement();
    el.style.setProperty("background-color", "red");

    const tx = mutationTransactionManager.beginTransaction(el, ["background-color"]);
    tx.preview("background-color", "blue");

    mutationTransactionManager.reset();

    expect(el.style.getPropertyValue("background-color")).toBe("red");
  });

  it("is idempotent -- calling reset twice does not throw", () => {
    mutationTransactionManager.reset();
    expect(() => mutationTransactionManager.reset()).not.toThrow();
  });
});

describe("MutationTransactionManager – independent elements", () => {
  it("tracks transactions on multiple elements independently", () => {
    const el1 = makeElement();
    const el2 = makeElement();
    const el3 = makeElement();

    el1.style.setProperty("left", "1px");
    el2.style.setProperty("top", "2px");
    el3.style.setProperty("opacity", "0.5");

    const tx1 = mutationTransactionManager.beginTransaction(el1, ["left"]);
    const tx2 = mutationTransactionManager.beginTransaction(el2, ["top"]);
    const tx3 = mutationTransactionManager.beginTransaction(el3, ["opacity"]);

    tx1.preview("left", "100px");
    tx2.preview("top", "200px");
    tx3.preview("opacity", "1");

    // Commit el1, cancel el2, leave el3 active
    mutationTransactionManager.commitTransaction(el1);
    mutationTransactionManager.cancelTransaction(el2);

    expect(el1.style.getPropertyValue("left")).toBe("100px"); // committed
    expect(el2.style.getPropertyValue("top")).toBe("2px"); // cancelled/restored
    expect(el3.style.getPropertyValue("opacity")).toBe("1"); // still previewed

    expect(tx1.isActive).toBe(false);
    expect(tx2.isActive).toBe(false);
    expect(tx3.isActive).toBe(true);
  });
});
