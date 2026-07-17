/**
 * TugShade — a top-anchored working layer over a live surface.
 *
 * A Shade descends from the top of its positioned parent and covers part of
 * the surface beneath, which stays visible and live below its bottom edge —
 * no scrim, no focus trap, no modality. A grabber strip on the Shade's
 * bottom edge drags its height: down covers more of the surface, up reveals
 * more. Height is a fraction of the parent's height, clamped to
 * [`minHeight`px, 100%], persisted app-wide through tugbank defaults under
 * `persistKey`. Contrast with TugSheet, whose contract is modal + scrimmed +
 * world-stopping; a Shade is an inspection layer, not a dialog.
 *
 * The drag writes the height fraction straight onto the root element's
 * `--tug-shade-frac` custom property (no React state, no re-render per
 * pointer move); the fraction persists on release. The persisted value
 * enters React through `useSyncExternalStore` over the tugbank cache, so
 * every Shade sharing a `persistKey` tracks the same height.
 *
 * Laws: [L02] tugbank value enters via `useSyncExternalStore`, [L06]
 *       appearance via CSS/DOM (drag mutates a custom property), [L15]
 *       token-driven states, [L16] pairings declared, [L19] component
 *       authoring guide
 */

import "./tug-shade.css";

import React from "react";

import { cn } from "@/lib/utils";
import { getTugbankClient } from "@/lib/tugbank-singleton";

/** Tugbank domain holding persisted Shade height fractions, keyed by `persistKey`. */
export const SHADE_HEIGHT_DOMAIN = "dev.tugtool.dev.shade-height";

/** Default height fraction when no persisted value exists. */
const DEFAULT_FRAC = 0.58;

/** Hard floor/ceiling on the stored fraction (the px floor clamps via CSS). */
const MIN_FRAC = 0.1;
const MAX_FRAC = 1;

function clampFrac(frac: number): number {
  return Math.min(MAX_FRAC, Math.max(MIN_FRAC, frac));
}

/** Read the persisted fraction for `persistKey`, or null when unset/invalid. */
function getPersistedFrac(persistKey: string): number | null {
  const client = getTugbankClient();
  if (client === null) return null;
  const raw = client.getValue(SHADE_HEIGHT_DOMAIN, persistKey);
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return clampFrac(raw);
}

/** Subscribe to tugbank changes for the shade-height domain. */
function subscribeShadeHeightDomain(onChange: () => void): () => void {
  const client = getTugbankClient();
  if (client === null) return () => {};
  return client.onDomainChanged((domain) => {
    if (domain === SHADE_HEIGHT_DOMAIN) onChange();
  });
}

/** Persist `frac` for `persistKey`: optimistic local cache + fire-and-forget PUT. */
function writePersistedFrac(persistKey: string, frac: number): void {
  const client = getTugbankClient();
  if (client !== null) {
    client.setLocalValue(SHADE_HEIGHT_DOMAIN, persistKey, {
      kind: "json",
      value: frac,
    });
  }
  const url = `/api/defaults/${SHADE_HEIGHT_DOMAIN}/${encodeURIComponent(persistKey)}`;
  fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "json", value: frac }),
  }).catch((err) => {
    console.warn(`[tug-shade] PUT failed for key ${persistKey}:`, err);
  });
}

export interface TugShadeProps extends React.ComponentPropsWithoutRef<"div"> {
  /**
   * Tugbank key the height fraction persists under. Shades sharing a key
   * share a height (e.g. the Session card's `±`/`↺` views).
   */
  persistKey: string;
  /**
   * Pixel floor for the Shade's height — it can never be dragged shorter.
   * Applied as a CSS `min-height`. @default 160
   */
  minHeight?: number;
  /** Accessible label for the resize grabber. @default "Resize" */
  grabberLabel?: string;
  children?: React.ReactNode;
}

export const TugShade = React.forwardRef<HTMLDivElement, TugShadeProps>(
  function TugShade(
    {
      persistKey,
      minHeight = 160,
      grabberLabel = "Resize",
      className,
      style,
      children,
      ...rest
    },
    ref,
  ) {
    const rootRef = React.useRef<HTMLDivElement | null>(null);
    const rootRefCallback = React.useCallback(
      (el: HTMLDivElement | null) => {
        rootRef.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref !== null) ref.current = el;
      },
      [ref],
    );

    // Persisted fraction via tugbank ([L02]). Re-renders when any Shade
    // sharing the key commits a new height.
    const getSnapshot = React.useCallback(
      () => getPersistedFrac(persistKey),
      [persistKey],
    );
    const persistedFrac = React.useSyncExternalStore(
      subscribeShadeHeightDomain,
      getSnapshot,
    );
    const frac = persistedFrac ?? DEFAULT_FRAC;

    // Grabber drag: pointer capture on the grabber, fraction computed against
    // the positioned parent's box, written straight to the root's custom
    // property ([L06] — zero re-renders while dragging). Release persists.
    const handleGrabberPointerDown = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        const root = rootRef.current;
        const parent = root?.parentElement ?? null;
        if (root === null || parent === null) return;
        event.preventDefault();
        const grabber = event.currentTarget;
        grabber.setPointerCapture(event.pointerId);
        const parentRect = parent.getBoundingClientRect();
        if (parentRect.height <= 0) return;
        let liveFrac = frac;

        const onMove = (move: PointerEvent): void => {
          liveFrac = clampFrac(
            (move.clientY - parentRect.top) / parentRect.height,
          );
          root.style.setProperty("--tug-shade-frac", String(liveFrac));
        };
        const onUp = (): void => {
          grabber.removeEventListener("pointermove", onMove);
          grabber.removeEventListener("pointerup", onUp);
          grabber.removeEventListener("pointercancel", onUp);
          writePersistedFrac(persistKey, liveFrac);
        };
        grabber.addEventListener("pointermove", onMove);
        grabber.addEventListener("pointerup", onUp);
        grabber.addEventListener("pointercancel", onUp);
      },
      [frac, persistKey],
    );

    return (
      <div
        ref={rootRefCallback}
        data-slot="tug-shade"
        className={cn("tug-shade", className)}
        style={{
          ["--tug-shade-frac" as string]: String(frac),
          minHeight: `${minHeight}px`,
          ...style,
        }}
        {...rest}
      >
        <div className="tug-shade-content">{children}</div>
        <div
          className="tug-shade-grabber"
          role="separator"
          aria-orientation="horizontal"
          aria-label={grabberLabel}
          data-tug-focus="refuse"
          data-no-activate=""
          onPointerDown={handleGrabberPointerDown}
        >
          <div className="tug-shade-grabber-handle" />
        </div>
      </div>
    );
  },
);
