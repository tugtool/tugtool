/**
 * gallery-modal-headers.tsx — reference card for the unified modal-header
 * convention.
 *
 * Every modal/overlay header (TugAlert, TugAlertSheet, TugSheet, TugSetup,
 * TugVersionGate) draws one scale from `styles/tugx-header.css`, in three
 * cases: one-line (title only), two-line (title + description), and alert
 * (title + message). This card renders each case as a static panel so the
 * convention can be judged at a glance without summoning live overlays.
 *
 * Each case is shown twice: once through the real shipped classes
 * (`.tug-sheet-*` / `.tug-alert-*`, exactly the markup the components
 * render) and once through the `.cg-mh-*` spec classes that consume the
 * same tokens (see gallery-modal-headers.css for the class → component
 * map). The two panels of a pair must look identical — a visible
 * difference means a component has drifted off the shared tokens.
 *
 * @module components/tugways/cards/gallery-modal-headers
 */

import React from "react";
import {
  Bot,
  Gauge,
  History,
  Pencil,
  Rocket,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import "./gallery.css";
import "./gallery-modal-headers.css";

// ---------------------------------------------------------------------------
// Spec header — the .cg-mh-* classes consuming the shared tokens
// ---------------------------------------------------------------------------

/** The three header cases of the convention. */
type HeaderKind = "one" | "two" | "alert";

type HeaderIconRole = "muted" | "agent" | "action" | "danger";

interface SpecHeaderProps {
  kind: HeaderKind;
  icon: React.ReactNode;
  iconRole?: HeaderIconRole;
  title: string;
  description?: string;
}

function SpecHeader({
  kind,
  icon,
  iconRole = "muted",
  title,
  description,
}: SpecHeaderProps): React.ReactElement {
  return (
    <div className="cg-mh-header" data-kind={kind} data-icon-role={iconRole}>
      <div className="cg-mh-icon" aria-hidden="true">
        {icon}
      </div>
      <div className="cg-mh-heading">
        <div className="cg-mh-title">{title}</div>
        {description && <div className="cg-mh-desc">{description}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shipped headers — the real component classes and markup, verbatim
// ---------------------------------------------------------------------------

function ShippedSheetHeader({
  icon,
  iconRole = "muted",
  title,
  description,
}: {
  icon: React.ReactNode;
  iconRole?: HeaderIconRole;
  title: string;
  description?: string;
}): React.ReactElement {
  return (
    <div
      className="tug-sheet-header"
      data-icon-role={iconRole}
      data-has-description={description ? "true" : undefined}
    >
      <div className="tug-sheet-icon" aria-hidden="true">
        {icon}
      </div>
      <div className="tug-sheet-heading">
        <div className="tug-sheet-title">{title}</div>
        {description && <p className="tug-sheet-description">{description}</p>}
      </div>
    </div>
  );
}

function ShippedAlertHeader({
  icon,
  iconRole,
  title,
  message,
}: {
  icon: React.ReactNode;
  iconRole?: HeaderIconRole;
  title: string;
  message?: string;
}): React.ReactElement {
  return (
    <div
      className="tug-alert-body"
      data-icon-role={iconRole}
      data-has-message={message ? "true" : undefined}
    >
      <div className="tug-alert-icon" aria-hidden="true">
        {icon}
      </div>
      <div className="tug-alert-text">
        <div className="tug-alert-title">{title}</div>
        {message && <p className="tug-alert-message">{message}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fixtures — panels, mock rows, actions
// ---------------------------------------------------------------------------

function MockPanel({
  caption,
  children,
}: {
  caption: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="cg-mh-unit">
      <TugLabel size="2xs" emphasis="calm">
        {caption}
      </TugLabel>
      <div className="cg-mh-panel">{children}</div>
    </div>
  );
}

function MockRow({
  label,
  detail,
}: {
  label: string;
  detail: string;
}): React.ReactElement {
  return (
    <div className="cg-mh-row">
      <span className="cg-mh-row-label">{label}</span>
      <span className="cg-mh-row-detail">{detail}</span>
    </div>
  );
}

const PICKER_ROWS = (
  <div className="cg-mh-rows">
    <MockRow label="Low" detail="Quick edits and simple tasks" />
    <MockRow label="Medium" detail="Balanced depth for everyday work" />
  </div>
);

const RESUME_ROWS = (
  <div className="cg-mh-rows">
    <MockRow label="Redesign Pulse card" detail="2 hours ago · 14 turns" />
    <MockRow label="Activity feed emitter" detail="Yesterday · 31 turns" />
  </div>
);

const SETUP_ROWS = (
  <div className="cg-mh-rows">
    <MockRow label="Claude Code installed" detail="Claude Code is ready." />
    <MockRow label="Logged in as ken@example.com" detail="Claude Max plan" />
  </div>
);

const DELETE_MESSAGE =
  "This card and all its contents will be permanently removed. You can't undo this action.";

const REWIND_MESSAGE =
  "Rewind needs at least one completed turn before the current point. Send a prompt first, then rewind.";

function DeleteActions(): React.ReactElement {
  return (
    <div className="cg-mh-actions">
      <TugPushButton size="sm" emphasis="filled" role="action">
        Cancel
      </TugPushButton>
      <TugPushButton size="sm" emphasis="filled" role="danger">
        Delete
      </TugPushButton>
    </div>
  );
}

function OkAction(): React.ReactElement {
  return (
    <div className="cg-mh-actions">
      <TugPushButton size="sm" emphasis="filled" role="action">
        OK
      </TugPushButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryModalHeaders
// ---------------------------------------------------------------------------

export function GalleryModalHeaders(): React.ReactElement {
  return (
    <div className="cg-content cg-mh-scope" data-testid="gallery-modal-headers">
      {/* ---- The convention ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">The Convention</TugLabel>
        <div className="cg-mh-notes">
          <span className="cg-mh-note">
            <strong>One title scale everywhere:</strong> 17px / 700 / lh 1.25.
            One description scale: 14px / lh 1.4, 4px under the title. All
            titles in Title Case.
          </span>
          <span className="cg-mh-note">
            <strong>Icon steps with the text block:</strong> 30px for a
            one-line header, 36px for two lines, 44px for an alert. Two-line
            and alert headers align the icon to the top of the title text;
            the one-line header centers it on its single line.
          </span>
          <span className="cg-mh-note">
            <strong>Parity check:</strong> each pair below renders the same
            header once through the shipped component classes and once
            through the spec classes — both consume the
            `--tugx-header-*` tokens (styles/tugx-header.css), so the two
            panels must look identical.
          </span>
        </div>
      </div>

      <TugSeparator />

      {/* ---- One-line header ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          One-Line Header — Title Only
        </TugLabel>
        <div className="cg-mh-compare">
          <MockPanel caption="shipped — .tug-sheet-* (utility sheets)">
            <ShippedSheetHeader icon={<Bot />} title="Agents" />
            {PICKER_ROWS}
          </MockPanel>
          <MockPanel caption="spec — .cg-mh-* one-line case">
            <SpecHeader kind="one" icon={<Bot />} title="Agents" />
            {PICKER_ROWS}
          </MockPanel>
        </div>
        <div className="cg-mh-compare">
          <MockPanel caption="shipped — TugSetup's exact markup: .tug-alert-* with data-icon-role=action, no message">
            <ShippedAlertHeader
              icon={<Rocket />}
              iconRole="action"
              title="Set Up Tug"
            />
            {SETUP_ROWS}
          </MockPanel>
          <MockPanel caption="shipped — .tug-sheet-*, Title Case">
            <ShippedSheetHeader icon={<Pencil />} title="Rename Session" />
            {RESUME_ROWS}
          </MockPanel>
        </div>
      </div>

      <TugSeparator />

      {/* ---- Two-line header ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Two-Line Header — Title + Description
        </TugLabel>
        <div className="cg-mh-compare">
          <MockPanel caption="shipped — .tug-sheet-* with data-has-description (the pickers)">
            <ShippedSheetHeader
              icon={<Gauge />}
              iconRole="agent"
              title="Reasoning Effort"
              description="Choose how long Claude thinks before answering."
            />
            {PICKER_ROWS}
          </MockPanel>
          <MockPanel caption="spec — .cg-mh-* two-line case">
            <SpecHeader
              kind="two"
              icon={<Gauge />}
              iconRole="agent"
              title="Reasoning Effort"
              description="Choose how long Claude thinks before answering."
            />
            {PICKER_ROWS}
          </MockPanel>
        </div>
        <div className="cg-mh-compare">
          <MockPanel caption="shipped — Resume in line with the other pickers: agent tint + Title Case">
            <ShippedSheetHeader
              icon={<RotateCcw />}
              iconRole="agent"
              title="Resume Session"
              description="Pick a session to resume in this card."
            />
            {RESUME_ROWS}
          </MockPanel>
        </div>
      </div>

      <TugSeparator />

      {/* ---- Alert header ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Alert Header — Title + Message
        </TugLabel>
        <div className="cg-mh-compare">
          <MockPanel caption="shipped — .tug-alert-* with data-has-message">
            <ShippedAlertHeader
              icon={<Trash2 />}
              title="Delete “Design System v3”?"
              message={DELETE_MESSAGE}
            />
            <DeleteActions />
          </MockPanel>
          <MockPanel caption="spec — .cg-mh-* alert case">
            <SpecHeader
              kind="alert"
              icon={<Trash2 />}
              title="Delete “Design System v3”?"
              description={DELETE_MESSAGE}
            />
            <DeleteActions />
          </MockPanel>
        </div>
        <div className="cg-mh-compare">
          <MockPanel caption="shipped — OK-only alert-sheet, Title Case">
            <ShippedAlertHeader
              icon={<History />}
              title="Can't Rewind"
              message={REWIND_MESSAGE}
            />
            <OkAction />
          </MockPanel>
        </div>
      </div>

      <TugSeparator />

      {/* ---- Where it lives ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Where It Lives</TugLabel>
        <div className="cg-mh-notes">
          <span className="cg-mh-note">
            <strong>Tokens:</strong> `--tugx-header-*` in
            styles/tugx-header.css — the single tuning point for title,
            description, icon sizes, gaps, and header margin.
          </span>
          <span className="cg-mh-note">
            <strong>Consumers:</strong> `.tug-sheet-header/icon/title/
            description` (tug-sheet.css) and `.tug-alert-body/icon/title/
            message` (tug-alert.css). TugAlertSheet, TugSetup, and
            TugVersionGate all render the `.tug-alert-*` classes — no
            component declares its own header scale.
          </span>
          <span className="cg-mh-note">
            <strong>Copy:</strong> Title Case everywhere. Alerts carry the
            sentence/question voice in the title with the explanation in the
            message; sheets stay noun-phrase labels.
          </span>
          <span className="cg-mh-note">
            <strong>Exemption:</strong> the attachment preview (a full-bleed
            lightbox with its own top bar) is the one sanctioned
            `hideHeader` surface outside the convention.
          </span>
        </div>
      </div>
    </div>
  );
}
