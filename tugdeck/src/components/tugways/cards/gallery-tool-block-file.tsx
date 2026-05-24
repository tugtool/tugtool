/**
 * gallery-tool-block-file.tsx — visual fixture for the file-oriented
 * tool blocks: `ReadToolBlock`, `EditToolBlock`, `WriteToolBlock`,
 * and `NotebookEditToolBlock`.
 *
 * Four columns, side by side: Read (file icon + path + optional
 * line-range badge over an embedded `FileBlock`), Edit (file-pen
 * icon + path + `+N −M` badge over an embedded `DiffBlock`), Write
 * (file-plus icon + path + size + new/overwrite chip over an
 * embedded `FileBlock`), NotebookEdit (notebook icon + path + cell
 * id + edit-mode chip + cell-type chip, with the body branching on
 * edit_mode: replace = embedded `DiffBlock`, insert = embedded
 * `FileBlock`, delete = confirmation row).
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
 *   Write ([#step-26])
 *    7. **New file** — `structured_result.created === true`; the
 *       header chip reads "new"; body renders the written content.
 *    8. **Overwrite** — `created === false`; chip reads "overwrite".
 *    9. **Error** — `status: "error"`; chrome error band, no body.
 *
 *   NotebookEdit ([#step-26])
 *   10. **Replace** — `oldSource` + `newSource` present; body is an
 *       embedded `DiffBlock` (`two-text` source).
 *   11. **Insert** — `editMode === "insert"`; body is an embedded
 *       `FileBlock` over the new cell source.
 *   12. **Delete** — `editMode === "delete"`; body is a confirmation
 *       row, no source.
 *
 * Laws: [L19] gallery-card authoring (module docstring, exported
 *       component, registered). The wrappers own all painted surfaces.
 *
 * @module components/tugways/cards/gallery-tool-block-file
 */

import "./gallery-tool-block-file.css";

import React from "react";

import { ReadToolBlock } from "./tool-blocks/read-tool-block";
import { EditToolBlock } from "./tool-blocks/edit-tool-block";
import { WriteToolBlock } from "./tool-blocks/write-tool-block";
import { NotebookEditToolBlock } from "./tool-blocks/notebook-edit-tool-block";
import type { ToolBlockProps } from "./tool-blocks/types";
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

const READ_FULL: ToolBlockProps = {
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

const READ_WINDOWED: ToolBlockProps = {
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

const READ_ERROR: ToolBlockProps = {
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

const EDIT_STRUCTURED: ToolBlockProps = {
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

const EDIT_TWO_TEXT: ToolBlockProps = {
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

const EDIT_ERROR: ToolBlockProps = {
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
// Write fixtures ([#step-26])
// ---------------------------------------------------------------------------

const WRITE_NEW: ToolBlockProps = {
  toolUseId: "gallery-write-new",
  toolName: "Write",
  msgId: "gallery-file-msg",
  seq: 6,
  input: {
    file_path: "/tmp/hello.txt",
    content: "hello world\n",
  },
  structuredResult: {
    filePath: "/tmp/hello.txt",
    content: "hello world\n",
    created: true,
  },
  status: "ready",
};

const WRITE_OVERWRITE: ToolBlockProps = {
  toolUseId: "gallery-write-overwrite",
  toolName: "Write",
  msgId: "gallery-file-msg",
  seq: 7,
  input: {
    file_path: "src/version.ts",
    content: 'export const VERSION = "1.1.0";\n',
  },
  structuredResult: {
    filePath: "src/version.ts",
    content: 'export const VERSION = "1.1.0";\n',
    created: false,
  },
  status: "ready",
};

const WRITE_ERROR: ToolBlockProps = {
  toolUseId: "gallery-write-error",
  toolName: "Write",
  msgId: "gallery-file-msg",
  seq: 8,
  input: { file_path: "/root/protected.txt", content: "denied" },
  textOutput: "EACCES: permission denied, open '/root/protected.txt'",
  isError: true,
  status: "error",
};

// ---------------------------------------------------------------------------
// NotebookEdit fixtures ([#step-26])
// ---------------------------------------------------------------------------

const NOTEBOOK_REPLACE: ToolBlockProps = {
  toolUseId: "gallery-notebook-replace",
  toolName: "NotebookEdit",
  msgId: "gallery-file-msg",
  seq: 9,
  input: {
    notebook_path: "/tmp/sample.ipynb",
    new_source: "print('hi')",
    cell_id: "cell-2",
    cell_type: "code",
    edit_mode: "replace",
  },
  structuredResult: {
    notebookPath: "/tmp/sample.ipynb",
    cellId: "cell-2",
    cellType: "code",
    editMode: "replace",
    oldSource: "print('hello world')",
    newSource: "print('hi')",
  },
  status: "ready",
};

const NOTEBOOK_INSERT: ToolBlockProps = {
  toolUseId: "gallery-notebook-insert",
  toolName: "NotebookEdit",
  msgId: "gallery-file-msg",
  seq: 10,
  input: {
    notebook_path: "/tmp/sample.ipynb",
    new_source: "# Section 2\n\nIntroduction text.",
    cell_id: "cell-3",
    cell_type: "markdown",
    edit_mode: "insert",
  },
  structuredResult: {
    notebookPath: "/tmp/sample.ipynb",
    cellId: "cell-3",
    cellType: "markdown",
    editMode: "insert",
    newSource: "# Section 2\n\nIntroduction text.",
  },
  status: "ready",
};

const NOTEBOOK_DELETE: ToolBlockProps = {
  toolUseId: "gallery-notebook-delete",
  toolName: "NotebookEdit",
  msgId: "gallery-file-msg",
  seq: 11,
  input: {
    notebook_path: "/tmp/sample.ipynb",
    new_source: "",
    cell_id: "cell-4",
    edit_mode: "delete",
  },
  structuredResult: {
    notebookPath: "/tmp/sample.ipynb",
    cellId: "cell-4",
    editMode: "delete",
  },
  status: "ready",
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

        <div className="gallery-tool-block-file-column">
          <Variant title="Write — new file (size + 'new' chip)">
            <WriteToolBlock {...WRITE_NEW} />
          </Variant>
          <Variant title="Write — overwrite ('overwrite' chip)">
            <WriteToolBlock {...WRITE_OVERWRITE} />
          </Variant>
          <Variant title="Write — error (chrome error band, no body)">
            <WriteToolBlock {...WRITE_ERROR} />
          </Variant>
        </div>

        <div className="gallery-tool-block-file-column">
          <Variant title="NotebookEdit — replace (embedded DiffBlock)">
            <NotebookEditToolBlock {...NOTEBOOK_REPLACE} />
          </Variant>
          <Variant title="NotebookEdit — insert (embedded FileBlock)">
            <NotebookEditToolBlock {...NOTEBOOK_INSERT} />
          </Variant>
          <Variant title="NotebookEdit — delete (confirmation row)">
            <NotebookEditToolBlock {...NOTEBOOK_DELETE} />
          </Variant>
        </div>
      </div>
    </div>
  );
}
