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
 */

import { describe, expect, test } from "bun:test";

import { EditorSelection, EditorState } from "@codemirror/state";

import type { CompletionItem, CompletionProvider } from "@/lib/tug-text-types";
import {
  completionField,
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
