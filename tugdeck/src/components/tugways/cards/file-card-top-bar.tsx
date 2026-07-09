/**
 * file-card-top-bar.tsx — the thin chrome strip above a File card's
 * editor: the full file path on the left (BBEdit-style) and the action
 * icons on the right (Move To… for untitled drafts, plus the gear that
 * opens the editor-options popover).
 *
 * The gear popover renders the shared `FileEditorControls` (the same
 * Editing + Display groups as the Settings card's File Editor tab), so
 * the two look identical. The controls write the card-local File-editor
 * settings (`use-file-editor-settings`), so a change takes effect in
 * this card only.
 *
 * Laws: layout lives in file-card.css [L06]; composes real Tug
 * components (no hand-rolled UI) [use-tug-components].
 *
 * @module components/tugways/cards/file-card-top-bar
 */

import React from "react";
import { FolderInput, Settings as SettingsIcon } from "lucide-react";

import { TugIconButton } from "../tug-icon-button";
import {
  TugPopover,
  TugPopoverContent,
  TugPopoverTrigger,
} from "../tug-popover";
import { FileEditorControls } from "./file-editor-controls";
import type { FileEditorSettings } from "@/lib/file-editor-settings";

export interface FileCardTopBarProps {
  /** Full bound path, or null for an unbound / untitled buffer. */
  path: string | null;
  /** Whether the buffer is an untitled draft (path is a drafts-dir file). */
  isDraft: boolean;
  /** Move To… affordance is available (draft + native picker present). */
  canMoveTo: boolean;
  /** Open the NSSavePanel to name / relocate the buffer. */
  onMoveTo: () => void;
  /** The card-local editor settings the gear popover displays. */
  settings: FileEditorSettings;
  /** Merge a partial settings change (card-local). */
  onChangeSetting: (partial: Partial<FileEditorSettings>) => void;
}

export function FileCardTopBar({
  path,
  isDraft,
  canMoveTo,
  onMoveTo,
  settings,
  onChangeSetting,
}: FileCardTopBarProps) {
  const displayPath = isDraft || path === null ? "Untitled" : path;
  return (
    <div className="file-card-top-bar" data-slot="file-card-top-bar">
      {/* `dir="rtl"` keeps the filename (path tail) visible when the
          strip is too narrow — the ellipsis eats the leading dirs. */}
      <span className="file-card-top-bar-path" dir="rtl" title={displayPath}>
        {displayPath}
      </span>
      <div className="file-card-top-bar-actions">
        {canMoveTo ? (
          <TugIconButton
            icon={<FolderInput />}
            aria-label="Move to a permanent location"
            title="Move To…"
            onClick={onMoveTo}
          />
        ) : null}
        <FileCardOptionsPopover settings={settings} onChangeSetting={onChangeSetting} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Options popover (the gear)
// ---------------------------------------------------------------------------

function FileCardOptionsPopover({
  settings,
  onChangeSetting,
}: {
  settings: FileEditorSettings;
  onChangeSetting: (partial: Partial<FileEditorSettings>) => void;
}) {
  return (
    // The controls dispatch chain actions of their own; keep the popover
    // open across them (click-outside / Escape still dismiss).
    <TugPopover dismissOnChainActivity={false}>
      <TugPopoverTrigger>
        <TugIconButton
          icon={<SettingsIcon />}
          aria-label="Editor options"
          title="Editor options"
        />
      </TugPopoverTrigger>
      <TugPopoverContent side="bottom" align="end" sideOffset={6}>
        <div className="file-card-options" data-testid="file-card-options">
          {/* The app-wide settings card takes its title from the tab;
              the popover has no tab, so it carries its own. */}
          <div className="file-card-options-title">File Editor Settings</div>
          <FileEditorControls settings={settings} onChange={onChangeSetting} />
        </div>
      </TugPopoverContent>
    </TugPopover>
  );
}
