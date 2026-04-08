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

import React, { useCallback, useId, useState } from "react";
import { TugRadioGroup, TugRadioItem } from "@/components/tugways/tug-radio-group";
import type { TugRadioRole } from "@/components/tugways/tug-radio-group";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { narrowValue } from "@/components/tugways/action-vocabulary";

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

  // L11 migration pattern (A2.2): the gallery card is a responder that
  // handles `selectValue` actions dispatched by TugRadioGroup children.
  // The sender id identifies which radio group within this card
  // dispatched. See gallery-checkbox.tsx for the annotated reference.
  const setters: Record<string, (v: string) => void> = {
    "radio-sm": setSizeSmValue,
    "radio-md": setSizeMdValue,
    "radio-lg": setSizeLgValue,
    "radio-horz": setHorzValue,
    "radio-vert": setVertValue,
    "radio-labeled": setLabeledValue,
    "radio-disabled": setDisabledGroupValue,
  };
  const handleSelectValue = useCallback((event: ActionEvent) => {
    const sender = typeof event.sender === "string" ? event.sender : null;
    if (!sender) return;
    const setter = setters[sender];
    if (!setter) return;
    const v = narrowValue(event, (val): val is string => typeof val === "string");
    if (v === null) return;
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
      data-testid="gallery-radio-group"
      ref={responderRef as (el: HTMLDivElement | null) => void}
    >

      {/* ---- Sizes ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Sizes</div>
        <div style={{ display: "flex", flexDirection: "row", gap: "32px", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>sm</div>
            <TugRadioGroup size="sm" value={sizeSmValue} senderId="radio-sm" aria-label="Small radio group">
              <TugRadioItem value="a">Alpha</TugRadioItem>
              <TugRadioItem value="b">Beta</TugRadioItem>
              <TugRadioItem value="c">Gamma</TugRadioItem>
            </TugRadioGroup>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>md</div>
            <TugRadioGroup size="md" value={sizeMdValue} senderId="radio-md" aria-label="Medium radio group">
              <TugRadioItem value="a">Alpha</TugRadioItem>
              <TugRadioItem value="b">Beta</TugRadioItem>
              <TugRadioItem value="c">Gamma</TugRadioItem>
            </TugRadioGroup>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>lg</div>
            <TugRadioGroup size="lg" value={sizeLgValue} senderId="radio-lg" aria-label="Large radio group">
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
              senderId="radio-horz"
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
              senderId="radio-vert"
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
          senderId="radio-labeled"
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
              senderId="radio-disabled"
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
