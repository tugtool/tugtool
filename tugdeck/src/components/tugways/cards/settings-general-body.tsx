/**
 * settings-general-body.tsx — the General settings panel.
 *
 * App-wide preferences that belong to the app itself rather than to a card
 * type. Two today. The **default project directory** — where Tug looks when
 * nothing else says otherwise (Open Quickly with no bound card, and the
 * session picker's path seed when there are no recents). And **what ⌘R does
 * to a slot's stack of panes**: cycle to the buried-longest one without
 * putting anything on screen, or open the title-bar picker to read the stack
 * first. Both commands stay in the Window menu either way; the setting moves
 * only the chord.
 *
 * The stored value is optional: unset reads through to `<home>/tug`, shown
 * in the field as a placeholder so the user sees what they will get without
 * the resolved path being written back as if they had chosen it.
 *
 * **The field never comes to rest on a value tugbank doesn't hold.** A path
 * shown in a settled field is a claim about what Tug will do — Open Quickly
 * names that directory in its search bar — so an edit that merely *looks*
 * finished is a lie the user has no way to see. Local state exists only while
 * the user is actively typing; the moment the field settles (a completion
 * accepted, Enter, focus leaving, the native picker returning) the value is
 * written and the field goes back to displaying the store. A write that is
 * refused takes the field back with it rather than leaving the typing on
 * screen looking saved.
 *
 * Laws: the stored path is external state read through `useTugbankValue`
 * ([L02] via `useSyncExternalStore`); only the in-flight edit is component
 * `useState`; the stored path is canonicalized server-side before it is
 * written ([L29] — it is a persisted key, matched against project bindings and
 * recents); layout lives in settings-general-body.css [L06].
 *
 * @module components/tugways/cards/settings-general-body
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { TUG_ACTIONS } from "../action-vocabulary";
import { commandShortcut, keymapRegistry } from "../keymap-registry";
import { TugBox } from "../tug-box";
import { TugLabel } from "../tug-label";
import { TugChoiceGroup } from "../tug-choice-group";
import { TugFileChooser } from "../tug-file-chooser";
import { useResponderForm } from "../use-responder-form";
import {
  normalizeStackChord,
  stackChordStore,
  useStackChord,
} from "@/stack-chord-store";
import { useHostFacts } from "@/lib/host-facts-store";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import { probeDirExistence } from "@/lib/dir-existence";
import {
  DEFAULT_PROJECT_PATH_DOMAIN,
  DEFAULT_PROJECT_PATH_KEY,
  DEFAULT_PROJECT_DIR_LEAF,
  putDefaultProjectPath,
} from "@/settings-api";
import type { TaggedValue } from "@/lib/tugbank-client";
import "./settings-general-body.css";

/** Read the explicit stored path out of a tugbank entry. */
function parseStoredPath(entry: TaggedValue | undefined): string {
  if (entry && entry.kind === "string" && typeof entry.value === "string") {
    return entry.value;
  }
  return "";
}

export function SettingsGeneralBody() {
  const hostFacts = useHostFacts();
  const home = hostFacts?.home ?? null;
  const resolvedFallback =
    home === null
      ? ""
      : `${home.replace(/\/+$/, "")}/${DEFAULT_PROJECT_DIR_LEAF}`;

  const stored = useTugbankValue(
    DEFAULT_PROJECT_PATH_DOMAIN,
    DEFAULT_PROJECT_PATH_KEY,
    parseStoredPath,
    "",
  );

  // The in-flight edit, or null when the field is showing the stored value.
  // Typing forks a draft; settling writes it and drops back to reading the
  // store, so a draft can only ever exist under the user's hands.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? stored;

  // Whether the currently shown path exists on disk. `null` while unknown —
  // the note only appears once the probe answers "no".
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const probe = value !== "" ? value : resolvedFallback;
    if (probe === "") {
      setMissing(false);
      return;
    }
    let cancelled = false;
    void probeDirExistence([probe]).then((result) => {
      if (!cancelled) setMissing(result[probe] === false);
    });
    return () => {
      cancelled = true;
    };
  }, [value, resolvedFallback]);

  // Guards a settle against a later one: two settles can be in flight (accept
  // then blur), and the older write must not clear a draft the user has since
  // started, nor land after the newer value.
  const settleSeq = useRef(0);

  // The field settled on `next` — write it, then drop the draft so the field
  // reads the store again. Whatever the store ends up holding is what shows:
  // a canonicalized spelling, or the previous value if the write was refused.
  const settle = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      const seq = (settleSeq.current += 1);
      if (trimmed === stored) {
        setDraft(null);
        return;
      }
      void putDefaultProjectPath(trimmed).then(() => {
        if (seq === settleSeq.current) setDraft(null);
      });
    },
    [stored],
  );

  // Which Window-menu item owns ⌘R. The store is the value's home — the host
  // reads it off the menu-state push — so the control writes straight through
  // and re-reads it, never holding a copy that could settle out of step.
  const stackChord = useStackChord();
  const stackChordId = useId();
  // The chord this setting is about, read from whichever of the two commands
  // currently holds it rather than spelled here — this pane is the one place
  // that can move it, so it is the last place that should carry a copy ([P11]).
  // The registry is a subscription ([L02]) so a live rebind repaints the copy;
  // `undefined` means the command is unbound and the copy names no chord.
  useSyncExternalStore(keymapRegistry.subscribe, keymapRegistry.getSnapshot, () => 0);
  const stackChordGlyph = commandShortcut(
    stackChord === "reveal" ? TUG_ACTIONS.REVEAL_STACK : TUG_ACTIONS.CYCLE_STACK,
  );
  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: {
      [stackChordId]: (v: string) => stackChordStore.setChord(normalizeStackChord(v)),
    },
  });

  return (
    <ResponderScope>
      <div
        className="settings-general"
        data-testid="settings-general"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        <TugBox
          label="Default Project Directory"
          labelPosition="legend"
          variant="bordered"
          className="settings-general-group"
        >
          <div
            className="settings-general-field"
            data-testid="settings-default-project-dir-field"
          >
            <TugFileChooser
              value={value}
              onChange={setDraft}
              base={value !== "" ? value : home ?? "/"}
              kind="directory"
              onSettle={settle}
              placeholder={resolvedFallback}
              aria-label="Default project directory"
            />
          </div>
          <TugLabel size="sm" emphasis="calm" className="settings-general-hint">
            {missing
              ? "This folder doesn't exist yet — it will be created the first time Tug needs it."
              : "Where Tug looks when no session card says otherwise: Open Quickly with nothing open, and the new-session path when there are no recent projects."}
          </TugLabel>
        </TugBox>

        <TugBox
          label="Stacked Panes"
          labelPosition="legend"
          variant="bordered"
          className="settings-general-group"
        >
          <TugChoiceGroup
            className="settings-general-chord"
            size="sm"
            senderId={stackChordId}
            value={stackChord}
            aria-label="What Command-R does to a stack of panes"
            data-testid="settings-stack-chord"
            items={[
              {
                value: "cycle",
                label:
                  stackChordGlyph === undefined
                    ? "Cycle the stack"
                    : `${stackChordGlyph} cycles the stack`,
              },
              {
                value: "reveal",
                label:
                  stackChordGlyph === undefined
                    ? "Show the stack menu"
                    : `${stackChordGlyph} shows the stack menu`,
              },
            ]}
          />
          <TugLabel size="sm" emphasis="calm" className="settings-general-hint">
            {stackChord === "cycle"
              ? `${stackChordGlyph === undefined ? "Cycling" : stackChordGlyph} brings the pane that has been buried longest to the front — no menu, so a slot of N panes is back where it started after N presses. The picker is still on the title-bar badge, and on ⌘-click.`
              : `${stackChordGlyph === undefined ? "Revealing" : stackChordGlyph} opens the title-bar picker so you can read the stack before choosing. Both commands stay in the Window menu either way.`}
          </TugLabel>
        </TugBox>
      </div>
    </ResponderScope>
  );
}
