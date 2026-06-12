/**
 * Digest building — the beat's facts rendered in the format the voice
 * spike pinned (`v2.1.173-pulse-spike/README.md`):
 *
 *     BEAT <n>
 *     [<scope-short-id>]
 *     - <fact sentence>
 *     [<other-scope>]
 *     - <fact sentence>
 *
 * Scope tags are shortened for the model (a full tug session id is
 * uuid-length noise); the emitted PulseLine carries the FULL scope ids
 * so downstream filtering never depends on the alias.
 *
 * @module pulse/digest
 */

import type { PulseFact } from "./types";

/** Short display alias for a scope id — enough to disambiguate. */
export function scopeAlias(scope: string): string {
  if (scope === "app" || scope.length <= 8) return scope;
  return scope.slice(0, 8);
}

/** Render one beat's facts as the model-facing digest. */
export function buildDigest(beatNumber: number, facts: PulseFact[]): string {
  const lines: string[] = [`BEAT ${beatNumber}`];
  let currentScope: string | null = null;
  // Group by scope while preserving arrival order within each scope:
  // facts from one scope stay contiguous, scopes appear in first-seen
  // order — the grouping the spike judged coherent.
  const scopeOrder: string[] = [];
  const byScope = new Map<string, PulseFact[]>();
  for (const fact of facts) {
    const group = byScope.get(fact.scope);
    if (group === undefined) {
      scopeOrder.push(fact.scope);
      byScope.set(fact.scope, [fact]);
    } else {
      group.push(fact);
    }
  }
  for (const scope of scopeOrder) {
    if (scope !== currentScope) {
      lines.push(`[${scopeAlias(scope)}]`);
      currentScope = scope;
    }
    for (const fact of byScope.get(scope)!) {
      lines.push(`- ${fact.fact}`);
    }
  }
  return lines.join("\n");
}

/** Unique full scope ids covered by a beat, first-seen order. */
export function beatScopes(facts: PulseFact[]): string[] {
  const seen = new Set<string>();
  const scopes: string[] = [];
  for (const fact of facts) {
    if (!seen.has(fact.scope)) {
      seen.add(fact.scope);
      scopes.push(fact.scope);
    }
  }
  return scopes;
}
