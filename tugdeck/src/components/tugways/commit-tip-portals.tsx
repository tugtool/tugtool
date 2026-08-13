/**
 * `useCommitTipPortals` — a confirmed sha in prose gets the app's commit
 * hover, not the OS's.
 *
 * The annotator is a DOM pass: it can mark a run as a commit, and it cannot
 * mount a React component into it. That constraint is why the commit hover
 * was a `title` attribute for as long as it was — a plain string is the only
 * thing you can hand an element you did not render. The cost was that the
 * richest tooltip in the app was the one surface we could not theme, could
 * not delay, could not dismiss with the responder chain, and could not lay
 * out: an OS-drawn box in the system font, light in a dark theme.
 *
 * Portals bridge the two, exactly as {@link useSessionCitationPortals} does
 * for citation chips. The span keeps the words it always showed; what it
 * gains is a {@link TugTooltip} wrapped around them, carrying
 * {@link commitTip} — the same content every other commit surface shows.
 *
 * **Emptying the host is safe here.** `dropStaleWraps` re-checks only the
 * kinds whose truth can change; a commit that resolved once stays resolved,
 * so a commit wrap is never unwrapped underneath us. The recorded text on
 * {@link COMMIT_TEXT_ATTRIBUTE} is therefore for idempotence across passes
 * (a re-walk finds an emptied span and must still know its words), not for
 * the restore path sessions need.
 *
 * Laws:
 *  - [L03] collection runs in the block's layout effect, before paint.
 *  - [L06] nothing here is appearance state — the hosts are IDENTITY (which
 *    element, which sha); how the bubble looks is the tooltip's business.
 *  - [L27] `onAnnotated` is a registration and hands back its release.
 *
 * @module components/tugways/commit-tip-portals
 */

import React from "react";
import { createPortal } from "react-dom";

import { commitTip } from "@/components/tugways/entity-tips";
import { TugTooltip } from "@/components/tugways/tug-tooltip";
import type { CommitFacts } from "@/lib/annotator/commit-resolution";
import type { AnnotationContext } from "@/lib/annotator/types";

/** Every confirmed commit span the annotator has marked in a container. */
const COMMIT_SPANS = '[data-tug-annotation="commit-sha"]';

/**
 * The run's own words, saved before the span is emptied to host the portal.
 * A later pass finds an empty span and would otherwise render nothing.
 */
export const COMMIT_TEXT_ATTRIBUTE = "data-tugx-commit-text";

/** One mounted tip: the emptied span, the sha it names, and its words. */
interface CommitTipMount {
  host: HTMLElement;
  /** The sha as the payload recorded it — what the tip describes. */
  sha: string;
  /** The spelling the prose used, which is what the span shows. */
  text: string;
}

/**
 * Collect the confirmed commit spans in `container` and portal the commit
 * tip onto each.
 *
 * Returns the callback to hand `TugMarkdownBlock` as `onAnnotated`, and the
 * portals to render. The portals are React nodes with no layout of their
 * own — render them anywhere in the consumer's tree; they mount into the
 * spans.
 */
export function useCommitTipPortals(
  /** Undefined on a surface with no annotation context — the spans are then
   *  never marked in the first place, and the hook stands down. */
  resolveCommit: AnnotationContext["resolveCommit"] | undefined,
): {
  onAnnotated: (container: HTMLElement) => void;
  portals: React.ReactNode;
} {
  const [mounts, setMounts] = React.useState<readonly CommitTipMount[]>([]);

  const onAnnotated = React.useCallback((container: HTMLElement): void => {
    const spans = Array.from(
      container.querySelectorAll<HTMLElement>(COMMIT_SPANS),
    );
    const next: CommitTipMount[] = [];
    for (const host of spans) {
      const sha = host.getAttribute("data-sha");
      if (sha === null || sha === "") continue;
      let text = host.getAttribute(COMMIT_TEXT_ATTRIBUTE);
      if (text === null) {
        text = host.textContent ?? "";
        host.setAttribute(COMMIT_TEXT_ATTRIBUTE, text);
        host.textContent = "";
      }
      next.push({ host, sha, text });
    }
    // Rebuild rather than merge, and only publish a change: a pass that finds
    // the same spans it found last time must not re-render every tip, and a
    // span that has left the DOM must not survive in the list.
    setMounts((prev) => (sameMounts(prev, next) ? prev : next));
  }, []);

  const portals = mounts.map(({ host, sha, text }) => {
    const verdict = resolveCommit?.(sha) ?? { state: "unknown" as const };
    const facts: CommitFacts | null =
      verdict.state === "confirmed" ? verdict.facts : null;
    // A span the pass marked but the resolver can no longer describe still
    // shows its words — it just has nothing to say on hover.
    // A plain span, because the tooltip's trigger has to be an element and
    // the mark's own appearance is already on the host it portals into.
    const run = <span>{text}</span>;
    return createPortal(
      facts === null ? (
        run
      ) : (
        <TugTooltip
          variant="entity"
          align="start"
          content={commitTip({
            sha,
            subject: facts.subject,
            author: facts.author,
            date: facts.date,
            files: facts.files,
          })}
        >
          {run}
        </TugTooltip>
      ),
      host,
      `commit-tip:${sha}:${text}`,
    );
  });

  return { onAnnotated, portals };
}

/** Whether two collections name the same hosts, in the same order. */
function sameMounts(
  a: readonly CommitTipMount[],
  b: readonly CommitTipMount[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((mount, i) => mount.host === b[i]!.host && mount.sha === b[i]!.sha);
}
