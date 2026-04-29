/**
 * tug-text-editor/host-state.ts — bridges CodeMirror 6 focus state into a
 * `data-focused` attribute on the React-owned host wrapper.
 *
 * The host wrapper (`<div class="tug-text-editor">`) is not the focused
 * element when the editor has focus — `.cm-content` is. CSS rules that
 * style the host based on editor focus therefore cannot use the `:focus`
 * pseudo-class. This extension subscribes to CM6's update stream and
 * mirrors `view.hasFocus` into a `data-focused` attribute on the host,
 * so the host's CSS can match `[data-focused]` directly [L06, L22].
 *
 * Laws: [L06] appearance via DOM mutation (data-attribute), never React
 *        state, [L19] file structure, [L22] direct DOM updates from a
 *        store-style observer (the CM6 update stream) without React
 *        round-trip.
 */

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/**
 * Build a CodeMirror 6 extension that mirrors editor focus state into
 * `host.dataset.focused` ("" when focused, attribute removed when not).
 *
 * The host element is captured by closure when the extension is created;
 * `TugTextEditor` constructs the extension once per `EditorView` mount, so the
 * captured `host` is always the live wrapper for that instance.
 */
export function hostFocusMirror(host: HTMLElement): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.focusChanged) return;
    if (update.view.hasFocus) {
      host.dataset.focused = "";
    } else {
      delete host.dataset.focused;
    }
  });
}
