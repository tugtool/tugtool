/**
 * gazette-card.tsx — the **Gazette** card: the app's narration channel, read as
 * a transcript.
 *
 * One scrolling column of posts, oldest at the top, newest at the bottom, in
 * the order they were written. Three voices share it — the Reporter, which
 * digests session work as it happens; the Operator, which answers questions;
 * and the user, who asks them. The channel is app-wide, not per-session: a
 * post names the session it narrates through its refs rather than by living
 * inside that card.
 *
 * The rows are a transcript: each post is a {@link TugTranscriptEntry} wearing
 * the Session card's own attribution line — its icon size, its gutter, its
 * identifier, its stamp, its header surface, overridden nowhere. The narrated
 * session's citation rides the header's trailing edge; copy sits in the Z1B
 * footer under the body, where the Session card puts copy. Post bodies are
 * selectable prose; ⌘C and the right-click menu work per row through the
 * shared transcript cell wiring.
 *
 * A body that mentions one of its own refs — a path by full spelling or
 * basename, a sha at any length — renders that mention as an inline atom;
 * refs the prose does not mention ride the Z1B as {@link TugAtomChip}s — the
 * app's one atom, not a Gazette look-alike. A ref becomes actionable only
 * once the annotator's resolvers confirm it against the post's own
 * `projectDir` ({@link resolveGazetteRef}); a confirmed atom is stamped with
 * the full annotation payload, so the registry's click and context menu are
 * its gesture, and an unconfirmed one is inert with the reason on its
 * tooltip.
 *
 * The composer is the session prompt-entry's core: a {@link TugEntryShell}
 * holding the CM6 {@link TugTextEditor} substrate (with `@` file-atom
 * completion) and the Z5-style submit button in the toolbar's trailing slot.
 * No Z2 status bar, no Z4A route picker, no Z4B indicators — just the field
 * and the button.
 *
 * Laws: [L02] the channel enters through `useGazette`'s
 * `useSyncExternalStore`; [L06] the follow-the-bottom scroll and the
 * composer's `data-empty` bridge are DOM writes, never React state; [L12] the
 * card's selection boundary is `CardHost`'s per-card registration — the
 * transcript needs no second entry; [L19]/[L20] module docstring, exported
 * props, `data-slot`, tokens scoped to the card's own slot.
 *
 * @module components/gazette/gazette-card
 */

import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { EditorView } from "@codemirror/view";
import { ArrowUp, Check } from "lucide-react";

import { BlockCopyButton } from "@/components/tugways/body-kinds/affordances/block-copy-button";
import { formatDurationMs } from "@/components/tugways/cards/session-card-telemetry-renderers";
import {
  formatTranscriptTimestamp,
  useTranscriptCellMenu,
} from "@/components/tugways/cards/transcript-host-helpers";
import { TugBadge } from "@/components/tugways/tug-badge";
import { TugEntryShell } from "@/components/tugways/tug-entry-shell";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugSessionCitation } from "@/components/tugways/tug-session-identity";
import {
  TugTextEditor,
  type TugTextEditorDelegate,
} from "@/components/tugways/tug-text-editor";
import {
  TugTranscriptEntry,
  type Participant,
} from "@/components/tugways/tug-transcript-entry";
import { ANNOTATION_CLASS } from "@/lib/annotator/types";
import { annotationFromEvent } from "@/lib/annotator/annotation-element";
import { commitResolverFor } from "@/lib/annotator/commit-resolution";
import { fileNameResolverFor } from "@/lib/annotator/file-name-resolution";
import { annotationEntryFor } from "@/lib/annotator/registry";
import { pathResolutionStore } from "@/lib/annotator/path-resolution";
import { dataAttributesForPayload } from "@/lib/annotator/payloads";
import { endStateBadgeFor } from "@/lib/code-session-store/end-state";
import {
  acquireWorkspace,
  getWorkspace,
  subscribeWorkspaces,
} from "@/lib/default-workspace-store";
import { EditorSettingsStore } from "@/lib/editor-settings-store";
import { FeedStore } from "@/lib/feed-store";
import { FileTreeStore } from "@/lib/filetree-store";
import { getConnection } from "@/lib/connection-singleton";
import {
  inlineRefTargets,
  segmentGazetteBody,
} from "@/lib/gazette-body-segments";
import {
  resolveGazetteRef,
  type GazetteRefResolution,
  type GazetteRefRoot,
} from "@/lib/gazette-ref-resolve";
import {
  getGazetteStore,
  useGazette,
  type GazettePostEntry,
} from "@/lib/gazette-store";
import { buildSlashCommandLine } from "@/lib/slash-commands";
import { TugAtomChip } from "@/lib/tug-atom-chip";
import type { CompletionProvider } from "@/lib/tug-text-types";
import { FeedId, type GazetteAuthor, type GazetteRef } from "@/protocol";
import "./gazette-card.css";

/** How close to the bottom still counts as "following", in px. Slack for a
 *  sub-pixel scroll height and for the reader who nudged the wheel once. */
const FOLLOW_SLACK_PX = 24;

/**
 * The card's focus group — one group for every stop the card offers, walked
 * in the order the eye reads them. The composer's two controls (field, then
 * submit) are the stops; the transcript's posts are not stops yet.
 */
const GAZETTE_FOCUS_GROUP = "gazette-card";

/** Props for {@link GazetteContent}. */
export interface GazetteContentProps {
  /** The host card's id — the card's own identity, stamped for tests. */
  cardId: string;
}

/** Human-readable name of each voice — the row's identifier. */
const AUTHOR_LABEL: Record<GazetteAuthor, string> = {
  reporter: "Reporter",
  operator: "Operator",
  user: "You",
};

/** The transcript participant each Gazette voice renders as. */
const AUTHOR_PARTICIPANT: Record<GazetteAuthor, Participant> = {
  reporter: "reporter",
  operator: "operator",
  user: "user",
};

/**
 * A post's time, in the reader's locale — {@link formatTranscriptTimestamp},
 * the Session transcript's own stamp, down to the seconds and the U+2236
 * separator. A post from today shows its clock alone, an older post names its
 * day, which matters more here than there: the Gazette spans days. The full
 * stamp always rides the `title`.
 */
function useTimeFormats(): {
  short: (at: Date) => string;
  full: Intl.DateTimeFormat;
} {
  return useMemo(
    () => ({
      short: (at: Date) => formatTranscriptTimestamp(at.getTime()),
      full: new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "medium",
      }),
    }),
    [],
  );
}

/**
 * The wrapper attributes a resolved ref's atom wears — the annotation
 * contract, FULLY stamped: kind plus the payload's whole dataset
 * ({@link dataAttributesForPayload}), which is what lets the delegated
 * click layer and the row's context menu read a real payload back off the
 * element. A kind attribute alone is a half-stamped annotation, and the
 * reader treats those as misses — the bug this stamping replaced.
 */
function annotationProps(
  ref: GazetteRef,
  resolution: GazetteRefResolution,
): Record<string, unknown> {
  const marks = {
    "data-gazette-ref-kind": ref.kind,
    "data-gazette-ref-target": ref.target,
  };
  if (resolution.state === "actionable") {
    return {
      ...marks,
      className: ANNOTATION_CLASS,
      "data-tug-annotation": resolution.payload.kind,
      ...dataAttributesForPayload(resolution.payload),
      // Opening a card must not move DOM focus with the press.
      "data-tug-focus": "refuse",
      "data-no-activate": "",
      title: `${ref.kind}: ${ref.target}`,
    };
  }
  return {
    ...marks,
    title:
      resolution.state === "pending"
        ? `${ref.kind}: ${ref.target} — checking…`
        : `${ref.kind}: ${ref.target} — ${resolution.reason}`,
  };
}

/**
 * One trailing ref atom — provenance the prose did not spell out.
 *
 * It is the SAME atom every other surface paints: {@link TugAtomChip}, the
 * baked SVG chip the transcript, the composer and the tool-call headers all
 * use, wrapped in the annotation contract so the card's delegated layer gives
 * it its gesture — but only once the resolvers confirm the target
 * ({@link resolveGazetteRef}): a path that stats, a sha git can show. A
 * session — which is not a file-shaped thing at all — renders as the live
 * {@link TugSessionCitation}, exactly as a session atom does in a transcript
 * body. A ref that cannot be confirmed wears no annotation and carries the
 * reason on its tooltip.
 */
function RefAtom({
  chipRef,
  root,
}: {
  chipRef: GazetteRef;
  root: GazetteRefRoot | null;
}): React.ReactElement {
  // A session ref is a CITATION, and it renders as one: the session atom, the
  // callsign, the same chip every foreign surface shows. The chip owns the
  // whole gesture, including whether to offer it.
  if (chipRef.kind === "session") {
    return <TugSessionCitation citedId={chipRef.target} />;
  }
  const resolution = resolveGazetteRef(chipRef, root);
  const label =
    chipRef.kind === "commit"
      ? chipRef.target.slice(0, 8)
      : (chipRef.target.split("/").pop() ?? chipRef.target);
  const isDir =
    resolution.state === "actionable" &&
    resolution.payload.kind === "directory";
  const chip = (
    <TugAtomChip
      className="tug-atom-chip"
      // The chip's icon families are the atom vocabulary's own: a commit is
      // a point on a line, a folder a folder, everything else a file.
      type={chipRef.kind === "commit" ? "commit" : isDir ? "directory" : "file"}
      label={label}
      value={chipRef.target}
    />
  );
  return (
    // No `data-tugx-wrapped` — that mark is for a run the annotator split
    // out of prose, whose affordance has to be painted onto the text. A chip
    // has its own shape and its own hover, exactly as in a transcript body.
    <span {...annotationProps(chipRef, resolution)}>{chip}</span>
  );
}

/**
 * A post body with its ref mentions rendered as inline atoms. Plain runs stay
 * plain (and selectable); a run that mentions a session ref mounts the live
 * {@link TugSessionCitation}; a run that spells a resolved commit becomes the
 * commit atom in place, showing its 8-character prefix; and a file-shaped
 * mention becomes an annotated span wearing the annotator's
 * `data-tugx-wrapped` contract — resting-plain, hover reveals the affordance,
 * exactly as detected entities read in the Session transcript. A mention
 * whose ref has not been confirmed stays plain prose: text promises nothing,
 * so it never has to break a promise. The click is serviced by the
 * transcript root's delegated listener, not per-span handlers.
 */
function GazettePostBody({
  post,
  root,
  bodyRef,
}: {
  post: GazettePostEntry;
  root: GazetteRefRoot | null;
  bodyRef?: React.MutableRefObject<HTMLElement | null>;
}): React.ReactElement {
  const segments = useMemo(
    () => segmentGazetteBody(post.body, post.refs),
    [post],
  );
  return (
    <p
      className="gazette-post-body"
      ref={(el) => {
        if (bodyRef !== undefined) bodyRef.current = el;
      }}
    >
      {segments.map((seg, i) => {
        if (seg.ref === null) {
          return <React.Fragment key={i}>{seg.text}</React.Fragment>;
        }
        if (seg.ref.kind === "session") {
          return (
            <TugSessionCitation
              key={i}
              citedId={seg.ref.target}
              className="gazette-body-atom"
            />
          );
        }
        const resolution = resolveGazetteRef(seg.ref, root);
        if (resolution.state !== "actionable") {
          return <React.Fragment key={i}>{seg.text}</React.Fragment>;
        }
        if (seg.ref.kind === "commit") {
          // The mention becomes the atom itself: an 8-character prefix chip
          // standing where the prose spelled the sha, however long it spelled
          // it. The full sha rides the value, the tooltip, and every copy
          // path through the stamped payload.
          return (
            <span
              key={i}
              {...annotationProps(seg.ref, resolution)}
              className={`${ANNOTATION_CLASS} gazette-body-atom`}
            >
              <TugAtomChip
                className="tug-atom-chip"
                type="commit"
                label={seg.ref.target.slice(0, 8)}
                value={seg.ref.target}
              />
            </span>
          );
        }
        return (
          <span
            key={i}
            data-tugx-wrapped=""
            {...annotationProps(seg.ref, resolution)}
            className={`${ANNOTATION_CLASS} gazette-body-atom`}
          >
            {seg.text}
          </span>
        );
      })}
    </p>
  );
}

/**
 * The Gazette's Z1B — the end-state row under a post's body, built from the
 * Session card's own parts at the Session card's own sizes: the `OK` badge
 * (`endStateBadgeFor`, so the word and the role are the transcript's, not a
 * second vocabulary), the `•` separators, an elapsed reading where there is
 * one, and the text+icon COPY.
 *
 * A post is `complete` by construction — it exists because it was written, so
 * there is no interrupted or errored post to report. Elapsed is the post's
 * own `elapsedMs`, clocked by tugcast around the agent turn that wrote it, the
 * way a session turn's time is that turn's. A user's question was typed rather
 * than run, so it carries none and its row reads `[OK] • [COPY]` — exactly as
 * the Session transcript's user half does.
 */
function GazettePostZ1B({
  post,
  children,
}: {
  post: GazettePostEntry;
  children?: React.ReactNode;
}): React.ReactElement {
  const badge = endStateBadgeFor("complete");
  const elapsedMs = post.elapsedMs;
  return (
    <div className="gazette-post-z1b" data-slot="gazette-post-z1b">
      <TugBadge
        size="md"
        emphasis="ghost"
        role={badge.role}
        icon={<Check size={14} aria-hidden="true" />}
        iconGap={5}
      >
        {badge.text}
      </TugBadge>
      {elapsedMs !== null ? (
        <>
          <TugLabel size="xs" emphasis="calm" aria-hidden>
            •
          </TugLabel>
          <TugLabel size="xs">{formatDurationMs(elapsedMs)}</TugLabel>
        </>
      ) : null}
      <TugLabel
        size="xs"
        emphasis="calm"
        aria-hidden
        className="gazette-post-z1b-separator"
      >
        •
      </TugLabel>
      {/* The wrapper is the Session Z1B's: it cancels the button's intrinsic
          padding so COPY sits at the row's own gap from the `•` rather than
          a gap plus a button's worth of air. */}
      <span className="gazette-post-z1b-copy">
        <BlockCopyButton
          size="xs"
          getText={() => post.body}
          aria-label="Copy post"
          data-slot="gazette-post-copy"
        />
      </span>
      {children}
    </div>
  );
}

/**
 * The workspace roots the visible posts resolve their refs under, plus the
 * re-render tick their verdicts arrive on.
 *
 * Each distinct `projectDir` gets a browse hold ({@link acquireWorkspace} —
 * refcount-free, cached for the app's life, the Open Quickly shape), and the
 * returned lookup answers with the acquired `{workspaceKey, projectDir}`
 * pair once the hold lands. [L02]: readiness and every resolver verdict
 * enter React through one `useSyncExternalStore` whose snapshot is the sum
 * of the stores' monotonic versions — a probe's answer bumps a version,
 * the sum moves, the waiting atoms re-render.
 */
function useGazetteRefRoots(
  posts: readonly GazettePostEntry[],
): (projectDir: string | null) => GazetteRefRoot | null {
  const dirs = useMemo(() => {
    const set = new Set<string>();
    for (const post of posts) {
      if (post.projectDir !== null && post.refs.length > 0) {
        set.add(post.projectDir);
      }
    }
    return Array.from(set).sort();
  }, [posts]);
  const dirsKey = dirs.join("\n");

  // [L03] — holds must be requested before the lookups that wait on them.
  useLayoutEffect(() => {
    for (const dir of dirs) acquireWorkspace(dir);
    // dirsKey IS dirs, serialized for dependency identity.
  }, [dirsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Which dirs have landed matters to the subscription itself: a workspace
  // arriving mints that project's resolvers, and the subscription has to
  // reach them — so readiness re-keys the subscribe and the store swap
  // resubscribes.
  const readyKey = dirs
    .filter((dir) => getWorkspace(dir) !== null)
    .join("\n");
  const subscribe = useCallback(
    (listener: () => void): (() => void) => {
      const unsubs = [
        subscribeWorkspaces(listener),
        pathResolutionStore.subscribe(listener),
      ];
      for (const dir of dirs) {
        const ws = getWorkspace(dir);
        if (ws === null) continue;
        const names = fileNameResolverFor(ws.projectDir, ws.workspaceKey);
        if (names !== null) unsubs.push(names.subscribe(listener));
        const commits = commitResolverFor(ws.projectDir, ws.workspaceKey);
        if (commits !== null) unsubs.push(commits.subscribe(listener));
      }
      return () => {
        for (const unsub of unsubs) unsub();
      };
    },
    // Both keys are the arrays they serialize, which is the point: identity
    // for the hook, content for the closure.
    [dirsKey, readyKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const getSnapshot = useCallback((): number => {
    let sum = pathResolutionStore.version();
    for (const dir of dirs) {
      const ws = getWorkspace(dir);
      if (ws === null) continue;
      sum += 1;
      sum += fileNameResolverFor(ws.projectDir, ws.workspaceKey)?.version() ?? 0;
      sum += commitResolverFor(ws.projectDir, ws.workspaceKey)?.version() ?? 0;
    }
    return sum;
  }, [dirsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useSyncExternalStore(subscribe, getSnapshot);

  return useCallback(
    (projectDir: string | null): GazetteRefRoot | null => {
      if (projectDir === null) return null;
      const ws = getWorkspace(projectDir);
      return ws === null
        ? null
        : { projectDir: ws.projectDir, workspaceKey: ws.workspaceKey };
    },
    [readyKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

function GazettePostRow({
  post,
  root,
  formats,
}: {
  post: GazettePostEntry;
  root: GazetteRefRoot | null;
  formats: ReturnType<typeof useTimeFormats>;
}): React.ReactElement {
  const at = new Date(post.atMs);
  const authorLabel = AUTHOR_LABEL[post.author];
  // Per-row ⌘C / right-click Copy — the same cell wiring the Session
  // transcript's rows use. No markdown resolver: a post is plain prose, so
  // copy is the selection verbatim.
  const { ResponderScope, cellProps, bodyRef, menu } = useTranscriptCellMenu();
  // The wake reason explains why this post exists at all — background to the
  // sentence, so it rides the identifier's tooltip rather than the row.
  const identifierTitle =
    post.wakeReason !== null
      ? `${authorLabel} — ${post.wakeReason}`
      : undefined;
  const inlined = useMemo(
    () => inlineRefTargets(segmentGazetteBody(post.body, post.refs)),
    [post],
  );
  // Refs the prose already carries inline need no chip; the narrated
  // session's citation rides the header, so its chip is redundant too.
  const chipRefs = post.refs.filter(
    (r) =>
      !inlined.has(r.target) &&
      !(r.kind === "session" && r.target === post.sessionId),
  );
  return (
    <ResponderScope>
      <div className="gazette-cell" data-author={post.author} {...cellProps}>
        <TugTranscriptEntry
          className="gazette-post"
          participant={AUTHOR_PARTICIPANT[post.author]}
          identifier={<span title={identifierTitle}>{authorLabel}</span>}
          timestamp={
            <time dateTime={at.toISOString()} title={formats.full.format(at)}>
              {formats.short(at)}
            </time>
          }
          headerTrailing={
            post.sessionId !== null ? (
              <TugSessionCitation
                citedId={post.sessionId}
                className="gazette-post-session"
              />
            ) : null
          }
          body={<GazettePostBody post={post} root={root} bodyRef={bodyRef} />}
          controls={
            <GazettePostZ1B post={post}>
              {chipRefs.length > 0 ? (
                <div className="gazette-post-refs">
                  {chipRefs.map((r) => (
                    <RefAtom
                      key={`${r.kind}:${r.target}`}
                      chipRef={r}
                      root={root}
                    />
                  ))}
                </div>
              ) : null}
            </GazettePostZ1B>
          }
        />
        {menu}
      </div>
    </ResponderScope>
  );
}

/**
 * The Gazette card's content ([L25]: the pane owns geometry and chrome; this
 * owns the surface inside it).
 */
export function GazetteContent({
  cardId,
}: GazetteContentProps): React.ReactElement {
  const { posts, status, pendingRequestId } = useGazette();
  const formats = useTimeFormats();
  const rootFor = useGazetteRefRoots(posts);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Whether the reader is at the bottom, sampled BEFORE the new post is laid
  // out — reading it afterwards would always say "no", since the arriving row
  // is exactly what pushed the bottom away.
  const followingRef = useRef(true);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null || !followingRef.current) return;
    // [L06]: following the newest post is a scroll write, not React state.
    el.scrollTop = el.scrollHeight;
  }, [posts]);

  // Annotation gestures — the Session transcript's own delegated layer,
  // verbatim in shape: one listener on the transcript root, the registry
  // deciding what a click on a given kind does, the mousedown guard keeping
  // an opening press from moving DOM focus. The atoms are FULLY stamped
  // (payload dataset, not just a kind), so `annotationFromEvent` reads a
  // real payload back off whatever element the press lands on. No
  // codeSessionStore in the context: the Gazette has no live session, and a
  // kind that needs one declines on its own. [L03] — live before any click
  // it services.
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (root === null) return;
    const onClick = (event: MouseEvent): void => {
      if (event.button !== 0 || event.metaKey || event.shiftKey) return;
      const hit = annotationFromEvent(event);
      if (hit === null) return;
      if (hit.element instanceof HTMLAnchorElement) return;
      // The tail of a drag-selection over the atom is not a click on it.
      const selection = window.getSelection();
      if (selection !== null && !selection.isCollapsed) return;
      annotationEntryFor(hit.payload.kind)?.primaryClick?.(hit.payload, {
        // The opened card claims activation itself; the rail stays put.
        activateCard: () => {},
      });
    };
    const onMouseDown = (event: MouseEvent): void => {
      if (event.button !== 0 || event.metaKey || event.shiftKey) return;
      const hit = annotationFromEvent(event);
      if (hit === null) return;
      if (hit.element.dataset.noActivate === undefined) return;
      event.preventDefault();
    };
    root.addEventListener("click", onClick);
    root.addEventListener("mousedown", onMouseDown);
    return () => {
      root.removeEventListener("click", onClick);
      root.removeEventListener("mousedown", onMouseDown);
    };
  }, []);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (el === null) return;
    followingRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX;
  };

  return (
    <div
      className="gazette-card"
      data-slot="gazette-card"
      data-testid="gazette-card"
      data-gazette-card-id={cardId}
      // Focusable root so `transferFocusForActivation` → `applyBagFocus` has a
      // target to land the ring on when the card is focused.
      tabIndex={-1}
    >
      <div
        className="gazette-transcript"
        data-testid="gazette-transcript"
        ref={scrollRef}
        onScroll={onScroll}
      >
        {posts.length === 0 ? (
          <div className="gazette-empty" role="status">
            {status === "ready" ? "Nothing reported yet." : "Loading…"}
          </div>
        ) : (
          posts.map((post) => (
            <GazettePostRow
              key={post.key}
              post={post}
              root={rootFor(post.projectDir)}
              formats={formats}
            />
          ))
        )}
        {pendingRequestId !== null ? (
          // [L26]: keyed exactly as the answer will be, so the placeholder
          // becomes the answer in place rather than being torn down and a new
          // row built where it stood.
          <div
            key={`req:operator:${pendingRequestId}`}
            className="gazette-cell"
            data-author="operator"
            data-pending=""
            data-testid="gazette-pending-row"
          >
            <TugTranscriptEntry
              className="gazette-post"
              participant="operator"
              identifier={AUTHOR_LABEL.operator}
              // The transcript's in-flight wave, not a sentence: "working" is
              // said in the Session card's language, the same three bars its
              // own Z1C paints while a turn runs.
              body={
                <div className="gazette-post-pending">
                  <TugProgressIndicator
                    variant="wave"
                    state="running"
                    role="inherit"
                    aria-label="Working…"
                    aria-live="polite"
                    data-testid="gazette-pending-wave"
                  />
                </div>
              }
            />
          </div>
        ) : null}
      </div>
      <div className="gazette-composer-slot" data-testid="gazette-composer-slot">
        <GazetteComposer pending={pendingRequestId !== null} />
      </div>
    </div>
  );
}

/**
 * `@` file completion for the composer, against the bootstrap workspace: the
 * Gazette is app-wide, so it has no per-card project binding; an unrooted
 * FILETREE query falls through to tugcast's bootstrap workspace, which is the
 * right default for a channel that narrates the whole app. Lazy singleton —
 * one feed subscription however many times the card mounts.
 */
let _fileCompletionProvider: CompletionProvider | null = null;
function gazetteFileCompletionProvider(): CompletionProvider {
  if (_fileCompletionProvider !== null) return _fileCompletionProvider;
  const conn = getConnection();
  if (conn === null) return ((_q: string) => []) as CompletionProvider;
  const feedStore = new FeedStore(conn, [FeedId.FILETREE]);
  _fileCompletionProvider = new FileTreeStore(
    feedStore,
    FeedId.FILETREE,
  ).getFileCompletionProvider();
  return _fileCompletionProvider;
}

/**
 * The card's editor settings — the user's font, size, and Return policy, read
 * from the same tugbank domain every Session card's composer reads. A lazy
 * singleton for the reason the completion provider is one: the card is
 * app-wide and single-instance, and one store means one tugbank subscription
 * however many times the card mounts.
 */
let _editorStore: EditorSettingsStore | null = null;
function gazetteEditorStore(): EditorSettingsStore {
  _editorStore ??= new EditorSettingsStore();
  return _editorStore;
}

/**
 * Ask the Operator something — the session prompt-entry's core editing
 * experience, without its session-bound chrome.
 *
 * The shell is {@link TugEntryShell} (the composer/find-bar structural
 * primitive): the CM6 {@link TugTextEditor} substrate as the input area —
 * which brings the clipboard and undo responders with it ([L11]), plus `@`
 * file-atom completion — and the Z5-style submit button alone in the
 * toolbar's trailing slot. Return does here what the user's editor setting
 * says it does in the Session composer — at the shipped `newline` that means
 * Shift+Return submits, and the button says so by wearing the chord ring
 * ([#chord-ring]): dashed while the promise is conditional, solid for exactly
 * as long as Shift is held alone. Atoms flatten to their values on the wire.
 *
 * Emptiness is the `data-empty` DOM bridge on the shell root, written from a
 * substrate update listener and read by CSS to dim the submit — never React
 * state ([L06], the prompt entry's own technique).
 *
 * One question at a time: while an answer is outstanding the field is
 * disabled and says so. The store enforces the same rule — this is the
 * affordance, not the guarantee.
 */
function GazetteComposer({ pending }: { pending: boolean }): React.ReactElement {
  const editorRef = useRef<TugTextEditorDelegate | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  // The user's editor settings — the same store the Session card's composer
  // reads, so Return means here whatever it means there ([L02]).
  const editorStore = gazetteEditorStore();
  const editorSettings = useSyncExternalStore(
    editorStore.subscribe,
    editorStore.getSnapshot,
  );
  // Bind the shell for the editor CSS-variable cascade
  // (`--tug-font-family-editor` / `--tug-font-size-editor` / the line
  // metrics). The card has one editor, so the shell is the right root; the
  // composer's own rule then takes a pixel off the bound size.
  useLayoutEffect(() => {
    const el = shellRef.current;
    if (el === null) return;
    editorStore.bind(el, () => {});
    return () => editorStore.unbind();
  }, [editorStore]);

  // The chord that fires the send button when a plain Return does not
  // ([#chord-ring]). `resolveEnterAction` flips the base action on Shift, so
  // at the shipped `newline` setting it is SHIFT+Return that submits — and the
  // shell's default ring says so by painting dashed until Shift is held alone.
  // `undefined` (the `submit` setting) leaves the ring solid, which is then
  // true. Derived, never spelled by hand, so the ring and the key agree.
  const returnAction = editorSettings.returnKeyAction;
  const submitChord = returnAction === "newline" ? "shift" : undefined;

  // The data-empty bridge, captured at mount (the substrate reads
  // `extensions` once). Any doc change — typing, paste, the programmatic
  // clear after a submit — re-mirrors emptiness onto the shell root.
  const emptyBridge = useMemo(
    () =>
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        shellRef.current?.setAttribute(
          "data-empty",
          String(update.state.doc.length === 0),
        );
      }),
    [],
  );

  const completionProviders = useMemo<Record<string, CompletionProvider>>(
    () => ({ "@": gazetteFileCompletionProvider() }),
    [],
  );

  const submit = (): void => {
    if (pending) return;
    const store = getGazetteStore();
    if (store === null) return;
    const state = editorRef.current?.captureState();
    if (state === undefined) return;
    // Atoms flatten to their values — an `@`-completed path survives as the
    // path the Operator can act on.
    const text = buildSlashCommandLine(
      state.text,
      state.atoms.map((a) => ({
        position: a.position,
        segment: { type: a.type, value: a.value },
      })),
    ).trim();
    if (text === "") return;
    if (store.submitQuestion(text) === null) return;
    // The question comes back off the wire as a post; the field's job is
    // done. `clear` fires the update listener, which resets `data-empty`.
    editorRef.current?.clear();
  };

  return (
    <TugEntryShell
      ref={shellRef}
      className="gazette-composer"
      data-slot="gazette-composer"
      data-testid="gazette-composer"
      data-empty="true"
      toolbarTrailing={
        <TugPushButton
          subtype="icon"
          // `sm` — the Find bar's size, not the Session composer's `lg`. Both
          // are one line of entry in a narrow rail, and a 36px button beside a
          // single-line field reads as a button rail with a field above it.
          size="sm"
          emphasis="filled"
          role="action"
          className="gazette-composer-send"
          data-testid="gazette-composer-send"
          data-tug-entry-default=""
          data-default-chord={submitChord}
          aria-label="Ask the Operator"
          focusGroup={GAZETTE_FOCUS_GROUP}
          focusOrder={1}
          disabled={pending}
          onClick={submit}
          icon={<ArrowUp size={16} strokeWidth={2.5} />}
        />
      }
    >
      <TugTextEditor
        ref={(delegate) => {
          editorRef.current = delegate;
        }}
        className="gazette-composer-field"
        data-testid="gazette-composer-field"
        borderless
        lineWrap
        markdownTextStyling
        maxRows={8}
        preserveState={false}
        returnAction={returnAction}
        numpadEnterAction={editorSettings.numpadEnterAction}
        placeholder={
          pending
            ? "Waiting for an answer…"
            : "Ask Tug about your work, recent or historical"
        }
        aria-label="Ask the Operator"
        focusGroup={GAZETTE_FOCUS_GROUP}
        focusOrder={0}
        disabled={pending}
        completionProviders={completionProviders}
        onSubmit={submit}
        extensions={emptyBridge}
      />
    </TugEntryShell>
  );
}
