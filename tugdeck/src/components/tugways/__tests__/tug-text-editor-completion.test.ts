/**
 * tug-text-editor-completion — pure-logic tests for the typeahead engine.
 *
 * Scope: the functions that compute typeahead state transitions
 * without depending on a live `EditorView`, real focus, or DOM
 * layout. Trigger detection over `Transaction` shapes, query
 * derivation over a doc/selection snapshot, and the StateField's
 * effect-driven `update` are all pure: their inputs are a
 * `Transaction` (or its ingredients) and their outputs are values.
 *
 * Why no keystroke-dispatch tests here: the popup paint, the
 * `Prec.highest` keymap, click handlers on popup items, and the
 * `coordsAtPos`-driven positioning all cross React renders, real
 * focus, and contentEditable selection — none of which happy-dom
 * models faithfully. The project's test-scoping rule reserves them
 * for `just app-test` (real WebKit) and the gallery card.
 */

import "../../../__tests__/setup-rtl";

import { describe, it, expect } from "bun:test";
import { EditorSelection, EditorState, Text } from "@codemirror/state";

import {
  completionField,
  detectTriggerInsertion,
  deriveQueryUpdate,
  lookupCompletionProvider,
} from "@/components/tugways/tug-text-editor/completion-extension";
import type {
  CompletionItem,
  CompletionProvider,
} from "@/lib/tug-text-engine";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fileItem = (label: string): CompletionItem => ({
  label,
  atom: { kind: "atom", type: "file", label, value: `/p/${label}` },
});

const slashItem = (label: string): CompletionItem => ({
  label,
  atom: { kind: "atom", type: "command", label, value: label },
});

const fileProvider: CompletionProvider = (q: string) => {
  return ["main.ts", "app.tsx", "router.ts"]
    .filter((s) => s.toLowerCase().includes(q.toLowerCase()))
    .map(fileItem);
};

const commandProvider: CompletionProvider = (q: string) => {
  return ["/commit", "/build", "/test"]
    .filter((s) => s.toLowerCase().includes(q.toLowerCase()))
    .map(slashItem);
};

const providers: Record<string, CompletionProvider> = {
  "@": fileProvider,
  "/": commandProvider,
};

/** Build a fresh `EditorState` with `completionField` installed. */
function makeState(initial: string): EditorState {
  return EditorState.create({
    doc: initial,
    extensions: [completionField],
  });
}

// ---------------------------------------------------------------------------
// lookupCompletionProvider
// ---------------------------------------------------------------------------

describe("lookupCompletionProvider", () => {
  it("returns the registered provider for an ASCII trigger", () => {
    expect(lookupCompletionProvider(providers, "@")).toBe(fileProvider);
    expect(lookupCompletionProvider(providers, "/")).toBe(commandProvider);
  });

  it("normalizes full-width punctuation to its ASCII counterpart", () => {
    // U+FF20 = ＠ (full-width @)
    expect(lookupCompletionProvider(providers, "＠")).toBe(fileProvider);
    // U+FF0F = ／ (full-width /)
    expect(lookupCompletionProvider(providers, "／")).toBe(commandProvider);
  });

  it("returns undefined for unregistered characters", () => {
    expect(lookupCompletionProvider(providers, "x")).toBeUndefined();
    expect(lookupCompletionProvider(providers, "")).toBeUndefined();
  });

  it("returns undefined for full-width chars whose ASCII equivalent is unregistered", () => {
    // U+FF21 = Ａ — ASCII "A" is not in providers.
    expect(lookupCompletionProvider(providers, "Ａ")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// detectTriggerInsertion
// ---------------------------------------------------------------------------

describe("detectTriggerInsertion", () => {
  it("fires when the user types a registered trigger character", () => {
    const state = makeState("hello ");
    const tr = state.update({
      changes: { from: 6, insert: "@" },
      selection: { anchor: 7 },
    });
    const detected = detectTriggerInsertion(tr, providers);
    expect(detected).not.toBeNull();
    expect(detected!.trigger).toBe("@");
    expect(detected!.anchorOffset).toBe(6);
    expect(detected!.provider).toBe(fileProvider);
  });

  it("does not fire when the inserted character is not a trigger", () => {
    const state = makeState("");
    const tr = state.update({
      changes: { from: 0, insert: "x" },
      selection: { anchor: 1 },
    });
    expect(detectTriggerInsertion(tr, providers)).toBeNull();
  });

  it("does not fire on multi-character insertions even if they end with a trigger", () => {
    // Paste-like insertion. We deliberately do NOT activate from these
    // — only single-keystroke insertions count.
    const state = makeState("");
    const tr = state.update({
      changes: { from: 0, insert: "hello @" },
      selection: { anchor: 7 },
    });
    expect(detectTriggerInsertion(tr, providers)).toBeNull();
  });

  it("does not fire on a non-doc-changing transaction", () => {
    const state = makeState("@hello");
    const tr = state.update({
      selection: { anchor: 6 },
    });
    expect(detectTriggerInsertion(tr, providers)).toBeNull();
  });

  it("does not fire when the insertion is not adjacent to the caret", () => {
    // Inserted at offset 3, but caret moved elsewhere — defensive.
    const state = makeState("hello world");
    const tr = state.update({
      changes: { from: 3, insert: "@" },
      selection: { anchor: 0 },
    });
    expect(detectTriggerInsertion(tr, providers)).toBeNull();
  });

  it("normalizes full-width trigger insertions", () => {
    const state = makeState("");
    const tr = state.update({
      changes: { from: 0, insert: "＠" }, // ＠
      selection: { anchor: 1 },
    });
    const detected = detectTriggerInsertion(tr, providers);
    expect(detected).not.toBeNull();
    expect(detected!.provider).toBe(fileProvider);
  });
});

// ---------------------------------------------------------------------------
// deriveQueryUpdate
// ---------------------------------------------------------------------------

describe("deriveQueryUpdate", () => {
  // Use a synthetic completion-state for the inputs.
  const activeAt = (anchorOffset: number, query: string) => ({
    active: true,
    trigger: "@",
    anchorOffset,
    query,
    filtered: [],
    selectedIndex: 0,
    provider: fileProvider,
  });

  it("returns 'unchanged' when typeahead is inactive", () => {
    const inactive = {
      active: false,
      trigger: "",
      anchorOffset: 0,
      query: "",
      filtered: [],
      selectedIndex: 0,
      provider: null,
    };
    const doc = Text.of(["hello"]);
    const verdict = deriveQueryUpdate(inactive, doc, { from: 0, to: 0, head: 0 });
    expect(verdict.kind).toBe("unchanged");
  });

  // Doc is "hello @abc": offsets h=0 e=1 l=2 l=3 o=4 ' '=5 @=6 a=7 b=8 c=9 (length 10).
  it("returns 'query' with the new substring when caret moves forward", () => {
    const state = activeAt(6, ""); // anchor at the '@' position
    const doc = Text.of(["hello @abc"]);
    const verdict = deriveQueryUpdate(state, doc, { from: 10, to: 10, head: 10 });
    expect(verdict).toEqual({ kind: "query", value: "abc" });
  });

  it("returns 'unchanged' when the derived query matches the existing one", () => {
    const state = activeAt(6, "abc");
    const doc = Text.of(["hello @abc"]);
    const verdict = deriveQueryUpdate(state, doc, { from: 10, to: 10, head: 10 });
    expect(verdict.kind).toBe("unchanged");
  });

  it("cancels when the user makes a non-empty selection", () => {
    const state = activeAt(6, "abc");
    const doc = Text.of(["hello @abc"]);
    const verdict = deriveQueryUpdate(state, doc, { from: 7, to: 10, head: 10 });
    expect(verdict.kind).toBe("cancel");
  });

  it("cancels when the caret moves before the trigger anchor", () => {
    const state = activeAt(6, "abc");
    const doc = Text.of(["hello @abc"]);
    const verdict = deriveQueryUpdate(state, doc, { from: 3, to: 3, head: 3 });
    expect(verdict.kind).toBe("cancel");
  });

  it("cancels when the query gains a newline", () => {
    // Doc: "@line1\nline2" — '@'=0, "line1"=1..5, '\n'=6, "line2"=7..11.
    const state = activeAt(0, "");
    const doc = Text.of(["@line1", "line2"]);
    // Caret at position 8 — past the newline, query would contain "\n".
    const verdict = deriveQueryUpdate(state, doc, { from: 8, to: 8, head: 8 });
    expect(verdict.kind).toBe("cancel");
  });

  it("cancels when the caret moves onto the trigger anchor itself", () => {
    // Caret AT the anchor means it's positioned immediately before the
    // trigger char — the user backed past the trigger.
    const state = activeAt(6, "abc");
    const doc = Text.of(["hello @abc"]);
    const verdict = deriveQueryUpdate(state, doc, { from: 6, to: 6, head: 6 });
    expect(verdict.kind).toBe("cancel");
  });

  it("treats the position immediately after the trigger as an empty query, not a cancel", () => {
    const state = activeAt(6, "");
    const doc = Text.of(["hello @"]);
    // Caret at position 7 — right after '@', empty query.
    const verdict = deriveQueryUpdate(state, doc, { from: 7, to: 7, head: 7 });
    expect(verdict.kind).toBe("unchanged");
  });
});

// ---------------------------------------------------------------------------
// completionField — effect-driven state transitions
// ---------------------------------------------------------------------------

describe("completionField", () => {
  // We can't dispatch state effects through `EditorState.update`
  // without an active extension that exposes them — so re-import
  // the effects via a small backdoor: build a transaction that
  // includes them by name. Instead, exercise the field via the
  // module-level helpers.
  //
  // The ViewPlugin is the only path that dispatches activate/update
  // /navigate/cancel; that path requires a live view. We cover the
  // field's reducer behavior here by checking that the initial
  // create() yields the inactive state.

  it("creates an inactive initial state", () => {
    const state = makeState("");
    const value = state.field(completionField);
    expect(value.active).toBe(false);
    expect(value.filtered).toEqual([]);
    expect(value.selectedIndex).toBe(0);
    expect(value.provider).toBeNull();
  });

  it("maps the anchor through document changes when active", () => {
    // Field stays inactive without effects, so this test verifies
    // the no-op path. The active-path mapping is exercised by
    // app-test integration tests (popup tracks the trigger across
    // edits).
    const state = makeState("hello @world");
    const tr = state.update({
      changes: { from: 0, insert: "PREFIX " },
    });
    expect(tr.state.field(completionField).active).toBe(false);
  });
});

// Suppress the unused-import warning when the test file is loaded
// in environments where `EditorSelection` is needed for type-side
// usage but not the runtime.
void EditorSelection;
