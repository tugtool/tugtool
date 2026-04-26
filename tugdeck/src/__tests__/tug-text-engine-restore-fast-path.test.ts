/**
 * `TugTextEngine.restoreState` content-identical fast path — Step 12.
 *
 * Pins the [D11] / [Q04] / [L23] contract that `restoreState` compares
 * the target state's text+atoms signature against the engine's current
 * DOM signature (recomputed from `captureState`, never cached) and
 * skips `innerHTML = parts.join("")` when they match. Selection
 * alignment (`setSelectedRange`) runs regardless — selection changes
 * alone must hit the fast path and still move the caret.
 *
 * Coverage:
 *   - same-state restoreState twice → second call produces no DOM
 *     mutation (MutationObserver probe with childList/subtree/characterData).
 *   - different-text restoreState → DOM mutation observed.
 *   - different-atom restoreState → DOM mutation observed.
 *   - restoreState(A), user edit via insertText, restoreState(A) →
 *     second call mutates (current DOM diverged from A).
 *   - restoreState(A) then restoreState(A') where only selection
 *     changed → DOM unchanged, but selection moves.
 *   - selection is applied regardless of skip vs. write path.
 */

import "./setup-rtl";

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { TugTextEngine, type TugTextEditingState } from "@/lib/tug-text-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEngine(): {
  engine: TugTextEngine;
  root: HTMLDivElement;
  dispose: () => void;
} {
  const root = document.createElement("div");
  root.contentEditable = "true";
  document.body.appendChild(root);
  const engine = new TugTextEngine(root);
  return {
    engine,
    root,
    dispose: () => {
      engine.teardown();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

function makeTextState(
  text: string,
  selection: { start: number; end: number } | null = null,
): TugTextEditingState {
  return { text, atoms: [], selection };
}

function observeMutations(root: HTMLElement): {
  observer: MutationObserver;
  mutations: MutationRecord[];
  stop: () => void;
} {
  const mutations: MutationRecord[] = [];
  const observer = new MutationObserver((records) => {
    mutations.push(...records);
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  return {
    observer,
    mutations,
    stop: () => observer.disconnect(),
  };
}

// happy-dom delivers MutationObserver callbacks synchronously enough that
// after the triggering call returns, the records queue is populated. Some
// environments (jsdom, real browsers) schedule via microtask; flush once
// for safety.
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TugTextEngine.restoreState — fast-path skip", () => {
  let ctx!: ReturnType<typeof makeEngine>;

  beforeEach(() => {
    ctx = makeEngine();
  });

  afterEach(() => {
    ctx.dispose();
  });

  it("two consecutive restoreState(same) calls: second produces no DOM mutation", async () => {
    const state = makeTextState("hello world", { start: 0, end: 5 });
    ctx.engine.restoreState(state);

    const { mutations, stop } = observeMutations(ctx.root);
    try {
      ctx.engine.restoreState(state);
      await flush();
      expect(mutations.length).toBe(0);
    } finally {
      stop();
    }
  });

  it("restoreState(different text) writes — mutations observed", async () => {
    ctx.engine.restoreState(makeTextState("hello world"));

    const { mutations, stop } = observeMutations(ctx.root);
    try {
      ctx.engine.restoreState(makeTextState("goodbye"));
      await flush();
      expect(mutations.length).toBeGreaterThan(0);
    } finally {
      stop();
    }
  });

  it("restoreState(different atom list) writes — atoms count as DOM divergence", async () => {
    // Start with a plain-text state.
    ctx.engine.restoreState(makeTextState("abc"));

    // Now target a state with an atom at position 0.
    const target: TugTextEditingState = {
      text: "abc", // TUG_ATOM_CHAR is U+E000 per tug-atom-img
      atoms: [{ position: 0, type: "file", label: "README", value: "/readme.md" }],
      selection: null,
    };

    const { mutations, stop } = observeMutations(ctx.root);
    try {
      ctx.engine.restoreState(target);
      await flush();
      expect(mutations.length).toBeGreaterThan(0);
    } finally {
      stop();
    }
  });

  it("restoreState(A), simulated user edit, restoreState(A): second restore writes (current DOM differs from A)", async () => {
    const stateA = makeTextState("hello");
    ctx.engine.restoreState(stateA);

    // Simulate a user edit by mutating the live text node directly —
    // stand-in for any code path that changes `this.root`'s content
    // without updating the engine's internal signature (e.g. the
    // browser's edit event, an IME commit, an external patch). The
    // engine's fast path reads the ground-truth DOM via `captureState`
    // on every call, so the divergence is always caught regardless of
    // how the content moved.
    const textNode = ctx.root.firstChild as Text;
    textNode.textContent = "hello!";
    expect(ctx.engine.getText()).toBe("hello!");

    const { mutations, stop } = observeMutations(ctx.root);
    try {
      ctx.engine.restoreState(stateA);
      await flush();
      expect(mutations.length).toBeGreaterThan(0);
      expect(ctx.engine.getText()).toBe("hello");
    } finally {
      stop();
    }
  });

  it("restoreState(A) then restoreState(A') where only selection changed: DOM unchanged, mirror updated", async () => {
    const stateA = makeTextState("hello world", { start: 0, end: 5 });
    ctx.engine.restoreState(stateA);

    const stateAPrime = makeTextState("hello world", { start: 6, end: 11 });
    const { mutations, stop } = observeMutations(ctx.root);
    try {
      ctx.engine.restoreState(stateAPrime);
      await flush();
      // The fast path skipped the innerHTML rewrite — DOM structure is
      // untouched. A MutationObserver listening on childList + subtree
      // + characterData reports nothing.
      expect(mutations.length).toBe(0);
    } finally {
      stop();
    }

    // Selection did move — the engine's `_browserMirror.selection` is
    // the SOT post-25C.4. `restoreState` is mirror-only; callers
    // invoke `paintMirrorAsActive` / `paintMirrorAsInactive` to write
    // the DOM. Verify the mirror update by asking the engine for its
    // mirrored selection.
    expect(ctx.engine.getMirroredSelection()).toEqual({ start: 6, end: 11 });

    // The active-paint path writes through `setSelectedRange` to
    // `window.getSelection()`. Exercise it explicitly to verify the
    // post-restore paint still lands selection in the DOM.
    ctx.engine.paintMirrorAsActive();
    const sel = window.getSelection();
    expect(sel).not.toBeNull();
    if (sel === null) return;
    expect(sel.anchorOffset).toBe(6);
    expect(sel.focusOffset).toBe(11);
  });

  it("selection is applied even on the skip path (via paintMirrorAsActive)", () => {
    const stateA = makeTextState("hello world", { start: 2, end: 4 });
    ctx.engine.restoreState(stateA);
    // Move the caret with setSelectedRange, so the engine's current
    // selection diverges from stateA's recorded selection.
    ctx.engine.setSelectedRange(0, 0);

    // Re-restore stateA — DOM matches, only the mirror's selection
    // needs re-aligning. Post-25C.4: `restoreState` updates the
    // mirror; `paintMirrorAsActive` writes through to the DOM.
    ctx.engine.restoreState(stateA);
    expect(ctx.engine.getMirroredSelection()).toEqual({ start: 2, end: 4 });
    ctx.engine.paintMirrorAsActive();

    const sel = window.getSelection();
    expect(sel).not.toBeNull();
    if (sel === null) return;
    expect(sel.anchorOffset).toBe(2);
    expect(sel.focusOffset).toBe(4);
  });

  it("skip path preserves the exact DOM text node — a pre-existing Range anchored in it survives", async () => {
    const state = makeTextState("hello world", { start: 0, end: 5 });
    ctx.engine.restoreState(state);

    // Hold a Range anchored in the engine's live text node.
    const textNode = ctx.root.firstChild as Text | null;
    expect(textNode).not.toBeNull();
    if (textNode === null) return;
    const savedRange = document.createRange();
    savedRange.setStart(textNode, 2);
    savedRange.setEnd(textNode, 7);

    ctx.engine.restoreState(state);

    // With the fast path, the text node identity is preserved, so the
    // previously-captured Range still resolves.
    expect(savedRange.startContainer).toBe(textNode);
    expect(savedRange.endContainer).toBe(textNode);
    expect(savedRange.toString()).toBe("llo w");
  });
});
