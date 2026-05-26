/**
 * gallery-tug-inline-dialog.tsx — `TugInlineDialog` demo tab for the
 * Component Gallery.
 *
 * Six sections, each demonstrating one knob of the new header-bar
 * primitive's surface:
 *
 *   1. Bare CTA — title + description + trailing `actions` (one OK
 *      button).
 *   2. Caution shield + permission shape — `iconRole="caution"`,
 *      ShieldAlert, a radio-group `options` block (scope picker),
 *      `actions={<Deny/><Allow/>}`.
 *   3. Destructive confirm — `iconRole="danger"`, TriangleAlert,
 *      `actions={<Cancel/><Discard role="danger"/>}`.
 *   4. Rich children — a standalone `JsonTreeBlock` inside the body
 *      slot.
 *   5. Leading + trailing actions — `leadingActions={<Back/><Next/>}`
 *      + `actions={<Cancel/><Submit/>}`. Demonstrates the question-
 *      dialog shape with both action clusters on the header row.
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
  ArrowLeft,
  ArrowRight,
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
  type TugInlineDialogOption,
} from "@/components/tugways/tug-inline-dialog";
import { TugPushButton } from "@/components/tugways/tug-push-button";
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
// Permission-shape demo data
// ---------------------------------------------------------------------------

const PERMISSION_SCOPE_OPTIONS: ReadonlyArray<TugInlineDialogOption> = [
  {
    value: "allow-once",
    label: "Allow once",
    description: "Allow this single invocation. No rule is added.",
  },
  {
    value: "allow-project",
    label: "Allow for this project",
  },
];

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
  const [wizardResult, setWizardResult] = React.useState<string>("—");

  // Permission-shape selected scope. Mandatory single-select.
  const [permissionScope, setPermissionScope] = React.useState<string>(
    PERMISSION_SCOPE_OPTIONS[0].value,
  );

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
          Title + description + a single trailing action button; default{" "}
          <code>info</code> icon role.
        </div>
        <TugInlineDialog
          icon={<Info />}
          iconRole="info"
          title="Save this layout?"
          description="Layouts persist across reloads and apply to every new card opened in this workspace."
          actions={
            <TugPushButton
              emphasis="filled"
              role="action"
              size="xs"
              onClick={() => setBareResult("Saved")}
            >
              Save
            </TugPushButton>
          }
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
          <code>iconRole="caution"</code> + ShieldAlert; the{" "}
          <code>options</code> radio group is the scope picker —
          mandatory single-select; <code>actions</code> carries
          Deny / Allow.
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
          actions={
            <>
              <TugPushButton
                emphasis="outlined"
                role="danger"
                size="xs"
                onClick={() => setPermissionResult("Denied")}
              >
                Deny
              </TugPushButton>
              <TugPushButton
                emphasis="filled"
                role="action"
                size="xs"
                onClick={() =>
                  setPermissionResult(`Allowed — scope: ${permissionScope}`)
                }
              >
                Allow
              </TugPushButton>
            </>
          }
          options={PERMISSION_SCOPE_OPTIONS}
          selectedOption={permissionScope}
          onSelectOption={setPermissionScope}
          optionsAriaLabel="Permission scope"
        />
        <div style={resultStyle}>
          Result: <strong>{permissionResult}</strong>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 3. Destructive confirm ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Destructive confirm</TugLabel>
        <div style={labelStyle}>
          <code>iconRole="danger"</code> + TriangleAlert; trailing{" "}
          <code>actions</code> = Cancel (outlined-action) + Discard
          (filled-danger).
        </div>
        <TugInlineDialog
          icon={<TriangleAlert />}
          iconRole="danger"
          title="Discard unsaved changes?"
          description="You've made changes to “Homepage Copy” that haven't been saved. Leaving now will discard them."
          actions={
            <>
              <TugPushButton
                emphasis="outlined"
                role="action"
                size="xs"
                onClick={() => setDestructiveResult("Cancelled")}
              >
                Cancel
              </TugPushButton>
              <TugPushButton
                emphasis="filled"
                role="danger"
                size="xs"
                onClick={() => setDestructiveResult("Discarded")}
              >
                Discard
              </TugPushButton>
            </>
          }
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
          A standalone <code>JsonTreeBlock</code> in the body slot —
          body kinds compose cleanly without chrome.
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
          actions={
            <>
              <TugPushButton
                emphasis="outlined"
                role="danger"
                size="xs"
                onClick={() => setRichResult("Denied")}
              >
                Deny
              </TugPushButton>
              <TugPushButton
                emphasis="filled"
                role="action"
                size="xs"
                onClick={() => setRichResult("Allowed")}
              >
                Allow
              </TugPushButton>
            </>
          }
        >
          <JsonTreeBlock data={sampleJson} label="input" />
        </TugInlineDialog>
        <div style={resultStyle}>
          Result: <strong>{richResult}</strong>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 5. Leading + trailing actions (question-dialog shape) ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Leading + trailing actions
        </TugLabel>
        <div style={labelStyle}>
          <code>leadingActions</code> carries wizard nav (Back / Next) at
          the leading edge of the header row; <code>actions</code>{" "}
          carries dialog controls (Cancel / Submit) at the trailing
          edge. The text column absorbs the space between them.
        </div>
        <TugInlineDialog
          icon={<Info />}
          iconRole="info"
          title="Claude has questions"
          description="4 questions · 0 answered"
          leadingActions={
            <>
              <TugPushButton
                emphasis="outlined"
                role="action"
                size="xs"
                onClick={() => setWizardResult("Back")}
              >
                <ArrowLeft size={14} aria-hidden="true" /> Back
              </TugPushButton>
              <TugPushButton
                emphasis="outlined"
                role="action"
                size="xs"
                onClick={() => setWizardResult("Next")}
              >
                Next <ArrowRight size={14} aria-hidden="true" />
              </TugPushButton>
            </>
          }
          actions={
            <>
              <TugPushButton
                emphasis="outlined"
                role="danger"
                size="xs"
                onClick={() => setWizardResult("Cancelled")}
              >
                Cancel
              </TugPushButton>
              <TugPushButton
                emphasis="filled"
                role="action"
                size="xs"
                onClick={() => setWizardResult("Submitted")}
              >
                Submit
              </TugPushButton>
            </>
          }
        />
        <div style={resultStyle}>
          Result: <strong>{wizardResult}</strong>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 6. Icon-role gallery ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Icon-role gallery</TugLabel>
        <div style={labelStyle}>
          The five <code>iconRole</code> values rendered side by side
          against the same dummy title and a single OK action.
        </div>
        <div style={ICON_ROLE_TILE_ROW}>
          {TUG_INLINE_DIALOG_ICON_ROLES.map((role) => (
            <div key={role} style={{ flex: "1 1 0", minWidth: 0 }}>
              <TugInlineDialog
                icon={iconForRole(role)}
                iconRole={role}
                title={role}
                actions={
                  <TugPushButton
                    emphasis="outlined"
                    role="action"
                    size="xs"
                    onClick={() => undefined}
                  >
                    OK
                  </TugPushButton>
                }
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
