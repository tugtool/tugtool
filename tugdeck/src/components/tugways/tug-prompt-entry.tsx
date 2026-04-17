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

import { ArrowUp, Settings, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AtomSegment, CompletionProvider, DropHandler } from "@/lib/tug-text-engine";
import type { CodeSessionStore } from "@/lib/code-session-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import type { PromptHistoryStore } from "@/lib/prompt-history-store";

import { TugPromptInput, type TugPromptInputDelegate } from "./tug-prompt-input";
import { TugChoiceGroup, type TugChoiceItem } from "./tug-choice-group";
import { TugPushButton } from "./tug-push-button";
import { TugPopover, TugPopoverContent, TugPopoverTrigger } from "./tug-popover";
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
 * reference a single source of truth. Each segment pairs a descriptive
 * label (what the route does) with the prefix character rendered as a
 * leading icon so the control is both scannable and self-documenting.
 */
const ROUTE_ITEMS: ReadonlyArray<TugChoiceItem> = [
  { value: ">", label: "Prompt", icon: <span aria-hidden="true">&gt;</span> },
  { value: "$", label: "Shell", icon: <span aria-hidden="true">$</span> },
  { value: ":", label: "Command", icon: <span aria-hidden="true">:</span> },
];

const ROUTE_PREFIXES: ReadonlyArray<string> = [">", "$", ":"];

/**
 * Return-key semantics per route.
 *
 * - `>` (Prompt): Return inserts a newline; Shift+Return submits. Prompts
 *   are long-form, so naïve Return should stay a newline and submit is
 *   a deliberate gesture.
 * - `$` (Shell): Return submits; Shift+Return inserts a newline. Shell
 *   invocations are typically a single line, so Return submits directly.
 * - `:` (Command): Return submits; Shift+Return inserts a newline.
 *   Commands are one-liners in practice.
 *
 * The engine's shift inversion (`shift ? (base === "submit" ? "newline"
 * : "submit") : base`) means we only need to declare the *unshifted*
 * action per route; Shift+Return is the opposite automatically.
 */
const RETURN_ACTION_BY_ROUTE: Readonly<Record<string, "submit" | "newline">> = {
  ">": "newline",
  "$": "submit",
  ":": "submit",
};

/**
 * Default route when the input has no typed prefix. One of the three
 * segments must always be active — there is no "no route" state in the
 * indicator. Prompt (`>`) is the sensible default: it's what the user
 * most often wants (talking to Claude). If the user types `$` or `:`
 * the indicator syncs to match; if they backspace the prefix away, the
 * indicator returns to `DEFAULT_ROUTE`.
 */
const DEFAULT_ROUTE = ">";

// ---------------------------------------------------------------------------
// Effective-empty helper
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the input has no meaningful user content — either
 * literally empty, or carrying only a lone route atom (the prefix char
 * with nothing past it). A route atom on its own is structural, not
 * meaningful input: the user has typed a prefix but nothing to send, so
 * submit should stay disabled and `data-empty` should read `"true"`.
 *
 * Any additional atom (e.g. a file atom) or any non-whitespace text past
 * the prefix counts as content.
 */
function isEffectivelyEmpty(input: TugPromptInputDelegate | null): boolean {
  if (!input || input.isEmpty()) return true;
  const atoms = input.getAtoms();
  if (atoms.length === 1 && atoms[0].type === "route") {
    const text = input.getText();
    return text.slice(1).trim().length === 0;
  }
  return false;
}

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
  /**
   * Completion providers keyed by trigger character, forwarded to the
   * underlying `TugPromptInput`. Example: `{ "@": fileProvider, "/": commandProvider }`.
   * Mirrors `TugPromptInput`'s own `completionProviders` prop — the entry
   * is a pass-through. Leave undefined to disable all trigger completions.
   */
  completionProviders?: Record<string, CompletionProvider>;
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
   * Fires synchronously just before the input is cleared on a successful
   * submit (after `canSubmit` / `canInterrupt` / `localCommandHandler`
   * checks, after `codeSessionStore.send`, before `input.clear()`).
   *
   * Distinguishes a genuine user submit from incidental empty states
   * (manual delete, undo-to-empty). Hosts use this hook to drive
   * effects that should happen ONLY on explicit submits — e.g.,
   * animating a content-sized panel back to the user's dragged size
   * via `TugSplitPanelHandle.restoreUserSize({ animated: true })`.
   *
   * Does not fire on the `canInterrupt` branch (no submit happens),
   * nor on blocked submits, nor on the user clearing the input by
   * other means.
   */
  onBeforeSubmit?: () => void;
  /**
   * Optional content rendered in the status row above the input — e.g. the
   * current project path, session model name, or a live status indicator.
   * The row also hosts the tools-toggle button on the trailing edge when
   * `toolsContent` is provided. If both `statusContent` and `toolsContent`
   * are undefined, the status row is omitted entirely.
   */
  statusContent?: React.ReactNode;
  /**
   * Optional content rendered inside a `TugPopover` anchored to a
   * toggle button on the trailing edge of the status row. The popover's
   * internal open state is owned by `TugPopover`. When undefined, the
   * toggle button is not rendered.
   */
  toolsContent?: React.ReactNode;
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
  /**
   * The underlying editor element (the contentEditable div inside the
   * composed `TugPromptInput`). Used by `useContentDrivenPanelSize` as
   * the scroll-source signal for content-driven panel growth.
   */
  getEditorElement(): HTMLElement | null;
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
    completionProviders,
    dropHandler,
    localCommandHandler,
    onBeforeSubmit,
    statusContent,
    toolsContent,
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
  //
  // There is no "no route selected" state: one of the three segments is
  // always active. The input itself may or may not carry a leading prefix
  // atom — if it doesn't, the indicator reflects the default (`DEFAULT_ROUTE`,
  // Prompt). If it does, the indicator mirrors that prefix.
  const [route, setRouteState] = React.useState<string>(DEFAULT_ROUTE);

  // Live route ref so the submit handler in Step 5 can read the current
  // value without closing over a stale `route` closure variable [L07].
  const routeRef = useRef(route);
  useLayoutEffect(() => {
    routeRef.current = route;
  }, [route]);

  // Live ref for the optional localCommandHandler so `performSubmit` (the
  // shared submit closure) can read the latest callback without rebuilding
  // on every render. The chain-action handler registered via `useResponder`
  // is a stable closure — we read policy through refs per [L07].
  const localCommandHandlerRef = useRef(localCommandHandler);
  useLayoutEffect(() => {
    localCommandHandlerRef.current = localCommandHandler;
  }, [localCommandHandler]);

  // Live ref for `onBeforeSubmit` (same rationale as above — the submit
  // closure must read the latest callback without rebuilding on every
  // render). Fires once per successful submit, between store.send and
  // input.clear (see performSubmit).
  const onBeforeSubmitRef = useRef(onBeforeSubmit);
  useLayoutEffect(() => {
    onBeforeSubmitRef.current = onBeforeSubmit;
  }, [onBeforeSubmit]);

  // Shared submit logic. Invoked by both the SUBMIT chain-action handler
  // (button click, Cmd+Enter, etc.) and the Return/Shift+Return keyboard
  // path (via `onSubmit` on TugPromptInput). Keeping a single performSubmit
  // means keyboard and pointer converge on the same interrupt-vs-send
  // decision, the same localCommandHandler intercept, and the same
  // clear-and-reset-route teardown.
  //
  // Stable identity (`useCallback` with deps that are themselves stable —
  // `codeSessionStore` is a prop reference, not regenerated each render);
  // policy is read through refs so the closure never goes stale [L07].
  const performSubmit = useCallback(() => {
    const input = promptInputRef.current;
    const snap = snapRef.current;
    if (!input) return;
    // [D05] Submit is interrupt: the single SUBMIT action routes to
    // `interrupt()` during an in-flight turn and to `send()` otherwise.
    if (snap.canInterrupt) {
      codeSessionStore.interrupt();
      return;
    }
    // [D-T3-08] awaiting_approval / awaiting_question block the submit
    // path. `canSubmit` captures both.
    if (!snap.canSubmit) return;
    // Empty-input guard — a bare route atom isn't meaningful content
    // and shouldn't submit. Same helper that drives `data-empty`, read
    // through the input ref at submit time [L07].
    if (isEffectivelyEmpty(input)) return;
    const atoms = input.getAtoms();
    const text = input.getText();
    // [D06] localCommandHandler seam — called BEFORE the store send so
    // local `:`-surface commands can intercept.
    const currentRoute = routeRef.current || null;
    const handled =
      localCommandHandlerRef.current?.(currentRoute, atoms) ?? false;
    if (!handled) {
      codeSessionStore.send(text, atoms);
    }
    // Fire the pre-clear hook so hosts can drive submit-specific
    // effects (e.g., animated snap-back of a content-sized panel)
    // BEFORE `input.clear()` sets `data-empty="true"` and triggers
    // the content-driven hook's automatic instant restoration.
    onBeforeSubmitRef.current?.();
    input.clear();
    // Route is a sticky user preference. Do not reset it on submit —
    // if the user switched to Shell, subsequent prompts stay on Shell
    // until they choose otherwise.
  }, [codeSessionStore]);

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
        // Move keyboard focus to the editor so the user can start
        // typing immediately — the route segment button had focus
        // from the click; this hands it back to the input.
        promptInputRef.current?.focus();
      },
      [TUG_ACTIONS.SUBMIT]: (_event: ActionEvent) => {
        performSubmit();
      },
    },
  });

  // Input → indicator callback. The engine fires onRouteChange with
  // the detected prefix char (or null when the leading route atom is
  // removed). The route is a sticky user preference: when the engine
  // reports a concrete prefix, sync the indicator to it; when it
  // reports `null` (input cleared or route atom deleted), leave the
  // indicator where the user last set it — the next keystroke will
  // auto-insert the matching route atom via `handleInputChange`. [D04]
  const handleRouteChange = useCallback((r: string | null) => {
    if (r !== null) setRouteState(r);
  }, []);

  // Input onChange callback. Writes `data-empty` to the root element
  // directly via `rootRef` — no React state update, no re-render of the
  // entry on every keystroke [L06][L22]. Reads freshness from
  // `promptInputRef.current?.isEmpty()`; refs are always current, so the
  // empty-deps `useCallback` is safe.
  //
  // Also auto-inserts the current route's prefix atom when the user has
  // started typing into an input that has no leading route atom — i.e.
  // they backspaced the atom, then resumed typing. The current route is
  // the entry's `route` state (always a valid prefix char per the
  // always-one-selected invariant). We skip the insert when the first
  // typed character is itself a prefix, since the engine's own
  // `detectRoutePrefix` will convert it to an atom in the same tick.
  const handleInputChange = useCallback(() => {
    const root = rootRef.current;
    const input = promptInputRef.current;
    if (!root) return;
    // `data-empty` is the single source of truth for visual empty state.
    // Written directly to the DOM [L06][L22] — keystrokes do not cause
    // React re-renders. A route atom by itself does not count as
    // meaningful content: the user has to have typed *something* past
    // the prefix for the submit button to light up.
    const isEmpty = isEffectivelyEmpty(input);
    root.setAttribute("data-empty", String(isEmpty));
    if (isEmpty || !input) return;
    const atoms = input.getAtoms();
    const hasRouteAtom = atoms.length > 0 && atoms[0].type === "route";
    if (hasRouteAtom) return;
    const text = input.getText();
    const firstCharIsPrefix =
      text.length > 0 && ROUTE_PREFIXES.includes(text[0]);
    if (firstCharIsPrefix) return;
    const currentRoute = routeRef.current;
    if (currentRoute) {
      input.prependRouteAtom(currentRoute);
    }
  }, []);

  // Seed `data-empty` from the actual input state once the input ref
  // is wired [L03]. The JSX defaults `data-empty="true"` at render, but
  // on a browser reload / HMR refresh the editor may already carry
  // preserved content — the submit button would then stay disabled
  // until the user typed. Running the same effectively-empty check
  // once at mount closes that gap.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const input = promptInputRef.current;
    if (!root) return;
    root.setAttribute("data-empty", String(isEffectivelyEmpty(input)));
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
      getEditorElement() {
        return promptInputRef.current?.getEditorElement() ?? null;
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

  // Render the status row only when there is something to put in it.
  // Otherwise the row collapses to nothing and the input + toolbar stay
  // flush against the top of the entry, matching pre-polish behavior.
  const hasStatusRow = statusContent !== undefined || toolsContent !== undefined;

  // Tools popover open state. The entry is the single source of truth —
  // TugPopover runs in controlled mode via the `open` / `onOpenChange`
  // pair, so there is no internal popover state to sync with. Drives
  // both the popover's visibility AND the toggle button's emphasis +
  // role (accent-on-open).
  const [toolsOpen, setToolsOpen] = React.useState(false);

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
        {hasStatusRow && (
          <div className="tug-prompt-entry-status">
            <div className="tug-prompt-entry-status-content">
              {statusContent}
            </div>
            {toolsContent !== undefined && (
              <TugPopover
                open={toolsOpen}
                onOpenChange={setToolsOpen}
                dismissOnChainActivity={false}
              >
                <TugPopoverTrigger>
                  <TugPushButton
                    className="tug-prompt-entry-tools-toggle"
                    subtype="icon"
                    size="sm"
                    emphasis={toolsOpen ? "filled" : "ghost"}
                    role={toolsOpen ? "accent" : "action"}
                    aria-label="Toggle tools"
                    icon={<Settings size={14} strokeWidth={2} aria-hidden="true" />}
                  />
                </TugPopoverTrigger>
                <TugPopoverContent
                  side="bottom"
                  align="end"
                  className="tug-prompt-entry-tools-popover"
                >
                  {toolsContent}
                </TugPopoverContent>
              </TugPopover>
            )}
          </div>
        )}
        <div className="tug-prompt-entry-input-area">
          <TugPromptInput
            ref={promptInputRef}
            borderless
            maximized
            completionProviders={completionProviders}
            dropHandler={dropHandler}
            returnAction={RETURN_ACTION_BY_ROUTE[route] ?? "submit"}
            routePrefixes={[...ROUTE_PREFIXES]}
            onRouteChange={handleRouteChange}
            onChange={handleInputChange}
            onSubmit={performSubmit}
          />
        </div>
        <div className="tug-prompt-entry-toolbar">
          <TugChoiceGroup
            items={[...ROUTE_ITEMS]}
            value={route}
            senderId={routeIndicatorSenderId}
            size="xs"
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
            className="tug-prompt-entry-submit-button"
            action={TUG_ACTIONS.SUBMIT}
            subtype="icon"
            size="lg"
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
