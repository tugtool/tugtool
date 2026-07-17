/**
 * session-context-attachments.tsx — the attached-context sub-rows that ride
 * above a user turn's prose.
 *
 * When a user submission was preceded by staged shell / `/btw` context (the
 * VISIBILITY toggle, or a row's Add-to-context action), that context travels
 * inside the user message as `<tug-context>` sentinel blocks. The transcript's
 * user row splits those blocks off the prose ({@link splitLeadingContext}) and
 * renders them here — a subdued, attributed stack that makes visible exactly
 * what extra context Claude received with the message. The same split runs on
 * the live optimistic echo and a JSONL restore, so these rows are durable, not
 * a live-only decoration.
 *
 * The block body is rendered with the shared {@link TugMarkdownBlock} pipeline
 * (a shell block is fenced command+output, a `/btw` block is a Q/A pair), so it
 * reads identically to the main transcript, just inside the subdued frame.
 *
 * @module components/tugways/cards/session-context-attachments
 */

import React from "react";
import { MessageSquareDashed, Shell } from "lucide-react";

import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";
import type { ParsedContextBlock } from "@/lib/pending-context-store";

import "./session-context-attachments.css";

/** Human label + icon for a parsed block's source — the SAME icons the route
 *  selector uses for the `$` shell and `?` btw routes. */
function blockHeading(block: ParsedContextBlock): { icon: React.ReactNode; label: string } {
  if (block.source === "shell") {
    return {
      icon: <Shell size={13} strokeWidth={2} aria-hidden />,
      label: "shell",
    };
  }
  return {
    icon: <MessageSquareDashed size={13} strokeWidth={2} aria-hidden />,
    label: "/btw",
  };
}

export interface SessionContextAttachmentsProps {
  blocks: readonly ParsedContextBlock[];
}

/**
 * Render the attached-context stack, or nothing when there are no blocks (the
 * overwhelmingly common case — a plain user message).
 */
export function SessionContextAttachments({
  blocks,
}: SessionContextAttachmentsProps): React.ReactElement | null {
  if (blocks.length === 0) return null;
  return (
    <div className="session-context-attachments" data-slot="session-context-attachments">
      {blocks.map((block, i) => {
        const { icon, label } = blockHeading(block);
        return (
          <div
            // Blocks are positional within a turn and carry no unique id; the
            // source+ref+index key is stable for a settled turn (the blocks
            // never reorder) and unique across a turn's stack.
            key={`${block.source}-${block.ref}-${i}`}
            className="session-context-attachment"
            data-source={block.source}
          >
            <div className="session-context-attachment-heading">
              <span className="session-context-attachment-icon">{icon}</span>
              <span className="session-context-attachment-label">{label}</span>
            </div>
            <TugMarkdownBlock
              initialText={block.body}
              className="session-context-attachment-body"
            />
          </div>
        );
      })}
    </div>
  );
}
