/**
 * Gallery card registrations.
 *
 * Registers all twenty-three gallery card types in the global card registry.
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
import { GalleryPushButton } from "./gallery-push-button";
import { GalleryChainActions } from "./gallery-chain-actions";
import { GalleryMutation } from "./gallery-mutation";
import { GalleryTabBar } from "./gallery-tab-bar";
import { GalleryDefaultButton } from "./gallery-default-button";
import { GalleryTitleBar } from "./gallery-title-bar";
import { GalleryMutationTx } from "./gallery-mutation-tx";
import { GalleryObservableProps } from "./gallery-observable-props";
import { GalleryPalette } from "./gallery-palette";
import { GalleryScaleTiming } from "./gallery-scale-timing";
import { GalleryCascadeInspector } from "./gallery-cascade-inspector";
import { GalleryAnimator } from "./gallery-animator";
import { GallerySkeleton } from "./gallery-skeleton";
import { GalleryInput } from "./gallery-input";
import { GalleryLabel } from "./gallery-label";
import { GalleryMarquee } from "./gallery-marquee";
import { GalleryCheckbox } from "./gallery-checkbox";
import { GallerySwitch } from "./gallery-switch";
import { GalleryThemeGenerator } from "./gallery-theme-generator";
import { GalleryPopupButton } from "./gallery-popup-button";
import { GallerySlider } from "./gallery-slider";
import { GalleryValueInput } from "./gallery-value-input";
import { GalleryRadioGroup } from "./gallery-radio-group";
import { GalleryChoiceGroup } from "./gallery-choice-group";
import { GalleryConfirmPopover } from "./gallery-confirm-popover";
import { GalleryContextMenu } from "./gallery-context-menu";
import { GalleryOptionGroup } from "./gallery-option-group";
import { GalleryPopover } from "./gallery-popover";
import { GalleryBox } from "./gallery-box";
import { GalleryTextarea } from "./gallery-textarea";
import { GallerySeparator } from "./gallery-separator";
import { GalleryProgress } from "./gallery-progress";
import { GalleryAccordion } from "./gallery-accordion";
import { GalleryTooltip } from "./gallery-tooltip";
import { GalleryBanner } from "./gallery-banner";
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
  { id: "template", componentId: "gallery-accordion",         title: "TugAccordion",         closable: true },
  { id: "template", componentId: "gallery-badge",             title: "TugBadge",             closable: true },
  { id: "template", componentId: "gallery-slider",            title: "TugSlider",            closable: true },
  { id: "template", componentId: "gallery-value-input",       title: "TugValueInput",        closable: true },
  { id: "template", componentId: "gallery-radio-group",       title: "TugRadioGroup",        closable: true },
  { id: "template", componentId: "gallery-choice-group",      title: "TugChoiceGroup",       closable: true },
  { id: "template", componentId: "gallery-confirm-popover", title: "TugConfirmPopover",    closable: true },
  { id: "template", componentId: "gallery-context-menu",    title: "TugContextMenu",       closable: true },
  { id: "template", componentId: "gallery-box",             title: "TugBox",               closable: true },
  { id: "template", componentId: "gallery-textarea",        title: "TugTextarea",          closable: true },
  { id: "template", componentId: "gallery-tooltip",         title: "TugTooltip",           closable: true },
  { id: "template", componentId: "gallery-option-group",   title: "TugOptionGroup",       closable: true },
  { id: "template", componentId: "gallery-popover",        title: "TugPopover",            closable: true },
  { id: "template", componentId: "gallery-separator",      title: "TugSeparator",          closable: true },
  { id: "template", componentId: "gallery-progress",      title: "TugProgress",           closable: true },
  { id: "template", componentId: "gallery-banner",        title: "TugBanner",             closable: true },
];

// ---------------------------------------------------------------------------
// GalleryDropdown
// ---------------------------------------------------------------------------

/**
 * GalleryDropdown -- delegates to GalleryPopupButton.
 */
export function GalleryDropdown() {
  return <GalleryPopupButton />;
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
// GalleryBadge
// ---------------------------------------------------------------------------

/** All role combinations for the TugBadge showcase matrix */
const ALL_BADGE_ROLES: TugBadgeRole[] = ["accent", "action", "agent", "data", "danger", "success", "caution"];
const ALL_BADGE_SIZES: TugBadgeSize[] = ["sm", "md", "lg"];
const ALL_BADGE_EMPHASES: TugBadgeEmphasis[] = ["tinted", "ghost"];

/**
 * GalleryBadge -- TugBadge showcase gallery tab.
 *
 * Shows tinted and ghost emphasis across all 7 roles at all sizes.
 */
export function GalleryBadge() {
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
 * Register all gallery card types in the global card registry.
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
 * - `defaultTabs: GALLERY_DEFAULT_TABS` -- creates twenty-two-tab gallery card
 * - `defaultTitle: "Component Gallery"` -- card header prefix
 *
 * **Authoritative reference:** Spec S03 (#s03-gallery-registrations), [D06]
 */
export function registerGalleryCards(): void {
  // ---- gallery-buttons (entry-point: carries defaultTabs + defaultTitle) ----
  registerCard({
    componentId: "gallery-buttons",
    contentFactory: (_cardId) => <GalleryPushButton />,
    defaultMeta: { title: "TugPushButton", icon: "MousePointerClick", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    defaultTabs: GALLERY_DEFAULT_TABS,
    defaultTitle: "Component Gallery",
  });

  // ---- gallery-chain-actions ----
  registerCard({
    componentId: "gallery-chain-actions",
    contentFactory: (_cardId) => <GalleryChainActions />,
    defaultMeta: { title: "Chain Actions", icon: "Zap", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-mutation ----
  registerCard({
    componentId: "gallery-mutation",
    contentFactory: (_cardId) => <GalleryMutation />,
    defaultMeta: { title: "Mutation Model", icon: "GitBranch", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-tabbar ----
  registerCard({
    componentId: "gallery-tabbar",
    contentFactory: (_cardId) => <GalleryTabBar />,
    defaultMeta: { title: "TugTabBar", icon: "PanelTop", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-dropdown ----
  registerCard({
    componentId: "gallery-dropdown",
    contentFactory: (_cardId) => <GalleryDropdown />,
    defaultMeta: { title: "TugPopupButton", icon: "ChevronDown", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-default-button ----
  registerCard({
    componentId: "gallery-default-button",
    contentFactory: (_cardId) => <GalleryDefaultButton />,
    defaultMeta: { title: "Default Button", icon: "CornerDownLeft", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-mutation-tx ----
  registerCard({
    componentId: "gallery-mutation-tx",
    contentFactory: (_cardId) => <GalleryMutationTx />,
    defaultMeta: { title: "Mutation Transactions", icon: "Layers", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-observable-props ----
  // This is the first gallery tab to use the cardId argument from contentFactory.
  // The cardId is passed through to GalleryObservableProps so inspector
  // controls can direct setProperty actions to the correct Tugcard responder node
  // via dispatchTo. [D04] Spec S07 (#s07-gallery-demo)
  registerCard({
    componentId: "gallery-observable-props",
    contentFactory: (cardId) => <GalleryObservableProps cardId={cardId} />,
    defaultMeta: { title: "Observable Props", icon: "SlidersHorizontal", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-palette ----
  registerCard({
    componentId: "gallery-palette",
    contentFactory: (_cardId) => <GalleryPalette />,
    defaultMeta: { title: "Palette Engine", icon: "Palette", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-scale-timing ----
  registerCard({
    componentId: "gallery-scale-timing",
    contentFactory: (_cardId) => <GalleryScaleTiming />,
    defaultMeta: { title: "Scale & Timing", icon: "SlidersHorizontal", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-cascade-inspector ----
  registerCard({
    componentId: "gallery-cascade-inspector",
    contentFactory: (_cardId) => <GalleryCascadeInspector />,
    defaultMeta: { title: "Cascade Inspector", icon: "Search", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-animator ----
  registerCard({
    componentId: "gallery-animator",
    contentFactory: (_cardId) => <GalleryAnimator />,
    defaultMeta: { title: "TugAnimator", icon: "Play", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-skeleton ----
  // TugSkeleton uses CSS shimmer (CSS lane, Rule 13 — continuous, infinite).
  // Gets its own tab rather than living in the animator tab. [D04]
  registerCard({
    componentId: "gallery-skeleton",
    contentFactory: (_cardId) => <GallerySkeleton />,
    defaultMeta: { title: "TugSkeleton", icon: "Loader", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-title-bar ----
  // Step 3: CardTitleBar demo. Shows collapse/expand toggle, menu, close button.
  // Demonstrates window-shade collapse behavior. [D07]
  registerCard({
    componentId: "gallery-title-bar",
    contentFactory: (_cardId) => <GalleryTitleBar />,
    defaultMeta: { title: "Title Bar", icon: "PanelTop", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-input ----
  // Step 4, Component 1: TugInput — native input wrapper with field tokens.
  registerCard({
    componentId: "gallery-input",
    contentFactory: (_cardId) => <GalleryInput />,
    defaultMeta: { title: "TugInput", icon: "TextCursorInput", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-label ----
  // Step 4, Component 2: TugLabel — Radix Label wrapper with multiline, ellipsis, icon.
  registerCard({
    componentId: "gallery-label",
    contentFactory: (_cardId) => <GalleryLabel />,
    defaultMeta: { title: "TugLabel", icon: "Type", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-marquee ----
  // Step 4, Component 2a: TugMarquee — single-line scrolling label.
  registerCard({
    componentId: "gallery-marquee",
    contentFactory: (_cardId) => <GalleryMarquee />,
    defaultMeta: { title: "TugMarquee", icon: "MoveHorizontal", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-checkbox ----
  // Step 4, Component 3: TugCheckbox — Radix Checkbox wrapper with toggle tokens.
  registerCard({
    componentId: "gallery-checkbox",
    contentFactory: (_cardId) => <GalleryCheckbox />,
    defaultMeta: { title: "TugCheckbox", icon: "CheckSquare", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-switch ----
  // Step 4, Component 4: TugSwitch — Radix Switch wrapper with toggle track/thumb tokens.
  registerCard({
    componentId: "gallery-switch",
    contentFactory: (_cardId) => <GallerySwitch />,
    defaultMeta: { title: "TugSwitch", icon: "ToggleRight", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-theme-generator ----
  // Theme Generator: derives complete 264-token themes from seed colors + mood
  // parameters. Uses theme-accessibility module + live CSS snapshot data. [D04]
  registerCard({
    componentId: "gallery-theme-generator",
    contentFactory: (_cardId) => <GalleryThemeGenerator />,
    defaultMeta: { title: "Theme Accessibility", icon: "Paintbrush", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-accordion ----
  // TugAccordion showcase: single/multiple modes, default open, bordered vs
  // unbordered, disabled (root and item-level), TugBox cascade, rich triggers,
  // and nested tugways components inside content panels.
  registerCard({
    componentId: "gallery-accordion",
    contentFactory: (_cardId) => <GalleryAccordion />,
    defaultMeta: { title: "TugAccordion", icon: "ChevronDown", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-badge ----
  // TugBadge showcase: full emphasis x role matrix (3 × 7 = 21 combinations)
  // at all three sizes, with interactive preview controls. [D06]
  registerCard({
    componentId: "gallery-badge",
    contentFactory: (_cardId) => <GalleryBadge />,
    defaultMeta: { title: "TugBadge", icon: "Tag", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-slider ----
  // TugSlider showcase: sizes, layouts, formatters, disabled, and no-value-input modes.
  registerCard({
    componentId: "gallery-slider",
    contentFactory: (_cardId) => <GallerySlider />,
    defaultMeta: { title: "TugSlider", icon: "SlidersHorizontal", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-value-input ----
  // TugValueInput showcase: sizes, formatters, disabled.
  registerCard({
    componentId: "gallery-value-input",
    contentFactory: (_cardId) => <GalleryValueInput />,
    defaultMeta: { title: "TugValueInput", icon: "Hash", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-radio-group ----
  // TugRadioGroup showcase: sizes, orientations, roles, labeled group, disabled.
  registerCard({
    componentId: "gallery-radio-group",
    contentFactory: (_cardId) => <GalleryRadioGroup />,
    defaultMeta: { title: "TugRadioGroup", icon: "CircleDot", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-choice-group ----
  // TugChoiceGroup showcase: sizes, roles, disabled states, instant and animated indicator.
  registerCard({
    componentId: "gallery-choice-group",
    contentFactory: (_cardId) => <GalleryChoiceGroup />,
    defaultMeta: { title: "TugChoiceGroup", icon: "ToggleLeft", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-confirm-popover ----
  // TugConfirmPopover showcase: danger confirmation, action confirmation, custom labels,
  // positioning (top vs bottom), and the imperative Promise API.
  registerCard({
    componentId: "gallery-confirm-popover",
    contentFactory: (_cardId) => <GalleryConfirmPopover />,
    defaultMeta: { title: "TugConfirmPopover", icon: "ShieldAlert", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-context-menu ----
  // TugContextMenu showcase: basic right-click region, icons, shortcuts, separators
  // and labels, disabled items, and wrapping a card-like UI element.
  registerCard({
    componentId: "gallery-context-menu",
    contentFactory: (_cardId) => <GalleryContextMenu />,
    defaultMeta: { title: "TugContextMenu", icon: "MousePointer2", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-box ----
  // TugBox showcase: variants, label positions, nested boxes, disabled cascade, inset.
  registerCard({
    componentId: "gallery-box",
    contentFactory: (_cardId) => <GalleryBox />,
    defaultMeta: { title: "TugBox", icon: "Box", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-textarea ----
  // TugTextarea showcase: sizes, validation states, resize variants, auto-resize,
  // character counter, disabled/read-only states, and TugBox disabled cascade.
  registerCard({
    componentId: "gallery-textarea",
    contentFactory: (_cardId) => <GalleryTextarea />,
    defaultMeta: { title: "TugTextarea", icon: "AlignLeft", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-tooltip ----
  // TugTooltip showcase: basic, positioning (four sides), shortcuts, arrow toggle,
  // icon button use case, alignment, truncation-aware, disabled trigger, rich content.
  registerCard({
    componentId: "gallery-tooltip",
    contentFactory: (_cardId) => <GalleryTooltip />,
    defaultMeta: { title: "TugTooltip", icon: "MessageSquare", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-option-group ----
  // TugOptionGroup showcase: icon-only toolbar, icon+label, sizes, roles,
  // disabled states, and TugBox disabled cascade.
  registerCard({
    componentId: "gallery-option-group",
    contentFactory: (_cardId) => <GalleryOptionGroup />,
    defaultMeta: { title: "TugOptionGroup", icon: "ToggleLeft", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-popover ----
  // TugPopover showcase: basic, positioning (4 sides), arrow, form content,
  // close button, and controlled open state.
  registerCard({
    componentId: "gallery-popover",
    contentFactory: (_cardId) => <GalleryPopover />,
    defaultMeta: { title: "TugPopover", icon: "MessageSquareMore", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-separator ----
  // TugSeparator showcase: plain, labeled, ornamental (glyphs + dinkus),
  // capped (plain + console-style), vertical, and SVG ornament.
  registerCard({
    componentId: "gallery-separator",
    contentFactory: (_cardId) => <GallerySeparator />,
    defaultMeta: { title: "TugSeparator", icon: "Minus", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-progress ----
  // TugProgress showcase: spinner/bar/ring (indeterminate + determinate),
  // transition demo, roles, disabled, and TugBox disabled cascade.
  registerCard({
    componentId: "gallery-progress",
    contentFactory: (_cardId) => <GalleryProgress />,
    defaultMeta: { title: "TugProgress", icon: "Activity", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ---- gallery-banner ----
  // TugBanner showcase: status variant (danger/caution/default tones), status with
  // icon, and error variant with sample stack trace and dismiss button.
  registerCard({
    componentId: "gallery-banner",
    contentFactory: (_cardId) => <GalleryBanner />,
    defaultMeta: { title: "TugBanner", icon: "AlertTriangle", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

}

// Re-export GalleryMutationTx so tests can import it from either location.
export { GalleryMutationTx };
