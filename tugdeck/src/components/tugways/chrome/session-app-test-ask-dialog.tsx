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
 * ## Selection
 *
 * The safest option is preselected, so the routine case (the core tier prompts
 * on every run) is one keystroke, and a reflexive Return never seizes the
 * screen. Callers order options with the declining one last; that is what the
 * store falls back to when a question cannot be shown at all.
 *
 * **Laws:** [L24] — `selectedOption` is a pre-commit draft owned by this
 * component and never leaves it; the question itself is local data on the
 * session store, read through `useSyncExternalStore` by the mount site ([L02]).
 * [L06] — tone and icon tint are CSS, not React state.
 *
 * @module components/tugways/chrome/session-app-test-ask-dialog
 */

import "./session-app-test-ask-dialog.css";

import React from "react";
import { TerminalSquare } from "lucide-react";

import { TugInlineDialog } from "@/components/tugways/tug-inline-dialog";
import type { TugInlineDialogOption } from "@/components/tugways/tug-inline-dialog";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import type { PendingAsk } from "@/lib/code-session-store/types";

export interface AppTestAskDialogProps {
  /** The live question. */
  ask: PendingAsk;
  /** Answer it and release the blocked caller. */
  onRespond: (choice: string) => void;
}

const CONFIRM_FOCUS_ORDER = 0;

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

  const options: TugInlineDialogOption[] = ask.options.map((option) => ({
    value: option.value,
    label: option.label,
    description: option.description,
  }));

  const handleConfirm = React.useCallback(() => {
    onRespond(selectedOption);
  }, [onRespond, selectedOption]);

  return (
    <div
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
        options={options}
        selectedOption={selectedOption}
        onSelectOption={setSelectedOption}
        optionsAriaLabel={ask.title}
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
      />
    </div>
  );
};
