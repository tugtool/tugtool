/**
 * tug-text-editor-completion-word-savvy.test.ts —
 * Word-savvy typeahead behaviors: the query spans the whole trigger
 * token (trigger through the end of the word the caret sits in), the
 * caret's position inside the token never truncates the query, and
 * rejoin engages on user caret entry as well as edits.
 *
 * Exercises the real completion extension headlessly (the typeahead
 * transaction-extender runs inside `EditorState.update`, no DOM
 * needed), plus the pure token-scanning helpers.
 */

import { describe, expect, test } from "bun:test";

import { EditorSelection, EditorState, Text } from "@codemirror/state";

import type { CompletionItem, CompletionProvider } from "@/lib/tug-text-types";
import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";
import {
  beginsTokenAt,
  completionField,
  scanForwardForTokenEnd,
  tugCompletionExt,
} from "../tug-text-editor/completion-extension";

/** Trivial synchronous providers that always offer one item each. */
const item = (label: string, type: string): CompletionItem => ({
  label,
  atom: { kind: "atom", type, label, value: label },
});
const slashProvider: CompletionProvider = () => [item("permissions", "command")];
const fileProvider: CompletionProvider = () => [item("src/index.ts", "file")];

function makeState(doc = "", cursor?: number): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor ?? doc.length),
    extensions: [
      tugCompletionExt(() => ({ "/": slashProvider, "@": fileProvider })),
    ],
  });
}

describe("scanForwardForTokenEnd", () => {
  const doc = (s: string) => Text.of(s.split("\n"));

  test("walks to the first whitespace", () => {
    expect(scanForwardForTokenEnd(doc("index.ts please"), 0)).toBe(8);
    expect(scanForwardForTokenEnd(doc("index.ts please"), 3)).toBe(8);
  });

  test("returns pos at a token boundary", () => {
    expect(scanForwardForTokenEnd(doc("foo bar"), 3)).toBe(3);
    expect(scanForwardForTokenEnd(doc("foo"), 3)).toBe(3);
  });

  test("stops at doc end, newline, and the atom char", () => {
    expect(scanForwardForTokenEnd(doc("foo"), 0)).toBe(3);
    expect(scanForwardForTokenEnd(doc("foo\nbar"), 0)).toBe(3);
    expect(scanForwardForTokenEnd(doc(`fo${TUG_ATOM_CHAR}o`), 0)).toBe(2);
  });
});

describe("beginsTokenAt", () => {
  const doc = (s: string) => Text.of(s.split("\n"));

  test("doc start begins a token", () => {
    expect(beginsTokenAt(doc("/cmd"), 0)).toBe(true);
  });

  test("after whitespace or an atom begins a token", () => {
    expect(beginsTokenAt(doc("a /cmd"), 2)).toBe(true);
    expect(beginsTokenAt(doc(`${TUG_ATOM_CHAR}/cmd`), 1)).toBe(true);
  });

  test("glued to preceding text does not", () => {
    expect(beginsTokenAt(doc("x/cmd"), 1)).toBe(false);
  });
});

describe("word-savvy query derivation", () => {
  test("typing a trigger immediately before a word adopts the word as the query", () => {
    // "index.ts" with the caret at 0; typing `@` gives "@index.ts" and
    // must open filtering on the whole word, not "".
    const typed = makeState("index.ts", 0).update({
      changes: { from: 0, insert: "@" },
      selection: EditorSelection.cursor(1),
      userEvent: "input.type",
    }).state;
    const field = typed.field(completionField);
    expect(field.active).toBe(true);
    expect(field.trigger).toBe("@");
    expect(field.query).toBe("index.ts");
  });

  test("editing mid-token filters on the whole token", () => {
    // "@sfile" with an edit inserting "rc" after "@s" — the query must be
    // the full resulting token "srcfile", not the caret-bounded "src".
    const edited = makeState("@sfile", 2).update({
      changes: { from: 2, insert: "rc" },
      selection: EditorSelection.cursor(4),
      userEvent: "input.type",
    }).state;
    const field = edited.field(completionField);
    expect(field.active).toBe(true);
    expect(field.query).toBe("srcfile");
  });

  test("backspacing into a trigger token reopens with the whole token", () => {
    // "@foo " caret at end; backspace over the space lands the caret at
    // the token's end — a doc change, so rejoin fires.
    const backspaced = makeState("@foo ", 5).update({
      changes: { from: 4, to: 5 },
      selection: EditorSelection.cursor(4),
      userEvent: "delete.backward",
    }).state;
    const field = backspaced.field(completionField);
    expect(field.active).toBe(true);
    expect(field.query).toBe("foo");
  });

  test("backspacing into a pasted @path is not shadowed by an inner slash", () => {
    // A pasted "@tuglaws/tuglaws.m" — the inner "/" is also a registered
    // trigger, but it is part of the word, not the token head. Backspacing
    // over a trailing space must reopen FILE completion on the leading "@",
    // never slash-command completion anchored at the inner "/".
    const backspaced = makeState("@tuglaws/tuglaws.m ", 19).update({
      changes: { from: 18, to: 19 },
      selection: EditorSelection.cursor(18),
      userEvent: "delete.backward",
    }).state;
    const field = backspaced.field(completionField);
    expect(field.active).toBe(true);
    expect(field.trigger).toBe("@");
    expect(field.anchorOffset).toBe(0);
    expect(field.query).toBe("tuglaws/tuglaws.m");
  });

  test("a user click into the middle of a token opens with the whole token", () => {
    const clicked = makeState("@srcfile", 8).update({
      selection: EditorSelection.cursor(3),
      userEvent: "select.pointer",
    }).state;
    // makeState's initial cursor placement is not a user event, so the
    // session starts inactive; the click is what engages it.
    const field = clicked.field(completionField);
    expect(field.active).toBe(true);
    expect(field.anchorOffset).toBe(0);
    expect(field.query).toBe("srcfile");
  });

  test("an abandoned run cancels once the caret crosses whitespace", () => {
    // An unmatched "/foo" shows no popup, so nothing accepts and clears
    // the field. Typing a space moves the caret out of the trigger token
    // and must cancel the session rather than swallow the space into the
    // query — otherwise the still-active run shadows every later trigger.
    const opened = makeState("", 0).update({
      changes: { from: 0, insert: "/foo" },
      selection: EditorSelection.cursor(4),
      userEvent: "input.type",
    }).state;
    expect(opened.field(completionField).active).toBe(true);

    const spaced = opened.update({
      changes: { from: 4, insert: " " },
      selection: EditorSelection.cursor(5),
      userEvent: "input.type",
    }).state;
    expect(spaced.field(completionField).active).toBe(false);
  });

  test("a trigger typed after an abandoned run opens fresh", () => {
    // The end-to-end reported bug: "/foo " then "@" must open FILE
    // completion, not append "@" to the dead slash run's query.
    const afterAbandoned = makeState("", 0)
      .update({
        changes: { from: 0, insert: "/foo " },
        selection: EditorSelection.cursor(5),
        userEvent: "input.type",
      })
      .state.update({
        changes: { from: 5, insert: "@" },
        selection: EditorSelection.cursor(6),
        userEvent: "input.type",
      }).state;
    const field = afterAbandoned.field(completionField);
    expect(field.active).toBe(true);
    expect(field.trigger).toBe("@");
    expect(field.anchorOffset).toBe(5);
  });

  test("deleting the trigger character cancels the session", () => {
    const opened = makeState("", 0).update({
      changes: { from: 0, insert: "@" },
      selection: EditorSelection.cursor(1),
      userEvent: "input.type",
    }).state;
    expect(opened.field(completionField).active).toBe(true);

    const deleted = opened.update({
      changes: { from: 0, to: 1 },
      selection: EditorSelection.cursor(0),
      userEvent: "delete.backward",
    }).state;
    expect(deleted.field(completionField).active).toBe(false);
  });
});

describe("promotion — a trigger arriving at a token start engages completion", () => {
  test("deleting leading text so `/cmd` heads the doc opens the popup", () => {
    // "x/permissions": glued to "x", the slash is not a token start, so
    // no session. Backspacing the "x" away parks the caret at 0 ON the
    // now-leading slash — promotion must engage slash completion.
    const start = makeState("x/permissions", 1);
    expect(start.field(completionField).active).toBe(false);

    const promoted = start.update({
      changes: { from: 0, to: 1 },
      selection: EditorSelection.cursor(0),
      userEvent: "delete.backward",
    }).state;
    const field = promoted.field(completionField);
    expect(field.active).toBe(true);
    expect(field.trigger).toBe("/");
    expect(field.anchorOffset).toBe(0);
    expect(field.query).toBe("permissions");
  });

  test("typing text immediately before the trigger cancels the session", () => {
    // The inverse: with the caret parked on a leading trigger, typing a
    // plain character glues the trigger to text — it no longer begins a
    // token, so the session must close rather than keep completing a
    // run the user is writing prose in front of.
    const promoted = makeState("x/permissions", 1).update({
      changes: { from: 0, to: 1 },
      selection: EditorSelection.cursor(0),
      userEvent: "delete.backward",
    }).state;
    expect(promoted.field(completionField).active).toBe(true);

    const demoted = promoted.update({
      changes: { from: 0, insert: "y" },
      selection: EditorSelection.cursor(1),
      userEvent: "input.type",
    }).state;
    expect(demoted.field(completionField).active).toBe(false);
  });

  test("a user click just before a mid-text trigger token engages completion", () => {
    const clicked = makeState("see @notes now", 14).update({
      selection: EditorSelection.cursor(4),
      userEvent: "select.pointer",
    }).state;
    const field = clicked.field(completionField);
    expect(field.active).toBe(true);
    expect(field.trigger).toBe("@");
    expect(field.anchorOffset).toBe(4);
    expect(field.query).toBe("notes");
  });
});
