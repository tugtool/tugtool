/**
 * `captureDomSelection` serializer tests — Step 6.
 *
 * Pins the contract of the card-level DOM-selection serializer:
 *   - A Range anchored inside the card root serializes to a
 *     `DomSelectionSnapshot` whose paths round-trip back to the same
 *     nodes and offsets via `pathToNode`.
 *   - A Range whose endpoints fall outside the card root returns
 *     `null` — the guard's stale-range detection is upstream, but the
 *     serializer itself refuses to emit a snapshot whose paths would
 *     not resolve against the provided root.
 *   - Absence of a published Range returns `null`.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Window } from "happy-dom";

import { captureDomSelection } from "@/components/chrome/card-host";
import {
  selectionGuard,
  nodeToPath,
} from "@/components/tugways/selection-guard";

// ---------------------------------------------------------------------------
// happy-dom setup — mirrors selection-guard-paint.test.ts.
// ---------------------------------------------------------------------------

const happyWindow = new Window({ url: "http://localhost/" });

(global as any).document = happyWindow.document;
(global as any).window = happyWindow;
(global as any).HTMLElement = happyWindow.HTMLElement;
(global as any).Element = happyWindow.Element;
(global as any).Node = happyWindow.Node;
(global as any).Range = happyWindow.Range;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCardRoot(): HTMLElement {
  const el = happyWindow.document.createElement("div") as unknown as HTMLElement;
  el.setAttribute("data-card-host", "");
  (happyWindow.document.body as unknown as Element).appendChild(el as unknown as Node);
  return el;
}

function appendText(parent: HTMLElement, text: string): Text {
  const tn = happyWindow.document.createTextNode(text) as unknown as Text;
  (parent as unknown as Element).appendChild(tn as unknown as Node);
  return tn;
}

function makeRange(start: Node, startOffset: number, end: Node, endOffset: number): Range {
  const range = new (global as any).Range() as Range;
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  return range;
}

function pathToNode(root: HTMLElement, path: readonly number[]): Node | null {
  let current: Node = root;
  for (const index of path) {
    const child = current.childNodes[index];
    if (!child) return null;
    current = child;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  selectionGuard.reset();
});

afterEach(() => {
  selectionGuard.reset();
  (happyWindow.document.body as unknown as Element).innerHTML = "";
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("captureDomSelection – serializer contract", () => {
  it("serializes a Range anchored inside the card root; paths round-trip to same nodes/offsets", () => {
    const cardRoot = makeCardRoot();
    // Build: <div> <span>lorem</span> <span>ipsum</span> </div>
    const spanA = happyWindow.document.createElement("span") as unknown as HTMLElement;
    const spanB = happyWindow.document.createElement("span") as unknown as HTMLElement;
    (cardRoot as unknown as Element).appendChild(spanA as unknown as Node);
    (cardRoot as unknown as Element).appendChild(spanB as unknown as Node);
    const textA = appendText(spanA, "lorem");
    const textB = appendText(spanB, "ipsum");

    // Select "rem" of "lorem" to "ip" of "ipsum": anchor=textA:2, focus=textB:2
    const range = makeRange(textA, 2, textB, 2);
    selectionGuard.updateCardDomSelection("card-x", range);

    const snap = captureDomSelection("card-x", cardRoot);
    expect(snap).not.toBeNull();
    if (snap === null) return;

    expect(snap.anchorOffset).toBe(2);
    expect(snap.focusOffset).toBe(2);
    // Round-trip paths back to nodes.
    expect(pathToNode(cardRoot, snap.anchorPath)).toBe(textA as unknown as Node);
    expect(pathToNode(cardRoot, snap.focusPath)).toBe(textB as unknown as Node);

    // Sanity: the exposed nodeToPath helper agrees with the captured paths.
    expect(nodeToPath(cardRoot, textA as unknown as Node)).toEqual([...snap.anchorPath]);
    expect(nodeToPath(cardRoot, textB as unknown as Node)).toEqual([...snap.focusPath]);
  });

  it("returns null when the Range's endpoints are not descendants of the card root", () => {
    const cardRoot = makeCardRoot();
    const otherRoot = makeCardRoot();

    // Range lives inside `otherRoot`, not inside `cardRoot`.
    const textOther = appendText(otherRoot, "elsewhere");
    const range = makeRange(textOther, 0, textOther, 4);
    selectionGuard.updateCardDomSelection("card-x", range);

    const snap = captureDomSelection("card-x", cardRoot);
    expect(snap).toBeNull();
  });

  it("returns null when the card has no published Range", () => {
    const cardRoot = makeCardRoot();
    appendText(cardRoot, "nothing selected");

    // No updateCardDomSelection call for this card.
    expect(captureDomSelection("card-no-range", cardRoot)).toBeNull();
  });

  it("returns null after the card's Range is cleared via updateCardDomSelection(id, null)", () => {
    const cardRoot = makeCardRoot();
    const text = appendText(cardRoot, "hello");
    const range = makeRange(text, 0, text, 5);
    selectionGuard.updateCardDomSelection("card-x", range);
    expect(captureDomSelection("card-x", cardRoot)).not.toBeNull();

    selectionGuard.updateCardDomSelection("card-x", null);
    expect(captureDomSelection("card-x", cardRoot)).toBeNull();
  });
});
