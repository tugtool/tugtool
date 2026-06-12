/**
 * parse-cache — the render-once parse cache for finalized transcript
 * rows.
 *
 * Finalized transcript rows are immutable: once a turn commits, its
 * content never changes, so the expensive markdown work (WASM
 * lex/parse + DOMPurify sanitize) can run exactly once per row and be
 * reused for every subsequent render — replay, live appends, scrolls,
 * remounts (scroll-out-and-back, tab switches), and window-membership
 * changes.
 *
 * **Scope and lifetime.** Entries live in a `WeakMap` keyed by a
 * session-scoped scope object (in practice the session's streaming
 * `PropertyStore`), so the whole cache drops with the session store —
 * no TTL, no LRU, no cross-session bleed. Within a scope, entries key
 * by the row's stable streaming-path identity
 * (`turn.${turnKey}.message.${messageKey}.${channel}`), the same
 * identity that anchors React reconciliation.
 *
 * **Validity.** Each entry carries the exact source text it was
 * parsed from, and a lookup hits only when the text matches. That
 * makes the cache content-validated by construction: a streaming
 * (unfinalized) row's text changes per delta, so it misses and
 * re-parses exactly as before — and its LAST parse (the finalized
 * text) becomes the warm entry with no separate finalization step.
 * An explicit invalidation API exists for structural row removal
 * (rewind truncation) and any future mutating event.
 *
 * **Zone.** Derived data, structure zone: a plain per-session store
 * read as a pure lookup during render. Never React state, never
 * serialized, never observed — its only observable effects are the
 * parse-economy counters and the absence of repeat parse cost.
 */

import { DEFAULT_BLOCK_TRANSFORMERS } from "./block-transformers";
import { recordRowCacheHit, recordRowParse } from "./parse-counters";
import {
  parseMarkdownToSanitizedBlocks,
  type SanitizedMarkdownBlock,
} from "./parse-markdown-to-sanitized-blocks";

interface CachedParse {
  /** Exact source text the blocks were parsed from. */
  text: string;
  blocks: ReadonlyArray<SanitizedMarkdownBlock>;
}

/**
 * Scope (session) → identity (streaming path) → cached parse. The
 * WeakMap holds no strong reference to the scope: when the session's
 * streaming store is GC'd, its entries go with it.
 */
const CACHE: WeakMap<object, Map<string, CachedParse>> = new WeakMap();

/**
 * Look up the cached parse for `identity` within `scope`, valid only
 * when it was parsed from exactly `text`. Counts a cache hit.
 */
export function getCachedParse(
  scope: object,
  identity: string,
  text: string,
): ReadonlyArray<SanitizedMarkdownBlock> | null {
  const entry = CACHE.get(scope)?.get(identity);
  if (entry === undefined || entry.text !== text) return null;
  recordRowCacheHit();
  return entry.blocks;
}

/** Store the parse result for `identity` within `scope`. */
export function putCachedParse(
  scope: object,
  identity: string,
  text: string,
  blocks: ReadonlyArray<SanitizedMarkdownBlock>,
): void {
  let perScope = CACHE.get(scope);
  if (perScope === undefined) {
    perScope = new Map();
    CACHE.set(scope, perScope);
  }
  perScope.set(identity, { text, blocks });
}

/**
 * The one parse chokepoint for transcript row content: cache lookup,
 * then parse-and-populate on miss. Every consumer — the render path
 * (`TugMarkdownBlock`) and the speculative warm queue — goes through
 * here, so the parse options are identical by construction and the
 * "user-triggered work takes priority" rule is automatic: whichever
 * caller arrives first parses; the other finds the entry warm. The
 * parse-economy counters record one parse or one hit per call.
 */
export function ensureParsed(
  scope: object,
  identity: string,
  text: string,
): ReadonlyArray<SanitizedMarkdownBlock> {
  const cached = getCachedParse(scope, identity, text);
  if (cached !== null) return cached;
  recordRowParse(identity);
  const blocks = parseMarkdownToSanitizedBlocks(text, {
    transformers: DEFAULT_BLOCK_TRANSFORMERS,
  });
  putCachedParse(scope, identity, text, blocks);
  return blocks;
}

/**
 * Explicit invalidation by identity — the one-line correct path for
 * any event that mutates (or removes) a row.
 */
export function invalidateCachedParse(scope: object, identity: string): void {
  CACHE.get(scope)?.delete(identity);
}

/**
 * Invalidate every identity under `prefix` — the rewind-truncation
 * path drops all of a removed turn's per-message entries with
 * `turn.${turnKey}.`.
 */
export function invalidateCachedParsesByPrefix(
  scope: object,
  prefix: string,
): void {
  const perScope = CACHE.get(scope);
  if (perScope === undefined) return;
  for (const key of perScope.keys()) {
    if (key.startsWith(prefix)) perScope.delete(key);
  }
}

/** Drop the whole scope (session teardown). */
export function clearCachedParses(scope: object): void {
  CACHE.delete(scope);
}

/** Test/diagnostic: number of entries cached for `scope`. */
export function cachedParseCount(scope: object): number {
  return CACHE.get(scope)?.size ?? 0;
}
