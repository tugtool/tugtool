/**
 * `DevFindCluster` — the Find route's Z4B cluster: the Case / Word / Grep
 * option toggles and a whole-transcript match-count chip.
 *
 * It occupies the same centred-floating Z4B slot the code route fills with
 * Mode / Model / Effort ([D97]) — swapping the occupant on the ⌕ route is the
 * slot working as designed. Two pieces:
 *
 *  - **Options** — a {@link TugOptionGroup} of three independent toggles
 *    (Case sensitive · Entire word · Grep). Per [L11] the group emits a
 *    `setValue` action carrying the new active `string[]`; this component owns
 *    the responder (a `useResponderForm` `setValueStringArray` slot) that maps
 *    the set back to {@link FindOptions}, writes it into the {@link DevFindSession}
 *    store, and persists it to tugbank so the toggles survive a card reload.
 *    The option value is *read* from the same session snapshot ([L02]) — the
 *    store is the single source, the group is a controlled face over it.
 *
 *  - **Count** — a read-only `‹active+1› of ‹total›` chip (whole-transcript,
 *    from the store's authoritative match set), width-stabilized via
 *    {@link TugStableOverlay} so stepping through matches never reflows the
 *    cluster (Spec S03). It emits no action.
 *
 * **Refuses focus-steal ([L11]).** The toggle buttons carry
 * `data-tug-focus="refuse"` (from `TugOptionGroup`) so a click never pulls
 * first-responder off the prompt editor mid-search; the count chip is inert
 * text with no tab stop of its own.
 *
 * Laws: [L02] store read via `useSyncExternalStore`, [L06] no appearance in
 * React state, [L11] control emits action / responder owns the mutation.
 *
 * @module components/tugways/chrome/dev-find-cluster
 */

import "./dev-find-cluster.css";

import React, { useCallback, useId, useMemo, useSyncExternalStore } from "react";
import { CaseSensitive, Regex, WholeWord } from "lucide-react";

import { TugOptionGroup, type TugOptionItem } from "@/components/tugways/tug-option-group";
import { TugStableOverlay } from "@/components/tugways/internal/tug-stable-overlay";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import type { DevFindSession } from "@/lib/dev-find-session";
import type { FindOptions } from "@/lib/transcript-search";
import { putFindOptions } from "@/settings-api";

/** Option-group item values — one per {@link FindOptions} axis. */
const OPTION_CASE = "case";
const OPTION_WORD = "word";
const OPTION_GREP = "grep";

/** Icon size for the toggle glyphs — sized up so the Aa / ab / .* marks read
 *  clearly at chip scale. */
const OPTION_ICON_SIZE = 18;

/** The fixed toggle set, ordered Case · Word · Grep. Each carries a native
 *  tooltip so the icon-only glyphs are legible on hover (esp. the regex mark). */
const OPTION_ITEMS: TugOptionItem[] = [
  {
    value: OPTION_CASE,
    icon: <CaseSensitive size={OPTION_ICON_SIZE} />,
    "aria-label": "Match case",
    title: "Match case",
  },
  {
    value: OPTION_WORD,
    icon: <WholeWord size={OPTION_ICON_SIZE} />,
    "aria-label": "Match whole word",
    title: "Match whole word",
  },
  {
    value: OPTION_GREP,
    icon: <Regex size={OPTION_ICON_SIZE} />,
    "aria-label": "Use regular expression",
    title: "Regular expression (grep)",
  },
];

/** Project the active-value set the option group renders from the options. */
function optionsToValues(options: FindOptions): string[] {
  const out: string[] = [];
  if (options.caseSensitive) out.push(OPTION_CASE);
  if (options.wholeWord) out.push(OPTION_WORD);
  if (options.grep) out.push(OPTION_GREP);
  return out;
}

/** Fold the option group's active-value set back into {@link FindOptions}. */
function valuesToOptions(values: string[]): FindOptions {
  return {
    caseSensitive: values.includes(OPTION_CASE),
    wholeWord: values.includes(OPTION_WORD),
    grep: values.includes(OPTION_GREP),
  };
}

export interface DevFindClusterProps {
  /** The card's Find store — read for options + count, written on toggle. */
  findSession: DevFindSession;
  /** Author the option group into the prompt cluster's focus cycle ([P02]). */
  focusGroup?: string;
  /** Order within {@link focusGroup}. */
  focusOrder?: number;
}

/**
 * Z4B Find cluster: Case/Word/Grep toggles + a width-stabilized match-count
 * chip. See the module docstring for the store/responder wiring.
 */
export function DevFindCluster({
  findSession,
  focusGroup,
  focusOrder,
}: DevFindClusterProps): React.ReactElement {
  const snapshot = useSyncExternalStore(findSession.subscribe, findSession.getSnapshot);

  const senderId = useId();
  const handleSetOptions = useCallback(
    (values: string[]) => {
      const next = valuesToOptions(values);
      findSession.setOptions(next);
      putFindOptions(next);
    },
    [findSession],
  );

  const { ResponderScope } = useResponderForm({
    setValueStringArray: { [senderId]: handleSetOptions },
  });

  const activeValues = useMemo(() => optionsToValues(snapshot.options), [snapshot.options]);

  // Count face: empty query → nothing; a query with no hits → "No results";
  // otherwise the whole-transcript "N of M" from the authoritative match set.
  const total = snapshot.matches.length;
  const countText =
    total > 0
      ? `${snapshot.activeIndex + 1} of ${total}`
      : snapshot.query.length > 0
        ? "No results"
        : "";

  return (
    <ResponderScope>
      <div className="tugx-find-cluster" data-slot="find-cluster">
        <TugOptionGroup
          size="sm"
          emphasis="default"
          role="action"
          items={OPTION_ITEMS}
          value={activeValues}
          senderId={senderId}
          aria-label="Find options"
          focusGroup={focusGroup}
          focusOrder={focusOrder}
        />
        <span className="tugx-find-count" data-slot="find-count" aria-live="polite">
          <TugStableOverlay
            active={<span data-slot="find-count-value">{countText}</span>}
            alternates={["No results", "888 of 888"]}
          />
        </span>
      </div>
    </ResponderScope>
  );
}
