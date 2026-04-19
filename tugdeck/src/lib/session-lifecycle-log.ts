/**
 * session-lifecycle-log — single greppable trace stream for the Tide
 * session-id chain.
 *
 * Every handoff in the spawn / resume / history flow emits one line
 * tagged `[tide::session-lifecycle]` with `key=value` fields. Grepping
 * a single run's output (browser console + tugcast log) for that tag
 * answers "which id won, and where?" for any session.
 *
 * Format mirrors the Rust side, which uses
 * `tracing::info!(target: "tide::session-lifecycle", ...)` so the same
 * grep surfaces both. Tugcode emits the same shape via its own copy of
 * this helper; tugcast forwards tugcode's stderr lines into its log,
 * so the three sources land in one stream.
 *
 * No behavior change — pure observability.
 */

export function logSessionLifecycle(
  event: string,
  fields: Record<string, unknown>,
): void {
  const parts: string[] = [`event=${event}`];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    parts.push(`${k}=${formatValue(v)}`);
  }
  console.log(`[tide::session-lifecycle] ${parts.join(" ")}`);
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") {
    // Quote empty strings or anything containing whitespace/quotes so
    // a downstream key=value parser can recover the boundaries.
    if (v.length === 0 || /[\s"']/.test(v)) return JSON.stringify(v);
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}
