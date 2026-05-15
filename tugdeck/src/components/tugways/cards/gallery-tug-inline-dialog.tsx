/**
 * gallery-tug-inline-dialog.tsx — TugInlineDialog demo tab for the
 * Component Gallery.
 *
 * Six sections, each demonstrating one knob of the primitive's
 * surface — see [#step-18-5](roadmap/tide-assistant-rendering.md#step-18-5):
 *
 *   1. Bare CTA — title + description + cancel + confirm.
 *   2. Caution shield + permission shape — `iconRole="caution"`,
 *      ShieldAlert, suggestion-style outline button in `children`,
 *      Allow / Deny actions.
 *   3. Destructive confirm — `iconRole="danger"`, TriangleAlert,
 *      `confirmRole="danger"`, Discard / Cancel.
 *   4. Rich children — a standalone `JsonTreeBlock` inside the
 *      children slot.
 *   5. Single-action — `cancelLabel={null}`, info icon, OK only.
 *   6. Icon-role gallery — five compact tiles side by side, one per
 *      `iconRole`, against the same dummy title.
 *
 * The result-indicator pattern from `gallery-alert.tsx` is reused so
 * each section reports the user's last click without needing a real
 * downstream effect.
 *
 * @module components/tugways/cards/gallery-tug-inline-dialog
 */

import React from "react";
import {
  Info,
  Settings2,
  ShieldAlert,
  Shell,
  TriangleAlert,
} from "lucide-react";

import { TugInlineDialog } from "@/components/tugways/tug-inline-dialog";
import {
  TUG_INLINE_DIALOG_ICON_ROLES,
  type TugInlineDialogIconRole,
} from "@/components/tugways/tug-inline-dialog";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { JsonTreeBlock } from "@/components/tugways/body-kinds/json-tree-block";

const labelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginBottom: "4px",
};

const resultStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginTop: "8px",
};

const ICON_ROLE_TILE_ROW: React.CSSProperties = {
  display: "flex",
  flexDirection: "row",
  flexWrap: "wrap",
  gap: "0.75rem",
  alignItems: "stretch",
};

// ---------------------------------------------------------------------------
// Extra-actions row-grid demo data
// ---------------------------------------------------------------------------

interface ExtraActionsLayoutDemo {
  label: string;
  count: number;
  actions: ReadonlyArray<{ label: string; onClick: () => void }>;
}

/**
 * Build a list of `n` synthetic suggestion-style actions with stable
 * labels so the demo reads as a deliberate fixture rather than a
 * loop-generated stub.
 */
function buildDemoActions(
  n: number,
): ReadonlyArray<{ label: string; onClick: () => void }> {
  const labels = [
    "Allow for this session",
    "Allow for this project",
    "Always allow",
    "Allow once",
    "Always allow + log",
    "Allow only this command",
  ];
  const out: { label: string; onClick: () => void }[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      label: labels[i] ?? `Option ${i + 1}`,
      onClick: () => undefined,
    });
  }
  return out;
}

const EXTRA_ACTIONS_LAYOUT_DEMOS: ReadonlyArray<ExtraActionsLayoutDemo> = [
  { label: "1 suggestion → [1] (half-width)", count: 1, actions: buildDemoActions(1) },
  { label: "2 suggestions → [2] (50/50)",       count: 2, actions: buildDemoActions(2) },
  { label: "3 suggestions → [3] (33/33/33)",    count: 3, actions: buildDemoActions(3) },
  { label: "4 suggestions → [2, 2] (2 over 2)", count: 4, actions: buildDemoActions(4) },
];

const extraActionsDemoStyle: React.CSSProperties = {
  marginTop: "0.5rem",
};

const extraActionsCaptionStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginBottom: "0.25rem",
};

// Compact tile for the icon-role gallery — narrower than the default
// max-width so five sit side by side comfortably. CSS custom
// properties inherit, so setting these on the wrapper feeds the
// inner `.tug-inline-dialog` rule that consumes them.
const COMPACT_TILE_DIALOG_STYLE = {
  ["--tugx-idialog-max-width" as string]: "12rem",
  ["--tugx-idialog-margin" as string]: "0",
} as React.CSSProperties;

// ---------------------------------------------------------------------------
// GalleryTugInlineDialog
// ---------------------------------------------------------------------------

export function GalleryTugInlineDialog(): React.ReactElement {
  // Per-section result strings so each demo shows what the user last
  // clicked. Mirrors `gallery-alert.tsx`.
  const [bareResult, setBareResult] = React.useState<string>("—");
  const [permissionResult, setPermissionResult] = React.useState<string>("—");
  const [destructiveResult, setDestructiveResult] = React.useState<string>("—");
  const [richResult, setRichResult] = React.useState<string>("—");
  const [singleResult, setSingleResult] = React.useState<string>("—");

  // Sample JSON for the rich-children section. Stable across renders so
  // the JsonTreeBlock's component-state-preservation key doesn't churn.
  const sampleJson = React.useMemo(
    () => ({
      file_path: "/Users/me/project/src/index.ts",
      offset: 1,
      limit: 200,
      checksum: "sha256:0e8c9c1a…",
      flags: { recursive: true, follow_symlinks: false },
    }),
    [],
  );

  const iconForRole = (role: TugInlineDialogIconRole): React.ReactNode => {
    switch (role) {
      case "default":
        return <Settings2 />;
      case "caution":
        return <ShieldAlert />;
      case "danger":
        return <TriangleAlert />;
      case "success":
        return <Shell />;
      case "info":
      default:
        return <Info />;
    }
  };

  return (
    <div className="cg-content" data-testid="gallery-tug-inline-dialog">
      {/* ---- 1. Bare CTA ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Bare CTA</TugLabel>
        <div style={labelStyle}>
          Title + description + Cancel + Confirm; default <code>info</code>{" "}
          icon role; no children.
        </div>
        <TugInlineDialog
          icon={<Info />}
          iconRole="info"
          title="Save this layout?"
          description="Layouts persist across reloads and apply to every new card opened in this workspace."
          confirmLabel="Save"
          onConfirm={() => setBareResult("Saved")}
          onCancel={() => setBareResult("Cancelled")}
        />
        <div style={resultStyle}>
          Result: <strong>{bareResult}</strong>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 2. Caution shield + permission shape ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Permission shape</TugLabel>
        <div style={labelStyle}>
          <code>iconRole="caution"</code> + ShieldAlert; one secondary
          action via <code>extraActions</code> (auto-laid out at half
          width); Allow / Deny.
        </div>
        <TugInlineDialog
          icon={<ShieldAlert />}
          iconRole="caution"
          title="Permission requested"
          description={
            <>
              This command requires approval ·{" "}
              <span style={{ verticalAlign: "middle" }}>
                <Shell size={12} aria-hidden="true" />
              </span>{" "}
              Bash · <code>tokei</code>
            </>
          }
          confirmLabel="Allow"
          confirmRole="action"
          cancelLabel="Deny"
          onConfirm={() => setPermissionResult("Allowed")}
          onCancel={() => setPermissionResult("Denied")}
          extraActions={[
            {
              label: "Allow for this project",
              onClick: () =>
                setPermissionResult("Allowed for this project"),
            },
          ]}
        />
        <div style={resultStyle}>
          Result: <strong>{permissionResult}</strong>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 2b. Extra-actions row-grid layouts ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Extra-actions row-grid (1 → 2 → 3 → 4)
        </TugLabel>
        <div style={labelStyle}>
          <code>extraActions</code> auto-partitions per{" "}
          <code>partitionDialogActions</code>: 1 → half-width single
          button; 2 → 50/50; 3 → 33/33/33; 4 → 2 over 2.
        </div>
        {EXTRA_ACTIONS_LAYOUT_DEMOS.map((demo) => (
          <div key={demo.label} style={extraActionsDemoStyle}>
            <div style={extraActionsCaptionStyle}>{demo.label}</div>
            <TugInlineDialog
              icon={<ShieldAlert />}
              iconRole="caution"
              title="Permission requested"
              description={
                <>
                  Sample permission with <code>{demo.count}</code>{" "}
                  {demo.count === 1 ? "suggestion" : "suggestions"}.
                </>
              }
              confirmLabel="Allow"
              confirmRole="action"
              cancelLabel="Deny"
              onConfirm={() => undefined}
              onCancel={() => undefined}
              extraActions={demo.actions}
            />
          </div>
        ))}
      </div>

      <TugSeparator />

      {/* ---- 3. Destructive confirm ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Destructive confirm</TugLabel>
        <div style={labelStyle}>
          <code>iconRole="danger"</code> + TriangleAlert;{" "}
          <code>confirmRole="danger"</code>; Discard / Cancel.
        </div>
        <TugInlineDialog
          icon={<TriangleAlert />}
          iconRole="danger"
          title="Discard unsaved changes?"
          description="You've made changes to “Homepage Copy” that haven't been saved. Leaving now will discard them."
          confirmLabel="Discard"
          confirmRole="danger"
          onConfirm={() => setDestructiveResult("Discarded")}
          onCancel={() => setDestructiveResult("Cancelled")}
        />
        <div style={resultStyle}>
          Result: <strong>{destructiveResult}</strong>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 4. Rich children ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Rich children</TugLabel>
        <div style={labelStyle}>
          A standalone <code>JsonTreeBlock</code> in the{" "}
          <code>children</code> slot — body kinds compose cleanly without
          chrome.
        </div>
        <TugInlineDialog
          icon={<ShieldAlert />}
          iconRole="caution"
          title="Permission requested"
          description={
            <>
              This will run <code>Read</code> with the parameters below.
            </>
          }
          confirmLabel="Allow"
          cancelLabel="Deny"
          onConfirm={() => setRichResult("Allowed")}
          onCancel={() => setRichResult("Denied")}
        >
          <JsonTreeBlock data={sampleJson} label="input" />
        </TugInlineDialog>
        <div style={resultStyle}>
          Result: <strong>{richResult}</strong>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 5. Single-action ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Single-action (no Cancel)</TugLabel>
        <div style={labelStyle}>
          <code>cancelLabel={"{null}"}</code>; <code>iconRole="info"</code>;
          OK only — single-button acknowledgement.
        </div>
        <TugInlineDialog
          icon={<Info />}
          iconRole="info"
          title="Workspace exported"
          description="The export bundle was written to ~/Downloads/workspace.tug. You can re-import it from File · Open Workspace."
          confirmLabel="OK"
          cancelLabel={null}
          onConfirm={() => setSingleResult("Acknowledged")}
        />
        <div style={resultStyle}>
          Result: <strong>{singleResult}</strong>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 6. Icon-role gallery ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Icon-role gallery</TugLabel>
        <div style={labelStyle}>
          The five <code>iconRole</code> values rendered side by side
          against the same dummy title. Compact tiles override the
          primitive's <code>--tugx-idialog-max-width</code>.
        </div>
        <div style={ICON_ROLE_TILE_ROW}>
          {TUG_INLINE_DIALOG_ICON_ROLES.map((role) => (
            <div
              key={role}
              style={{ flex: "1 1 0", minWidth: 0 }}
            >
              <div style={COMPACT_TILE_DIALOG_STYLE}>
                <TugInlineDialog
                  icon={iconForRole(role)}
                  iconRole={role}
                  title={role}
                  description="Same prop bag, different icon role."
                  confirmLabel="OK"
                  cancelLabel={null}
                  onConfirm={() => undefined}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
