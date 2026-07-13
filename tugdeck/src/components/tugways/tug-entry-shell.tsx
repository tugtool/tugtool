/**
 * TugEntryShell — the shared structural shell behind bottom-docked entry
 * surfaces: the prompt entry (`TugPromptEntry`) and the Text card's find bar
 * (`TextCardFindBar`).
 *
 * The shell owns the *layout positions* and their surface treatment; every
 * occupant stays host-owned:
 *
 *   - the panel root (entry surface + `:focus-within` tint),
 *   - an optional status row above the input area,
 *   - the input area wrapping the host's editor substrate (`children`),
 *   - an optional accessory row between the input area and the toolbar
 *     (the prompt entry's compose-phase attachment strip),
 *   - the toolbar: a leading-fixed slot, two equal flex spacers flanking a
 *     centred-floating slot ([D05] — the centre lands at the midpoint of the
 *     leading–trailing gap; with no leading occupant, of the full row), and
 *     a fixed-trailing slot. The toolbar is chrome: it carries
 *     `data-tug-focus="refuse"` so a click on a badge, a spacer, or an empty
 *     gap never steals first-responder from the editor.
 *
 * **Hosting rule — both classes on the same element.** Hosts pass their own
 * legacy class per zone (`className`, `inputAreaClassName`,
 * `toolbarClassName`); the shell's `.tug-entry-shell*` classes carry the
 * shared layout/appearance CSS while host-specific rules (and app-test
 * selectors) keep matching on the host classes, which live on the very same
 * elements. The shared CSS custom properties (`--tugx-entry-shell-surface`,
 * `--tugx-entry-shell-editor-rest`, `--tugx-entry-shell-editor-focus`) are
 * defined in `tug-entry-shell.css` and are host-referenceable the same way.
 *
 * The shell is stateless and law-inert: no store reads, no responders, no
 * focus claims. The forwarded ref lands on the root `div` — the prompt entry
 * composes its `rootRef + responderRef` there (the substrate's `data-empty`
 * bridge writes through that root ref per [L22], and the responder-chain
 * registration rides the same element).
 *
 * Laws: [L19] component authoring, [L20] the shell styles only its own box —
 * occupants keep their own tokens.
 *
 * @module components/tugways/tug-entry-shell
 */

import "./tug-entry-shell.css";

import React from "react";

import { cn } from "@/lib/utils";

export interface TugEntryShellProps
  extends React.ComponentPropsWithoutRef<"div"> {
  /** Optional status strip rendered above the input area (host markup). */
  statusRow?: React.ReactNode;
  /**
   * Optional accessory row between the input area and the toolbar (the
   * prompt entry's compose-phase attachment strip). Host markup, rendered
   * as a flow sibling so it grows the entry's height like added text rows.
   */
  accessoryRow?: React.ReactNode;
  /**
   * Leading-fixed toolbar slot. Omitted ⇒ nothing renders there; the
   * flanking spacers then centre the middle slot in the full row width.
   */
  toolbarLeading?: React.ReactNode;
  /** Centred-floating toolbar slot ([D05]). */
  toolbarCenter?: React.ReactNode;
  /** Fixed-trailing toolbar slot (one or more buttons). */
  toolbarTrailing?: React.ReactNode;
  /** Host class for the input-area wrapper (legacy selector hook). */
  inputAreaClassName?: string;
  /**
   * Ref forwarded to the input-area wrapper — the prompt entry authors it
   * as a keyboard-focus-cycle stop.
   */
  inputAreaRef?: React.Ref<HTMLDivElement>;
  /** `tabIndex` for the input-area wrapper (paired with `inputAreaRef`). */
  inputAreaTabIndex?: number;
  /** Host class for the toolbar row (legacy selector hook). */
  toolbarClassName?: string;
  /** The editor substrate. */
  children: React.ReactNode;
}

export const TugEntryShell = React.forwardRef<HTMLDivElement, TugEntryShellProps>(
  function TugEntryShell(
    {
      statusRow,
      accessoryRow,
      toolbarLeading,
      toolbarCenter,
      toolbarTrailing,
      inputAreaClassName,
      inputAreaRef,
      inputAreaTabIndex,
      toolbarClassName,
      className,
      children,
      ...rest
    }: TugEntryShellProps,
    ref,
  ) {
    return (
      <div ref={ref} className={cn("tug-entry-shell", className)} {...rest}>
        {statusRow}
        <div
          className={cn("tug-entry-shell-input-area", inputAreaClassName)}
          ref={inputAreaRef}
          tabIndex={inputAreaTabIndex}
        >
          {children}
        </div>
        {accessoryRow}
        <div
          className={cn("tug-entry-shell-toolbar", toolbarClassName)}
          // The toolbar is chrome: clicking anywhere in it — a badge, a
          // toggle, the spacers, the empty gaps — must not steal
          // first-responder or DOM focus from the editor. `data-tug-focus`
          // is ancestor-matched (`closest`), so marking the row refuses
          // focus for every descendant that doesn't already claim it.
          // [L11 / responder-chain-provider focus-refusal]
          data-tug-focus="refuse"
        >
          {toolbarLeading}
          <div className="tug-entry-shell-toolbar-spacer" aria-hidden="true" />
          <div
            className="tug-entry-shell-indicators"
            data-slot="entry-shell-indicators"
          >
            {toolbarCenter}
          </div>
          <div className="tug-entry-shell-toolbar-spacer" aria-hidden="true" />
          {toolbarTrailing}
        </div>
      </div>
    );
  },
);
