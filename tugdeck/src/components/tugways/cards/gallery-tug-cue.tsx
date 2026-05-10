/**
 * gallery-tug-cue.tsx — Phase 1 design exploration card for `TugCue`.
 *
 * `TugCue` (working name) is the new public component that fills a gap between
 * `TugPushButton` (CTA), `TugIconButton` (icon-only trailing), and `TugBanner`
 * (app-modal status strip): a soft, full-width *banner-shaped click target* —
 * the affordance that "1,230 lines folded — click to expand" should be.
 *
 * Phase 1 (this card) ships **ad-hoc prototype JSX**, not a finished component.
 * The six variants below sweep the design axes called out in the roadmap so
 * the user can vet visually:
 *
 *   A. Soft Italic       — today's `tugx-file-collapsed-hint` shape, made clickable
 *   B. Roman + hairline  — adds structural hairlines top/bottom
 *   C. Leading icon      — `ChevronsUpDown` glyph signals expandability
 *   D. Comfortable       — bigger padding, dotted-underline on hover (link-y)
 *   E. Accent + Info     — subtle accent bg + Info icon for informational cues
 *   F. Compact ghost     — tightest density, just a soft hover lift
 *
 * Each variant fires onClick into a shared debug strip so the user can confirm
 * pointer activation AND keyboard activation (Tab → focus-visible → Enter / Space).
 *
 * No responder-chain wiring at this phase: per [L11] the production component
 * lands with mutually-exclusive `onClick` / `action` props in Phase 2; here we
 * only need to vet shape and weight.
 *
 * Tuglaw cross-check:
 *  - [L19] this module is the .tsx half of the file-pair; the .css half is
 *    `gallery-tug-cue.css`. Module docstring; no `data-slot` because the
 *    prototypes are not the public component.
 *  - [L20] every visible declaration in the sidecar consumes a `--tug7-*` token
 *    or a documented inline rgba constant.
 *
 * **Authoritative reference:** `roadmap/tide-assistant-rendering.md` #step-10-6.
 *
 * @module components/tugways/cards/gallery-tug-cue
 */

import React, { useId, useState } from "react";
import { ChevronsUpDown, Info } from "lucide-react";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugBox } from "@/components/tugways/tug-box";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import "./gallery-tug-cue.css";

// ---------------------------------------------------------------------------
// Debug strip
// ---------------------------------------------------------------------------

interface DebugEntry {
  variant: string;
  at: number;
  via: "pointer" | "keyboard";
}

function formatTime(t: number): string {
  const d = new Date(t);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${d.getMilliseconds().toString().padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Per-variant prototype JSX
//
// Each variant is a self-contained `<button>` (semantically correct — these
// ARE click targets) plus an aria-expanded attribute to model the "collapsed
// hint that expands content" call site. The production component will move
// these into a single configurable surface; for Phase 1 they're inlined so
// each variant's exact shape can be tuned without prop coupling.
// ---------------------------------------------------------------------------

interface VariantProps {
  expanded: boolean;
  label: string;
  onActivate: (via: "pointer" | "keyboard") => void;
}

function VariantA({ expanded, label, onActivate }: VariantProps) {
  return (
    <button
      type="button"
      className="cg-tug-cue-a"
      aria-expanded={expanded}
      onClick={() => onActivate("pointer")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate("keyboard");
        }
      }}
    >
      {label}
    </button>
  );
}

function VariantB({ expanded, label, onActivate }: VariantProps) {
  return (
    <button
      type="button"
      className="cg-tug-cue-b"
      aria-expanded={expanded}
      onClick={() => onActivate("pointer")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate("keyboard");
        }
      }}
    >
      {label}
    </button>
  );
}

function VariantC({ expanded, label, onActivate }: VariantProps) {
  return (
    <button
      type="button"
      className="cg-tug-cue-c"
      aria-expanded={expanded}
      onClick={() => onActivate("pointer")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate("keyboard");
        }
      }}
    >
      <ChevronsUpDown size={12} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

function VariantD({ expanded, label, onActivate }: VariantProps) {
  return (
    <button
      type="button"
      className="cg-tug-cue-d"
      aria-expanded={expanded}
      onClick={() => onActivate("pointer")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate("keyboard");
        }
      }}
    >
      <span className="cg-tug-cue-d-text">{label}</span>
    </button>
  );
}

function VariantE({ expanded, label, onActivate }: VariantProps) {
  return (
    <button
      type="button"
      className="cg-tug-cue-e"
      aria-expanded={expanded}
      onClick={() => onActivate("pointer")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate("keyboard");
        }
      }}
    >
      <Info size={12} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

function VariantF({ expanded, label, onActivate }: VariantProps) {
  return (
    <button
      type="button"
      className="cg-tug-cue-f"
      aria-expanded={expanded}
      onClick={() => onActivate("pointer")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate("keyboard");
        }
      }}
    >
      {label}
    </button>
  );
}

function VariantG({ expanded, label, onActivate }: VariantProps) {
  return (
    <button
      type="button"
      className="cg-tug-cue-g"
      aria-expanded={expanded}
      onClick={() => onActivate("pointer")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate("keyboard");
        }
      }}
    >
      <ChevronsUpDown size={12} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Variant catalog
// ---------------------------------------------------------------------------

interface VariantDef {
  id: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  title: string;
  blurb: string;
  Component: React.ComponentType<VariantProps>;
}

const VARIANTS: readonly VariantDef[] = [
  { id: "A", title: "A — Soft italic", blurb: "today's collapsed-hint shape, now clickable", Component: VariantA },
  { id: "B", title: "B — Roman + hairline", blurb: "adds top/bottom hairlines for structure", Component: VariantB },
  { id: "C", title: "C — Leading icon (italic)", blurb: "ChevronsUpDown glyph signals expandability", Component: VariantC },
  { id: "D", title: "D — Comfortable (link-y)", blurb: "bigger padding, dotted-underline on hover", Component: VariantD },
  { id: "E", title: "E — Accent + Info icon", blurb: "subtle accent bg for informational cues", Component: VariantE },
  { id: "F", title: "F — Compact / ghost", blurb: "tightest density, ghosty hover lift", Component: VariantF },
  { id: "G", title: "G — Combo (B + C + E)", blurb: "roman text · ChevronsUpDown leading · accent bg + hairlines", Component: VariantG },
];

// ---------------------------------------------------------------------------
// Real-host preview helper
// ---------------------------------------------------------------------------

/**
 * Renders the focused variant inside a fake-FileBlock surface so the user can
 * judge how it reads at the actual call site (after a header, capping a
 * truncated body). When `expanded`, shows a few placeholder lines beneath
 * the cue to mimic an Expand-to-view interaction.
 */
function HostPreview({
  Variant,
  expanded,
  onActivate,
}: {
  Variant: React.ComponentType<VariantProps>;
  expanded: boolean;
  onActivate: (via: "pointer" | "keyboard") => void;
}) {
  const label = expanded
    ? "click to collapse"
    : "1,230 lines folded — click to expand";
  return (
    <div className="cg-tug-cue-host">
      <div className="cg-tug-cue-host-header">
        <span>src/components/tugways/internal/tide-card-transcript.tsx</span>
      </div>
      <pre className="cg-tug-cue-host-body-pre">{`  1  export function TideCardTranscript({ cardId, turn }: Props) {
  2    const turns = useTurns(cardId);
  3    return (
  4      <div className="tide-card-transcript">
  5        {turns.map((t) => (
  6          <TranscriptTurn key={t.id} turn={t} />
  7        ))}
  8      </div>
  9    );`}</pre>
      {expanded ? (
        <pre className="cg-tug-cue-host-body-pre">{` 10  }
 11
 12  // (… 1,230 more lines …)`}</pre>
      ) : null}
      <Variant expanded={expanded} label={label} onActivate={onActivate} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryTugCue
// ---------------------------------------------------------------------------

/**
 * GalleryTugCue — Phase 1 design exploration card for the upcoming TugCue
 * component. Stacks 6 prototype variants, exposes a "focus" picker so the
 * Real-Host Preview at the top of the card mirrors the focused variant, and
 * logs every activation to a shared debug strip.
 */
export function GalleryTugCue() {
  const [debug, setDebug] = useState<readonly DebugEntry[]>([]);
  const [hostExpanded, setHostExpanded] = useState(false);
  const [focusedId, setFocusedId] = useState<VariantDef["id"]>("G");
  const focusedDef = VARIANTS.find((v) => v.id === focusedId) ?? VARIANTS[0];

  // Per-variant aria-expanded state — independent so users can compare
  // the collapsed vs. expanded look of each variant in the stack.
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});

  const recordActivation = (variantId: string, via: "pointer" | "keyboard") => {
    setDebug((prev) => [{ variant: variantId, at: Date.now(), via }, ...prev].slice(0, 8));
  };

  const onActivateVariant = (variantId: string) => (via: "pointer" | "keyboard") => {
    recordActivation(variantId, via);
    setExpandedById((m) => ({ ...m, [variantId]: !m[variantId] }));
  };

  const onActivateHost = (via: "pointer" | "keyboard") => {
    recordActivation(`host(${focusedId})`, via);
    setHostExpanded((v) => !v);
  };

  // Responder-form for the small control row. Phase 1 only has one toggle
  // (whether the host preview's body is visible), so this is a one-binding
  // form — but using useResponderForm keeps the card consistent with the
  // rest of the gallery and lets us add more controls later without refactor.
  const hostExpandedId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    toggle: {
      [hostExpandedId]: setHostExpanded,
    },
  });

  return (
    <ResponderScope>
      <div
        className="cg-content"
        data-testid="gallery-tug-cue"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        {/* ---- Real-Host Preview ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">
            Real-host preview — focused variant at the call site
          </TugLabel>
          <TugBox variant="bordered" rounded="sm" style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <div className="cg-control-group">
              <TugLabel size="2xs" color="muted">Focused variant:</TugLabel>
              {VARIANTS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setFocusedId(v.id)}
                  style={{
                    padding: "2px 8px",
                    fontSize: "11px",
                    borderRadius: "4px",
                    border: focusedId === v.id
                      ? "1px solid var(--tug7-element-global-border-normal-accent-rest)"
                      : "1px solid var(--tug7-element-global-border-normal-muted-rest)",
                    background: focusedId === v.id
                      ? "var(--tug7-surface-global-primary-normal-raised-rest)"
                      : "transparent",
                    color: "var(--tug7-element-global-text-normal-muted-rest)",
                    cursor: "pointer",
                  }}
                >
                  {v.id}
                </button>
              ))}
            </div>
            <div className="cg-control-group">
              <TugCheckbox
                checked={hostExpanded}
                senderId={hostExpandedId}
                label="Expanded"
                size="sm"
              />
            </div>
          </TugBox>
          <div style={{ marginTop: "12px" }}>
            <HostPreview
              Variant={focusedDef.Component}
              expanded={hostExpanded}
              onActivate={onActivateHost}
            />
          </div>
        </div>

        <TugSeparator />

        {/* ---- Variant Stack ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Variants A–F (click each — Enter / Space also work)</TugLabel>
          <div className="cg-tug-cue-stack">
            {VARIANTS.map((v) => {
              const expanded = !!expandedById[v.id];
              const label = expanded
                ? "click to collapse"
                : "1,230 lines folded — click to expand";
              return (
                <div key={v.id} className="cg-tug-cue-row">
                  <div className="cg-tug-cue-row-label">{v.title}</div>
                  <div>
                    <div className="cg-tug-cue-frame">
                      <v.Component
                        expanded={expanded}
                        label={label}
                        onActivate={onActivateVariant(v.id)}
                      />
                    </div>
                    <div style={{ fontSize: "10px", color: "var(--tug7-element-global-text-normal-muted-rest)", marginTop: "4px", opacity: 0.7 }}>
                      {v.blurb}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <TugSeparator />

        {/* ---- Debug strip ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Activation log (latest 8)</TugLabel>
          <div className="cg-tug-cue-debug">
            {debug.length === 0 ? (
              <span className="cg-tug-cue-debug-empty">
                no activations yet — click any variant or focus one and press Enter / Space
              </span>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                {debug.map((e, i) => (
                  <span key={i}>
                    {formatTime(e.at)} · variant {e.variant} · via {e.via}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </ResponderScope>
  );
}
