/**
 * session-identity.ts — the one place Tug decides what a session is called.
 *
 * Tug used to name a session five different ways: a chip rule, a chooser-row
 * rule, a Lens-entry hash sniff, a title-bar composer, and the Rust feed's own
 * precedence. No two agreed. This module is [D123] ("a pane's name is one
 * string produced in one place") applied to the session: one resolver produces
 * one structured {@link SessionIdentity} record, and every surface renders that
 * record at a declared density tier.
 *
 * Three entry points, and which one you want is not a matter of taste:
 *
 *  - {@link useSessionIdentity} — **the React entry point.** It subscribes to
 *    each backing store *by id* and then derives. Every component uses this.
 *  - {@link resolveSessionIdentity} — an imperative SNAPSHOT with no
 *    subscription. Correct only for non-React callers: clipboard writes,
 *    export filenames, command routes, list projections that already carry
 *    the stores' version tokens as inputs.
 *  - {@link sessionIdentityLine} / {@link sessionCitation} — pure formatters
 *    over a resolved record.
 *
 * **Calling the bare resolver from a render is the bug this module exists to
 * prevent.** It reads three stores imperatively; from a render body it hands
 * back a snapshot with no subscription, so a `/rename` or a synopsis write
 * updates the stores while the surface repaints never. That failure passes
 * every unit test and shows up only as a stale name in the running app, which
 * is why "no component calls `resolveSessionIdentity`" is a grep gate rather
 * than a convention.
 *
 * **Liveness is not identity.** The record carries no phase field. Phase lives
 * on a per-*card* `codeSessionStore` — there is no session-keyed phase store to
 * read, and folding one in would wake every identity surface on every
 * transcript event. The phase dot stays a `cardId`-keyed leaf subscription
 * composed *into* the row and masthead tiers as a child; identity and liveness
 * are two subscriptions with two keys that meet in the component.
 *
 * **The branch is not identity either.** It is telemetry — it rides the record
 * for the masthead's placard and never appears in a rendered name. The old
 * `(<branch>)` title suffix is retired.
 *
 * Laws: [L02] external state enters React through `useSyncExternalStore` only.
 *
 * @module lib/session-identity
 */

import { useCallback, useSyncExternalStore } from "react";

import {
  cardSessionBindingStore,
  type CardSessionBinding,
} from "@/lib/card-session-binding-store";
import { sessionNameStore } from "@/lib/session-name-store";
import { sessionSynopsisStore } from "@/lib/session-synopsis-store";
import { sessionTagStore } from "@/lib/session-tag-store";
import type { SessionRow } from "@/protocol";

/** Chars of a session UUID that make its short id. Computed here and nowhere else. */
export const SESSION_SHORT_ID_LENGTH = 8;

/**
 * One session's identity, as every surface in the app reads it.
 *
 * Deliberately absent: phase/liveness (a per-card subscription, composed in as
 * a child) and anything a caller would have to re-derive.
 */
export interface SessionIdentity {
  /** Project leaf name (basename of projectDir); `""` when the project is unknown. */
  project: string;
  /** Workspace branch, or null — telemetry only, never rendered in identity. */
  branch: string | null;
  /** The callsign, including any lineage suffix; null only for a legacy tagless row. */
  tag: string | null;
  /** Parsed lineage segments, e.g. `["A1","B2"]`; empty for a root session. */
  lineage: readonly string[];
  /** The description: the `/rename` name when set, else the synopsis, else null. */
  title: string | null;
  /** Ledger state, when the caller knows it. */
  state: SessionRow["state"] | null;
  /** Full tug session id (plumbing: tooltips, copy affordance). */
  id: string;
  /** First {@link SESSION_SHORT_ID_LENGTH} chars of `id` — THE short id. */
  shortId: string;
}

/**
 * The facts about a session that do NOT live in the three by-id identity
 * stores, supplied by a caller that already holds them.
 *
 * The picker and the Lens hold a whole `SessionRow` and pass it through
 * {@link sessionIdentityContextFrom}; the Session card and the masthead pass
 * their project dir and (for the placard) the branch. Anything omitted
 * resolves to its honest empty value rather than being invented — except
 * `projectDir`, which falls back to the session's card binding when one
 * exists.
 */
export interface SessionIdentityContext {
  projectDir?: string | null;
  branch?: string | null;
  state?: SessionRow["state"] | null;
  /**
   * The ledger's structured lineage record (`SessionRow.tag_lineage`), when
   * the caller holds one. There is deliberately no `rootTag` beside it: the
   * root's callsign is the composed `tag` with its lineage tail removed, so a
   * second field would be a second spelling of a fact the record already
   * carries — and the two could disagree.
   */
  tagLineage?: string | null;
}

/**
 * The trailing path component (basename) of a directory: the project's
 * leaf-name identity. Trailing slashes are ignored; an empty or slash-only
 * path yields the trimmed input.
 */
export function projectLeafName(dir: string): string {
  const trimmed = dir.replace(/\/+$/, "");
  const leaf = trimmed.split("/").pop() ?? "";
  return leaf.length > 0 ? leaf : trimmed;
}

/** The short id: the first {@link SESSION_SHORT_ID_LENGTH} chars of the UUID. */
export function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, SESSION_SHORT_ID_LENGTH);
}

/** One lineage segment: a branch-point letter and a sequence number (`A1`, `B12`). */
const LINEAGE_SEGMENT = /^[A-Z]\d+$/;

/**
 * The lineage segments of a fork's callsign.
 *
 * `tagLineage` is the ledger's structured record and wins when present. A row
 * that predates it (or a client holding only the composed tag) falls back to
 * reading the segments off the tag's tail, which is unambiguous: a root
 * callsign is `adjective-noun`, both lowercase words, so any trailing
 * `<Letter><Number>` run is lineage and nothing else can be mistaken for it.
 */
export function parseTagLineage(
  tag: string | null,
  tagLineage?: string | null,
): readonly string[] {
  const structured = tagLineage?.trim() ?? "";
  if (structured.length > 0) {
    return structured.split("-").filter((s) => LINEAGE_SEGMENT.test(s));
  }
  const composed = tag?.trim() ?? "";
  if (composed.length === 0) return [];
  const parts = composed.split("-");
  const segments: string[] = [];
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (!LINEAGE_SEGMENT.test(parts[i])) break;
    segments.unshift(parts[i]);
  }
  return segments;
}

/**
 * Compose an identity record from explicit facts — the pure half, with no
 * store reads. This is what the unit tests exercise; {@link resolveSessionIdentity}
 * is this function with the three stores read for it.
 */
export function composeSessionIdentity(input: {
  sessionId: string;
  name: string | null;
  synopsis: string | null;
  tag: string | null;
  projectDir?: string | null;
  branch?: string | null;
  state?: SessionRow["state"] | null;
  tagLineage?: string | null;
}): SessionIdentity {
  const tag = input.tag?.trim() || null;
  const name = input.name?.trim() || null;
  const synopsis = input.synopsis?.trim() || null;
  const projectDir = input.projectDir?.trim() ?? "";
  const branch = input.branch?.trim() || null;
  return {
    project: projectDir.length > 0 ? projectLeafName(projectDir) : "",
    branch,
    tag,
    lineage: parseTagLineage(tag, input.tagLineage),
    // The `/rename` name wins and freezes the line; the rolling synopsis fills
    // it otherwise; an honest empty line when neither exists. The store holds
    // only user-set names — an auto title never fronts a description.
    title: name ?? synopsis,
    state: input.state ?? null,
    id: input.sessionId,
    shortId: shortSessionId(input.sessionId),
  };
}

/** The context a `SessionRow` supplies — the picker's and the Lens's path in. */
export function sessionIdentityContextFrom(
  row: SessionRow,
): SessionIdentityContext {
  return {
    projectDir: row.project_dir,
    state: row.state,
    tagLineage: row.tag_lineage,
  };
}

/** The project dir of whichever card is bound to `sessionId`, or null. */
function boundProjectDirFor(sessionId: string): string | null {
  for (const binding of cardSessionBindingStore.getSnapshot().values()) {
    if (binding.tugSessionId === sessionId) return binding.projectDir;
  }
  return null;
}

/**
 * Resolve a session's identity **as a snapshot, with no subscription**.
 *
 * Non-React callers only — clipboard writes, export filenames, command routes,
 * and list projections that already carry the identity stores' version tokens
 * as recompute inputs. Every component uses {@link useSessionIdentity} instead;
 * calling this from a render is the stale-render bug this module's header
 * describes, and a grep gate exists to keep it out of `components/`.
 */
export function resolveSessionIdentity(
  sessionId: string,
  context?: SessionIdentityContext,
): SessionIdentity {
  return composeSessionIdentity({
    sessionId,
    name: sessionNameStore.getName(sessionId),
    synopsis: sessionSynopsisStore.getSynopsis(sessionId),
    tag: sessionTagStore.getTag(sessionId),
    projectDir: context?.projectDir ?? boundProjectDirFor(sessionId),
    branch: context?.branch ?? null,
    state: context?.state ?? null,
    tagLineage: context?.tagLineage ?? null,
  });
}

/**
 * The React entry point: subscribe to each backing store **by id**, then
 * resolve. Returns null for a null `sessionId` so a caller with no session
 * needs no branch of its own.
 *
 * By-id getters, deliberately: the stores also publish whole-store version
 * tokens, but those exist for consumers deriving across many sessions at once
 * (the Lens's filter projection). Reading a version token here would wake every
 * identity surface in the app on any session's rename.
 *
 * Overloaded on the argument, so a caller that already holds a session id gets
 * a record rather than a maybe-record and writes no branch for a state its own
 * types forbid. The nullable arm exists for callers whose binding may not have
 * resolved yet.
 */
export function useSessionIdentity(
  sessionId: string,
  context?: SessionIdentityContext,
): SessionIdentity;
export function useSessionIdentity(
  sessionId: string | null,
  context?: SessionIdentityContext,
): SessionIdentity | null;
export function useSessionIdentity(
  sessionId: string | null,
  context?: SessionIdentityContext,
): SessionIdentity | null {
  const name = useSyncExternalStore(
    sessionNameStore.subscribe,
    useCallback(
      () => (sessionId === null ? null : sessionNameStore.getName(sessionId)),
      [sessionId],
    ),
  );
  const tag = useSyncExternalStore(
    sessionTagStore.subscribe,
    useCallback(
      () => (sessionId === null ? null : sessionTagStore.getTag(sessionId)),
      [sessionId],
    ),
  );
  const synopsis = useSyncExternalStore(
    sessionSynopsisStore.subscribe,
    useCallback(
      () =>
        sessionId === null
          ? null
          : sessionSynopsisStore.getSynopsis(sessionId),
      [sessionId],
    ),
  );
  // The project dir a caller did not supply. The snapshot is the dir STRING,
  // not the binding, so React bails out on every binding change that does not
  // move this session's project — which is all of them but a rebind.
  const boundProjectDir = useSyncExternalStore(
    cardSessionBindingStore.subscribe,
    useCallback(
      () => (sessionId === null ? null : boundProjectDirFor(sessionId)),
      [sessionId],
    ),
  );
  if (sessionId === null) return null;
  return composeSessionIdentity({
    sessionId,
    name,
    synopsis,
    tag,
    projectDir: context?.projectDir ?? boundProjectDir,
    branch: context?.branch ?? null,
    state: context?.state ?? null,
    tagLineage: context?.tagLineage ?? null,
  });
}

/**
 * The Line-tier string: `<project>/<callsign>`.
 *
 * No branch suffix and no name arm — which is what makes this string
 * **constant for the life of a session binding**, and that is load-bearing
 * rather than incidental. The pane-title channel carries it for reader
 * compatibility (the tab strip, the Window menu, the slot-stack picker); it is
 * not a notification path, and identity changes reach surfaces through
 * {@link useSessionIdentity}. A legacy tagless session degrades to its short
 * id — never the full UUID.
 */
export function sessionIdentityLine(identity: SessionIdentity): string {
  const label = identity.tag ?? identity.shortId;
  return identity.project.length > 0
    ? `${identity.project}/${label}`
    : label;
}

/**
 * The citation — the only sanctioned flat-text form of a session reference,
 * and the only place monospace appears: `<tag> (<shortId>)`, project-prefixed
 * when the surrounding context does not supply the project.
 *
 * A legacy tagless session degrades to the bare short id with no parentheses:
 * the hash is already the callsign there, and printing it twice is noise.
 */
export function sessionCitation(
  identity: SessionIdentity,
  opts?: { project?: boolean },
): string {
  const withProject = opts?.project === true && identity.project.length > 0;
  if (identity.tag === null) {
    return withProject
      ? `${identity.project}/${identity.shortId}`
      : identity.shortId;
  }
  const head = withProject
    ? `${identity.project}/${identity.tag}`
    : identity.tag;
  return `${head} (${identity.shortId})`;
}

/**
 * The Line string for a session, resolved and formatted in one call — the
 * non-React shorthand for a list projection or a command route. Components use
 * {@link useSessionIdentity} + {@link sessionIdentityLine} instead.
 */
export function sessionIdentityLineFor(
  sessionId: string,
  context?: SessionIdentityContext,
): string {
  return sessionIdentityLine(resolveSessionIdentity(sessionId, context));
}

/** The Line string for a card's session binding — the Lens's cards projection. */
export function sessionIdentityLineForBinding(
  binding: CardSessionBinding,
): string {
  return sessionIdentityLineFor(binding.tugSessionId, {
    projectDir: binding.projectDir,
  });
}
