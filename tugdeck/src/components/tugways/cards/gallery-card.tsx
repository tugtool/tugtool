/**
 * Gallery card registrations and content components.
 *
 * Converts the Component Gallery from a floating panel into twenty separately
 * registered card types, each with its own `componentId` in the "developer"
 * family. The `gallery-buttons` entry is the gallery's entry-point componentId:
 * it carries `defaultTabs` and `defaultTitle` so that `addCard("gallery-buttons")`
 * creates a twenty-tab card titled "Component Gallery".
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
import { CardTitleBar } from "@/components/tugways/tug-card";
import { GalleryMutationTxContent } from "./gallery-mutation-tx-content";
import { GalleryObservablePropsContent } from "./gallery-observable-props-content";
import { GalleryPaletteContent } from "./gallery-palette-content";
import { GalleryScaleTimingContent } from "./gallery-scale-timing-content";
import { GalleryCascadeInspectorContent } from "./gallery-cascade-inspector-content";
import { GalleryAnimatorContent } from "./gallery-animator-content";
import { GallerySkeletonContent } from "./gallery-skeleton-content";
import { GalleryInputContent } from "./gallery-input-content";
import { GalleryLabelContent } from "./gallery-label-content";
import { GalleryMarqueeContent } from "./gallery-marquee-content";
import { GalleryCheckboxContent } from "./gallery-checkbox-content";
import { GallerySwitchContent } from "./gallery-switch-content";
import { GalleryThemeGeneratorContent } from "./gallery-theme-generator-content";
import { GalleryPopupButtonContent } from "./gallery-popup-button-content";
import { TugButton, TugPushButton } from "@/components/tugways/tug-button";
import type { TugButtonEmphasis, TugButtonRole, TugButtonSize, TugButtonSubtype } from "@/components/tugways/tug-button";
import { TugBadge } from "@/components/tugways/tug-badge";
import type { TugBadgeEmphasis, TugBadgeRole, TugBadgeSize } from "@/components/tugways/tug-badge";
import { TugTabBar } from "@/components/tugways/tug-tab-bar";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import type { TugPopupMenuItem } from "@/components/tugways/tug-popup-button";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { useCSSVar, useDOMClass, useDOMStyle } from "@/components/tugways/hooks";
import type { TabItem } from "@/layout-tree";
import "./gallery-card.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All Table T01 emphasis x role combinations for the full matrix [D02, Table T01] */
const ALL_COMBOS: Array<{ emphasis: TugButtonEmphasis; role: TugButtonRole }> = [
  { emphasis: "filled",   role: "accent"  },
  { emphasis: "filled",   role: "action"  },
  { emphasis: "filled",   role: "danger"  },
  { emphasis: "outlined", role: "action"  },
  { emphasis: "ghost",    role: "action"  },
  { emphasis: "ghost",    role: "danger"  },
];
const ALL_SIZES: TugButtonSize[] = ["sm", "md", "lg"];
const ALL_SUBTYPES: TugButtonSubtype[] = ["text", "icon", "icon-text"];

/**
 * Default tab templates for the gallery host card.
 *
 * Only `gallery-buttons` uses these — passed as `defaultTabs` so that
 * `addCard("gallery-buttons")` creates a twenty-tab card. Template `id` values
 * are placeholders: `DeckManager.addCard` replaces them with fresh UUIDs.
 *
 * **Authoritative reference:** Spec S04 (#s04-gallery-default-tabs)
 */
export const GALLERY_DEFAULT_TABS: readonly TabItem[] = [
  { id: "template", componentId: "gallery-buttons",           title: "TugPushButton",         closable: true },
  { id: "template", componentId: "gallery-chain-actions",     title: "Chain Actions",        closable: true },
  { id: "template", componentId: "gallery-mutation",          title: "Mutation Model",       closable: true },
  { id: "template", componentId: "gallery-tabbar",            title: "TugTabBar",            closable: true },
  { id: "template", componentId: "gallery-dropdown",          title: "TugPopupButton",       closable: true },
  { id: "template", componentId: "gallery-default-button",    title: "Default Button",       closable: true },
  { id: "template", componentId: "gallery-mutation-tx",       title: "Mutation Transactions", closable: true },
  { id: "template", componentId: "gallery-observable-props",  title: "Observable Props",     closable: true },
  { id: "template", componentId: "gallery-palette",           title: "Palette Engine",       closable: true },
  { id: "template", componentId: "gallery-scale-timing",      title: "Scale & Timing",       closable: true },
  { id: "template", componentId: "gallery-cascade-inspector", title: "Cascade Inspector",    closable: true },
  { id: "template", componentId: "gallery-animator",          title: "TugAnimator",          closable: true },
  { id: "template", componentId: "gallery-skeleton",          title: "TugSkeleton",          closable: true },
  { id: "template", componentId: "gallery-title-bar",         title: "Title Bar",            closable: true },
  { id: "template", componentId: "gallery-input",              title: "TugInput",             closable: true },
  { id: "template", componentId: "gallery-label",              title: "TugLabel",             closable: true },
  { id: "template", componentId: "gallery-marquee",            title: "TugMarquee",           closable: true },
  { id: "template", componentId: "gallery-checkbox",           title: "TugCheckbox",          closable: true },
  { id: "template", componentId: "gallery-switch",             title: "TugSwitch",            closable: true },
  { id: "template", componentId: "gallery-theme-generator",   title: "Theme Generator",      closable: true },
  { id: "template", componentId: "gallery-badge",             title: "TugBadge",             closable: true },
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
  emphasis,
  role,
  size,
}: {
  subtype: TugButtonSubtype;
  emphasis: TugButtonEmphasis;
  role: TugButtonRole;
  size: TugButtonSize;
}) {
  const sizeLabel = size;
  const comboLabel = `${emphasis}-${role}`;

  switch (subtype) {
    case "text":
      return (
        <TugPushButton emphasis={emphasis} role={role} size={size}>
          {sizeLabel}
        </TugPushButton>
      );

    case "icon":
      return (
        <TugButton
          subtype="icon"
          emphasis={emphasis}
          role={role}
          size={size}
          icon={<Star size={12} />}
          aria-label={`Icon ${comboLabel} ${size}`}
        />
      );

    case "icon-text":
      return (
        <TugPushButton
          subtype="icon-text"
          emphasis={emphasis}
          role={role}
          size={size}
          icon={<Star size={12} />}
        >
          {sizeLabel}
        </TugPushButton>
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
  const [previewEmphasis, setPreviewEmphasis] = useState<TugButtonEmphasis>("outlined");
  const [previewRole, setPreviewRole] = useState<TugButtonRole>("action");
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
            <span className="cg-control-label">Emphasis</span>
            <TugPopupButton
              label={previewEmphasis}
              size="sm"
              items={(["filled", "outlined", "ghost"] as TugButtonEmphasis[]).map((v) => ({
                id: v,
                label: v,
              }))}
              onSelect={(id) => setPreviewEmphasis(id as TugButtonEmphasis)}
            />
          </div>
          <div className="cg-control-group">
            <span className="cg-control-label">Role</span>
            <TugPopupButton
              label={previewRole}
              size="sm"
              items={(["accent", "action", "agent", "data", "danger"] as TugButtonRole[]).map((v) => ({
                id: v,
                label: v,
              }))}
              onSelect={(id) => setPreviewRole(id as TugButtonRole)}
            />
          </div>

          <div className="cg-control-group">
            <span className="cg-control-label">Size</span>
            <TugPopupButton
              label={previewSize}
              size="sm"
              items={ALL_SIZES.map((s) => ({
                id: s,
                label: s,
              }))}
              onSelect={(id) => setPreviewSize(id as TugButtonSize)}
            />
          </div>

          <div className="cg-control-group">
            <TugCheckbox
              checked={previewDisabled}
              onCheckedChange={(checked) => setPreviewDisabled(checked === true)}
              label="Disabled"
              size="sm"
            />
          </div>

          <div className="cg-control-group">
            <TugCheckbox
              checked={previewLoading}
              onCheckedChange={(checked) => setPreviewLoading(checked === true)}
              label="Loading"
              size="sm"
            />
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Interactive Preview ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugPushButton — Interactive Preview</div>
        <div className="cg-variant-row">
          <TugPushButton
            emphasis={previewEmphasis}
            role={previewRole}
            size={previewSize}
            disabled={previewDisabled}
            loading={previewLoading}
          >
            Push
          </TugPushButton>
          <TugButton
            subtype="icon"
            emphasis={previewEmphasis}
            role={previewRole}
            size={previewSize}
            disabled={previewDisabled}
            loading={previewLoading}
            icon={<Star size={14} />}
            aria-label="Icon button"
          />
          <TugPushButton
            subtype="icon-text"
            emphasis={previewEmphasis}
            role={previewRole}
            size={previewSize}
            disabled={previewDisabled}
            loading={previewLoading}
            icon={<Star size={14} />}
          >
            Icon + Text
          </TugPushButton>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Full Matrix ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugPushButton — Full Matrix (all subtypes × emphasis x role × sizes)</div>
        <div className="cg-matrix">
          {ALL_SUBTYPES.map((subtype) => (
            <div key={subtype} className="cg-subtype-block">
              <div className="cg-subtype-label">subtype: {subtype}</div>
              {ALL_COMBOS.map(({ emphasis, role }) => (
                <div key={`${emphasis}-${role}`} className="cg-variant-row">
                  <div className="cg-variant-label">{emphasis}-{role}</div>
                  <div className="cg-size-group">
                    {ALL_SIZES.map((size) => (
                      <SubtypeButton
                        key={size}
                        subtype={subtype}
                        emphasis={emphasis}
                        role={role}
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
        <TugPushButton
          size="md"
          onClick={handleDispatch}
        >
          Dispatch demoAction
        </TugPushButton>
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
        <TugPushButton
          size="sm"
          onClick={() => setVarOn((v) => !v)}
        >
          Toggle CSS Var
        </TugPushButton>
        <TugPushButton
          size="sm"
          onClick={() => setClassOn((v) => !v)}
        >
          Toggle Class
        </TugPushButton>
        <TugPushButton
          size="sm"
          onClick={() => setStyleOn((v) => !v)}
        >
          Toggle Style
        </TugPushButton>
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
        <TugPushButton
          size="sm"
          onClick={handleAddFive}
        >
          Add 5 tabs
        </TugPushButton>
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
// TugPopupButtonDemo
// ---------------------------------------------------------------------------

/** Sample items for the TugPopupButton gallery demo. Module-scope to avoid recreation. */
const DEMO_POPUP_BUTTON_ITEMS: TugPopupMenuItem[] = [
  { id: "option-alpha", label: "Alpha",            icon: <Star size={12} /> },
  { id: "option-beta",  label: "Beta",             icon: <Star size={12} /> },
  { id: "option-gamma", label: "Gamma (disabled)", disabled: true },
];

/**
 * TugPopupButtonDemo -- standalone TugPopupButton demo.
 *
 * Renders a TugPopupButton with sample items. Selecting an item updates status text.
 */
export function TugPopupButtonDemo() {
  const [lastSelected, setLastSelected] = useState<string | null>(null);

  return (
    <div className="cg-popup-button-demo">
      <TugPopupButton
        label="Open Menu"
        size="sm"
        items={DEMO_POPUP_BUTTON_ITEMS}
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
 * GalleryDropdownContent -- delegates to GalleryPopupButtonContent.
 */
export function GalleryDropdownContent() {
  return <GalleryPopupButtonContent />;
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
          <TugPushButton
            size="md"
            onClick={() => setLastAction("Cancel clicked")}
          >
            Cancel
          </TugPushButton>
          <span ref={confirmContainerRef}>
            <TugPushButton
              emphasis="filled"
              role="accent"
              size="md"
              onClick={() => setLastAction("Confirm clicked")}
            >
              Confirm
            </TugPushButton>
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
// GalleryTitleBarContent
// ---------------------------------------------------------------------------

/**
 * GalleryTitleBarContent -- interactive demo of CardTitleBar controls.
 *
 * Shows a CardTitleBar in isolation (outside a real Tugcard frame) with interactive
 * controls for toggling the collapsed state and selecting the icon.
 *
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
          CardTitleBar in isolation: collapse/expand toggle (chevron), menu (horizontal
          ellipsis), and close buttons.
        </p>
      </div>

      <div className="cg-divider" />

      {/* ---- Interactive Controls ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Preview Controls</div>
        <div className="cg-controls">
          <div className="cg-control-group">
            <label className="cg-control-label">
              Icon
            </label>
            <TugPopupButton
              label={iconName || "None"}
              size="sm"
              items={[
                { id: "", label: "None" },
                { id: "Layout", label: "Layout" },
                { id: "Settings", label: "Settings" },
                { id: "Terminal", label: "Terminal" },
                { id: "Code", label: "Code" },
              ]}
              onSelect={(id) => setIconName(id)}
            />
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

      {/* ---- Live CardTitleBar Demo ---- */}
      <div className="cg-section">
        <div className="cg-section-title">CardTitleBar — Live Demo</div>
        <div
          style={{
            border: "1px solid var(--tug-base-card-border)",
            borderRadius: "var(--tug-base-radius-md)",
            overflow: "hidden",
            background: "var(--tug-card-title-bar-bg-inactive)",
          }}
          data-testid="gallery-card-title-bar-demo"
        >
          <CardTitleBar
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
          <TugPushButton
            size="sm"
            onClick={handleCollapse}
          >
            {collapsed ? "Expand" : "Collapse"}
          </TugPushButton>
        </div>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryBadgeContent
// ---------------------------------------------------------------------------

/** All role combinations for the TugBadge showcase matrix */
const ALL_BADGE_ROLES: TugBadgeRole[] = ["accent", "action", "agent", "data", "danger", "success", "caution"];
const ALL_BADGE_SIZES: TugBadgeSize[] = ["sm", "md", "lg"];
const ALL_BADGE_EMPHASES: TugBadgeEmphasis[] = ["tinted", "ghost"];

/**
 * GalleryBadgeContent -- TugBadge showcase gallery tab.
 *
 * Shows tinted and ghost emphasis across all 7 roles at all sizes.
 */
export function GalleryBadgeContent() {
  return (
    <div className="cg-content" data-testid="gallery-badge-content">

      {ALL_BADGE_EMPHASES.map((emphasis) => (
        <React.Fragment key={emphasis}>
          <div className="cg-section">
            <div className="cg-section-title">TugBadge — {emphasis}</div>
            <div className="cg-matrix">
              <div className="cg-subtype-block">
                <div className="cg-subtype-label">text only</div>
                {ALL_BADGE_ROLES.map((role) => (
                  <div key={role} className="cg-variant-row">
                    <div className="cg-variant-label">{role}</div>
                    <div className="cg-size-group">
                      {ALL_BADGE_SIZES.map((size) => (
                        <TugBadge key={size} emphasis={emphasis} role={role} size={size}>
                          {role}
                        </TugBadge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="cg-subtype-block">
                <div className="cg-subtype-label">icon + text</div>
                {ALL_BADGE_ROLES.map((role) => (
                  <div key={role} className="cg-variant-row">
                    <div className="cg-variant-label">{role}</div>
                    <div className="cg-size-group">
                      {ALL_BADGE_SIZES.map((size) => (
                        <TugBadge key={size} emphasis={emphasis} role={role} size={size} icon={<Star />}>
                          {role}
                        </TugBadge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {emphasis !== ALL_BADGE_EMPHASES[ALL_BADGE_EMPHASES.length - 1] && <div className="cg-divider" />}
        </React.Fragment>
      ))}

    </div>
  );
}

// ---------------------------------------------------------------------------
// registerGalleryCards
// ---------------------------------------------------------------------------

/**
 * Register all twenty-one gallery card types in the global card registry.
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
 * - `defaultTabs: GALLERY_DEFAULT_TABS` -- creates twenty-one-tab gallery card
 * - `defaultTitle: "Component Gallery"` -- card header prefix
 *
 * **Authoritative reference:** Spec S03 (#s03-gallery-registrations), [D06]
 */
export function registerGalleryCards(): void {
  // ---- gallery-buttons (entry-point: carries defaultTabs + defaultTitle) ----
  registerCard({
    componentId: "gallery-buttons",
    contentFactory: (_cardId) => <GalleryButtonsContent />,
    defaultMeta: { title: "TugPushButton", icon: "MousePointerClick", closable: true },
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
    defaultMeta: { title: "TugPopupButton", icon: "ChevronDown", closable: true },
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

  // ---- gallery-title-bar ----
  // Step 3: CardTitleBar demo. Shows collapse/expand toggle, menu, close button.
  // Demonstrates window-shade collapse behavior. [D07]
  registerCard({
    componentId: "gallery-title-bar",
    contentFactory: (_cardId) => <GalleryTitleBarContent />,
    defaultMeta: { title: "Title Bar", icon: "PanelTop", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-input ----
  // Step 4, Component 1: TugInput — native input wrapper with field tokens.
  registerCard({
    componentId: "gallery-input",
    contentFactory: (_cardId) => <GalleryInputContent />,
    defaultMeta: { title: "TugInput", icon: "TextCursorInput", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-label ----
  // Step 4, Component 2: TugLabel — Radix Label wrapper with multiline, ellipsis, icon.
  registerCard({
    componentId: "gallery-label",
    contentFactory: (_cardId) => <GalleryLabelContent />,
    defaultMeta: { title: "TugLabel", icon: "Type", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-marquee ----
  // Step 4, Component 2a: TugMarquee — single-line scrolling label.
  registerCard({
    componentId: "gallery-marquee",
    contentFactory: (_cardId) => <GalleryMarqueeContent />,
    defaultMeta: { title: "TugMarquee", icon: "MoveHorizontal", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-checkbox ----
  // Step 4, Component 3: TugCheckbox — Radix Checkbox wrapper with toggle tokens.
  registerCard({
    componentId: "gallery-checkbox",
    contentFactory: (_cardId) => <GalleryCheckboxContent />,
    defaultMeta: { title: "TugCheckbox", icon: "CheckSquare", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-switch ----
  // Step 4, Component 4: TugSwitch — Radix Switch wrapper with toggle track/thumb tokens.
  registerCard({
    componentId: "gallery-switch",
    contentFactory: (_cardId) => <GallerySwitchContent />,
    defaultMeta: { title: "TugSwitch", icon: "ToggleRight", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-theme-generator ----
  // Theme Generator: derives complete 264-token themes from seed colors + mood
  // parameters. Uses theme-derivation-engine + theme-accessibility modules. [D04]
  registerCard({
    componentId: "gallery-theme-generator",
    contentFactory: (_cardId) => <GalleryThemeGeneratorContent />,
    defaultMeta: { title: "Theme Generator", icon: "Paintbrush", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-badge ----
  // TugBadge showcase: full emphasis x role matrix (3 × 7 = 21 combinations)
  // at all three sizes, with interactive preview controls. [D06]
  registerCard({
    componentId: "gallery-badge",
    contentFactory: (_cardId) => <GalleryBadgeContent />,
    defaultMeta: { title: "TugBadge", icon: "Tag", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

}

// Re-export GalleryMutationTxContent so tests can import it from either location.
export { GalleryMutationTxContent };
