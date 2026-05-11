/**
 * `FileBlock` — body-kind tests.
 *
 * Coverage:
 *  - Pure helpers: `detectLanguage` (extension + bare-name special
 *    cases), `splitContentLines` (trailing-newline drop), `basename`,
 *    `composeLineCountLabel`, `findMatches`.
 *  - Static render: line-numbered gutter honors `startLine`,
 *    extension-derived language stamps `data-language` and the lang
 *    class.
 *  - Long-file collapse: at the threshold (80 lines) renders all
 *    rows expanded; above the threshold (e.g. 200) collapses by
 *    default and shows the collapsed-hint banner.
 *  - Controlled collapse: `collapsed={true}` honored; toggle button
 *    notifies via `onToggleCollapsed`.
 *  - Search affordance markup: header exposes a search toggle, and
 *    clicking it reveals the search-bar markup (input + count + step
 *    buttons). The full interactive flow (typing, Enter / Shift+Enter
 *    next/prev, Escape, Cmd+F entry point, focus restoration) lives
 *    in a real-browser test surface — happy-dom does not model focus
 *    or controlled-input event ordering reliably.
 *  - Click-line-to-copy: clicking a row writes the line text via
 *    `navigator.clipboard.writeText`.
 *  - Shiki integration: an injected highlighter populates each row's
 *    content with per-line highlighted HTML; null result keeps the
 *    plain-text fallback; no-language paths skip the highlighter.
 */

import "../../../../__tests__/setup-rtl";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";

import {
  FileBlock,
  DEFAULT_COLLAPSE_THRESHOLD,
  basename,
  composeLineCountLabel,
  detectLanguage,
  findMatches,
  injectHighlighter,
  splitContentLines,
  type FileData,
} from "../file-block";

afterEach(() => {
  cleanup();
  injectHighlighter(null);
});

/**
 * Drive the search input as if the user typed: set the DOM value
 * and dispatch an `input` event. Since the FileBlock's search input
 * is uncontrolled (the React state is updated from the input's
 * current value on each `input` event), this is the natural way to
 * exercise it from a test.
 */
function typeInSearch(input: HTMLInputElement, value: string): void {
  input.value = value;
  fireEvent.input(input);
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("detectLanguage", () => {
  test("common TypeScript / JavaScript extensions", () => {
    expect(detectLanguage("foo.ts")).toBe("typescript");
    expect(detectLanguage("path/to/foo.tsx")).toBe("tsx");
    expect(detectLanguage("foo.js")).toBe("javascript");
    expect(detectLanguage("/abs/foo.jsx")).toBe("jsx");
    expect(detectLanguage("a.mts")).toBe("typescript");
  });

  test("Python / Rust / Go / shell", () => {
    expect(detectLanguage("foo.py")).toBe("python");
    expect(detectLanguage("foo.rs")).toBe("rust");
    expect(detectLanguage("foo.go")).toBe("go");
    expect(detectLanguage("foo.sh")).toBe("shellscript");
    expect(detectLanguage("foo.bash")).toBe("shellscript");
  });

  test("data formats", () => {
    expect(detectLanguage("foo.json")).toBe("json");
    expect(detectLanguage("foo.yaml")).toBe("yaml");
    expect(detectLanguage("foo.toml")).toBe("toml");
  });

  test("bare filenames whose name is the language hint", () => {
    expect(detectLanguage("Dockerfile")).toBe("dockerfile");
    expect(detectLanguage("Makefile")).toBe("makefile");
    expect(detectLanguage("makefile")).toBe("makefile");
    expect(detectLanguage("path/to/Dockerfile")).toBe("dockerfile");
  });

  test("unknown extension or no extension → undefined", () => {
    expect(detectLanguage("foo")).toBeUndefined();
    expect(detectLanguage("foo.unknownext")).toBeUndefined();
    expect(detectLanguage("")).toBeUndefined();
    expect(detectLanguage("foo.")).toBeUndefined();
  });

  test("case-insensitive extension match", () => {
    expect(detectLanguage("FOO.TS")).toBe("typescript");
    expect(detectLanguage("Foo.JSON")).toBe("json");
  });
});

describe("splitContentLines", () => {
  test("empty string → no lines", () => {
    expect(splitContentLines("")).toEqual([]);
  });

  test("plain content splits by newline", () => {
    expect(splitContentLines("a\nb\nc")).toEqual(["a", "b", "c"]);
  });

  test("trailing newline does NOT add a final empty line", () => {
    expect(splitContentLines("a\nb\n")).toEqual(["a", "b"]);
  });

  test("middle blank lines preserved", () => {
    expect(splitContentLines("a\n\nb")).toEqual(["a", "", "b"]);
  });
});

describe("composeLineCountLabel", () => {
  test("totalLines unknown → 'N lines'", () => {
    expect(composeLineCountLabel(5, undefined)).toBe("5 lines");
    expect(composeLineCountLabel(1, undefined)).toBe("1 line");
  });

  test("totalLines == numLines → 'N lines' (whole file)", () => {
    expect(composeLineCountLabel(80, 80)).toBe("80 lines");
  });

  test("totalLines > numLines → 'Showing N of M lines'", () => {
    expect(composeLineCountLabel(80, 200)).toBe("Showing 80 of 200 lines");
  });
});

describe("basename", () => {
  test("posix and windows path separators", () => {
    expect(basename("foo/bar/baz.ts")).toBe("baz.ts");
    expect(basename("C:\\foo\\bar\\baz.ts")).toBe("baz.ts");
    expect(basename("file.ts")).toBe("file.ts");
    expect(basename("")).toBe("");
  });
});

describe("findMatches", () => {
  test("empty query → no matches", () => {
    expect(findMatches("hello world", "")).toEqual([]);
  });

  test("single occurrence", () => {
    expect(findMatches("hello world", "world")).toEqual([[6, 11]]);
  });

  test("multiple occurrences, case-insensitive", () => {
    expect(findMatches("Foo foo FOO bar", "foo")).toEqual([
      [0, 3],
      [4, 7],
      [8, 11],
    ]);
  });

  test("no overlapping match (consume each match fully)", () => {
    expect(findMatches("aaaa", "aa")).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Empty / no-data render
// ---------------------------------------------------------------------------

describe("FileBlock — empty render", () => {
  test("undefined data → root has data-empty='true' and no header", () => {
    const { container } = render(<FileBlock />);
    const root = container.querySelector(
      '[data-slot="file-body"]',
    ) as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.dataset.empty).toBe("true");
    expect(root.querySelector('[data-slot="file-header"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Line numbers + startLine offset
// ---------------------------------------------------------------------------

function makeContent(n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(`line-${i}`);
  return out.join("\n");
}

describe("FileBlock — gutter + startLine", () => {
  test("default startLine = 1; gutter shows 1, 2, 3 …", () => {
    const data: FileData = { filePath: "x.txt", content: "a\nb\nc" };
    const { container } = render(<FileBlock data={data} />);
    const gutters = container.querySelectorAll('[data-slot="file-gutter"]');
    expect(gutters.length).toBe(3);
    expect(gutters[0].textContent).toBe("1");
    expect(gutters[1].textContent).toBe("2");
    expect(gutters[2].textContent).toBe("3");
  });

  test("startLine = 10 offsets the gutter", () => {
    const data: FileData = {
      filePath: "x.txt",
      content: "alpha\nbeta\ngamma",
      startLine: 10,
    };
    const { container } = render(<FileBlock data={data} />);
    const gutters = container.querySelectorAll('[data-slot="file-gutter"]');
    expect(gutters[0].textContent).toBe("10");
    expect(gutters[1].textContent).toBe("11");
    expect(gutters[2].textContent).toBe("12");
    // The row's data-line attribute also reflects the offset.
    const rows = container.querySelectorAll<HTMLElement>(
      '[data-slot="file-row"]',
    );
    expect(rows[0].dataset.line).toBe("10");
  });

  test("content lines render in the content slot", () => {
    const data: FileData = {
      filePath: "x.txt",
      content: "alpha\nbeta",
    };
    const { container } = render(<FileBlock data={data} />);
    const contents = container.querySelectorAll(
      '[data-slot="file-content"]',
    );
    expect(contents[0].textContent).toBe("alpha");
    expect(contents[1].textContent).toBe("beta");
  });
});

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

describe("FileBlock — header", () => {
  test("renders basename + language + line counts", () => {
    const data: FileData = {
      filePath: "src/lib/foo.ts",
      content: makeContent(5),
    };
    const { container } = render(<FileBlock data={data} />);
    const header = container.querySelector(
      '[data-slot="file-header"]',
    ) as HTMLElement;
    expect(header.querySelector('[data-slot="file-path"]')?.textContent).toBe(
      "foo.ts",
    );
    expect(header.querySelector('[data-slot="file-lang"]')?.textContent).toBe(
      "typescript",
    );
    expect(
      header.querySelector('[data-slot="file-counts"]')?.textContent,
    ).toBe("5 lines");
  });

  test("Showing N of M when totalLines > numLines", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(40),
      numLines: 40,
      totalLines: 200,
    };
    const { container } = render(<FileBlock data={data} />);
    expect(
      container.querySelector('[data-slot="file-counts"]')?.textContent,
    ).toBe("Showing 40 of 200 lines");
  });

  test("language badge omitted when extension is unknown", () => {
    const data: FileData = {
      filePath: "no-extension-here",
      content: "foo\nbar",
    };
    const { container } = render(<FileBlock data={data} />);
    expect(container.querySelector('[data-slot="file-lang"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Language detection → root attributes
// ---------------------------------------------------------------------------

describe("FileBlock — language detection drives the root", () => {
  test("ts → data-language='typescript' and class", () => {
    const data: FileData = {
      filePath: "src/lib/foo.ts",
      content: "export const a = 1;",
    };
    const { container } = render(<FileBlock data={data} />);
    const root = container.querySelector(
      '[data-slot="file-body"]',
    ) as HTMLElement;
    expect(root.dataset.language).toBe("typescript");
    expect(root.classList.contains("tugx-file--lang-typescript")).toBe(true);
  });

  test("py → 'python'", () => {
    const data: FileData = { filePath: "main.py", content: "x = 1" };
    const { container } = render(<FileBlock data={data} />);
    const root = container.querySelector(
      '[data-slot="file-body"]',
    ) as HTMLElement;
    expect(root.dataset.language).toBe("python");
    expect(root.classList.contains("tugx-file--lang-python")).toBe(true);
  });

  test("unknown extension → data-language='plain', no lang class", () => {
    const data: FileData = {
      filePath: "no-ext-file",
      content: "raw",
    };
    const { container } = render(<FileBlock data={data} />);
    const root = container.querySelector(
      '[data-slot="file-body"]',
    ) as HTMLElement;
    expect(root.dataset.language).toBe("plain");
    expect(
      Array.from(root.classList).some((c) => c.startsWith("tugx-file--lang-")),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Collapse behavior
// ---------------------------------------------------------------------------

describe("FileBlock — collapse", () => {
  test("at threshold (80 lines): expanded by default, no toggle", () => {
    const data: FileData = {
      filePath: "x.txt",
      content: makeContent(DEFAULT_COLLAPSE_THRESHOLD),
    };
    const { container } = render(<FileBlock data={data} />);
    const root = container.querySelector(
      '[data-slot="file-body"]',
    ) as HTMLElement;
    expect(root.dataset.collapsed).toBe("false");
    // Header collapse toggle is absent below the threshold (no overThreshold,
    // no TugIconButton rendered).
    expect(
      container.querySelector('button[aria-label="Collapse file"]'),
    ).toBeNull();
    expect(
      container.querySelectorAll('[data-slot="file-row"]').length,
    ).toBe(DEFAULT_COLLAPSE_THRESHOLD);
  });

  test("above threshold (200 lines): collapsed by default with hint", () => {
    const data: FileData = {
      filePath: "x.txt",
      content: makeContent(200),
    };
    const { container } = render(<FileBlock data={data} />);
    const root = container.querySelector(
      '[data-slot="file-body"]',
    ) as HTMLElement;
    expect(root.dataset.collapsed).toBe("true");
    // Collapsed-hint banner is a TugCue (`.tugx-file-collapsed-hint` class
    // forwarded onto the cue for scoping).
    expect(
      container.querySelector(".tugx-file-collapsed-hint"),
    ).not.toBeNull();
    // No rows are rendered while collapsed.
    expect(
      container.querySelectorAll('[data-slot="file-row"]').length,
    ).toBe(0);
    // Header collapse toggle is the TugIconButton with aria-label "Expand file".
    const toggle = container.querySelector(
      'button[aria-label="Expand file"]',
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
  });

  test("toggle button expands and notifies via onToggleCollapsed", () => {
    const data: FileData = {
      filePath: "x.txt",
      content: makeContent(120),
    };
    const onToggle = mock(() => undefined);
    const { container } = render(
      <FileBlock data={data} onToggleCollapsed={onToggle} />,
    );
    const root = container.querySelector(
      '[data-slot="file-body"]',
    ) as HTMLElement;
    expect(root.dataset.collapsed).toBe("true");
    const toggle = container.querySelector(
      'button[aria-label="Expand file"]',
    ) as HTMLButtonElement;
    act(() => {
      toggle.click();
    });
    expect(root.dataset.collapsed).toBe("false");
    expect(onToggle).toHaveBeenCalledWith(false);
    // After expansion all 120 rows render.
    expect(
      container.querySelectorAll('[data-slot="file-row"]').length,
    ).toBe(120);
  });

  test("explicit collapsed=false on a long file overrides default", () => {
    const data: FileData = {
      filePath: "x.txt",
      content: makeContent(200),
    };
    const { container } = render(<FileBlock data={data} collapsed={false} />);
    const root = container.querySelector(
      '[data-slot="file-body"]',
    ) as HTMLElement;
    expect(root.dataset.collapsed).toBe("false");
    expect(
      container.querySelectorAll('[data-slot="file-row"]').length,
    ).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Click-line-to-copy
// ---------------------------------------------------------------------------

describe("FileBlock — click-line-to-copy", () => {
  let originalClipboard: typeof navigator.clipboard | undefined;
  let writeText: ReturnType<typeof mock>;

  beforeEach(() => {
    originalClipboard = (navigator as Navigator & {
      clipboard?: Clipboard;
    }).clipboard;
    writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
    });
  });

  test("clicking a row writes its text to the clipboard", () => {
    const data: FileData = {
      filePath: "x.txt",
      content: "alpha\nbeta\ngamma",
    };
    const { container } = render(<FileBlock data={data} />);
    const rows = container.querySelectorAll<HTMLElement>(
      '[data-slot="file-row"]',
    );
    act(() => {
      rows[1].click();
    });
    expect(writeText).toHaveBeenCalledWith("beta");
  });
});

// ---------------------------------------------------------------------------
// Search — markup-only checks
// ---------------------------------------------------------------------------
//
// The full search interaction (typing, Enter / Shift+Enter, prev/next,
// Escape, Cmd+F entry point, focus restoration) crosses focus and
// event-ordering boundaries that happy-dom doesn't model reliably —
// per the project's testing rule, those flows belong in a
// real-browser surface (gallery card / e2e), not happy-dom. Here we
// only assert the static markup affordances that the search bar
// surfaces from the chrome.

describe("FileBlock — search affordance markup", () => {
  test("expanded file shows a search-toggle button in the header", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: "alpha\nbeta",
    };
    const { container } = render(<FileBlock data={data} />);
    expect(
      container.querySelector('button[aria-label="Search in file"]'),
    ).not.toBeNull();
  });

  test("clicking the search-toggle reveals the search bar with input + count + step buttons", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: "alpha\nbeta",
    };
    const { container } = render(<FileBlock data={data} />);
    expect(
      container.querySelector('[data-slot="file-search-bar"]'),
    ).toBeNull();

    act(() => {
      (
        container.querySelector(
          'button[aria-label="Search in file"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(
      container.querySelector('[data-slot="file-search-bar"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-slot="file-search-input"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Previous match"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Next match"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-slot="file-search-count"]'),
    ).not.toBeNull();
  });

  test("collapsed file does NOT show a search toggle (search reveals after expand)", () => {
    const data: FileData = {
      filePath: "x.ts",
      content: makeContent(200),
    };
    const { container } = render(<FileBlock data={data} />);
    expect(
      container.querySelector('button[aria-label="Search in file"]'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Shiki integration (via injected stub) — confirms per-line dispatch
// ---------------------------------------------------------------------------

describe("FileBlock — Shiki highlight (injected)", () => {
  test("when a language is detected, per-line highlighted HTML is written into the rows", async () => {
    injectHighlighter(async (_content, _lang) => [
      '<span class="line"><span style="color:#abcdef">alpha</span></span>',
      '<span class="line"><span style="color:#abcdef">beta</span></span>',
    ]);

    const data: FileData = {
      filePath: "x.ts",
      content: "alpha\nbeta",
    };
    const { container } = render(<FileBlock data={data} />);

    // Allow the async useEffect chain to settle (microtask flush).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const contents = container.querySelectorAll<HTMLElement>(
      '[data-slot="file-content"]',
    );
    expect(contents[0].dataset.highlighted).toBe("true");
    expect(contents[0].innerHTML).toContain("color:#abcdef");
    expect(contents[1].dataset.highlighted).toBe("true");
  });

  test("highlighter returning null → content stays plain", async () => {
    injectHighlighter(async () => null);

    const data: FileData = {
      filePath: "x.ts",
      content: "alpha\nbeta",
    };
    const { container } = render(<FileBlock data={data} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const contents = container.querySelectorAll<HTMLElement>(
      '[data-slot="file-content"]',
    );
    expect(contents[0].dataset.highlighted).toBeUndefined();
    expect(contents[0].textContent).toBe("alpha");
  });

  test("no language → highlighter is not consulted", async () => {
    const stub = mock(async () => null);
    injectHighlighter(stub);

    const data: FileData = {
      filePath: "no-extension",
      content: "alpha",
    };
    render(<FileBlock data={data} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stub).not.toHaveBeenCalled();
  });
});
