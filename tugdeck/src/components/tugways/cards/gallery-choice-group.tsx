/**
 * gallery-choice-group.tsx -- TugChoiceGroup demo tab for the Component Gallery.
 *
 * Shows TugChoiceGroup in all sizes, roles, disabled states, with an
 * interactive sliding indicator demonstration, and animated vs. instant modes.
 *
 * NOT a tab bar — TugChoiceGroup is a value picker, not a view switcher.
 * See roadmap/group-family.md for the full distinction.
 *
 * Rules of Tugways compliance:
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-choice-group
 */

import React, { useState } from "react";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceGroupRole } from "@/components/tugways/tug-choice-group";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_ROLES: TugChoiceGroupRole[] = [
  "option",
  "action",
  "agent",
  "data",
  "success",
  "caution",
  "danger",
];

// ---------------------------------------------------------------------------
// GalleryChoiceGroup
// ---------------------------------------------------------------------------

export function GalleryChoiceGroup() {
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

  // Sliding indicator demo (instant)
  const [viewMode, setViewMode] = useState("grid");

  // Animated section
  const [animatedValue, setAnimatedValue] = useState("grid");

  return (
    <div className="cg-content" data-testid="gallery-choice-group">

      {/* ---- Sizes ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Sizes</div>
        <div style={{ display: "flex", flexDirection: "row", gap: "32px", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>sm</div>
            <TugChoiceGroup
              size="sm"
              value={smValue}
              onValueChange={setSmValue}
              aria-label="Small choice group"
              items={[
                { value: "alpha", label: "Alpha" },
                { value: "beta",  label: "Beta" },
                { value: "gamma", label: "Gamma" },
              ]}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>md</div>
            <TugChoiceGroup
              size="md"
              value={mdValue}
              onValueChange={setMdValue}
              aria-label="Medium choice group"
              items={[
                { value: "alpha", label: "Alpha" },
                { value: "beta",  label: "Beta" },
                { value: "gamma", label: "Gamma" },
              ]}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>lg</div>
            <TugChoiceGroup
              size="lg"
              value={lgValue}
              onValueChange={setLgValue}
              aria-label="Large choice group"
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
          <TugChoiceGroup
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
            <TugChoiceGroup
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
            <TugChoiceGroup
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
            <TugChoiceGroup
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

      {/* ---- Instant Indicator ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Instant Indicator</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ fontSize: "0.8125rem", color: "var(--tug7-element-field-text-normal-label-rest)" }}>
            Default behavior — indicator snaps instantly to the selected segment (no animation).
          </div>
          <TugChoiceGroup
            value={viewMode}
            onValueChange={setViewMode}
            aria-label="View mode (instant)"
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

      <div className="cg-divider" />

      {/* ---- Animated ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Animated</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ fontSize: "0.8125rem", color: "var(--tug7-element-field-text-normal-label-rest)" }}>
            With <code>animated</code> — the indicator pill slides smoothly between segments.
          </div>
          <TugChoiceGroup
            animated
            value={animatedValue}
            onValueChange={setAnimatedValue}
            aria-label="View mode (animated)"
            items={[
              { value: "grid",  label: "Grid"  },
              { value: "list",  label: "List"  },
              { value: "table", label: "Table" },
            ]}
          />
          <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)" }}>
            Current view: <strong>{animatedValue}</strong>
          </div>
        </div>
      </div>

    </div>
  );
}
