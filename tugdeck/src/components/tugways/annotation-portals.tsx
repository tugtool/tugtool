/**
 * `useAnnotationPortals` — every React surface the annotator's marks earn,
 * collected in one pass.
 *
 * The annotator marks runs in DOM it walks; two kinds of mark then want a
 * React component mounted into them — a session run wants the live citation
 * chip, a commit run wants the app's own hover. Both are portal hosts
 * discovered by the same walk, so they are collected together: a surface
 * hands `onAnnotated` to its markdown block once, and renders `portals`
 * once, rather than knowing how many kinds currently earn a component.
 *
 * @module components/tugways/annotation-portals
 */

import React from "react";

import { useAnnotationScope } from "@/components/tugways/annotation-scope";
import { useCommitTipPortals } from "@/components/tugways/commit-tip-portals";
import { useSessionCitationPortals } from "@/components/tugways/session-citation-portals";
import type { AnnotationContext } from "@/lib/annotator/types";

/**
 * The `onAnnotated` callback to hand a markdown block, and the portals to
 * render.
 *
 * A commit tip has to ask what its sha resolved to, so the hook needs the
 * surface's {@link AnnotationContext}. Pass it when the surface threads one
 * as a prop (the Session transcript); omit it and the hook reads the
 * {@link AnnotationScope} the row already mounts, which is how the Gazette
 * hands its context to the markdown block too.
 */
export function useAnnotationPortals(
  annotation?: AnnotationContext | undefined,
): {
  onAnnotated: (container: HTMLElement) => void;
  portals: React.ReactNode;
} {
  const scoped = useAnnotationScope();
  const sessions = useSessionCitationPortals();
  const commits = useCommitTipPortals((annotation ?? scoped)?.resolveCommit);

  const sessionsAnnotated = sessions.onAnnotated;
  const commitsAnnotated = commits.onAnnotated;
  const onAnnotated = React.useCallback(
    (container: HTMLElement): void => {
      sessionsAnnotated(container);
      commitsAnnotated(container);
    },
    [sessionsAnnotated, commitsAnnotated],
  );

  return {
    onAnnotated,
    portals: (
      <>
        {sessions.portals}
        {commits.portals}
      </>
    ),
  };
}
