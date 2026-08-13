/**
 * Shared vocabulary for the content annotator.
 *
 * An **annotation** is an actionable entity in transcript ink: a URL, an
 * email address, a command line, a file path. Every annotation has a
 * *kind* (what it is) and a *payload* (the structured value a gesture
 * acts on). The kind and payload travel on the DOM element as dataset
 * attributes, which is what lets one delegated listener on the transcript
 * root service every entity without knowing which surface produced it.
 *
 * The model is deliberately open: adding an entity type means adding a
 * kind, its payload shape, and a detector — not a new mechanism.
 *
 * @module lib/annotator/types
 */

import type { CommitVerdict } from "./commit-resolution";
import type { PathReference } from "./detect-path-reference";
import type { PathVerdict } from "./path-resolution";
import type { SessionVerdict } from "./session-resolution";

/** The entity types the annotator recognizes. */
export type AnnotationKind =
  | "url"
  | "email"
  | "slash-command"
  | "shell-command"
  | "file-path"
  | "directory"
  | "image"
  | "commit-sha"
  | "session";

/**
 * The class every annotated element carries, whatever its kind and
 * whatever surface produced it. The interaction layer resolves a gesture
 * by `closest()` on this one selector; CSS keys per-kind affordances off
 * the `data-tug-annotation` attribute beside it.
 */
export const ANNOTATION_CLASS = "tugx-annotation";

/** The class `linkify-element` stamps on the anchors it produces. */
export const AUTOLINK_CLASS = "tugx-md-autolink";

/**
 * The live inputs an annotation pass needs beyond the DOM it walks.
 *
 * Passing a context is what opts a markdown consumer into the entity
 * kinds that require live state; a consumer that supplies none still
 * gets the state-free kinds (URLs and email addresses).
 */
export interface AnnotationContext {
  /**
   * Authoritative clickability gate for slash commands: `true` when the
   * bare command name is in the session's live command catalog.
   */
  isKnownSlashCommand: (name: string) => boolean;
  /**
   * Does this candidate name a real file? A path candidate is only ever
   * actionable once this says `confirmed`, which is what lets detection
   * stay permissive: prose that merely looks like a path resolves to
   * `missing` and stays plain text.
   *
   * Synchronous by contract, because the DOM pass is. Answers it does not
   * have yet come back `unknown` or `pending` and arrive later, bumping
   * the context's identity so the pass re-runs over ink already painted.
   */
  resolvePath: (reference: PathReference) => PathVerdict;
  /**
   * Is this run of hex a commit in the card's repository? Same contract as
   * {@link resolvePath}: synchronous, cached, and the answer that arrives
   * later re-runs the pass. A `confirmed` verdict carries the files the
   * commit touched, which is what the diff a click opens is scoped to.
   */
  resolveCommit: (sha: string) => CommitVerdict;
  /**
   * The repository a confirmed commit belongs to. `null` when the card is
   * bound to no project — then no sha resolves, and the field is unused.
   */
  commitRoot: string | null;
  /**
   * Does this candidate name a real session? Optional, and its absence means
   * "do not scan for sessions at all" — the gallery and non-transcript hosts
   * never mark a session candidate and never reserve a run for one.
   *
   * Unlike the other resolvers, a `pending` answer here does more than
   * withhold a mark: it RESERVES the run, so the path scan cannot claim a
   * `project/callsign` token while the ledger's answer is still out. See
   * `annotate-content.ts` and `session-resolution.ts` for why the two scans
   * cannot simply be ordered.
   */
  resolveSession?: (target: string) => SessionVerdict;
  /**
   * Whether running prose on this surface should be read as *citing* paths.
   *
   * Off by default, and off for the transcript, where the caution is
   * earned: assistant prose is long-form English, a filename-shaped word in
   * it is often just a word, and marking every one turns a paragraph into a
   * field of speculative links. There, only a shape no sentence produces by
   * accident qualifies ({@link isUnambiguousInProse} — an absolute path, or
   * a line citation).
   *
   * A surface whose prose is *about* file work sets this. The Gazette is
   * the case: a Reporter post is a machine-written operational digest whose
   * whole subject is which files moved, so `settings-api.ts` in one of its
   * sentences is a reference to that file and nothing else — and leaving it
   * plain was the surface's most visible failure. Detection stays
   * permissive either way and {@link resolvePath} is still the gate, so the
   * cost of a wrong guess is one cached lookup and text that stays text.
   */
  proseCitesPaths?: boolean;
  /**
   * Verdict arrivals, batched. A consumer whose container met a `pending`
   * verdict subscribes here and re-runs the pass per batch — only over
   * containers still awaiting an answer, which is what keeps one answer
   * from provoking a walk of every block. The context object itself stays
   * identity-stable across verdicts; identity changes only when a real
   * input changes (catalog, cwd, project binding), which is the
   * everything-must-re-mark case.
   *
   * Optional: a hand-built context (tests, fixtures) without one simply
   * never re-marks, which is correct for static content.
   */
  subscribe?: (listener: () => void) => () => void;
}
