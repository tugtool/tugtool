/**
 * gallery-radio-group.tsx -- TugRadioGroup demo tab for the Component Gallery.
 *
 * Shows TugRadioGroup in all sizes, orientations, roles, with labels, and
 * with disabled items/groups.
 *
 * Rules of Tugways compliance:
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-radio-group
 */

import React, { useId, useState } from "react";
import { TugRadioGroup, TugRadioItem } from "@/components/tugways/tug-radio-group";
import type { TugRadioRole } from "@/components/tugways/tug-radio-group";
import { useResponderForm } from "@/components/tugways/use-responder-form";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_ROLES: TugRadioRole[] = [
  "option",
  "action",
  "agent",
  "data",
  "success",
  "caution",
  "danger",
];

// ---------------------------------------------------------------------------
// GalleryRadioGroup
// ---------------------------------------------------------------------------

export function GalleryRadioGroup() {
  // Controlled state for interactive sections
  const [sizeSmValue, setSizeSmValue] = useState("b");
  const [sizeMdValue, setSizeMdValue] = useState("b");
  const [sizeLgValue, setSizeLgValue] = useState("b");
  const [horzValue, setHorzValue] = useState("option-2");
  const [vertValue, setVertValue] = useState("option-2");
  const [labeledValue, setLabeledValue] = useState("email");
  const [disabledGroupValue, setDisabledGroupValue] = useState("b");

  // L11 migration via useResponderForm — see gallery-checkbox.tsx for the
  // annotated reference. Gensym'd sender ids for every radio group.
  const radioSmId = useId();
  const radioMdId = useId();
  const radioLgId = useId();
  const radioHorzId = useId();
  const radioVertId = useId();
  const radioLabeledId = useId();
  const radioDisabledId = useId();

  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: {
      [radioSmId]: setSizeSmValue,
      [radioMdId]: setSizeMdValue,
      [radioLgId]: setSizeLgValue,
      [radioHorzId]: setHorzValue,
      [radioVertId]: setVertValue,
      [radioLabeledId]: setLabeledValue,
      [radioDisabledId]: setDisabledGroupValue,
    },
  });

  return (
    <ResponderScope>
    <div
      className="cg-content"
      data-testid="gallery-radio-group"
      ref={responderRef as (el: HTMLDivElement | null) => void}
    >

      {/* ---- Sizes ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Sizes</div>
        <div style={{ display: "flex", flexDirection: "row", gap: "32px", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>sm</div>
            <TugRadioGroup size="sm" value={sizeSmValue} senderId={radioSmId} aria-label="Small radio group">
              <TugRadioItem value="a">Alpha</TugRadioItem>
              <TugRadioItem value="b">Beta</TugRadioItem>
              <TugRadioItem value="c">Gamma</TugRadioItem>
            </TugRadioGroup>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>md</div>
            <TugRadioGroup size="md" value={sizeMdValue} senderId={radioMdId} aria-label="Medium radio group">
              <TugRadioItem value="a">Alpha</TugRadioItem>
              <TugRadioItem value="b">Beta</TugRadioItem>
              <TugRadioItem value="c">Gamma</TugRadioItem>
            </TugRadioGroup>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>lg</div>
            <TugRadioGroup size="lg" value={sizeLgValue} senderId={radioLgId} aria-label="Large radio group">
              <TugRadioItem value="a">Alpha</TugRadioItem>
              <TugRadioItem value="b">Beta</TugRadioItem>
              <TugRadioItem value="c">Gamma</TugRadioItem>
            </TugRadioGroup>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Orientations ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Orientations</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>horizontal</div>
            <TugRadioGroup
              orientation="horizontal"
              value={horzValue}
              senderId={radioHorzId}
              aria-label="Horizontal radio group"
            >
              <TugRadioItem value="option-1">Option 1</TugRadioItem>
              <TugRadioItem value="option-2">Option 2</TugRadioItem>
              <TugRadioItem value="option-3">Option 3</TugRadioItem>
            </TugRadioGroup>
          </div>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>vertical</div>
            <TugRadioGroup
              orientation="vertical"
              value={vertValue}
              senderId={radioVertId}
              aria-label="Vertical radio group"
            >
              <TugRadioItem value="option-1">Option 1</TugRadioItem>
              <TugRadioItem value="option-2">Option 2</TugRadioItem>
              <TugRadioItem value="option-3">Option 3</TugRadioItem>
            </TugRadioGroup>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Roles ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Roles</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <TugRadioGroup defaultValue="on" aria-label="accent (default)">
            <TugRadioItem value="off">accent off</TugRadioItem>
            <TugRadioItem value="on">accent on</TugRadioItem>
          </TugRadioGroup>
          {ALL_ROLES.map((role) => (
            <TugRadioGroup key={role} role={role} defaultValue="on" aria-label={`${role} role`}>
              <TugRadioItem value="off">{role} off</TugRadioItem>
              <TugRadioItem value="on">{role} on</TugRadioItem>
            </TugRadioGroup>
          ))}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Group Label ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Group Label</div>
        <TugRadioGroup
          label="Notification channel"
          name="notification-channel"
          value={labeledValue}
          senderId={radioLabeledId}
        >
          <TugRadioItem value="email">Email</TugRadioItem>
          <TugRadioItem value="push">Push notification</TugRadioItem>
          <TugRadioItem value="sms">SMS</TugRadioItem>
          <TugRadioItem value="slack">Slack</TugRadioItem>
        </TugRadioGroup>
      </div>

      <div className="cg-divider" />

      {/* ---- Disabled ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Disabled</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>group disabled</div>
            <TugRadioGroup
              disabled
              value={disabledGroupValue}
              senderId={radioDisabledId}
              aria-label="Disabled group"
            >
              <TugRadioItem value="a">Alpha</TugRadioItem>
              <TugRadioItem value="b">Beta (selected)</TugRadioItem>
              <TugRadioItem value="c">Gamma</TugRadioItem>
            </TugRadioGroup>
          </div>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>individual item disabled</div>
            <TugRadioGroup defaultValue="b" aria-label="Partial disabled group">
              <TugRadioItem value="a">Alpha (enabled)</TugRadioItem>
              <TugRadioItem value="b">Beta (enabled, selected)</TugRadioItem>
              <TugRadioItem value="c" disabled>Gamma (disabled)</TugRadioItem>
              <TugRadioItem value="d" disabled>Delta (disabled)</TugRadioItem>
            </TugRadioGroup>
          </div>
        </div>
      </div>

    </div>
    </ResponderScope>
  );
}
