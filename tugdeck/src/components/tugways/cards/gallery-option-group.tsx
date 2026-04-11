/**
 * gallery-option-group.tsx -- TugOptionGroup demo tab for the Component Gallery.
 *
 * Shows TugOptionGroup in all sizes, roles, disabled states, and inside a
 * disabled TugBox cascade. Each item toggles independently (multi-select).
 *
 * NOT a choice group — TugOptionGroup allows zero or more items active
 * simultaneously, while TugChoiceGroup enforces exactly one selection.
 * See roadmap/group-family.md for the full distinction.
 *
 * Rules of Tugways compliance:
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-option-group
 */

import React, { useId, useState } from "react";
import {
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  LayoutGrid,
  Table,
} from "lucide-react";
import { TugOptionGroup } from "@/components/tugways/tug-option-group";
import type { TugOptionGroupRole } from "@/components/tugways/tug-option-group";
import { TugBox } from "@/components/tugways/tug-box";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLE_ENTRIES: Array<{ role: TugOptionGroupRole | undefined; label: string }> = [
  { role: undefined,   label: "accent (default)" },
  { role: "action",    label: "action" },
  { role: "success",   label: "success" },
  { role: "danger",    label: "danger" },
];

// ---------------------------------------------------------------------------
// GalleryOptionGroup
// ---------------------------------------------------------------------------

export function GalleryOptionGroup() {
  // Section 1: Icon Only — B/I/U text formatting
  const [formatValue, setFormatValue] = useState<string[]>(["bold"]);

  // Section 2: Icon + Label — alignment toolbar
  const [alignValue, setAlignValue] = useState<string[]>(["left"]);

  // Section 3: Sizes — sm, md, lg each with List/LayoutGrid/Table
  const [smValue, setSmValue] = useState<string[]>(["list"]);
  const [mdValue, setMdValue] = useState<string[]>(["list"]);
  const [lgValue, setLgValue] = useState<string[]>(["list"]);

  // Section 4: Roles — one state per role entry
  const [roleValues, setRoleValues] = useState<Record<string, string[]>>(() => ({
    "accent (default)": ["b"],
    "action":           ["b"],
    "success":          ["b"],
    "danger":           ["b"],
  }));

  // Section 5: Disabled — group disabled and individual items disabled
  const [partialValue, setPartialValue] = useState<string[]>(["bold"]);

  // Section 6: TugBox cascade
  const [cascadeValue, setCascadeValue] = useState<string[]>(["bold", "italic"]);

  // L11 migration via useResponderForm — see gallery-checkbox.tsx for the
  // annotated reference. TugOptionGroup dispatches `setValue` with a
  // `string[]` payload, so the bindings go in the `setValueStringArray`
  // slot. Gensym'd sender ids per option group.
  //
  // TugOptionGroup also dispatches `focusNext`/`focusPrevious` on
  // arrow-key roving focus. This card doesn't handle those — they
  // flow through the chain unhandled, which is fine.
  const formatId = useId();
  const alignId = useId();
  const smId = useId();
  const mdId = useId();
  const lgId = useId();
  const partialId = useId();
  const cascadeId = useId();
  const roleBaseId = useId();
  const roleIds: Record<string, string> = Object.fromEntries(
    ROLE_ENTRIES.map(({ label }) => [label, `${roleBaseId}-${label}`]),
  );

  const setValueStringArrayBindings: Record<string, (v: string[]) => void> = {
    [formatId]: setFormatValue,
    [alignId]: setAlignValue,
    [smId]: setSmValue,
    [mdId]: setMdValue,
    [lgId]: setLgValue,
    [partialId]: setPartialValue,
    [cascadeId]: setCascadeValue,
  };
  for (const { label } of ROLE_ENTRIES) {
    setValueStringArrayBindings[roleIds[label]] = (v: string[]) =>
      setRoleValues((prev) => ({ ...prev, [label]: v }));
  }

  const { ResponderScope, responderRef } = useResponderForm({
    setValueStringArray: setValueStringArrayBindings,
  });

  return (
    <ResponderScope>
    <div
      className="cg-content"
      data-testid="gallery-option-group"
      ref={responderRef as (el: HTMLDivElement | null) => void}
    >

      {/* ---- Icon Only (Text Formatting) ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Icon Only (Text Formatting)</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ fontSize: "0.8125rem", color: "var(--tug7-element-field-text-normal-label-rest)" }}>
            Classic B/I/U toolbar — each item toggles independently.
          </div>
          <TugOptionGroup
            value={formatValue}
            senderId={formatId}
            aria-label="Text formatting"
            items={[
              { value: "bold",      icon: <Bold />,      "aria-label": "Bold" },
              { value: "italic",    icon: <Italic />,    "aria-label": "Italic" },
              { value: "underline", icon: <Underline />, "aria-label": "Underline" },
            ]}
          />
          <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)" }}>
            Active:{" "}
            <strong>
              {formatValue.length === 0 ? "none" : formatValue.join(", ")}
            </strong>
          </div>
        </div>
      </div>

      <TugSeparator />

      {/* ---- Icon + Label (Alignment) ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Icon + Label</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ fontSize: "0.8125rem", color: "var(--tug7-element-field-text-normal-label-rest)" }}>
            Alignment toolbar — icon and label together.
          </div>
          <TugOptionGroup
            value={alignValue}
            senderId={alignId}
            aria-label="Text alignment"
            items={[
              { value: "left",    label: "Left",    icon: <AlignLeft /> },
              { value: "center",  label: "Center",  icon: <AlignCenter /> },
              { value: "right",   label: "Right",   icon: <AlignRight /> },
              { value: "justify", label: "Justify", icon: <AlignJustify /> },
            ]}
          />
          <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)" }}>
            Active:{" "}
            <strong>
              {alignValue.length === 0 ? "none" : alignValue.join(", ")}
            </strong>
          </div>
        </div>
      </div>

      <TugSeparator />

      {/* ---- Sizes ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Sizes</TugLabel>
        <div style={{ display: "flex", flexDirection: "row", gap: "32px", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>sm</div>
            <TugOptionGroup
              size="sm"
              value={smValue}
              senderId={smId}
              aria-label="Small option group"
              items={[
                { value: "list",   icon: <List />,       "aria-label": "List" },
                { value: "grid",   icon: <LayoutGrid />, "aria-label": "Grid" },
                { value: "table",  icon: <Table />,      "aria-label": "Table" },
              ]}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>md</div>
            <TugOptionGroup
              size="md"
              value={mdValue}
              senderId={mdId}
              aria-label="Medium option group"
              items={[
                { value: "list",   icon: <List />,       "aria-label": "List" },
                { value: "grid",   icon: <LayoutGrid />, "aria-label": "Grid" },
                { value: "table",  icon: <Table />,      "aria-label": "Table" },
              ]}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>lg</div>
            <TugOptionGroup
              size="lg"
              value={lgValue}
              senderId={lgId}
              aria-label="Large option group"
              items={[
                { value: "list",   icon: <List />,       "aria-label": "List" },
                { value: "grid",   icon: <LayoutGrid />, "aria-label": "Grid" },
                { value: "table",  icon: <Table />,      "aria-label": "Table" },
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
          {ROLE_ENTRIES.map(({ role, label }) => (
            <div key={label} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "16px" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", width: "120px", flexShrink: 0 }}>
                {label}
              </div>
              <TugOptionGroup
                role={role}
                value={roleValues[label]}
                senderId={roleIds[label]}
                aria-label={`${label} option group`}
                items={[
                  { value: "b", icon: <Bold />,      "aria-label": "Bold" },
                  { value: "i", icon: <Italic />,    "aria-label": "Italic" },
                  { value: "u", icon: <Underline />, "aria-label": "Underline" },
                ]}
              />
            </div>
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
              group disabled (selected items still visible)
            </div>
            <TugOptionGroup
              disabled
              value={["bold", "italic"]}
              aria-label="Disabled option group"
              items={[
                { value: "bold",      icon: <Bold />,      "aria-label": "Bold" },
                { value: "italic",    icon: <Italic />,    "aria-label": "Italic" },
                { value: "underline", icon: <Underline />, "aria-label": "Underline" },
              ]}
            />
          </div>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              individual items disabled
            </div>
            <TugOptionGroup
              value={partialValue}
              senderId={partialId}
              aria-label="Partial disabled option group"
              items={[
                { value: "bold",      icon: <Bold />,      "aria-label": "Bold" },
                { value: "italic",    icon: <Italic />,    "aria-label": "Italic (disabled)", disabled: true },
                { value: "underline", icon: <Underline />, "aria-label": "Underline" },
              ]}
            />
          </div>
        </div>
      </div>

      <TugSeparator />

      {/* ---- TugBox Cascade ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugBox Cascade</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ fontSize: "0.8125rem", color: "var(--tug7-element-field-text-normal-label-rest)" }}>
            TugOptionGroup inside a disabled TugBox — all items inherit the disabled state.
          </div>
          <TugBox disabled label="Formatting Options" variant="bordered">
            <TugOptionGroup
              value={cascadeValue}
              senderId={cascadeId}
              aria-label="Cascaded disabled option group"
              items={[
                { value: "bold",      icon: <Bold />,      "aria-label": "Bold" },
                { value: "italic",    icon: <Italic />,    "aria-label": "Italic" },
                { value: "underline", icon: <Underline />, "aria-label": "Underline" },
              ]}
            />
          </TugBox>
        </div>
      </div>

    </div>
    </ResponderScope>
  );
}
