/**
 * DevActivityCard — the expanded view of the compact PULSE sparkline
 * ([P12]). Small-multiples: one labeled {@link TugSparkline} + a live raw
 * readout per channel the session has produced, hued per descriptor.
 *
 * Surface: rendered inside the PULSE strip's activity popover (the compact
 * strip is the entry point; this is its expansion). Mirrors the title/rule
 * rhythm of the TIME/TOKENS/CONTEXT telemetry popovers so the surfaces read
 * as one system, with its own self-contained styling.
 *
 * Laws:
 *   [L02] the channel *membership* (which rows exist) enters React only via
 *         `useSessionActivity` (the store snapshot); the high-churn series
 *         never do — each sparkline samples the store imperatively on its own
 *         rAF loop ([P03]).
 *   [L06] the raw numeric readout is written to the DOM imperatively on a 1 Hz
 *         tick (matching the gauge cadence) — it never passes through React
 *         state, so a busy session doesn't re-render the popover.
 *   [L19] `.tsx`/`.css` pair, `data-slot="dev-activity-card"`.
 *
 * @module components/tugways/cards/activity-card
 */

import "./activity-card.css";

import React, { useCallback, useEffect, useRef } from "react";

import { TugSparkline } from "@/components/tugways/tug-sparkline";
import {
  ACTIVITY_BIN_MS,
  ACTIVITY_DESCRIPTORS,
  getSessionActivityStore,
  useSessionActivity,
  type ActivityChannel,
} from "@/lib/session-activity-store";

/** Human labels for the channel rows. */
const CHANNEL_LABEL: Readonly<Record<ActivityChannel, string>> = {
  text: "Text",
  tokens: "Tokens",
  tools: "Tools",
  subagents: "Subagents",
  cpu: "CPU",
  memory: "Memory",
  disk: "Disk",
};

/** Trailing bins (~1s) summed into a rate channel's per-second readout. */
const RATE_READOUT_BINS = 4;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${Math.round(bytes)} B`;
}

/** The current readout string for a channel, read imperatively from the store. */
function readoutFor(session: string, channel: ActivityChannel, nowMs: number): string {
  const store = getSessionActivityStore();
  if (store === null) return "—";
  const descriptor = ACTIVITY_DESCRIPTORS[channel];
  if (descriptor.kind === "gauge") {
    const raw = store.raw(session, channel);
    if (raw === null) return "idle";
    if (channel === "cpu") return `${Math.round(raw.value)}%`;
    if (channel === "memory") return formatBytes(raw.value);
    if (channel === "disk") return `${formatBytes(raw.value)}/s`;
    return `${Math.round(raw.value)} ${raw.unit}`;
  }
  // Rate channel: sum the trailing window into a per-second rate.
  const series = store.series(session, channel, nowMs);
  let sum = 0;
  for (let i = Math.max(0, series.length - RATE_READOUT_BINS); i < series.length; i++) {
    sum += series[i];
  }
  const perSec = sum / ((RATE_READOUT_BINS * ACTIVITY_BIN_MS) / 1000);
  if (perSec < 1) return "idle";
  if (channel === "text") return `${Math.round(perSec)} ch/s`;
  if (channel === "tokens") return `${Math.round(perSec)} tok/s`;
  return `${Math.round(perSec)}/s`;
}

function ActivityRow({
  session,
  channel,
}: {
  session: string;
  channel: ActivityChannel;
}): React.ReactElement {
  const descriptor = ACTIVITY_DESCRIPTORS[channel];
  const readoutRef = useRef<HTMLSpanElement | null>(null);

  const getSeries = useCallback(
    (nowMs: number): number[] => {
      const store = getSessionActivityStore();
      return store !== null ? store.series(session, channel, nowMs) : [];
    },
    [session, channel],
  );
  // Fix the line's hue to this channel's descriptor color.
  const getColorChannel = useCallback((): string => channel, [channel]);

  // Live raw readout, written imperatively at the gauge cadence ([L06]).
  useEffect(() => {
    const paint = (): void => {
      const el = readoutRef.current;
      if (el !== null) el.textContent = readoutFor(session, channel, Date.now());
    };
    paint();
    const timer = window.setInterval(paint, ACTIVITY_BIN_MS * 4);
    return () => window.clearInterval(timer);
  }, [session, channel]);

  return (
    <div className="dev-activity-row" data-activity-channel={channel}>
      <span className="dev-activity-row-label">{CHANNEL_LABEL[channel]}</span>
      <TugSparkline
        getSeries={getSeries}
        getColorChannel={getColorChannel}
        binMs={ACTIVITY_BIN_MS}
        fullScale={descriptor.fullScale}
        curve={descriptor.curve}
        width={120}
        height={18}
        className="dev-activity-row-spark"
        title={`${CHANNEL_LABEL[channel]} activity`}
      />
      <span ref={readoutRef} className="dev-activity-row-readout" />
    </div>
  );
}

export function DevActivityCard({
  session,
}: {
  session: string;
}): React.ReactElement {
  // Membership (which channels exist) is the only activity state React reads
  // ([L02], [P03]); the series/readouts are imperative.
  const snapshot = useSessionActivity();
  const channels = session.length > 0 ? snapshot.sessions.get(session) ?? [] : [];

  return (
    <div className="dev-activity-card" data-slot="dev-activity-card">
      <div className="dev-activity-card-title">Activity</div>
      <div className="dev-activity-card-rule" />
      {channels.length === 0 ? (
        <div className="dev-activity-empty">No activity yet.</div>
      ) : (
        channels.map((channel) => (
          <ActivityRow key={channel} session={session} channel={channel} />
        ))
      )}
    </div>
  );
}
