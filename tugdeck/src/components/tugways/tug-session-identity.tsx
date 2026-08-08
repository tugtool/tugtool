/**
 * TugSessionIdentity — one session, rendered at a declared density tier.
 *
 * Takes a resolved identity record and a tier, never a format string. Two
 * registers fall out of the tier rather than being chosen: the `chip` tier is
 * a CITATION — a surface referring to a session from foreign context — and
 * wears the session atom, a rounded pill in the theme's session color. The
 * `line` tier is PRESENCE — a surface that IS the session — and wears the same
 * identity as bare typography, because on a surface that is the thing, an
 * enclosure reads as a link to it somewhere else.
 *
 * Both registers print `<project>/<callsign>` as ONE bold run: one face, one
 * weight, one color, one text node. Two spans opened a flex gap after the
 * slash and let each half truncate on its own; one run can do neither. The
 * mark is the chatbox icon, and the icon gap is one token across both
 * registers and every tier.
 *
 * The chip's hover carries the full identity and the citation as a
 * `TugTooltip`, not a placard: `TugTooltip` is explicitly non-interactive and
 * evaporates on any deliberate action, so a button inside one would be
 * unreachable. Copy is a right-click instead — the idiom every other Tug chip
 * already uses — and it is a REAL atom copy: the citation as plain text, with
 * the `dev.tug.prompt-atoms` sidecar beside it, so a paste back into a Tug
 * surface returns the chip rather than the string. The masthead's telemetry
 * placard carries the same citation on a `TugCopyBadge` for a click path.
 *
 * An unresolvable citation keeps its shape — the reader still needs to know
 * what kind of thing is named — slashes its icon, drops the session color for
 * muted ink, takes a dashed border, and is fully inert. Liveness is never a
 * property of a reference: sessions are never dead, only unfindable.
 *
 * Laws: [L06] appearance via CSS/DOM, never React state; [L16] every
 *       foreground rule declares its surface; [L19] component authoring guide;
 *       [L20] token sovereignty — composed children keep their own tokens.
 * Decisions: [D123] one name, produced in one place.
 */

import "./tug-session-identity.css";

import React from "react";
import { MessageSquare, MessageSquareOff } from "lucide-react";

import { TugTooltip } from "@/components/tugways/tug-tooltip";
import { useCopyableText } from "@/components/tugways/use-copyable-text";
import { writeSessionAtomToClipboard } from "@/lib/session-atom";
import {
  sessionCitation,
  sessionIdentityLine,
  type SessionIdentity,
} from "@/lib/session-identity";
import { cn } from "@/lib/utils";

/** Density tiers this component renders. Row and masthead compose these two. */
export type TugSessionIdentityTier = "chip" | "line";

/** Chip sizes. `2xs` is for dense list ink; `sm` is the default. */
export type TugSessionIdentitySize = "sm" | "2xs";

/** Icon box per size, in px — the mark reads at the same weight as the run. */
const ICON_SIZE: Record<TugSessionIdentitySize, number> = { sm: 12, "2xs": 11 };

/** The line tier's mark, which sits beside body-size text. */
const LINE_ICON_SIZE = 14;

export interface TugSessionIdentityProps
  extends Omit<React.ComponentPropsWithoutRef<"span">, "children" | "onClick"> {
  /** The resolved identity. Never a format string — the tier picks the form. */
  identity: SessionIdentity;
  /**
   * Density tier. `chip` is the citation register (the session atom); `line`
   * is the presence register (bare typography).
   * @selector [data-tier="chip"] | [data-tier="line"]
   * @default "line"
   */
  tier?: TugSessionIdentityTier;
  /**
   * Chip size. Ignored by the line tier, which takes its size from context.
   * @selector [data-size="sm"] | [data-size="2xs"]
   * @default "sm"
   */
  size?: TugSessionIdentitySize;
  /**
   * The citation resolved to nothing — a post or a commit naming a session
   * this ledger has no record of. Chip tier only; makes the atom inert.
   * @selector [data-missing="true"]
   * @default false
   */
  missing?: boolean;
  /**
   * Whether the line tier paints its mark. The masthead's lead line wants it;
   * a row whose phase dot already leads the line does not.
   * @default true
   */
  icon?: boolean;
  /**
   * The caller's intent for a click on a chip — raise the session's card, or
   * open it. Omitted (or `missing`) leaves the atom inert.
   */
  onOpen?: () => void;
}

/**
 * The identity's hover content: what the run cannot show — the description,
 * the lineage, and the citation, which is the flat-text form a reader would
 * paste elsewhere.
 */
function identityTooltip(identity: SessionIdentity): React.ReactNode {
  return (
    <span className="tug-session-identity-tip">
      <span className="tug-session-identity-tip-line">
        {sessionIdentityLine(identity)}
      </span>
      {identity.title !== null ? (
        <span className="tug-session-identity-tip-desc">{identity.title}</span>
      ) : null}
      {identity.lineage.length > 0 ? (
        <span className="tug-session-identity-tip-desc">
          {`forked at ${identity.lineage.join(" → ")}`}
        </span>
      ) : null}
      <span className="tug-session-identity-tip-citation">
        {sessionCitation(identity, { project: true })}
      </span>
    </span>
  );
}

export const TugSessionIdentity = React.forwardRef<
  HTMLSpanElement,
  TugSessionIdentityProps
>(function TugSessionIdentity(
  {
    identity,
    tier = "line",
    size = "sm",
    missing = false,
    icon = true,
    onOpen,
    className,
    ...rest
  },
  ref,
) {
  const isChip = tier === "chip";
  const isMissing = isChip && missing;
  const Glyph = isMissing ? MessageSquareOff : MessageSquare;
  // Inert when the citation resolves to nothing, and when the caller has no
  // intent to offer. Both are the same rendering: no cursor, no handler.
  const interactive = isChip && !isMissing && onOpen !== undefined;
  const run = sessionIdentityLine(identity);

  // Right-click → Copy. A resolving atom writes ALL its flavors: the citation
  // as plain text for anywhere outside Tug, and the atom sidecar beside it so
  // a paste back into a Tug surface returns the chip rather than the string.
  // A missing one has no atom to write, so it copies its text and nothing
  // more.
  const copyHostRef = React.useRef<HTMLElement | null>(null);
  const copy = useCopyableText({
    ref: copyHostRef,
    forwardedRef: ref,
    getText: () => sessionCitation(identity, { project: true }),
    write: isMissing
      ? undefined
      : () => writeSessionAtomToClipboard(identity),
    disabled: !isChip,
    copyMenu: true,
  });

  const body = (
    <span
      ref={copy.composedRef as React.Ref<HTMLSpanElement>}
      className={cn("tug-session-identity", className)}
      data-slot="tug-session-identity"
      data-tier={tier}
      data-size={isChip ? size : undefined}
      data-missing={isMissing ? "true" : undefined}
      data-interactive={interactive ? "true" : undefined}
      onClick={interactive ? onOpen : undefined}
      onContextMenu={isChip ? copy.handleContextMenu : undefined}
      {...rest}
    >
      {isChip || icon ? (
        <Glyph
          size={isChip ? ICON_SIZE[size] : LINE_ICON_SIZE}
          className="tug-session-identity-icon"
          aria-hidden
        />
      ) : null}
      {/* ONE text node. Never a project span beside a tag span. */}
      <span className="tug-session-identity-run">{run}</span>
    </span>
  );

  const tipped = isMissing ? (
    // The tooltip carries the sentence, not the tag — repeating a name the
    // reader can already see says nothing about why it did not resolve.
    <TugTooltip content="Session not found">{body}</TugTooltip>
  ) : (
    <TugTooltip content={identityTooltip(identity)}>{body}</TugTooltip>
  );

  if (!isChip) return tipped;
  return (
    <>
      {tipped}
      {copy.contextMenu}
    </>
  );
});
