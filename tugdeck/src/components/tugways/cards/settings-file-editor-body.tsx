/**
 * settings-file-editor-body.tsx — the File Editor settings panel.
 *
 * The deck-wide defaults a newly opened File card adopts on first open,
 * plus the deck-wide `openTarget` behavior (where a newly opened file
 * lands). The Editing + Display view settings are the shared
 * `FileEditorControls` (the same component the per-card gear popover
 * renders), bound here to the deck-wide defaults store; the
 * defaults-only "Open Files In" choice lives below them.
 *
 * Self-contained: constructs its own `DefaultFileEditorStore` at mount
 * and disposes it on unmount. The store reads/writes the **deck-wide**
 * `dev.tugtool.file-editor` domain and observes `onDomainChanged`, so
 * edits here propagate live to every open File card that has not yet
 * pinned its own per-card values.
 *
 * Laws: store snapshot enters via `useSyncExternalStore` [L02]; the
 * open-target control dispatches through the chain to this panel's
 * `useResponderForm` responder ([L11]); layout lives in
 * settings-file-editor-body.css [L06].
 *
 * @module components/tugways/cards/settings-file-editor-body
 */

import React, { useEffect, useId, useState, useSyncExternalStore } from "react";
import { TugBox } from "../tug-box";
import { TugChoiceGroup } from "../tug-choice-group";
import { useResponderForm } from "../use-responder-form";
import { FileEditorControls } from "./file-editor-controls";
import { DefaultFileEditorStore } from "@/lib/default-file-editor-store";
import type { FileEditorOpenTarget, FileEditorSettings } from "@/lib/file-editor-settings";
import "./settings-file-editor-body.css";

export function SettingsFileEditorBody() {
  const [defaultsStore] = useState(() => new DefaultFileEditorStore());
  useEffect(() => () => defaultsStore.dispose(), [defaultsStore]);

  const defaults = useSyncExternalStore(
    defaultsStore.subscribe,
    defaultsStore.getSnapshot,
  );

  const openTargetId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: {
      [openTargetId]: (v: string) =>
        defaultsStore.set({ openTarget: v as FileEditorOpenTarget }),
    },
  });

  const onChange = (partial: Partial<FileEditorSettings>) =>
    defaultsStore.set(partial);

  return (
    <div className="settings-file-editor" data-testid="settings-file-editor">
      <FileEditorControls settings={defaults} onChange={onChange} />

      <ResponderScope>
        <div ref={responderRef as (el: HTMLDivElement | null) => void}>
          <TugBox
            label="Open Files In"
            labelPosition="legend"
            variant="bordered"
            className="settings-file-editor-group"
          >
            {/* Where a newly opened file lands when no card already holds
                it. A file already open in a card always activates that
                card regardless. */}
            <TugChoiceGroup
              className="settings-file-editor-open-choice"
              size="sm"
              senderId={openTargetId}
              value={defaults.openTarget}
              aria-label="Where a newly opened file is placed"
              items={[
                { value: "new", label: "New Card" },
                { value: "reuse", label: "Frontmost Card" },
                { value: "newTab", label: "New Tab In Frontmost Card" },
              ]}
            />
          </TugBox>
        </div>
      </ResponderScope>
    </div>
  );
}
