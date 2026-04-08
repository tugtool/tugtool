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

import React, { useCallback, useId, useState } from "react";
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
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { narrowValue } from "@/components/tugways/action-vocabulary";

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

  // L11 migration pattern (A2.2): the gallery card is a responder that
  // handles `selectValue` actions dispatched by TugChoiceGroup children.
  // The sender id identifies which choice group within this card. See
  // gallery-checkbox.tsx for the annotated reference implementation.
  //
  // Role entries use a single shared handler that writes into a record
  // keyed by role name. senderId for role groups is "choice-role-<name>".
  const setters: Record<string, (v: string) => void> = {
    "choice-sm": setSmValue,
    "choice-md": setMdValue,
    "choice-lg": setLgValue,
    "choice-accent": setAccentValue,
    "choice-partial": setPartialValue,
    "choice-view-instant": setViewMode,
    "choice-view-animated": setAnimatedValue,
    "choice-icon-left": setIconLeftValue,
    "choice-icon-right": setIconRightValue,
    "choice-icon-only": setIconOnlyValue,
  };
  const handleSelectValue = useCallback((event: ActionEvent) => {
    const sender = typeof event.sender === "string" ? event.sender : null;
    if (!sender) return;
    const v = narrowValue(event, (val): val is string => typeof val === "string");
    if (v === null) return;
    // Role entries route to the roleValues record.
    if (sender.startsWith("choice-role-")) {
      const role = sender.slice("choice-role-".length);
      setRoleValues((prev) => ({ ...prev, [role]: v }));
      return;
    }
    const setter = setters[sender];
    if (!setter) return;
    setter(v);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const responderId = useId();
  const { ResponderScope, responderRef } = useResponder({
    id: responderId,
    actions: { selectValue: handleSelectValue },
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
        <div className="cg-section-title">Sizes</div>
        <div style={{ display: "flex", flexDirection: "row", gap: "32px", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>sm</div>
            <TugChoiceGroup
              size="sm"
              value={smValue}
              senderId="choice-sm"
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
              senderId="choice-md"
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
              senderId="choice-lg"
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
            senderId="choice-accent"
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
              senderId={`choice-role-${role}`}
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
              senderId="choice-partial"
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
            senderId="choice-view-instant"
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
            senderId="choice-view-animated"
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
        <div className="cg-section-title">Icons</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

          {/* Icon + label (left — default) */}
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              icon + label (left, default)
            </div>
            <TugChoiceGroup
              value={iconLeftValue}
              senderId="choice-icon-left"
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
              senderId="choice-icon-right"
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
              senderId="choice-icon-only"
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
