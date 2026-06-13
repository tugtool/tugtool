/**
 * gallery-transcript-copy.tsx — app-test fixture for the transcript COPY
 * path ([Q03], the lighter real-cell approach).
 *
 * Proves the **real handler path** end to end: the actual
 * `useTranscriptCellMenu` (⌘C / context-menu Copy → responder →
 * `handleCopy`), the actual `selectionToTranscriptMarkdown` fragment
 * serializer, and the actual clipboard write. It mounts the real
 * DOM-producing components — `TugMarkdownBlock` (streaming),
 * `ToolBlockChrome`, `DevThinkingBlock` — in the same body shape
 * `AssistantTurnCell` renders, over a static streaming store.
 *
 * **Two cells, two responder scopes.** Cell A interleaves markdown
 * (with inline syntax) → a Bash tool block → a thinking block → more
 * markdown; cell B holds a single multi-block message. Each cell owns
 * its own `useTranscriptCellMenu` instance — exactly as the real
 * transcript mounts one responder scope per row — so a selection can
 * exercise inline-accurate, partial-construct, cross-block (within a
 * cell), no-overshoot, AND **cross-cell** (spanning the two scopes)
 * cases. Cross-cell copy needs no host handler: the serializer walks
 * the whole `Range` from its `commonAncestorContainer`, so whichever
 * cell owns the COPY gesture reconstructs the entire spanned text
 * faithfully ([P09]). `at0188` drives the selections.
 *
 * @module components/tugways/cards/gallery-transcript-copy
 */

import React from "react";

import { PropertyStore } from "@/components/tugways/property-store";
import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";
import { DevThinkingBlock } from "@/components/tugways/chrome/dev-thinking-block";
import { ToolBlockChrome } from "@/components/tugways/cards/tool-blocks/tool-block-chrome";
import { ToolUseIdContext } from "@/components/tugways/cards/tool-blocks/collapse-context";
import {
  type CopyMarkdownResolver,
  useTranscriptCellMenu,
} from "@/components/tugways/cards/dev-card-transcript";
import { selectionToTranscriptMarkdown } from "@/lib/markdown/serialize-selection";

const TURN_KEY = "fixture";
const TOOL_USE_ID = "tu-fixture-1";

const PATH_A = `turn.${TURN_KEY}.message.mA.text`;
const PATH_THINK = `turn.${TURN_KEY}.message.mThink.text`;
const PATH_B = `turn.${TURN_KEY}.message.mB.text`;
const PATH_MULTI = `turn.${TURN_KEY}.message.mMulti.text`;
const PATH_RICH = `turn.${TURN_KEY}.message.mRich.text`;

const SOURCE_A =
  "First paragraph with **bold**, `inline code`, and a [link](https://example.com) all on one line.";
const SOURCE_THINK = "Private reasoning the user did not select.";
const SOURCE_B = "Closing paragraph after the tool call.";
// A SINGLE message rendering MANY blocks (paragraph → rule → heading →
// paragraph) — the shape a real assistant reply has. Selecting only the
// first paragraph must copy only it, never overshoot into the rule or
// the heading below. Lives in a SEPARATE cell from SOURCE_A/B so a
// selection from cell A into here crosses a real responder boundary.
const SOURCE_MULTI =
  "Alpha paragraph one only.\n\n---\n\n## Beta Heading\n\nGamma paragraph two.";
// Rich-content message for the source-faithful regression cases
// ([#step-12]): a heading, a list, inline + display math (the KaTeX
// TeX-extraction path), and a fenced code block. Selecting each must
// copy its markdown source — `### …`, `- …`, `$…$` / `$$…$$`, ``` ``` ``` —
// never the rendered glyph/highlight text.
const SOURCE_RICH = [
  "### Rich Heading",
  "",
  "- List item alpha",
  "- List item beta",
  "",
  "Inline math $E = mc^2$ in a sentence.",
  "",
  "$$x = a + b$$",
  "",
  "```ts",
  "const y = 1;",
  "```",
].join("\n");

/**
 * GalleryTranscriptCopy — mounts the real transcript COPY wiring over a
 * static two-cell body for `at0188`.
 */
export function GalleryTranscriptCopy(): React.ReactElement {
  const streamingStore = React.useMemo(
    () =>
      new PropertyStore({
        schema: [
          { path: PATH_A, type: "string", label: "a" },
          { path: PATH_THINK, type: "string", label: "think" },
          { path: PATH_B, type: "string", label: "b" },
          { path: PATH_MULTI, type: "string", label: "multi" },
          { path: PATH_RICH, type: "string", label: "rich" },
        ],
        initialValues: {
          [PATH_A]: SOURCE_A,
          [PATH_THINK]: SOURCE_THINK,
          [PATH_B]: SOURCE_B,
          [PATH_MULTI]: SOURCE_MULTI,
          [PATH_RICH]: SOURCE_RICH,
        },
      }),
    [],
  );

  const resolveCopyMarkdown = React.useCallback<CopyMarkdownResolver>(
    (bodyEl, selection) => selectionToTranscriptMarkdown(selection, bodyEl),
    [],
  );

  // Two cells, each its own responder scope — mirrors the real
  // transcript's one-scope-per-row shape.
  const cellA = useTranscriptCellMenu(resolveCopyMarkdown);
  const cellB = useTranscriptCellMenu(resolveCopyMarkdown);
  const cellC = useTranscriptCellMenu(resolveCopyMarkdown);

  // App-test probe: run the production serializer over the *current*
  // selection deterministically (no native ⌘C / selection-sync concern),
  // so at0188 can assert the reconstruction directly. Body-independent
  // (the serializer reconstructs from the selection's Range, not the
  // body), so the single probe covers both cells and any cross-cell
  // span. The ⌘C path shares the same `resolveCopyMarkdown`.
  React.useLayoutEffect(() => {
    (globalThis as { __tugCopyWiringProbe?: () => string | null }).__tugCopyWiringProbe =
      () => {
        const sel = window.getSelection();
        if (sel === null) return null;
        return selectionToTranscriptMarkdown(sel, document.body);
      };
    return () => {
      (globalThis as { __tugCopyWiringProbe?: () => string | null }).__tugCopyWiringProbe =
        undefined;
    };
  }, []);

  return (
    <div
      className="cg-content"
      data-testid="gallery-transcript-copy"
      style={{ padding: 16, fontSize: 14 }}
    >
      {/* Cell A — markdown + tool + thinking + markdown. */}
      <cellA.ResponderScope>
        <div {...cellA.cellProps}>
          <div
            data-testid="gallery-transcript-copy-cell-a"
            ref={(el) => {
              cellA.bodyRef.current = el;
            }}
          >
            <TugMarkdownBlock
              streamingStore={streamingStore}
              streamingPath={PATH_A}
              className="dev-card-transcript-code-body"
            />
            <ToolUseIdContext.Provider value={TOOL_USE_ID}>
              <ToolBlockChrome toolName="Bash" argsSummary={<code>ls -la</code>} status="ready">
                <pre>file1.txt{"\n"}file2.txt</pre>
              </ToolBlockChrome>
            </ToolUseIdContext.Provider>
            <DevThinkingBlock
              streamingStore={streamingStore}
              streamingPath={PATH_THINK}
            />
            <TugMarkdownBlock
              streamingStore={streamingStore}
              streamingPath={PATH_B}
              className="dev-card-transcript-code-body"
            />
          </div>
        </div>
        {cellA.menu}
      </cellA.ResponderScope>

      {/* Cell B — a single multi-block message, a separate responder scope. */}
      <cellB.ResponderScope>
        <div {...cellB.cellProps}>
          <div
            data-testid="gallery-transcript-copy-cell-b"
            ref={(el) => {
              cellB.bodyRef.current = el;
            }}
          >
            <TugMarkdownBlock
              streamingStore={streamingStore}
              streamingPath={PATH_MULTI}
              className="dev-card-transcript-code-body"
            />
          </div>
        </div>
        {cellB.menu}
      </cellB.ResponderScope>

      {/* Cell C — rich constructs (heading / list / math / fenced code)
          for the source-faithful regression cases ([#step-12]). */}
      <cellC.ResponderScope>
        <div {...cellC.cellProps}>
          <div
            data-testid="gallery-transcript-copy-cell-c"
            ref={(el) => {
              cellC.bodyRef.current = el;
            }}
          >
            <TugMarkdownBlock
              streamingStore={streamingStore}
              streamingPath={PATH_RICH}
              className="dev-card-transcript-code-body"
            />
          </div>
        </div>
        {cellC.menu}
      </cellC.ResponderScope>
    </div>
  );
}
