/**
 * log-section.tsx — the Lens **Log** section: the in-app log buffer
 * (`tugDevLogStore`) with a live collapsed-summary of level counts.
 *
 * The section is host-agnostic ([P07]): its body and collapsed-summary
 * read `tugDevLogStore` directly — nothing arrives from the panel. The
 * body reuses the relocated `LogInspector` (filters + `LogRow` list) from
 * `lens/internal/`.
 *
 * @module components/lens/sections/log-section
 */

import React, { useSyncExternalStore } from "react";
import { ScrollText } from "lucide-react";
import { tugDevLogStore } from "@/lib/tug-dev-log-store/tug-dev-log-store";
import { LogInspector } from "@/components/lens/internal/log-inspector";
import { registerLensSection } from "../lens-section-registry";

/** Live one-line summary: total entries + warn/error counts ([the
 *  hallmark] — a collapsed section answers its question at a glance). */
function LogCollapsedSummary(): React.ReactElement {
  const snapshot = useSyncExternalStore(
    tugDevLogStore.subscribe,
    tugDevLogStore.getSnapshot,
  );
  let warn = 0;
  let error = 0;
  for (const e of snapshot.entries) {
    if (e.level === "warn") warn++;
    else if (e.level === "error") error++;
  }
  const parts = [`${snapshot.entries.length}`];
  if (warn > 0) parts.push(`${warn} warn`);
  if (error > 0) parts.push(`${error} error`);
  return <>{parts.join(" · ")}</>;
}

/** Register the Log section. Called once at boot from `main.tsx`. */
export function registerLogSection(): void {
  registerLensSection({
    kind: "log",
    title: "Log",
    glyph: <ScrollText size={14} />,
    collapsedSummary: () => <LogCollapsedSummary />,
    body: () => <LogInspector />,
  });
}
