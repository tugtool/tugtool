/**
 * Gallery card registrations.
 *
 * Registers all twenty-one gallery card types in the global card registry.
 * Also exports GALLERY_DEFAULT_TABS and small adapter components.
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
 * @module components/tugways/cards/gallery-registrations
 */

import React, { useState } from "react";
import { Star } from "lucide-react";
import { registerCard } from "@/card-registry";
import { TugBadge } from "@/components/tugways/tug-badge";
import type { TugBadgeEmphasis, TugBadgeRole, TugBadgeSize } from "@/components/tugways/tug-badge";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import type { TugPopupMenuItem } from "@/components/tugways/tug-popup-button";
import type { TabItem } from "@/layout-tree";
import { GalleryButtonsContent } from "./gallery-push-button";
import { GalleryChainActionsContent } from "./gallery-chain-actions";
import { GalleryMutationContent } from "./gallery-mutation";
import { GalleryTabBarContent } from "./gallery-tab-bar";
import { GalleryDefaultButtonContent } from "./gallery-default-button";
import { GalleryTitleBarContent } from "./gallery-title-bar";
import { GalleryMutationTxContent } from "./gallery-mutation-tx";
import { GalleryObservablePropsContent } from "./gallery-observable-props";
import { GalleryPaletteContent } from "./gallery-palette";
import { GalleryScaleTimingContent } from "./gallery-scale-timing";
import { GalleryCascadeInspectorContent } from "./gallery-cascade-inspector";
import { GalleryAnimatorContent } from "./gallery-animator";
import { GallerySkeletonContent } from "./gallery-skeleton";
import { GalleryInputContent } from "./gallery-input";
import { GalleryLabelContent } from "./gallery-label";
import { GalleryMarqueeContent } from "./gallery-marquee";
import { GalleryCheckboxContent } from "./gallery-checkbox";
import { GallerySwitchContent } from "./gallery-switch";
import { GalleryThemeGeneratorContent } from "./gallery-theme-generator";
import { GalleryPopupButtonContent } from "./gallery-popup-button";
import "./gallery.css";

// ---------------------------------------------------------------------------
// GALLERY_DEFAULT_TABS
// ---------------------------------------------------------------------------

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
  { id: "template", componentId: "gallery-theme-generator",   title: "Theme Accessibility",   closable: true },
  { id: "template", componentId: "gallery-badge",             title: "TugBadge",             closable: true },
];

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
    <div className="cg-content" data-testid="gallery-badge">

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
  // parameters. Uses theme-accessibility module + live CSS snapshot data. [D04]
  registerCard({
    componentId: "gallery-theme-generator",
    contentFactory: (_cardId) => <GalleryThemeGeneratorContent />,
    defaultMeta: { title: "Theme Accessibility", icon: "Paintbrush", closable: true },
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
