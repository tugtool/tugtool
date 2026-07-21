/**
 * diff-card.tsx — a standalone Diff card: one {@link TugDiffDocument} popped
 * out of the changeset card (or the session card's diff) into its own resizable
 * card ([P20]).
 *
 * The card carries a {@link DiffDescriptor} (head or range) instead of a file
 * path. It owns a standalone {@link GitDiffStore} (via `createGitDiffStore`),
 * fires the request when its descriptor is set/changed, and renders the shared
 * document with a Refresh control. Loading / error / clean / no-repo states get
 * a centered notice, matching the `/diff` sheet.
 *
 * The descriptor is seeded through `addCard`'s initial-content channel and read
 * back via `useCardStatePreservation`'s restore, so a Maker ▸ Reload restores
 * the same diff. The card registers in `diff-card-open-registry` so `open-diff`
 * reuses an already-open card for the same descriptor rather than duplicating.
 *
 * Laws: [L02] store reads via `useSyncExternalStore`; [L06] appearance via CSS;
 *       [L20] the composed TugDiffDocument keeps its own tokens.
 *
 * @module components/tugways/cards/diff-card
 */

import "./diff-card.css";

import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { registerCard } from "@/card-registry";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugDiffDocument } from "@/components/tugways/tug-diff-document";
import { useCardStatePreservation } from "@/components/tugways/use-card-state-preservation";
import {
  createGitDiffStore,
} from "@/lib/changeset-diff-store";
import {
  diffDescriptorKey,
  type DiffDescriptor,
  type GitDiffSnapshot,
} from "@/lib/git-diff-store";
import {
  registerOpenDiffCard,
  unregisterOpenDiffCard,
} from "@/lib/diff-card-open-registry";
import type { DiffCardSeed } from "@/lib/open-diff-in-card";

const IDLE_SNAPSHOT: GitDiffSnapshot = {
  phase: "idle",
  requestId: null,
  payload: null,
  error: null,
};

const NOOP_SUBSCRIBE = (): (() => void) => () => {};

/** Narrow an unknown restore bag into a `DiffDescriptor`. */
function coerceDescriptor(value: unknown): DiffDescriptor | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = (value as { descriptor?: unknown }).descriptor;
  if (typeof descriptor !== "object" || descriptor === null) return null;
  const kind = (descriptor as { kind?: unknown }).kind;
  if (kind === "head" || kind === "range" || kind === "commit") {
    return descriptor as DiffDescriptor;
  }
  return null;
}

/** The header label for a descriptor's document. */
function descriptorLabel(descriptor: DiffDescriptor): string {
  if (descriptor.kind === "range") {
    return `${descriptor.base}…${descriptor.branch}`;
  }
  if (descriptor.kind === "commit") {
    return `Commit ${descriptor.sha.slice(0, 9)}`;
  }
  return "Uncommitted changes (git diff HEAD)";
}

export function DiffCardContent({ cardId }: { cardId: string }): React.ReactElement {
  const [descriptor, setDescriptor] = useState<DiffDescriptor | null>(null);
  // One store per card, created at mount; owned here, disposed on unmount.
  const [store] = useState(() => createGitDiffStore());

  useEffect(() => () => store?.dispose(), [store]);

  // Fire a fresh request whenever the descriptor lands or changes.
  useEffect(() => {
    if (descriptor !== null && store !== null) store.requestDiff(descriptor);
  }, [descriptor, store]);

  // Seed the descriptor from the card's initial content; persist it so a
  // Maker ▸ Reload restores the same diff.
  useCardStatePreservation<DiffCardSeed | undefined>({
    onSave: () => (descriptor !== null ? { descriptor } : undefined),
    onRestore: (state) => {
      const restored = coerceDescriptor(state);
      if (restored !== null) setDescriptor(restored);
    },
  });

  // Register for descriptor-keyed reuse ([P20]). The ref keeps the key live
  // without re-registering on every descriptor change ([L07]).
  const descriptorRef = useRef(descriptor);
  descriptorRef.current = descriptor;
  useLayoutEffect(() => {
    registerOpenDiffCard(cardId, {
      getKey: () =>
        descriptorRef.current !== null
          ? diffDescriptorKey(descriptorRef.current)
          : null,
      setDescriptor: (next) => setDescriptor(next),
    });
    return () => unregisterOpenDiffCard(cardId);
  }, [cardId]);

  const snapshot = useSyncExternalStore(
    store?.subscribe ?? NOOP_SUBSCRIBE,
    store?.getSnapshot ?? (() => IDLE_SNAPSHOT),
  );
  const refresh = (): void => store?.requestDiff();

  const payload = snapshot.payload;
  const hasFiles = (payload?.files.length ?? 0) > 0;

  let body: React.ReactElement;
  if (store === null) {
    body = (
      <p className="diff-card-notice" role="alert">
        Not connected to tugcast.
      </p>
    );
  } else if (snapshot.phase === "error") {
    body = (
      <p className="diff-card-notice" role="alert">
        {snapshot.error ?? "Couldn't load the diff."}
      </p>
    );
  } else if (snapshot.phase === "loading" || payload === null) {
    body = (
      <p className="diff-card-notice" role="status">
        Loading changes…
      </p>
    );
  } else if (payload.no_repo) {
    body = (
      <div className="diff-card-notice" role="status">
        <TugLabel emphasis="proposal" size="lg" align="center">
          Not a git repository
        </TugLabel>
      </div>
    );
  } else if (!hasFiles) {
    body = (
      <div className="diff-card-notice" role="status">
        <TugLabel emphasis="proposal" size="lg" align="center">
          No changes to show
        </TugLabel>
      </div>
    );
  } else {
    body = (
      <TugDiffDocument
        payload={payload}
        cardId={cardId}
        label={descriptor !== null ? descriptorLabel(descriptor) : undefined}
        headerActions={
          <TugPushButton
            size="sm"
            emphasis="ghost"
            onClick={refresh}
            data-testid="diff-card-refresh"
          >
            Refresh
          </TugPushButton>
        }
      />
    );
  }

  return (
    <div data-slot="diff-card" className="diff-card">
      {body}
    </div>
  );
}

/** Register the Diff card. Call from `main.tsx` before any `addCard("diff")`. */
export function registerDiffCard(): void {
  registerCard({
    componentId: "diff",
    contentFactory: (cardId) => <DiffCardContent cardId={cardId} />,
    defaultMeta: { title: "Diff", icon: "GitCompareArrows", closable: true },
    category: { label: "Files", icon: "GitCompareArrows" },
    sizePolicy: {
      min: { width: 480, height: 320 },
      preferred: { width: 720, height: 640 },
    },
  });
}
