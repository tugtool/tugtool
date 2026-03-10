/**
 * gallery-animator-content.tsx -- TugAnimator interactive demo tab.
 *
 * Showcases the TugAnimator API: physics solvers, animate() with duration
 * tokens, cancellation modes, and named slot coordination.
 *
 * Rules of Tugways compliance:
 *   - Slider/toggle state uses useState for local UI state only [D40]
 *   - Animations use the real WAAPI via tug-animator.ts animate() [D08, D09]
 *   - useEffect cleanup cancels running animations on unmount [D40]
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-animator-content
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import { TugButton } from "@/components/tugways/tug-button";
import {
  animate,
  SpringSolver,
  GravitySolver,
  FrictionSolver,
  DURATION_TOKEN_MAP,
} from "@/components/tugways/tug-animator";
import type { TugAnimation } from "@/components/tugways/tug-animator";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_LABELS: { token: string; label: string }[] = [
  { token: "--tug-base-motion-duration-instant", label: "Instant (0ms)" },
  { token: "--tug-base-motion-duration-fast", label: "Fast (100ms)" },
  { token: "--tug-base-motion-duration-moderate", label: "Moderate (200ms)" },
  { token: "--tug-base-motion-duration-slow", label: "Slow (350ms)" },
  { token: "--tug-base-motion-duration-glacial", label: "Glacial (500ms)" },
];

/** Size of the animated dot in px (matches CSS .cg-anim-dot width/height). */
const DOT_SIZE = 16;
/** Size of the token box in px (matches CSS .cg-anim-token-box width). */
const TOKEN_BOX_SIZE = 24;
/** Size of the cancel/slot boxes in px (matches CSS width). */
const LARGE_BOX_SIZE = 32;
/** Left margin on boxes inside stages (matches CSS margin-left). */
const STAGE_MARGIN = 8;

// ---------------------------------------------------------------------------
// useResizeReset -- reset animations when a stage is resized
// ---------------------------------------------------------------------------

/**
 * Observe a stage element for resize (CSS `resize: horizontal`) and call
 * reset when the size changes. Skips the initial ResizeObserver fire on mount.
 */
function useResizeReset(
  stageRef: React.RefObject<HTMLElement | null>,
  reset: () => void,
) {
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let first = true;
    const obs = new ResizeObserver(() => {
      if (first) { first = false; return; }
      reset();
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [stageRef, reset]);
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
      <span className="cg-anim-pct-value">{value}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PhysicsCurvesDemo
// ---------------------------------------------------------------------------

function PhysicsCurvesDemo() {
  const stageRef = useRef<HTMLDivElement>(null);
  const springRef = useRef<HTMLDivElement>(null);
  const gravityRef = useRef<HTMLDivElement>(null);
  const frictionRef = useRef<HTMLDivElement>(null);
  const springTrackRef = useRef<HTMLDivElement>(null);
  const gravityTrackRef = useRef<HTMLDivElement>(null);
  const frictionTrackRef = useRef<HTMLDivElement>(null);
  const animsRef = useRef<TugAnimation[]>([]);
  const [pct, setPct] = useState(100);

  const cancelAll = useCallback(() => {
    for (const a of animsRef.current) {
      a.cancel("snap-to-end");
    }
    animsRef.current = [];
  }, []);

  const resetAll = useCallback(() => {
    // Cancel WAAPI animations entirely (removes fill) then clear inline styles.
    for (const a of animsRef.current) {
      a.finished.catch(() => {});
      a.raw.cancel();
    }
    animsRef.current = [];
    for (const ref of [springRef, gravityRef, frictionRef]) {
      if (ref.current) {
        ref.current.style.transform = "";
      }
    }
  }, []);

  const playAll = useCallback(() => {
    cancelAll();

    const duration = 1500;
    const scale = pct / 100;

    if (springRef.current && springTrackRef.current) {
      const range = (springTrackRef.current.clientWidth - DOT_SIZE) * scale;
      const solver = new SpringSolver({ stiffness: 120, damping: 12 });
      const kf = solver.keyframes(duration);
      const frames = kf.map((v) => ({ transform: `translateX(${v * range}px)` }));
      animsRef.current.push(
        animate(springRef.current, frames, { duration, easing: "linear" })
      );
    }

    if (gravityRef.current && gravityTrackRef.current) {
      const range = (gravityTrackRef.current.clientHeight - DOT_SIZE) * scale;
      const solver = new GravitySolver({ coefficientOfRestitution: 0.5 });
      const kf = solver.keyframes(duration);
      const frames = kf.map((v) => ({ transform: `translateY(${(1 - v) * range}px)` }));
      animsRef.current.push(
        animate(gravityRef.current, frames, { duration, easing: "linear" })
      );
    }

    if (frictionRef.current && frictionTrackRef.current) {
      const range = (frictionTrackRef.current.clientWidth - DOT_SIZE) * scale;
      const solver = new FrictionSolver({ initialVelocity: 8, friction: 3 });
      const kf = solver.keyframes(duration);
      const frames = kf.map((v) => ({ transform: `translateX(${v * range}px)` }));
      animsRef.current.push(
        animate(frictionRef.current, frames, { duration, easing: "linear" })
      );
    }
  }, [cancelAll, pct]);

  useResizeReset(stageRef, resetAll);

  useEffect(() => {
    return () => { cancelAll(); };
  }, [cancelAll]);

  return (
    <div className="cg-section">
      <div className="cg-section-title">Physics Solvers</div>
      <p className="cg-description">
        Pre-computed keyframe arrays from SpringSolver, GravitySolver, and FrictionSolver
        drive WAAPI animations with physically-accurate motion.
      </p>
      <div ref={stageRef} className="cg-anim-physics-stage" data-testid="anim-physics-stage">
        <div className="cg-anim-physics-lane">
          <span className="cg-anim-physics-label">Spring</span>
          <div ref={springTrackRef} className="cg-anim-physics-track">
            <div ref={springRef} className="cg-anim-dot cg-anim-dot-spring" />
          </div>
        </div>
        <div className="cg-anim-physics-lane">
          <span className="cg-anim-physics-label">Gravity</span>
          <div ref={gravityTrackRef} className="cg-anim-physics-track cg-anim-physics-track-tall">
            <div ref={gravityRef} className="cg-anim-dot cg-anim-dot-gravity" />
          </div>
        </div>
        <div className="cg-anim-physics-lane">
          <span className="cg-anim-physics-label">Friction</span>
          <div ref={frictionTrackRef} className="cg-anim-physics-track">
            <div ref={frictionRef} className="cg-anim-dot cg-anim-dot-friction" />
          </div>
        </div>
      </div>
      <div className="cg-variant-row">
        <TugButton subtype="push" variant="secondary" size="sm" onClick={playAll}>
          Play All
        </TugButton>
        <TugButton subtype="push" variant="ghost" size="sm" onClick={resetAll}>
          Reset
        </TugButton>
        <PercentSlider value={pct} onChange={setPct} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DurationTokensDemo
// ---------------------------------------------------------------------------

function DurationTokensDemo() {
  const boxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
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
    if (!boxRef.current || !stageRef.current) return;
    if (animRef.current) {
      animRef.current.cancel("snap-to-end");
    }
    setActiveToken(token);
    const range = (stageRef.current.clientWidth - TOKEN_BOX_SIZE - STAGE_MARGIN * 2) * (pct / 100);
    boxRef.current.style.transform = "translateX(0)";
    animRef.current = animate(
      boxRef.current,
      [{ transform: "translateX(0)" }, { transform: `translateX(${range}px)` }],
      { duration: token, key: "token-demo" }
    );
    animRef.current.finished.then(() => setActiveToken(null)).catch(() => {});
  }, [pct]);

  useResizeReset(stageRef, reset);

  useEffect(() => {
    return () => { animRef.current?.cancel("snap-to-end"); };
  }, []);

  return (
    <div className="cg-section">
      <div className="cg-section-title">Duration Tokens</div>
      <p className="cg-description">
        Duration tokens resolve to base ms values scaled by{" "}
        <code>getTugTiming()</code>. Click each to see the speed difference.
      </p>
      <div ref={stageRef} className="cg-anim-token-stage" data-testid="anim-token-stage">
        <div ref={boxRef} className="cg-anim-token-box" />
      </div>
      <div className="cg-variant-row">
        {TOKEN_LABELS.map(({ token, label }) => (
          <TugButton
            key={token}
            subtype="push"
            variant={activeToken === token ? "primary" : "secondary"}
            size="sm"
            onClick={() => playToken(token)}
          >
            {label}
          </TugButton>
        ))}
      </div>
      <div className="cg-variant-row">
        <TugButton subtype="push" variant="ghost" size="sm" onClick={reset}>
          Reset
        </TugButton>
        <PercentSlider value={pct} onChange={setPct} />
      </div>
      <div className="cg-anim-token-legend">
        {Object.entries(DURATION_TOKEN_MAP).map(([token, ms]) => (
          <div key={token} className="cg-anim-token-entry">
            <code>{token.replace("--tug-base-motion-duration-", "")}</code>
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
  const boxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
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
    if (!boxRef.current || !stageRef.current) return;
    boxRef.current.style.transform = "";
    boxRef.current.style.opacity = "";
    const range = (stageRef.current.clientWidth - LARGE_BOX_SIZE - STAGE_MARGIN * 2) * (pct / 100);
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

  useResizeReset(stageRef, reset);

  useEffect(() => {
    return () => { animRef.current?.cancel("snap-to-end"); };
  }, []);

  return (
    <div className="cg-section">
      <div className="cg-section-title">Cancellation Modes</div>
      <p className="cg-description">
        Start a slow animation, then cancel it with each mode to see the difference.
        <strong> snap-to-end</strong> jumps to final state,{" "}
        <strong>hold-at-current</strong> freezes in place,{" "}
        <strong>reverse-from-current</strong> animates back to start.
      </p>
      <div ref={stageRef} className="cg-anim-cancel-stage" data-testid="anim-cancel-stage">
        <div ref={boxRef} className="cg-anim-cancel-box" />
      </div>
      <div className="cg-variant-row">
        <TugButton subtype="push" variant="primary" size="sm" onClick={startAnimation}>
          Start
        </TugButton>
        <TugButton subtype="push" variant="secondary" size="sm" onClick={() => cancelWith("snap-to-end")}>
          Snap to End
        </TugButton>
        <TugButton subtype="push" variant="secondary" size="sm" onClick={() => cancelWith("hold-at-current")}>
          Hold at Current
        </TugButton>
        <TugButton subtype="push" variant="secondary" size="sm" onClick={() => cancelWith("reverse-from-current")}>
          Reverse
        </TugButton>
      </div>
      <div className="cg-variant-row">
        <TugButton subtype="push" variant="ghost" size="sm" onClick={reset}>
          Reset
        </TugButton>
        <PercentSlider value={pct} onChange={setPct} />
      </div>
      <div className="cg-demo-status" data-testid="anim-cancel-status">
        Status: <code>{status}</code>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NamedSlotsDemo
// ---------------------------------------------------------------------------

function NamedSlotsDemo() {
  const boxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
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
    if (!boxRef.current || !stageRef.current) return;
    const range = (stageRef.current.clientWidth - LARGE_BOX_SIZE - STAGE_MARGIN * 2) * (pct / 100);
    const a = animate(
      boxRef.current,
      [{ transform: `translateX(${range}px)` }],
      { duration: "--tug-base-motion-duration-slow", key: "slot-demo" }
    );
    animsRef.current.push(a);
    setLastAction("animate \u2192 right (key: slot-demo)");
  }, [pct]);

  const animateToLeft = useCallback(() => {
    if (!boxRef.current) return;
    const a = animate(
      boxRef.current,
      [{ transform: "translateX(0)" }],
      { duration: "--tug-base-motion-duration-slow", key: "slot-demo" }
    );
    animsRef.current.push(a);
    setLastAction("animate \u2192 left (key: slot-demo, cancels previous)");
  }, []);

  useResizeReset(stageRef, reset);

  const animateDifferentKey = useCallback(() => {
    if (!boxRef.current) return;
    const a = animate(
      boxRef.current,
      [{ opacity: 0.3 }, { opacity: 1 }],
      { duration: "--tug-base-motion-duration-moderate", key: "opacity-slot" }
    );
    animsRef.current.push(a);
    setLastAction("animate opacity (key: opacity-slot, coexists)");
  }, []);

  return (
    <div className="cg-section">
      <div className="cg-section-title">Named Slots</div>
      <p className="cg-description">
        Animations with the same <code>key</code> on the same element automatically cancel
        the previous one. Different keys coexist independently.
      </p>
      <div ref={stageRef} className="cg-anim-slot-stage" data-testid="anim-slot-stage">
        <div ref={boxRef} className="cg-anim-slot-box" />
      </div>
      <div className="cg-variant-row">
        <TugButton subtype="push" variant="secondary" size="sm" onClick={animateToRight}>
          &rarr; Right (slot-demo)
        </TugButton>
        <TugButton subtype="push" variant="secondary" size="sm" onClick={animateToLeft}>
          &larr; Left (slot-demo)
        </TugButton>
        <TugButton subtype="push" variant="ghost" size="sm" onClick={animateDifferentKey}>
          Fade (opacity-slot)
        </TugButton>
      </div>
      <div className="cg-variant-row">
        <TugButton subtype="push" variant="ghost" size="sm" onClick={reset}>
          Reset
        </TugButton>
        <PercentSlider value={pct} onChange={setPct} />
      </div>
      {lastAction !== null && (
        <div className="cg-demo-status" data-testid="anim-slot-status">
          {lastAction}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryAnimatorContent
// ---------------------------------------------------------------------------

/**
 * GalleryAnimatorContent -- TugAnimator interactive demo tab.
 *
 * Four sections: physics solvers, duration tokens, cancellation modes,
 * and named slot coordination.
 */
export function GalleryAnimatorContent() {
  return (
    <div className="cg-content" data-testid="gallery-animator-content">
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
