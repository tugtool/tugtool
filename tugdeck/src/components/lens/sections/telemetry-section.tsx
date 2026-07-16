/**
 * telemetry-section.tsx — the Lens **Telemetry** section.
 *
 * Follows the **last non-lens key card** ([P11]): the Lens is always
 * present chrome, so "the session card I'm working in" is the natural
 * subject. Because focusing the Lens itself makes *it* the key card, the
 * section remembers the previous key card that is not the Lens rather
 * than the literal current one. It resolves that card's services,
 * projects its telemetry (reusing the relocated `TelemetryInspector`),
 * names the card, and empty-states when none exists.
 *
 * Host-agnostic ([P07]): the section reads `focusManager` +
 * `cardServicesStore` directly and takes only `lensCardId` from the host
 * (to exclude the Lens from the follow).
 *
 * @module components/lens/sections/telemetry-section
 */

import React, { useCallback, useSyncExternalStore } from "react";
import { Activity } from "lucide-react";
import { cardServicesStore } from "@/lib/card-services-store";
import { TelemetryInspector } from "@/components/lens/internal/telemetry-inspector";
import { useLensFollowedCard } from "../lens-followed-card";
import { registerLensSection } from "../lens-section-registry";
import "./telemetry-section.css";

interface FollowedCardInfo {
  cardId: string;
  displayLabel: string;
  phase: string;
}

/** Resolve the followed card's identity + a live phase for naming and
 *  the collapsed stat. `null` when no non-lens card has been focused.
 *  The followed id comes from the shared `LensContent` tracker ([P11]),
 *  so the body and collapsed-summary agree across collapse toggles. */
function useFollowedCardInfo(): FollowedCardInfo | null {
  const followedId = useLensFollowedCard();
  const services = useSyncExternalStore(
    cardServicesStore.subscribe,
    useCallback(
      () => (followedId ? cardServicesStore.getServices(followedId) : null),
      [followedId],
    ),
  );
  const snapshot = useSyncExternalStore(
    useCallback(
      (cb: () => void) => services?.codeSessionStore.subscribe(cb) ?? (() => {}),
      [services],
    ),
    useCallback(() => services?.codeSessionStore.getSnapshot() ?? null, [services]),
  );
  if (followedId === null || services === null) return null;
  return {
    cardId: followedId,
    displayLabel: snapshot?.displayLabel ?? followedId,
    phase: snapshot?.phase ?? "idle",
  };
}

function TelemetryCollapsedSummary(): React.ReactElement {
  const info = useFollowedCardInfo();
  if (info === null) return <>No card</>;
  return <>{`${info.displayLabel} · ${info.phase}`}</>;
}

function TelemetrySectionBody(): React.ReactElement {
  const info = useFollowedCardInfo();
  if (info === null) {
    return (
      <div className="lens-telemetry-empty" data-testid="lens-telemetry-empty">
        No session card in focus.
      </div>
    );
  }
  return (
    <div className="lens-telemetry" data-testid="lens-telemetry">
      <div className="lens-telemetry-card-name" data-testid="lens-telemetry-card-name">
        {info.displayLabel}
      </div>
      <TelemetryInspector selectedCardId={info.cardId} />
    </div>
  );
}

/** Register the Telemetry section. Called once at boot from `main.tsx`. */
export function registerTelemetrySection(): void {
  registerLensSection({
    kind: "telemetry",
    title: "Telemetry",
    glyph: <Activity size={14} />,
    collapsedSummary: () => <TelemetryCollapsedSummary />,
    body: () => <TelemetrySectionBody />,
  });
}
