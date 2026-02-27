/**
 * AttachmentHandler — React component for drag-and-drop file attachment,
 * paste handling, and attachment chip display.
 *
 * Exposes an imperative handle (via forwardRef / useImperativeHandle) so the
 * parent ConversationCard can retrieve pending attachments and clear them after
 * a message is sent.
 *
 * Drag events on the outer card container are wired through props so the parent
 * can pass drag-over state down; this component handles its own chip rendering
 * and the file-picker attach button.
 *
 * References: [D03] React content only, Step 8.2
 */

import { useState, useCallback, forwardRef, useImperativeHandle, useRef } from "react";
import { Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { processFile } from "../../../cards/conversation/attachment-handler";
import type { Attachment } from "../../../cards/conversation/types";

// ---- Imperative handle ----

export interface AttachmentHandlerHandle {
  /** Return current pending attachments (snapshot). */
  getAttachments: () => Attachment[];
  /** Clear all pending attachments. */
  clear: () => void;
  /** Add a file programmatically (e.g. from paste). */
  addFile: (file: File) => Promise<void>;
}

// ---- Props ----

export interface AttachmentHandlerProps {
  /** Whether to show an error if a file is unsupported (displayed inline). */
  onError?: (message: string) => void;
}

// ---- Component ----

export const AttachmentHandler = forwardRef<AttachmentHandlerHandle, AttachmentHandlerProps>(
  function AttachmentHandler({ onError }, ref) {
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const addFile = useCallback(async (file: File) => {
      try {
        const attachment = await processFile(file);
        setAttachments((prev) => [...prev, attachment]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("AttachmentHandler: failed to process file:", message);
        onError?.(message);
      }
    }, [onError]);

    const removeAttachment = useCallback((index: number) => {
      setAttachments((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const clear = useCallback(() => {
      setAttachments([]);
    }, []);

    const getAttachments = useCallback(() => [...attachments], [attachments]);

    // Expose imperative handle
    useImperativeHandle(ref, () => ({
      getAttachments,
      clear,
      addFile,
    }), [getAttachments, clear, addFile]);

    // Handle file picker selection
    const handleFilesSelected = useCallback(async (files: FileList) => {
      for (const file of Array.from(files)) {
        await addFile(file);
      }
    }, [addFile]);

    const handleAttachClick = () => {
      fileInputRef.current?.click();
    };

    return (
      <div className="attachment-handler" data-testid="attachment-handler">
        {/* Pending attachment chips */}
        {attachments.length > 0 && (
          <div className="attachment-chips flex flex-wrap gap-1.5 px-3 py-1.5">
            {attachments.map((attachment, index) => (
              <div
                key={`${attachment.filename}-${index}`}
                className="attachment-chip flex items-center gap-1 rounded-full border bg-muted px-2.5 py-1 text-xs"
                data-testid="attachment-chip"
              >
                <Paperclip className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span
                  className="attachment-chip-name max-w-[120px] truncate"
                  title={attachment.filename}
                >
                  {attachment.filename}
                </span>
                <button
                  type="button"
                  className="attachment-chip-remove ml-0.5 rounded-full p-0.5 hover:bg-background"
                  onClick={() => removeAttachment(index)}
                  aria-label={`Remove attachment ${attachment.filename}`}
                  data-testid={`remove-attachment-${index}`}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Attach button */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="attach-btn h-8 px-2"
          onClick={handleAttachClick}
          title="Attach files"
          aria-label="Attach files"
          data-testid="attach-button"
        >
          <Paperclip className="h-4 w-4" aria-hidden="true" />
        </Button>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.txt,.md,.json,.yaml,.yml,.toml,.xml,.html,.css,.js,.ts,.py,.rs,.go,.java,.c,.cpp,.sh"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              void handleFilesSelected(e.target.files);
            }
            // Reset so the same file can be re-selected
            e.target.value = "";
          }}
          data-testid="file-input"
        />
      </div>
    );
  }
);
