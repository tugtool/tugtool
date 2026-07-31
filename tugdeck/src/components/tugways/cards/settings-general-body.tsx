/**
 * settings-general-body.tsx — the General settings panel.
 *
 * App-wide preferences that belong to the app itself rather than to a card
 * type. Today that is one field: the **default project directory** — where
 * Tug looks when nothing else says otherwise (Open Quickly with no bound
 * card, and the session picker's path seed when there are no recents).
 *
 * The stored value is optional: unset reads through to `<home>/tug`, shown
 * in the field as a placeholder so the user sees what they will get without
 * the resolved path being written back as if they had chosen it.
 *
 * Laws: the stored path is external state read through `useTugbankValue`
 * ([L02] via `useSyncExternalStore`); only the in-flight edit is component
 * `useState`, and it exists only between a keystroke and its commit; layout
 * lives in settings-general-body.css [L06].
 *
 * @module components/tugways/cards/settings-general-body
 */

import React, { useCallback, useEffect, useState } from "react";
import { TugBox } from "../tug-box";
import { TugLabel } from "../tug-label";
import { TugFileChooser } from "../tug-file-chooser";
import { useHostFacts } from "@/lib/host-facts-store";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import { probeDirExistence } from "@/lib/dir-existence";
import {
  DEFAULT_PROJECT_PATH_DOMAIN,
  DEFAULT_PROJECT_PATH_KEY,
  DEFAULT_PROJECT_DIR_LEAF,
  putDefaultProjectPath,
} from "@/settings-api";
import type { TaggedValue } from "@/lib/tugbank-client";
import "./settings-general-body.css";

/** Read the explicit stored path out of a tugbank entry. */
function parseStoredPath(entry: TaggedValue | undefined): string {
  if (entry && entry.kind === "string" && typeof entry.value === "string") {
    return entry.value;
  }
  return "";
}

export function SettingsGeneralBody() {
  const hostFacts = useHostFacts();
  const home = hostFacts?.home ?? null;
  const resolvedFallback =
    home === null
      ? ""
      : `${home.replace(/\/+$/, "")}/${DEFAULT_PROJECT_DIR_LEAF}`;

  const stored = useTugbankValue(
    DEFAULT_PROJECT_PATH_DOMAIN,
    DEFAULT_PROJECT_PATH_KEY,
    parseStoredPath,
    "",
  );

  // The in-flight edit, or null when the field is showing the stored value.
  // Typing forks a draft; committing (Enter, or focus leaving the field)
  // writes it and drops back to reading the store.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? stored;

  // Whether the currently shown path exists on disk. `null` while unknown —
  // the note only appears once the probe answers "no".
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const probe = value !== "" ? value : resolvedFallback;
    if (probe === "") {
      setMissing(false);
      return;
    }
    let cancelled = false;
    void probeDirExistence([probe]).then((result) => {
      if (!cancelled) setMissing(result[probe] === false);
    });
    return () => {
      cancelled = true;
    };
  }, [value, resolvedFallback]);

  const commit = useCallback(() => {
    if (draft === null) return;
    const trimmed = draft.trim();
    setDraft(null);
    if (trimmed === stored) return;
    putDefaultProjectPath(trimmed);
  }, [draft, stored]);

  // Commit when focus leaves the whole field (input or Browse… button) for
  // something outside it — a click elsewhere in the panel must not silently
  // discard what was typed.
  const handleBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      commit();
    },
    [commit],
  );

  return (
    <div className="settings-general" data-testid="settings-general">
      <TugBox
        label="Default Project Directory"
        labelPosition="legend"
        variant="bordered"
        className="settings-general-group"
      >
        <div
          className="settings-general-field"
          onBlur={handleBlur}
          data-testid="settings-default-project-dir-field"
        >
          <TugFileChooser
            value={value}
            onChange={setDraft}
            base={value !== "" ? value : home ?? "/"}
            kind="directory"
            onSubmit={commit}
            placeholder={resolvedFallback}
            aria-label="Default project directory"
          />
        </div>
        <TugLabel size="sm" emphasis="calm" className="settings-general-hint">
          {missing
            ? "This folder doesn't exist yet — it will be created the first time Tug needs it."
            : "Where Tug looks when no session card says otherwise: Open Quickly with nothing open, and the new-session path when there are no recent projects."}
        </TugLabel>
      </TugBox>
    </div>
  );
}
