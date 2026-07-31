/**
 * `annotateTranscript` — the Transcript Annotator's DOM pass.
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
 * Detection is permissive by design; {@link AnnotationContext.resolvePath}
 * is the gate. Nothing becomes a link until a resolver confirms a real
 * file, so prose that merely looks path-shaped costs one cached lookup and
 * stays plain text.
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
 * @module lib/annotator/annotate-transcript
 */

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
  isUnambiguousInProse,
  scanPathReferences,
} from "./detect-path-reference";
import { scanCommitShas } from "./detect-commit-sha";
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
 * Tag names (uppercase — `linkify-element` compares against
 * `Element.tagName`) whose subtrees are left untouched by link
 * detection. `A` is already skipped internally by linkify; listing
 * `CODE`/`PRE` keeps URLs inside code spans and fenced blocks as
 * literal text.
 */
const IGNORE_TAGS = ["A", "CODE", "PRE"];

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
): void {
  // Rejoin adjacent text nodes first. Link detection tokenizes before it
  // validates, so a filename whose extension is also a top-level domain —
  // `notes.md`, `deploy.sh`, `index.io` — gets split out into its own text
  // node even though it is refused as a link. The path around it would
  // then be scanned in halves, and the half ending at the separator reads
  // as a directory. Normalizing puts the run back together.
  container.normalize();
  for (const { node, inCode } of collectTextNodes(container)) {
    const text = node.data;
    if (text.trim() === "") continue;
    const matches: TextRunMatch[] = [];
    for (const reference of scanPathReferences(text)) {
      if (!inCode && !isUnambiguousInProse(reference)) continue;
      const payload = payloadForReference(
        reference,
        context.resolvePath(reference),
      );
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
}

/**
 * The commit-sha payload for a verified sha, or `null` when it is not a
 * commit here — or not yet known to be one.
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
    // Only path wraps are re-checked here; a kind whose truth cannot
    // change (a commit) has nothing to re-check.
    if (annotation?.kind !== "file-path" && annotation?.kind !== "directory") {
      continue;
    }
    const reference = detectPathReference(element.textContent ?? "");
    if (
      reference !== null &&
      context.resolvePath(reference).state === "confirmed"
    ) {
      continue;
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
 * Annotate every actionable entity in `container`'s rendered markdown.
 *
 * Without a `context`, only the state-free kinds are marked: bare URLs
 * and email addresses in text become anchors. With one, inline `<code>`
 * command spans are marked too.
 *
 * Idempotent and re-runnable over already-annotated DOM — safe to call
 * again when an input changes (the on-resume case: the transcript replays
 * from JSONL before the handshake catalog lands, so the first pass sees an
 * empty catalog and a later pass marks the slash spans once it arrives).
 */
export function annotateTranscript(
  container: HTMLElement,
  context?: AnnotationContext,
): void {
  linkifyElement(container, LINKIFY_OPTS);
  annotateAnchors(container);
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
 * Link detection is deliberately not part of this. Linkifying rewrites
 * text into anchors, which is right for prose a markdown renderer owns and
 * wrong for a component's own children — a component is entitled to assume
 * the DOM it rendered is the DOM it has.
 */
export function annotateElement(
  container: HTMLElement,
  context: AnnotationContext,
): void {
  dropStaleWraps(container, context);
  annotateInlineCode(container, context);
  annotatePathsInText(container, context);
}
