/**
 * Attachment handler - file processing and attachment UI
 */

import { createElement, Paperclip, X } from "lucide";
import type { Attachment } from "./types";

// Image MIME types we support
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

// Text file extensions
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "yaml", "yml", "toml", "xml",
  "html", "htm", "css", "js", "ts", "jsx", "tsx", "py", "rs",
  "go", "java", "c", "cpp", "h", "hpp", "sh", "bash", "zsh",
  "fish", "sql", "csv", "log", "conf", "ini", "env",
]);

/**
 * Check if a file is a text file based on MIME type or extension
 */
function isTextFile(file: File): boolean {
  // Check MIME type first
  if (file.type.startsWith("text/")) {
    return true;
  }

  // Check extension
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext ? TEXT_EXTENSIONS.has(ext) : false;
}

/**
 * Process a file and convert to Attachment format
 */
export async function processFile(file: File): Promise<Attachment> {
  // Image files -> base64
  if (IMAGE_TYPES.has(file.type)) {
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return {
      filename: file.name,
      content: base64,
      media_type: file.type,
    };
  }

  // Text files -> text content
  if (isTextFile(file)) {
    const text = await file.text();
    return {
      filename: file.name,
      content: text,
      media_type: file.type || "text/plain",
    };
  }

  // Reject binary files
  throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
}

/**
 * AttachmentHandler manages pending attachments for the next message
 */
export class AttachmentHandler {
  private pendingAttachments: Attachment[] = [];
  public onUpdate?: () => void;

  /**
   * Add a file to pending attachments
   */
  async addFile(file: File): Promise<void> {
    try {
      const attachment = await processFile(file);
      this.pendingAttachments.push(attachment);
      if (this.onUpdate) {
        this.onUpdate();
      }
    } catch (error) {
      console.error("Failed to process file:", error);
      throw error;
    }
  }

  /**
   * Remove an attachment by index
   */
  removeAttachment(index: number): void {
    if (index >= 0 && index < this.pendingAttachments.length) {
      this.pendingAttachments.splice(index, 1);
      if (this.onUpdate) {
        this.onUpdate();
      }
    }
  }

  /**
   * Get copy of attachments
   */
  getAttachments(): Attachment[] {
    return [...this.pendingAttachments];
  }

  /**
   * Clear all pending attachments
   */
  clear(): void {
    this.pendingAttachments = [];
    if (this.onUpdate) {
      this.onUpdate();
    }
  }

  /**
   * Check if there are pending attachments
   */
  hasPending(): boolean {
    return this.pendingAttachments.length > 0;
  }
}

/**
 * Render attachment chips
 */
export function renderAttachmentChips(
  attachments: Attachment[],
  options: { removable: boolean; onRemove?: (index: number) => void }
): HTMLElement {
  const container = document.createElement("div");
  container.className = "attachment-chips";

  for (let i = 0; i < attachments.length; i++) {
    const attachment = attachments[i];
    const chip = document.createElement("div");
    chip.className = "attachment-chip";

    // Paperclip icon
    const iconSpan = document.createElement("span");
    iconSpan.className = "attachment-chip-icon";
    const icon = createElement(Paperclip, { width: 14, height: 14 });
    iconSpan.appendChild(icon);
    chip.appendChild(iconSpan);

    // Filename
    const nameSpan = document.createElement("span");
    nameSpan.className = "attachment-chip-name";
    nameSpan.textContent = attachment.filename;
    nameSpan.title = attachment.filename; // Tooltip for long names
    chip.appendChild(nameSpan);

    // Remove button (if removable)
    if (options.removable && options.onRemove) {
      const removeBtn = document.createElement("button");
      removeBtn.className = "attachment-chip-remove";
      removeBtn.type = "button";
      removeBtn.dataset.index = String(i);
      const xIcon = createElement(X, { width: 14, height: 14 });
      removeBtn.appendChild(xIcon);
      removeBtn.addEventListener("click", () => {
        if (options.onRemove) {
          options.onRemove(i);
        }
      });
      chip.appendChild(removeBtn);
    }

    container.appendChild(chip);
  }

  return container;
}

/**
 * Render attach button with file picker
 */
export function renderAttachButton(onFilesSelected: (files: FileList) => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "attach-btn";
  button.type = "button";
  button.title = "Attach files";

  const icon = createElement(Paperclip, { width: 20, height: 20 });
  button.appendChild(icon);

  button.addEventListener("click", () => {
    // Create hidden file input
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/*,.txt,.md,.json,.yaml,.yml,.toml,.xml,.html,.css,.js,.ts,.py,.rs,.go,.java,.c,.cpp,.sh";

    input.addEventListener("change", () => {
      if (input.files && input.files.length > 0) {
        onFilesSelected(input.files);
      }
    });

    input.click();
  });

  return button;
}
