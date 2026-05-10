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
 *    behind a "N hunks folded" hint and notifies via
 *    `onToggleCollapsed`.
 *  - Word-level highlight: when a paired remove/add lands and the
 *    diff-match-patch engine resolves, the `<span class="tugx-diff-word-*">`
 *    spans appear inside the line content.
 *
 * Per the user's happy-dom rule, this file does not exercise focus,
 * selection, or event-ordering across React renders — only mounted
 * markup, attribute toggles, and click-driven state changes.
 */

import "../../../../__tests__/setup-rtl";

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import dmp from "diff-match-patch";
import React from "react";

import {
  DiffBlock,
  basename,
  composeHunkHeader,
  pairRemoveAddIndices,
  prepareHunksSync,
} from "../diff-block";
import {
  injectTugdiffWasmForTests,
  resetTugdiffWasmForTests,
  type TugdiffEngine,
} from "@/lib/lazy/load-tugdiff-wasm";
import type { DiffData, DiffHunk } from "@/lib/diff/types";

afterEach(() => {
  cleanup();
  resetTugdiffWasmForTests();
});

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

  test("remove without immediate add → unpaired", () => {
    const lines = [
      { kind: "remove" },
      { kind: "remove" },
      { kind: "add" },
    ];
    expect(pairRemoveAddIndices(lines)).toEqual(new Map([[1, 2]]));
  });

  test("only adds → no pairs", () => {
    const lines = [{ kind: "add" }, { kind: "add" }];
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

  test("renders side-by-side toggle as a disabled stub", () => {
    const { container } = render(
      <DiffBlock data={{ source: "unified", text: FIXTURE_UNIFIED }} />,
    );
    const toggle = container.querySelector(
      '[data-slot="diff-view-toggle"]',
    ) as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle?.disabled).toBe(true);
    expect(toggle?.getAttribute("title")).toContain("coming soon");
  });

  test("renders one band per hunk with the @@ header", () => {
    const { container } = render(
      <DiffBlock data={{ source: "unified", text: FIXTURE_UNIFIED }} />,
    );
    const hunks = container.querySelectorAll('[data-slot="diff-hunk"]');
    expect(hunks).toHaveLength(1);
    const hunkHeader = hunks[0].querySelector(
      '[data-slot="diff-hunk-header"]',
    );
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
    const header = hunk.querySelector(
      '[data-slot="diff-hunk-header"]',
    ) as HTMLElement;
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
    const toggle = container.querySelector(
      '[data-slot="diff-toggle"]',
    ) as HTMLElement;
    act(() => {
      fireEvent.click(toggle);
    });
    expect(root.getAttribute("data-collapsed")).toBe("true");
    expect(onToggleCollapsed).toHaveBeenCalledWith(true);
    // Hunks vanish; the collapsed-hint surfaces.
    expect(container.querySelectorAll('[data-slot="diff-hunk"]')).toHaveLength(
      0,
    );
    expect(
      container.querySelector('[data-slot="diff-collapsed-hint"]'),
    ).not.toBeNull();
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
