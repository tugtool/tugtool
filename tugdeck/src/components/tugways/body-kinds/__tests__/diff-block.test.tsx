/**
 * `DiffBlock` — body-kind tests.
 *
 * Coverage:
 *  - Pure helpers exported from the body kind: `basename`,
 *    `composeHunkHeader`, `pairRemoveAddIndices`, `prepareHunksSync`.
 *  - Static render of `unified` source: header carries the basename,
 *    `+N -M` stats, and a stub side-by-side toggle (disabled). Hunks
 *    band the `@@` header and three line classes via `data-kind`.
 *  - Static render of `hunks` source: identical markup without
 *    parsing.
 *  - Two-text source: shows the "Computing diff…" placeholder until
 *    the lazy `tugdiff-wasm` loader resolves. Resolves with a stub
 *    engine via `injectTugdiffWasmForTests` and verifies the hunks
 *    render afterward.
 *  - Per-hunk collapse: clicking the hunk header toggles the
 *    `data-collapsed` attribute and hides the rows.
 *  - Whole-diff collapse: the toggle button collapses all hunks
 *    behind a "N hunks" cue (label is invariant across states; only
 *    the chevron flips) and notifies via `onToggleCollapsed`.
 *  - Word-level highlight: when a paired remove/add lands and the
 *    diff-match-patch engine resolves, the `<span class="tugx-diff-word-*">`
 *    spans appear inside the line content.
 *
 * Per the user's happy-dom rule, this file does not exercise focus,
 * selection, or event-ordering across React renders — only mounted
 * markup, attribute toggles, and click-driven state changes.
 */

import "../../../../__tests__/setup-rtl";

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import dmp from "diff-match-patch";
import React from "react";

// Mock the tugbank singleton so this test file controls what the
// diff-view-pref hook sees. Other test files mock the same module
// with their own fakeTugbank, and bun workers do not isolate
// `mock.module` state cleanly across files (see setup-rtl.ts on the
// same isolation issue) — owning our own mock here keeps us
// insulated from those neighbors.
const tugbankDomains: Record<string, Record<string, unknown>> = {};
const tugbankListeners = new Set<(domain: string, entries: Record<string, unknown>) => void>();
const fakeTugbank = {
  getValue(domain: string, key: string): unknown {
    return tugbankDomains[domain]?.[key];
  },
  onDomainChanged(
    cb: (domain: string, entries: Record<string, unknown>) => void,
  ): () => void {
    tugbankListeners.add(cb);
    return () => {
      tugbankListeners.delete(cb);
    };
  },
  // Mirrors `TugbankClient.setLocalValue` — bumps the cache and fires
  // listeners synchronously.
  setLocalValue(
    domain: string,
    key: string,
    value: { kind: string; value: unknown },
  ): void {
    if (tugbankDomains[domain] === undefined) tugbankDomains[domain] = {};
    tugbankDomains[domain][key] = value.value;
    for (const listener of tugbankListeners) {
      listener(domain, tugbankDomains[domain]);
    }
  },
};
mock.module("@/lib/tugbank-singleton", () => ({
  getTugbankClient: () => fakeTugbank,
  setTugbankClient: () => {},
}));

// Mock the Shiki utils module so we can inject a stub highlighter
// without the heavy real Shiki bundle. Tests opt in by setting
// `shikiBehavior` before mounting.
type ShikiBehavior =
  | { kind: "off" }
  | {
      kind: "stub";
      // Map: line text → HTML output Shiki would produce.
      htmlByLine: Map<string, string>;
    }
  | { kind: "throw" };
let shikiBehavior: ShikiBehavior = { kind: "off" };
mock.module("@/_archive/cards/conversation/code-block-utils", () => ({
  getHighlighter: async () => {
    if (shikiBehavior.kind === "throw") {
      throw new Error("test: Shiki failed to load");
    }
    if (shikiBehavior.kind === "off") {
      throw new Error("test: shikiBehavior not configured");
    }
    const htmlByLine = shikiBehavior.htmlByLine;
    return {
      getLoadedLanguages: () => ["typescript", "javascript", "tsx"],
      loadLanguage: async () => {},
      codeToHtml: (text: string) => {
        const inner = htmlByLine.get(text) ?? "";
        return (
          '<pre class="shiki"><code>' +
          '<span class="line">' +
          inner +
          "</span>" +
          "</code></pre>"
        );
      },
    };
  },
  normalizeLanguage: (l: string) => l,
}));

import {
  DiffBlock,
  basename,
  composeHunkHeader,
  groupSideBySideRows,
  pairRemoveAddIndices,
  prepareHunksSync,
} from "../diff-block";
import { ToolWrapperChrome } from "@/components/tugways/cards/tool-wrappers/tool-wrapper-chrome";
import {
  injectTugdiffWasmForTests,
  resetTugdiffWasmForTests,
  type TugdiffEngine,
} from "@/lib/lazy/load-tugdiff-wasm";
import type { DiffData, DiffHunk, DiffLine } from "@/lib/diff/types";

afterEach(() => {
  cleanup();
  resetTugdiffWasmForTests();
  for (const domain of Object.keys(tugbankDomains)) {
    delete tugbankDomains[domain];
  }
  tugbankListeners.clear();
  shikiBehavior = { kind: "off" };
});

/**
 * Seed `fakeTugbank` for the current test. Cleared in `afterEach`.
 */
function seedTugbank(
  domains: Record<string, Record<string, unknown>>,
): void {
  for (const [domain, entries] of Object.entries(domains)) {
    tugbankDomains[domain] = { ...entries };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("basename", () => {
  test("empty input → empty", () => {
    expect(basename("")).toBe("");
  });

  test("plain filename → itself", () => {
    expect(basename("foo.tsx")).toBe("foo.tsx");
  });

  test("posix path → last segment", () => {
    expect(basename("a/b/c.txt")).toBe("c.txt");
  });

  test("windows path → last segment", () => {
    expect(basename("C:\\a\\b.txt")).toBe("b.txt");
  });
});

describe("composeHunkHeader", () => {
  test("plural counts on both sides", () => {
    const hunk: DiffHunk = {
      before_start: 1,
      before_count: 5,
      after_start: 1,
      after_count: 8,
      header: "",
      lines: [],
    };
    expect(composeHunkHeader(hunk)).toBe("@@ -1,5 +1,8 @@");
  });

  test("count of 1 omitted (matches git)", () => {
    const hunk: DiffHunk = {
      before_start: 42,
      before_count: 1,
      after_start: 42,
      after_count: 1,
      header: "",
      lines: [],
    };
    expect(composeHunkHeader(hunk)).toBe("@@ -42 +42 @@");
  });

  test("section header appended after closing @@", () => {
    const hunk: DiffHunk = {
      before_start: 10,
      before_count: 3,
      after_start: 10,
      after_count: 5,
      header: "fn foo()",
      lines: [],
    };
    expect(composeHunkHeader(hunk)).toBe("@@ -10,3 +10,5 @@ fn foo()");
  });
});

describe("pairRemoveAddIndices", () => {
  test("adjacent remove then add → paired", () => {
    const lines = [
      { kind: "context" },
      { kind: "remove" },
      { kind: "add" },
      { kind: "context" },
    ];
    expect(pairRemoveAddIndices(lines)).toEqual(new Map([[1, 2]]));
  });

  test("balanced run [r, r, a, a] zips index-for-index", () => {
    // Real-world case: a function with 2 args changing 2 args. The
    // first remove pairs with the first add; the second remove pairs
    // with the second add. The previous "adjacent only" implementation
    // got this wrong (paired r2↔a1 and dropped r1, a2).
    const lines = [
      { kind: "remove" },
      { kind: "remove" },
      { kind: "add" },
      { kind: "add" },
    ];
    expect(pairRemoveAddIndices(lines)).toEqual(
      new Map([
        [0, 2],
        [1, 3],
      ]),
    );
  });

  test("uneven run [r, r, a] zips removes with adds, leaving extras unpaired", () => {
    // Two removes, one add. The first remove pairs with the add;
    // the second remove has no partner.
    const lines = [
      { kind: "remove" },
      { kind: "remove" },
      { kind: "add" },
    ];
    expect(pairRemoveAddIndices(lines)).toEqual(new Map([[0, 2]]));
  });

  test("uneven run [r, a, a] zips removes with adds, leaving extras unpaired", () => {
    // One remove, two adds. The remove pairs with the first add;
    // the second add has no partner.
    const lines = [
      { kind: "remove" },
      { kind: "add" },
      { kind: "add" },
    ];
    expect(pairRemoveAddIndices(lines)).toEqual(new Map([[0, 1]]));
  });

  test("multiple disjoint runs each zip independently", () => {
    const lines = [
      { kind: "remove" },
      { kind: "add" },
      { kind: "context" },
      { kind: "remove" },
      { kind: "remove" },
      { kind: "add" },
      { kind: "add" },
    ];
    expect(pairRemoveAddIndices(lines)).toEqual(
      new Map([
        [0, 1],
        [3, 5],
        [4, 6],
      ]),
    );
  });

  test("only adds → no pairs", () => {
    const lines = [{ kind: "add" }, { kind: "add" }];
    expect(pairRemoveAddIndices(lines)).toEqual(new Map());
  });

  test("only removes → no pairs", () => {
    const lines = [{ kind: "remove" }, { kind: "remove" }];
    expect(pairRemoveAddIndices(lines)).toEqual(new Map());
  });
});

describe("prepareHunksSync", () => {
  test("unified source parses synchronously", () => {
    const data: DiffData = {
      source: "unified",
      text: "@@ -1,1 +1,1 @@\n-old\n+new\n",
    };
    const hunks = prepareHunksSync(data);
    expect(hunks).toHaveLength(1);
    expect(hunks?.[0].lines).toHaveLength(2);
  });

  test("hunks source returns the array as-is", () => {
    const hunks: DiffHunk[] = [
      {
        before_start: 1,
        before_count: 0,
        after_start: 1,
        after_count: 1,
        header: "",
        lines: [
          { kind: "add", content: "x", before_lineno: null, after_lineno: 1 },
        ],
      },
    ];
    expect(prepareHunksSync({ source: "hunks", hunks })).toBe(hunks);
  });

  test("two-text source returns null (resolves async)", () => {
    expect(
      prepareHunksSync({
        source: "two-text",
        before: "a\n",
        after: "b\n",
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Static render — `unified` source
// ---------------------------------------------------------------------------

const FIXTURE_UNIFIED = [
  "@@ -1,5 +1,8 @@",
  "+// lorem ipsum",
  " fn foo() -> Bar {",
  "     let mut foo = 2;",
  "     foo *= 50;",
  '-    println!("hello world")',
  '+    println!("hello world");',
  '+    println!("{foo}");',
  " }",
  "+// foo",
  "",
].join("\n");

describe("DiffBlock — unified source render", () => {
  test("renders header with path basename and +/- stats", () => {
    const { container } = render(
      <DiffBlock
        data={{
          source: "unified",
          text: FIXTURE_UNIFIED,
          filePath: "src/components/foo.tsx",
        }}
      />,
    );

    const root = container.querySelector('[data-slot="diff-body"]');
    expect(root).not.toBeNull();
    expect(root?.getAttribute("data-empty")).toBe("false");

    const path = container.querySelector('[data-slot="diff-path"]');
    expect(path?.textContent).toBe("foo.tsx");
    expect(path?.getAttribute("title")).toBe("src/components/foo.tsx");

    const stats = container.querySelector('[data-slot="diff-stats"]');
    expect(stats).not.toBeNull();
    expect(stats?.textContent).toContain("+4");
    expect(stats?.textContent).toContain("1");
  });

  test("renders an enabled view-mode toggle (label depends on mode)", () => {
    const { container } = render(
      <DiffBlock data={{ source: "unified", text: FIXTURE_UNIFIED }} />,
    );
    const toggle = container.querySelector(
      '[data-slot="diff-view-toggle"]',
    ) as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle?.disabled).toBe(false);
    // Inline mode: button offers to switch *to* side-by-side.
    expect(toggle?.textContent).toBe("Side by side");
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
  });

  test("renders one band per hunk with the @@ header", () => {
    const { container } = render(
      <DiffBlock data={{ source: "unified", text: FIXTURE_UNIFIED }} />,
    );
    const hunks = container.querySelectorAll('[data-slot="diff-hunk"]');
    expect(hunks).toHaveLength(1);
    // The hunk header is a TugCue ([L19] data-slot="tug-cue") wearing the
    // legacy .tugx-diff-hunk-header class so callers can scope styles to
    // it. Querying by the class keeps the test stable across visual
    // refactors that move between body kinds.
    const hunkHeader = hunks[0].querySelector(".tugx-diff-hunk-header");
    expect(hunkHeader?.textContent).toContain("@@ -1,5 +1,8 @@");
  });

  test("each line carries data-kind matching its classification", () => {
    const { container } = render(
      <DiffBlock data={{ source: "unified", text: FIXTURE_UNIFIED }} />,
    );
    const lines = container.querySelectorAll('[data-slot="diff-line"]');
    expect(lines).toHaveLength(9);
    const kinds = Array.from(lines).map((l) => l.getAttribute("data-kind"));
    expect(kinds).toEqual([
      "add",
      "context",
      "context",
      "context",
      "remove",
      "add",
      "add",
      "context",
      "add",
    ]);
  });

  test("gutter columns show before/after line numbers (or empty for the missing side)", () => {
    const { container } = render(
      <DiffBlock data={{ source: "unified", text: FIXTURE_UNIFIED }} />,
    );
    const lines = container.querySelectorAll('[data-slot="diff-line"]');
    // First line is an add — `before` gutter empty, `after` gutter "1".
    const firstBefore = lines[0].querySelector(".tugx-diff-gutter-before");
    const firstAfter = lines[0].querySelector(".tugx-diff-gutter-after");
    expect(firstBefore?.textContent).toBe("");
    expect(firstAfter?.textContent).toBe("1");
    // Removal: before has a number, after empty.
    const removeBefore = lines[4].querySelector(".tugx-diff-gutter-before");
    const removeAfter = lines[4].querySelector(".tugx-diff-gutter-after");
    expect(removeBefore?.textContent).toBe("4");
    expect(removeAfter?.textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Hunk and whole-diff collapse
// ---------------------------------------------------------------------------

describe("DiffBlock — collapse", () => {
  test("clicking the hunk header toggles data-collapsed", () => {
    const { container } = render(
      <DiffBlock data={{ source: "unified", text: FIXTURE_UNIFIED }} />,
    );
    const hunk = container.querySelector(
      '[data-slot="diff-hunk"]',
    ) as HTMLElement;
    expect(hunk.getAttribute("data-collapsed")).toBe("false");
    const header = hunk.querySelector(".tugx-diff-hunk-header") as HTMLElement;
    act(() => {
      fireEvent.click(header);
    });
    expect(hunk.getAttribute("data-collapsed")).toBe("true");
  });

  test("whole-diff toggle collapses all hunks and notifies", () => {
    const onToggleCollapsed = mock(() => {});
    const { container } = render(
      <DiffBlock
        data={{ source: "unified", text: FIXTURE_UNIFIED }}
        onToggleCollapsed={onToggleCollapsed}
      />,
    );
    const root = container.querySelector(
      '[data-slot="diff-body"]',
    ) as HTMLElement;
    expect(root.getAttribute("data-collapsed")).toBe("false");
    // The fold control lives inside `[data-slot="diff-actions"]` —
    // a `flex: 0 0 auto` cluster at the trailing edge of the identity
    // header (Phase D — the dedicated sticky actions row retired).
    // Find it by aria-label so the test stays decoupled from the
    // markup choice (button vs TugIconButton vs TugCue).
    const actions = container.querySelector('[data-slot="diff-actions"]');
    expect(actions).not.toBeNull();
    const toggle = actions?.querySelector(
      'button[aria-label="Collapse diff"]',
    ) as HTMLElement;
    expect(toggle).not.toBeNull();
    act(() => {
      fireEvent.click(toggle);
    });
    expect(root.getAttribute("data-collapsed")).toBe("true");
    expect(onToggleCollapsed).toHaveBeenCalledWith(true);
    // Hunks vanish.
    expect(container.querySelectorAll('[data-slot="diff-hunk"]')).toHaveLength(
      0,
    );
    // Fold cue stays present (now labeled "Expand diff" via the
    // aria-label) with the count label "N hunks" so the user can
    // expand back. The cue label is the same in both fold states;
    // only the chevron icon flips and the aria-label verb swaps.
    const cue = actions?.querySelector(
      "button.tugx-diff-fold-cue",
    ) as HTMLElement;
    expect(cue?.getAttribute("aria-label")).toBe("Expand diff");
    expect(cue?.textContent).toContain("hunk");
  });

  test("controlled `collapsed` prop wins over internal state on rerender", () => {
    const { container, rerender } = render(
      <DiffBlock
        data={{ source: "unified", text: FIXTURE_UNIFIED }}
        collapsed={false}
      />,
    );
    const root = container.querySelector(
      '[data-slot="diff-body"]',
    ) as HTMLElement;
    expect(root.getAttribute("data-collapsed")).toBe("false");
    rerender(
      <DiffBlock
        data={{ source: "unified", text: FIXTURE_UNIFIED }}
        collapsed={true}
      />,
    );
    expect(root.getAttribute("data-collapsed")).toBe("true");
  });

  test("controlled `collapsed` prop overrides local state; click fires callback but doesn't write local state", () => {
    // Phase E.1 — `collapsed` is computed from `collapsedProp ??
    // localCollapsed` on every render. When the parent provides
    // `collapsed`, the prop wins; toggling the cue only notifies
    // via `onToggleCollapsed`. The parent is responsible for
    // re-rendering with a new value.
    const onToggle = mock((_next: boolean) => {});
    const { container, rerender } = render(
      <DiffBlock
        data={{ source: "unified", text: FIXTURE_UNIFIED }}
        collapsed={true}
        onToggleCollapsed={onToggle}
      />,
    );
    const root = container.querySelector(
      '[data-slot="diff-body"]',
    ) as HTMLElement;
    expect(root.getAttribute("data-collapsed")).toBe("true");
    const cue = container.querySelector(
      "button.tugx-diff-fold-cue",
    ) as HTMLElement;
    fireEvent.click(cue);
    // Callback fires with the requested next value...
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle.mock.calls[0]?.[0]).toBe(false);
    // ...but the visible state stays as the parent's prop says.
    expect(root.getAttribute("data-collapsed")).toBe("true");

    rerender(
      <DiffBlock
        data={{ source: "unified", text: FIXTURE_UNIFIED }}
        collapsed={false}
        onToggleCollapsed={onToggle}
      />,
    );
    expect(root.getAttribute("data-collapsed")).toBe("false");
  });

  test("embedded mode portals fold cue + view-toggle into the chrome's actions slot", () => {
    // Phase D — embedded composition portals resting affordances into
    // `ToolWrapperChrome`'s actions slot via `ChromeActionsTargetContext`.
    // The `data-slot="diff-actions"` cluster carries the affordances
    // regardless of where it lands in the DOM tree.
    const { container } = render(
      <ToolWrapperChrome toolName="Edit">
        <DiffBlock
          data={{ source: "unified", text: FIXTURE_UNIFIED }}
          embedded
        />
      </ToolWrapperChrome>,
    );
    const chromeActionsSlot = container.querySelector(
      "[data-slot='tool-wrapper-actions']",
    );
    expect(chromeActionsSlot).not.toBeNull();
    const cluster = chromeActionsSlot?.querySelector(
      '[data-slot="diff-actions"]',
    );
    expect(cluster).not.toBeNull();
    // Both affordances surface.
    expect(cluster?.querySelector("button.tugx-diff-fold-cue")).not.toBeNull();
    expect(
      cluster?.querySelector('[data-slot="diff-view-toggle"]'),
    ).not.toBeNull();
  });

  test("embedded={true} without a parent chrome fires a dev-mode console.warn", async () => {
    // Phase E.2 — see file-block.test.tsx for the contract. The
    // warn is deferred one tick so the chrome's first-render
    // ref-callback → re-render cycle has a chance to publish the
    // actions target.
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(
        <DiffBlock
          data={{ source: "unified", text: FIXTURE_UNIFIED }}
          embedded
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const calls = warnSpy.mock.calls as ReadonlyArray<
        ReadonlyArray<unknown>
      >;
      const messages = calls
        .map((call) => call[0])
        .filter((arg): arg is string => typeof arg === "string");
      const own = messages.filter((m) => m.includes("DiffBlock"));
      expect(own.length).toBeGreaterThanOrEqual(1);
      expect(own[0]).toContain("embedded");
      expect(own[0]).toContain("ToolWrapperChrome");
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("embedded={true} INSIDE a chrome does NOT fire the dev-warn", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(
        <ToolWrapperChrome toolName="Edit">
          <DiffBlock
            data={{ source: "unified", text: FIXTURE_UNIFIED }}
            embedded
          />
        </ToolWrapperChrome>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const calls = warnSpy.mock.calls as ReadonlyArray<
        ReadonlyArray<unknown>
      >;
      const messages = calls
        .map((call) => call[0])
        .filter((arg): arg is string => typeof arg === "string");
      const own = messages.filter(
        (m) => m.includes("DiffBlock") && m.includes("embedded"),
      );
      expect(own.length).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Side-by-side row grouping
// ---------------------------------------------------------------------------

describe("groupSideBySideRows", () => {
  function makeLine(
    kind: DiffLine["kind"],
    content: string,
    before: number | null,
    after: number | null,
  ): DiffLine {
    return {
      kind,
      content,
      before_lineno: before,
      after_lineno: after,
    };
  }

  test("context lines render in both cells, paired = false", () => {
    const lines = [makeLine("context", "hello", 1, 1)];
    const rows = groupSideBySideRows(lines);
    expect(rows).toHaveLength(1);
    expect(rows[0].left).toBe(lines[0]);
    expect(rows[0].right).toBe(lines[0]);
    expect(rows[0].paired).toBe(false);
  });

  test("a single remove + add pair zips into one paired row", () => {
    const lines = [
      makeLine("remove", "old", 1, null),
      makeLine("add", "new", null, 1),
    ];
    const rows = groupSideBySideRows(lines);
    expect(rows).toHaveLength(1);
    expect(rows[0].left).toBe(lines[0]);
    expect(rows[0].right).toBe(lines[1]);
    expect(rows[0].paired).toBe(true);
  });

  test("two removes + two adds zip index-for-index", () => {
    const lines = [
      makeLine("remove", "r1", 1, null),
      makeLine("remove", "r2", 2, null),
      makeLine("add", "a1", null, 1),
      makeLine("add", "a2", null, 2),
    ];
    const rows = groupSideBySideRows(lines);
    expect(rows).toHaveLength(2);
    expect(rows[0].left?.content).toBe("r1");
    expect(rows[0].right?.content).toBe("a1");
    expect(rows[1].left?.content).toBe("r2");
    expect(rows[1].right?.content).toBe("a2");
    expect(rows.every((r) => r.paired)).toBe(true);
  });

  test("lone remove leaves right cell null (not paired)", () => {
    const lines = [makeLine("remove", "gone", 1, null)];
    const rows = groupSideBySideRows(lines);
    expect(rows).toHaveLength(1);
    expect(rows[0].left).toBe(lines[0]);
    expect(rows[0].right).toBeNull();
    expect(rows[0].paired).toBe(false);
  });

  test("lone add leaves left cell null (not paired)", () => {
    const lines = [makeLine("add", "new", null, 1)];
    const rows = groupSideBySideRows(lines);
    expect(rows).toHaveLength(1);
    expect(rows[0].left).toBeNull();
    expect(rows[0].right).toBe(lines[0]);
    expect(rows[0].paired).toBe(false);
  });

  test("[remove, add, add] yields one paired + one lone-add", () => {
    const lines = [
      makeLine("remove", "r1", 1, null),
      makeLine("add", "a1", null, 1),
      makeLine("add", "a2", null, 2),
    ];
    const rows = groupSideBySideRows(lines);
    expect(rows).toHaveLength(2);
    expect(rows[0].paired).toBe(true);
    expect(rows[1].left).toBeNull();
    expect(rows[1].right?.content).toBe("a2");
  });

  test("context surrounded by changes preserves boundaries", () => {
    const lines = [
      makeLine("context", "ctx1", 1, 1),
      makeLine("remove", "r1", 2, null),
      makeLine("add", "a1", null, 2),
      makeLine("context", "ctx2", 3, 3),
    ];
    const rows = groupSideBySideRows(lines);
    expect(rows).toHaveLength(3);
    expect(rows[0].paired).toBe(false); // context
    expect(rows[1].paired).toBe(true);
    expect(rows[2].paired).toBe(false); // context
  });

  test("rows carry leftIndex / rightIndex into the source hunk", () => {
    // Crucial for the inline + sbs renderers to share a single
    // precomputed `wordRangesByLineIndex` map without an O(n)
    // `indexOf` scan per row.
    const lines = [
      makeLine("context", "c", 1, 1),
      makeLine("remove", "r1", 2, null),
      makeLine("remove", "r2", 3, null),
      makeLine("add", "a1", null, 2),
      makeLine("add", "a2", null, 3),
    ];
    const rows = groupSideBySideRows(lines);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ leftIndex: 0, rightIndex: 0 });
    expect(rows[1]).toMatchObject({ leftIndex: 1, rightIndex: 3, paired: true });
    expect(rows[2]).toMatchObject({ leftIndex: 2, rightIndex: 4, paired: true });
  });

  test("blank cells get leftIndex/rightIndex = null", () => {
    const lines = [
      makeLine("remove", "gone", 1, null),
      makeLine("add", "new", null, 1),
      makeLine("add", "extra", null, 2),
    ];
    const rows = groupSideBySideRows(lines);
    expect(rows[0]).toMatchObject({ leftIndex: 0, rightIndex: 1, paired: true });
    expect(rows[1]).toMatchObject({ leftIndex: null, rightIndex: 2, paired: false });
  });
});

// ---------------------------------------------------------------------------
// View mode + tugbank persistence
// ---------------------------------------------------------------------------

describe("DiffBlock — viewMode toggle and persistence", () => {
  test("default mode is inline; data-view-mode reflects it", () => {
    const { container } = render(
      <DiffBlock data={{ source: "unified", text: FIXTURE_UNIFIED }} />,
    );
    const root = container.querySelector(
      '[data-slot="diff-body"]',
    ) as HTMLElement;
    expect(root.getAttribute("data-view-mode")).toBe("inline");
  });

  test("viewMode prop is honored on initial render", () => {
    const { container } = render(
      <DiffBlock
        data={{ source: "unified", text: FIXTURE_UNIFIED }}
        viewMode="side-by-side"
      />,
    );
    const root = container.querySelector(
      '[data-slot="diff-body"]',
    ) as HTMLElement;
    expect(root.getAttribute("data-view-mode")).toBe("side-by-side");
    // Side-by-side: rows render `data-slot="diff-sbs-row"` cells, not
    // the inline `diff-line` rows.
    expect(
      container.querySelectorAll('[data-slot="diff-sbs-row"]').length,
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll('[data-slot="diff-line"]').length,
    ).toBe(0);
  });

  test("clicking the toggle flips the mode and updates the layout", () => {
    const { container } = render(
      <DiffBlock data={{ source: "unified", text: FIXTURE_UNIFIED }} />,
    );
    const toggle = container.querySelector(
      '[data-slot="diff-view-toggle"]',
    ) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    act(() => {
      fireEvent.click(toggle);
    });
    const root = container.querySelector(
      '[data-slot="diff-body"]',
    ) as HTMLElement;
    expect(root.getAttribute("data-view-mode")).toBe("side-by-side");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.textContent).toBe("Inline");
  });

  test("controlled viewMode prop wins on rerender", () => {
    const { container, rerender } = render(
      <DiffBlock
        data={{ source: "unified", text: FIXTURE_UNIFIED }}
        viewMode="inline"
      />,
    );
    const root = container.querySelector(
      '[data-slot="diff-body"]',
    ) as HTMLElement;
    expect(root.getAttribute("data-view-mode")).toBe("inline");
    rerender(
      <DiffBlock
        data={{ source: "unified", text: FIXTURE_UNIFIED }}
        viewMode="side-by-side"
      />,
    );
    expect(root.getAttribute("data-view-mode")).toBe("side-by-side");
  });

  test("tugbank-saved preference seeds the initial mode (no flash)", () => {
    seedTugbank({
      "dev.tugtool.tide.diff-view": { "card-42": "side-by-side" },
    });
    const { container } = render(
      <DiffBlock
        data={{ source: "unified", text: FIXTURE_UNIFIED }}
        cardId="card-42"
      />,
    );
    const root = container.querySelector(
      '[data-slot="diff-body"]',
    ) as HTMLElement;
    // First render already reflects the saved preference.
    expect(root.getAttribute("data-view-mode")).toBe("side-by-side");
  });

  test("clicking the toggle PUTs to /api/defaults/dev.tugtool.tide.diff-view/<cardId>", () => {
    const fetchMock = mock(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const { container } = render(
        <DiffBlock
          data={{ source: "unified", text: FIXTURE_UNIFIED }}
          cardId="card-99"
        />,
      );
      const toggle = container.querySelector(
        '[data-slot="diff-view-toggle"]',
      ) as HTMLButtonElement;
      act(() => {
        fireEvent.click(toggle);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const [url, init] = call;
      expect(url).toBe("/api/defaults/dev.tugtool.tide.diff-view/card-99");
      expect(init.method).toBe("PUT");
      expect(init.body).toBe(
        JSON.stringify({ kind: "string", value: "side-by-side" }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("onViewModeChange callback fires on toggle", () => {
    const onChange = mock(() => {});
    const { container } = render(
      <DiffBlock
        data={{ source: "unified", text: FIXTURE_UNIFIED }}
        onViewModeChange={onChange}
      />,
    );
    const toggle = container.querySelector(
      '[data-slot="diff-view-toggle"]',
    ) as HTMLButtonElement;
    act(() => {
      fireEvent.click(toggle);
    });
    expect(onChange).toHaveBeenCalledWith("side-by-side");
  });
});

// ---------------------------------------------------------------------------
// Side-by-side render markup
// ---------------------------------------------------------------------------

describe("DiffBlock — side-by-side render", () => {
  test("paired remove+add appears as a single row with both cells filled", () => {
    const fixture = [
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    const { container } = render(
      <DiffBlock
        data={{ source: "unified", text: fixture }}
        viewMode="side-by-side"
      />,
    );
    const rows = container.querySelectorAll('[data-slot="diff-sbs-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-paired")).toBe("true");
    const cells = rows[0].querySelectorAll('[data-slot="diff-sbs-cell"]');
    expect(cells).toHaveLength(2);
    expect(cells[0].getAttribute("data-side")).toBe("left");
    expect(cells[0].getAttribute("data-kind")).toBe("remove");
    expect(cells[1].getAttribute("data-side")).toBe("right");
    expect(cells[1].getAttribute("data-kind")).toBe("add");
  });

  test("lone remove leaves right cell as kind=blank", () => {
    const fixture = ["@@ -1,2 +1,1 @@", " keep", "-gone", ""].join("\n");
    const { container } = render(
      <DiffBlock
        data={{ source: "unified", text: fixture }}
        viewMode="side-by-side"
      />,
    );
    const rows = container.querySelectorAll('[data-slot="diff-sbs-row"]');
    // Row 0: context. Row 1: lone remove + blank.
    expect(rows).toHaveLength(2);
    const removeRowCells = rows[1].querySelectorAll(
      '[data-slot="diff-sbs-cell"]',
    );
    expect(removeRowCells[0].getAttribute("data-kind")).toBe("remove");
    expect(removeRowCells[1].getAttribute("data-kind")).toBe("blank");
  });

  test("lone add leaves left cell as kind=blank", () => {
    const fixture = ["@@ -1,1 +1,2 @@", " keep", "+new", ""].join("\n");
    const { container } = render(
      <DiffBlock
        data={{ source: "unified", text: fixture }}
        viewMode="side-by-side"
      />,
    );
    const rows = container.querySelectorAll('[data-slot="diff-sbs-row"]');
    const addRowCells = rows[1].querySelectorAll(
      '[data-slot="diff-sbs-cell"]',
    );
    expect(addRowCells[0].getAttribute("data-kind")).toBe("blank");
    expect(addRowCells[1].getAttribute("data-kind")).toBe("add");
  });

  test("context line emits the same content in both cells", () => {
    const fixture = ["@@ -1,1 +1,1 @@", " same", ""].join("\n");
    const { container } = render(
      <DiffBlock
        data={{ source: "unified", text: fixture }}
        viewMode="side-by-side"
      />,
    );
    const rows = container.querySelectorAll('[data-slot="diff-sbs-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-paired")).toBe("false");
    const contents = rows[0].querySelectorAll(".tugx-diff-content");
    expect(contents[0].textContent).toBe("same");
    expect(contents[1].textContent).toBe("same");
  });
});

// ---------------------------------------------------------------------------
// Two-text source — lazy WASM resolution
// ---------------------------------------------------------------------------

const STUB_HUNK: DiffHunk = {
  before_start: 1,
  before_count: 1,
  after_start: 1,
  after_count: 1,
  header: "",
  lines: [
    { kind: "remove", content: "alpha", before_lineno: 1, after_lineno: null },
    { kind: "add", content: "beta", before_lineno: null, after_lineno: 1 },
  ],
};

function makeStubEngine(hunks: DiffHunk[]): TugdiffEngine {
  return {
    parse_unified_diff: () => hunks,
    two_text_diff: () => hunks,
  };
}

describe("DiffBlock — two-text source", () => {
  test("renders 'Computing diff…' placeholder until the engine resolves", () => {
    // Give the loader a never-resolving promise so the placeholder
    // sticks around for the assertion. Achieved by injecting an engine
    // *after* the test verifies the placeholder renders, but here we
    // just check the synchronous mount state.
    const { container } = render(
      <DiffBlock
        data={{ source: "two-text", before: "alpha\n", after: "beta\n" }}
      />,
    );
    const loading = container.querySelector('[data-slot="diff-loading"]');
    expect(loading).not.toBeNull();
    expect(loading?.textContent).toContain("Computing diff");
  });

  test("resolves with stub engine and renders hunks", async () => {
    injectTugdiffWasmForTests(makeStubEngine([STUB_HUNK]));
    const { container, findByText } = render(
      <DiffBlock
        data={{ source: "two-text", before: "alpha\n", after: "beta\n" }}
      />,
    );
    // The placeholder is still in the DOM synchronously; await the
    // engine load → state update → re-render.
    await findByText(/^@@ -1 \+1 @@/);

    expect(container.querySelectorAll('[data-slot="diff-line"]')).toHaveLength(
      2,
    );
    expect(
      container.querySelector('[data-slot="diff-loading"]'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Word-level intra-line highlight
// ---------------------------------------------------------------------------

describe("DiffBlock — word-level highlight", () => {
  test("paired remove/add lines render `<span class='tugx-diff-word-*'>` after the engine loads", async () => {
    // The DiffBlock dynamically imports diff-match-patch. To
    // assert the post-load DOM, we render synchronously, then poll
    // for the spans to appear (the import is synchronous in bun's
    // module cache once `diff-match-patch` has been resolved by
    // any prior test in the same worker — and we already imported
    // it at the top of this file, so the module is cached).
    void dmp; // ensure the module load happened

    const fixture = [
      "@@ -1,1 +1,1 @@",
      '-println!("hello world")',
      '+println!("hello world");',
      "",
    ].join("\n");

    const { container, findByText } = render(
      <DiffBlock data={{ source: "unified", text: fixture }} />,
    );

    // The "+" version's trailing ";" should appear inside an
    // insert span on the add line. Using findByText to wait for
    // the post-`useEffect` DOM update.
    await findByText(";", { selector: ".tugx-diff-word-add" });
    const addSpans = container.querySelectorAll(".tugx-diff-word-add");
    expect(addSpans.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Empty / undefined data
// ---------------------------------------------------------------------------

describe("DiffBlock — empty / undefined inputs", () => {
  test("undefined data renders an empty marker root", () => {
    const { container } = render(<DiffBlock />);
    const root = container.querySelector('[data-slot="diff-body"]');
    expect(root).not.toBeNull();
    expect(root?.getAttribute("data-empty")).toBe("true");
  });

  test("empty hunks render a header with 0/0 stats and no hunk bands", () => {
    const { container } = render(
      <DiffBlock data={{ source: "hunks", hunks: [], filePath: "foo.tsx" }} />,
    );
    expect(
      container.querySelectorAll('[data-slot="diff-hunk"]'),
    ).toHaveLength(0);
    const stats = container.querySelector('[data-slot="diff-stats"]');
    expect(stats?.textContent).toContain("+0");
    expect(stats?.textContent).toContain("0");
  });
});

// ---------------------------------------------------------------------------
// Shiki + word-level merge — integration tests
// ---------------------------------------------------------------------------

describe("DiffBlock — Shiki integration", () => {
  test("known-extension filePath triggers Shiki load and produces a styled segment", async () => {
    // Stub Shiki: pretend `let x = 1` and `var x = 1` come out with
    // distinct color tokens so we can verify the merge plumbing.
    shikiBehavior = {
      kind: "stub",
      htmlByLine: new Map([
        [
          "let x = 1",
          '<span style="color:#79B8FF">let</span>' +
            '<span style="color:#E1E4E8"> x = </span>' +
            '<span style="color:#79B8FF">1</span>',
        ],
        [
          "var x = 1",
          '<span style="color:#79B8FF">var</span>' +
            '<span style="color:#E1E4E8"> x = </span>' +
            '<span style="color:#79B8FF">1</span>',
        ],
      ]),
    };
    const fixture = ["@@ -1,1 +1,1 @@", "-let x = 1", "+var x = 1", ""].join(
      "\n",
    );

    const { container, findAllByText } = render(
      <DiffBlock
        data={{ source: "unified", text: fixture, filePath: "foo.ts" }}
      />,
    );

    // Wait for the async Shiki effect to populate the syntax map and
    // re-render. Both the remove and add lines are paired, so the
    // word-level overlay also runs.
    await findAllByText("let", { selector: ".tugx-diff-word-remove" });

    // The remove line's `let` should carry both the remove class
    // AND a Shiki color style. happy-dom's CSSOM may not roundtrip
    // hex colors via `style.color` (returns ""), so check the raw
    // attribute instead.
    const removeWord = container.querySelector(
      ".tugx-diff-line[data-kind='remove'] .tugx-diff-word-remove",
    ) as HTMLElement;
    expect(removeWord).not.toBeNull();
    expect(removeWord.textContent).toBe("let");
    // happy-dom's CSSOM may not roundtrip hex colors via `style.color`
    // (returns ""), so check the raw attribute instead.
    expect(removeWord.getAttribute("style") ?? "").toContain("color");

    // The add line's `var` mirrors that for the add side.
    const addWord = container.querySelector(
      ".tugx-diff-line[data-kind='add'] .tugx-diff-word-add",
    ) as HTMLElement;
    expect(addWord).not.toBeNull();
    expect(addWord.textContent).toBe("var");
    expect(addWord.getAttribute("style") ?? "").toContain("color");
  });

  test("unchanged context line gets Shiki styling but no word-level class", async () => {
    shikiBehavior = {
      kind: "stub",
      htmlByLine: new Map([
        [
          "fn foo()",
          '<span style="color:#79B8FF">fn</span>' +
            '<span style="color:#E1E4E8"> foo()</span>',
        ],
        ["-old", '<span style="color:#abc">-old</span>'],
        ["+new", '<span style="color:#abc">+new</span>'],
      ]),
    };
    const fixture = [
      "@@ -1,2 +1,2 @@",
      " fn foo()",
      "-old",
      "+new",
      "",
    ].join("\n");

    const { container, findByText } = render(
      <DiffBlock
        data={{ source: "unified", text: fixture, filePath: "foo.ts" }}
      />,
    );

    // Wait for Shiki to populate.
    await findByText("fn", { selector: ".tugx-diff-line[data-kind='context'] span" });

    const contextLine = container.querySelector(
      ".tugx-diff-line[data-kind='context'] .tugx-diff-content",
    ) as HTMLElement;
    // No word-level class on context spans:
    expect(contextLine.querySelector(".tugx-diff-word-add")).toBeNull();
    expect(contextLine.querySelector(".tugx-diff-word-remove")).toBeNull();
    // But Shiki styled spans are present:
    const styledSpans = contextLine.querySelectorAll("span[style]");
    expect(styledSpans.length).toBeGreaterThan(0);
  });

  test("graceful degradation: Shiki load failure leaves word overlay intact", async () => {
    shikiBehavior = { kind: "throw" };
    const fixture = ["@@ -1,1 +1,1 @@", "-old", "+new", ""].join("\n");

    const { container, findAllByText } = render(
      <DiffBlock
        data={{ source: "unified", text: fixture, filePath: "foo.ts" }}
      />,
    );

    // Even though Shiki failed, the word-level overlay (loaded
    // separately via `diff-match-patch`) should still produce
    // `tugx-diff-word-*` spans.
    await findAllByText("old", { selector: ".tugx-diff-word-remove" });

    // No `style` attribute on the highlighted word — that would be
    // present only if Shiki had succeeded.
    const removeWord = container.querySelector(
      ".tugx-diff-word-remove",
    ) as HTMLElement;
    expect(removeWord.textContent).toBe("old");
    expect(removeWord.getAttribute("style")).toBeNull();

    // The add line's text remains visible (no missing content).
    const addLine = container.querySelector(
      ".tugx-diff-line[data-kind='add'] .tugx-diff-content",
    ) as HTMLElement;
    expect(addLine.textContent).toBe("new");
  });

  test("unknown extension does not attempt to load Shiki", async () => {
    // Configure shikiBehavior to throw if invoked. Using an unknown
    // extension means the loader effect early-returns and never
    // reaches the mocked import.
    shikiBehavior = { kind: "throw" };
    const fixture = ["@@ -1,1 +1,1 @@", "-old", "+new", ""].join("\n");

    const { container } = render(
      <DiffBlock
        data={{ source: "unified", text: fixture, filePath: "data.unknownext" }}
      />,
    );
    // Synchronous content render: line text is present.
    const removeContent = container.querySelector(
      ".tugx-diff-line[data-kind='remove'] .tugx-diff-content",
    ) as HTMLElement;
    expect(removeContent.textContent).toBe("old");
    // No styled span (Shiki didn't run).
    expect(removeContent.querySelector("span[style]")).toBeNull();
  });
});
