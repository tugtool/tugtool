/**
 * gazette-card.tsx — the **Gazette** card: the app's narration channel, read as
 * a transcript.
 *
 * One scrolling column of posts, oldest at the top, newest at the bottom, in
 * the order they were written. Three voices share it — the Reporter, which
 * digests session work as it happens; the Operator, which answers questions;
 * and the user, who asks them — so every row leads with the glyph of whoever
 * wrote it. The channel is app-wide, not per-session: a post names the session
 * it narrates through its refs rather than by living inside that card.
 *
 * The composer sits in its own grid track below the transcript, so the reading
 * column never moves when the field grows under a long question.
 *
 * The transcript follows the newest post only while the reader is already at
 * the bottom. Scroll up to read history and new arrivals stay below the fold
 * rather than yanking the view — the standard transcript courtesy.
 *
 * Laws: [L02] the channel enters through `useGazette`'s `useSyncExternalStore`;
 * [L06] the follow-the-bottom scroll is a DOM write, never React state; [L12]
 * the card's selection boundary is `CardHost`'s per-card registration, which
 * clamps a drag that escapes the rail — the transcript needs no second entry,
 * and a duplicate under the same card id would replace the host's; [L19]/[L20]
 * module docstring, exported props, `data-slot`, tokens scoped to the card's
 * own slot.
 *
 * @module components/gazette/gazette-card
 */

import React, { useLayoutEffect, useMemo, useRef } from "react";
import { Newspaper, User } from "lucide-react";

import { Operator } from "@/components/tugways/tug-icons";
import {
  TugMessageEditor,
  type TugMessageEditorHandle,
} from "@/components/tugways/tug-message-editor";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useDeckManager } from "@/deck-manager-context";
import { formatContextualStamp } from "@/lib/contextual-stamp";
import {
  gazetteRefIntent,
  runGazetteRefIntent,
} from "@/lib/gazette-ref-action";
import {
  getGazetteStore,
  useGazette,
  type GazettePostEntry,
} from "@/lib/gazette-store";
import type { GazetteAuthor, GazetteRef } from "@/protocol";
import "./gazette-card.css";

/** How close to the bottom still counts as "following", in px. Slack for a
 *  sub-pixel scroll height and for the reader who nudged the wheel once. */
const FOLLOW_SLACK_PX = 24;

/** Props for {@link GazetteContent}. */
export interface GazetteContentProps {
  /** The host card's id — the card's own identity, stamped for tests. */
  cardId: string;
}

/** Human-readable name of each voice, for the glyph's tooltip. */
const AUTHOR_LABEL: Record<GazetteAuthor, string> = {
  reporter: "Reporter",
  operator: "Operator",
  user: "You",
};

function AuthorGlyph({ author }: { author: GazetteAuthor }): React.ReactElement {
  if (author === "operator") return <Operator size={14} aria-hidden />;
  if (author === "user") return <User size={14} aria-hidden />;
  return <Newspaper size={14} aria-hidden />;
}

/**
 * A post's time, in the reader's locale, read against today: a post from today
 * shows its clock alone — the channel is a running feed, and a full stamp on
 * every row would out-weigh the sentence it labels — while an older post names
 * its day (`Yesterday`, `Monday`, `Aug 4`) so it can't be misread as this
 * afternoon's. The full stamp always rides the `title`.
 */
function useTimeFormats(): {
  short: (at: Date) => string;
  full: Intl.DateTimeFormat;
} {
  return useMemo(
    () => ({
      short: (at: Date) => formatContextualStamp(at.getTime()),
      full: new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "medium",
      }),
    }),
    [],
  );
}

/**
 * One ref chip — provenance you can follow. A path opens in the card every
 * other path opens in, a sha opens its diff, and a session raises its card;
 * each reaches an existing verb rather than a mechanism of its own.
 *
 * A ref with nowhere to go (a session whose card is closed) renders disabled
 * with the reason on its tooltip, rather than looking clickable and doing
 * nothing. The label is the target's last segment with the whole of it on the
 * tooltip — the rail is too narrow to spell a path twice.
 */
function RefChip({ chipRef }: { chipRef: GazetteRef }): React.ReactElement {
  const store = useDeckManager();
  const label =
    chipRef.kind === "commit"
      ? chipRef.target.slice(0, 9)
      : (chipRef.target.split("/").pop() ?? chipRef.target);
  const intent = gazetteRefIntent(chipRef);
  const inert = intent.kind === "inert";
  return (
    <TugPushButton
      size="2xs"
      emphasis="outlined"
      role="data"
      className="gazette-ref-chip"
      disabled={inert}
      title={
        inert ? intent.reason : `${chipRef.kind}: ${chipRef.target}`
      }
      onClick={() => runGazetteRefIntent(intent, store)}
    >
      {label}
    </TugPushButton>
  );
}

function GazettePostRow({
  post,
  formats,
}: {
  post: GazettePostEntry;
  formats: ReturnType<typeof useTimeFormats>;
}): React.ReactElement {
  const at = new Date(post.atMs);
  const authorLabel = AUTHOR_LABEL[post.author];
  // The wake reason belongs on the glyph, not in the row: it explains why this
  // post exists at all, which is background to the sentence rather than part
  // of it.
  const glyphTitle =
    post.wakeReason !== null
      ? `${authorLabel} — ${post.wakeReason}`
      : authorLabel;
  return (
    <article className="gazette-post" data-author={post.author}>
      <span className="gazette-post-glyph" title={glyphTitle}>
        <AuthorGlyph author={post.author} />
      </span>
      <div className="gazette-post-main">
        <div className="gazette-post-meta">
          <time dateTime={at.toISOString()} title={formats.full.format(at)}>
            {formats.short(at)}
          </time>
        </div>
        <p className="gazette-post-body">{post.body}</p>
        {post.refs.length > 0 ? (
          <div className="gazette-post-refs">
            {post.refs.map((r) => (
              <RefChip key={`${r.kind}:${r.target}`} chipRef={r} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
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
            <GazettePostRow key={post.key} post={post} formats={formats} />
          ))
        )}
        {pendingRequestId !== null ? (
          // [L26]: keyed exactly as the answer will be, so the placeholder
          // becomes the answer in place rather than being torn down and a new
          // row built where it stood.
          <article
            key={`req:operator:${pendingRequestId}`}
            className="gazette-post"
            data-author="operator"
            data-pending=""
            data-testid="gazette-pending-row"
          >
            <span className="gazette-post-glyph" title={AUTHOR_LABEL.operator}>
              <AuthorGlyph author="operator" />
            </span>
            <div className="gazette-post-main">
              <p className="gazette-post-body" role="status">
                Looking into it…
              </p>
            </div>
          </article>
        ) : null}
      </div>
      <div className="gazette-composer-slot" data-testid="gazette-composer-slot">
        <GazetteComposer pending={pendingRequestId !== null} />
      </div>
    </div>
  );
}

/**
 * Ask the Operator something.
 *
 * The field is a {@link TugMessageEditor} — the CM6 substrate, which brings the
 * clipboard and undo responders with it ([L11]), so Cmd-A/C/X/V/Z work in the
 * rail without this card wiring one of them. The document lives in CM6 rather
 * than in React state ([L02]); `mirrored` tracks only whether the field is
 * empty, which is what the submit button's enablement reads.
 *
 * One question at a time: while an answer is outstanding the field is disabled
 * and says so. The store enforces the same rule — this is the affordance, not
 * the guarantee.
 */
function GazetteComposer({ pending }: { pending: boolean }): React.ReactElement {
  const editorRef = useRef<TugMessageEditorHandle | null>(null);
  const [empty, setEmpty] = React.useState(true);

  const submit = (): void => {
    if (pending || empty) return;
    const store = getGazetteStore();
    if (store === null) return;
    const text = draftRef.current;
    if (store.submitQuestion(text) === null) return;
    // The question comes back off the wire as a post; the field's job is done.
    editorRef.current?.clear();
    draftRef.current = "";
    setEmpty(true);
  };

  // The document mirrored out of CM6, held in a ref rather than state: the
  // submit reads it once, and re-rendering the card on every keystroke would
  // re-render the whole transcript with it.
  const draftRef = useRef("");

  return (
    <div className="gazette-composer" data-slot="gazette-composer">
      <TugMessageEditor
        ref={editorRef}
        className="gazette-composer-field"
        data-testid="gazette-composer-field"
        placeholder={
          pending ? "Waiting for an answer…" : "Ask the Operator…"
        }
        aria-label="Ask the Operator"
        disabled={pending}
        borderless={false}
        lineWrap
        maxRows={6}
        onChange={(text) => {
          draftRef.current = text;
          const isEmpty = text.trim() === "";
          if (isEmpty !== empty) setEmpty(isEmpty);
        }}
        onSubmit={submit}
      />
      <TugPushButton
        size="xs"
        emphasis="filled"
        className="gazette-composer-send"
        data-testid="gazette-composer-send"
        disabled={pending || empty}
        onClick={submit}
      >
        Ask
      </TugPushButton>
    </div>
  );
}
