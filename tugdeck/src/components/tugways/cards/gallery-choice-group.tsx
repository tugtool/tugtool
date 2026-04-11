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

import React, { useId, useState } from "react";
import {
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceGroupRole } from "@/components/tugways/tug-choice-group";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { TugLabel } from "@/components/tugways/tug-label";

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

  // Icons section
  const [iconLeftValue, setIconLeftValue] = useState("bold");
  const [iconRightValue, setIconRightValue] = useState("left");
  const [iconOnlyValue, setIconOnlyValue] = useState("light");

  // L11 migration via useResponderForm — see gallery-checkbox.tsx for the
  // annotated reference. Gensym'd sender ids for every choice group.
  //
  // Role entries share a single useId()-derived base which is suffixed
  // with the role name at bind time. The base id is opaque; role names
  // are static constants, so the resulting keys are stable per mount
  // and guaranteed unique across cards.
  const smId = useId();
  const mdId = useId();
  const lgId = useId();
  const accentId = useId();
  const partialId = useId();
  const viewInstantId = useId();
  const viewAnimatedId = useId();
  const iconLeftId = useId();
  const iconRightId = useId();
  const iconOnlyId = useId();
  const roleBaseId = useId();
  const roleIds: Record<string, string> = Object.fromEntries(
    ALL_ROLES.map((role) => [role, `${roleBaseId}-${role}`]),
  );

  const selectValueBindings: Record<string, (v: string) => void> = {
    [smId]: setSmValue,
    [mdId]: setMdValue,
    [lgId]: setLgValue,
    [accentId]: setAccentValue,
    [partialId]: setPartialValue,
    [viewInstantId]: setViewMode,
    [viewAnimatedId]: setAnimatedValue,
    [iconLeftId]: setIconLeftValue,
    [iconRightId]: setIconRightValue,
    [iconOnlyId]: setIconOnlyValue,
  };
  for (const role of ALL_ROLES) {
    selectValueBindings[roleIds[role]] = (v: string) =>
      setRoleValues((prev) => ({ ...prev, [role]: v }));
  }

  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: selectValueBindings,
  });

  return (
    <ResponderScope>
    <div
      className="cg-content"
      data-testid="gallery-choice-group"
      ref={responderRef as (el: HTMLDivElement | null) => void}
    >

      {/* ---- Sizes ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Sizes</TugLabel>
        <div style={{ display: "flex", flexDirection: "row", gap: "32px", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>sm</div>
            <TugChoiceGroup
              size="sm"
              value={smValue}
              senderId={smId}
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
              senderId={mdId}
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
              senderId={lgId}
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
        <TugLabel className="cg-section-title">Roles</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {/* accent (default — no role prop) */}
          <TugChoiceGroup
            value={accentValue}
            senderId={accentId}
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
              senderId={roleIds[role]}
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
        <TugLabel className="cg-section-title">Disabled</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              group disabled (selection visible)
            </div>
            <TugChoiceGroup
              disabled
              value={disabledGroupValue}
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
              senderId={partialId}
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
        <TugLabel className="cg-section-title">Instant Indicator</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ fontSize: "0.8125rem", color: "var(--tug7-element-field-text-normal-label-rest)" }}>
            Default behavior — indicator snaps instantly to the selected segment (no animation).
          </div>
          <TugChoiceGroup
            value={viewMode}
            senderId={viewInstantId}
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
        <TugLabel className="cg-section-title">Animated</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ fontSize: "0.8125rem", color: "var(--tug7-element-field-text-normal-label-rest)" }}>
            With <code>animated</code> — the indicator pill slides smoothly between segments.
          </div>
          <TugChoiceGroup
            animated
            value={animatedValue}
            senderId={viewAnimatedId}
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

      <div className="cg-divider" />

      {/* ---- Icons ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Icons</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

          {/* Icon + label (left — default) */}
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              icon + label (left, default)
            </div>
            <TugChoiceGroup
              value={iconLeftValue}
              senderId={iconLeftId}
              aria-label="Text formatting"
              items={[
                { value: "bold",      label: "Bold",      icon: <Bold /> },
                { value: "italic",    label: "Italic",    icon: <Italic /> },
                { value: "underline", label: "Underline", icon: <Underline /> },
              ]}
            />
          </div>

          {/* Icon + label (right) */}
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              icon + label (right)
            </div>
            <TugChoiceGroup
              value={iconRightValue}
              senderId={iconRightId}
              aria-label="Text alignment"
              items={[
                { value: "left",   label: "Left",   icon: <AlignLeft />,   iconPosition: "right" },
                { value: "center", label: "Center", icon: <AlignCenter />, iconPosition: "right" },
                { value: "right",  label: "Right",  icon: <AlignRight />,  iconPosition: "right" },
              ]}
            />
          </div>

          {/* Icon only */}
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              icon only
            </div>
            <TugChoiceGroup
              value={iconOnlyValue}
              senderId={iconOnlyId}
              aria-label="Color theme"
              items={[
                { value: "light",  icon: <Sun />,     "aria-label": "Light" },
                { value: "dark",   icon: <Moon />,    "aria-label": "Dark" },
                { value: "system", icon: <Monitor />, "aria-label": "System" },
              ]}
            />
          </div>

        </div>
      </div>

    </div>
    </ResponderScope>
  );
}
