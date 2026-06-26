/**
 * copy-as-plain-text — the Edit ▸ Copy as Plain Text behavior.
 *
 * Plain Copy operates on whatever the document selection is — in Tug.app
 * the ⌘C menu chord routes to WebKit's native `copy:`, which copies the
 * current DOM selection regardless of which surface it lives in. Copy as
 * Plain Text must work over that same universe, so it reads the live
 * selection directly rather than relying on a per-surface responder
 * handler. The selected text is run through `stripMarkdown` and written
 * back to the clipboard — plain-text only, no atom sidecar.
 *
 * The write prefers the native bridge (popup-free NSPasteboard write in
 * Tug.app, and the only path that works when the copy is driven from a
 * menu control frame rather than a JS user gesture); outside Tug.app it
 * falls back to the async Clipboard API, which is authorized because the
 * browser-dev path runs inside the keystroke / menu-activation gesture.
 */

import { stripMarkdown } from "./paste-transforms";
import {
  hasNativeClipboardBridge,
  writeClipboardViaNative,
} from "./tug-native-clipboard";

/**
 * Read the plain text of the current selection. Native `<input>` /
 * `<textarea>` keep their own selection model that `window.getSelection()`
 * does not reflect, so a focused text control is checked first; otherwise
 * the document selection (CodeMirror, transcript, markdown / code views,
 * terminal output — any contenteditable or rendered surface) is used.
 */
function readSelectionText(): string {
  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement
  ) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    if (start !== end) return active.value.slice(start, end);
  }
  return window.getSelection()?.toString() ?? "";
}

/**
 * Copy the current selection to the clipboard with Markdown stripped to
 * plain text. No-op when nothing is selected.
 */
export function copySelectionAsPlainText(): void {
  const raw = readSelectionText();
  if (raw === "") return; // nothing selected — no-op
  const text = stripMarkdown(raw);
  if (hasNativeClipboardBridge()) {
    writeClipboardViaNative(text, "");
    return;
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => {});
  }
}
