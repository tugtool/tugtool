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
 * markdown, rendered by the transcript's own {@link TugMarkdownBlock}; ⌘C and
 * the right-click menu work per row through the shared transcript cell wiring
 * and reconstruct markdown from the rendered DOM.
 *
 * **The prose is annotated, not matched.** A post body goes through the
 * markdown pipeline, whose enhancer chain runs the app's own content
 * annotator over every block: it scans the text and marks every path and
 * every sha it finds, against resolvers pointed at that post's own
 * `projectDir`. So a file named in a sentence is clickable because it is in
 * the sentence, and a backticked one is clickable because it is backticked.
 * The refs the model listed alongside its prose are a SEPARATE list, written
 * independently and overlapping only by accident; they are used for one
 * thing, the trailing provenance strip, and only for the entries the prose
 * never named ({@link unmentionedRefs}).
 *
 * That split is the correction to what this did before: a bespoke matcher
 * placed atoms by looking for the ref list's targets inside the body, so a
 * mention the model had not also listed stayed dead text while an unrelated
 * listed ref was appended as a chip — the prose and the atoms describing
 * two different things. The annotator has no such blind spot.
 *
 * A trailing ref is the app's own {@link TugAtomRef} — the read-only atom
 * skin, glyph plus a name — resolved through {@link resolveGazetteRef} and
 * wrapped in the full annotation payload so the registry's click and context
 * menu are its gesture; an unconfirmed ref is inert with the reason on its
 * tooltip. A commit ref names itself — `Commit <8ch>` — because unlike an
 * inline mention it has no sentence around it, and its hover carries the
 * commit's subject, author and files.
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
import { ArrowUp, Check, Folder } from "lucide-react";

import { BlockCopyButton } from "@/components/tugways/body-kinds/affordances/block-copy-button";
import { formatDurationMs } from "@/components/tugways/cards/session-card-telemetry-renderers";
import {
  formatTranscriptTimestamp,
  useTranscriptCellMenu,
  type CopyMarkdownResolver,
} from "@/components/tugways/cards/transcript-host-helpers";
import { TugBadge } from "@/components/tugways/tug-badge";
import { TugEntryShell } from "@/components/tugways/tug-entry-shell";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";
import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugAtomRef } from "@/components/tugways/tug-atom-ref";
import { TugSessionCitation } from "@/components/tugways/tug-session-identity";
import {
  TugTextEditor,
  type TugTextEditorDelegate,
} from "@/components/tugways/tug-text-editor";
import {
  TugTranscriptEntry,
  type Participant,
} from "@/components/tugways/tug-transcript-entry";
import { AnnotationScope } from "@/components/tugways/annotation-scope";
import { useAnnotationPortals } from "@/components/tugways/annotation-portals";
import { ANNOTATION_CLASS, type AnnotationContext } from "@/lib/annotator/types";
import { annotationFromEvent } from "@/lib/annotator/annotation-element";
import {
  commitResolverFor,
  NO_COMMIT_VERDICT,
} from "@/lib/annotator/commit-resolution";
import { commitTip } from "@/components/tugways/entity-tips";
import { TugTooltip } from "@/components/tugways/tug-tooltip";
import { fileNameResolverFor } from "@/lib/annotator/file-name-resolution";
import { annotationEntryFor } from "@/lib/annotator/registry";
import { pathResolutionStore } from "@/lib/annotator/path-resolution";
import { dataAttributesForPayload } from "@/lib/annotator/payloads";
import { makeReferenceResolver } from "@/lib/annotator/resolve-reference";
import { resolveSessionRef } from "@/lib/annotator/session-resolution";
import { VerdictBatcher } from "@/lib/annotator/verdict-batching";
import { sessionCitationStore } from "@/lib/session-citation-store";
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
import { unmentionedRefs } from "@/lib/gazette-body-segments";
import {
  resolveGazetteRef,
  type GazetteRefResolution,
  type GazetteRefRoot,
} from "@/lib/gazette-ref-resolve";
import {
  getGazetteStore,
  useGazette,
  LOAD_OLDER_PX,
  type GazettePostEntry,
} from "@/lib/gazette-store";
import { selectionToTranscriptMarkdown } from "@/lib/markdown/serialize-selection";
import { buildSlashCommandLine } from "@/lib/slash-commands";
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
      // A commit's hover is the entity tip, mounted by {@link RefAtom} — the
      // same bubble the transcript shows for the same sha. Everything else is
      // named by its label already, so the target is all its hover adds.
      ...(resolution.facts === undefined
        ? { title: `${ref.kind}: ${ref.target}` }
        : {}),
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
 * A post's `refs` is a **placed array**, so every entry in it is an atom, and
 * an atom has two skins. This row is read-only ink — nothing here can be
 * selected, deleted or dragged where it sits — so it wears the read-only
 * skin, {@link TugAtomRef}: glyph plus a name, no box. The box is the
 * *editable* skin's and means "manipulable in place", which is why the same
 * value still arrives boxed in a composer. The row was never the defect; the
 * prose beside it was, for looking like nothing. See
 * `tuglaws/entity-presentation.md`.
 *
 * The skin renders **presentationally** here: the wrapper span below already
 * carries the full annotation contract and the pending/unresolvable tooltip
 * states, so a skin that also stamped its own would duplicate the contract
 * and nest a mark inside a mark. The affordance still arrives for free —
 * `tug-atom-ref.css` keys cursor and hover off an annotated wrapper, and
 * {@link annotationProps} stamps one only for an `actionable` resolution, so
 * a pending or unresolvable ref renders inert with its reason on the tooltip
 * and no prop had to be threaded to say so.
 *
 * A session — not a file-shaped thing at all — renders as the live
 * {@link TugSessionCitation}, exactly as a session atom does in a transcript
 * body: the dot is information no other form carries.
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
  const isDir =
    resolution.state === "actionable" &&
    resolution.payload.kind === "directory";
  // The label is the skin's own: a basename for a file, `Commit <8>` for a
  // commit. An atom stands with no sentence around it, so a bare hash names
  // nothing a reader can use and the word belongs in the label — which is
  // also the spelling copy already uses, so selection and menu agree.
  const skin = (
    <TugAtomRef
      entity={
        chipRef.kind === "commit"
          ? { kind: "commit", sha: chipRef.target }
          : { kind: "file", path: chipRef.target, annotate: false }
      }
      // The glyph families are the atom vocabulary's own: a commit is a point
      // on a line, a folder a folder, everything else a file.
      icon={isDir ? <Folder /> : undefined}
    />
  );
  const marked = (
    // No `data-tugx-wrapped` — that mark is for a run the annotator split
    // out of prose, whose affordance has to be painted onto the text. An atom
    // has its own shape and its own hover, exactly as in a transcript body.
    <span {...annotationProps(chipRef, resolution)}>{skin}</span>
  );
  // A confirmed commit describes itself in the app's own bubble, not the
  // OS's — the same tip the transcript shows for the same sha.
  if (resolution.state !== "actionable" || resolution.facts === undefined) {
    return marked;
  }
  return (
    <TugTooltip
      variant="entity"
      align="start"
      content={commitTip({
        sha: chipRef.target,
        subject: resolution.facts.subject,
        author: resolution.facts.author,
        date: resolution.facts.date,
        files: resolution.facts.files,
      })}
    >
      {marked}
    </TugTooltip>
  );
}

/**
 * The annotator's inputs for one post, bound to that post's OWN repository.
 *
 * The Session transcript's {@link useAnnotationContext} reads its project
 * from the card's session binding, which the Gazette has none of: the card
 * is app-wide and each post narrates a different session. So the root is the
 * post's, acquired from its `projectDir`, and every post gets a context
 * pointing at the repo its prose was written about — which is what lets a
 * post from a closed session, read days later, still resolve.
 *
 * No command catalog: with no live session there is no authoritative list,
 * and an unconfirmable command stays plain text, which is the right answer
 * rather than a missing one.
 */
function useGazetteAnnotation(root: GazetteRefRoot | null): AnnotationContext {
  const projectDir = root?.projectDir ?? null;
  const workspaceKey = root?.workspaceKey ?? null;
  const names = fileNameResolverFor(projectDir, workspaceKey);
  const commits = commitResolverFor(projectDir, workspaceKey);
  const resolvePath = useMemo(
    () =>
      makeReferenceResolver({
        paths: pathResolutionStore,
        names,
        // Relative paths in the prose are relative to the narrated session's
        // project, the same root its refs were spelled under.
        cwd: projectDir,
      }),
    [names, projectDir],
  );
  const resolveCommit = useMemo(
    () => (sha: string) => commits?.lookup(sha) ?? NO_COMMIT_VERDICT,
    [commits],
  );
  const subscribe = useMemo(() => {
    // The citation store joins the batcher unconditionally: it is a singleton
    // with no per-project identity, and a session verdict arriving is exactly
    // as much a reason to re-mark as a path verdict is. Without it here, a
    // session run reserved on the first pass would stay reserved — the mark
    // waits on a batch that never comes.
    const sources = [
      pathResolutionStore,
      sessionCitationStore,
      names,
      commits,
    ].filter((source): source is NonNullable<typeof source> => source !== null);
    return new VerdictBatcher(sources).subscribe;
  }, [names, commits]);
  return useMemo(
    () => ({
      isKnownSlashCommand: () => false,
      resolvePath,
      resolveCommit,
      // The Gazette is where sessions are named in prose — a post's whole
      // subject is which session did what — so it scans for them.
      resolveSession: resolveSessionRef,
      commitRoot: projectDir,
      subscribe,
    }),
    // `resolveSessionRef` is a module function, not a closure over anything
    // here — the citation store is a singleton keyed by callsign, and a
    // session's identity is app-wide rather than per-post.
    [resolvePath, resolveCommit, projectDir, subscribe],
  );
}

/**
 * A post body, rendered as markdown and annotated by the app's own content
 * annotator.
 *
 * The body is markdown — the Session transcript's markdown, through the
 * transcript's own primitive ({@link TugMarkdownBlock} in static
 * `initialText` mode): the same pulldown-cmark parse, the same DOMPurify
 * sanitize, the same enhancer chain. So a backticked name is a code span
 * rather than three literal characters, a bare URL is an anchor, and a
 * fence is a fence.
 *
 * The annotation comes with it. `renderIncremental`'s enhancer chain runs
 * `annotateContent` over every block it builds, so paths and shas are found
 * by scanning the prose and marked where each resolver confirms them: a file
 * that stats, a commit git can show. A mention is clickable because it is IN
 * the sentence, not because the model also listed it — the difference from
 * the bespoke matcher this replaced, which could only ever find targets the
 * ref list already named. Inline `<code>` gets the same treatment through
 * `classifyInlineCode`, which is what makes a backticked path clickable by
 * being backticked.
 *
 * The block reads its {@link AnnotationContext} off the {@link AnnotationScope}
 * the row already mounts — no prop to thread. Static mode is correct: a post
 * never changes after it is written, and the pending→answer swap is a React
 * key change ([L26]) that remounts the block outright.
 *
 * Nothing here places anything: the marks land in the prose where the prose
 * put them. The click and the context menu are serviced by the transcript
 * root's delegated listener, reading the same dataset every annotated
 * element in the app carries.
 */
function GazettePostBody({
  post,
  bodyRef,
}: {
  post: GazettePostEntry;
  bodyRef?: React.MutableRefObject<HTMLElement | null>;
}): React.ReactElement {
  // A session named in the prose becomes the live citation chip, and a
  // confirmed sha gets the app's own commit hover — both portaled into the
  // runs the annotator marked. Driven by the block's own `onAnnotated`, so
  // collection cannot run before the pass that creates the spans ([P06]).
  const { onAnnotated, portals } = useAnnotationPortals();
  return (
    <div
      className="gazette-post-body"
      ref={(el) => {
        if (bodyRef !== undefined) bodyRef.current = el;
      }}
    >
      <TugMarkdownBlock
        key={post.key}
        initialText={post.body}
        onAnnotated={onAnnotated}
      />
      {portals}
    </div>
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
  // transcript's rows use, resolver included. A selection across rendered
  // bold or code has to come back as the markdown that produced it, which
  // means reconstructing it from the DOM: `selectionToTranscriptMarkdown`
  // is the transcript's own walk, and the hook writes both clipboard
  // flavors off it ([P03]/[P05] in `transcript-host-helpers.ts`).
  const resolveCopyMarkdown = useCallback<CopyMarkdownResolver>(
    (bodyEl, selection) => selectionToTranscriptMarkdown(selection, bodyEl),
    [],
  );
  const { ResponderScope, cellProps, bodyRef, menu } = useTranscriptCellMenu({
    resolveCopyMarkdown,
  });
  // The wake reason explains why this post exists at all — background to the
  // sentence, so it rides the identifier's tooltip rather than the row.
  const identifierTitle =
    post.wakeReason !== null
      ? `${authorLabel} — ${post.wakeReason}`
      : undefined;
  const annotation = useGazetteAnnotation(root);
  // A ref the prose already names is already clickable where the reader is
  // reading — the annotator marked it in the sentence — so a chip for it
  // would be the same thing twice. What is left is provenance the sentence
  // never got to. The narrated session's citation rides the header, so its
  // chip is redundant for the same reason.
  const chipRefs = useMemo(
    () =>
      unmentionedRefs(post.body, post.refs).filter(
        (r) => !(r.kind === "session" && r.target === post.sessionId),
      ),
    [post],
  );
  return (
    <ResponderScope>
      <div className="gazette-cell" data-author={post.author} {...cellProps}>
        <AnnotationScope value={annotation}>
        <TugTranscriptEntry
          className="gazette-post"
          participant={AUTHOR_PARTICIPANT[post.author]}
          identifier={<span title={identifierTitle}>{authorLabel}</span>}
          timestamp={
            // A Reporter post carries no stamp: it is narration read in
            // written order, and the clock adds nothing the sequence does not
            // already say. The conversational voices keep theirs, where a
            // question and its answer are placed in time against each other.
            post.author === "reporter" ? undefined : (
              <time dateTime={at.toISOString()} title={formats.full.format(at)}>
                {formats.short(at)}
              </time>
            )
          }
          headerTrailing={
            post.sessionId !== null ? (
              <TugSessionCitation
                citedId={post.sessionId}
                className="gazette-post-session"
              />
            ) : null
          }
          body={<GazettePostBody post={post} bodyRef={bodyRef} />}
          controls={
            <>
              {chipRefs.length > 0 ? (
                // Its OWN row, and ABOVE the Z1B: these atoms are the end of
                // the CONTENT — the rest of what the post rests on, which the
                // prose ran out of room to name — and the Z1B is the row's
                // footer, under everything the post says. Below the footer
                // they read as debris after the end; above it they read as
                // the last thing the post tells you.
                //
                // A row of their own for the reason they are not in the Z1B's
                // flex: sharing it queued the atoms after OK / elapsed / COPY
                // and wrapped them wherever the width ran out, so where a chip
                // landed said nothing about what it was.
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
              <GazettePostZ1B post={post} />
            </>
          }
        />
        </AnnotationScope>
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
  // The transcript's height as of the PREVIOUS committed render, and the key
  // of the post that led it. Written at the end of every layout pass, read at
  // the top of the next: together they say "older rows were prepended, and
  // this much taller", which is exactly what the scroll compensation needs.
  // Deliberately not written from the scroll handler — a prepend fires no
  // scroll event, so a ref written there would hold whatever the last human
  // scroll saw.
  const prevScrollHeightRef = useRef(0);
  const prevFirstKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const firstKey = posts.length > 0 ? posts[0]!.key : null;
    const prepended =
      prevFirstKeyRef.current !== null &&
      firstKey !== null &&
      firstKey !== prevFirstKeyRef.current;
    if (followingRef.current) {
      // [L06]: following the newest post is a scroll write, not React state.
      el.scrollTop = el.scrollHeight;
    } else if (prepended) {
      // Older history arrived above the reader. Push the viewport down by
      // exactly what was inserted, so the line being read stays under the
      // eye. Guarded on `followingRef` because the follow effect above owns
      // `scrollTop` in the other case, and one property cannot have two
      // owners — in practice a reader up in history is never following, so
      // the guard states that invariant rather than adding a condition.
      el.scrollTop += el.scrollHeight - prevScrollHeightRef.current;
    }
    prevScrollHeightRef.current = el.scrollHeight;
    prevFirstKeyRef.current = firstKey;
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
    // Near the top, ask for the page before this one. The store owns every
    // guard — nothing to ask for, nothing to anchor on, a request already
    // out — because this fires many times per scroll gesture.
    if (el.scrollTop < LOAD_OLDER_PX) getGazetteStore()?.loadOlder();
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
