/**
 * GalleryBadgeMockupContent — exploratory badge redesign gallery tab.
 *
 * Self-contained mockup using custom CSS classes (badge-mockup-*).
 * Does NOT touch the real TugBadge component, tug-badge.css, or any
 * theme tokens. All styles are in gallery-badge-mockup.css.
 *
 * Explores visual differentiation between badges and buttons via:
 *   - Sliders for fg intensity/tone, bg intensity/tone/alpha, corner radius
 *   - Side-by-side comparisons with real TugPushButton for context
 */

import React, { useState } from "react";
import { Star, Circle, AlertTriangle, Check, Zap, Database, Shield } from "lucide-react";
import { TugPushButton } from "@/components/tugways/tug-button";
import {
  tugColor,
  DEFAULT_CANONICAL_L,
} from "@/components/tugways/palette-engine";
import "./gallery-badge-mockup.css";

// ---- Types ----

type MockupRole = "accent" | "action" | "agent" | "data" | "danger" | "success" | "caution";
type MockupSize = "sm" | "md" | "lg";

const ALL_ROLES: MockupRole[] = ["accent", "action", "agent", "data", "danger", "success", "caution"];

const ROLE_HUE: Record<MockupRole, string> = {
  accent:  "orange",
  action:  "blue",
  agent:   "violet",
  data:    "teal",
  danger:  "red",
  success: "green",
  caution: "yellow",
};

const ROLE_ICONS: Record<MockupRole, React.ReactNode> = {
  accent:  <Star />,
  action:  <Zap />,
  agent:   <Shield />,
  data:    <Database />,
  danger:  <AlertTriangle />,
  success: <Check />,
  caution: <Circle />,
};

// ---- Helpers ----

function roleToOklch(role: MockupRole, intensity: number, tone: number, alpha?: number): string {
  const hue = ROLE_HUE[role];
  const canonicalL = DEFAULT_CANONICAL_L[hue] ?? 0.77;
  const oklch = tugColor(hue, intensity, tone, canonicalL);
  if (alpha !== undefined && alpha < 100) {
    // oklch(L C h) → oklch(L C h / alpha)
    return oklch.replace(")", ` / ${(alpha / 100).toFixed(2)})`);
  }
  return oklch;
}

// ---- Slider ----

function MockupSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="badge-mockup-slider">
      <span className="badge-mockup-slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="badge-mockup-slider-input"
      />
      <span className="badge-mockup-slider-value">{value}</span>
    </div>
  );
}

// ---- MockupBadge ----

function MockupBadge({
  role = "action",
  size = "md",
  fgIntensity,
  fgTone,
  bgIntensity,
  bgTone,
  bgAlpha,
  borderIntensity,
  borderTone,
  borderAlpha,
  borderWidth,
  radius,
  icon,
  children,
}: {
  role?: MockupRole;
  size?: MockupSize;
  fgIntensity: number;
  fgTone: number;
  bgIntensity: number;
  bgTone: number;
  bgAlpha: number;
  borderIntensity: number;
  borderTone: number;
  borderAlpha: number;
  borderWidth: number;
  radius: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const sizeClass = `badge-mockup-${size}`;
  const fgColor = roleToOklch(role, fgIntensity, fgTone);
  const bgColor = roleToOklch(role, bgIntensity, bgTone, bgAlpha);
  const bdColor = borderAlpha > 0
    ? roleToOklch(role, borderIntensity, borderTone, borderAlpha)
    : "transparent";

  return (
    <span
      className={`badge-mockup ${sizeClass}`}
      style={{
        color: fgColor,
        backgroundColor: bgColor,
        borderRadius: `${radius}px`,
        border: `${borderWidth}px solid ${bdColor}`,
      }}
    >
      {icon && <span className="badge-mockup-icon">{icon}</span>}
      {children}
    </span>
  );
}

// ---- Content ----

// ---- Defaults ----

const DEFAULTS: Record<string, number> = {
  fgIntensity: 72,
  fgTone: 85,
  bgIntensity: 65,
  bgTone: 60,
  bgAlpha: 15,
  borderIntensity: 50,
  borderTone: 50,
  borderAlpha: 35,
  borderWidth: 1,
  radius: 2,
};

export function GalleryBadgeMockupContent() {
  const [fgIntensity, setFgIntensity] = useState(DEFAULTS.fgIntensity);
  const [fgTone, setFgTone] = useState(DEFAULTS.fgTone);

  const [bgIntensity, setBgIntensity] = useState(DEFAULTS.bgIntensity);
  const [bgTone, setBgTone] = useState(DEFAULTS.bgTone);
  const [bgAlpha, setBgAlpha] = useState(DEFAULTS.bgAlpha);

  const [borderIntensity, setBorderIntensity] = useState(DEFAULTS.borderIntensity);
  const [borderTone, setBorderTone] = useState(DEFAULTS.borderTone);
  const [borderAlpha, setBorderAlpha] = useState(DEFAULTS.borderAlpha);
  const [borderWidth, setBorderWidth] = useState(DEFAULTS.borderWidth);

  const [radius, setRadius] = useState(DEFAULTS.radius);

  function resetFg() { setFgIntensity(DEFAULTS.fgIntensity); setFgTone(DEFAULTS.fgTone); }
  function resetBg() { setBgIntensity(DEFAULTS.bgIntensity); setBgTone(DEFAULTS.bgTone); setBgAlpha(DEFAULTS.bgAlpha); }
  function resetBorder() { setBorderIntensity(DEFAULTS.borderIntensity); setBorderTone(DEFAULTS.borderTone); setBorderAlpha(DEFAULTS.borderAlpha); setBorderWidth(DEFAULTS.borderWidth); }
  function resetShape() { setRadius(DEFAULTS.radius); }
  function resetAll() { resetFg(); resetBg(); resetBorder(); resetShape(); }

  return (
    <div className="cg-content" data-testid="gallery-badge-mockup-content">

      {/* ---- Controls ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Design Controls <button className="badge-mockup-reset-all" onClick={resetAll}>Reset All</button></div>
        <div className="badge-mockup-controls">
          <div className="badge-mockup-control-group">
            <div className="badge-mockup-control-group-title">Foreground <button className="badge-mockup-reset" onClick={resetFg}>reset</button></div>
            <MockupSlider label="Intensity" value={fgIntensity} min={0} max={100} onChange={setFgIntensity} />
            <MockupSlider label="Tone" value={fgTone} min={0} max={100} onChange={setFgTone} />
          </div>
          <div className="badge-mockup-control-group">
            <div className="badge-mockup-control-group-title">Background <button className="badge-mockup-reset" onClick={resetBg}>reset</button></div>
            <MockupSlider label="Intensity" value={bgIntensity} min={0} max={100} onChange={setBgIntensity} />
            <MockupSlider label="Tone" value={bgTone} min={0} max={100} onChange={setBgTone} />
            <MockupSlider label="Alpha" value={bgAlpha} min={0} max={100} onChange={setBgAlpha} />
          </div>
          <div className="badge-mockup-control-group">
            <div className="badge-mockup-control-group-title">Border <button className="badge-mockup-reset" onClick={resetBorder}>reset</button></div>
            <MockupSlider label="Intensity" value={borderIntensity} min={0} max={100} onChange={setBorderIntensity} />
            <MockupSlider label="Tone" value={borderTone} min={0} max={100} onChange={setBorderTone} />
            <MockupSlider label="Alpha" value={borderAlpha} min={0} max={100} onChange={setBorderAlpha} />
            <MockupSlider label="Width" value={borderWidth} min={0} max={3} onChange={setBorderWidth} />
          </div>
          <div className="badge-mockup-control-group">
            <div className="badge-mockup-control-group-title">Shape <button className="badge-mockup-reset" onClick={resetShape}>reset</button></div>
            <MockupSlider label="Radius" value={radius} min={0} max={12} onChange={setRadius} />
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- All roles with current slider values ---- */}
      <div className="cg-section">
        <div className="cg-section-title">All Roles — Current Settings</div>
        <div className="badge-mockup-comparison">
          {ALL_ROLES.map((role) => (
            <div key={role} className="badge-mockup-row">
              <div className="badge-mockup-row-label">{role}</div>
              <MockupBadge role={role} size="sm" fgIntensity={fgIntensity} fgTone={fgTone} bgIntensity={bgIntensity} bgTone={bgTone} bgAlpha={bgAlpha} borderIntensity={borderIntensity} borderTone={borderTone} borderAlpha={borderAlpha} borderWidth={borderWidth} radius={radius}>
                {role}
              </MockupBadge>
              <MockupBadge role={role} size="md" fgIntensity={fgIntensity} fgTone={fgTone} bgIntensity={bgIntensity} bgTone={bgTone} bgAlpha={bgAlpha} borderIntensity={borderIntensity} borderTone={borderTone} borderAlpha={borderAlpha} borderWidth={borderWidth} radius={radius}>
                {role}
              </MockupBadge>
              <MockupBadge role={role} size="lg" fgIntensity={fgIntensity} fgTone={fgTone} bgIntensity={bgIntensity} bgTone={bgTone} bgAlpha={bgAlpha} borderIntensity={borderIntensity} borderTone={borderTone} borderAlpha={borderAlpha} borderWidth={borderWidth} radius={radius}>
                {role}
              </MockupBadge>
              <MockupBadge role={role} size="sm" fgIntensity={fgIntensity} fgTone={fgTone} bgIntensity={bgIntensity} bgTone={bgTone} bgAlpha={bgAlpha} borderIntensity={borderIntensity} borderTone={borderTone} borderAlpha={borderAlpha} borderWidth={borderWidth} radius={radius} icon={ROLE_ICONS[role]}>
                {role}
              </MockupBadge>
              <MockupBadge role={role} size="md" fgIntensity={fgIntensity} fgTone={fgTone} bgIntensity={bgIntensity} bgTone={bgTone} bgAlpha={bgAlpha} borderIntensity={borderIntensity} borderTone={borderTone} borderAlpha={borderAlpha} borderWidth={borderWidth} radius={radius} icon={ROLE_ICONS[role]}>
                {role}
              </MockupBadge>
              <MockupBadge role={role} size="lg" fgIntensity={fgIntensity} fgTone={fgTone} bgIntensity={bgIntensity} bgTone={bgTone} bgAlpha={bgAlpha} borderIntensity={borderIntensity} borderTone={borderTone} borderAlpha={borderAlpha} borderWidth={borderWidth} radius={radius} icon={ROLE_ICONS[role]}>
                {role}
              </MockupBadge>
            </div>
          ))}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Side-by-side with real TugPushButton ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Badge vs Button — Side by Side</div>
        <div className="badge-mockup-comparison">

          <div className="badge-mockup-group">
            <div className="badge-mockup-group-title">Custom badge next to buttons</div>
            <div className="badge-mockup-row">
              <MockupBadge role="accent" size="md" fgIntensity={fgIntensity} fgTone={fgTone} bgIntensity={bgIntensity} bgTone={bgTone} bgAlpha={bgAlpha} borderIntensity={borderIntensity} borderTone={borderTone} borderAlpha={borderAlpha} borderWidth={borderWidth} radius={radius}>3 Added</MockupBadge>
              <MockupBadge role="danger" size="md" fgIntensity={fgIntensity} fgTone={fgTone} bgIntensity={bgIntensity} bgTone={bgTone} bgAlpha={bgAlpha} borderIntensity={borderIntensity} borderTone={borderTone} borderAlpha={borderAlpha} borderWidth={borderWidth} radius={radius}>1 Deleted</MockupBadge>
              <MockupBadge role="action" size="md" fgIntensity={fgIntensity} fgTone={fgTone} bgIntensity={bgIntensity} bgTone={bgTone} bgAlpha={bgAlpha} borderIntensity={borderIntensity} borderTone={borderTone} borderAlpha={borderAlpha} borderWidth={borderWidth} radius={radius}>2 Modified</MockupBadge>
              <span style={{ width: "1rem" }} />
              <TugPushButton emphasis="outlined" role="action" size="sm">Stage All</TugPushButton>
              <TugPushButton emphasis="ghost" role="action" size="sm">Diff</TugPushButton>
              <TugPushButton emphasis="filled" role="accent" size="sm">Commit</TugPushButton>
            </div>
          </div>

          <div className="badge-mockup-group">
            <div className="badge-mockup-group-title">Current filled pill badge (the problem)</div>
            <div className="badge-mockup-row">
              <span className="badge-mockup badge-mockup-md badge-mockup-shape-pill badge-mockup-filled-accent">3 Added</span>
              <span className="badge-mockup badge-mockup-md badge-mockup-shape-pill badge-mockup-filled-danger">1 Deleted</span>
              <span className="badge-mockup badge-mockup-md badge-mockup-shape-pill badge-mockup-filled-action">2 Modified</span>
              <span style={{ width: "1rem" }} />
              <TugPushButton emphasis="outlined" role="action" size="sm">Stage All</TugPushButton>
              <TugPushButton emphasis="ghost" role="action" size="sm">Diff</TugPushButton>
              <TugPushButton emphasis="filled" role="accent" size="sm">Commit</TugPushButton>
            </div>
          </div>

        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- In-context mockup ---- */}
      <div className="cg-section">
        <div className="cg-section-title">In Context — Status & Count Badges</div>
        <div className="badge-mockup-comparison">
          <div className="badge-mockup-group">
            <div className="badge-mockup-group-title">Status badges</div>
            <div className="badge-mockup-row">
              <MockupBadge role="success" size="sm" fgIntensity={fgIntensity} fgTone={fgTone} bgIntensity={bgIntensity} bgTone={bgTone} bgAlpha={bgAlpha} borderIntensity={borderIntensity} borderTone={borderTone} borderAlpha={borderAlpha} borderWidth={borderWidth} radius={radius} icon={<Check />}>Complete</MockupBadge>
              <MockupBadge role="action" size="sm" fgIntensity={fgIntensity} fgTone={fgTone} bgIntensity={bgIntensity} bgTone={bgTone} bgAlpha={bgAlpha} borderIntensity={borderIntensity} borderTone={borderTone} borderAlpha={borderAlpha} borderWidth={borderWidth} radius={radius} icon={<Zap />}>In Progress</MockupBadge>
              <MockupBadge role="caution" size="sm" fgIntensity={fgIntensity} fgTone={fgTone} bgIntensity={bgIntensity} bgTone={bgTone} bgAlpha={bgAlpha} borderIntensity={borderIntensity} borderTone={borderTone} borderAlpha={borderAlpha} borderWidth={borderWidth} radius={radius} icon={<AlertTriangle />}>Blocked</MockupBadge>
              <MockupBadge role="danger" size="sm" fgIntensity={fgIntensity} fgTone={fgTone} bgIntensity={bgIntensity} bgTone={bgTone} bgAlpha={bgAlpha} borderIntensity={borderIntensity} borderTone={borderTone} borderAlpha={borderAlpha} borderWidth={borderWidth} radius={radius}>Failed</MockupBadge>
            </div>
          </div>
          <div className="badge-mockup-group">
            <div className="badge-mockup-group-title">Count / label badges</div>
            <div className="badge-mockup-row">
              <MockupBadge role="accent" size="sm" fgIntensity={fgIntensity} fgTone={fgTone} bgIntensity={bgIntensity} bgTone={bgTone} bgAlpha={bgAlpha} borderIntensity={borderIntensity} borderTone={borderTone} borderAlpha={borderAlpha} borderWidth={borderWidth} radius={radius}>3/7 Complete</MockupBadge>
              <MockupBadge role="data" size="sm" fgIntensity={fgIntensity} fgTone={fgTone} bgIntensity={bgIntensity} bgTone={bgTone} bgAlpha={bgAlpha} borderIntensity={borderIntensity} borderTone={borderTone} borderAlpha={borderAlpha} borderWidth={borderWidth} radius={radius}>11.3k tokens</MockupBadge>
              <MockupBadge role="agent" size="sm" fgIntensity={fgIntensity} fgTone={fgTone} bgIntensity={bgIntensity} bgTone={bgTone} bgAlpha={bgAlpha} borderIntensity={borderIntensity} borderTone={borderTone} borderAlpha={borderAlpha} borderWidth={borderWidth} radius={radius}>Tugplan-Phase-8</MockupBadge>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
