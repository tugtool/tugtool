/**
 * `FileBlock` — body-kind tests.
 *
 * After the engine swap to `TugCodeView`, `FileBlock` is a thin
 * chrome around the substrate. This test scope is correspondingly
 * narrow:
 *
 *  - Pure helpers: `detectLanguage`, `splitContentLines`, `basename`,
 *    `composeLineCountLabel`.
 *  - Static markup: header surfaces the basename + lang badge + line
 *    counts; expanded files render a `TugCodeView`; collapsed files
 *    render a `TugCue` reveal cue instead.
 *  - Long-file collapse: at the threshold renders expanded; above
 *    the threshold collapses by default; the collapsed branch shows
 *    the cue, not the substrate.
 *  - Controlled collapse: `collapsed={true}` honored; collapse
 *    `<TugIconButton>` toggles via `onToggleCollapsed`.
 *  - Search affordance: the identity header's trailing affordances
 *    cluster surfaces a `Search` `<TugIconButton>` when expanded;
 *    the underlying find-panel behavior (panel mount / keystroke
 *    wiring) is covered in `tug-code-view.test.tsx`.
 *  - Embedded mode: header is suppressed; affordances portal into
 *    the host `ToolWrapperChrome`'s actions slot (Phase D).
 *
 * What this test file intentionally does NOT cover (post-recast):
 *  - The per-line click-to-copy gesture (retired with the bespoke
 *    renderer; native CM6 selection + Cmd-C is the new path).
 *  - Bespoke search-bar markup (`data-slot="file-search-*"`) — the
 *    find panel comes from `@codemirror/search` now and is exercised
 *    via the substrate-level tests.
 *  - Shiki injection (retired; syntax highlighting will return as a
 *    CM6 bridge in a follow-up).
 */

import "../../../../__tests__/setup-rtl";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";

import {
  FileBlock,
  DEFAULT_COLLAPSE_THRESHOLD,
  basename,
  composeLineCountLabel,
  detectLanguage,
  splitContentLines,
  type FileData,
} from "../file-block";
import { ToolWrapperChrome } from "@/components/tugways/cards/tool-wrappers/tool-wrapper-chrome";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("detectLanguage", () => {
  test("common TypeScript / JavaScript extensions", () => {
    expect(detectLanguage("foo.ts")).toBe("typescript");
    expect(detectLanguage("path/to/foo.tsx")).toBe("tsx");
    expect(detectLanguage("foo.js")).toBe("javascript");
    expect(detectLanguage("/abs/foo.jsx")).toBe("jsx");
  });

  test("script extensions normalize to shellscript", () => {
    expect(detectLanguage("script.sh")).toBe("shellscript");
    expect(detectLanguage("script.bash")).toBe("shellscript");
    expect(detectLanguage("script.zsh")).toBe("shellscript");
  });

  test("bare-name special cases (Dockerfile / Makefile)", () => {
    expect(detectLanguage("Dockerfile")).toBe("dockerfile");
    expect(detectLanguage("path/to/Dockerfile")).toBe("dockerfile");
    expect(detectLanguage("Makefile")).toBe("makefile");
    expect(detectLanguage("path/to/makefile")).toBe("makefile");
  });

  test("unknown extensions return undefined", () => {
    expect(detectLanguage("foo.xyz")).toBeUndefined();
    expect(detectLanguage("foo")).toBeUndefined();
    expect(detectLanguage("")).toBeUndefined();
  });

  test("hidden files with no extension return undefined", () => {
    expect(detectLanguage(".gitignore")).toBeUndefined();
  });

  test("trailing-dot input returns undefined", () => {
    expect(detectLanguage("foo.")).toBeUndefined();
  });
});

describe("splitContentLines", () => {
  test("two-line input with no trailing newline", () => {
    expect(splitContentLines("alpha\nbeta")).toEqual(["alpha", "beta"]);
  });

  test("trailing newline does NOT produce a final empty line", () => {
    expect(splitContentLines("alpha\nbeta\n")).toEqual(["alpha", "beta"]);
  });

  test("empty input returns the empty array", () => {
    expect(splitContentLines("")).toEqual([]);
  });

  test("single line with no newline", () => {
    expect(splitContentLines("alpha")).toEqual(["alpha"]);
  });

  test("preserves blank lines in the middle", () => {
    expect(splitContentLines("a\n\nb")).toEqual(["a", "", "b"]);
  });
});

describe("composeLineCountLabel", () => {
  test("totalLines unknown → 'N lines'", () => {
    expect(composeLineCountLabel(5, undefined)).toBe("5 lines");
  });

  test("totalLines equals numLines → 'N lines'", () => {
    expect(composeLineCountLabel(5, 5)).toBe("5 lines");
  });

  test("totalLines greater than numLines → 'Showing N of M lines'", () => {
    expect(composeLineCountLabel(5, 50)).toBe("Showing 5 of 50 lines");
  });

  test("singular 1 line", () => {
    expect(composeLineCountLabel(1, undefined)).toBe("1 line");
  });
});

describe("basename", () => {
  test("plain filename", () => {
    expect(basename("foo.ts")).toBe("foo.ts");
  });

  test("path with forward slashes", () => {
    expect(basename("/a/b/foo.ts")).toBe("foo.ts");
  });

  test("path with backslashes (Windows)", () => {
    expect(basename("a\\b\\foo.ts")).toBe("foo.ts");
  });

  test("empty input", () => {
    expect(basename("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Header markup
// ---------------------------------------------------------------------------

describe("FileBlock — header markup", () => {
  test("renders basename + lang pill + counts", () => {
    const data: FileData = {
      filePath: "path/to/example.ts",
      content: "alpha\nbeta",
    };
    const { container } = render(<FileBlock data={data} />);
    expect(container.querySelector('[data-slot="file-path"]')?.textContent)
      .toBe("example.ts");
    expect(container.querySelector('[data-slot="file-lang"]')?.textContent)
      .toBe("typescript");
    expect(container.querySelector('[data-slot="file-counts"]')?.textContent)
      .toBe("2 lines");
  });

  test("stamps data-language on the root", () => {
    const data: FileData = {
      filePath: "x.py",
      content: "print('hi')",
    };
    const { container } = render(<FileBlock data={data} />);
    const root = container.querySelector('[data-slot="file-body"]');
    expect(root?.getAttribute("data-language")).toBe("python");
  });

  test("unknown extension stamps data-language=plain and omits lang pill", () => {
    const data: FileData = {
      filePath: "x.unknown",
      content: "hello",
    };
    const { container } = render(<FileBlock data={data} />);
    expect(
      container.querySelector('[data-slot="file-body"]')?.getAttribute("data-language"),
    ).toBe("plain");
    expect(container.querySelector('[data-slot="file-lang"]')).toBeNull();
  });

  test("totalLines drives 'Showing N of M' header", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: "alpha\nbeta",
      totalLines: 100,
    };
    const { container } = render(<FileBlock data={data} />);
    expect(container.querySelector('[data-slot="file-counts"]')?.textContent)
      .toBe("Showing 2 of 100 lines");
  });
});

// ---------------------------------------------------------------------------
// Body branch — TugCodeView vs collapsed cue
// ---------------------------------------------------------------------------

describe("FileBlock — body branches", () => {
  test("expanded short file renders a TugCodeView in the body, no fold cue", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: "alpha\nbeta",
    };
    const { container } = render(<FileBlock data={data} />);
    expect(container.querySelector('[data-slot="tug-code-view"]')).not.toBeNull();
    // Under-threshold files don't get a fold cue at all — there's
    // nothing to fold.
    expect(container.querySelector(".tugx-file-fold-cue")).toBeNull();
  });

  test("collapsed file shows the fold cue, not the substrate", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(200),
    };
    const { container } = render(<FileBlock data={data} />);
    // Above threshold ⇒ default collapsed; cue is the click target.
    const cue = container.querySelector(".tugx-file-fold-cue") as HTMLElement;
    expect(cue).not.toBeNull();
    expect(cue.getAttribute("aria-expanded")).toBe("false");
    // Cue label is the line count — same in both fold states (only
    // the chevron icon flips). aria-label carries the verb for
    // screen readers.
    expect(cue.textContent).toContain("200 lines");
    expect(cue.getAttribute("aria-label")).toBe("Expand file");
    expect(container.querySelector('[data-slot="tug-code-view"]')).toBeNull();
  });

  test("expanded long file STILL shows the fold cue (collapse handle)", () => {
    // The fold cue is the persistent click target across both states.
    // Without this, embedded-mode hosts (which hide the header) would
    // lose the toggle once expanded — the user could expand but not
    // collapse back. The cue keeps the toggle reachable in both states.
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(200),
    };
    const { container } = render(<FileBlock data={data} collapsed={false} />);
    const cue = container.querySelector(".tugx-file-fold-cue") as HTMLElement;
    expect(cue).not.toBeNull();
    expect(cue.getAttribute("aria-expanded")).toBe("true");
    // Expanded form is icon-only (compact form); the accessible name
    // lives on the `aria-label` attribute so screen readers still
    // announce the control. The cue is a `TugPushButton` (Phase D)
    // with subtype="icon" in this state, so the rendered DOM carries
    // an inner SVG icon.
    expect(cue.getAttribute("aria-label")).toBe("Collapse file");
    expect(cue.querySelector("svg")).not.toBeNull();
    // Substrate is mounted alongside the cue.
    expect(container.querySelector('[data-slot="tug-code-view"]')).not.toBeNull();
  });

  test("empty data renders the empty marker only", () => {
    const { container } = render(<FileBlock data={undefined} />);
    const root = container.querySelector('[data-slot="file-body"]');
    expect(root).not.toBeNull();
    expect(root?.getAttribute("data-empty")).toBe("true");
    // No substrate, no header.
    expect(container.querySelector('[data-slot="tug-code-view"]')).toBeNull();
    expect(container.querySelector('[data-slot="file-header"]')).toBeNull();
  });

  test("empty content (zero lines) also renders the empty marker", () => {
    const data: FileData = { filePath: "x.ts", content: "" };
    const { container } = render(<FileBlock data={data} />);
    expect(
      container.querySelector('[data-slot="file-body"]')?.getAttribute("data-empty"),
    ).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// Collapse behavior
// ---------------------------------------------------------------------------

describe("FileBlock — collapse", () => {
  test("under threshold: expanded by default, no fold cue", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(DEFAULT_COLLAPSE_THRESHOLD),
    };
    const { container } = render(<FileBlock data={data} />);
    expect(
      container.querySelector('[data-slot="file-body"]')?.getAttribute("data-collapsed"),
    ).toBe("false");
    expect(container.querySelector(".tugx-file-fold-cue")).toBeNull();
  });

  test("above threshold: collapsed by default; cue shows the expand label", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(DEFAULT_COLLAPSE_THRESHOLD + 1),
    };
    const { container } = render(<FileBlock data={data} />);
    expect(
      container.querySelector('[data-slot="file-body"]')?.getAttribute("data-collapsed"),
    ).toBe("true");
    const cue = container.querySelector(".tugx-file-fold-cue") as HTMLElement;
    expect(cue).not.toBeNull();
    // Cue label is the line count; aria-label carries the verb.
    expect(cue.textContent).toContain(
      `${DEFAULT_COLLAPSE_THRESHOLD + 1} lines`,
    );
  });

  test("controlled prop forces expanded even above threshold (cue stays)", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(DEFAULT_COLLAPSE_THRESHOLD + 5),
    };
    const { container } = render(<FileBlock data={data} collapsed={false} />);
    expect(
      container.querySelector('[data-slot="file-body"]')?.getAttribute("data-collapsed"),
    ).toBe("false");
    expect(
      container.querySelector('[data-slot="tug-code-view"]'),
    ).not.toBeNull();
    // The fold cue is the persistent toggle handle — present in
    // both collapsed and expanded states once over-threshold.
    const cue = container.querySelector(".tugx-file-fold-cue") as HTMLElement;
    expect(cue).not.toBeNull();
    expect(cue.getAttribute("aria-label")).toBe("Collapse file");
  });

  test("clicking the cue from collapsed state fires onToggleCollapsed(false)", () => {
    const onToggle = mock((_next: boolean) => {});
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(DEFAULT_COLLAPSE_THRESHOLD + 5),
    };
    const { container } = render(
      <FileBlock data={data} onToggleCollapsed={onToggle} />,
    );
    const cue = container.querySelector(".tugx-file-fold-cue") as HTMLElement;
    fireEvent.click(cue);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle.mock.calls[0]?.[0]).toBe(false);
  });

  test("clicking the cue from expanded state fires onToggleCollapsed(true) — collapse handle never disappears", () => {
    // Regression: when embedded-mode hides the header, the cue is the
    // only collapse handle. If it weren't rendered in the expanded
    // state, the user could expand but not collapse back.
    const onToggle = mock((_next: boolean) => {});
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(DEFAULT_COLLAPSE_THRESHOLD + 5),
    };
    const { container } = render(
      <FileBlock data={data} collapsed={false} onToggleCollapsed={onToggle} />,
    );
    const cue = container.querySelector(".tugx-file-fold-cue") as HTMLElement;
    fireEvent.click(cue);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle.mock.calls[0]?.[0]).toBe(true);
  });

  test("clicking the cue dispatches `tug-disengage-follow-bottom` (releases host list's bottom pin)", () => {
    // The dispatch must precede the React state update so the host
    // list's SmartScroll flips `isFollowingBottom` to false before
    // the cell-height ResizeObserver requests a pinToBottom — without
    // this, the click target scrolls off-screen when the file
    // expands.
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(DEFAULT_COLLAPSE_THRESHOLD + 5),
    };
    const { container } = render(<FileBlock data={data} />);
    const root = container.querySelector(
      '[data-slot="file-body"]',
    ) as HTMLElement;
    let receivedCount = 0;
    let receivedBubbles = false;
    root.addEventListener(
      "tug-disengage-follow-bottom",
      (e: Event) => {
        receivedCount += 1;
        receivedBubbles = e.bubbles;
      },
      // Listener attached at the same root so the bubbling event
      // hits it via the dispatch on the same element.
    );
    const cue = container.querySelector(".tugx-file-fold-cue") as HTMLElement;
    fireEvent.click(cue);
    expect(receivedCount).toBe(1);
    expect(receivedBubbles).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Search affordance
// ---------------------------------------------------------------------------

describe("FileBlock — search affordance", () => {
  test("expanded file shows an enabled Search button in the header's trailing affordances", () => {
    // Phase D — the dedicated `.tugx-file-actions` sticky strip was
    // retired. Resting affordances (Search trigger, fold cue) live in
    // a `flex: 0 0 auto` cluster at the trailing edge of the identity
    // header (or, when `embedded`, portal into the host chrome).
    const data: FileData = {
      filePath: "x.ts",
      content: "alpha\nbeta",
    };
    const { container } = render(<FileBlock data={data} />);
    const header = container.querySelector('[data-slot="file-header"]');
    expect(header).not.toBeNull();
    const cluster = header?.querySelector('[data-slot="file-actions"]');
    expect(cluster).not.toBeNull();
    const search = cluster?.querySelector(
      'button[aria-label="Search in file"]',
    ) as HTMLButtonElement | null;
    expect(search).not.toBeNull();
    // Expanded file: Search is enabled (substrate is mounted, finding
    // is meaningful).
    expect(search?.disabled).toBe(false);
  });

  test("collapsed file STILL renders the Search button — disabled, not hidden", () => {
    // Phase D — affordance buttons stay visible across body-state
    // changes; collapsed state disables Search (the substrate isn't
    // mounted, so finding is meaningless) but keeps it in the
    // cluster so the header geometry doesn't shift when toggling
    // fold state. This is the "no growing/shrinking headers" rule.
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(DEFAULT_COLLAPSE_THRESHOLD + 5),
    };
    const { container } = render(<FileBlock data={data} />);
    const search = container.querySelector(
      'button[aria-label="Search in file"]',
    ) as HTMLButtonElement | null;
    expect(search).not.toBeNull();
    expect(search?.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Find UI — custom Tug-component chrome built into FileBlock
// ---------------------------------------------------------------------------

describe("FileBlock — find UI", () => {
  test("find row is hidden until Search is clicked", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: "alpha\nbeta",
    };
    const { container } = render(<FileBlock data={data} />);
    expect(container.querySelector('[data-slot="file-find"]')).toBeNull();
  });

  test("clicking Search opens the find row with Tug components", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: "alpha\nbeta",
    };
    const { container } = render(<FileBlock data={data} />);
    const searchButton = container.querySelector(
      'button[aria-label="Search in file"]',
    ) as HTMLButtonElement;
    fireEvent.click(searchButton);

    const findRow = container.querySelector('[data-slot="file-find"]');
    expect(findRow).not.toBeNull();
    // TugInput renders an <input data-slot="tug-input">.
    expect(findRow?.querySelector('[data-slot="tug-input"]')).not.toBeNull();
    // Three TugCheckboxes (match case / regexp / whole word).
    expect(
      findRow?.querySelectorAll('button[role="checkbox"]').length,
    ).toBe(3);
    // Prev / Next / Close TugIconButtons (find by accessible name).
    expect(
      findRow?.querySelector('button[aria-label="Previous match"]'),
    ).not.toBeNull();
    expect(
      findRow?.querySelector('button[aria-label="Next match"]'),
    ).not.toBeNull();
    expect(
      findRow?.querySelector('button[aria-label="Close find"]'),
    ).not.toBeNull();
  });

  test("clicking Close hides the find row", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: "alpha\nbeta",
    };
    const { container } = render(<FileBlock data={data} />);
    fireEvent.click(
      container.querySelector(
        'button[aria-label="Search in file"]',
      ) as HTMLButtonElement,
    );
    expect(container.querySelector('[data-slot="file-find"]')).not.toBeNull();
    fireEvent.click(
      container.querySelector(
        'button[aria-label="Close find"]',
      ) as HTMLButtonElement,
    );
    expect(container.querySelector('[data-slot="file-find"]')).toBeNull();
  });

  // The Escape-closes-find-row behavior is verified manually in the
  // running app — happy-dom's event-ordering across React renders
  // (keydown inside the input → setState → unmount of `.tugx-file-find`)
  // is unreliable per the scoping rule.
});

// ---------------------------------------------------------------------------
// Embedded mode
// ---------------------------------------------------------------------------

describe("FileBlock — embedded mode", () => {
  test("embedded mode hides the header", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: "alpha\nbeta",
    };
    const { container } = render(<FileBlock data={data} embedded />);
    expect(container.querySelector('[data-slot="file-header"]')).toBeNull();
  });

  test("embedded mode stamps data-embedded on the root", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: "alpha\nbeta",
    };
    const { container } = render(<FileBlock data={data} embedded />);
    expect(
      container.querySelector('[data-slot="file-body"]')?.getAttribute("data-embedded"),
    ).toBe("true");
  });

  test("embedded mode still renders the substrate", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: "alpha\nbeta",
    };
    const { container } = render(<FileBlock data={data} embedded />);
    expect(
      container.querySelector('[data-slot="tug-code-view"]'),
    ).not.toBeNull();
  });

  test("embedded mode portals affordances into the chrome's actions slot", () => {
    // Phase D — embedded composition surfaces resting affordances by
    // portaling them into `ToolWrapperChrome`'s actions slot via
    // `ChromeActionsTargetContext`. Search and the fold cue stay
    // reachable inside the embedded composition without a dedicated
    // body-kind actions row.
    const data: FileData = {
      filePath: "x.ts",
      content: "alpha\nbeta",
    };
    const { container } = render(
      <ToolWrapperChrome toolName="Read">
        <FileBlock data={data} embedded />
      </ToolWrapperChrome>,
    );
    const chromeActionsSlot = container.querySelector(
      "[data-slot='tool-wrapper-actions']",
    );
    expect(chromeActionsSlot).not.toBeNull();
    // The portaled cluster carries `data-slot="file-actions"` so
    // tests and consumers can still locate "FileBlock's affordances"
    // unambiguously even though they live inside the chrome subtree.
    const cluster = chromeActionsSlot?.querySelector(
      '[data-slot="file-actions"]',
    );
    expect(cluster).not.toBeNull();
    expect(
      cluster?.querySelector('button[aria-label="Search in file"]'),
    ).not.toBeNull();
  });

  test("embedded mode portals the fold cue too when over-threshold", () => {
    // The user can still expand/collapse from inside an embedded host;
    // the cue rides the same portal path as Search.
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(DEFAULT_COLLAPSE_THRESHOLD + 5),
    };
    const { container } = render(
      <ToolWrapperChrome toolName="Read">
        <FileBlock data={data} embedded />
      </ToolWrapperChrome>,
    );
    const chromeActionsSlot = container.querySelector(
      "[data-slot='tool-wrapper-actions']",
    );
    expect(
      chromeActionsSlot?.querySelector(".tugx-file-fold-cue"),
    ).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContent(numLines: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= numLines; i++) lines.push(`line ${i}`);
  return lines.join("\n");
}
