/**
 * Gallery card registrations and content components.
 *
 * Converts the Component Gallery from a floating panel into five separately
 * registered card types, each with its own `componentId` in the "developer"
 * family. The `gallery-buttons` entry is the gallery's entry-point componentId:
 * it carries `defaultTabs` and `defaultTitle` so that `addCard("gallery-buttons")`
 * creates a five-tab card titled "Component Gallery".
 *
 * **Authoritative references:**
 * - [D01] Five separate componentIds for gallery sections
 * - [D08] Normal tabs: each section is a distinct componentId
 * - [D09] Real factory each: every registration has a real `factory` function
 * - Spec S03: Gallery registrations
 * - Spec S04: Gallery default tabs
 * - (#s03-gallery-registrations, #s04-gallery-default-tabs, #symbol-inventory)
 *
 * @module components/tugways/cards/gallery-card
 */

import React, { useState, useRef } from "react";
import { Star } from "lucide-react";
import { registerCard } from "@/card-registry";
import { Tugcard } from "@/components/tugways/tugcard";
import { TugButton } from "@/components/tugways/tug-button";
import type { TugButtonVariant, TugButtonSize, TugButtonSubtype } from "@/components/tugways/tug-button";
import { TugTabBar } from "@/components/tugways/tug-tab-bar";
import { TugDropdown } from "@/components/tugways/tug-dropdown";
import type { TugDropdownItem } from "@/components/tugways/tug-dropdown";
import { useCSSVar, useDOMClass, useDOMStyle } from "@/components/tugways/hooks";
import type { TabItem } from "@/layout-tree";
import "./gallery-card.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_VARIANTS: TugButtonVariant[] = ["primary", "secondary", "ghost", "destructive"];
const ALL_SIZES: TugButtonSize[] = ["sm", "md", "lg"];
const ALL_SUBTYPES: TugButtonSubtype[] = ["push", "icon", "icon-text", "three-state"];

/**
 * Default tab templates for the gallery host card.
 *
 * Only `gallery-buttons` uses these — passed as `defaultTabs` so that
 * `addCard("gallery-buttons")` creates a five-tab card. Template `id` values
 * are placeholders: `DeckManager.addCard` replaces them with fresh UUIDs.
 *
 * **Authoritative reference:** Spec S04 (#s04-gallery-default-tabs)
 */
export const GALLERY_DEFAULT_TABS: readonly TabItem[] = [
  { id: "template", componentId: "gallery-buttons",      title: "TugButton",      closable: true },
  { id: "template", componentId: "gallery-chain-actions", title: "Chain Actions",  closable: true },
  { id: "template", componentId: "gallery-mutation",     title: "Mutation Model", closable: true },
  { id: "template", componentId: "gallery-tabbar",       title: "TugTabBar",      closable: true },
  { id: "template", componentId: "gallery-dropdown",     title: "TugDropdown",    closable: true },
];

// ---------------------------------------------------------------------------
// SubtypeButton helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// GalleryButtonsContent
// ---------------------------------------------------------------------------

/**
 * GalleryButtonsContent -- TugButton interactive preview + full matrix.
 *
 * Extracted from `ComponentGallery` for use as a standalone gallery card tab.
 * Contains the preview controls (variant, size, disabled, loading) and renders
 * both the interactive preview row and the full subtype × variant × size matrix.
 *
 * **Authoritative reference:** [D01] gallery-buttons componentId.
 */
export function GalleryButtonsContent() {
  const [previewVariant, setPreviewVariant] = useState<TugButtonVariant>("secondary");
  const [previewSize, setPreviewSize] = useState<TugButtonSize>("md");
  const [previewDisabled, setPreviewDisabled] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  return (
    <div className="cg-content" data-testid="gallery-buttons-content">
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

      {/* ---- Interactive Preview ---- */}
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

      {/* ---- Full Matrix ---- */}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryChainActionsContent
// ---------------------------------------------------------------------------

/**
 * GalleryChainActionsContent -- chain-action button demos.
 *
 * Demonstrates chain-action TugButton mode: buttons whose visibility and
 * enablement depend on the responder chain. Extracted from `ComponentGallery`.
 *
 * **Authoritative reference:** [D01] gallery-chain-actions componentId.
 */
export function GalleryChainActionsContent() {
  return (
    <div className="cg-content" data-testid="gallery-chain-actions-content">
      <div className="cg-section">
        <div className="cg-section-title">Chain-Action Buttons</div>
        <div className="cg-variant-row">
          <TugButton action="cycleCard">
            Cycle Card
          </TugButton>
          <TugButton action="showComponentGallery">
            Show Gallery
          </TugButton>
          <TugButton action="nonexistentAction">
            Hidden (nonexistentAction)
          </TugButton>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MutationModelDemo (re-exported for backward compatibility)
// ---------------------------------------------------------------------------

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
 * Spec S01, S02, S03 (#public-api)
 */
export function MutationModelDemo() {
  const boxRef = useRef<HTMLDivElement>(null);

  const [varOn, setVarOn] = useState(false);
  const [classOn, setClassOn] = useState(false);
  const [styleOn, setStyleOn] = useState(false);

  useCSSVar(boxRef, "--demo-bg", varOn ? "var(--td-accent)" : "var(--td-surface)");
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

// ---------------------------------------------------------------------------
// GalleryMutationContent
// ---------------------------------------------------------------------------

/**
 * GalleryMutationContent -- mutation model demo wrapped for gallery card tab.
 *
 * **Authoritative reference:** [D01] gallery-mutation componentId.
 */
export function GalleryMutationContent() {
  return (
    <div className="cg-content" data-testid="gallery-mutation-content">
      <div className="cg-section">
        <div className="cg-section-title">Mutation Model</div>
        <MutationModelDemo />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TugTabBarDemo (re-exported for backward compatibility)
// ---------------------------------------------------------------------------

/**
 * Seed tabs used by the TugTabBar gallery demo.
 * Defined at module scope to avoid recreation on each render.
 */
const DEMO_INITIAL_TABS: readonly TabItem[] = [
  { id: "demo-tab-1", componentId: "hello", title: "Hello",   closable: true },
  { id: "demo-tab-2", componentId: "hello", title: "World",   closable: true },
  { id: "demo-tab-3", componentId: "hello", title: "Tugways", closable: true },
];

/**
 * TugTabBarDemo -- standalone TugTabBar demo.
 *
 * Renders a TugTabBar with 3 sample tabs. Tab select, close, and add are
 * wired to local state so the demo is fully interactive.
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
      if (remaining.length === 0) return prev;
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

// ---------------------------------------------------------------------------
// GalleryTabBarContent
// ---------------------------------------------------------------------------

/**
 * GalleryTabBarContent -- TugTabBar demo wrapped for gallery card tab.
 *
 * **Authoritative reference:** [D01] gallery-tabbar componentId.
 */
export function GalleryTabBarContent() {
  return (
    <div className="cg-content" data-testid="gallery-tabbar-content">
      <div className="cg-section">
        <div className="cg-section-title">TugTabBar</div>
        <TugTabBarDemo />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TugDropdownDemo (re-exported for backward compatibility)
// ---------------------------------------------------------------------------

/** Sample items for the TugDropdown gallery demo. Module-scope to avoid recreation. */
const DEMO_DROPDOWN_ITEMS: TugDropdownItem[] = [
  { id: "option-alpha", label: "Alpha",            icon: <Star size={12} /> },
  { id: "option-beta",  label: "Beta",             icon: <Star size={12} /> },
  { id: "option-gamma", label: "Gamma (disabled)", disabled: true },
];

/**
 * TugDropdownDemo -- standalone TugDropdown demo.
 *
 * Renders a TugDropdown with sample items. Selecting an item updates status text.
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

// ---------------------------------------------------------------------------
// GalleryDropdownContent
// ---------------------------------------------------------------------------

/**
 * GalleryDropdownContent -- TugDropdown demo wrapped for gallery card tab.
 *
 * **Authoritative reference:** [D01] gallery-dropdown componentId.
 */
export function GalleryDropdownContent() {
  return (
    <div className="cg-content" data-testid="gallery-dropdown-content">
      <div className="cg-section">
        <div className="cg-section-title">TugDropdown</div>
        <TugDropdownDemo />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// registerGalleryCards
// ---------------------------------------------------------------------------

/**
 * Register all five gallery card types in the global card registry.
 *
 * Must be called before `DeckManager.addCard("gallery-buttons")` is invoked.
 * In `main.tsx`, call this before constructing the DeckManager.
 *
 * Each gallery card type:
 * - `family: "developer"` -- appears only in developer-family type pickers
 * - `acceptsFamilies: ["developer"]` -- type picker shows only developer cards
 * - `closable: true` -- gallery tabs can be closed and re-added via [+]
 *
 * Only `gallery-buttons` has `defaultTabs` and `defaultTitle`:
 * - `defaultTabs: GALLERY_DEFAULT_TABS` -- creates five-tab gallery card
 * - `defaultTitle: "Component Gallery"` -- card header prefix
 *
 * **Authoritative reference:** Spec S03 (#s03-gallery-registrations)
 */
export function registerGalleryCards(): void {
  // ---- gallery-buttons (entry-point: carries defaultTabs + defaultTitle) ----
  registerCard({
    componentId: "gallery-buttons",
    factory: (cardId, injected) => (
      <Tugcard
        cardId={cardId}
        meta={{ title: "TugButton", closable: true }}
        feedIds={[]}
        onDragStart={injected.onDragStart}
        onMinSizeChange={injected.onMinSizeChange}
      >
        <GalleryButtonsContent />
      </Tugcard>
    ),
    contentFactory: (_cardId) => <GalleryButtonsContent />,
    defaultMeta: { title: "TugButton", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    defaultTabs: GALLERY_DEFAULT_TABS,
    defaultTitle: "Component Gallery",
  });

  // ---- gallery-chain-actions ----
  registerCard({
    componentId: "gallery-chain-actions",
    factory: (cardId, injected) => (
      <Tugcard
        cardId={cardId}
        meta={{ title: "Chain Actions", closable: true }}
        feedIds={[]}
        onDragStart={injected.onDragStart}
        onMinSizeChange={injected.onMinSizeChange}
      >
        <GalleryChainActionsContent />
      </Tugcard>
    ),
    contentFactory: (_cardId) => <GalleryChainActionsContent />,
    defaultMeta: { title: "Chain Actions", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-mutation ----
  registerCard({
    componentId: "gallery-mutation",
    factory: (cardId, injected) => (
      <Tugcard
        cardId={cardId}
        meta={{ title: "Mutation Model", closable: true }}
        feedIds={[]}
        onDragStart={injected.onDragStart}
        onMinSizeChange={injected.onMinSizeChange}
      >
        <GalleryMutationContent />
      </Tugcard>
    ),
    contentFactory: (_cardId) => <GalleryMutationContent />,
    defaultMeta: { title: "Mutation Model", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-tabbar ----
  registerCard({
    componentId: "gallery-tabbar",
    factory: (cardId, injected) => (
      <Tugcard
        cardId={cardId}
        meta={{ title: "TugTabBar", closable: true }}
        feedIds={[]}
        onDragStart={injected.onDragStart}
        onMinSizeChange={injected.onMinSizeChange}
      >
        <GalleryTabBarContent />
      </Tugcard>
    ),
    contentFactory: (_cardId) => <GalleryTabBarContent />,
    defaultMeta: { title: "TugTabBar", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-dropdown ----
  registerCard({
    componentId: "gallery-dropdown",
    factory: (cardId, injected) => (
      <Tugcard
        cardId={cardId}
        meta={{ title: "TugDropdown", closable: true }}
        feedIds={[]}
        onDragStart={injected.onDragStart}
        onMinSizeChange={injected.onMinSizeChange}
      >
        <GalleryDropdownContent />
      </Tugcard>
    ),
    contentFactory: (_cardId) => <GalleryDropdownContent />,
    defaultMeta: { title: "TugDropdown", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });
}
