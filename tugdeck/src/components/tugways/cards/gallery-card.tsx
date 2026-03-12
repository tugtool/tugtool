/**
 * Gallery card registrations and content components.
 *
 * Converts the Component Gallery from a floating panel into ten separately
 * registered card types, each with its own `componentId` in the "developer"
 * family. The `gallery-buttons` entry is the gallery's entry-point componentId:
 * it carries `defaultTabs` and `defaultTitle` so that `addCard("gallery-buttons")`
 * creates a ten-tab card titled "Component Gallery".
 *
 * **Authoritative references:**
 * - [D01] Seven separate componentIds for gallery sections
 * - [D08] Normal tabs: each section is a distinct componentId
 * - [D09] Every registration has a contentFactory
 * - [D06] Gallery palette tab follows existing gallery card pattern
 * - Spec S03: Gallery registrations
 * - Spec S04: Gallery default tabs
 * - (#s03-gallery-registrations, #s04-gallery-default-tabs, #symbol-inventory)
 *
 * @module components/tugways/cards/gallery-card
 */

import React, { useState, useRef, useLayoutEffect } from "react";
import { useRequiredResponderChain } from "@/components/tugways/responder-chain-provider";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { Star } from "lucide-react";
import { registerCard } from "@/card-registry";
import { CardHeader } from "@/components/chrome/card-header";
import { GalleryMutationTxContent } from "./gallery-mutation-tx-content";
import { GalleryObservablePropsContent } from "./gallery-observable-props-content";
import { GalleryPaletteContent } from "./gallery-palette-content";
import { GalleryScaleTimingContent } from "./gallery-scale-timing-content";
import { GalleryCascadeInspectorContent } from "./gallery-cascade-inspector-content";
import { GalleryAnimatorContent } from "./gallery-animator-content";
import { GallerySkeletonContent } from "./gallery-skeleton-content";
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
 * `addCard("gallery-buttons")` creates a fourteen-tab card. Template `id` values
 * are placeholders: `DeckManager.addCard` replaces them with fresh UUIDs.
 *
 * **Authoritative reference:** Spec S04 (#s04-gallery-default-tabs)
 */
export const GALLERY_DEFAULT_TABS: readonly TabItem[] = [
  { id: "template", componentId: "gallery-buttons",           title: "TugButton",            closable: true },
  { id: "template", componentId: "gallery-chain-actions",     title: "Chain Actions",        closable: true },
  { id: "template", componentId: "gallery-mutation",          title: "Mutation Model",       closable: true },
  { id: "template", componentId: "gallery-tabbar",            title: "TugTabBar",            closable: true },
  { id: "template", componentId: "gallery-dropdown",          title: "TugDropdown",          closable: true },
  { id: "template", componentId: "gallery-default-button",    title: "Default Button",       closable: true },
  { id: "template", componentId: "gallery-mutation-tx",       title: "Mutation Transactions", closable: true },
  { id: "template", componentId: "gallery-observable-props",  title: "Observable Props",     closable: true },
  { id: "template", componentId: "gallery-palette",           title: "Palette Engine",       closable: true },
  { id: "template", componentId: "gallery-scale-timing",      title: "Scale & Timing",       closable: true },
  { id: "template", componentId: "gallery-cascade-inspector", title: "Cascade Inspector",    closable: true },
  { id: "template", componentId: "gallery-animator",          title: "TugAnimator",          closable: true },
  { id: "template", componentId: "gallery-skeleton",          title: "TugSkeleton",          closable: true },
  { id: "template", componentId: "gallery-elevation",         title: "2.5D States",          closable: true },
  { id: "template", componentId: "gallery-title-bar",         title: "Title Bar",            closable: true },
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

// ---------------------------------------------------------------------------
// ActionEventDemo
// ---------------------------------------------------------------------------

/**
 * ActionEventDemo -- demonstrates explicit-target dispatch via dispatchTo.
 *
 * Registers a local responder node with id "action-event-demo" that handles
 * the "demoAction" action. A TugButton in direct-action mode (onClick) calls
 * manager.dispatchTo("action-event-demo", { action: "demoAction", phase: "discrete" })
 * to deliver the event directly to the local responder, bypassing the chain walk.
 *
 * The handler receives the full ActionEvent and stores a display string showing
 * its fields (action, phase). A status line below the button shows the last
 * received event, or "No event received" initially.
 *
 * Rules of Tugways compliance:
 * - [D41] useResponder internally uses useLayoutEffect for registration
 * - [D40] Local display state uses useState -- local component state, not
 *   external store state, so useSyncExternalStore does not apply
 * - [D01] ActionEvent is the sole dispatch currency
 * - [D03] dispatchTo throws on unregistered target (ensured by layout-effect
 *   registration before any click can fire)
 *
 * Note on stale closures: the demoAction handler closes over the useState
 * setter. This is safe because React guarantees setter identity stability
 * across re-renders -- the setter never changes.
 *
 * **Authoritative reference:** [D01] ActionEvent dispatch, [D03] dispatchTo.
 */
function ActionEventDemo() {
  const manager = useRequiredResponderChain();
  const [lastEventText, setLastEventText] = useState<string | null>(null);

  // Register a local responder that handles "demoAction".
  // useResponder uses useLayoutEffect internally ([D41]), so the node is
  // registered before any click event can fire.
  // The setter is stable across re-renders, so the closure is never stale.
  useResponder({
    id: "action-event-demo",
    actions: {
      demoAction: (event: ActionEvent) => {
        setLastEventText(`action: "${event.action}", phase: "${event.phase}"`);
      },
    },
  });

  const handleDispatch = () => {
    manager.dispatchTo("action-event-demo", { action: "demoAction", phase: "discrete" });
  };

  return (
    <div className="cg-section" data-testid="action-event-demo">
      <div className="cg-section-title">ActionEvent Dispatch</div>
      <p className="cg-description">
        Click the button to dispatch directly to a local responder node via{" "}
        <code>dispatchTo</code>. The handler receives the full{" "}
        <code>ActionEvent</code> and displays its fields below.
      </p>
      <div className="cg-variant-row">
        <TugButton
          subtype="push"
          variant="secondary"
          size="md"
          onClick={handleDispatch}
        >
          Dispatch demoAction
        </TugButton>
      </div>
      <div className="cg-demo-status" data-testid="action-event-demo-status">
        {lastEventText !== null ? lastEventText : "No event received"}
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
 * enablement depend on the responder chain. Also includes an ActionEvent
 * dispatch demo showing explicit-target dispatch via dispatchTo.
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
        </div>
      </div>

      <div className="cg-divider" />

      <ActionEventDemo />
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
 * - useCSSVar: swaps --demo-bg between two --tug-base-* color tokens
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

  useCSSVar(boxRef, "--demo-bg", varOn ? "var(--tug-base-accent-default)" : "var(--tug-base-surface-default)");
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
 *
 * Six initial tabs give enough content to trigger collapse/overflow in a
 * reasonably sized card without requiring the user to add tabs manually.
 * Defined at module scope to avoid recreation on each render.
 */
const DEMO_INITIAL_TABS: readonly TabItem[] = [
  { id: "demo-tab-1", componentId: "hello", title: "Hello",    closable: true },
  { id: "demo-tab-2", componentId: "hello", title: "World",    closable: true },
  { id: "demo-tab-3", componentId: "hello", title: "Tugways",  closable: true },
  { id: "demo-tab-4", componentId: "hello", title: "Overflow",  closable: true },
  { id: "demo-tab-5", componentId: "hello", title: "Demo",     closable: true },
  { id: "demo-tab-6", componentId: "hello", title: "Tab Six",  closable: true },
];

/**
 * TugTabBarDemo -- standalone TugTabBar demo with overflow status display.
 *
 * Renders a TugTabBar with enough initial tabs to demonstrate progressive
 * collapse. An "Add 5 tabs" button adds five tabs at once so overflow
 * is quickly reached. A status line below the bar shows the current overflow
 * stage ("none" | "collapsed" | "overflow") and the count of overflow tabs.
 *
 * The status line is driven by the `onOverflowChange` callback prop, which
 * TugTabBar calls whenever the structural-zone overflow state changes.
 *
 * Tab select, close, and add are wired to local state for full interactivity.
 */
export function TugTabBarDemo() {
  const [tabs, setTabs] = useState<TabItem[]>(() => DEMO_INITIAL_TABS.map((t) => ({ ...t })));
  const [activeTabId, setActiveTabId] = useState<string>(DEMO_INITIAL_TABS[0].id);
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [overflowStage, setOverflowStage] = useState<"none" | "collapsed" | "overflow">("none");
  const [overflowCount, setOverflowCount] = useState<number>(0);
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

  /** Add five tabs at once to quickly trigger overflow. */
  const handleAddFive = () => {
    const newTabs: TabItem[] = Array.from({ length: 5 }, () => {
      const n = nextTabIndexRef.current++;
      return {
        id: `demo-tab-new-${n}`,
        componentId: "hello",
        title: `Tab ${n}`,
        closable: true,
      };
    });
    setTabs((prev) => [...prev, ...newTabs]);
    setActiveTabId(newTabs[newTabs.length - 1].id);
  };

  const handleOverflowChange = (
    stage: "none" | "collapsed" | "overflow",
    count: number,
  ) => {
    setOverflowStage(stage);
    setOverflowCount(count);
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
        onOverflowChange={handleOverflowChange}
      />
      <div className="cg-demo-controls">
        <TugButton
          subtype="push"
          variant="secondary"
          size="sm"
          onClick={handleAddFive}
        >
          Add 5 tabs
        </TugButton>
      </div>
      <div className="cg-demo-status" data-testid="demo-overflow-status">
        Overflow stage: <code data-testid="demo-overflow-stage">{overflowStage}</code>
        {overflowCount > 0 && (
          <> — <code data-testid="demo-overflow-count">{overflowCount}</code> tab{overflowCount !== 1 ? "s" : ""} in overflow</>
        )}
      </div>
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
// GalleryDefaultButtonContent
// ---------------------------------------------------------------------------

/**
 * GalleryDefaultButtonContent -- default button registration + Enter-key demo.
 *
 * Renders a primary "Confirm" button and a secondary "Cancel" button. The
 * Confirm button is registered as the default button via useLayoutEffect on
 * mount and cleared on unmount. Pressing Enter when neither button is focused
 * activates Confirm via the stage-2 bubble-pipeline shortcut.
 *
 * Rules of Tugways compliance:
 * - [D41] useLayoutEffect for registrations that events depend on
 * - [D40] Local UI state (last action) uses useState -- this is local component
 *   state, not external store state, so useSyncExternalStore does not apply
 *
 * **Authoritative reference:** [D01] gallery-default-button componentId.
 */
export function GalleryDefaultButtonContent() {
  const manager = useRequiredResponderChain();
  const confirmContainerRef = useRef<HTMLSpanElement | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  useLayoutEffect(() => {
    // Find the underlying <button> DOM element inside the TugButton wrapper span.
    // TugButton does not support ref forwarding, so we locate the button via the
    // container span. This is safe: the span holds exactly one button child.
    const btn = confirmContainerRef.current?.querySelector("button") ?? null;
    if (!btn) return;
    manager.setDefaultButton(btn);
    return () => {
      manager.clearDefaultButton(btn);
    };
  }, [manager]);

  return (
    <div className="cg-content" data-testid="gallery-default-button-content">
      <div className="cg-section">
        <div className="cg-section-title">Default Button</div>
        <p className="cg-description">
          Click outside the buttons, then press Enter to activate the default button.
        </p>
        <div className="cg-variant-row">
          <TugButton
            subtype="push"
            variant="secondary"
            size="md"
            onClick={() => setLastAction("Cancel clicked")}
          >
            Cancel
          </TugButton>
          <span ref={confirmContainerRef}>
            <TugButton
              subtype="push"
              variant="primary"
              size="md"
              onClick={() => setLastAction("Confirm clicked")}
            >
              Confirm
            </TugButton>
          </span>
        </div>
        {lastAction !== null && (
          <div className="cg-demo-status" data-testid="gallery-default-button-status">
            {lastAction}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gallery2p5DContent
// ---------------------------------------------------------------------------

/**
 * Gallery2p5DContent -- 2.5D Visual Language interactive demo.
 *
 * Shows TugButton across all four variants in rest, hover, active, focused,
 * and disabled states, demonstrating the elevation model (highlight + shadow
 * + translateY press-offset). Theme-switch to see how Brio, Bluenote, and
 * Harmony each express the same 2.5D geometry.
 *
 * [D04] 2.5D elevation model, Spec S02 elevation CSS pattern
 */
export function Gallery2p5DContent() {
  return (
    <div className="cg-content" data-testid="gallery-2p5d-content">

      {/* ---- Overview ---- */}
      <div className="cg-section">
        <div className="cg-section-title">2.5D Visual Language</div>
        <p className="cg-description">
          Controls float above the canvas with a top-edge light reflection (highlight)
          and a soft bottom shadow. On press, the shadow collapses and the control
          translates down 1px. Switch themes with the dock menu to see how Brio,
          Bluenote, and Harmony express the same elevation geometry.
        </p>
      </div>

      <div className="cg-divider" />

      {/* ---- Secondary variant (default 2.5D face) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Secondary — elevation face (default)</div>
        <p className="cg-description">
          Face color from <code>--tug-base-elevation-face</code>. Hover raises the
          shadow; press collapses it and translates the button down 1px.
        </p>
        <div className="cg-variant-row">
          <TugButton variant="secondary" size="sm">Small</TugButton>
          <TugButton variant="secondary" size="md">Medium</TugButton>
          <TugButton variant="secondary" size="lg">Large</TugButton>
          <TugButton variant="secondary" size="md" disabled>Disabled</TugButton>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Primary variant (accent-cool fill + elevation shadow) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Primary — accent fill with elevation</div>
        <p className="cg-description">
          Accent-cool face with shared highlight and shadow geometry.
          Press translates the button down and collapses the shadow.
        </p>
        <div className="cg-variant-row">
          <TugButton variant="primary" size="sm">Small</TugButton>
          <TugButton variant="primary" size="md">Medium</TugButton>
          <TugButton variant="primary" size="lg">Large</TugButton>
          <TugButton variant="primary" size="md" disabled>Disabled</TugButton>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Destructive variant (danger fill + elevation shadow) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Destructive — danger fill with elevation</div>
        <p className="cg-description">
          Danger-red face with shared highlight and shadow geometry.
        </p>
        <div className="cg-variant-row">
          <TugButton variant="destructive" size="sm">Small</TugButton>
          <TugButton variant="destructive" size="md">Medium</TugButton>
          <TugButton variant="destructive" size="lg">Large</TugButton>
          <TugButton variant="destructive" size="md" disabled>Disabled</TugButton>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Ghost variant (flat — no elevation) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Ghost — flat (no elevation)</div>
        <p className="cg-description">
          Ghost buttons intentionally have no elevation — they appear flat and
          only gain a surface fill on hover. Contrast with the variants above.
        </p>
        <div className="cg-variant-row">
          <TugButton variant="ghost" size="sm">Small</TugButton>
          <TugButton variant="ghost" size="md">Medium</TugButton>
          <TugButton variant="ghost" size="lg">Large</TugButton>
          <TugButton variant="ghost" size="md" disabled>Disabled</TugButton>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Token documentation ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Elevation token structure (Spec S01, S02)</div>
        <p className="cg-description">
          All elevation is expressed through three token tiers:
        </p>
        <ol style={{ paddingLeft: "1.5rem", fontSize: "12px", lineHeight: "1.8", color: "var(--tug-base-fg-muted)" }}>
          <li><code>--tug-base-elevation-*</code> — base layer (per-theme in tug-tokens, bluenote, harmony)</li>
          <li><code>--tug-button-*</code> — component layer (maps from base, defined in tug-button.css)</li>
          <li>CSS rules (<code>.tug-button</code>, <code>:hover</code>, <code>:active</code>, <code>:disabled</code>)</li>
        </ol>
        <p className="cg-description" style={{ marginTop: "0.5rem" }}>
          <strong>Control vs. content rule:</strong> Only interactive controls (buttons, inputs,
          switches, sliders) get elevation. Content areas, cards, separators, and badges stay flat.
        </p>
        <p className="cg-description" style={{ marginTop: "0.5rem" }}>
          <strong>Gradient decision [Q01]:</strong> No gradients. The shadow+highlight geometry
          provides sufficient 2.5D depth without gradients. This keeps all theme tokens
          as solid colors (no per-theme gradient values needed).
        </p>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryTitleBarContent
// ---------------------------------------------------------------------------

/**
 * GalleryTitleBarContent -- interactive demo of CardHeader with 2.5D controls.
 *
 * Shows a CardHeader in isolation (outside a real Tugcard frame) with interactive
 * controls for toggling the collapsed state and selecting the icon. Demonstrates
 * the 2.5D elevation on close, collapse, and menu buttons across all three themes.
 *
 * [D04] 2.5D elevation model
 * [D07] Window-shade collapse
 * Step 3: Card Frame & Title Bar
 */
export function GalleryTitleBarContent() {
  const [collapsed, setCollapsed] = useState(false);
  const [iconName, setIconName] = useState<string>("Layout");
  const [closable, setClosable] = useState(true);
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  const handleCollapse = () => {
    setCollapsed((c) => !c);
    setLastEvent(collapsed ? "expanded" : "collapsed");
  };

  const handleClose = () => {
    setLastEvent("close clicked");
  };

  return (
    <div className="cg-content" data-testid="gallery-title-bar-content">
      <div className="cg-section">
        <div className="cg-section-title">Title Bar Demo (Step 3)</div>
        <p className="cg-description">
          CardHeader in isolation: collapse/expand toggle (chevron), menu (horizontal
          ellipsis), and close buttons. All three buttons use 2.5D elevation.
          The title bar surface itself is flat.
        </p>
      </div>

      <div className="cg-divider" />

      {/* ---- Interactive Controls ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Preview Controls</div>
        <div className="cg-controls">
          <div className="cg-control-group">
            <label className="cg-control-label" htmlFor="cg-title-icon-select">
              Icon
            </label>
            <select
              id="cg-title-icon-select"
              className="cg-control-select"
              value={iconName}
              onChange={(e) => setIconName(e.target.value)}
            >
              <option value="">None</option>
              <option value="Layout">Layout</option>
              <option value="Settings">Settings</option>
              <option value="Terminal">Terminal</option>
              <option value="Code">Code</option>
            </select>
          </div>

          <div className="cg-control-group">
            <input
              id="cg-title-closable-check"
              type="checkbox"
              className="cg-control-checkbox"
              checked={closable}
              onChange={(e) => setClosable(e.target.checked)}
            />
            <label className="cg-control-label" htmlFor="cg-title-closable-check">
              Closable
            </label>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Live CardHeader Demo ---- */}
      <div className="cg-section">
        <div className="cg-section-title">CardHeader — Live Demo</div>
        <div
          style={{
            border: "1px solid var(--tug-base-card-border)",
            borderRadius: "var(--tug-base-radius-md)",
            overflow: "hidden",
            background: "var(--tug-base-card-header-bg-inactive)",
          }}
          data-testid="gallery-card-header-demo"
        >
          <CardHeader
            title="Demo Card"
            icon={iconName || undefined}
            closable={closable}
            collapsed={collapsed}
            onCollapse={handleCollapse}
            onClose={handleClose}
          />
          {!collapsed && (
            <div
              style={{
                padding: "12px",
                background: "var(--tug-base-surface-default)",
                fontSize: "12px",
                color: "var(--tug-base-fg-muted)",
                minHeight: "48px",
              }}
            >
              Card content area (visible when expanded)
            </div>
          )}
        </div>

        {lastEvent !== null && (
          <div className="cg-demo-status" data-testid="gallery-title-bar-event-status">
            Last event: <code>{lastEvent}</code>
          </div>
        )}

        <div style={{ marginTop: "8px" }}>
          <TugButton
            subtype="push"
            variant="secondary"
            size="sm"
            onClick={handleCollapse}
          >
            {collapsed ? "Expand" : "Collapse"}
          </TugButton>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 2.5D Elevation Documentation ---- */}
      <div className="cg-section">
        <div className="cg-section-title">2.5D Elevation — Title Bar Controls</div>
        <p className="cg-description">
          The close, collapse (chevron), and menu (horizontal ellipsis) buttons use
          the same 2.5D elevation pattern as TugButton. The title bar surface stays
          flat — only the controls are elevated.
        </p>
        <p className="cg-description" style={{ marginTop: "0.5rem" }}>
          Switch themes with the dock menu to see Brio, Bluenote, and Harmony
          express the same elevation geometry.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// registerGalleryCards
// ---------------------------------------------------------------------------

/**
 * Register all fourteen gallery card types in the global card registry.
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
 * - `defaultTabs: GALLERY_DEFAULT_TABS` -- creates thirteen-tab gallery card
 * - `defaultTitle: "Component Gallery"` -- card header prefix
 *
 * **Authoritative reference:** Spec S03 (#s03-gallery-registrations), [D06]
 */
export function registerGalleryCards(): void {
  // ---- gallery-buttons (entry-point: carries defaultTabs + defaultTitle) ----
  registerCard({
    componentId: "gallery-buttons",
    contentFactory: (_cardId) => <GalleryButtonsContent />,
    defaultMeta: { title: "TugButton", icon: "MousePointerClick", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    defaultTabs: GALLERY_DEFAULT_TABS,
    defaultTitle: "Component Gallery",
  });

  // ---- gallery-chain-actions ----
  registerCard({
    componentId: "gallery-chain-actions",
    contentFactory: (_cardId) => <GalleryChainActionsContent />,
    defaultMeta: { title: "Chain Actions", icon: "Zap", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-mutation ----
  registerCard({
    componentId: "gallery-mutation",
    contentFactory: (_cardId) => <GalleryMutationContent />,
    defaultMeta: { title: "Mutation Model", icon: "GitBranch", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-tabbar ----
  registerCard({
    componentId: "gallery-tabbar",
    contentFactory: (_cardId) => <GalleryTabBarContent />,
    defaultMeta: { title: "TugTabBar", icon: "PanelTop", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-dropdown ----
  registerCard({
    componentId: "gallery-dropdown",
    contentFactory: (_cardId) => <GalleryDropdownContent />,
    defaultMeta: { title: "TugDropdown", icon: "ChevronDown", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-default-button ----
  registerCard({
    componentId: "gallery-default-button",
    contentFactory: (_cardId) => <GalleryDefaultButtonContent />,
    defaultMeta: { title: "Default Button", icon: "CornerDownLeft", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-mutation-tx ----
  registerCard({
    componentId: "gallery-mutation-tx",
    contentFactory: (_cardId) => <GalleryMutationTxContent />,
    defaultMeta: { title: "Mutation Transactions", icon: "Layers", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-observable-props ----
  // This is the first gallery tab to use the cardId argument from contentFactory.
  // The cardId is passed through to GalleryObservablePropsContent so inspector
  // controls can direct setProperty actions to the correct Tugcard responder node
  // via dispatchTo. [D04] Spec S07 (#s07-gallery-demo)
  registerCard({
    componentId: "gallery-observable-props",
    contentFactory: (cardId) => <GalleryObservablePropsContent cardId={cardId} />,
    defaultMeta: { title: "Observable Props", icon: "SlidersHorizontal", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-palette ----
  registerCard({
    componentId: "gallery-palette",
    contentFactory: (_cardId) => <GalleryPaletteContent />,
    defaultMeta: { title: "Palette Engine", icon: "Palette", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-scale-timing ----
  registerCard({
    componentId: "gallery-scale-timing",
    contentFactory: (_cardId) => <GalleryScaleTimingContent />,
    defaultMeta: { title: "Scale & Timing", icon: "SlidersHorizontal", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-cascade-inspector ----
  registerCard({
    componentId: "gallery-cascade-inspector",
    contentFactory: (_cardId) => <GalleryCascadeInspectorContent />,
    defaultMeta: { title: "Cascade Inspector", icon: "Search", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-animator ----
  registerCard({
    componentId: "gallery-animator",
    contentFactory: (_cardId) => <GalleryAnimatorContent />,
    defaultMeta: { title: "TugAnimator", icon: "Play", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-skeleton ----
  // TugSkeleton uses CSS shimmer (CSS lane, Rule 13 — continuous, infinite).
  // Gets its own tab rather than living in the animator tab. [D04]
  registerCard({
    componentId: "gallery-skeleton",
    contentFactory: (_cardId) => <GallerySkeletonContent />,
    defaultMeta: { title: "TugSkeleton", icon: "Loader", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-elevation ----
  // 2.5D Visual Language reference demo (Step 2). Shows all four TugButton
  // variants in elevation states and documents the token structure and
  // "no-gradients" decision for Q01. [D04] Spec S02
  registerCard({
    componentId: "gallery-elevation",
    contentFactory: (_cardId) => <Gallery2p5DContent />,
    defaultMeta: { title: "2.5D States", icon: "Layers", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-title-bar ----
  // Step 3: CardHeader demo. Shows collapse/expand toggle, menu, close button
  // with 2.5D elevation. Demonstrates window-shade collapse behavior. [D04, D07]
  registerCard({
    componentId: "gallery-title-bar",
    contentFactory: (_cardId) => <GalleryTitleBarContent />,
    defaultMeta: { title: "Title Bar", icon: "PanelTop", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });
}

// Re-export GalleryMutationTxContent so tests can import it from either location.
export { GalleryMutationTxContent };
