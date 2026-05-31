import React, { useMemo } from "react";
import { useOptionalThemeContext } from "@/contexts/theme-provider";
import { TUG_TOKEN_NAMES } from "@/generated/tug-token-names";
import { snapshotLiveThemeTokens, type LiveResolvedColor } from "@/components/tugways/theme-live-snapshot";
import {
  validateThemeContrast,
  checkCVDDistinguishability,
  CVD_SEMANTIC_PAIRS,
  simulateCVDFromOKLCH,
  WCAG_CONTRAST_THRESHOLDS,
  CONTRAST_THRESHOLDS,
  CONTRAST_MARGINAL_DELTA,
  oklchToHex,
  type CVDType,
  type ContrastResult,
  type CVDWarning,
} from "@/components/tugways/theme-accessibility";
import { ELEMENT_SURFACE_PAIRING_MAP } from "@/components/tugways/theme-pairings";
import { TugButton } from "@/components/tugways/internal/tug-button";
import type { TugButtonEmphasis, TugButtonRole } from "@/components/tugways/internal/tug-button";
import { TugBadge } from "@/components/tugways/tug-badge";
import type { TugBadgeEmphasis, TugBadgeRole } from "@/components/tugways/tug-badge";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import type { TugCheckboxRole } from "@/components/tugways/tug-checkbox";
import { TugSwitch } from "@/components/tugways/tug-switch";
import type { TugSwitchRole } from "@/components/tugways/tug-switch";
import "./gallery-theme-accessibility.css";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

const CVD_TYPES: CVDType[] = ["protanopia", "deuteranopia", "tritanopia", "achromatopsia"];

const CVD_TYPE_LABELS: Record<CVDType, string> = {
  protanopia: "Protanopia",
  deuteranopia: "Deuteranopia",
  tritanopia: "Tritanopia",
  achromatopsia: "Achromatopsia",
};

const CVD_SEMANTIC_TOKENS: Array<{ token: string; label: string }> = [
  { token: "--tug7-element-tone-fill-normal-accent-rest", label: "Accent" },
  { token: "--tug7-element-tone-fill-normal-active-rest", label: "Active" },
  { token: "--tug7-element-tone-fill-normal-agent-rest", label: "Agent" },
  { token: "--tug7-element-tone-fill-normal-data-rest", label: "Data" },
  { token: "--tug7-element-tone-fill-normal-success-rest", label: "Success" },
  { token: "--tug7-element-tone-fill-normal-caution-rest", label: "Caution" },
  { token: "--tug7-element-tone-fill-normal-danger-rest", label: "Danger" },
];

function linearSrgbToHex(linear: { r: number; g: number; b: number }): string {
  const encode = (c: number) => {
    const clamped = Math.max(0, Math.min(1, c));
    const gamma = clamped >= 0.0031308
      ? 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055
      : 12.92 * clamped;
    return Math.round(Math.max(0, Math.min(1, gamma)) * 255);
  };
  const r = encode(linear.r).toString(16).padStart(2, "0");
  const g = encode(linear.g).toString(16).padStart(2, "0");
  const b = encode(linear.b).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function swatchHex(resolved: LiveResolvedColor | null): string {
  if (!resolved) return "transparent";
  return oklchToHex(resolved.L, resolved.C, resolved.h);
}

function badgeVariant(result: ContrastResult): "pass" | "marginal" | "fail" | "decorative" {
  if (result.role === "decorative") return "decorative";
  if (result.contrastPass) return "pass";
  const threshold = CONTRAST_THRESHOLDS[result.role] ?? 15;
  if (Math.abs(result.contrast) >= threshold - CONTRAST_MARGINAL_DELTA) return "marginal";
  return "fail";
}

const BUTTON_EMPHASES: TugButtonEmphasis[] = ["filled", "outlined", "ghost"];
const BADGE_EMPHASES: TugBadgeEmphasis[] = ["filled", "outlined", "ghost"];
const BUTTON_ROLES: TugButtonRole[] = ["accent", "action", "data", "danger"];
const BADGE_ROLES: TugBadgeRole[] = ["accent", "action", "agent", "data", "success", "caution", "danger"];
const SELECTION_ROLES: TugCheckboxRole[] = ["action", "agent", "data", "success", "caution", "danger"];

function EmphasisRolePreview() {
  return (
    <div className="gtg-emphasis-role-preview" data-testid="gtg-emphasis-role-preview">
      <div className="gtg-erp-subsection">
        <div className="gtg-erp-subtitle">Buttons (3 emphasis x 4 roles)</div>
        <div className="gtg-erp-button-grid" data-testid="gtg-erp-button-grid">
          {BUTTON_EMPHASES.map((emphasis) => (
            <React.Fragment key={emphasis}>
              <div className="gtg-erp-row-label">{emphasis}</div>
              {BUTTON_ROLES.map((role) => (
                <div key={role} className="gtg-erp-cell">
                  <TugButton emphasis={emphasis} role={role} size="sm">{role}</TugButton>
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="gtg-erp-subsection">
        <div className="gtg-erp-subtitle">Badges (3 emphasis x 7 roles)</div>
        <div className="gtg-erp-badge-grid" data-testid="gtg-erp-badge-grid">
          {BADGE_EMPHASES.map((emphasis) => (
            <React.Fragment key={emphasis}>
              <div className="gtg-erp-row-label">{emphasis}</div>
              {BADGE_ROLES.map((role) => (
                <div key={role} className="gtg-erp-cell">
                  <TugBadge emphasis={emphasis} role={role}>{role}</TugBadge>
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="gtg-erp-subsection">
        <div className="gtg-erp-subtitle">Selection Controls (7 roles, checked)</div>
        <div className="gtg-erp-selection-row" data-testid="gtg-erp-selection-row">
          {SELECTION_ROLES.map((role) => (
            <div key={role} className="gtg-erp-selection-cell">
              <div className="gtg-erp-col-label">{role}</div>
              <TugCheckbox role={role} checked aria-label={`checkbox-${role}`} />
              <TugSwitch role={role as TugSwitchRole} checked aria-label={`switch-${role}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function GalleryThemeAccessibility() {
  const themeCtx = useOptionalThemeContext();
  const themeName = themeCtx?.theme ?? "brio";

  const requiredColorTokens = useMemo(() => {
    const set = new Set<string>();
    for (const pairing of ELEMENT_SURFACE_PAIRING_MAP) {
      set.add(pairing.element);
      set.add(pairing.surface);
      if (pairing.parentSurface) set.add(pairing.parentSurface);
    }
    for (const [a, b] of CVD_SEMANTIC_PAIRS) {
      set.add(a);
      set.add(b);
    }
    return set;
  }, []);

  // Recompute snapshot when the active theme changes.
  const snapshot = useMemo(
    () => snapshotLiveThemeTokens(TUG_TOKEN_NAMES, requiredColorTokens),
    [themeName, requiredColorTokens],
  );

  const contrastResults = useMemo(
    () => validateThemeContrast(snapshot.resolvedMap as Record<string, never>, ELEMENT_SURFACE_PAIRING_MAP),
    [snapshot.resolvedMap],
  );

  const cvdWarnings = useMemo<CVDWarning[]>(
    () => checkCVDDistinguishability(snapshot.resolvedMap as Record<string, never>, CVD_SEMANTIC_PAIRS),
    [snapshot.resolvedMap],
  );

  const unresolvedReferences = useMemo(() => {
    return [...requiredColorTokens].filter((token) => snapshot.resolvedMap[token] === undefined).sort();
  }, [requiredColorTokens, snapshot.resolvedMap]);

  const failingPairs = useMemo(
    () => contrastResults.filter((r) => !r.contrastPass && badgeVariant(r) === "fail"),
    [contrastResults],
  );
  const marginalPairs = useMemo(
    () => contrastResults.filter((r) => !r.contrastPass && badgeVariant(r) === "marginal"),
    [contrastResults],
  );

  const passCount = contrastResults.filter((r) => r.role !== "decorative" && r.contrastPass).length;
  const checkedCount = contrastResults.filter((r) => r.role !== "decorative").length;

  return (
    <div className="cg-content gtg-content" data-testid="gallery-theme-accessibility">
      <div className="gtg-header-row" data-testid="gtg-doc-header">
        <div className="gtg-doc-info" data-testid="gtg-doc-info">
          <span className="gtg-doc-name" data-testid="gtg-doc-name">{themeName}</span>
          <span className="gtg-doc-source-label" data-testid="gtg-doc-source-label">live css</span>
          <span className="gtg-doc-readonly-badge" data-testid="gtg-doc-readonly-badge">Theme Accessibility</span>
        </div>
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">Controls</TugLabel>
        <EmphasisRolePreview />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">{`Token Preview (${snapshot.entries.length} tokens)`}</TugLabel>
        <div className="gtg-token-grid" data-testid="gtg-token-grid">
          <div className="gtg-token-header">
            <span>Token</span>
            <span>Color</span>
            <span>Value</span>
          </div>
          {snapshot.entries.map((entry) => (
            <React.Fragment key={entry.name}>
              <span className="gtg-token-name" title={entry.name}>{entry.name}</span>
              <div
                className="gtg-token-swatch"
                style={{ backgroundColor: swatchHex(entry.resolvedColor) }}
                title={entry.resolvedColor ? swatchHex(entry.resolvedColor) : "N/A"}
              />
              <span className="gtg-token-value" title={entry.rawValue || "N/A"}>
                {entry.rawValue || "N/A"}
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">Contrast Dashboard</TugLabel>
        <div className="gtg-dash-summary" data-testid="gtg-dash-summary">
          <span className="gtg-dash-summary-count" data-testid="gtg-dash-summary-count">{passCount}/{checkedCount}</span>
          <span>pairs pass contrast</span>
          <span style={{ color: "var(--tug7-element-global-text-normal-muted-rest)", marginLeft: "4px" }}>
            ({contrastResults.length} total pairs)
          </span>
        </div>
        <div className="gtg-dash-grid" data-testid="gtg-dash-grid">
          <div className="gtg-dash-col-header">
            <span>FG</span>
            <span>BG</span>
            <span>Foreground token</span>
            <span>Background token</span>
            <span>WCAG 2.x</span>
            <span>Contrast</span>
            <span>Badge</span>
          </div>
          {contrastResults.map((result, idx) => {
            const variant = badgeVariant(result);
            const fg = snapshot.resolvedMap[result.fg];
            const bg = snapshot.resolvedMap[result.bg];
            const threshold = WCAG_CONTRAST_THRESHOLDS[result.role] ?? 1;
            const contrastThreshold = CONTRAST_THRESHOLDS[result.role] ?? 15;
            return (
              <React.Fragment key={`${result.fg}-${result.bg}-${idx}`}>
                <div className="gtg-dash-swatch" style={{ backgroundColor: swatchHex(fg ?? null) }} />
                <div className="gtg-dash-swatch" style={{ backgroundColor: swatchHex(bg ?? null) }} />
                <span className="gtg-dash-token-name" title={result.fg}>{result.fg}</span>
                <span className="gtg-dash-token-name" title={result.bg}>{result.bg}</span>
                <span className="gtg-dash-ratio" title={`Threshold: ${threshold}:1`}>{result.wcagRatio.toFixed(2)}:1</span>
                <span className="gtg-dash-ratio" title={`Contrast threshold: ${contrastThreshold}`}>{result.contrast.toFixed(1)}</span>
                <span className={`gtg-dash-badge gtg-dash-badge--${variant}`}>{variant}</span>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">Color Vision Deficiency Preview</TugLabel>
        <div className="gtg-cvd-strip" data-testid="gtg-cvd-strip">
          <div className="gtg-cvd-col-headers">
            <div className="gtg-cvd-type-label-cell" />
            {CVD_SEMANTIC_TOKENS.map(({ label }) => (
              <div key={label} className="gtg-cvd-token-header">{label}</div>
            ))}
          </div>
          {CVD_TYPES.map((cvdType) => (
            <div key={cvdType} className="gtg-cvd-row" data-cvd-type={cvdType}>
              <div className="gtg-cvd-type-label-cell">
                <span className="gtg-cvd-type-label">{CVD_TYPE_LABELS[cvdType]}</span>
                {cvdWarnings.some((w) => w.type === cvdType) && (
                  <span className="gtg-cvd-warn-badge" title="Potential indistinguishable semantic colors">!</span>
                )}
              </div>
              {CVD_SEMANTIC_TOKENS.map(({ token, label }) => {
                const resolved = snapshot.resolvedMap[token];
                if (!resolved) {
                  return (
                    <div key={token} className="gtg-cvd-swatch-pair">
                      <div className="gtg-cvd-swatch gtg-cvd-swatch--missing" title="N/A" />
                      <div className="gtg-cvd-swatch gtg-cvd-swatch--missing" title="N/A" />
                    </div>
                  );
                }
                const origHex = swatchHex(resolved);
                const simHex = linearSrgbToHex(simulateCVDFromOKLCH(resolved.L, resolved.C, resolved.h, cvdType));
                return (
                  <div key={token} className="gtg-cvd-swatch-pair" title={`${label}: ${origHex} -> ${simHex}`}>
                    <div className="gtg-cvd-swatch" style={{ backgroundColor: origHex }} />
                    <div className="gtg-cvd-swatch" style={{ backgroundColor: simHex }} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">Accessibility Diagnostics</TugLabel>
        <div className="gtg-autofix-panel" data-testid="gtg-autofix-panel">
          <div className="gtg-diag-section" data-testid="gtg-diag-floor-section">
            <div className="gtg-diag-section-title">Failing contrast pairs ({failingPairs.length})</div>
            <ul className="gtg-diag-list">
              {failingPairs.slice(0, 20).map((r, idx) => (
                <li key={`f-${idx}`} className="gtg-diag-item">
                  <span className="gtg-diag-token">{r.fg}</span>
                  <span className="gtg-diag-detail">on {r.bg} (contrast {r.contrast.toFixed(1)})</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="gtg-diag-section">
            <div className="gtg-diag-section-title">Marginal pairs ({marginalPairs.length})</div>
            <ul className="gtg-diag-list">
              {marginalPairs.slice(0, 20).map((r, idx) => (
                <li key={`m-${idx}`} className="gtg-diag-item">
                  <span className="gtg-diag-token">{r.fg}</span>
                  <span className="gtg-diag-detail">on {r.bg} (contrast {r.contrast.toFixed(1)})</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="gtg-diag-section">
            <div className="gtg-diag-section-title">Unresolved token references ({unresolvedReferences.length})</div>
            <ul className="gtg-diag-list">
              {unresolvedReferences.slice(0, 20).map((token) => (
                <li key={token} className="gtg-diag-item">
                  <span className="gtg-diag-token">{token}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="gtg-diag-section">
            <div className="gtg-diag-section-title">CVD warnings ({cvdWarnings.length})</div>
            <ul className="gtg-diag-list">
              {cvdWarnings.slice(0, 20).map((warning, idx) => (
                <li key={`c-${idx}`} className="gtg-diag-item">
                  <span className="gtg-diag-token">{warning.type}</span>
                  <span className="gtg-diag-detail">{warning.tokenPair.join(" vs ")}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
