/**
 * file-card-status-bar.tsx — the thin status strip at the bottom of a
 * File card's editor, in the spirit of BBEdit's document status bar.
 *
 * Left to right: save state (alone on the left), then two clusters on
 * the right — the **settable** pair (line-ending and syntax/file type,
 * each a popup menu) and the **number** pair (caret line/column and the
 * line / word / character counts), separated by a divider.
 *
 * Live counts + caret ride the per-card `EditorStatsStore`
 * (`useSyncExternalStore`), so keystroke-rate updates repaint only this
 * strip; save state / line-ending come from the `FileEditorStore`
 * snapshot the card already subscribes to. The two popups dispatch
 * through this panel's `useResponderForm` responder.
 *
 * Laws: layout-only CSS in file-card.css [L06]; stats enter through
 * `useSyncExternalStore` [L02]; the popups emit actions to this panel's
 * responder ([L11]); composes real Tug components [use-tug-components].
 *
 * @module components/tugways/cards/file-card-status-bar
 */

import React, { useId, useSyncExternalStore } from "react";

import { TugPopupButton, type TugPopupButtonItem } from "../tug-popup-button";
import { useResponderForm } from "../use-responder-form";
import { TUG_ACTIONS } from "../action-vocabulary";
import type { EditorStatsStore } from "@/lib/editor-stats-store";
import type { FileSaveState, LineEnding } from "@/lib/file-editor-store";
import { SELECTABLE_LANGUAGES } from "@/lib/language-registry";

const LINE_ENDING_LABEL: Record<LineEnding, string> = {
  LF: "Unix (LF)",
  CRLF: "Windows (CRLF)",
  CR: "Classic Mac (CR)",
};

const LINE_ENDING_ITEMS: TugPopupButtonItem<string>[] = (
  ["LF", "CRLF", "CR"] as const
).map((ending) => ({
  action: TUG_ACTIONS.SET_VALUE,
  value: ending,
  label: LINE_ENDING_LABEL[ending],
}));

const LANGUAGE_ITEMS: TugPopupButtonItem<string>[] = SELECTABLE_LANGUAGES.map(
  (lang) => ({ action: TUG_ACTIONS.SET_VALUE, value: lang.id, label: lang.label }),
);

export interface FileCardStatusBarProps {
  statsStore: EditorStatsStore;
  saveState: FileSaveState;
  lastSavedAt: number | null;
  lineEnding: LineEnding;
  /** Change the buffer's line-ending style. */
  onSetLineEnding: (ending: LineEnding) => void;
  /** Current selectable-language id (see `SELECTABLE_LANGUAGES`). */
  languageId: string;
  /** Override the card's syntax highlighting / file type. */
  onSetLanguage: (id: string) => void;
}

/** Save-state cell copy: transient while dirty, timestamped when clean. */
function saveText(saveState: FileSaveState, lastSavedAt: number | null): string {
  if (saveState === "writing") return "Saving…";
  if (saveState === "editing") return "Unsaved";
  if (lastSavedAt === null) return "Saved";
  return `Saved: ${new Date(lastSavedAt).toLocaleTimeString()}`;
}

export function FileCardStatusBar({
  statsStore,
  saveState,
  lastSavedAt,
  lineEnding,
  onSetLineEnding,
  languageId,
  onSetLanguage,
}: FileCardStatusBarProps) {
  const stats = useSyncExternalStore(statsStore.subscribe, statsStore.getSnapshot);

  const lineEndingSenderId = useId();
  const languageSenderId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    setValueString: {
      [lineEndingSenderId]: (v: string) => onSetLineEnding(v as LineEnding),
      [languageSenderId]: (v: string) => onSetLanguage(v),
    },
  });

  const languageLabel =
    SELECTABLE_LANGUAGES.find((l) => l.id === languageId)?.label ?? "Plain Text";

  return (
    <ResponderScope>
      <div
        className="file-card-status-bar"
        data-slot="file-card-status-bar"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        <span
          className="file-card-status-cell file-card-status-save"
          data-testid="file-card-status-save"
        >
          {saveText(saveState, lastSavedAt)}
        </span>

        {/* Settable pair, pushed to the right edge. */}
        <div className="file-card-status-group file-card-status-group--settable">
          <TugPopupButton
            size="xs"
            label={LINE_ENDING_LABEL[lineEnding]}
            items={LINE_ENDING_ITEMS}
            senderId={lineEndingSenderId}
          />
          <TugPopupButton
            size="xs"
            label={languageLabel}
            items={LANGUAGE_ITEMS}
            senderId={languageSenderId}
          />
        </div>

        {/* Number pair, divided from the settable pair. */}
        <div className="file-card-status-group file-card-status-group--numbers">
          <span
            className="file-card-status-cell file-card-status-caret"
            data-testid="file-card-status-caret"
          >
            {`L: ${stats.caretLine}  C: ${stats.caretCol}`}
          </span>
          <span
            className="file-card-status-cell file-card-status-counts"
            data-testid="file-card-status-counts"
            title="lines / words / characters"
          >
            {`${stats.lines.toLocaleString()} / ${stats.words.toLocaleString()} / ${stats.chars.toLocaleString()}`}
          </span>
        </div>
      </div>
    </ResponderScope>
  );
}
