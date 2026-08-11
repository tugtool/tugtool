/**
 * tug-modal-input-dialog.tsx — an app-modal, typing-first input dialog.
 *
 * A search field over a scrolling result list, driven by any
 * {@link CompletionProvider} — the same `(query) => items` contract the `@`-file
 * completion in the composer uses, so a live `FileTreeStore` provider drops
 * straight in. It renders no data source of its own; the caller supplies the
 * provider and handles commit. An optional {@link TugModalInputDialogProps.header}
 * sits above the input, inside the jail (Open Quickly's scope-directory chooser).
 *
 * ## Modality
 *
 * The dialog is app-modal in the TugAlert sense: a Radix `Dialog` portalled into
 * the canvas overlay root ([L25]), a blocking overlay, and Radix's own focus
 * jail. Nothing beneath it can be reached with the pointer, so dismissal is a
 * short closed list — the engine's Escape ladder, ⌘., an outside interaction
 * when the consumer opts in ({@link TugModalInputDialogProps.dismissOnOutsideClick}),
 * and the caller's own commit. There is no blur-dismissal and no dismiss guard:
 * focus cannot wander out of a jail, so there is nothing to approximate.
 *
 * ## Typing-first
 *
 * The trap passes `kbf: false` — the typing-first carve-out in
 * `tuglaws/focus-language.md`. The caret belongs in the query field from the
 * first keystroke, and ↑/↓ drive the result list from there through this
 * component's own `onKeyDown`; auto-engaging KBF would hand the arrows to the
 * engine's ring instead. ⌥⇥ inside the dialog still engages the mode manually,
 * and it acts on THIS mode because the toggle applies to the trapped mode that
 * owns the keyboard — the dialog's stops are the input (order 0) and whatever
 * the header authors above it.
 *
 * The field is a {@link TugInput}, not a bare `<input>`, so it registers as a
 * chain responder and carries the substrate CUT / COPY / PASTE / SELECT_ALL /
 * UNDO / REDO handlers. That registration is load-bearing: ⌘V is a
 * capture-phase global binding dispatched to the first responder, and a bare
 * `<input>` carries no `data-responder-id`, so the paste would be swallowed by
 * whatever surface sits behind the dialog.
 *
 * ## Portalling a header control's own dropdown
 *
 * A modal Radix `Content` sets `pointer-events: none` on the body and restores
 * it only on registered dismissable layers, so a header control whose menu
 * portals to the canvas overlay root would be pointer-dead. Header content that
 * portals reads {@link useModalInputDialogPanel} and portals into the panel
 * instead, where it is inside the jail and no layer negotiation is needed.
 *
 * Laws: [L06] appearance via CSS + DOM, no React state for looks; [L19]
 * authoring guide (`data-slot`, tokens); [L25] mounted into the canvas overlay,
 * not a pane.
 *
 * @module components/tugways/tug-modal-input-dialog
 */

import {
  createContext,
  useCallback,
  useId,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Search } from "lucide-react";
// Plain Dialog, not AlertDialog: AlertDialog.Content force-focuses its Cancel
// button on open from an internal composed handler that runs regardless of the
// user handler's `preventDefault` — a raw focus write the engine cannot
// prevent, only correct. Dialog.Content's open-autofocus IS preventable, so the
// engine owns the landing. Same reasoning documented at the top of
// `tug-alert.tsx`.
import * as Dialog from "@radix-ui/react-dialog";

import "./tug-modal-input-dialog.css";

import { TugInput } from "./tug-input";
import { ATTACHED_LIST_ATTRIBUTE } from "./focus-manager";
import { isCancelChordEvent } from "./keymap-registry";
import { TUG_ACTIONS } from "./action-vocabulary";
import { useOptionalResponder } from "./use-responder";
import { useFocusTrap } from "./use-focus-trap";
import { useFocusManager, useSeedKeyView } from "./use-focusable";
import { useCanvasOverlay } from "@/lib/use-canvas-overlay";
import type { CompletionItem, CompletionProvider } from "@/lib/tug-text-types";

/**
 * The focus group the dialog's own stops are authored into. Exported because
 * the `header` is caller-supplied: a header control has to name the same group
 * (at an order above {@link MODAL_INPUT_DIALOG_FIELD_ORDER}) to join this
 * dialog's Tab walk.
 */
export const MODAL_INPUT_DIALOG_FOCUS_GROUP = "tug-modal-input-dialog";

/** The query field's order in {@link MODAL_INPUT_DIALOG_FOCUS_GROUP}. */
export const MODAL_INPUT_DIALOG_FIELD_ORDER = 0;

/**
 * The dialog's panel element, for header content that portals. Null until the
 * panel mounts; a `useState` behind the context, not a ref, so a header that
 * needs the element re-renders when it lands.
 */
const ModalInputDialogPanelContext = createContext<HTMLDivElement | null>(null);

/**
 * The enclosing {@link TugModalInputDialog}'s panel element, or null outside
 * one. Header content whose own menu portals passes this as its portal
 * container: a modal Radix `Content` makes every node outside itself
 * pointer-dead, so a dropdown portalled to the canvas overlay root would be
 * unclickable. Inside the panel it is not outside anything.
 */
export function useModalInputDialogPanel(): HTMLDivElement | null {
  return useContext(ModalInputDialogPanelContext);
}

export interface TugModalInputDialogProps {
  /**
   * Accessible name for the dialog, and the empty field's placeholder — the
   * one string that names what the surface is for.
   */
  placeholder?: string;
  /**
   * Completion source: `(query) => items`, optionally with a `subscribe` for
   * async result streams (a `FileTreeStore` provider has both).
   */
  provider: CompletionProvider;
  /** Open the chosen item (Return on the highlight, or a row click). */
  onCommit: (item: CompletionItem) => void;
  /** Dismiss without committing (Escape ladder, ⌘., outside interaction). */
  onDismiss: () => void;
  /**
   * Rendered above the query field, inside the trap. Author its controls into
   * {@link MODAL_INPUT_DIALOG_FOCUS_GROUP} at orders above
   * {@link MODAL_INPUT_DIALOG_FIELD_ORDER} to put them in the dialog's Tab
   * walk — a control with no `focusGroup` is a native-only stop the walk never
   * reaches, and reads as "Tab skips it" (`focus-language.md`, Authoring
   * contract).
   */
  header?: React.ReactNode;
  /**
   * Shown in place of the result list when the provider returns nothing — "no
   * files here", as opposed to the blank panel that reads as "still thinking".
   * Returning `null` renders nothing, which is what a caller that cannot yet
   * tell the two apart should do.
   *
   * A callback rather than a string because the answer depends on state the
   * dialog does not own (has the search backend answered yet?) and is read at
   * render time — the same render the provider's notification triggers, so the
   * two can never disagree about whether results are in.
   */
  emptyLabel?: () => string | null;
  /**
   * Launcher posture: an interaction outside the panel dismisses. Default
   * `false` — the alert posture, where the user must answer. The overlay blocks
   * the interaction either way, so nothing beneath it activates.
   */
  dismissOnOutsideClick?: boolean;
}

/**
 * Split `label` into matched / unmatched runs from a provider's `[start, end)`
 * match ranges, so matched characters can be emphasized the way the composer's
 * completion popup does.
 */
function renderLabel(
  label: string,
  matches: [number, number][] | undefined,
): React.ReactNode {
  if (!matches || matches.length === 0) return label;
  const ordered = [...matches].sort((a, b) => a[0] - b[0]);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ordered.forEach(([start, end], i) => {
    const s = Math.max(cursor, start);
    if (s > cursor) parts.push(label.slice(cursor, s));
    if (end > s) {
      parts.push(
        <strong key={i} className="tug-modal-input-dialog-match">
          {label.slice(s, end)}
        </strong>,
      );
    }
    cursor = Math.max(cursor, end);
  });
  if (cursor < label.length) parts.push(label.slice(cursor));
  return parts;
}

/** The empty-result panel, or nothing when the caller has no answer to give. */
function renderEmpty(
  emptyLabel: (() => string | null) | undefined,
): React.ReactElement | null {
  const text = emptyLabel?.() ?? null;
  if (text === null) return null;
  return (
    <div
      className="tug-modal-input-dialog-empty"
      data-slot="tug-modal-input-dialog-empty"
    >
      {text}
    </div>
  );
}

export function TugModalInputDialog({
  placeholder = "Search",
  provider,
  onCommit,
  onDismiss,
  header,
  emptyLabel,
  dismissOnOutsideClick = false,
}: TugModalInputDialogProps): React.ReactElement {
  const overlayRoot = useCanvasOverlay();
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const responderId = useId();
  // The panel is a chain responder for Cancel, because ⌘. does not arrive as a
  // bubbling keydown: it is a capture-phase global binding dispatched to the
  // first responder, so the `onKeyDown` below never sees it. The query field
  // IS a responder (a `TugInput`), and the walk from it goes DOM-up — which
  // reaches this panel and stops. Without the registration ⌘. is swallowed by
  // the binding and answered by nobody. The `onKeyDown` stays as the path for
  // a stop inside the dialog that is not itself a responder.
  const { responderRef } = useOptionalResponder({
    id: responderId,
    actions: { [TUG_ACTIONS.CANCEL_DIALOG]: () => onDismiss() },
  });
  const setPanelRef = useCallback(
    (el: HTMLDivElement | null) => {
      setPanel(el);
      (responderRef as (node: HTMLDivElement | null) => void)(el);
    },
    [responderRef],
  );
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CompletionItem[]>([]);
  const [selected, setSelected] = useState(0);

  // Pull results for the current query. Kept in a ref so the async
  // subscription re-pulls the live query without re-subscribing.
  const queryRef = useRef(query);
  queryRef.current = query;
  const pull = useCallback(() => {
    const next = provider(queryRef.current);
    setItems(next);
    setSelected((prev) => (prev < next.length ? prev : 0));
  }, [provider]);

  // Re-query on keystroke.
  useEffect(() => {
    pull();
  }, [query, pull]);

  // Async provider results (FileTreeStore streams over the WebSocket): re-pull
  // when the store notifies. [L22]-style direct observation.
  useEffect(() => {
    if (provider.subscribe === undefined) return;
    return provider.subscribe(() => pull());
  }, [provider, pull]);

  // The dialog's own focus mode, for as long as it is mounted (the consumer
  // mounts it only while open). `onEscapeDismiss` is what puts this surface on
  // the engine's Escape ladder — the single arbiter — so Escape closes the
  // dialog from anywhere inside it, including from a header control where no
  // field keydown handler can reach. `kbf: false` is the typing-first
  // carve-out: the caret belongs in the field from the first keystroke.
  const { FocusModeScope, onCloseAutoFocus } = useFocusTrap({
    active: true,
    deferDomFocusToTeardown: true,
    onEscapeDismiss: onDismiss,
    kbf: false,
  });

  // ⌥⇥ inside the dialog writes the KBF manual bit, and a `kbf: false` trap
  // manages that bit itself: `popFocusMode` clears it only for engaging traps
  // ("An engaging trap is left" in `tuglaws/focus-language.md`). Without this
  // the ⌥⇥ a user pressed inside a launcher would strand a ring on the deck
  // they returned to.
  //
  // Restore, not clear-if-newly-set, because the opposite direction is just as
  // real: a user inside a session card's focus cycle — which IS the manual bit
  // — who presses ⌥⇥ **off** in here would otherwise find that cycle silently
  // disengaged after close. The pointer is the one answer we do not overrule:
  // `clearKbfManualForPointer` is the user reaching for the mouse, and
  // re-asserting a captured `true` over it would repaint a ring they just
  // dismissed. Declared after the trap so this cleanup runs after its pop.
  const focusManager = useFocusManager();
  useLayoutEffect(() => {
    if (focusManager === null) return;
    const captured = focusManager.kbfManual();
    return () => {
      if (focusManager.kbfClearedByPointer()) return;
      focusManager.setKbfManual(captured);
    };
  }, [focusManager]);

  // Seed the engine key view onto the field so typing lands there immediately
  // and Tab moves the key view from there ([P12] surface default-seed). The
  // field is a text surface, so the engine grants it real DOM focus. That is
  // the engine's write — the dialog never calls `.focus()` itself
  // (`focus-language.md`, "Raw `.focus()` is legal only inside a granted
  // window").
  useSeedKeyView(
    `${MODAL_INPUT_DIALOG_FOCUS_GROUP}:${MODAL_INPUT_DIALOG_FIELD_ORDER}`,
  );

  // Keep the highlighted row in view as the selection moves.
  useLayoutEffect(() => {
    if (panel === null) return;
    const row = panel.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selected, panel]);

  const commit = useCallback(
    (item: CompletionItem | undefined) => {
      if (item !== undefined) onCommit(item);
    },
    [onCommit],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelected((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelected((i) =>
            items.length === 0 ? 0 : (i - 1 + items.length) % items.length,
          );
          break;
        case "Enter":
          e.preventDefault();
          commit(items[selected]);
          break;
        case "Escape":
          e.preventDefault();
          onDismiss();
          break;
        default:
          break;
      }
    },
    [items, selected, commit, onDismiss],
  );

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        // Radix's own dismissal paths (an outside interaction we did not
        // prevent) land here. Escape is prevented below — the engine's ladder
        // owns it — and ⌘. calls `onDismiss` directly.
        if (!next) onDismiss();
      }}
    >
      <Dialog.Portal container={overlayRoot}>
        <Dialog.Overlay
          className="tug-modal-input-dialog-overlay"
          data-slot="tug-modal-input-dialog-overlay"
        />
        <Dialog.Content
          ref={setPanelRef}
          className="tug-modal-input-dialog"
          data-slot="tug-modal-input-dialog"
          // The engine seeds the field as the key view; stop Radix's own
          // first-focusable walk so the two don't fight.
          onOpenAutoFocus={(e) => e.preventDefault()}
          // The engine's Escape ladder owns Escape via the trap's
          // `onEscapeDismiss`.
          onEscapeKeyDown={(e) => e.preventDefault()}
          // The trap is the single close-focus DOM writer at teardown.
          onCloseAutoFocus={onCloseAutoFocus}
          // Outside dismissal is a POINTER act and only a pointer act. The
          // overlay blocks the press regardless; this only decides whether it
          // also dismisses. Prevented ⇒ `onOpenChange` never fires.
          onPointerDownOutside={(e) => {
            if (!dismissOnOutsideClick) e.preventDefault();
          }}
          // Focus leaving the panel NEVER dismisses. Radix folds focus-outside
          // into the same dismissal path as a click, which is blur-dismissal
          // wearing a different hat — and it fires for the ordinary business of
          // an engine-routed walk, where the engine parks `activeElement` on a
          // key sink. That park is the engine holding the keyboard, not the
          // user leaving the surface. This is the exemption list the old popup
          // maintained by hand; here it is one rule with no cases.
          onFocusOutside={(e) => e.preventDefault()}
          // `Dialog.Content` logs a `DialogTitleWarning` for any content
          // without a `Title`, and an `aria-label` does not silence it — the
          // visually-hidden title below is the accessible name. There is no
          // description, and the undefined is what stops Radix wiring
          // `aria-describedby` to an id nothing renders.
          aria-describedby={undefined}
          onKeyDown={(e) => {
            // ⌘. dismisses (macOS convention).
            if (isCancelChordEvent(e)) {
              e.preventDefault();
              onDismiss();
            }
          }}
        >
          <FocusModeScope>
            {/* The dialog's own key sink: Radix's trapped FocusScope refocuses
                into itself whenever focus leaves it, so the engine's park must
                land INSIDE the jail — the engine always parks at the innermost
                mounted sink. Without this, every park while the dialog is open
                is answered by a raw Radix refocus onto the first tabbable
                control. */}
            <div
              data-tug-key-sink=""
              tabIndex={-1}
              className="tug-key-sink"
              aria-label="Keyboard"
            />
            <Dialog.Title className="tug-modal-input-dialog-title">
              {placeholder}
            </Dialog.Title>
            <ModalInputDialogPanelContext.Provider value={panel}>
              {header !== undefined ? (
                <div
                  className="tug-modal-input-dialog-header"
                  data-slot="tug-modal-input-dialog-header"
                >
                  {header}
                </div>
              ) : null}
            </ModalInputDialogPanelContext.Provider>
            {/*
              The attached-list contract: the result list below is this field's
              list, so ↑/↓ drive its cursor and never leave the field — empty
              query or not. The marker rides this wrapper because the caret
              lives in the `TugInput` inside it. With the ladder yielding,
              `onKeyDown` above runs on the first keystroke.
            */}
            <div
              className="tug-modal-input-dialog-field"
              data-slot="tug-modal-input-dialog-field"
              {...{ [ATTACHED_LIST_ATTRIBUTE]: "" }}
            >
              <Search
                className="tug-modal-input-dialog-field-icon"
                aria-hidden
              />
              <TugInput
                className="tug-modal-input-dialog-input"
                borderless
                type="text"
                spellCheck={false}
                autoComplete="off"
                placeholder={placeholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                focusGroup={MODAL_INPUT_DIALOG_FOCUS_GROUP}
                focusOrder={MODAL_INPUT_DIALOG_FIELD_ORDER}
              />
            </div>
            {items.length > 0 ? (
              <ul
                className="tug-modal-input-dialog-list"
                data-slot="tug-modal-input-dialog-list"
                role="listbox"
              >
                {items.map((item, i) => (
                  <li
                    key={item.label + i}
                    data-index={i}
                    data-selected={i === selected ? "true" : undefined}
                    className="tug-modal-input-dialog-row"
                    data-slot="tug-modal-input-dialog-row"
                    role="option"
                    aria-selected={i === selected}
                    onMouseMove={() => setSelected(i)}
                    // Keep the caret in the field so the click commits against
                    // a field that never lost it.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commit(item)}
                  >
                    {renderLabel(item.label, item.matches)}
                  </li>
                ))}
              </ul>
            ) : (
              renderEmpty(emptyLabel)
            )}
          </FocusModeScope>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
