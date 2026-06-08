/**
 * rename-session-sheet.tsx — the `/rename` session-name surface ([#step-13d]).
 *
 * `/rename <text>` (arg-bearing per [D23]) sets the bound session's name
 * directly; bare `/rename` opens a one-field dialog seeded with the current
 * name. Both funnel through {@link commitRename}: optimistically update the Z4B
 * chip via {@link sessionNameStore}, then send the `rename_session` CONTROL
 * frame — tugcast writes the ledger and broadcasts `session_updated`, which
 * makes the name authoritative for the chip + the session chooser.
 *
 * Compositional — the bare dialog composes the card's shared `TugSheet` (via
 * `showSheet`), `TugInput`, and `TugPushButton`; composed children keep their
 * own tokens ([L20]). No-op when the card has no bound session.
 *
 * Laws: [L02] binding read via the store, [L07] resolve the binding fresh at
 *       invoke time, [L20] composed children keep tokens.
 * Decisions: [D15] pane sheets are overlays, [D23] local slash-command dispatch.
 *
 * @module components/tugways/cards/rename-session-sheet
 */

import React, { useCallback, useState } from "react";

import { TugInput } from "@/components/tugways/tug-input";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useSeedKeyView } from "@/components/tugways/use-focusable";
import type { ShowSheetOptions } from "@/components/tugways/tug-sheet";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import { getConnection } from "@/lib/connection-singleton";
import { encodeRenameSession } from "@/protocol";
import { sessionNameStore } from "@/lib/session-name-store";

export interface UseRenameSessionSheetArgs {
  /** Card whose bound session is renamed. */
  cardId: string;
  /** The card's shared sheet host (`useTugSheet().showSheet`). */
  showSheet: (options: ShowSheetOptions) => Promise<string | undefined>;
}

export interface RenameSessionSheetController {
  /** `/rename <text>` — set the name directly (no dialog). */
  renameTo: (name: string) => void;
  /** bare `/rename` — open the one-field dialog seeded with the current name. */
  openRenameSheet: () => void;
}

export function useRenameSessionSheet({
  cardId,
  showSheet,
}: UseRenameSessionSheetArgs): RenameSessionSheetController {
  // Optimistic chip update + the `rename_session` frame. Read the binding fresh
  // ([L07]); a no-op when the card isn't bound. A blank name clears the name.
  const commitRename = useCallback(
    (name: string) => {
      const binding = cardSessionBindingStore.getBinding(cardId);
      const connection = getConnection();
      if (binding === undefined || connection === null) return;
      const trimmed = name.trim();
      sessionNameStore.setName(binding.tugSessionId, trimmed);
      const frame = encodeRenameSession(binding.tugSessionId, trimmed);
      connection.send(frame.feedId, frame.payload);
    },
    [cardId],
  );

  const renameTo = useCallback(
    (name: string) => commitRename(name),
    [commitRename],
  );

  const openRenameSheet = useCallback(() => {
    const binding = cardSessionBindingStore.getBinding(cardId);
    if (binding === undefined) return;
    const current = sessionNameStore.getName(binding.tugSessionId) ?? "";
    void showSheet({
      title: "Rename session",
      content: (close) => (
        <RenameSheetBody
          initialName={current}
          onSubmit={(name) => {
            commitRename(name);
            close("rename");
          }}
          onCancel={() => close()}
        />
      ),
    });
  }, [cardId, showSheet, commitRename]);

  return { renameTo, openRenameSheet };
}

interface RenameSheetBodyProps {
  initialName: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

function RenameSheetBody({
  initialName,
  onSubmit,
  onCancel,
}: RenameSheetBodyProps): React.ReactElement {
  const [value, setValue] = useState(initialName);
  // Author the field + action buttons into the sheet's trapped focus mode: Tab
  // walks name field → Cancel → Save. This is a text-first sheet ([P14]/[#step-6]),
  // so the engine seeds the key view onto the FIELD (caret on open). The field
  // delegates Return to the surface default (Save), so the sheet is marked a
  // `data-return-default-scope`: while the field holds the key view, Save also
  // wears a ring ("Return's home"). Tab onto a button and that button owns the
  // ring (and its own Return) — the field-scope ring comes off Save.
  const focusGroup = React.useId();
  const FIELD_ORDER = 0;
  const CANCEL_ORDER = 1;
  const SAVE_ORDER = 2;
  useSeedKeyView(`${focusGroup}:${FIELD_ORDER}`);
  return (
    <div className="rename-session-sheet" data-return-default-scope>
      <TugInput
        value={value}
        placeholder="Session name (blank to clear)"
        aria-label="Session name"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Return in the FIELD commits (the field delegates Return to the
          // default). A focused button handles its own Return natively, so the
          // commit lives on the field, not the whole sheet — Tab to Cancel +
          // Return cancels, never saves. Escape / Cmd-. → TugSheet dismiss.
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit(value);
          }
        }}
        data-testid="rename-session-input"
        focusGroup={focusGroup}
        focusOrder={FIELD_ORDER}
      />
      <div className="tug-sheet-actions">
        <TugPushButton
          emphasis="outlined"
          role="action"
          onClick={() => onCancel()}
          data-testid="rename-cancel"
          focusGroup={focusGroup}
          focusOrder={CANCEL_ORDER}
        >
          Cancel
        </TugPushButton>
        <TugPushButton
          emphasis="primary"
          onClick={() => onSubmit(value)}
          data-testid="rename-save"
          focusGroup={focusGroup}
          focusOrder={SAVE_ORDER}
        >
          Save
        </TugPushButton>
      </div>
    </div>
  );
}
