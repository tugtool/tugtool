/**
 * tug-text-editor-completion-suppress.test.ts —
 * Regression test for the `suppressCompletionDetection` annotation.
 *
 * Exercises the real completion extension (`tugCompletionExt`) headlessly:
 * the typeahead transaction-extender runs inside `EditorState.update`,
 * which needs no DOM, so we can build a state, dispatch transactions,
 * and read back the live `completionField`.
 *
 * The bug this guards against: recalling a `/command` (or `@file`) entry
 * from prompt history swaps the whole document in via
 * `buildEditStateTransaction`. The restored text begins with a trigger
 * character, so the extender's rejoin detection would reopen the
 * typeahead popup — and the now-active popup's high-precedence keymap
 * then swallows the next Enter / Shift+Return as an accept instead of a
 * submit. `buildEditStateTransaction` stamps the transaction with
 * `suppressCompletionDetection`, which the extender honors by leaving
 * the session inactive.
 *
 * Suppressing the *open* is necessary but not sufficient: paste into a
 * trigger run, or live `/command` composition, legitimately leave the
 * popup active, and Shift+Return must STILL submit. The load-bearing
 * guarantee lives in {@link completionConsumesEnter}: the active-popup
 * keymap only claims a modifier-free Enter as an accept and yields any
 * modifier-bearing Enter (Shift/Cmd/Ctrl/Alt) to the submit keymap.
 */

import { describe, expect, test } from "bun:test";

import { EditorSelection, EditorState } from "@codemirror/state";

import type { CompletionItem, CompletionProvider } from "@/lib/tug-text-types";
import {
  completionConsumesEnter,
  completionField,
  completionPopupIsInteractive,
  suppressCompletionDetection,
  tugCompletionExt,
} from "../tug-text-editor/completion-extension";

/** A trivial synchronous `/` provider that always offers one item. */
const slashProvider: CompletionProvider = (_query: string): CompletionItem[] => [
  {
    label: "permissions",
    atom: { kind: "atom", type: "command", label: "permissions", value: "permissions" },
  },
];

function makeState(): EditorState {
  return EditorState.create({
    doc: "",
    extensions: [tugCompletionExt(() => ({ "/": slashProvider }))],
  });
}

/** Replace the whole doc with `text`, caret at end, optionally suppressed. */
function replaceDoc(state: EditorState, text: string, suppress: boolean): EditorState {
  return state.update({
    changes: { from: 0, to: state.doc.length, insert: text },
    selection: EditorSelection.cursor(text.length),
    ...(suppress
      ? { annotations: suppressCompletionDetection.of(true) }
      : {}),
  }).state;
}

describe("suppressCompletionDetection", () => {
  test("a plain whole-doc replace of `/command` text reopens the popup (rejoin)", () => {
    // Baseline: WITHOUT the annotation, the rejoin path activates the
    // popup — this is the behavior the prompt-entry history recall must
    // suppress.
    const next = replaceDoc(makeState(), "/permissions", false);
    expect(next.field(completionField).active).toBe(true);
  });

  test("the same replace stamped with the annotation leaves typeahead inactive", () => {
    const next = replaceDoc(makeState(), "/permissions", true);
    expect(next.field(completionField).active).toBe(false);
  });

  test("moving the caret into a recalled `/command` does NOT reopen the popup", () => {
    // The remaining half of the recall-submit bug: after a suppressed
    // whole-doc swap, clicking / arrowing into the restored trigger run
    // is a pure selection change. Rejoin is gated on `docChanged`, so it
    // must not reopen — otherwise the popup would steal the next submit.
    const recalled = replaceDoc(makeState(), "/permissions", true);
    expect(recalled.field(completionField).active).toBe(false);

    const moved = recalled.update({ selection: EditorSelection.cursor(5) }).state;
    expect(moved.field(completionField).active).toBe(false);
  });

  test("typing within a recalled `/command` still reopens the popup", () => {
    // The composition case rejoin exists for: an actual edit inside the
    // run reopens completion (a doc change), unlike a bare caret move.
    const recalled = replaceDoc(makeState(), "/permission", true);
    expect(recalled.field(completionField).active).toBe(false);

    const typed = recalled.update({
      changes: { from: 11, insert: "s" },
      selection: EditorSelection.cursor(12),
    }).state;
    expect(typed.field(completionField).active).toBe(true);
  });

  test("an annotated replace cancels an already-active session", () => {
    // Type `/` so the popup opens, then a suppressed whole-doc swap
    // (history nav landing on a different entry) must close it.
    const opened = makeState().update({
      changes: { from: 0, insert: "/" },
      selection: EditorSelection.cursor(1),
    }).state;
    expect(opened.field(completionField).active).toBe(true);

    const swapped = replaceDoc(opened, "/permissions", true);
    expect(swapped.field(completionField).active).toBe(false);
  });
});

describe("completionConsumesEnter — submit override yields past the popup", () => {
  const noMods = { shiftKey: false, metaKey: false, ctrlKey: false, altKey: false };

  test("a modifier-free Enter is claimed as a completion accept", () => {
    expect(completionConsumesEnter(noMods)).toBe(true);
  });

  test("Shift+Enter is NOT consumed — it yields to the submit keymap", () => {
    // The invariant the user mandates: caret in a prompt-entry ⇒
    // Shift+Return submits, even while the popup is open.
    expect(completionConsumesEnter({ ...noMods, shiftKey: true })).toBe(false);
  });

  test("Cmd+Enter (forced submit) also yields", () => {
    expect(completionConsumesEnter({ ...noMods, metaKey: true })).toBe(false);
  });

  test("Ctrl+Enter and Alt+Enter yield as well", () => {
    expect(completionConsumesEnter({ ...noMods, ctrlKey: true })).toBe(false);
    expect(completionConsumesEnter({ ...noMods, altKey: true })).toBe(false);
  });

  test("any modifier combination with Enter yields", () => {
    expect(
      completionConsumesEnter({ shiftKey: true, metaKey: true, ctrlKey: false, altKey: false }),
    ).toBe(false);
  });
});

describe("completionPopupIsInteractive — only an on-screen popup owns keys", () => {
  test("active with items: the popup owns navigation / accept keys", () => {
    expect(completionPopupIsInteractive({ active: true, itemCount: 3 })).toBe(true);
  });

  test("active but empty: invisible popup owns nothing (keys fall through)", () => {
    // The mid-text `/` paste case: rejoin activates a session, the
    // position-0 gate yields zero items, the popup is `display:none`.
    // It must NOT swallow Shift+Return / Enter / arrows.
    expect(completionPopupIsInteractive({ active: true, itemCount: 0 })).toBe(false);
  });

  test("inactive: never owns keys", () => {
    expect(completionPopupIsInteractive({ active: false, itemCount: 0 })).toBe(false);
    expect(completionPopupIsInteractive({ active: false, itemCount: 5 })).toBe(false);
  });
});
