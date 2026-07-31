/**
 * Opening an attachment's full-resolution preview from outside the strip
 * that owns it.
 *
 * A pasted image lives as bytes under an id, not as a path — there is no
 * file to open, so "open this image" can only mean the lightbox the
 * attachment strip already puts behind its thumbnails. That lightbox is a
 * per-pane sheet reached through a React hook, which the annotator's
 * delegated click layer (a plain function, no hooks, no component
 * identity) cannot call.
 *
 * This is the seam between them. Each mounted strip registers an opener
 * that knows its own atoms; a caller asks by atom id and the strip holding
 * that atom answers. Registration rather than a global singleton because
 * several strips are mounted at once — one per transcript turn — and the
 * right one is whichever actually has the image.
 *
 * @module lib/attachment-preview-open
 */

/**
 * Opens the preview for `atomId` if this opener owns that atom. Returns
 * whether it did, so the caller can stop at the first strip that answers.
 */
export type AttachmentPreviewOpener = (atomId: string) => boolean;

const openers = new Set<AttachmentPreviewOpener>();

/**
 * Offer to open previews for the atoms one strip holds. Returns the
 * unregister — call it on unmount, or a closed turn's strip keeps
 * answering for images that are no longer on screen.
 */
export function registerAttachmentPreviewOpener(
  opener: AttachmentPreviewOpener,
): () => void {
  openers.add(opener);
  return () => {
    openers.delete(opener);
  };
}

/**
 * Open the full-resolution preview for `atomId`, at whichever mounted
 * strip holds it. Returns `false` when no strip does — the turn scrolled
 * out of the mounted window, or the atom carries no bytes — and the caller
 * leaves the gesture unhandled rather than opening something arbitrary.
 */
export function openAttachmentPreview(atomId: string): boolean {
  for (const opener of openers) {
    if (opener(atomId)) return true;
  }
  return false;
}
