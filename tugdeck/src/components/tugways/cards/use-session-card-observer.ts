/**
 * useSessionCardObserver — bridges per-card session events to the
 * picker-notice store and the app-level auth gate.
 *
 * Two causes route through here, each unbinding the card so the Dev
 * picker re-presents (rather than silently rebranding the session under
 * a fresh claude id) with a one-shot notice:
 *
 *   - `resume_failed` — stash a `resume_failed` notice and clear the
 *     binding. We deliberately do NOT call `sendCloseSession`: the
 *     bridge has already torn down on the supervisor side, so a close
 *     would leak a duplicate frame.
 *   - the per-session auth gate (`session_state_errored` whose message
 *     is `auth_required` / `claude_missing`) — the gate is authoritative
 *     for app auth, so we re-probe (`check_auth`) to let the app-modal
 *     TugSetup open as the single login surface, AND unbind with a
 *     `signed_out` notice so the card re-presents its picker rather than
 *     sitting on a dead, logged-out session.
 *
 * The cleared binding makes `useSessionCardServices` return null →
 * `SessionCardContent` re-renders the picker, which reads the notice and
 * surfaces it above the radio group.
 *
 * Per-error dedup uses the `lastError.at` timestamp so each unique
 * failure triggers exactly one unbind. The two causes are mutually
 * exclusive for a given `at`, so one guard covers both.
 *
 * The `check_auth` send is an imperative transition off a store change
 * ([L24]) — `authStore` remains the single writer of app login state via
 * the answering `claude_auth_result` ([L02]).
 */

import { useLayoutEffect, useRef } from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import { pickerNoticeStore } from "@/lib/picker-notice-store";
import { getConnection } from "@/lib/connection-singleton";
import { logSessionLifecycle } from "@/lib/session-lifecycle-log";
import { classifyCardError } from "./session-card-error-routing";

export function useSessionCardObserver(
  cardId: string,
  codeSessionStore: CodeSessionStore,
): void {
  const consumedLastErrorAtRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    return codeSessionStore.subscribe(() => {
      const snap = codeSessionStore.getSnapshot();
      const err = snap.lastError;
      if (err === null || consumedLastErrorAtRef.current === err.at) {
        return;
      }
      const route = classifyCardError(err);
      if (route === null) {
        return;
      }
      consumedLastErrorAtRef.current = err.at;
      // Carry the stale `(tugSessionId, projectDir)` so the picker's
      // Retry button can re-fire `spawn_session(mode=resume)` against
      // the same session. Read before clearing — `clearBinding` wipes
      // the entry we're about to reference.
      const binding = cardSessionBindingStore.getBinding(cardId);

      if (route === "auth_gate") {
        logSessionLifecycle("card.unbind_on_signed_out", {
          card_id: cardId,
          message: err.message,
        });
        // Authoritative signal: re-probe so `authStore` flips logged-out
        // and TugSetup takes the deck as the single login surface.
        getConnection()?.sendControlFrame("check_auth");
        pickerNoticeStore.set(cardId, {
          category: "signed_out",
          message: err.message,
          staleTugSessionId: binding?.tugSessionId,
          staleProjectDir: binding?.projectDir,
        });
        cardSessionBindingStore.clearBinding(cardId);
        return;
      }

      logSessionLifecycle("card.unbind_on_resume_failed", {
        card_id: cardId,
        message: err.message,
      });
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
