/**
 * gallery-animator.tsx -- TugAnimator interactive demo tab.
 *
 * Showcases the TugAnimator API: physics solvers, animate() with duration
 * tokens, cancellation modes, and named slot coordination.
 *
 * Architecture: every demo stage follows the track/dot pattern:
 *   <TugBox> → <div ref={trackRef} style={{ position:"relative", height:N }}>
 *                <div ref={dotRef} className="cg-anim-dot ..." />  (position:absolute)
 *              </div>
 * Measurement: range = trackRef.current.clientWidth - DOT_SIZE (or clientHeight)
 * ResizeObserver observes the track div directly.
 *
 * Rules of Tugways compliance:
 *   - Slider/toggle state uses useState for local UI state only [D40]
 *   - Animations use the real WAAPI via tug-animator.ts animate() [D08, D09]
 *   - useEffect cleanup cancels running animations on unmount [D40]
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-animator
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import { TugBox } from "@/components/tugways/tug-box";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import {
  animate,
  SpringSolver,
  GravitySolver,
  FrictionSolver,
  DURATION_TOKEN_MAP,
} from "@/components/tugways/tug-animator";
import type { TugAnimation } from "@/components/tugways/tug-animator";
import { TugLabel } from "@/components/tugways/tug-label";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_LABELS: { token: string; label: string }[] = [
  { token: "--tug-motion-duration-instant", label: "Instant (0ms)" },
  { token: "--tug-motion-duration-fast", label: "Fast (100ms)" },
  { token: "--tug-motion-duration-moderate", label: "Moderate (200ms)" },
  { token: "--tug-motion-duration-slow", label: "Slow (350ms)" },
  { token: "--tug-motion-duration-glacial", label: "Glacial (500ms)" },
];

/** Size of the animated dot in px (matches CSS .cg-anim-dot width/height). */
const DOT_SIZE = 16;
/** Size of the token box in px (matches CSS .cg-anim-token-box width). */
const TOKEN_BOX_SIZE = 24;
/** Size of the cancel/slot boxes in px (matches CSS width). */
const LARGE_BOX_SIZE = 32;

// ---------------------------------------------------------------------------
// useResizeReset -- reset animations when a track div is resized
// ---------------------------------------------------------------------------

/**
 * Observe a track element for resize and call reset when the size changes.
 * Skips the initial ResizeObserver fire on mount.
 */
function useResizeReset(
  trackRef: React.RefObject<HTMLElement | null>,
  reset: () => void,
) {
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let first = true;
    const obs = new ResizeObserver(() => {
      if (first) { first = false; return; }
      reset();
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [trackRef, reset]);
}

// ---------------------------------------------------------------------------
// PercentSlider -- shared control for track usage percentage
// ---------------------------------------------------------------------------

function PercentSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="cg-anim-pct-row">
      <span>Travel</span>
      <input
        type="range"
        className="cg-anim-pct-range"
        min={10}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
      />
      <TugLabel size="2xs" mono>{`${value}%`}</TugLabel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PhysicsCurvesDemo
// ---------------------------------------------------------------------------

function PhysicsCurvesDemo() {
  // Track refs — the measurement surfaces (position: relative, explicit height)
  const springTrackRef = useRef<HTMLDivElement>(null);
  const gravityTrackRef = useRef<HTMLDivElement>(null);
  const frictionTrackRef = useRef<HTMLDivElement>(null);
  // Dot refs — the animated elements (position: absolute via CSS)
  const springDotRef = useRef<HTMLDivElement>(null);
  const gravityDotRef = useRef<HTMLDivElement>(null);
  const frictionDotRef = useRef<HTMLDivElement>(null);

  const animsRef = useRef<TugAnimation[]>([]);
  const [pct, setPct] = useState(100);

  const cancelAll = useCallback(() => {
    for (const a of animsRef.current) {
      a.cancel("snap-to-end");
    }
    animsRef.current = [];
  }, []);

  const resetAll = useCallback(() => {
    for (const a of animsRef.current) {
      a.finished.catch(() => {});
      a.raw.cancel();
    }
    animsRef.current = [];
    for (const ref of [springDotRef, gravityDotRef, frictionDotRef]) {
      if (ref.current) {
        ref.current.style.transform = "";
      }
    }
  }, []);

  const playAll = useCallback(() => {
    cancelAll();

    const duration = 1500;
    const scale = pct / 100;

    if (springDotRef.current && springTrackRef.current) {
      const range = (springTrackRef.current.clientWidth - DOT_SIZE) * scale;
      const solver = new SpringSolver();
      const kf = solver.keyframes(duration);
      const frames = kf.map((v) => ({ transform: `translateX(${v * range}px)` }));
      animsRef.current.push(
        animate(springDotRef.current, frames, { duration, easing: "linear" })
      );
    }

    if (gravityDotRef.current && gravityTrackRef.current) {
      const range = (gravityTrackRef.current.clientHeight - DOT_SIZE) * scale;
      const solver = new GravitySolver({ coefficientOfRestitution: 0.5 });
      const kf = solver.keyframes(duration);
      const frames = kf.map((v) => ({ transform: `translateY(${(1 - v) * range}px)` }));
      animsRef.current.push(
        animate(gravityDotRef.current, frames, { duration, easing: "linear" })
      );
    }

    if (frictionDotRef.current && frictionTrackRef.current) {
      const range = (frictionTrackRef.current.clientWidth - DOT_SIZE) * scale;
      const solver = new FrictionSolver({ initialVelocity: 8, friction: 3 });
      const kf = solver.keyframes(duration);
      // Normalize so friction ends at the same position as spring (1.0)
      const maxVal = kf[kf.length - 1] || 1;
      const frames = kf.map((v) => ({ transform: `translateX(${(v / maxVal) * range}px)` }));
      animsRef.current.push(
        animate(frictionDotRef.current, frames, { duration, easing: "linear" })
      );
    }
  }, [cancelAll, pct]);

  // Observe the spring track for resize — reset all three when it changes
  useResizeReset(springTrackRef, resetAll);

  useEffect(() => {
    return () => { cancelAll(); };
  }, [cancelAll]);

  return (
    <div className="cg-section">
      <TugLabel className="cg-section-title">Physics Solvers</TugLabel>
      <TugLabel size="2xs" color="muted">Pre-computed keyframe arrays from SpringSolver, GravitySolver, and FrictionSolver drive WAAPI animations with physically-accurate motion.</TugLabel>
      <div className="cg-anim-stages" data-testid="anim-physics-stage">
        {/* Spring — horizontal */}
        <TugBox
          variant="filled"
          resize="horizontal"
          rounded="sm"
          size="sm"
          label="Spring"
          labelPosition="above"
          style={{ width: "50%", minWidth: 120 }}
        >
          <div ref={springTrackRef} style={{ position: "relative", height: 24 }}>
            <div ref={springDotRef} className="cg-anim-dot" />
          </div>
        </TugBox>

        {/* Friction — horizontal */}
        <TugBox
          variant="filled"
          resize="horizontal"
          rounded="sm"
          size="sm"
          label="Friction"
          labelPosition="above"
          style={{ width: "50%", minWidth: 120 }}
        >
          <div ref={frictionTrackRef} style={{ position: "relative", height: 24 }}>
            <div ref={frictionDotRef} className="cg-anim-dot" />
          </div>
        </TugBox>

        {/* Gravity — vertical, needs taller track */}
        <TugBox
          variant="filled"
          resize="horizontal"
          rounded="sm"
          size="sm"
          label="Gravity"
          labelPosition="above"
          style={{ width: "50%", minWidth: 120 }}
        >
          <div ref={gravityTrackRef} style={{ position: "relative", height: 120 }}>
            <div ref={gravityDotRef} className="cg-anim-dot" style={{ top: 0 }} />
          </div>
        </TugBox>
      </div>
      <div className="cg-variant-row">
        <TugPushButton size="sm" onClick={playAll}>
          Play All
        </TugPushButton>
        <TugPushButton emphasis="ghost" size="sm" onClick={resetAll}>
          Reset
        </TugPushButton>
        <PercentSlider value={pct} onChange={setPct} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DurationTokensDemo
// ---------------------------------------------------------------------------

function DurationTokensDemo() {
  const trackRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<TugAnimation | null>(null);
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const [pct, setPct] = useState(100);

  const reset = useCallback(() => {
    if (animRef.current) {
      animRef.current.finished.catch(() => {});
      animRef.current.raw.cancel();
      animRef.current = null;
    }
    if (boxRef.current) {
      boxRef.current.style.transform = "";
    }
    setActiveToken(null);
  }, []);

  const playToken = useCallback((token: string) => {
    if (!boxRef.current || !trackRef.current) return;
    if (animRef.current) {
      animRef.current.cancel("snap-to-end");
    }
    setActiveToken(token);
    const range = (trackRef.current.clientWidth - TOKEN_BOX_SIZE) * (pct / 100);
    boxRef.current.style.transform = "translateX(0)";
    animRef.current = animate(
      boxRef.current,
      [{ transform: "translateX(0)" }, { transform: `translateX(${range}px)` }],
      { duration: token, key: "token-demo" }
    );
    animRef.current.finished.then(() => setActiveToken(null)).catch(() => {});
  }, [pct]);

  useResizeReset(trackRef, reset);

  useEffect(() => {
    return () => { animRef.current?.cancel("snap-to-end"); };
  }, []);

  return (
    <div className="cg-section">
      <TugLabel className="cg-section-title">Duration Tokens</TugLabel>
      <TugLabel size="2xs" color="muted">Duration tokens resolve to base ms values scaled by getTugTiming(). Click each to see the speed difference.</TugLabel>
      <TugBox
        variant="filled"
        resize="horizontal"
        rounded="md"
        size="sm"
        data-testid="anim-token-stage"
        style={{ width: "50%", minWidth: 120 }}
      >
        <div ref={trackRef} style={{ position: "relative", height: 32 }}>
          <div ref={boxRef} className="cg-anim-token-box" />
        </div>
      </TugBox>
      <div className="cg-variant-row">
        {TOKEN_LABELS.map(({ token, label }) => (
          <TugPushButton
            key={token}
            emphasis={activeToken === token ? "filled" : "outlined"}
            role="action"
            size="sm"
            onClick={() => playToken(token)}
          >
            {label}
          </TugPushButton>
        ))}
      </div>
      <div className="cg-variant-row">
        <TugPushButton emphasis="ghost" size="sm" onClick={reset}>
          Reset
        </TugPushButton>
        <PercentSlider value={pct} onChange={setPct} />
      </div>
      <div className="cg-anim-token-legend">
        {Object.entries(DURATION_TOKEN_MAP).map(([token, ms]) => (
          <div key={token} className="cg-anim-token-entry">
            <code>{token.replace("--tug-motion-duration-", "")}</code>
            <span>{ms}ms</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CancelModesDemo
// ---------------------------------------------------------------------------

function CancelModesDemo() {
  const trackRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<TugAnimation | null>(null);
  const [status, setStatus] = useState("idle");
  const [pct, setPct] = useState(100);

  const reset = useCallback(() => {
    if (animRef.current) {
      animRef.current.finished.catch(() => {});
      animRef.current.raw.cancel();
      animRef.current = null;
    }
    if (boxRef.current) {
      boxRef.current.style.transform = "";
      boxRef.current.style.opacity = "";
    }
    setStatus("idle");
  }, []);

  const startAnimation = useCallback(() => {
    if (!boxRef.current || !trackRef.current) return;
    boxRef.current.style.transform = "";
    boxRef.current.style.opacity = "";
    const range = (trackRef.current.clientWidth - LARGE_BOX_SIZE) * (pct / 100);
    animRef.current = animate(
      boxRef.current,
      [
        { transform: "translateX(0)", opacity: 1 },
        { transform: `translateX(${range}px)`, opacity: 0.3 },
      ],
      { duration: 2000, easing: "linear", key: "cancel-demo" }
    );
    setStatus("running");
    animRef.current.finished
      .then(() => setStatus("finished"))
      .catch(() => setStatus("cancelled"));
  }, [pct]);

  const cancelWith = useCallback((mode: "snap-to-end" | "hold-at-current" | "reverse-from-current") => {
    if (!animRef.current) return;
    animRef.current.cancel(mode);
    setStatus(`${mode}`);
    if (mode === "reverse-from-current") {
      animRef.current.finished
        .then(() => setStatus("reversed"))
        .catch(() => {});
    }
  }, []);

  useResizeReset(trackRef, reset);

  useEffect(() => {
    return () => { animRef.current?.cancel("snap-to-end"); };
  }, []);

  return (
    <div className="cg-section">
      <TugLabel className="cg-section-title">Cancellation Modes</TugLabel>
      <TugLabel size="2xs" color="muted">Start a slow animation, then cancel it with each mode to see the difference. snap-to-end jumps to final state, hold-at-current freezes in place, reverse-from-current animates back to start.</TugLabel>
      <TugBox
        variant="filled"
        resize="horizontal"
        rounded="md"
        size="sm"
        data-testid="anim-cancel-stage"
        style={{ width: "50%", minWidth: 120 }}
      >
        <div ref={trackRef} style={{ position: "relative", height: 40 }}>
          <div ref={boxRef} className="cg-anim-cancel-box" />
        </div>
      </TugBox>
      <div className="cg-variant-row">
        <TugPushButton size="sm" onClick={startAnimation}>
          Start
        </TugPushButton>
        <TugPushButton size="sm" onClick={() => cancelWith("snap-to-end")}>
          Snap to End
        </TugPushButton>
        <TugPushButton size="sm" onClick={() => cancelWith("hold-at-current")}>
          Hold at Current
        </TugPushButton>
        <TugPushButton size="sm" onClick={() => cancelWith("reverse-from-current")}>
          Reverse
        </TugPushButton>
      </div>
      <div className="cg-variant-row">
        <TugPushButton emphasis="ghost" size="sm" onClick={reset}>
          Reset
        </TugPushButton>
        <PercentSlider value={pct} onChange={setPct} />
      </div>
      <TugLabel size="2xs" color="muted" data-testid="anim-cancel-status">{`Status: ${status}`}</TugLabel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NamedSlotsDemo
// ---------------------------------------------------------------------------

function NamedSlotsDemo() {
  const trackRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const animsRef = useRef<TugAnimation[]>([]);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [pct, setPct] = useState(100);

  const reset = useCallback(() => {
    for (const a of animsRef.current) {
      a.finished.catch(() => {});
      a.raw.cancel();
    }
    animsRef.current = [];
    if (boxRef.current) {
      boxRef.current.style.transform = "";
      boxRef.current.style.opacity = "";
    }
    setLastAction(null);
  }, []);

  const animateToRight = useCallback(() => {
    if (!boxRef.current || !trackRef.current) return;
    const range = (trackRef.current.clientWidth - LARGE_BOX_SIZE) * (pct / 100);
    const a = animate(
      boxRef.current,
      [{ transform: `translateX(${range}px)` }],
      { duration: "--tug-motion-duration-slow", key: "slot-demo" }
    );
    animsRef.current.push(a);
    setLastAction("animate \u2192 right (key: slot-demo)");
  }, [pct]);

  const animateToLeft = useCallback(() => {
    if (!boxRef.current) return;
    const a = animate(
      boxRef.current,
      [{ transform: "translateX(0)" }],
      { duration: "--tug-motion-duration-slow", key: "slot-demo" }
    );
    animsRef.current.push(a);
    setLastAction("animate \u2192 left (key: slot-demo, cancels previous)");
  }, []);

  const animateDifferentKey = useCallback(() => {
    if (!boxRef.current) return;
    const a = animate(
      boxRef.current,
      [{ opacity: 0.3 }, { opacity: 1 }],
      { duration: "--tug-motion-duration-moderate", key: "opacity-slot" }
    );
    animsRef.current.push(a);
    setLastAction("animate opacity (key: opacity-slot, coexists)");
  }, []);

  useResizeReset(trackRef, reset);

  useEffect(() => {
    return () => {
      for (const a of animsRef.current) {
        a.finished.catch(() => {});
        a.raw.cancel();
      }
    };
  }, []);

  return (
    <div className="cg-section">
      <TugLabel className="cg-section-title">Named Slots</TugLabel>
      <TugLabel size="2xs" color="muted">Animations with the same key on the same element automatically cancel the previous one. Different keys coexist independently.</TugLabel>
      <TugBox
        variant="filled"
        resize="horizontal"
        rounded="md"
        size="sm"
        data-testid="anim-slot-stage"
        style={{ width: "50%", minWidth: 120 }}
      >
        <div ref={trackRef} style={{ position: "relative", height: 40 }}>
          <div ref={boxRef} className="cg-anim-slot-box" />
        </div>
      </TugBox>
      <div className="cg-variant-row">
        <TugPushButton size="sm" onClick={animateToRight}>
          &rarr; Right (slot-demo)
        </TugPushButton>
        <TugPushButton size="sm" onClick={animateToLeft}>
          &larr; Left (slot-demo)
        </TugPushButton>
        <TugPushButton emphasis="ghost" size="sm" onClick={animateDifferentKey}>
          Fade (opacity-slot)
        </TugPushButton>
      </div>
      <div className="cg-variant-row">
        <TugPushButton emphasis="ghost" size="sm" onClick={reset}>
          Reset
        </TugPushButton>
        <PercentSlider value={pct} onChange={setPct} />
      </div>
      {lastAction !== null && (
        <TugLabel size="2xs" color="muted" data-testid="anim-slot-status">{lastAction}</TugLabel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryAnimator
// ---------------------------------------------------------------------------

/**
 * GalleryAnimator -- TugAnimator interactive demo tab.
 *
 * Four sections: physics solvers, duration tokens, cancellation modes,
 * and named slot coordination.
 */
export function GalleryAnimator() {
  return (
    <div className="cg-content" data-testid="gallery-animator">
      <PhysicsCurvesDemo />
      <div className="cg-divider" />
      <DurationTokensDemo />
      <div className="cg-divider" />
      <CancelModesDemo />
      <div className="cg-divider" />
      <NamedSlotsDemo />
    </div>
  );
}
