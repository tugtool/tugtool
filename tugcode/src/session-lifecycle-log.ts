// session-lifecycle-log — single greppable trace stream for the Tide
// session-id chain.
//
// Mirrors `tugdeck/src/lib/session-lifecycle-log.ts` and the Rust
// `target: "tide::session-lifecycle"` traces. tugcode redirects all
// console output to stderr (see main.ts), and tugcast forwards
// subprocess stderr into its tracing log under `tugcast::tugcode_stderr`,
// so these lines land in the same log a `[tide::session-lifecycle]`
// grep already covers.
//
// No behavior change — pure observability.

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
    if (v.length === 0 || /[\s"']/.test(v)) return JSON.stringify(v);
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}
