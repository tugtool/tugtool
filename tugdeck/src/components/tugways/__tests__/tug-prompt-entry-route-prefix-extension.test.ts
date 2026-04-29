/**
 * tug-prompt-entry/route-prefix-extension — pure CM6 update behavior.
 *
 * The extension is a `ViewPlugin` that watches every CM6 transaction
 * and calls `setRoute(matched)` once when the user types / pastes a
 * prefix character at offset 0. These tests exercise the entire
 * decision matrix:
 *
 *   - Typing `>`, `$`, `:` at offset 0 → flip.
 *   - Typing a non-prefix letter at offset 0 → no flip.
 *   - Typing past offset 0 → no flip.
 *   - Pure deletion of a leading prefix → no flip ([Q06]=b).
 *   - Re-inserting the same prefix while the route already matches
 *     → no flip (idempotent).
 *   - Replace-insert (selection + type) of a prefix at offset 0 → flip.
 *   - Paste (multi-character insert) whose first char is a prefix
 *     → flip.
 *
 * The extension never dispatches — assertions only watch the
 * `setRoute` callback and the doc text.
 */
import "../../../__tests__/setup-rtl";

import { describe, it, expect } from "bun:test";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { createRoutePrefixExtension } from "@/components/tugways/tug-prompt-entry/route-prefix-extension";

const ALIAS_MAP = {
  "❯": "❯",
  ">": "❯",
  "$": "$",
  ":": ":",
} as const;

interface MountedHarness {
  view: EditorView;
  routeRef: { current: string };
  setRouteCalls: string[];
  destroy: () => void;
}

function mount(initialDoc: string = "", initialRoute: string = "❯"): MountedHarness {
  const routeRef = { current: initialRoute };
  const setRouteCalls: string[] = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const state = EditorState.create({
    doc: initialDoc,
    extensions: [
      createRoutePrefixExtension({
        aliasMap: ALIAS_MAP,
        getCurrentRoute: () => routeRef.current,
        setRoute: (next) => {
          routeRef.current = next;
          setRouteCalls.push(next);
        },
      }),
    ],
  });
  const view = new EditorView({ state, parent: host });
  return {
    view,
    routeRef,
    setRouteCalls,
    destroy: () => {
      view.destroy();
      host.remove();
    },
  };
}

function insert(view: EditorView, text: string, at: number = -1): void {
  const pos = at < 0 ? view.state.doc.length : at;
  view.dispatch({
    changes: { from: pos, to: pos, insert: text },
    selection: EditorSelection.cursor(pos + text.length),
    userEvent: "input.type",
  });
}

describe("createRoutePrefixExtension — typing at offset 0", () => {
  it("typing `>` at offset 0 flips the route to `❯`", () => {
    // Start on a non-`❯` route so the flip is observable; on the
    // default route the change would be idempotent (matched ===
    // current → setRoute skipped).
    const h = mount("", "$");
    try {
      insert(h.view, ">");
      expect(h.routeRef.current).toBe("❯");
      expect(h.setRouteCalls).toEqual(["❯"]);
      // Character stays in the doc per [Q05]=a.
      expect(h.view.state.doc.toString()).toBe(">");
    } finally {
      h.destroy();
    }
  });

  it("typing `$` at offset 0 flips the route to `$`", () => {
    const h = mount("");
    try {
      insert(h.view, "$");
      expect(h.routeRef.current).toBe("$");
      expect(h.setRouteCalls).toEqual(["$"]);
    } finally {
      h.destroy();
    }
  });

  it("typing `:` at offset 0 flips the route to `:`", () => {
    const h = mount("");
    try {
      insert(h.view, ":");
      expect(h.routeRef.current).toBe(":");
      expect(h.setRouteCalls).toEqual([":"]);
    } finally {
      h.destroy();
    }
  });

  it("typing the chevron `❯` at offset 0 also flips to the `❯` route", () => {
    const h = mount("", "$");
    try {
      insert(h.view, "❯");
      expect(h.routeRef.current).toBe("❯");
      expect(h.setRouteCalls).toEqual(["❯"]);
    } finally {
      h.destroy();
    }
  });

  it("typing a non-prefix letter at offset 0 does not flip", () => {
    const h = mount("");
    try {
      insert(h.view, "h");
      expect(h.setRouteCalls).toEqual([]);
    } finally {
      h.destroy();
    }
  });
});

describe("createRoutePrefixExtension — typing past offset 0", () => {
  it("typing `$` after a non-prefix character does NOT flip", () => {
    const h = mount("hello");
    try {
      insert(h.view, "$"); // appended at end
      expect(h.setRouteCalls).toEqual([]);
    } finally {
      h.destroy();
    }
  });

  it("typing `$` mid-doc at offset 3 does NOT flip", () => {
    const h = mount("hello");
    try {
      insert(h.view, "$", 3);
      expect(h.setRouteCalls).toEqual([]);
    } finally {
      h.destroy();
    }
  });
});

describe("createRoutePrefixExtension — deletion is one-way ([Q06]=b)", () => {
  it("deleting the leading `$` from `$foo` does NOT flip to the default", () => {
    const h = mount("$foo", "$");
    try {
      h.view.dispatch({
        changes: { from: 0, to: 1, insert: "" },
        selection: EditorSelection.cursor(0),
        userEvent: "delete.backward",
      });
      expect(h.setRouteCalls).toEqual([]);
      expect(h.routeRef.current).toBe("$");
    } finally {
      h.destroy();
    }
  });
});

describe("createRoutePrefixExtension — idempotent on re-insertion", () => {
  it("re-typing `$` while the route is already `$` is a no-op", () => {
    const h = mount("", "$");
    try {
      insert(h.view, "$");
      expect(h.setRouteCalls).toEqual([]);
      expect(h.routeRef.current).toBe("$");
    } finally {
      h.destroy();
    }
  });
});

describe("createRoutePrefixExtension — replace-insert", () => {
  it("select-all + type `:` flips the route to `:` even though the change replaces existing content", () => {
    const h = mount("hello world");
    try {
      h.view.dispatch({
        changes: { from: 0, to: h.view.state.doc.length, insert: ":" },
        selection: EditorSelection.cursor(1),
        userEvent: "input.type",
      });
      expect(h.routeRef.current).toBe(":");
      expect(h.setRouteCalls).toEqual([":"]);
    } finally {
      h.destroy();
    }
  });
});

describe("createRoutePrefixExtension — multi-character paste", () => {
  it("pasting `> hello` into an empty doc flips the route to `❯`", () => {
    // As above — start away from `❯` so the flip observably fires.
    const h = mount("", "$");
    try {
      h.view.dispatch({
        changes: { from: 0, to: 0, insert: "> hello" },
        selection: EditorSelection.cursor(7),
        userEvent: "input.paste",
      });
      expect(h.routeRef.current).toBe("❯");
      expect(h.setRouteCalls).toEqual(["❯"]);
      expect(h.view.state.doc.toString()).toBe("> hello");
    } finally {
      h.destroy();
    }
  });

  it("pasting `hello $world` into an empty doc does NOT flip (first char is not a prefix)", () => {
    const h = mount("");
    try {
      h.view.dispatch({
        changes: { from: 0, to: 0, insert: "hello $world" },
        selection: EditorSelection.cursor(12),
        userEvent: "input.paste",
      });
      expect(h.setRouteCalls).toEqual([]);
    } finally {
      h.destroy();
    }
  });
});
