/**
 * `TugFindCluster` — the shared find cluster: Case / Word / Grep option
 * toggles plus a width-stabilized match-count chip, driven by any
 * {@link FindSurface} (the Dev transcript's store-index engine, the Text
 * card's CodeMirror-search engine).
 *
 * Two pieces:
 *
 *  - **Options** — a {@link TugOptionGroup} of three independent toggles
 *    (Case sensitive · Entire word · Grep). Per [L11] the group emits a
 *    `setValue` action carrying the new active `string[]`; this component
 *    owns the responder (a `useResponderForm` `setValueStringArray` slot)
 *    that maps the set back to {@link FindOptions} and hands it to
 *    `surface.setOptions` (the engine re-runs its search and persists as it
 *    sees fit). The option value is *read* from the same surface snapshot
 *    ([L02]) — the engine is the single source, the group is a controlled
 *    face over it.
 *
 *  - **Count** — a read-only `‹active+1› of ‹total›` chip (`No results` on a
 *    hitless query; `N+` when the engine capped its enumeration),
 *    width-stabilized via {@link TugStableOverlay} so stepping through
 *    matches never reflows the cluster. It emits no action.
 *
 * **Refuses focus-steal ([L11]).** The toggle buttons carry
 * `data-tug-focus="refuse"` (from `TugOptionGroup`) so a click never pulls
 * first-responder off the host's editor mid-search; the count chip is inert
 * text with no tab stop of its own.
 *
 * Laws: [L02] surface read via `useSyncExternalStore`, [L06] no appearance in
 * React state, [L11] control emits action / responder owns the mutation.
 *
 * @module components/tugways/tug-find-cluster
 */

import "./tug-find-cluster.css";

import React, { useCallback, useId, useMemo, useSyncExternalStore } from "react";
import { CaseSensitive, Regex, WholeWord } from "lucide-react";

import { TugOptionGroup, type TugOptionItem } from "@/components/tugways/tug-option-group";
import { TugStableOverlay } from "@/components/tugways/internal/tug-stable-overlay";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import type { FindSurface } from "@/lib/find-surface";
import type { FindOptions } from "@/lib/transcript-search";

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

export interface TugFindClusterProps {
  /** The find engine — read for options + count, written on toggle. */
  surface: FindSurface;
  /** Author the option group into the host's focus cycle. */
  focusGroup?: string;
  /** Order within {@link focusGroup}. */
  focusOrder?: number;
}

/**
 * The shared find cluster: Case/Word/Grep toggles + a width-stabilized
 * match-count chip. See the module docstring for the surface/responder wiring.
 */
export function TugFindCluster({
  surface,
  focusGroup,
  focusOrder,
}: TugFindClusterProps): React.ReactElement {
  const snapshot = useSyncExternalStore(
    useCallback((cb: () => void) => surface.subscribe(cb), [surface]),
    surface.getSnapshot,
  );

  const senderId = useId();
  const handleSetOptions = useCallback(
    (values: string[]) => {
      surface.setOptions(valuesToOptions(values));
    },
    [surface],
  );

  const { ResponderScope } = useResponderForm({
    setValueStringArray: { [senderId]: handleSetOptions },
  });

  const activeValues = useMemo(
    () => optionsToValues(snapshot.options),
    [snapshot.options],
  );

  // Count face: no query → nothing; a query with no hits → "No results";
  // otherwise the engine's authoritative "N of M" (`M+` when capped).
  const total = snapshot.count;
  const countText =
    total > 0
      ? `${(snapshot.activeOrdinal ?? 0) + 1} of ${total}${snapshot.capped ? "+" : ""}`
      : snapshot.hasQuery
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
