/**
 * useDevCardObserver — bridges per-card session events to the
 * picker-notice store.
 *
 * Single responsibility: when `lastError.cause === "resume_failed"`,
 * stash a one-shot notice keyed by this card and clear the binding.
 * The cleared binding makes `useDevCardServices` return null →
 * `DevCardContent` re-renders the picker, which reads the notice
 * and surfaces it above the radio group. We deliberately do NOT
 * call `sendCloseSession` here: the bridge has already torn down
 * on the supervisor side, so a close would leak a duplicate frame.
 *
 * Per-error dedup uses the `lastError.at` timestamp so each unique
 * failure triggers exactly one unbind.
 */

import { useLayoutEffect, useRef } from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import { pickerNoticeStore } from "@/lib/picker-notice-store";
import { logSessionLifecycle } from "@/lib/session-lifecycle-log";

export function useDevCardObserver(
  cardId: string,
  codeSessionStore: CodeSessionStore,
): void {
  const consumedLastErrorAtRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    return codeSessionStore.subscribe(() => {
      const snap = codeSessionStore.getSnapshot();
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
      // Carry the stale `(tugSessionId, projectDir)` so the picker's
      // Retry button can re-fire `spawn_session(mode=resume)` against
      // the same session. Read before clearing — `clearBinding` wipes
      // the entry we're about to reference.
      const binding = cardSessionBindingStore.getBinding(cardId);
      pickerNoticeStore.set(cardId, {
        category: "resume_failed",
        message: err.message,
        staleTugSessionId: binding?.tugSessionId,
        staleProjectDir: binding?.projectDir,
      });
      cardSessionBindingStore.clearBinding(cardId);
    });
  }, [cardId, codeSessionStore]);
}
