/**
 * gallery-choice-group.tsx -- TugChoiceGroup demo tab for the Component Gallery.
 *
 * Shows TugChoiceGroup in all sizes, roles, disabled states, with an
 * interactive sliding indicator demonstration, and animated vs. instant modes.
 *
 * NOT a tab bar — TugChoiceGroup is a value picker, not a view switcher.
 * See design doc for the full distinction.
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
  ChevronsUp,
  Columns2,
  Search,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import { useSavedComponentState } from "@/components/tugways/use-component-state-preservation";
import type { TugChoiceGroupRole } from "@/components/tugways/tug-choice-group";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

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
  // The `md` instance opts into [A9] state preservation under key
  // `choice-md`; its parent React state must also seed from the saved
  // value at mount, otherwise the controlled `value={mdValue}` prop
  // would overwrite the saved value when captureState fires.
  const savedChoiceMd = useSavedComponentState<{ value?: string }>("choice-md");

  // Focus Language section — authored into a focus group so the engine drives Tab.
  const [focusValue, setFocusValue] = useState("alpha");

  const [xsValue, setXsValue] = useState("beta");
  const [smValue, setSmValue] = useState("beta");
  const [mdValue, setMdValue] = useState<string>(
    () => (typeof savedChoiceMd?.value === "string" ? savedChoiceMd.value : "beta"),
  );
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

  // Ghost emphasis section. The variant drops the framing pill +
  // saturated indicator + pipe dividers and uses uppercase
  // letter-spaced labels matching `tug-push-button.css`. Designed for
  // action-row composition next to ghost-style push buttons.
  const [ghostViewValue, setGhostViewValue] = useState("side-by-side");
  const [ghostSizeXsValue, setGhostSizeXsValue] = useState("beta");
  const [ghostSizeSmValue, setGhostSizeSmValue] = useState("beta");
  const [ghostSizeMdValue, setGhostSizeMdValue] = useState("beta");
  const [ghostIconOnlyValue, setGhostIconOnlyValue] = useState("light");
  const [ghostActionRowValue, setGhostActionRowValue] =
    useState("side-by-side");

  // L11 migration via useResponderForm — see gallery-checkbox.tsx for the
  // annotated reference. Gensym'd sender ids for every choice group.
  //
  // Role entries share a single useId()-derived base which is suffixed
  // with the role name at bind time. The base id is opaque; role names
  // are static constants, so the resulting keys are stable per mount
  // and guaranteed unique across cards.
  const focusId = useId();
  const xsId = useId();
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
  const ghostViewId = useId();
  const ghostSizeXsId = useId();
  const ghostSizeSmId = useId();
  const ghostSizeMdId = useId();
  const ghostIconOnlyId = useId();
  const ghostActionRowId = useId();
  const roleBaseId = useId();
  const roleIds: Record<string, string> = Object.fromEntries(
    ALL_ROLES.map((role) => [role, `${roleBaseId}-${role}`]),
  );

  const selectValueBindings: Record<string, (v: string) => void> = {
    [focusId]: setFocusValue,
    [xsId]: setXsValue,
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
    [ghostViewId]: setGhostViewValue,
    [ghostSizeXsId]: setGhostSizeXsValue,
    [ghostSizeSmId]: setGhostSizeSmValue,
    [ghostSizeMdId]: setGhostSizeMdValue,
    [ghostIconOnlyId]: setGhostIconOnlyValue,
    [ghostActionRowId]: setGhostActionRowValue,
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

      {/* ---- Focus Language ---- */}
      {/* First section so the segments sit above the fold for native clicks. The
          group is authored into a focus group, so the engine drives Tab in this
          card: Tab lands the key view on the selected segment (ring on keyboard
          focus), and arrows rove + select locally. */}
      <div className="cg-section" data-testid="choice-focus-demo">
        <TugLabel className="cg-section-title" data-testid="choice-focus-title">Focus Language</TugLabel>
        <TugChoiceGroup
          value={focusValue}
          senderId={focusId}
          aria-label="Focus language choice group"
          focusGroup="gallery-choice-focus"
          focusOrder={0}
          items={[
            { value: "alpha", label: "Alpha" },
            { value: "beta",  label: "Beta" },
            { value: "gamma", label: "Gamma" },
          ]}
        />
      </div>

      <TugSeparator />

      {/* ---- Sizes ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Sizes</TugLabel>
        <div style={{ display: "flex", flexDirection: "row", gap: "32px", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>xs</div>
            <TugChoiceGroup
              size="xs"
              value={xsValue}
              senderId={xsId}
              aria-label="Extra-small choice group"
              items={[
                { value: "alpha", label: "Alpha" },
                { value: "beta",  label: "Beta" },
                { value: "gamma", label: "Gamma" },
              ]}
            />
          </div>
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
              componentStatePreservationKey="choice-md"
              data-testid="gallery-choice-persistent"
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

      <TugSeparator />

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

      <TugSeparator />

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

      <TugSeparator />

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

      <TugSeparator />

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

      <TugSeparator />

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

      <TugSeparator />

      {/* ---- Ghost emphasis ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Emphasis: ghost</TugLabel>
        <p
          style={{
            margin: "0 0 16px",
            fontSize: "0.75rem",
            color: "var(--tug7-element-field-text-normal-label-rest)",
            lineHeight: 1.5,
            maxWidth: "44rem",
          }}
        >
          Quiet variant for action-row composition. Drops the framing pill,
          replaces the saturated indicator with a neutral matching{" "}
          <code>--tug7-surface-control-primary-ghost-action-hover</code>, and
          applies uppercase + 0.06em letter-spacing matching{" "}
          <code>tug-push-button.css</code>. Role-driven coloring is
          intentionally suppressed in this mode. Pipes between segments drop.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Side-by-side comparison at 2xs — the action-row target scale */}
          <div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--tug7-element-field-text-normal-label-rest)",
                marginBottom: "6px",
              }}
            >
              default vs ghost @ <code>size="2xs"</code> (action-row scale,
              icon + label)
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                gap: "32px",
                alignItems: "center",
              }}
            >
              <TugChoiceGroup
                size="2xs"
                value={ghostViewValue}
                senderId={ghostViewId}
                aria-label="View mode (default)"
                items={[
                  {
                    value: "side-by-side",
                    label: "Side by side",
                    icon: <Columns2 aria-hidden="true" />,
                    iconPosition: "left",
                    "aria-label": "Side by side",
                  },
                  {
                    value: "inline",
                    label: "Inline",
                    icon: <AlignLeft aria-hidden="true" />,
                    iconPosition: "left",
                    "aria-label": "Inline",
                  },
                ]}
              />
              <TugChoiceGroup
                size="2xs"
                emphasis="ghost"
                value={ghostViewValue}
                senderId={ghostViewId}
                aria-label="View mode (ghost)"
                items={[
                  {
                    value: "side-by-side",
                    label: "Side by side",
                    icon: <Columns2 aria-hidden="true" />,
                    iconPosition: "left",
                    "aria-label": "Side by side",
                  },
                  {
                    value: "inline",
                    label: "Inline",
                    icon: <AlignLeft aria-hidden="true" />,
                    iconPosition: "left",
                    "aria-label": "Inline",
                  },
                ]}
              />
            </div>
          </div>

          {/* Action-row preview — the production target. Mirror the diff
              block's chrome: choice group, then a separator gap, then a
              ghost push button as the trailing fold cue. */}
          <div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--tug7-element-field-text-normal-label-rest)",
                marginBottom: "6px",
              }}
            >
              action-row preview — ghost choice group + ghost push button (the
              composition the diff block wants)
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "6px 12px",
                background:
                  "var(--tug7-surface-global-primary-normal-raised-rest, transparent)",
                borderRadius: "6px",
              }}
            >
              <TugChoiceGroup
                size="2xs"
                emphasis="ghost"
                value={ghostActionRowValue}
                senderId={ghostActionRowId}
                aria-label="View mode"
                items={[
                  {
                    value: "side-by-side",
                    label: "Side by side",
                    icon: <Columns2 aria-hidden="true" />,
                    iconPosition: "left",
                    "aria-label": "Side by side",
                  },
                  {
                    value: "inline",
                    label: "Inline",
                    icon: <AlignLeft aria-hidden="true" />,
                    iconPosition: "left",
                    "aria-label": "Inline",
                  },
                ]}
              />
              <TugPushButton
                icon={<ChevronsUp />}
                subtype="icon-text"
                emphasis="ghost"
                size="2xs"
                aria-label="Collapse"
              >
                8 hunks
              </TugPushButton>
              <TugPushButton
                icon={<Search />}
                subtype="icon-text"
                emphasis="ghost"
                size="2xs"
                aria-label="Find"
              >
                Find
              </TugPushButton>
            </div>
          </div>

          {/* Sizes — ghost across the size spectrum so we can see how it
              scales. The action-row target is 2xs, but the variant works at
              every size for callers who want a quiet picker at a larger
              scale. */}
          <div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--tug7-element-field-text-normal-label-rest)",
                marginBottom: "6px",
              }}
            >
              ghost across sizes (xs / sm / md)
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                gap: "32px",
                alignItems: "center",
              }}
            >
              <TugChoiceGroup
                size="xs"
                emphasis="ghost"
                value={ghostSizeXsValue}
                senderId={ghostSizeXsId}
                aria-label="Ghost xs"
                items={[
                  { value: "alpha", label: "Alpha" },
                  { value: "beta", label: "Beta" },
                  { value: "gamma", label: "Gamma" },
                ]}
              />
              <TugChoiceGroup
                size="sm"
                emphasis="ghost"
                value={ghostSizeSmValue}
                senderId={ghostSizeSmId}
                aria-label="Ghost sm"
                items={[
                  { value: "alpha", label: "Alpha" },
                  { value: "beta", label: "Beta" },
                  { value: "gamma", label: "Gamma" },
                ]}
              />
              <TugChoiceGroup
                size="md"
                emphasis="ghost"
                value={ghostSizeMdValue}
                senderId={ghostSizeMdId}
                aria-label="Ghost md"
                items={[
                  { value: "alpha", label: "Alpha" },
                  { value: "beta", label: "Beta" },
                  { value: "gamma", label: "Gamma" },
                ]}
              />
            </div>
          </div>

          {/* Icon-only — uppercase typography doesn't apply (no labels), but
              the rest of the ghost contract (no framing pill, neutral
              indicator, no pipes) still applies. */}
          <div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--tug7-element-field-text-normal-label-rest)",
                marginBottom: "6px",
              }}
            >
              icon-only — ghost still drops the frame; the indicator pill
              alone carries the selection signal
            </div>
            <TugChoiceGroup
              size="sm"
              emphasis="ghost"
              value={ghostIconOnlyValue}
              senderId={ghostIconOnlyId}
              aria-label="Color theme (ghost)"
              items={[
                { value: "light", icon: <Sun />, "aria-label": "Light" },
                { value: "dark", icon: <Moon />, "aria-label": "Dark" },
                { value: "system", icon: <Monitor />, "aria-label": "System" },
              ]}
            />
          </div>

          {/* Disabled — ghost variant honors the disabled state. The
              indicator stays visible; segments dim. */}
          <div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--tug7-element-field-text-normal-label-rest)",
                marginBottom: "6px",
              }}
            >
              disabled — indicator stays put; segments dim
            </div>
            <TugChoiceGroup
              size="2xs"
              emphasis="ghost"
              disabled
              value="side-by-side"
              aria-label="Disabled ghost view mode"
              items={[
                {
                  value: "side-by-side",
                  label: "Side by side",
                  icon: <Columns2 aria-hidden="true" />,
                },
                {
                  value: "inline",
                  label: "Inline",
                  icon: <AlignLeft aria-hidden="true" />,
                },
              ]}
            />
          </div>
        </div>
      </div>

    </div>
    </ResponderScope>
  );
}
