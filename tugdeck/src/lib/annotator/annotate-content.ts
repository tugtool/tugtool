/**
 * `annotateContent` — the content annotator's DOM pass.
 *
 * Walks a rendered markdown block and marks every actionable entity it
 * finds, so the transcript reads as a hypertext document: URLs and email
 * addresses become real anchors, and inline `<code>` spans that are
 * command lines carry the dataset a click or a right-click acts on.
 *
 * **Why one pass.** Every entity kind faces the same two structural
 * constraints, and meeting them once is the whole point of the library:
 *
 *  1. *Post-sanitize only.* The sanitizer's allowed-attribute list
 *     excludes `data-*` (`lib/markdown/dompurify-instance.ts`), so an
 *     affordance dataset can only be stamped on live DOM, after
 *     `innerHTML` is assigned. Both the static and the streaming render
 *     path therefore call this from the same place
 *     (`buildBlockElement` / `updateBlockElement` in
 *     `render-incremental.ts`), so every rendered block is annotated
 *     identically.
 *  2. *Idempotent and re-runnable.* A streaming delta rewrites the
 *     block's `innerHTML`, and the catalog can arrive after a replay has
 *     already painted, so the pass must be add/remove-correct over
 *     already-annotated DOM: a span that no longer qualifies loses its
 *     marks, and a span that changed families re-marks cleanly.
 *
 * **Two ops, split by what provoked them.** `annotateContent` is the
 * full pass for DOM whose `innerHTML` was just written: it detects bare
 * links, rejoins the text nodes that detection split, and then marks
 * entities. `annotateElement` is the entity pass alone, for re-marking
 * DOM that has *not* changed — a resolver verdict arriving for ink
 * already painted. Re-running link detection and `normalize()` over
 * unchanged DOM is pure waste, so the re-mark path never does.
 *
 * **Verdict waits are recorded on the DOM.** A pass that met a `pending`
 * verdict stamps its container `data-tugx-awaiting`, and a pass that met
 * none clears it. That flag is how per-container invalidation works: when
 * a verdict batch arrives, only containers still awaiting one re-run the
 * pass ({@link containerAwaitsVerdicts}), so an answer about one block
 * never provokes a walk of every block.
 *
 * **Two tiers.** Anchor tagging is state-free and runs for every markdown
 * consumer. Everything else needs live state (the command catalog), which
 * arrives as an {@link AnnotationContext}; a consumer that supplies none
 * gets anchors only. Applying the context's gates *during* the pass
 * rather than in a later effect means a streaming DOM rebuild re-marks
 * atomically — a later pass would be wiped by the next delta.
 *
 * **Whole elements, then runs inside them.** An entity that is already its
 * own element — an inline `<code>` span holding one command line, one path
 * — is marked on the element it has. Everything else is found by scanning
 * text and splitting the run out into a span of its own, which is what
 * reaches the shapes real ink is full of: a filename in the middle of a
 * sentence, a path inside a longer command. Whole-element classification
 * runs first, so a span that is entirely one entity is never also scanned
 * as text.
 *
 * **One gate, every surface.** Detection is permissive by design;
 * {@link AnnotationContext.resolvePath} is the gate, and it is the only
 * one. Nothing becomes a link until a resolver confirms a real file, so
 * prose that merely looks path-shaped costs one cached lookup and stays
 * plain text. Markup does not gate: a path is scanned the same whether it
 * arrived inside backticks or bare in a sentence, and the surface it is
 * painted on gets no vote either. Backticks still decide how the run is
 * *painted* — the code tone is the author's emphasis — but painting and
 * marking are separate channels. See `tuglaws/entity-presentation.md`.
 *
 * **Every refusal is silent.** A path the endpoint probed and found
 * absent, one nobody ever asked about, one still being asked about — all
 * of them leave the text exactly as written, with no mark and no hover.
 *
 * **A pass can do three things to a run, not two: mark it, clear it, or
 * HOLD it.** The hold is a reservation, and it is silent in exactly the way
 * a refusal is — no mark, no hover, the text byte-identical — but it is not
 * a refusal, because the run is also unavailable to every other scan for
 * that pass. It exists for one contention this annotator cannot order its
 * way out of: a `project/callsign` token is shaped exactly like a relative
 * path, and the verdict that tells them apart is asynchronous. Every scan's
 * matches land in one array sorted by offset and overlaps are dropped, so
 * whichever scan claims the run first blocks the other permanently — and
 * deciding before the answer arrives decides wrong whenever the token is
 * also a real directory. Holding the run for one verdict batch costs a
 * moment of plain text and buys a right answer. See `sessionMatch` and
 * `TextRunMatch.reserved`.
 *
 * **Scope guards.** `<a>` subtrees are skipped by linkify itself (no
 * double-wrapping a markdown-authored link); `CODE`/`PRE` subtrees are
 * skipped for links (a URL inside code is content, not a link to
 * follow); `pre > code` is skipped entirely (fenced code is content being
 * shown, not references being made); and already-annotated subtrees are
 * skipped by the text scan, so re-running never nests a mark in a mark.
 *
 * No listener cleanup is needed — annotations are plain DOM marks with no
 * attached listeners. The transcript root's delegated listeners service
 * them, so a block whose `innerHTML` is rewritten simply drops its old
 * marks with its old nodes.
 *
 * Laws: [L06] appearance via CSS/DOM, never React state.
 *
 * @module lib/annotator/annotate-content
 */

// The one place the third-party link-detection library is named. The
// feature vocabulary everywhere else is the annotator's own; see
// `annotateBareLinks`.
import linkifyElement from "linkify-element";
import type { Opts } from "linkifyjs";

import {
  clearAnnotation,
  readAnnotation,
  stampAnnotation,
  stampAnnotationKind,
} from "./annotation-element";
import {
  detectPathReference,
  scanPathReferences,
} from "./detect-path-reference";
import {
  recordContentPass,
  recordElementPass,
} from "./annotate-counters";
import { scanCommitShas } from "./detect-commit-sha";
import { scanSessionRefs } from "./detect-session-ref";
import {
  classifyInlineCode,
  payloadForReference,
  type AnnotationPayload,
} from "./payloads";
import { AUTOLINK_CLASS, type AnnotationContext } from "./types";
import { hasUrlScheme } from "./url-grammar";
import {
  collectTextNodes,
  unwrapMatch,
  wrapMatchesInTextNode,
  WRAPPED_ATTRIBUTE,
  type TextRunMatch,
} from "./wrap-matches";

/**
 * Tag names whose subtrees are left untouched by link detection. `A` is
 * already skipped internally by linkify; listing `CODE`/`PRE` keeps URLs
 * inside code spans and fenced blocks as literal text.
 *
 * `svg` is the same guard {@link collectTextNodes} applies for the same
 * reason, in the vocabulary this library compares in: `linkify-element`
 * matches against `Element.tagName`, which an SVG element reports in its
 * own lowercase spelling, not the uppercased HTML one. An atom chip is an
 * inline `<svg>` whose `<text>` holds a label — a link atom's is a URL —
 * and rewriting a run of it into an HTML `<a>` inside the SVG paints
 * nothing, leaving a chip sized for a label it no longer shows.
 */
const IGNORE_TAGS = ["A", "CODE", "PRE", "svg"];

/**
 * The anchors this produces deliberately carry **no `target`** and no
 * `rel` — they navigate the main frame as an ordinary link click. The
 * macOS host's `WKNavigationDelegate` (`MainWindow.swift`) intercepts
 * `.linkActivated` for any non-internal URL and hands it to `NSWorkspace`
 * to open in the system browser, so the app's own webview never navigates
 * away. Outside the host (browser dev / tests) the same anchors behave as
 * normal links. A `target="_blank"` would instead go through
 * `createWebViewWith`, which is only a safety net.
 */
const LINKIFY_OPTS: Opts = {
  // A `www.foo.com` host with no scheme links as https, not http — only
  // matters for matches that already pass `validate`, i.e. ones that
  // carried a scheme to begin with.
  defaultProtocol: "https",
  className: AUTOLINK_CLASS,
  ignoreTags: IGNORE_TAGS,
  validate: {
    url: hasUrlScheme,
  },
};

/**
 * Sync the annotation on every inline `<code>` in `container` against the
 * current inputs: a span that classifies gets stamped with its kind and
 * payload, a span that no longer qualifies is cleared, and a span that
 * changed kinds sheds the old dataset with the new stamp.
 */
function annotateInlineCode(
  container: HTMLElement,
  context: AnnotationContext,
): void {
  const codes = container.querySelectorAll<HTMLElement>("code");
  for (const code of codes) {
    // Fenced code (`pre > code`) is content, not a command hint.
    if (code.parentElement?.tagName === "PRE") continue;
    const payload = classifyInlineCode(
      code.textContent ?? "",
      context.isKnownSlashCommand,
      context.resolvePath,
    );
    if (payload === null) clearAnnotation(code);
    else stampAnnotation(code, payload);
  }
}

/**
 * Mark every path reference found *within* the container's text — a
 * filename in a sentence, a path inside a command line — by splitting the
 * run out into its own annotated span.
 *
 * This is the pass that carries the annotator past the shapes that happen
 * to be their own element. It runs after whole-element classification, so
 * a `<code>` span that is entirely one path is already marked and its text
 * is skipped rather than marked twice.
 */
function annotatePathsInText(
  container: HTMLElement,
  context: AnnotationContext,
): number {
  const nodes = collectTextNodes(container);
  for (const node of nodes) {
    const text = node.data;
    if (text.trim() === "") continue;
    const matches: TextRunMatch[] = [];
    // Sessions first, and the ORDER IS NOT WHAT SETTLES CONTENTION — the
    // reservation is (see {@link sessionMatch}). Every scan's matches land in
    // one array sorted by `start`, and running first wins only ties at an
    // identical offset, by sort stability. That is an accident, not a
    // mechanism.
    for (const found of scanSessionRefs(text)) {
      const match = sessionMatch(found, context);
      if (match !== null) matches.push(match);
    }
    for (const reference of scanPathReferences(text)) {
      const verdict = context.resolvePath(reference);
      const payload = payloadForReference(reference, verdict);
      if (payload === null) continue;
      matches.push({ start: reference.start, end: reference.end, payload });
    }
    for (const found of scanCommitShas(text)) {
      const payload = payloadForCommit(found.sha, context);
      if (payload === null) continue;
      matches.push({ start: found.start, end: found.end, payload });
    }
    // One text node, two scans: the wrapper takes them in order and drops
    // any that overlaps a run already taken.
    matches.sort((a, b) => a.start - b.start);
    wrapMatchesInTextNode(node, matches);
  }
  return nodes.length;
}

/**
 * What one session candidate contributes to the match list, in three arms —
 * or `null` when this surface does not scan for sessions at all.
 *
 * | verdict | contribution |
 * |---|---|
 * | `pending` | a RESERVATION: the run is held, nothing is marked, and the awaiting flag brings the pass back with an answer |
 * | `confirmed` | the mark, carrying the full session id |
 * | `refuted` | nothing; the run goes back to the prose, and any stale wrap is dropped by {@link dropStaleWraps} |
 *
 * The reservation is the mitigation for the one contention this annotator has
 * that ordering cannot settle: a `project/callsign` token is shaped exactly
 * like a relative path, and the answer that tells them apart is asynchronous.
 * Whichever scan claims the run first blocks the other for good — overlaps are
 * dropped, and `dropStaleWraps` keeps a path wrap that still resolves — so
 * deciding before the verdict lands decides wrong every time the token is also
 * a real directory. Holding the run for one verdict batch (about 100ms, the
 * `VerdictBatcher` window) costs a moment of plain text and buys a right
 * answer.
 */
function sessionMatch(
  found: { target: string; start: number; end: number },
  context: AnnotationContext,
): TextRunMatch | null {
  const resolve = context.resolveSession;
  if (resolve === undefined) return null;
  const verdict = resolve(found.target);
  if (verdict.state === "refuted") return null;
  if (verdict.state === "pending") {
    return {
      start: found.start,
      end: found.end,
      // Never read for a reserved entry; the field is not optional, and a
      // payload naming the run as written is the honest placeholder.
      payload: { kind: "session", target: found.target },
      reserved: true,
    };
  }
  return {
    start: found.start,
    end: found.end,
    payload: { kind: "session", target: verdict.sessionId },
  };
}

/**
 * The commit-sha payload for a verified sha. `null` when it is not a commit
 * here, or not yet known to be one.
 *
 * What the sha IS — the subject, the attribution, the shape — is said by the
 * hover, which is a real tooltip mounted onto this mark by
 * {@link useCommitTipPortals} rather than a `title` string stamped here. The
 * facts it shows come from the same verdict, asked again at mount.
 */
function payloadForCommit(
  sha: string,
  context: AnnotationContext,
): AnnotationPayload | null {
  if (context.commitRoot === null) return null;
  const verdict = context.resolveCommit(sha);
  if (verdict.state !== "confirmed") return null;
  return {
    kind: "commit-sha",
    sha,
    root: context.commitRoot,
    paths: verdict.paths,
  };
}

/**
 * Drop wrappers whose entity no longer holds, so the marked DOM reflects
 * what is known now rather than everything ever believed.
 *
 * In practice a confirmed file stays confirmed, and this sweep does
 * nothing. It exists because the resolvers are allowed to forget: a lost
 * answer returns a path to `unknown` rather than asserting it is missing,
 * and a link whose file has stopped resolving should stop being a link.
 */
function dropStaleWraps(
  container: HTMLElement,
  context: AnnotationContext,
): void {
  const wrapped = container.querySelectorAll<HTMLElement>(
    `[${WRAPPED_ATTRIBUTE}]`,
  );
  for (const element of wrapped) {
    const annotation = readAnnotation(element);
    // A session wrap is re-checked for the same reason a path wrap is: the
    // ledger is allowed to forget, and a reconnect drops every cached answer.
    // Without this arm a mark made once would never clear — and the run would
    // never return to the prose for the path scan to reconsider, since
    // `unwrapMatch`'s `normalize()` is what makes it one run again.
    if (annotation?.kind === "session") {
      // Re-derived from the spelling the PROSE used, the way the path arm
      // re-derives its reference — the dataset holds the resolved id, which
      // is not what has to be re-asked.
      //
      // `textContent` is not that spelling once a citation chip has been
      // portaled in: the portal host empties the span, so reading it back
      // would ask about "" and refute every chip on the next pass. The
      // emptied text is preserved on {@link SESSION_TEXT_ATTRIBUTE} for
      // exactly this, and restored below so an unwrap folds the words back
      // rather than a hole.
      const saved = element.getAttribute(SESSION_TEXT_ATTRIBUTE);
      const target = saved ?? element.textContent ?? "";
      const verdict = context.resolveSession?.(target);
      if (verdict?.state === "confirmed") continue;
      // A `pending` verdict is not evidence of anything — a reconnect just
      // dropped the answer, and the next batch will bring it back. Unwrapping
      // on pending would blink every citation on every reconnect.
      if (verdict?.state === "pending") continue;
      if (saved !== null) {
        element.textContent = saved;
        element.removeAttribute(SESSION_TEXT_ATTRIBUTE);
      }
      unwrapMatch(element);
      continue;
    }
    // Only path wraps are re-checked beyond that; a kind whose truth cannot
    // change (a commit) has nothing to re-check.
    if (annotation?.kind !== "file-path" && annotation?.kind !== "directory") {
      continue;
    }
    // `textContent` is not the prose's spelling once a file tip has been
    // portaled in — the portal host empties the span, the same way a
    // citation's does — so the saved words are the authority when they
    // exist, and are restored below rather than folded into a hole.
    const saved = element.getAttribute(FILE_TEXT_ATTRIBUTE);
    const reference = detectPathReference(saved ?? element.textContent ?? "");
    const state =
      reference === null ? "unknown" : context.resolvePath(reference).state;
    if (state === "confirmed") continue;
    if (saved !== null) {
      element.textContent = saved;
      element.removeAttribute(FILE_TEXT_ATTRIBUTE);
    }
    unwrapMatch(element);
  }
}

/**
 * Mark the anchors `linkify-element` produced with their annotation kind.
 * The anchor's own `href` is the payload, so this stamps identity only —
 * see `readAnnotation`. Markdown-authored links (which linkify leaves
 * alone) are marked too: a link is a link however it was written.
 */
function annotateAnchors(container: HTMLElement): void {
  const anchors = container.querySelectorAll<HTMLAnchorElement>("a[href]");
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href") ?? "";
    if (/^mailto:/i.test(href)) stampAnnotationKind(anchor, "email");
    else if (hasUrlScheme(href)) stampAnnotationKind(anchor, "url");
  }
}

/**
 * The attribute a pass leaves on a container that met a `pending` verdict
 * — the DOM-held record of "this ink is waiting on an answer". Verdict
 * batches re-annotate only containers that carry it.
 */
export const AWAITING_ATTRIBUTE = "data-tugx-awaiting";

/**
 * Where a session wrap keeps the words it used to show.
 *
 * A confirmed session run becomes the mount point for a live citation chip
 * (`useSessionCitationPortals`), and hosting one means emptying the span. The
 * spelling the prose used is still needed twice afterwards: to re-ask the
 * ledger about it on a later pass, and to put back if the mark is ever
 * dropped — an unwrap folds the wrapper's text into its neighbours, and an
 * emptied wrapper would fold a hole into the sentence.
 */
export const SESSION_TEXT_ATTRIBUTE = "data-tugx-session-text";

/**
 * Where a path wrap keeps the words it used to show.
 *
 * The same bargain {@link SESSION_TEXT_ATTRIBUTE} strikes, for the same
 * reason: a confirmed path run hosts the file tip (`useFileTipPortals`), and
 * hosting means emptying the span. A path wrap is re-checked on every pass —
 * a file can be deleted — and the check reads the run's words, so without
 * this an emptied host would resolve to nothing and unwrap every path mark
 * in the container.
 */
export const FILE_TEXT_ATTRIBUTE = "data-tugx-file-text";

/**
 * Whether `container` (or any annotated child block inside it) is still
 * waiting on a resolver verdict. This is the per-container gate a verdict
 * batch is filtered through: a container with nothing outstanding is not
 * walked again.
 */
export function containerAwaitsVerdicts(container: HTMLElement): boolean {
  return (
    container.hasAttribute(AWAITING_ATTRIBUTE) ||
    container.querySelector(`[${AWAITING_ATTRIBUTE}]`) !== null
  );
}

/**
 * A context whose resolver calls are counted: every `pending` verdict the
 * pass meets bumps the count, which is what decides whether the container
 * gets the awaiting flag. The wrapper is context-shaped so the pass
 * functions need no second protocol.
 */
function trackAwaits(context: AnnotationContext): {
  context: AnnotationContext;
  waits: () => number;
} {
  let count = 0;
  const tracked: AnnotationContext = {
    ...context,
    resolvePath: (reference) => {
      const verdict = context.resolvePath(reference);
      if (verdict.state === "pending") count += 1;
      return verdict;
    },
    resolveCommit: (sha) => {
      const verdict = context.resolveCommit(sha);
      if (verdict.state === "pending") count += 1;
      return verdict;
    },
  };
  // Without this arm the container never gets `data-tugx-awaiting`, so no
  // verdict batch ever re-marks it — and every session in the post stays
  // reserved-but-unmarked forever, silently. The wrapper is rebuilt rather
  // than spread-assigned so an absent `resolveSession` stays absent (the
  // signal that this surface does not scan for sessions).
  const resolveSession = context.resolveSession;
  if (resolveSession !== undefined) {
    tracked.resolveSession = (target) => {
      const verdict = resolveSession(target);
      if (verdict.state === "pending") count += 1;
      return verdict;
    };
  }
  return { context: tracked, waits: () => count };
}

/**
 * Detect bare URLs and email addresses in text and mark the resulting
 * anchors. Runs only when `container`'s HTML was just written — detection
 * rewrites text into anchors, and its tokenizer splits text nodes at
 * anything domain-shaped (a filename whose extension is also a top-level
 * domain: `notes.md`, `deploy.sh`, `index.io`) even when the match is
 * refused. The `normalize()` rejoins those runs so the entity scan that
 * follows sees whole paths, not halves that read as directories.
 */
function annotateBareLinks(container: HTMLElement): void {
  linkifyElement(container, LINKIFY_OPTS);
  container.normalize();
  annotateAnchors(container);
}

/**
 * Annotate every actionable entity in `container`'s freshly rendered
 * markdown — the full pass, for DOM whose `innerHTML` was just written.
 *
 * Without a `context`, only the state-free kinds are marked: bare URLs
 * and email addresses in text become anchors. With one, inline `<code>`
 * command spans and text references are marked too.
 *
 * Idempotent and re-runnable over already-annotated DOM — safe to call
 * again when the content changes (the streaming case: every delta rewrites
 * the block's HTML and this re-marks it atomically). For re-marking DOM
 * that has *not* changed — a verdict arriving for ink already painted —
 * use {@link annotateElement}, which skips link detection entirely.
 */
export function annotateContent(
  container: HTMLElement,
  context?: AnnotationContext,
): void {
  recordContentPass();
  annotateBareLinks(container);
  if (context === undefined) return;
  annotateElement(container, context);
}

/**
 * Annotate the entities in any element's text, for a surface that renders
 * its own DOM rather than markdown.
 *
 * Most of what a transcript shows is not markdown: a tool-call header
 * naming the file it read, a command line React rendered into a `<code>`.
 * Those are ink like any other, and the reason they went unmarked was
 * structural — the pass was reachable only from the markdown renderer, so
 * convergence depended on a list of surfaces someone had to remember.
 * This is that list's replacement: a surface opts in by calling
 * `useAnnotatedElement`, and the marks, the CSS affordance, the click and
 * the context menu all follow from the same DOM contract.
 *
 * Link detection is deliberately not part of this. Detection rewrites
 * text into anchors, which is right for prose a markdown renderer owns and
 * wrong for a component's own children — a component is entitled to assume
 * the DOM it rendered is the DOM it has. It is also why the verdict-driven
 * re-mark path comes here rather than to {@link annotateContent}: the DOM
 * did not change, so there is nothing new to detect.
 */
export function annotateElement(
  container: HTMLElement,
  context: AnnotationContext,
): void {
  const started = performance.now();
  // This pass supersedes any narrower pass that stamped a child block
  // (the streaming render annotates per built block); stale child flags
  // would keep the container re-annotating after its waits resolved.
  for (const flagged of container.querySelectorAll(`[${AWAITING_ATTRIBUTE}]`)) {
    flagged.removeAttribute(AWAITING_ATTRIBUTE);
  }
  const tracked = trackAwaits(context);
  dropStaleWraps(container, tracked.context);
  annotateInlineCode(container, tracked.context);
  const nodes = annotatePathsInText(container, tracked.context);
  if (tracked.waits() > 0) container.setAttribute(AWAITING_ATTRIBUTE, "");
  else container.removeAttribute(AWAITING_ATTRIBUTE);
  recordElementPass(performance.now() - started, nodes);
}
