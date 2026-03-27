/**
 * gallery-segmented-choice.tsx -- TugSegmentedChoice demo tab for the Component Gallery.
 *
 * Shows TugSegmentedChoice in all sizes, roles, disabled states, and with an
 * interactive sliding indicator demonstration.
 *
 * NOT a tab bar — TugSegmentedChoice is a value picker, not a view switcher.
 * See roadmap/tug-segmented-choice.md for the full distinction.
 *
 * Rules of Tugways compliance:
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-segmented-choice
 */

import React, { useState } from "react";
import { TugSegmentedChoice } from "@/components/tugways/tug-segmented-choice";
import type { TugSegmentedChoiceRole } from "@/components/tugways/tug-segmented-choice";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_ROLES: TugSegmentedChoiceRole[] = [
  "option",
  "action",
  "agent",
  "data",
  "success",
  "caution",
  "danger",
];

// ---------------------------------------------------------------------------
// GallerySegmentedChoice
// ---------------------------------------------------------------------------

export function GallerySegmentedChoice() {
  // Sizes section
  const [smValue, setSmValue] = useState("beta");
  const [mdValue, setMdValue] = useState("beta");
  const [lgValue, setLgValue] = useState("beta");

  // Roles section — one state per role entry (accent + 7 explicit)
  const [accentValue, setAccentValue] = useState("on");
  const [roleValues, setRoleValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(ALL_ROLES.map((r) => [r, "on"])),
  );

  // Disabled section
  const [disabledGroupValue] = useState("beta");
  const [partialValue, setPartialValue] = useState("alpha");

  // Sliding indicator demo
  const [viewMode, setViewMode] = useState("grid");

  return (
    <div className="cg-content" data-testid="gallery-segmented-choice">

      {/* ---- Sizes ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Sizes</div>
        <div style={{ display: "flex", flexDirection: "row", gap: "32px", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>sm</div>
            <TugSegmentedChoice
              size="sm"
              value={smValue}
              onValueChange={setSmValue}
              aria-label="Small segmented choice"
              items={[
                { value: "alpha", label: "Alpha" },
                { value: "beta",  label: "Beta" },
                { value: "gamma", label: "Gamma" },
              ]}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>md</div>
            <TugSegmentedChoice
              size="md"
              value={mdValue}
              onValueChange={setMdValue}
              aria-label="Medium segmented choice"
              items={[
                { value: "alpha", label: "Alpha" },
                { value: "beta",  label: "Beta" },
                { value: "gamma", label: "Gamma" },
              ]}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>lg</div>
            <TugSegmentedChoice
              size="lg"
              value={lgValue}
              onValueChange={setLgValue}
              aria-label="Large segmented choice"
              items={[
                { value: "alpha", label: "Alpha" },
                { value: "beta",  label: "Beta" },
                { value: "gamma", label: "Gamma" },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Roles ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Roles</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {/* accent (default — no role prop) */}
          <TugSegmentedChoice
            value={accentValue}
            onValueChange={setAccentValue}
            aria-label="accent (default)"
            items={[
              { value: "off", label: "accent off" },
              { value: "on",  label: "accent on"  },
            ]}
          />
          {/* explicit roles */}
          {ALL_ROLES.map((role) => (
            <TugSegmentedChoice
              key={role}
              role={role}
              value={roleValues[role]}
              onValueChange={(v) => setRoleValues((prev) => ({ ...prev, [role]: v }))}
              aria-label={`${role} role`}
              items={[
                { value: "off", label: `${role} off` },
                { value: "on",  label: `${role} on`  },
              ]}
            />
          ))}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Disabled ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Disabled</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              group disabled (selection visible)
            </div>
            <TugSegmentedChoice
              disabled
              value={disabledGroupValue}
              onValueChange={() => {}}
              aria-label="Disabled group"
              items={[
                { value: "alpha", label: "Alpha" },
                { value: "beta",  label: "Beta (selected)" },
                { value: "gamma", label: "Gamma" },
              ]}
            />
          </div>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              individual segments disabled
            </div>
            <TugSegmentedChoice
              value={partialValue}
              onValueChange={setPartialValue}
              aria-label="Partial disabled group"
              items={[
                { value: "alpha", label: "Alpha" },
                { value: "beta",  label: "Beta (disabled)", disabled: true },
                { value: "gamma", label: "Gamma" },
                { value: "delta", label: "Delta (disabled)", disabled: true },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Sliding Indicator ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Sliding Indicator</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ fontSize: "0.8125rem", color: "var(--tug7-element-field-text-normal-label-rest)" }}>
            Click a segment to watch the indicator pill animate to its new position.
          </div>
          <TugSegmentedChoice
            value={viewMode}
            onValueChange={setViewMode}
            aria-label="View mode"
            items={[
              { value: "grid",  label: "Grid"  },
              { value: "list",  label: "List"  },
              { value: "table", label: "Table" },
            ]}
          />
          <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)" }}>
            Current view: <strong>{viewMode}</strong>
          </div>
        </div>
      </div>

    </div>
  );
}
