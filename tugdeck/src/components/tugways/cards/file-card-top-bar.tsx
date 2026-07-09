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
import {
  FolderInput,
  HardDriveDownload,
  Settings as SettingsIcon,
} from "lucide-react";

import type { SaveMode } from "@/lib/file-editor-store";
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
  /** The card's save contract; picks Save (manual) vs Move To… (auto). */
  saveMode: SaveMode;
  /** Move To… affordance is available (draft + native picker present). */
  canMoveTo: boolean;
  /** Open the NSSavePanel to relocate the automatic-mode draft. */
  onMoveTo: () => void;
  /** Save the buffer to the real file (manual mode — a plain Save). */
  onSave: () => void;
  /**
   * Whether Save is currently possible (manual mode) — mirrors the File ▸
   * Save menu gate: not read-only, no unresolved conflict, and either dirty
   * or untitled. Disables the Save button so it can't beep or re-raise a
   * conflict from a clean/blocked state.
   */
  canSave: boolean;
  /** Reveal the bound file in the Finder (path click); absent for untitled. */
  onRevealInFinder?: () => void;
  /** The card-local editor settings the gear popover displays. */
  settings: FileEditorSettings;
  /** Merge a partial settings change (card-local). */
  onChangeSetting: (partial: Partial<FileEditorSettings>) => void;
}

export function FileCardTopBar({
  path,
  isDraft,
  saveMode,
  canMoveTo,
  onMoveTo,
  onSave,
  canSave,
  onRevealInFinder,
  settings,
  onChangeSetting,
}: FileCardTopBarProps) {
  const isUntitled = isDraft || path === null;
  const displayPath = isUntitled ? "Untitled" : path;
  const revealable = !isUntitled && onRevealInFinder !== undefined;
  return (
    <div className="file-card-top-bar" data-slot="file-card-top-bar">
      {/* `dir="rtl"` start-truncates the strip so the filename (path tail)
          stays visible; the leading Left-to-Right mark (U+200E) anchors the
          path's leading "/" so an absolute path doesn't render with the
          slash reordered to the end (looking relative). No title tooltip —
          the full path is already shown; a click reveals it in the Finder. */}
      <span
        className="file-card-top-bar-path"
        dir="rtl"
        data-revealable={revealable ? "true" : undefined}
        onClick={revealable ? onRevealInFinder : undefined}
      >
        {isUntitled ? displayPath : `‎${displayPath}`}
      </span>
      <div className="file-card-top-bar-actions">
        {saveMode === "manual" ? (
          // Manual mode: a plain Save writes the buffer to the real file.
          <TugIconButton
            icon={<HardDriveDownload />}
            aria-label="Save"
            title="Save"
            onClick={onSave}
            disabled={!canSave}
          />
        ) : canMoveTo ? (
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
