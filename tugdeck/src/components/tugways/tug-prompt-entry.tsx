/**
 * TugPromptEntry — Compound composition: TugPromptInput + route indicator +
 * submit/stop button, driven by a CodeSessionStore snapshot.
 *
 * Composes TugPromptInput (editor + route detection), TugChoiceGroup (route
 * indicator), TugPushButton (submit/stop). Each composed child keeps its own
 * tokens [L20]. The entry reuses existing base-tier global/field/badge tokens
 * per [D11].
 *
 * Step 2 landed the scaffold (mount, store snapshot, responder scope, JSX
 * per Spec S03, no-op SUBMIT stub that keeps TugPushButton's chain-action
 * mode out of its aria-disabled fallback — Risk R04). Step 3 filled in the
 * input-delegate pass-throughs (`focus`, `clear`) and wired
 * `handleInputChange` to write `data-empty` directly to the root element
 * via `setAttribute`, bypassing React state on keystroke [L06][L22].
 * Step 4 wires the bidirectional route-indicator sync [D04]: typing a
 * prefix in the input fires `onRouteChange` → `setRouteState`;
 * selecting a segment dispatches SELECT_VALUE → `setRouteState` +
 * `setRoute` (which in turn fires `onRouteChange`, but React bails on
 * the equal setRouteState).
 * Step 5 fills in the SUBMIT handler per [D05]: branches on
 * `snapRef.current.canInterrupt` to route to `codeSessionStore.interrupt()`
 * vs `codeSessionStore.send(text, atoms)`, threading `localCommandHandler`
 * as an optional [D06] synchronous interceptor; clears the input and
 * resets the route indicator after submit.
 *
 * Laws: [L02] useSyncExternalStore for store state, [L06] appearance via
 *       CSS/DOM, [L07] handlers read state via refs, [L11] controls emit
 *       actions, [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide, [L20] token sovereignty,
 *       [L22] direct DOM writes for high-frequency updates.
 * Decisions: [D-T3-01] route selection, [D-T3-06] submit is interrupt,
 *            [D-T3-07] queue during turn, [D-T3-09] 1:1 card↔store.
 */

import "./tug-prompt-entry.css";

import React, {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";

import { ArrowUp, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AtomSegment, CompletionProvider, DropHandler } from "@/lib/tug-text-engine";
import type { CodeSessionStore } from "@/lib/code-session-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import type { PromptHistoryStore } from "@/lib/prompt-history-store";

import { TugPromptInput, type TugPromptInputDelegate } from "./tug-prompt-input";
import { TugChoiceGroup, type TugChoiceItem } from "./tug-choice-group";
import { TugPushButton } from "./tug-push-button";
import { useResponder } from "./use-responder";
import type { ActionEvent } from "./responder-chain";
import { TUG_ACTIONS } from "./action-vocabulary";

// ---------------------------------------------------------------------------
// Module constants
// ---------------------------------------------------------------------------

/**
 * The three route prefix characters surfaced in the indicator. Matches the
 * `routePrefixes` array passed to the underlying `TugPromptInput`. Declared
 * once at module scope so both the indicator `items` and the input prop
 * reference a single source of truth.
 */
const ROUTE_ITEMS: ReadonlyArray<TugChoiceItem> = [
  { value: ">", label: ">" },
  { value: "$", label: "$" },
  { value: ":", label: ":" },
];

const ROUTE_PREFIXES: ReadonlyArray<string> = [">", "$", ":"];

// ---------------------------------------------------------------------------
// Props / delegate
// ---------------------------------------------------------------------------

/**
 * TugPromptEntry props interface.
 *
 * Data attributes written on the root element (all documented below with
 * `@selector` annotations):
 *
 * @selector [data-slot="tug-prompt-entry"]         — stable slot selector
 * @selector [data-responder-id]                    — from `id` (written by useResponder)
 * @selector [data-phase="idle" | "submitting" | "awaiting_first_token" |
 *                         "streaming" | "tool_work" | "awaiting_approval" |
 *                         "errored"]                — from snap.phase (React-rendered)
 * @selector [data-can-interrupt="true" | "false"]  — from snap.canInterrupt (React-rendered)
 * @selector [data-can-submit="true" | "false"]     — from snap.canSubmit (React-rendered)
 * @selector [data-queued]                          — presence when snap.queuedSends > 0
 * @selector [data-errored]                         — presence when snap.lastError !== null
 * @selector [data-pending-approval]                — presence when snap.pendingApproval !== null
 * @selector [data-pending-question]                — presence when snap.pendingQuestion !== null
 * @selector [data-empty="true" | "false"]          — direct DOM write from input's onChange (Step 3)
 */
export interface TugPromptEntryProps {
  /**
   * Stable responder id. Typically `${cardId}-entry`.
   * @selector [data-responder-id]
   */
  id: string;
  /** Store owning Claude Code turn state for this card. */
  codeSessionStore: CodeSessionStore;
  /** Session metadata (model name, version). Accepted for T3.4.c; unused in T3.4.b. */
  sessionMetadataStore: SessionMetadataStore;
  /** Prompt history (recall on arrow up/down). Forwarded to TugPromptInput. */
  historyStore: PromptHistoryStore;
  /** File completion for `@` trigger. Forwarded to TugPromptInput. */
  fileCompletionProvider: CompletionProvider;
  /** Drop handler for dragging files from Finder. Forwarded to TugPromptInput. */
  dropHandler?: DropHandler;
  /**
   * Optional synchronous interceptor for local `:`-surface commands. Called
   * before `codeSessionStore.send(...)` on every submission. Returning `true`
   * suppresses the store send; returning `false` or omitting the prop falls
   * through. The input is cleared on either path. [D06]
   */
  localCommandHandler?: (
    route: string | null,
    atoms: ReadonlyArray<AtomSegment>,
  ) => boolean;
  /**
   * Caller-supplied className merged with the root.
   * @selector standard
   */
  className?: string;
}

/**
 * Imperative handle exposed via `forwardRef`. Used by the Tide card (T3.4.c)
 * to drive focus from global keyboard shortcuts.
 *
 * Both methods are thin pass-throughs to the composed `TugPromptInput`'s
 * delegate. The entry does not own text state — keeping the pass-through
 * semantics honest avoids divergence between the entry's imperative
 * surface and the input's actual behavior.
 */
export interface TugPromptEntryDelegate {
  /** Move keyboard focus to the underlying input's editor element. */
  focus(): void;
  /** Clear the input's content. */
  clear(): void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TugPromptEntry = React.forwardRef<
  TugPromptEntryDelegate,
  TugPromptEntryProps
>(function TugPromptEntry(props, ref) {
  const {
    id,
    codeSessionStore,
    // sessionMetadataStore — accepted for T3.4.c, unused in T3.4.b.
    historyStore: _historyStore,
    fileCompletionProvider: _fileCompletionProvider,
    dropHandler: _dropHandler,
    localCommandHandler,
    className,
  } = props;

  // [L02] external store state enters React through useSyncExternalStore only.
  const snap = useSyncExternalStore(
    codeSessionStore.subscribe,
    codeSessionStore.getSnapshot,
  );

  // Refs for the composed input, the root element (direct DOM writes per
  // [L06] — Step 3 writes `data-empty` here), and a live snapshot mirror
  // for responder handlers [L07].
  const promptInputRef = useRef<TugPromptInputDelegate | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const snapRef = useRef(snap);
  useLayoutEffect(() => {
    snapRef.current = snap;
  }, [snap]);

  // Stable sender id for the route indicator. Derived from `id` so parent
  // cards can predict it for integration tests and multi-entry forms if
  // they ever land. Step 4 uses this in the SELECT_VALUE handler body to
  // narrow on `event.sender`.
  const routeIndicatorSenderId = `${id}-route-indicator`;

  // [D04] the route value is React state — TugChoiceGroup is a controlled
  // component that derives its pill position from `value`. L06 explicitly
  // allows React state for "selected item in a list" — the route is data
  // (user-readable semantics), not appearance.
  const [route, setRouteState] = React.useState<string>("");

  // Live route ref so the submit handler in Step 5 can read the current
  // value without closing over a stale `route` closure variable [L07].
  const routeRef = useRef(route);
  useLayoutEffect(() => {
    routeRef.current = route;
  }, [route]);

  // [L07] Register the responder node. Both handler bodies are now
  // real: SELECT_VALUE runs the defensive sender/value narrowing +
  // `setRouteState` + `setRoute` round-trip per Spec S02 (Step 4);
  // SUBMIT branches on `snapRef.current.canInterrupt` to route to
  // `interrupt()` vs `send()` per [D05] (Step 5).
  const { ResponderScope, responderRef } = useResponder({
    id,
    actions: {
      [TUG_ACTIONS.SELECT_VALUE]: (event: ActionEvent) => {
        // Narrow on sender first — this responder should only react
        // to events from its own route indicator [L11]. Other senders
        // (different card's indicator, a gallery harness, etc.) must
        // be ignored so state doesn't cross-contaminate.
        if (event.sender !== routeIndicatorSenderId) return;
        // Defensive value-shape narrowing [L11]. ActionEvent.value is
        // `unknown`; a test or future caller could dispatch a number
        // or object. Drop anything that isn't the string the
        // indicator normally sends.
        if (typeof event.value !== "string") return;
        // Update the controlled indicator's `value` prop source of
        // truth. [D04]
        setRouteState(event.value);
        // Sync the input's leading atom to match. setRoute fires the
        // engine's route-detection path, which calls onRouteChange
        // with the same char, which calls `handleRouteChange` below,
        // which calls `setRouteState(event.value)` a second time.
        // React bails on the second call via Object.is equality, so
        // the dispatch produces exactly one commit. See the round-
        // trip test for the guard.
        promptInputRef.current?.setRoute(event.value);
      },
      [TUG_ACTIONS.SUBMIT]: (_event: ActionEvent) => {
        const input = promptInputRef.current;
        const snap = snapRef.current;
        if (!input) return;
        // [D05] Submit is interrupt: the single SUBMIT action routes
        // to `interrupt()` during an in-flight turn and to `send()`
        // otherwise. `canInterrupt` is the authoritative signal —
        // read via `snapRef` per [L07] so we see the live value even
        // if React hasn't committed yet.
        if (snap.canInterrupt) {
          codeSessionStore.interrupt();
          return;
        }
        // [D-T3-08] awaiting_approval / awaiting_question block the
        // submit path. `canSubmit` captures both (plus any future
        // phase that should disable submit). Defensive guard: the
        // button is already disabled in this state, but the action
        // could still arrive from a keyboard shortcut.
        if (!snap.canSubmit) return;
        const atoms = input.getAtoms();
        const text = input.getText();
        // [D06] localCommandHandler seam — called BEFORE the store
        // send so local `:`-surface commands can intercept. Route
        // is the live route ref (string) or null if no prefix is
        // active. Returning `true` suppresses the store send but
        // does NOT suppress the input clear or route reset: the
        // user still sees the entry reset, as if the submit had
        // gone through.
        const route = routeRef.current || null;
        const handled = localCommandHandler?.(route, atoms) ?? false;
        if (!handled) {
          codeSessionStore.send(text, atoms);
        }
        input.clear();
        setRouteState("");
      },
    },
  });

  // Input → indicator callback. The engine fires onRouteChange with
  // the detected prefix char (or null when the leading route atom is
  // removed). Mirror that into the controlled indicator's value state;
  // `null` maps to an empty string so TugChoiceGroup clears its pill.
  // [D04] routes its state through React rather than a direct DOM
  // write because the pill is positioned by TugChoiceGroup's own
  // useLayoutEffect keyed on `value`.
  const handleRouteChange = useCallback((r: string | null) => {
    setRouteState(r ?? "");
  }, []);

  // Input onChange callback. Writes `data-empty` to the root element
  // directly via `rootRef` — no React state update, no re-render of the
  // entry on every keystroke [L06][L22]. Reads freshness from
  // `promptInputRef.current?.isEmpty()`; refs are always current, so the
  // empty-deps `useCallback` is safe.
  const handleInputChange = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const isEmpty = promptInputRef.current?.isEmpty() ?? true;
    root.setAttribute("data-empty", String(isEmpty));
  }, []);

  // Expose the imperative delegate. Pass-throughs to the underlying input
  // delegate — the entry does not own text state.
  useImperativeHandle(
    ref,
    () => ({
      focus() {
        promptInputRef.current?.focus();
      },
      clear() {
        promptInputRef.current?.clear();
      },
    }),
    [],
  );

  // Compose rootRef + responderRef onto the same DOM element. useResponder's
  // `responderRef` writes `data-responder-id` there; `rootRef` is the
  // direct-DOM handle Step 3 writes `data-empty` to.
  const composedRootRef = useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el;
      responderRef(el);
    },
    [responderRef],
  );

  return (
    <ResponderScope>
      <div
        ref={composedRootRef}
        data-slot="tug-prompt-entry"
        data-phase={snap.phase}
        data-can-interrupt={String(snap.canInterrupt)}
        data-can-submit={String(snap.canSubmit)}
        data-errored={snap.lastError ? "" : undefined}
        data-pending-approval={snap.pendingApproval ? "" : undefined}
        data-pending-question={snap.pendingQuestion ? "" : undefined}
        data-queued={snap.queuedSends > 0 ? "" : undefined}
        data-empty="true"
        className={cn("tug-prompt-entry", className)}
      >
        <TugPromptInput
          ref={promptInputRef}
          borderless
          routePrefixes={[...ROUTE_PREFIXES]}
          onRouteChange={handleRouteChange}
          onChange={handleInputChange}
        />
        <div className="tug-prompt-entry-toolbar">
          <TugChoiceGroup
            items={[...ROUTE_ITEMS]}
            value={route}
            senderId={routeIndicatorSenderId}
            size="sm"
            aria-label="Command route"
          />
          {snap.queuedSends > 0 && (
            <span
              className="tug-prompt-entry-queue-badge"
              aria-live="polite"
            >
              {snap.queuedSends}
            </span>
          )}
          <TugPushButton
            action={TUG_ACTIONS.SUBMIT}
            subtype="icon"
            size="sm"
            emphasis="filled"
            role={snap.canInterrupt ? "danger" : "action"}
            disabled={!snap.canSubmit && !snap.canInterrupt}
            aria-label={snap.canInterrupt ? "Stop turn" : "Send prompt"}
            icon={
              snap.canInterrupt
                ? <Square size={14} strokeWidth={3} />
                : <ArrowUp size={16} strokeWidth={2.5} />
            }
          />
        </div>
      </div>
    </ResponderScope>
  );
});
