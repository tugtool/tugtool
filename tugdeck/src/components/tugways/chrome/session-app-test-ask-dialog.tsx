/**
 * `AppTestAskDialog` — the inline dialog for a question raised from outside the
 * turn stream.
 *
 * A command-line tool that is about to do something the developer will feel
 * — an app-test run that seizes the screen is the case this was built for —
 * `POST`s to tugcast's `/api/ask` and blocks. That question lands on the
 * session's store as `pendingAsk`, and this renders it.
 *
 * ## Why it looks different from `PermissionDialog`
 *
 * Both compose `TugInlineDialog`, but they are not the same kind of thing and
 * must not be mistakable for one another. A permission prompt comes from the
 * assistant's own turn; this comes from any process that can reach loopback.
 * `/api/ask` is deliberately not dev-gated — a consent prompt that only works
 * on a dev build is no consent prompt — which means caller-supplied text is
 * reaching the user's Session card.
 *
 * So the caller gets `title`, `description`, and option labels, and nothing
 * else. The icon, the tone, and the provenance line above the title are the
 * app's, rendered as plain strings with no rich content from the wire. A
 * question cannot dress itself up as one of the app's own prompts. This raises
 * the cost of impersonation; it does not authenticate anyone — loopback is
 * still the actual trust boundary.
 *
 * ## Card-modal, like its siblings
 *
 * This is a card-modal inline dialog ([P16]): a trapped focus mode owns the
 * keyboard while it is up, Tab cycles only its own controls, Escape declines,
 * and the card content around it is scrimmed ([P19] — driven by the mount
 * site's `data-inline-dialog-pending`, which `inlineDialogPending` in
 * `session-card.tsx` sets off the snapshot's `pendingAsk`).
 *
 * While it is up the session reads **Awaiting** in the Z2 STATE cell and in the
 * Lens session row, the same as the permission and question dialogs. Those two
 * get there through the reducer's `phase`; this one cannot (it belongs to no
 * turn), so it reaches the indicator through `sessionSessionPhaseKey`'s own
 * `pendingAsk` axis — see `session-phase-visual.ts`.
 *
 * Modality is not decoration here. Without the trap the prompt entry keeps the
 * caret, and `TugTextEditor`'s Return defers to whatever default button the
 * responder chain holds in its pane — which would be this dialog's `Continue`.
 * A developer typing a prompt and pressing Return would answer a question they
 * were not looking at, with the preselected option, and lose the submit. The
 * trap plus the entry stand-down is what makes Return mean one thing at a time.
 *
 * The options are a `TugRadioGroup` in the body rather than `TugInlineDialog`'s
 * own `options` prop: that prop renders `TugDialogButton` rows, which carry no
 * focus registration and are reachable only by mouse. `PermissionDialog` makes
 * the same substitution for the same reason.
 *
 * ## Selection
 *
 * The safest option is preselected and seeded as the key view, so answering is
 * one keystroke and a reflexive Return never seizes the screen. Callers order
 * options with the declining one last; that is what Escape chooses, and what
 * the store falls back to when a question cannot be shown at all.
 *
 * **Laws:** [L24] — `selectedOption` is a pre-commit draft owned by this
 * component and never leaves it; the question itself is local data on the
 * session store, read through `useSyncExternalStore` by the mount site ([L02]).
 * [L06] — tone and icon tint are CSS, not React state. [L11] — the radio group
 * is a control; its selection arrives through the responder chain.
 *
 * @module components/tugways/chrome/session-app-test-ask-dialog
 */

import "./session-app-test-ask-dialog.css";

import React from "react";
import { TerminalSquare } from "lucide-react";

import { TugInlineDialog } from "@/components/tugways/tug-inline-dialog";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugRadioGroup, TugRadioItem } from "@/components/tugways/tug-radio-group";
import { useFocusTrap } from "@/components/tugways/use-focus-trap";
import { useInlineDialogScope } from "@/components/tugways/use-inline-dialog-scope";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { useSpatialOrder } from "@/components/tugways/use-spatial-order";
import type { SpatialOrder } from "@/components/tugways/spatial-order";
import type { PendingAsk } from "@/lib/code-session-store/types";

export interface AppTestAskDialogProps {
  /** The live question. */
  ask: PendingAsk;
  /** Answer it and release the blocked caller. */
  onRespond: (choice: string) => void;
}

const CONFIRM_FOCUS_ORDER = 0;
const OPTIONS_FOCUS_ORDER = 1;

/**
 * The option to start on: the last one, which callers reserve for declining.
 * Erring toward "do less" is the whole point of a consent prompt.
 */
function safestOption(options: ReadonlyArray<{ value: string }>): string {
  return options.length > 0 ? options[options.length - 1].value : "";
}

export const AppTestAskDialog: React.FC<AppTestAskDialogProps> = ({
  ask,
  onRespond,
}) => {
  const focusGroup = React.useId();

  // Keyed on requestId so a second question replaces the first's selection
  // instead of inheriting it.
  const [selectedOption, setSelectedOption] = React.useState<string>(() =>
    safestOption(ask.options),
  );
  const lastRequestId = React.useRef(ask.requestId);
  if (lastRequestId.current !== ask.requestId) {
    lastRequestId.current = ask.requestId;
    setSelectedOption(safestOption(ask.options));
  }

  const handleConfirm = React.useCallback(() => {
    onRespond(selectedOption);
  }, [onRespond, selectedOption]);

  // Escape / Cmd-. answer with the declining option rather than dismissing.
  // There is no dismiss to offer: a process is blocked on this, and closing the
  // dialog without answering would leave it blocked with nothing on screen.
  const handleDecline = React.useCallback(() => {
    onRespond(safestOption(ask.options));
  }, [onRespond, ask.options]);

  // The engine-side trap. While it is up the Tab walk services only this
  // dialog's focusables, and the key view that was current when it opened is
  // restored on close.
  const { FocusModeScope, scopeId } = useFocusTrap({
    active: true,
    onEscapeDismiss: handleDecline,
  });

  // A closed vertical loop between the single action and the option group, so
  // no arrow dead-ends: Down or Up from Continue drops into the options, Up
  // from the top of the options returns to Continue. The options are the
  // group's delegated 1D cursor, not ring nodes.
  const confirmKey = `${focusGroup}:${CONFIRM_FOCUS_ORDER}`;
  const optionsKey = `${focusGroup}:${OPTIONS_FOCUS_ORDER}`;
  const spatialOrder = React.useMemo<SpatialOrder>(
    () => ({
      rings: [],
      seams: [
        { from: confirmKey, direction: "down", to: optionsKey },
        { from: confirmKey, direction: "up", to: optionsKey },
        { from: optionsKey, direction: "up", to: confirmKey },
      ],
    }),
    [confirmKey, optionsKey],
  );
  useSpatialOrder(scopeId, spatialOrder);

  // `CANCEL_DIALOG` responder (Escape / Cmd-. → decline) plus the key-view seed
  // onto Continue, so the dialog opens with Return's home ringed and the whole
  // dialog scrolled into view. `attachRoot` wires the responder onto the outer
  // element, the ancestor of every control.
  const { attachRoot, responderId: dialogResponderId } = useInlineDialogScope({
    active: true,
    defaultFocusKey: confirmKey,
    onCancel: handleDecline,
  });

  // The options are a controlled radio group whose selection arrives through
  // the responder chain ([L11]). Its `parentId` is the dialog's cancel
  // responder, so an Escape while the radio holds the key view walks
  // `CANCEL_DIALOG` up to the decline instead of escaping past the dialog.
  const radioSenderId = React.useId();
  const { ResponderScope: OptionsResponderScope, responderRef: optionsResponderRef } =
    useResponderForm({
      selectValue: { [radioSenderId]: (next: string) => setSelectedOption(next) },
      parentId: dialogResponderId,
    });

  return (
    <FocusModeScope>
      <div
        ref={attachRoot}
        className="session-app-test-ask-dialog"
        data-slot="session-app-test-ask-dialog"
      >
        <TugInlineDialog
          icon={<TerminalSquare />}
          iconRole="caution"
          title={ask.title}
          description={
            <>
              <span className="session-app-test-ask-dialog-provenance">
                Requested by a command on this machine
              </span>
              {ask.description !== null ? (
                <span className="session-app-test-ask-dialog-detail">
                  {ask.description}
                </span>
              ) : null}
            </>
          }
          actions={
            <TugPushButton
              emphasis="primary"
              role="action"
              size="xs"
              focusGroup={focusGroup}
              focusOrder={CONFIRM_FOCUS_ORDER}
              persistentDefaultRing
              onClick={handleConfirm}
            >
              Continue
            </TugPushButton>
          }
        >
          <OptionsResponderScope>
            <div
              ref={optionsResponderRef as (el: HTMLDivElement | null) => void}
              className="session-app-test-ask-dialog-options"
            >
              <TugRadioGroup
                value={selectedOption}
                senderId={radioSenderId}
                size="md"
                orientation="vertical"
                aria-label={ask.title}
                focusGroup={focusGroup}
                focusOrder={OPTIONS_FOCUS_ORDER}
              >
                {ask.options.map((option) => (
                  <TugRadioItem
                    key={option.value}
                    value={option.value}
                    description={option.description}
                  >
                    {option.label}
                  </TugRadioItem>
                ))}
              </TugRadioGroup>
            </div>
          </OptionsResponderScope>
        </TugInlineDialog>
      </div>
    </FocusModeScope>
  );
};
