/**
 * useMenuStatePublication — publishes the session card's session state to
 * the host menu-state aggregator (`lib/host-menu-state.ts`), which
 * forwards it to the Swift host for menu validation (Stop enablement,
 * the permission-mode checkmark, rewind/copy gates).
 *
 * Publication is a side effect, not render-driving, so the effect
 * subscribes to the stores directly ([L22]) instead of re-publishing
 * render-bound hook values: store emissions far outnumber renders
 * (every streaming token), and conversely a publication must fire even
 * when no rendered value changed. The card publishes unconditionally;
 * the aggregator decides whether the block rides the wire payload by
 * checking which card is the focused pane's active card.
 *
 * The transcript-derived facts are cached against the snapshot's
 * `Object.is`-stable transcript reference, so per-token emissions
 * recompute nothing — they re-read two booleans and the publisher's
 * diff suppresses the unchanged payload.
 */

import { useEffect } from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";
import type { TurnEntry } from "@/lib/code-session-store/types";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import type { ShadeViewController } from "@/lib/shade-view-controller";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import { clearSessionMenuState, publishSessionMenuState } from "@/lib/host-menu-state";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import {
  PERMISSION_MODE_DOMAIN,
  parsePersistedPermissionMode,
  resolvePermissionMode,
} from "@/lib/permission-mode";

/** The transcript facts the menu cares about, derived per reference. */
function deriveTranscriptFacts(transcript: ReadonlyArray<TurnEntry>): {
  hasAssistantMessage: boolean;
  hasTurns: boolean;
} {
  return {
    hasAssistantMessage: transcript.some((t) =>
      t.messages.some((m) => m.kind === "assistant_text"),
    ),
    hasTurns: transcript.length > 0,
  };
}

export function useMenuStatePublication(
  cardId: string,
  codeSessionStore: CodeSessionStore,
  sessionMetadataStore: SessionMetadataStore,
  shadeViewController: ShadeViewController,
): void {
  useEffect(() => {
    let cachedTranscript: ReadonlyArray<TurnEntry> | null = null;
    let cachedFacts = { hasAssistantMessage: false, hasTurns: false };

    const publish = (): void => {
      const snap = codeSessionStore.getSnapshot();
      if (snap.transcript !== cachedTranscript) {
        cachedTranscript = snap.transcript;
        cachedFacts = deriveTranscriptFacts(snap.transcript);
      }
      // Same fallback chain as the permission-mode chip, so the menu
      // checkmark can never disagree with the chip.
      const persisted = parsePersistedPermissionMode(
        getTugbankClient()?.get(PERMISSION_MODE_DOMAIN, cardId),
      );
      const shadeView = shadeViewController.getSnapshot();
      publishSessionMenuState(cardId, {
        cardId,
        sessionBound: cardSessionBindingStore.getBinding(cardId) !== undefined,
        canInterrupt: snap.canInterrupt,
        canChangeSettings: snap.canSubmit,
        permissionMode: resolvePermissionMode(
          sessionMetadataStore.getSnapshot().permissionMode,
          persisted,
        ),
        changesVisible: shadeView === "changes",
        historyVisible: shadeView === "history",
        ...cachedFacts,
      });
    };

    const unsubscribes = [
      codeSessionStore.subscribe(publish),
      sessionMetadataStore.subscribe(publish),
      cardSessionBindingStore.subscribe(publish),
      shadeViewController.subscribe(publish),
    ];
    publish();

    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
      clearSessionMenuState(cardId);
    };
  }, [cardId, codeSessionStore, sessionMetadataStore, shadeViewController]);
}
