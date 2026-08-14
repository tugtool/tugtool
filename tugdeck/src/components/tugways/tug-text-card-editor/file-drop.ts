/**
 * file-drop — drop a file on a Text card and get a markdown link to it.
 *
 * The bytes are copied into an `assets/` folder beside the document being
 * edited and a standard CommonMark link is inserted at the drop caret:
 * `![stem](assets/photo.png)` for an image, `[name](assets/notes.zip)` for
 * anything else. Nothing about the result is Tug-specific — GitHub, pandoc,
 * Obsidian, and `cat` all agree on what the document means afterwards, which
 * is exactly what a database-backed link or an app-scheme URL would cost.
 *
 * The link's visible half is always the name the user dropped. Where the file
 * had to land under a different one — a collision suffix — that stays in the
 * destination, which is the half that has to name a real file. How this
 * feature keeps two files with one name apart is its own business, and a
 * document that suddenly says `photo-2` about a picture the user knows as
 * `photo` is that bookkeeping leaking into their prose.
 *
 * The insertion is an ordinary edit. Dirty state, autosave, aside
 * crash-safety, and undo all apply unchanged; one undo removes the links.
 * The asset files stay — the same as any other file the user put in their own
 * directory, visible in `git status` and theirs to delete.
 *
 * ## What this deliberately does not do
 *
 * No widget, no inline rendering, no preview. The Text card is a raw-source
 * editor and the link stays visible as source, styled by the editor's own
 * markdown tokens. This extension takes the drop caret from the composer's
 * substrate ({@link tugDropCaretExtension}) and nothing else from it: no
 * atoms, no bytes-store, no downsample. A document attachment is a file, not
 * a payload.
 *
 * ## The untitled guard
 *
 * An untitled buffer refuses the drop. Not for want of a directory — it has a
 * very real one, an asides draft path under the Tug data root — but because
 * that directory is app-private and temporary: `saveAs` moves the document
 * out of it, and an `assets/` folder written there would be invisible to the
 * user and orphaned the moment the buffer is saved anywhere. Saving a
 * *titled* document elsewhere breaks its links the same way any `mv` would;
 * that is the standard cost of relative links and is not guarded here.
 *
 * Laws:
 *  - [L06] the drop ring and caret are DOM/CSS — a `data-drop-active`
 *    attribute on the host and the caret layer, never React state.
 *  - [L07] the document path and error sink are read through getters at
 *    dispatch time, never captured at extension-construction time.
 *
 * @module components/tugways/tug-text-card-editor/file-drop
 */

import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

import {
  clearDropCaret,
  dropOffsetAtCoords,
  paintDropCaret,
  tugDropCaretExtension,
} from "../tug-text-editor/drop-extension";
import {
  uploadDocAttachment,
  type DocAttachment,
} from "@/lib/attachment-upload";

/**
 * The absolute path a relative markdown destination names, resolved against
 * the directory holding `docPath`, or `null` when it cannot be resolved to a
 * plain sibling path.
 *
 * Deliberately narrow: only a destination that stays inside the document's own
 * directory tree resolves. An absolute destination, a URL, an anchor, and a
 * `..` escape all answer `null` — a ⌘-click is a reading gesture, and the
 * paths it can reach should be the ones the document itself put there. What
 * comes back is handed to the same guarded open path every other producer
 * uses; nothing assembled here is persisted or compared ([L29]).
 */
export function resolveAgainstDoc(
  docPath: string | null,
  destination: string,
): string | null {
  if (docPath === null || destination.length === 0) return null;
  if (destination.startsWith("#") || destination.startsWith("/")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(destination)) return null;
  const segments = destination.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  const dir = docPath.slice(0, docPath.lastIndexOf("/"));
  if (dir.length === 0) return null;
  return `${dir}/${segments.join("/")}`;
}

/** True when the drag carries at least one file. */
function acceptsDrag(transfer: DataTransfer | null): boolean {
  if (transfer === null) return false;
  return Array.from(transfer.types).includes("Files");
}

/** Set or clear the host's drop ring. */
function setDropActive(host: HTMLElement | null, active: boolean): void {
  if (host === null) return;
  if (active) {
    host.setAttribute("data-drop-active", "accept");
  } else {
    host.removeAttribute("data-drop-active");
  }
}

/**
 * Percent-encode a link destination so CommonMark reads it as one
 * destination. Spaces and parentheses are what actually break — a space ends
 * the destination, a `)` closes it early — and everything else in a filename
 * is left legible on purpose, since the point of keeping the original name is
 * that somebody reads it in the source.
 */
export function encodeLinkDestination(relativePath: string): string {
  return relativePath
    .replace(/%/g, "%25")
    .replace(/ /g, "%20")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E");
}

/**
 * The markdown for one stored asset: an image embed for an image media type,
 * a plain link otherwise.
 *
 * **The label is the name the user dropped, not the name on disk.** These are
 * usually the same, and diverge exactly when a collision suffix was needed:
 * dropping a second `photo.png` writes `assets/photo-2.png`, and the link
 * reads `![photo](assets/photo-2.png)`. Suffixing is bookkeeping this feature
 * does to avoid clobbering a file — it is not something the user did, and the
 * visible half of the link is the half they read. Only the destination, which
 * has to name a real file, carries the suffix.
 *
 * The image's alt text is the dropped filename's stem — what a person would
 * call the picture — while a non-image link shows the whole dropped name,
 * extension included, because the extension is what tells the reader what they
 * are about to open.
 */
export function linkForAsset(
  attachment: DocAttachment,
  droppedName: string,
  mediaType: string,
): string {
  const destination = encodeLinkDestination(attachment.relativePath);
  if (mediaType.startsWith("image/")) {
    const stem = droppedName.replace(/\.[^.]+$/, "");
    return `![${stem}](${destination})`;
  }
  return `[${droppedName}](${destination})`;
}

/** What the extension needs from its host, read fresh on every drop. */
export interface FileDropOptions {
  /** The editor's host element, for the drop ring. */
  host: HTMLElement | null;
  /**
   * The document's absolute path, or `null` for an untitled buffer. Already
   * canonical — it came back from the store's own `openPath` resolution, and
   * the route re-guards it regardless.
   */
  getDocPath: () => string | null;
  /** Surface a failure in the card's notice vocabulary. */
  onError: (message: string) => void;
}

/**
 * File-drop handling for the Text card editor.
 *
 * The drop is claimed in the capture phase so CM6's own text-drop handler
 * never sees it: CM6 would insert at its unbiased `posAtCoords`, which is the
 * position hidden under the drag image rather than the one the drop caret
 * promised.
 */
export function fileDropExtension(options: FileDropOptions): Extension {
  return [
    tugDropCaretExtension,
    ViewPlugin.define((view) => {
      const { host } = options;

      const onDragEnter = (event: DragEvent): void => {
        if (!acceptsDrag(event.dataTransfer)) return;
        event.preventDefault();
        setDropActive(host, true);
      };

      const onDragOver = (event: DragEvent): void => {
        const transfer = event.dataTransfer;
        if (!acceptsDrag(transfer) || transfer === null) return;
        event.preventDefault();
        setDropActive(host, true);
        try {
          transfer.dropEffect = "copy";
        } catch {
          // `dropEffect` is read-only in some environments.
        }
        paintDropCaret(view, event.clientX, event.clientY);
      };

      const onDragLeave = (event: DragEvent): void => {
        // A dragleave also fires for every internal element-to-element
        // crossing; `relatedTarget` names the element being entered, so a
        // target still inside the host means the drag has not left.
        const related = event.relatedTarget as Node | null;
        if (related !== null && host !== null && host.contains(related)) return;
        setDropActive(host, false);
        clearDropCaret(view);
      };

      const onDragEnd = (): void => {
        setDropActive(host, false);
        clearDropCaret(view);
      };

      const onDrop = (event: DragEvent): void => {
        const transfer = event.dataTransfer;
        if (!acceptsDrag(transfer) || transfer === null) return;
        const files = Array.from(transfer.files);
        if (files.length === 0) return;

        event.preventDefault();
        event.stopPropagation();
        setDropActive(host, false);

        const docPath = options.getDocPath();
        if (docPath === null) {
          clearDropCaret(view);
          options.onError(
            "Save the file first — an unsaved document has nowhere to keep an attachment.",
          );
          return;
        }

        // Resolve the insertion point from the pointer BEFORE any await: the
        // caret the user was shown is the one the links must land at, and the
        // coordinates stop meaning anything once the drag is over.
        const dropPos =
          dropOffsetAtCoords(view, event.clientX, event.clientY) ??
          view.state.doc.length;
        clearDropCaret(view);

        void (async () => {
          const uploaded = await Promise.all(
            files.map(async (file) => ({
              file,
              attachment: await uploadDocAttachment(docPath, file),
            })),
          );
          // The editor may have unmounted while the bytes were in flight.
          if (!view.dom.isConnected) return;

          const links: string[] = [];
          for (const { file, attachment } of uploaded) {
            if (attachment === null) {
              options.onError(`Could not attach ${file.name}.`);
              continue;
            }
            links.push(linkForAsset(attachment, file.name, file.type));
          }
          if (links.length === 0) return;

          // One transaction, so one undo removes the whole drop.
          const pos = Math.min(dropPos, view.state.doc.length);
          const insert = links.join(" ");
          view.dispatch({
            changes: { from: pos, insert },
            selection: { anchor: pos + insert.length },
            userEvent: "input.tug-file-drop",
          });
          view.focus();
        })();
      };

      const dom = view.dom;
      dom.addEventListener("dragenter", onDragEnter);
      dom.addEventListener("dragover", onDragOver);
      dom.addEventListener("dragleave", onDragLeave);
      dom.addEventListener("dragend", onDragEnd);
      dom.addEventListener("drop", onDrop, true);

      return {
        destroy(): void {
          dom.removeEventListener("dragenter", onDragEnter);
          dom.removeEventListener("dragover", onDragOver);
          dom.removeEventListener("dragleave", onDragLeave);
          dom.removeEventListener("dragend", onDragEnd);
          dom.removeEventListener("drop", onDrop, true);
          setDropActive(options.host, false);
        },
      };
    }),
  ];
}
