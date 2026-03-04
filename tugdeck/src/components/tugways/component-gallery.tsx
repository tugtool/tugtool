/**
 * ComponentGallery -- Development panel showing all tugways components.
 *
 * Phase 2: TugButton section only. Renders all subtype/variant/size combinations
 * in a grid, with interactive controls for variant, size, disabled, and loading.
 *
 * Phase 3 (Step 6): Registers as responder "component-gallery" via useResponder.
 * Phase 3 (Step 7): Adds "Chain-Action Buttons" demo section with cycleCard,
 *   showComponentGallery, and a nonexistentAction button (demonstrates hidden state).
 *   - parentId is inherited from ResponderParentContext (set by DeckCanvas's
 *     ResponderScope, so parentId = "deck-canvas").
 *   - actions: {} -- no gallery-specific actions in Phase 3; the gallery is a
 *     passive responder that receives focus so chain walks up to DeckCanvas.
 *   - On mount: calls manager.makeFirstResponder("component-gallery").
 *   - On unmount: useResponder cleanup calls manager.unregister("component-gallery").
 *     Because parentId = "deck-canvas", the manager's auto-promotion logic sets
 *     firstResponderId to "deck-canvas" -- no explicit resignFirstResponder needed.
 *
 * Rendered as an absolute-positioned div in DeckCanvas. Not a card, not managed
 * by DeckManager. Toggled via show-component-gallery action from Mac Developer menu
 * or via showComponentGallery responder chain action.
 *
 * [D03] Gallery as absolute-positioned div
 * [D05] All four subtypes
 * [D08] Gallery responder uses well-known string ID "component-gallery"
 * Spec S02, Spec S04 (#s04-gallery-panel)
 */

import React, { useState, useEffect, useRef } from "react";
import { X, Star } from "lucide-react";
import { TugButton } from "./tug-button";
import type { TugButtonVariant, TugButtonSize, TugButtonSubtype } from "./tug-button";
import { TugTabBar } from "./tug-tab-bar";
import { TugDropdown } from "./tug-dropdown";
import type { TugDropdownItem } from "./tug-dropdown";
import { useResponder } from "./use-responder";
import { useRequiredResponderChain } from "./responder-chain-provider";
import { useCSSVar, useDOMClass, useDOMStyle } from "@/components/tugways/hooks";
import type { TabItem } from "@/layout-tree";
import "./component-gallery.css";

// ---- Types ----

export interface ComponentGalleryProps {
  /** Called when the user clicks the close button in the title bar. */
  onClose: () => void;
}

// ---- Constants ----

const ALL_VARIANTS: TugButtonVariant[] = ["primary", "secondary", "ghost", "destructive"];
const ALL_SIZES: TugButtonSize[] = ["sm", "md", "lg"];
const ALL_SUBTYPES: TugButtonSubtype[] = ["push", "icon", "icon-text", "three-state"];

// ---- ComponentGallery ----

/**
 * ComponentGallery panel.
 *
 * Floating development panel that showcases all tugways components.
 * Phase 2: TugButton in all subtype / variant / size combinations.
 * Phase 3: Registers as responder "component-gallery", becomes first responder
 *          on mount and restores DeckCanvas as first responder on unmount.
 */
export function ComponentGallery({ onClose }: ComponentGalleryProps) {
  // Interactive controls -- applied to the full-matrix preview rows
  const [previewVariant, setPreviewVariant] = useState<TugButtonVariant>("secondary");
  const [previewSize, setPreviewSize] = useState<TugButtonSize>("md");
  const [previewDisabled, setPreviewDisabled] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Register as responder "component-gallery".
  // parentId is automatically set to "deck-canvas" via ResponderParentContext
  // (provided by DeckCanvas's ResponderScope wrapping this component).
  // actions: {} -- gallery is a passive responder; chain walks up to DeckCanvas.
  const { ResponderScope } = useResponder({
    id: "component-gallery",
    actions: {},
  });

  // Access the manager so we can call makeFirstResponder on mount.
  const manager = useRequiredResponderChain();

  // On mount: become the first responder so keyboard shortcuts (Ctrl+`) and
  // chain-action buttons reflect the gallery's position in the chain.
  // On unmount: useResponder cleanup calls unregister("component-gallery"),
  // which auto-promotes "deck-canvas" (parentId) back to first responder.
  useEffect(() => {
    manager.makeFirstResponder("component-gallery");
  }, [manager]);

  return (
    <ResponderScope>
      <div className="cg-panel" role="complementary" aria-label="Component Gallery">
        {/* ---- Title Bar ---- */}
        <div className="cg-titlebar">
          <span className="cg-title">Component Gallery</span>
          <TugButton
            subtype="icon"
            variant="ghost"
            size="sm"
            icon={<X size={14} />}
            aria-label="Close Component Gallery"
            onClick={onClose}
          />
        </div>

        {/* ---- Scrollable Content ---- */}
        <div className="cg-content">

          {/* ---- Interactive Controls ---- */}
          <div className="cg-section">
            <div className="cg-section-title">Preview Controls</div>
            <div className="cg-controls">
              <div className="cg-control-group">
                <label className="cg-control-label" htmlFor="cg-variant-select">
                  Variant
                </label>
                <select
                  id="cg-variant-select"
                  className="cg-control-select"
                  value={previewVariant}
                  onChange={(e) => setPreviewVariant(e.target.value as TugButtonVariant)}
                >
                  {ALL_VARIANTS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div className="cg-control-group">
                <label className="cg-control-label" htmlFor="cg-size-select">
                  Size
                </label>
                <select
                  id="cg-size-select"
                  className="cg-control-select"
                  value={previewSize}
                  onChange={(e) => setPreviewSize(e.target.value as TugButtonSize)}
                >
                  {ALL_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="cg-control-group">
                <input
                  id="cg-disabled-check"
                  type="checkbox"
                  className="cg-control-checkbox"
                  checked={previewDisabled}
                  onChange={(e) => setPreviewDisabled(e.target.checked)}
                />
                <label className="cg-control-label" htmlFor="cg-disabled-check">
                  Disabled
                </label>
              </div>

              <div className="cg-control-group">
                <input
                  id="cg-loading-check"
                  type="checkbox"
                  className="cg-control-checkbox"
                  checked={previewLoading}
                  onChange={(e) => setPreviewLoading(e.target.checked)}
                />
                <label className="cg-control-label" htmlFor="cg-loading-check">
                  Loading
                </label>
              </div>
            </div>
          </div>

          <div className="cg-divider" />

          {/* ---- TugButton Section: Interactive Preview ---- */}
          <div className="cg-section">
            <div className="cg-section-title">TugButton — Interactive Preview</div>
            <div className="cg-variant-row">
              <TugButton
                subtype="push"
                variant={previewVariant}
                size={previewSize}
                disabled={previewDisabled}
                loading={previewLoading}
              >
                Push
              </TugButton>
              <TugButton
                subtype="icon"
                variant={previewVariant}
                size={previewSize}
                disabled={previewDisabled}
                loading={previewLoading}
                icon={<Star size={14} />}
                aria-label="Icon button"
              />
              <TugButton
                subtype="icon-text"
                variant={previewVariant}
                size={previewSize}
                disabled={previewDisabled}
                loading={previewLoading}
                icon={<Star size={14} />}
              >
                Icon + Text
              </TugButton>
              <TugButton
                subtype="three-state"
                variant={previewVariant}
                size={previewSize}
                disabled={previewDisabled}
                loading={previewLoading}
              >
                Toggle
              </TugButton>
            </div>
          </div>

          <div className="cg-divider" />

          {/* ---- TugButton Section: Full Matrix ---- */}
          <div className="cg-section">
            <div className="cg-section-title">TugButton — Full Matrix (all subtypes × variants × sizes)</div>
            <div className="cg-matrix">
              {ALL_SUBTYPES.map((subtype) => (
                <div key={subtype} className="cg-subtype-block">
                  <div className="cg-subtype-label">subtype: {subtype}</div>
                  {ALL_VARIANTS.map((variant) => (
                    <div key={variant} className="cg-variant-row">
                      <div className="cg-variant-label">{variant}</div>
                      <div className="cg-size-group">
                        {ALL_SIZES.map((size) => (
                          <SubtypeButton
                            key={size}
                            subtype={subtype}
                            variant={variant}
                            size={size}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="cg-divider" />

          {/* ---- Chain-Action Buttons Section ---- */}
          {/*
           * Demonstrates chain-action TugButton mode (Phase 3, Step 7).
           *
           * - "Cycle Card": dispatches cycleCard (handled by DeckCanvas parent).
           *   Visible and enabled whenever a DeckCanvas responder is in the chain.
           * - "Toggle Gallery": dispatches showComponentGallery (handled by DeckCanvas).
           *   Clicking it while the gallery is open will close the gallery.
           * - nonexistentAction: canHandle returns false so TugButton returns null
           *   (hidden) -- demonstrates the invisible-when-unhandled behavior.
           */}
          <div className="cg-section">
            <div className="cg-section-title">Chain-Action Buttons</div>
            <div className="cg-variant-row">
              <TugButton action="cycleCard">
                Cycle Card
              </TugButton>
              <TugButton action="showComponentGallery">
                Toggle Gallery
              </TugButton>
              <TugButton action="nonexistentAction">
                Hidden (nonexistentAction)
              </TugButton>
            </div>
          </div>

          <div className="cg-divider" />

          {/* ---- Mutation Model Demo Section ---- */}
          {/*
           * Demonstrates the three-zone mutation model (Phase 4).
           *
           * MutationModelDemo is defined outside ComponentGallery per
           * structure-zone Rule 4 (no components defined inside components).
           *
           * Each toggle button uses useState for a boolean, which re-renders
           * MutationModelDemo. The hooks consume the new value and apply DOM
           * mutations directly -- no extra React state needed for the visual
           * change itself. In production (Phase 5+), the values would come
           * from imperative sources with no re-render at all.
           */}
          <div className="cg-section">
            <div className="cg-section-title">Mutation Model</div>
            <MutationModelDemo />
          </div>

          <div className="cg-divider" />

          {/* ---- TugTabBar Demo Section (Phase 5b) ---- */}
          {/*
           * Demonstrates TugTabBar in isolation (Step 10).
           *
           * TugTabBarDemo is defined outside ComponentGallery per the
           * structure-zone rule (no components defined inside components).
           *
           * Renders a standalone TugTabBar with 3 sample tabs. Local state
           * drives the active tab, close, and add operations so all tab
           * interactions are interactive and visible in the gallery.
           */}
          <div className="cg-section">
            <div className="cg-section-title">TugTabBar</div>
            <TugTabBarDemo />
          </div>

          <div className="cg-divider" />

          {/* ---- TugDropdown Demo Section (Phase 5b) ---- */}
          {/*
           * Demonstrates TugDropdown in isolation (Step 10).
           *
           * TugDropdownDemo is defined outside ComponentGallery per the
           * structure-zone rule (no components defined inside components).
           *
           * Renders a standalone TugDropdown with sample items (icon + label)
           * to show the trigger button, portal-rendered menu, and item selection.
           */}
          <div className="cg-section">
            <div className="cg-section-title">TugDropdown</div>
            <TugDropdownDemo />
          </div>

        </div>
      </div>
    </ResponderScope>
  );
}

// ---- SubtypeButton helper ----

/**
 * Renders the appropriate TugButton for a given subtype/variant/size combination
 * in the full matrix display.
 */
function SubtypeButton({
  subtype,
  variant,
  size,
}: {
  subtype: TugButtonSubtype;
  variant: TugButtonVariant;
  size: TugButtonSize;
}) {
  const sizeLabel = size;

  switch (subtype) {
    case "push":
      return (
        <TugButton subtype="push" variant={variant} size={size}>
          {sizeLabel}
        </TugButton>
      );

    case "icon":
      return (
        <TugButton
          subtype="icon"
          variant={variant}
          size={size}
          icon={<Star size={12} />}
          aria-label={`Icon ${variant} ${size}`}
        />
      );

    case "icon-text":
      return (
        <TugButton
          subtype="icon-text"
          variant={variant}
          size={size}
          icon={<Star size={12} />}
        >
          {sizeLabel}
        </TugButton>
      );

    case "three-state":
      return (
        <TugButton subtype="three-state" variant={variant} size={size}>
          {sizeLabel}
        </TugButton>
      );

    default:
      return null;
  }
}

// ---- TugTabBarDemo ----

/**
 * Seed tabs used by the TugTabBar gallery demo.
 *
 * Defined at module scope so they are not recreated on each render.
 * These three tabs use componentId "hello" (the only registered card type in
 * Phase 5) for icon and title lookup. The titles are distinct so the demo
 * clearly shows which tab is active.
 */
const DEMO_INITIAL_TABS: readonly TabItem[] = [
  { id: "demo-tab-1", componentId: "hello", title: "Hello", closable: true },
  { id: "demo-tab-2", componentId: "hello", title: "World", closable: true },
  { id: "demo-tab-3", componentId: "hello", title: "Tugways", closable: true },
];

/**
 * TugTabBarDemo -- Phase 5b gallery demo for TugTabBar.
 *
 * Renders a standalone TugTabBar with 3 sample tabs. Tab select, close, and
 * add operations are wired to local state so the demo is fully interactive.
 * Adding a new tab appends a placeholder "hello" tab with an incrementing title.
 *
 * Defined outside ComponentGallery per the structure-zone rule (no components
 * defined inside components).
 */
export function TugTabBarDemo() {
  const [tabs, setTabs] = useState<TabItem[]>(() => DEMO_INITIAL_TABS.map((t) => ({ ...t })));
  const [activeTabId, setActiveTabId] = useState<string>(DEMO_INITIAL_TABS[0].id);
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const nextTabIndexRef = useRef(DEMO_INITIAL_TABS.length + 1);

  const handleTabSelect = (tabId: string) => {
    setActiveTabId(tabId);
    setLastSelected(tabId);
  };

  const handleTabClose = (tabId: string) => {
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== tabId);
      if (remaining.length === 0) return prev; // keep at least one tab in demo
      // If the closed tab was active, activate the adjacent tab.
      if (activeTabId === tabId) {
        const closedIndex = prev.findIndex((t) => t.id === tabId);
        const newIndex = closedIndex > 0 ? closedIndex - 1 : 0;
        setActiveTabId(remaining[newIndex].id);
      }
      return remaining;
    });
  };

  const handleTabAdd = (_componentId: string) => {
    const n = nextTabIndexRef.current++;
    const newTab: TabItem = {
      id: `demo-tab-new-${n}`,
      componentId: "hello",
      title: `Tab ${n}`,
      closable: true,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  return (
    <div className="cg-tab-bar-demo">
      <TugTabBar
        cardId="gallery-demo-card"
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={handleTabSelect}
        onTabClose={handleTabClose}
        onTabAdd={handleTabAdd}
      />
      {lastSelected !== null && (
        <div className="cg-demo-status">
          Last selected: <code>{lastSelected}</code>
        </div>
      )}
    </div>
  );
}

// ---- TugDropdownDemo ----

/** Sample items for the TugDropdown gallery demo. Module-scope to avoid recreation. */
const DEMO_DROPDOWN_ITEMS: TugDropdownItem[] = [
  { id: "option-alpha", label: "Alpha", icon: <Star size={12} /> },
  { id: "option-beta", label: "Beta", icon: <Star size={12} /> },
  { id: "option-gamma", label: "Gamma (disabled)", disabled: true },
];

/**
 * TugDropdownDemo -- Phase 5b gallery demo for TugDropdown.
 *
 * Renders a standalone TugDropdown with a sample trigger button and three items
 * (two enabled with icons, one disabled). Selecting an item updates status text
 * so the selection feedback is visible.
 *
 * Defined outside ComponentGallery per the structure-zone rule (no components
 * defined inside components).
 */
export function TugDropdownDemo() {
  const [lastSelected, setLastSelected] = useState<string | null>(null);

  return (
    <div className="cg-dropdown-demo">
      <TugDropdown
        trigger={
          <button type="button" className="cg-demo-trigger">
            Open Dropdown
          </button>
        }
        items={DEMO_DROPDOWN_ITEMS}
        onSelect={(id) => setLastSelected(id)}
      />
      {lastSelected !== null && (
        <div className="cg-demo-status">
          Selected: <code>{lastSelected}</code>
        </div>
      )}
    </div>
  );
}

// ---- MutationModelDemo ----

/**
 * MutationModelDemo -- Phase 4 proof-of-concept for the three-zone mutation model.
 *
 * Renders a colored box and three toggle buttons. Each button uses useState for
 * a boolean toggle (causing a local re-render), then passes the new value into
 * one of the three appearance-zone hooks, which applies the DOM mutation directly
 * without further React reconciliation.
 *
 * Hooks used:
 * - useCSSVar: swaps --demo-bg between two --td-* color tokens
 * - useDOMClass: adds/removes the "demo-highlighted" class
 * - useDOMStyle: swaps border-width between "1px" and "3px"
 *
 * [D01] Three mutation zones
 * [D06] Minimal gallery demo section
 * Spec S01, S02, S03 (#public-api)
 */
export function MutationModelDemo() {
  const boxRef = useRef<HTMLDivElement>(null);

  const [varOn, setVarOn] = useState(false);
  const [classOn, setClassOn] = useState(false);
  const [styleOn, setStyleOn] = useState(false);

  // Appearance-zone mutations -- each hook writes directly to the DOM.
  useCSSVar(
    boxRef,
    "--demo-bg",
    varOn ? "var(--td-accent)" : "var(--td-surface)"
  );
  useDOMClass(boxRef, "demo-highlighted", classOn);
  useDOMStyle(boxRef, "border-width", styleOn ? "3px" : "1px");

  return (
    <div className="cg-mutation-demo">
      <div
        ref={boxRef}
        className="cg-mutation-box"
        data-testid="mutation-demo-box"
        aria-label="Mutation model demo box"
      />
      <div className="cg-variant-row">
        <TugButton
          subtype="push"
          variant="secondary"
          size="sm"
          onClick={() => setVarOn((v) => !v)}
        >
          Toggle CSS Var
        </TugButton>
        <TugButton
          subtype="push"
          variant="secondary"
          size="sm"
          onClick={() => setClassOn((v) => !v)}
        >
          Toggle Class
        </TugButton>
        <TugButton
          subtype="push"
          variant="secondary"
          size="sm"
          onClick={() => setStyleOn((v) => !v)}
        >
          Toggle Style
        </TugButton>
      </div>
    </div>
  );
}
