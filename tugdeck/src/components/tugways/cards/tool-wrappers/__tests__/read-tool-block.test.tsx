/**
 * `ReadToolBlock` — Layer-2 wrapper tests.
 *
 * Coverage:
 *  - Header: renders the tool name, the file icon, and the file
 *    path from `input.file_path` as the args summary.
 *  - Header: line-range badge rendered when `input.offset` /
 *    `input.limit` are set; suppressed when neither is set.
 *  - Body: composes a `FileBlock` (in `embedded` mode) fed from
 *    `tool_use_structured.file` (matches the v2.1.x
 *    `test-05-tool-use-read.jsonl` shape) — the test asserts the
 *    rendering against the structured-result shape directly.
 *  - Body: text fallback — when only `tool_result.output` lands
 *    (older catalogs / drift), the wrapper synthesizes a `FileData`
 *    from `input.file_path` + `textOutput` so something useful
 *    renders.
 *  - Footer: "Showing N of M lines" when the structured event
 *    reports `numLines < totalLines`; suppressed otherwise.
 *  - Streaming: status="streaming" hides the body in favor of the
 *    `<StreamingPlaceholder />`.
 *  - Error: status="error" with a plain-text `tool_result.output`
 *    surfaces the chrome's error band; the body is dropped to avoid
 *    duplicating the failure message.
 *  - Caution: dispatch surfaces `caution`; the chrome paints the
 *    inline caution badge.
 *  - Helpers: `composeFileData`, `composeLineRangeBadge`,
 *    `composeReadFooterHint`.
 *  - Dispatch: `resolveToolWrapper("Read")` returns `ReadToolBlock`
 *    after registration.
 */

import "../../../../../__tests__/setup-rtl";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import React from "react";

import {
  composeFileData,
  composeLineRangeBadge,
  composeReadFooterHint,
  ReadToolBlock,
} from "../read-tool-block";
import {
  registerToolWrapper,
  resolveToolWrapper,
} from "../../tide-assistant-renderer-dispatch";
import type { ToolWrapperProps } from "../types";

// Re-register: the dispatch test resets the registry in its own
// `beforeEach`. Without re-registering here, dispatch lookups in this
// file would resolve `DefaultToolWrapper` instead of `ReadToolBlock`
// when the suite runs after that file in the worker.
beforeAll(() => {
  registerToolWrapper("read", ReadToolBlock);
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("composeFileData", () => {
  test("structured.file shape lands on FileBlock.FileData verbatim", () => {
    const data = composeFileData(
      { file_path: "/abs/CLAUDE.md" },
      {
        file: {
          content: "# Title\nbody",
          filePath: "/abs/CLAUDE.md",
          startLine: 1,
          numLines: 2,
          totalLines: 55,
        },
      },
      undefined,
    );
    expect(data).toEqual({
      filePath: "/abs/CLAUDE.md",
      content: "# Title\nbody",
      startLine: 1,
      numLines: 2,
      totalLines: 55,
    });
  });

  test("structured.file with missing filePath falls back to input.file_path", () => {
    const data = composeFileData(
      { file_path: "/abs/x.ts" },
      { file: { content: "x" } },
      undefined,
    );
    expect(data?.filePath).toBe("/abs/x.ts");
  });

  test("no structured.file → fall back to textOutput synthesized shape", () => {
    const data = composeFileData(
      { file_path: "/abs/x.ts", offset: 5 },
      {},
      "alpha\nbeta",
    );
    expect(data).toEqual({
      filePath: "/abs/x.ts",
      content: "alpha\nbeta",
      startLine: 5,
    });
  });

  test("nothing readable → undefined (wrapper drops body)", () => {
    expect(composeFileData({}, {}, undefined)).toBeUndefined();
    expect(composeFileData({}, {}, "")).toBeUndefined();
  });
});

describe("composeLineRangeBadge", () => {
  test("offset + limit → 'lines N–M'", () => {
    expect(composeLineRangeBadge({ offset: 10, limit: 20 })).toBe(
      "lines 10–29",
    );
  });
  test("offset only → 'from line N'", () => {
    expect(composeLineRangeBadge({ offset: 7 })).toBe("from line 7");
  });
  test("limit only → 'first N lines'", () => {
    expect(composeLineRangeBadge({ limit: 50 })).toBe("first 50 lines");
  });
  test("neither set → undefined", () => {
    expect(composeLineRangeBadge({})).toBeUndefined();
    expect(composeLineRangeBadge({ file_path: "x.ts" })).toBeUndefined();
  });
});

describe("composeReadFooterHint", () => {
  test("numLines < totalLines → 'Showing N of M lines'", () => {
    expect(
      composeReadFooterHint({
        filePath: "x.ts",
        content: "",
        numLines: 3,
        totalLines: 55,
      }),
    ).toBe("Showing 3 of 55 lines");
  });
  test("numLines === totalLines → undefined (full read)", () => {
    expect(
      composeReadFooterHint({
        filePath: "x.ts",
        content: "",
        numLines: 10,
        totalLines: 10,
      }),
    ).toBeUndefined();
  });
  test("totalLines unknown → undefined", () => {
    expect(
      composeReadFooterHint({
        filePath: "x.ts",
        content: "",
        numLines: 3,
      }),
    ).toBeUndefined();
  });
  test("data undefined → undefined", () => {
    expect(composeReadFooterHint(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Component — render-time assertions
// ---------------------------------------------------------------------------

function makeProps(overrides: Partial<ToolWrapperProps> = {}): ToolWrapperProps {
  return {
    toolUseId: "tu-1",
    toolName: "Read",
    msgId: "msg-1",
    seq: 0,
    input: { file_path: "/abs/CLAUDE.md", limit: 3 },
    structuredResult: {
      type: "text",
      file: {
        content: "# Claude Code Guidelines for Tugtool\n\n## Project Overview",
        filePath: "/abs/CLAUDE.md",
        startLine: 1,
        numLines: 3,
        totalLines: 55,
      },
    },
    isError: false,
    status: "ready",
    ...overrides,
  };
}

describe("ReadToolBlock — header", () => {
  test("renders the tool name + file icon + file path", () => {
    const { container } = render(<ReadToolBlock {...makeProps()} />);
    const root = container.querySelector(
      '[data-slot="read-tool-block"]',
    ) as HTMLElement;
    expect(root).not.toBeNull();
    const header = root.querySelector(
      '[data-slot="tool-wrapper-header"]',
    ) as HTMLElement;
    expect(header.textContent).toContain("Read");
    expect(
      header.querySelector('[data-slot="read-tool-block-path"]')?.textContent,
    ).toBe("/abs/CLAUDE.md");
  });

  test("line-range badge renders when offset + limit are set", () => {
    const props = makeProps({
      input: { file_path: "/abs/x.ts", offset: 10, limit: 20 },
    });
    const { container } = render(<ReadToolBlock {...props} />);
    const badge = container.querySelector(
      '[data-slot="read-tool-block-line-range"]',
    ) as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe("lines 10–29");
  });

  test("missing file_path → no args summary, header still shows the tool name", () => {
    const props = makeProps({ input: {} });
    const { container } = render(<ReadToolBlock {...props} />);
    const header = container.querySelector(
      '[data-slot="tool-wrapper-header"]',
    ) as HTMLElement;
    expect(header.textContent).toContain("Read");
    expect(
      header.querySelector('[data-slot="read-tool-block-path"]'),
    ).toBeNull();
  });
});

describe("ReadToolBlock — body composition (matches test-05-tool-use-read.jsonl shape)", () => {
  test("structured.file is rendered through FileBlock in embedded mode", () => {
    const { container } = render(<ReadToolBlock {...makeProps()} />);
    const body = container.querySelector(
      '[data-slot="tool-wrapper-body"]',
    ) as HTMLElement;
    const fileRoot = body.querySelector(
      '[data-slot="file-body"]',
    ) as HTMLElement;
    expect(fileRoot).not.toBeNull();
    // Embedded mode — own header is suppressed, frame is dropped.
    expect(fileRoot.dataset.embedded).toBe("true");
    expect(fileRoot.querySelector('[data-slot="file-header"]')).toBeNull();
    // Content rows render with the structured content + line numbers
    // honoring `startLine`.
    const gutters = fileRoot.querySelectorAll(
      '[data-slot="file-gutter"]',
    );
    expect(gutters.length).toBe(3);
    expect(gutters[0].textContent).toBe("1");
    expect(gutters[2].textContent).toBe("3");
    expect(fileRoot.textContent).toContain(
      "Claude Code Guidelines for Tugtool",
    );
  });

  test("textOutput fallback drives the body when structured is absent", () => {
    const props = makeProps({
      structuredResult: undefined,
      textOutput: "alpha\nbeta",
    });
    const { container } = render(<ReadToolBlock {...props} />);
    const fileRoot = container.querySelector(
      '[data-slot="file-body"]',
    ) as HTMLElement;
    expect(fileRoot).not.toBeNull();
    expect(fileRoot.textContent).toContain("alpha");
    expect(fileRoot.textContent).toContain("beta");
  });

  test("nothing renderable → body is empty (no FileBlock at all)", () => {
    const props = makeProps({
      structuredResult: undefined,
      textOutput: undefined,
    });
    const { container } = render(<ReadToolBlock {...props} />);
    expect(container.querySelector('[data-slot="file-body"]')).toBeNull();
  });
});

describe("ReadToolBlock — footer", () => {
  test("'Showing N of M' lands when the read window is a subset", () => {
    const { container } = render(<ReadToolBlock {...makeProps()} />);
    const footer = container.querySelector(
      '[data-slot="tool-wrapper-footer"]',
    ) as HTMLElement;
    expect(footer).not.toBeNull();
    const showing = footer.querySelector(
      '[data-slot="read-tool-block-showing"]',
    ) as HTMLElement;
    expect(showing.textContent).toBe("Showing 3 of 55 lines");
  });

  test("full-file read → footer suppressed (no empty bar)", () => {
    const props = makeProps({
      structuredResult: {
        type: "text",
        file: {
          content: "x",
          filePath: "/abs/x.ts",
          startLine: 1,
          numLines: 1,
          totalLines: 1,
        },
      },
    });
    const { container } = render(<ReadToolBlock {...props} />);
    expect(
      container.querySelector('[data-slot="tool-wrapper-footer"]'),
    ).toBeNull();
  });
});

describe("ReadToolBlock — streaming + error states", () => {
  test("streaming renders the placeholder body, not FileBlock", () => {
    const props = makeProps({ status: "streaming" });
    const { container } = render(<ReadToolBlock {...props} />);
    expect(
      container.querySelector('[data-slot="tool-wrapper-streaming-placeholder"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-slot="file-body"]')).toBeNull();
  });

  test("error: chrome paints the error band; body is suppressed (no duplication)", () => {
    const props = makeProps({
      status: "error",
      isError: true,
      structuredResult: undefined,
      textOutput: "ENOENT: no such file or directory, open '/abs/missing.ts'",
    });
    const { container } = render(<ReadToolBlock {...props} />);
    const root = container.querySelector(
      '[data-slot="read-tool-block"]',
    ) as HTMLElement;
    expect(root.dataset.status).toBe("error");
    const errMsg = container.querySelector(
      '[data-slot="tool-wrapper-error"]',
    ) as HTMLElement;
    expect(errMsg).not.toBeNull();
    expect(errMsg.textContent).toContain("ENOENT");
    // Body is dropped on error to avoid duplicating the failure
    // message through a synthesized FileBlock.
    expect(container.querySelector('[data-slot="file-body"]')).toBeNull();
  });
});

describe("ReadToolBlock — caution flag", () => {
  test("paints the inline caution badge when caution is set", () => {
    const props = makeProps({
      caution: { reason: "unknown_shape", detail: "missing structured.file" },
    });
    const { container } = render(<ReadToolBlock {...props} />);
    const root = container.querySelector(
      '[data-slot="read-tool-block"]',
    ) as HTMLElement;
    expect(root.dataset.caution).toBe("unknown_shape");
    expect(
      container.querySelector('[data-slot="tool-wrapper-caution"]'),
    ).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dispatch registration
// ---------------------------------------------------------------------------

describe("dispatch registry", () => {
  test("resolveToolWrapper('Read') returns ReadToolBlock", () => {
    expect(resolveToolWrapper("Read")).toBe(ReadToolBlock);
    expect(resolveToolWrapper("read")).toBe(ReadToolBlock);
    expect(resolveToolWrapper("READ")).toBe(ReadToolBlock);
  });
});
