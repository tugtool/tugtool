/**
 * `FileBlock` — body-kind tests.
 *
 * After the Step 10.9 Phase A engine swap, `FileBlock` is a thin
 * chrome around `TugCodeView`. This test scope is correspondingly
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
 *  - Search affordance: header surfaces a `Search` `<TugIconButton>`
 *    when expanded; the underlying find-panel behavior (panel mount /
 *    keystroke wiring) is covered in `tug-code-view.test.tsx`.
 *  - Embedded mode: header is suppressed; the body still renders.
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
  test("expanded file renders a TugCodeView in the body", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: "alpha\nbeta",
    };
    const { container } = render(<FileBlock data={data} />);
    expect(container.querySelector('[data-slot="tug-code-view"]')).not.toBeNull();
    // No collapsed cue while expanded.
    expect(container.querySelector(".tugx-file-collapsed-hint")).toBeNull();
  });

  test("collapsed file shows the cue, not the substrate", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(200),
    };
    const { container } = render(<FileBlock data={data} />);
    // Above threshold ⇒ default collapsed.
    expect(container.querySelector(".tugx-file-collapsed-hint")).not.toBeNull();
    expect(container.querySelector('[data-slot="tug-code-view"]')).toBeNull();
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
  test("under threshold: expanded by default, no collapse toggle", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(DEFAULT_COLLAPSE_THRESHOLD),
    };
    const { container } = render(<FileBlock data={data} />);
    expect(
      container.querySelector('[data-slot="file-body"]')?.getAttribute("data-collapsed"),
    ).toBe("false");
    expect(
      container.querySelector('button[aria-label="Collapse file"]'),
    ).toBeNull();
    expect(
      container.querySelector('button[aria-label="Expand file"]'),
    ).toBeNull();
  });

  test("above threshold: collapsed by default; toggle is Expand", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(DEFAULT_COLLAPSE_THRESHOLD + 1),
    };
    const { container } = render(<FileBlock data={data} />);
    expect(
      container.querySelector('[data-slot="file-body"]')?.getAttribute("data-collapsed"),
    ).toBe("true");
    expect(
      container.querySelector('button[aria-label="Expand file"]'),
    ).not.toBeNull();
  });

  test("controlled prop forces expanded even above threshold", () => {
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
  });

  test("clicking Expand fires onToggleCollapsed(false)", () => {
    const onToggle = mock((_next: boolean) => {});
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(DEFAULT_COLLAPSE_THRESHOLD + 5),
    };
    const { container } = render(
      <FileBlock data={data} onToggleCollapsed={onToggle} />,
    );
    const expandBtn = container.querySelector(
      'button[aria-label="Expand file"]',
    ) as HTMLButtonElement;
    fireEvent.click(expandBtn);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle.mock.calls[0]?.[0]).toBe(false);
  });

  test("clicking the collapsed cue also fires onToggleCollapsed(false)", () => {
    const onToggle = mock((_next: boolean) => {});
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(DEFAULT_COLLAPSE_THRESHOLD + 5),
    };
    const { container } = render(
      <FileBlock data={data} onToggleCollapsed={onToggle} />,
    );
    const cue = container.querySelector(".tugx-file-collapsed-hint") as HTMLElement;
    fireEvent.click(cue);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle.mock.calls[0]?.[0]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Search affordance
// ---------------------------------------------------------------------------

describe("FileBlock — search affordance", () => {
  test("expanded file shows a Search button in the header", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: "alpha\nbeta",
    };
    const { container } = render(<FileBlock data={data} />);
    expect(
      container.querySelector('button[aria-label="Search in file"]'),
    ).not.toBeNull();
  });

  test("collapsed file does NOT show a Search button", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(DEFAULT_COLLAPSE_THRESHOLD + 5),
    };
    const { container } = render(<FileBlock data={data} />);
    expect(
      container.querySelector('button[aria-label="Search in file"]'),
    ).toBeNull();
  });
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
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContent(numLines: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= numLines; i++) lines.push(`line ${i}`);
  return lines.join("\n");
}
