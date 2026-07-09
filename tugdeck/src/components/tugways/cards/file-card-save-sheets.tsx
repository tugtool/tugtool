/**
 * file-card-save-sheets.tsx — the pane-modal sheets a manual-mode File
 * card presents (Spec S03): close-with-unsaved-changes, external-change
 * conflict, missing-file, revert, reload, and the open-time aside
 * conflict.
 *
 * `useFileSaveSheets(showSheet)` returns one presenter per sheet, each
 * resolving to the user's decision. The two-button sheets ride
 * `presentAlertSheet`; the three/four-button ones render a small
 * `FileSaveSheetView` that reuses TugAlert's `.tug-alert-*` visual so
 * every sheet looks like the rest of the app ([use-tug-components]).
 *
 * Classic button order: destructive-alternative left, Cancel, default
 * right; Return = default; Escape / ⌘. = Cancel.
 *
 * @module components/tugways/cards/file-card-save-sheets
 */

import "../tug-alert.css";
import "./file-card-save-sheets.css";

import React, { useCallback } from "react";
import { TriangleAlert } from "lucide-react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import type { TugButtonRole } from "@/components/tugways/tug-push-button";
import { useSeedKeyView } from "@/components/tugways/use-focusable";
import { presentAlertSheet } from "@/components/tugways/tug-alert-sheet";
import type { ShowSheetOptions } from "@/components/tugways/tug-sheet";

type ShowSheet = (options: ShowSheetOptions) => Promise<string | undefined>;

/** One button in a multi-choice save sheet. */
interface SheetButton {
  label: string;
  /** The string `close(result)` resolves to when this button is chosen. */
  result: string;
  role?: TugButtonRole;
  /** The default (Return) button — seeded as the live key view. */
  isDefault?: boolean;
}

/**
 * A multi-button save sheet: TugAlert icon + text, then an action row with
 * `cancel` alone on the left and the remaining choices grouped on the
 * right, default last (the classic layout the user asked for).
 */
function FileSaveSheetView({
  title,
  message,
  buttons,
  close,
}: {
  title: string;
  message: string;
  buttons: SheetButton[];
  close: (result?: string) => void;
}): React.ReactElement {
  const focusGroup = React.useId();
  const defaultIndex = buttons.findIndex((b) => b.isDefault);
  useSeedKeyView(`${focusGroup}:${defaultIndex === -1 ? 0 : defaultIndex}`);

  const cancel = buttons.find((b) => b.result === "cancel");
  const rest = buttons.filter((b) => b.result !== "cancel");
  const renderButton = (button: SheetButton) => (
    <TugPushButton
      key={button.result}
      emphasis={
        button.isDefault
          ? button.role && button.role !== "action"
            ? "filled"
            : "primary"
          : "outlined"
      }
      role={button.role ?? "action"}
      onClick={() => close(button.result)}
      data-testid={`file-save-sheet-${button.result}`}
      focusGroup={focusGroup}
      focusOrder={buttons.indexOf(button)}
    >
      {button.label}
    </TugPushButton>
  );

  return (
    <div className="tug-alert-sheet">
      <div className="tug-alert-body" data-has-message="true">
        <div className="tug-alert-icon" aria-hidden="true">
          <TriangleAlert />
        </div>
        <div className="tug-alert-text">
          <h2 className="tug-alert-title">{title}</h2>
          <p className="tug-alert-message">{message}</p>
        </div>
      </div>
      <div className="file-save-sheet-actions">
        <div>{cancel ? renderButton(cancel) : null}</div>
        <div className="file-save-sheet-actions-right">{rest.map(renderButton)}</div>
      </div>
    </div>
  );
}

/** Decision from the close-with-unsaved-changes sheet. */
export type CloseSheetChoice = "save" | "dont-save" | "cancel";
/** Decision from the external-change conflict sheet. */
export type ConflictSheetChoice = "save-anyway" | "reload" | "save-as" | "cancel";
/** Decision from the missing-file sheet. */
export type MissingSheetChoice = "save" | "save-as" | "dont-save" | "cancel";
/** Decision from the open-time aside-conflict sheet. */
export type OpenConflictChoice = "keep" | "disk";

/** The card-hosted save-sheet presenters. */
export interface FileSaveSheets {
  presentCloseSheet(fileName: string): Promise<CloseSheetChoice>;
  presentConflictSheet(fileName: string): Promise<ConflictSheetChoice>;
  presentMissingSheet(fileName: string): Promise<MissingSheetChoice>;
  presentRevertSheet(fileName: string): Promise<boolean>;
  presentReloadSheet(fileName: string): Promise<boolean>;
  presentOpenConflictSheet(fileName: string): Promise<OpenConflictChoice>;
}

export function useFileSaveSheets(showSheet: ShowSheet): FileSaveSheets {
  const presentCloseSheet = useCallback(
    (fileName: string): Promise<CloseSheetChoice> =>
      showSheet({
        title: "Unsaved Changes",
        displayWidth: "sm",
        hideHeader: true,
        content: (close) => (
          <FileSaveSheetView
            title={`Do you want to save the changes made to the document “${fileName}”?`}
            message="Your changes will be lost if you don’t save them."
            buttons={[
              { label: "Don’t Save", result: "dont-save", role: "danger" },
              { label: "Cancel", result: "cancel" },
              { label: "Save", result: "save", isDefault: true },
            ]}
            close={close}
          />
        ),
      }).then((result) => (result as CloseSheetChoice) ?? "cancel"),
    [showSheet],
  );

  const presentConflictSheet = useCallback(
    (fileName: string): Promise<ConflictSheetChoice> =>
      showSheet({
        title: "Document Changed",
        displayWidth: "md",
        hideHeader: true,
        content: (close) => (
          <FileSaveSheetView
            title={`The document “${fileName}” has been changed by another application.`}
            message="Your unsaved changes and the changes on disk conflict."
            buttons={[
              { label: "Reload from Disk", result: "reload" },
              { label: "Save As…", result: "save-as" },
              { label: "Cancel", result: "cancel" },
              { label: "Save Anyway", result: "save-anyway", isDefault: true, role: "danger" },
            ]}
            close={close}
          />
        ),
      }).then((result) => (result as ConflictSheetChoice) ?? "cancel"),
    [showSheet],
  );

  const presentMissingSheet = useCallback(
    (fileName: string): Promise<MissingSheetChoice> =>
      showSheet({
        title: "File Deleted",
        displayWidth: "lg",
        hideHeader: true,
        content: (close) => (
          <FileSaveSheetView
            title={`The file for “${fileName}” has been deleted by another application.`}
            message="Save it again to recreate it, save it somewhere else, or discard your changes and close."
            buttons={[
              { label: "Don’t Save", result: "dont-save", role: "danger" },
              { label: "Save As…", result: "save-as" },
              { label: "Cancel", result: "cancel" },
              { label: "Save", result: "save", isDefault: true },
            ]}
            close={close}
          />
        ),
      }).then((result) => (result as MissingSheetChoice) ?? "cancel"),
    [showSheet],
  );

  const presentRevertSheet = useCallback(
    (fileName: string): Promise<boolean> =>
      presentAlertSheet(showSheet, {
        title: `Do you want to revert to the last saved version of “${fileName}”?`,
        message: "Your current changes will be lost.",
        confirmLabel: "Revert",
        confirmRole: "danger",
        cancelLabel: "Cancel",
        icon: null,
      }),
    [showSheet],
  );

  const presentReloadSheet = useCallback(
    (fileName: string): Promise<boolean> =>
      presentAlertSheet(showSheet, {
        title: `Do you want to reload the version of “${fileName}” on disk?`,
        message: "Your current changes will be lost.",
        confirmLabel: "Reload",
        confirmRole: "danger",
        cancelLabel: "Cancel",
        icon: null,
      }),
    [showSheet],
  );

  const presentOpenConflictSheet = useCallback(
    (fileName: string): Promise<OpenConflictChoice> =>
      // Keep My Changes is the default (confirm); Use Disk Version is the
      // alternative (cancel / Escape).
      presentAlertSheet(showSheet, {
        title: `“${fileName}” has unsaved changes from a previous session, but the file on disk has been changed since.`,
        message: "Keep your unsaved changes, or discard them for the version on disk?",
        confirmLabel: "Keep My Changes",
        confirmRole: "action",
        cancelLabel: "Use Disk Version",
        icon: null,
      }).then((keep) => (keep ? "keep" : "disk")),
    [showSheet],
  );

  return {
    presentCloseSheet,
    presentConflictSheet,
    presentMissingSheet,
    presentRevertSheet,
    presentReloadSheet,
    presentOpenConflictSheet,
  };
}
