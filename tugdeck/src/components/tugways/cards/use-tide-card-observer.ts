/**
 * useTideCardObserver — bridges per-card session events to the
 * card-binding and picker-notice stores.
 *
 * Two reactions, both keyed off the bound `CodeSessionStore`:
 *
 * 1. **claudeSessionId propagation.** When the store first observes
 *    `session_init` and snapshot.claudeSessionId becomes non-null,
 *    propagate that id into the card's binding so any future ledger
 *    consumer can read the canonical session id from the binding
 *    instead of reaching into the store.
 *
 * 2. **resume_failed unbind.** When `lastError.cause === "resume_failed"`,
 *    stash a one-shot notice keyed by this card and clear the binding.
 *    The cleared binding makes `useTideCardServices` return null →
 *    `TideCardContent` re-renders the picker, which reads the notice
 *    and surfaces it above the radio group. We deliberately do NOT
 *    call `sendCloseSession` here: the bridge has already torn down
 *    on the supervisor side, so a close would leak a duplicate frame.
 *
 * Both reactions share one subscribe so each notification triggers one
 * snapshot read. Per-error dedup uses the `at` timestamp; per-id dedup
 * uses the captured `boundClaudeSessionId` ref.
 */

import { useLayoutEffect, useRef } from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import { pickerNoticeStore } from "@/lib/picker-notice-store";
import { logSessionLifecycle } from "@/lib/session-lifecycle-log";

export function useTideCardObserver(
  cardId: string,
  codeSessionStore: CodeSessionStore,
): void {
  const consumedLastErrorAtRef = useRef<number | null>(null);
  const boundClaudeSessionIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    return codeSessionStore.subscribe(() => {
      const snap = codeSessionStore.getSnapshot();
      const claudeId = snap.claudeSessionId;
      if (claudeId !== null && boundClaudeSessionIdRef.current !== claudeId) {
        boundClaudeSessionIdRef.current = claudeId;
        cardSessionBindingStore.bindClaudeSessionId(cardId, claudeId);
      }
      const err = snap.lastError;
      if (
        err === null ||
        err.cause !== "resume_failed" ||
        consumedLastErrorAtRef.current === err.at
      ) {
        return;
      }
      consumedLastErrorAtRef.current = err.at;
      logSessionLifecycle("card.unbind_on_resume_failed", {
        card_id: cardId,
        message: err.message,
      });
      pickerNoticeStore.set(cardId, {
        category: "resume_failed",
        message: err.message,
      });
      cardSessionBindingStore.clearBinding(cardId);
    });
  }, [cardId, codeSessionStore]);
}
