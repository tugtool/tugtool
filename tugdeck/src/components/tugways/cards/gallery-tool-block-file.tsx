/**
 * gallery-tool-block-file.tsx — visual fixture for the file-oriented
 * tool blocks: `ReadToolBlock` and `EditToolBlock`.
 *
 * Two columns, side by side: the Read wrapper (file icon + path +
 * optional line-range badge over an embedded `FileBlock`) and the Edit
 * wrapper (file-pen icon + path + `+N −M` badge over an embedded
 * `DiffBlock`). Each column stacks its canonical states with
 * module-scope mock `ToolWrapperProps` — no live tugcode bridge:
 *
 *   Read
 *    1. **Full file** — `structured_result.file` carries the whole
 *       file; `numLines === totalLines`, so no footer.
 *    2. **Windowed** — `input.offset` / `input.limit` set and the
 *       structured result reports a proper subset, so the header gains
 *       a line-range badge and the footer shows "Showing N of M".
 *    3. **Error** — `status: "error"`; the chrome paints the error
 *       band from `textOutput`, no body.
 *
 *   Edit
 *    4. **structuredPatch** — the canonical Edit source. The wrapper
 *       converts the hunks to `DiffData{source:"hunks"}`, renders
 *       synchronously, and shows the `+N −M` change-count badge.
 *    5. **two-text fallback** — no `structuredPatch`; the wrapper
 *       builds `DiffData{source:"two-text"}` from `(old_string,
 *       new_string)`. No badge — the counts aren't known wrapper-side.
 *    6. **Error** — `status: "error"`; chrome error band, no body.
 *
 * Read + Edit are extended with Write + NotebookEdit in [#step-29-5]'s
 * batch-2 pass; this card is the surface that grows.
 *
 * Laws: [L19] gallery-card authoring (module docstring, exported
 *       component, registered). The wrappers own all painted surfaces.
 *
 * @module components/tugways/cards/gallery-tool-block-file
 */

import "./gallery-tool-block-file.css";

import React from "react";

import { ReadToolBlock } from "./tool-wrappers/read-tool-block";
import { EditToolBlock } from "./tool-wrappers/edit-tool-block";
import type { ToolWrapperProps } from "./tool-wrappers/types";
import { TugLabel } from "@/components/tugways/tug-label";

// ---------------------------------------------------------------------------
// Mock file content
// ---------------------------------------------------------------------------

const GREET_SOURCE = `import { VERSION } from "./version";

export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export const DEFAULT_GREETING = greet("world");

export function farewell(name: string): string {
  return \`Goodbye, \${name}.\`;
}

export { VERSION };
`;

/** A long synthetic file so the windowed-read variant has a real subset to show. */
const LONG_SOURCE = Array.from(
  { length: 12 },
  (_, i) =>
    `const row_${i + 40} = compute(${i + 40}); // line ${i + 40} of a 320-line module`,
).join("\n");

// ---------------------------------------------------------------------------
// Read fixtures
// ---------------------------------------------------------------------------

const READ_FULL: ToolWrapperProps = {
  toolUseId: "gallery-read-full",
  toolName: "Read",
  msgId: "gallery-file-msg",
  seq: 0,
  input: { file_path: "src/greet.ts" },
  structuredResult: {
    file: {
      content: GREET_SOURCE,
      filePath: "src/greet.ts",
      startLine: 1,
      numLines: 13,
      totalLines: 13,
    },
    type: "text",
  },
  status: "ready",
};

const READ_WINDOWED: ToolWrapperProps = {
  toolUseId: "gallery-read-windowed",
  toolName: "Read",
  msgId: "gallery-file-msg",
  seq: 1,
  input: { file_path: "src/synthesized/long-module.ts", offset: 40, limit: 12 },
  structuredResult: {
    file: {
      content: LONG_SOURCE,
      filePath: "src/synthesized/long-module.ts",
      startLine: 40,
      numLines: 12,
      totalLines: 320,
    },
    type: "text",
  },
  status: "ready",
};

const READ_ERROR: ToolWrapperProps = {
  toolUseId: "gallery-read-error",
  toolName: "Read",
  msgId: "gallery-file-msg",
  seq: 2,
  input: { file_path: "src/missing.ts" },
  textOutput: "ENOENT: no such file or directory, open 'src/missing.ts'",
  isError: true,
  status: "error",
};

// ---------------------------------------------------------------------------
// Edit fixtures
// ---------------------------------------------------------------------------

const EDIT_STRUCTURED: ToolWrapperProps = {
  toolUseId: "gallery-edit-structured",
  toolName: "Edit",
  msgId: "gallery-file-msg",
  seq: 3,
  input: {
    file_path: "src/greet.ts",
    old_string: '  return "Hello " + name;',
    new_string: "  return `Hello, ${name}!`;",
  },
  structuredResult: {
    filePath: "src/greet.ts",
    structuredPatch: [
      {
        oldStart: 3,
        oldLines: 4,
        newStart: 3,
        newLines: 6,
        lines: [
          " export function greet(name: string): string {",
          '-  return "Hello " + name;',
          "+  return `Hello, ${name}!`;",
          " }",
          "+",
          '+export const DEFAULT_GREETING = greet("world");',
          " ",
        ],
      },
    ],
  },
  status: "ready",
};

const EDIT_TWO_TEXT: ToolWrapperProps = {
  toolUseId: "gallery-edit-two-text",
  toolName: "Edit",
  msgId: "gallery-file-msg",
  seq: 4,
  input: {
    file_path: "src/version.ts",
    old_string: 'export const VERSION = "1.0.0";',
    new_string: 'export const VERSION = "1.1.0";',
  },
  status: "ready",
};

const EDIT_ERROR: ToolWrapperProps = {
  toolUseId: "gallery-edit-error",
  toolName: "Edit",
  msgId: "gallery-file-msg",
  seq: 5,
  input: {
    file_path: "src/greet.ts",
    old_string: "this text is not in the file",
    new_string: "replacement",
  },
  textOutput: "String to replace not found in file.",
  isError: true,
  status: "error",
};

// ---------------------------------------------------------------------------
// GalleryToolBlockFile
// ---------------------------------------------------------------------------

interface VariantProps {
  title: string;
  children: React.ReactNode;
}

function Variant({ title, children }: VariantProps): React.ReactElement {
  return (
    <div className="cg-section gallery-tool-block-file-variant">
      <TugLabel className="cg-section-title">{title}</TugLabel>
      {children}
    </div>
  );
}

export function GalleryToolBlockFile(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-tool-block-file">
      <div className="gallery-tool-block-file-columns">
        <div className="gallery-tool-block-file-column">
          <Variant title="Read — full file (no footer)">
            <ReadToolBlock {...READ_FULL} />
          </Variant>
          <Variant title="Read — windowed (line-range badge + footer)">
            <ReadToolBlock {...READ_WINDOWED} />
          </Variant>
          <Variant title="Read — error (chrome error band, no body)">
            <ReadToolBlock {...READ_ERROR} />
          </Variant>
        </div>

        <div className="gallery-tool-block-file-column">
          <Variant title="Edit — structuredPatch (canonical source, +N −M badge)">
            <EditToolBlock {...EDIT_STRUCTURED} />
          </Variant>
          <Variant title="Edit — two-text fallback (no badge)">
            <EditToolBlock {...EDIT_TWO_TEXT} />
          </Variant>
          <Variant title="Edit — error (chrome error band, no body)">
            <EditToolBlock {...EDIT_ERROR} />
          </Variant>
        </div>
      </div>
    </div>
  );
}
