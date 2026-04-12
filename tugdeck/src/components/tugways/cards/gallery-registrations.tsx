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

import React, { useId, useState } from "react";
import { Star } from "lucide-react";
import { registerCard } from "@/card-registry";
import { TugBadge } from "@/components/tugways/tug-badge";
import type { TugBadgeEmphasis, TugBadgeRole, TugBadgeSize } from "@/components/tugways/tug-badge";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import type { TugPopupButtonItem } from "@/components/tugways/tug-popup-button";
import { useResponderForm } from "@/components/tugways/use-responder-form";
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
import { GalleryAlert } from "./gallery-alert";
import { GallerySheet } from "./gallery-sheet";
import { GalleryBulletin } from "./gallery-bulletin";
import { GalleryMarkdownView } from "./gallery-markdown-view";
import { GalleryAtom } from "./gallery-atom";
import { GalleryPromptInput } from "./gallery-prompt-input";
import "./gallery.css";
import { TUG_ACTIONS } from "../action-vocabulary";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

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
  // ---- Buttons ----
  { id: "template", componentId: "gallery-buttons",           title: "TugPushButton",        closable: true },
  { id: "template", componentId: "gallery-default-button",    title: "TugDefaultButton",     closable: true },
  { id: "template", componentId: "gallery-popup-button",      title: "TugPopupButton",       closable: true },
  // ---- Text Input & Display ----
  { id: "template", componentId: "gallery-input",             title: "TugInput",             closable: true },
  { id: "template", componentId: "gallery-value-input",       title: "TugValueInput",        closable: true },
  { id: "template", componentId: "gallery-textarea",          title: "TugTextarea",          closable: true },
  { id: "template", componentId: "gallery-prompt-input",      title: "TugPromptInput",       closable: true },
  { id: "template", componentId: "gallery-label",             title: "TugLabel",             closable: true },
  { id: "template", componentId: "gallery-markdown-view",     title: "TugMarkdownView",      closable: true },
  // ---- Selection ----
  { id: "template", componentId: "gallery-checkbox",          title: "TugCheckbox",          closable: true },
  { id: "template", componentId: "gallery-switch",            title: "TugSwitch",            closable: true },
  { id: "template", componentId: "gallery-radio-group",       title: "TugRadioGroup",        closable: true },
  { id: "template", componentId: "gallery-choice-group",      title: "TugChoiceGroup",       closable: true },
  { id: "template", componentId: "gallery-option-group",      title: "TugOptionGroup",       closable: true },
  { id: "template", componentId: "gallery-slider",            title: "TugSlider",            closable: true },
  // ---- Overlays ----
  { id: "template", componentId: "gallery-popover",           title: "TugPopover",           closable: true },
  { id: "template", componentId: "gallery-confirm-popover",   title: "TugConfirmPopover",    closable: true },
  { id: "template", componentId: "gallery-context-menu",      title: "TugContextMenu",       closable: true },
  { id: "template", componentId: "gallery-tooltip",           title: "TugTooltip",           closable: true },
  { id: "template", componentId: "gallery-sheet",             title: "TugSheet",             closable: true },
  { id: "template", componentId: "gallery-alert",             title: "TugAlert",             closable: true },
  // ---- Feedback & Status ----
  { id: "template", componentId: "gallery-progress",          title: "TugProgress",          closable: true },
  { id: "template", componentId: "gallery-badge",             title: "TugBadge",             closable: true },
  { id: "template", componentId: "gallery-banner",            title: "TugBanner",            closable: true },
  { id: "template", componentId: "gallery-bulletin",          title: "TugBulletin",          closable: true },
  { id: "template", componentId: "gallery-skeleton",          title: "TugSkeleton",          closable: true },
  { id: "template", componentId: "gallery-marquee",           title: "TugMarquee",           closable: true },
  // ---- Layout & Structure ----
  { id: "template", componentId: "gallery-box",               title: "TugBox",               closable: true },
  { id: "template", componentId: "gallery-atom",              title: "TugAtom",              closable: true },
  { id: "template", componentId: "gallery-accordion",         title: "TugAccordion",         closable: true },
  { id: "template", componentId: "gallery-separator",         title: "TugSeparator",         closable: true },
  { id: "template", componentId: "gallery-tabbar",            title: "TugTabBar",            closable: true },
  { id: "template", componentId: "gallery-title-bar",         title: "TugTitleBar",          closable: true },
  // ---- Animation & Theming ----
  { id: "template", componentId: "gallery-animator",          title: "TugAnimator",          closable: true },
  { id: "template", componentId: "gallery-scale-timing",      title: "Scale & Timing",       closable: true },
  { id: "template", componentId: "gallery-palette",           title: "Palette Engine",       closable: true },
  { id: "template", componentId: "gallery-theme-generator",   title: "Theme Accessibility",  closable: true },
  // ---- Architecture ----
  { id: "template", componentId: "gallery-mutation",          title: "Mutation Model",       closable: true },
  { id: "template", componentId: "gallery-mutation-tx",       title: "Mutation Transactions", closable: true },
  { id: "template", componentId: "gallery-observable-props",  title: "Observable Props",     closable: true },
  { id: "template", componentId: "gallery-chain-actions",     title: "Chain Actions",        closable: true },
];

// ---------------------------------------------------------------------------
// TugPopupButtonDemo
// ---------------------------------------------------------------------------

/** Sample items for the TugPopupButton gallery demo. Module-scope to avoid recreation. */
const DEMO_POPUP_BUTTON_ITEMS: TugPopupButtonItem<string>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: "option-alpha", label: "Alpha",            icon: <Star size={12} /> },
  { action: TUG_ACTIONS.SET_VALUE, value: "option-beta",  label: "Beta",             icon: <Star size={12} /> },
  { action: TUG_ACTIONS.SET_VALUE, value: "option-gamma", label: "Gamma (disabled)", disabled: true },
];

/**
 * TugPopupButtonDemo -- standalone TugPopupButton demo.
 *
 * Renders a TugPopupButton with sample items. Selecting an item updates status text.
 */
export function TugPopupButtonDemo() {
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const popupId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    setValueString: {
      [popupId]: setLastSelected,
    },
  });

  return (
    <ResponderScope>
    <div
      className="cg-popup-button-demo"
      ref={responderRef as (el: HTMLDivElement | null) => void}
    >
      <TugPopupButton
        label="Open Menu"
        size="sm"
        senderId={popupId}
        items={DEMO_POPUP_BUTTON_ITEMS}
      />
      {lastSelected !== null && (
        <TugLabel size="2xs" color="muted">{`Selected: ${lastSelected}`}</TugLabel>
      )}
    </div>
    </ResponderScope>
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
            <TugLabel className="cg-section-title">{`TugBadge — ${emphasis}`}</TugLabel>
            <div className="cg-matrix">
              <div className="cg-subtype-block">
                <TugLabel size="2xs" color="muted">text only</TugLabel>
                {ALL_BADGE_ROLES.map((role) => (
                  <div key={role} className="cg-variant-row">
                    <TugLabel size="2xs" color="muted">{role}</TugLabel>
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
                <TugLabel size="2xs" color="muted">icon + text</TugLabel>
                {ALL_BADGE_ROLES.map((role) => (
                  <div key={role} className="cg-variant-row">
                    <TugLabel size="2xs" color="muted">{role}</TugLabel>
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
          {emphasis !== ALL_BADGE_EMPHASES[ALL_BADGE_EMPHASES.length - 1] && <TugSeparator />}
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

  // ===========================================================================
  // Buttons
  // ===========================================================================

  // gallery-buttons (entry-point: carries defaultTabs + defaultTitle)
  registerCard({
    componentId: "gallery-buttons",
    contentFactory: (_cardId) => <GalleryPushButton />,
    defaultMeta: { title: "TugPushButton", icon: "MousePointerClick", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    defaultTabs: GALLERY_DEFAULT_TABS,
    defaultTitle: "Component Gallery",
  });

  registerCard({
    componentId: "gallery-default-button",
    contentFactory: (_cardId) => <GalleryDefaultButton />,
    defaultMeta: { title: "TugDefaultButton", icon: "CornerDownLeft", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-popup-button",
    contentFactory: (_cardId) => <GalleryPopupButton />,
    defaultMeta: { title: "TugPopupButton", icon: "ChevronDown", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ===========================================================================
  // Text Input & Display
  // ===========================================================================

  registerCard({
    componentId: "gallery-input",
    contentFactory: (_cardId) => <GalleryInput />,
    defaultMeta: { title: "TugInput", icon: "TextCursorInput", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-value-input",
    contentFactory: (_cardId) => <GalleryValueInput />,
    defaultMeta: { title: "TugValueInput", icon: "Hash", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-textarea",
    contentFactory: (_cardId) => <GalleryTextarea />,
    defaultMeta: { title: "TugTextarea", icon: "AlignLeft", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-prompt-input",
    contentFactory: (_cardId) => <GalleryPromptInput />,
    defaultMeta: { title: "TugPromptInput", icon: "TextCursorInput", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-label",
    contentFactory: (_cardId) => <GalleryLabel />,
    defaultMeta: { title: "TugLabel", icon: "Type", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-markdown-view",
    contentFactory: (_cardId) => <GalleryMarkdownView />,
    defaultMeta: { title: "TugMarkdownView", icon: "FileText", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ===========================================================================
  // Selection
  // ===========================================================================

  registerCard({
    componentId: "gallery-checkbox",
    contentFactory: (_cardId) => <GalleryCheckbox />,
    defaultMeta: { title: "TugCheckbox", icon: "CheckSquare", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-switch",
    contentFactory: (_cardId) => <GallerySwitch />,
    defaultMeta: { title: "TugSwitch", icon: "ToggleRight", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-radio-group",
    contentFactory: (_cardId) => <GalleryRadioGroup />,
    defaultMeta: { title: "TugRadioGroup", icon: "CircleDot", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-choice-group",
    contentFactory: (_cardId) => <GalleryChoiceGroup />,
    defaultMeta: { title: "TugChoiceGroup", icon: "ToggleLeft", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-option-group",
    contentFactory: (_cardId) => <GalleryOptionGroup />,
    defaultMeta: { title: "TugOptionGroup", icon: "ToggleLeft", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-slider",
    contentFactory: (_cardId) => <GallerySlider />,
    defaultMeta: { title: "TugSlider", icon: "SlidersHorizontal", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ===========================================================================
  // Overlays
  // ===========================================================================

  registerCard({
    componentId: "gallery-popover",
    contentFactory: (_cardId) => <GalleryPopover />,
    defaultMeta: { title: "TugPopover", icon: "MessageSquareMore", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-confirm-popover",
    contentFactory: (_cardId) => <GalleryConfirmPopover />,
    defaultMeta: { title: "TugConfirmPopover", icon: "ShieldAlert", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-context-menu",
    contentFactory: (_cardId) => <GalleryContextMenu />,
    defaultMeta: { title: "TugContextMenu", icon: "MousePointer2", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-tooltip",
    contentFactory: (_cardId) => <GalleryTooltip />,
    defaultMeta: { title: "TugTooltip", icon: "MessageSquare", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-sheet",
    contentFactory: (_cardId) => <GallerySheet />,
    defaultMeta: { title: "TugSheet", icon: "PanelTopOpen", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-alert",
    contentFactory: (_cardId) => <GalleryAlert />,
    defaultMeta: { title: "TugAlert", icon: "AlertCircle", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ===========================================================================
  // Feedback & Status
  // ===========================================================================

  registerCard({
    componentId: "gallery-progress",
    contentFactory: (_cardId) => <GalleryProgress />,
    defaultMeta: { title: "TugProgress", icon: "Activity", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-badge",
    contentFactory: (_cardId) => <GalleryBadge />,
    defaultMeta: { title: "TugBadge", icon: "Tag", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-banner",
    contentFactory: (_cardId) => <GalleryBanner />,
    defaultMeta: { title: "TugBanner", icon: "AlertTriangle", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-bulletin",
    contentFactory: (_cardId) => <GalleryBulletin />,
    defaultMeta: { title: "TugBulletin", icon: "Bell", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-skeleton",
    contentFactory: (_cardId) => <GallerySkeleton />,
    defaultMeta: { title: "TugSkeleton", icon: "Loader", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-marquee",
    contentFactory: (_cardId) => <GalleryMarquee />,
    defaultMeta: { title: "TugMarquee", icon: "MoveHorizontal", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ===========================================================================
  // Layout & Structure
  // ===========================================================================

  registerCard({
    componentId: "gallery-box",
    contentFactory: (_cardId) => <GalleryBox />,
    defaultMeta: { title: "TugBox", icon: "Box", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-atom",
    contentFactory: (_cardId) => <GalleryAtom />,
    defaultMeta: { title: "TugAtom", icon: "AtSign", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-accordion",
    contentFactory: (_cardId) => <GalleryAccordion />,
    defaultMeta: { title: "TugAccordion", icon: "ChevronDown", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-separator",
    contentFactory: (_cardId) => <GallerySeparator />,
    defaultMeta: { title: "TugSeparator", icon: "Minus", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-tabbar",
    contentFactory: (_cardId) => <GalleryTabBar />,
    defaultMeta: { title: "TugTabBar", icon: "PanelTop", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-title-bar",
    contentFactory: (_cardId) => <GalleryTitleBar />,
    defaultMeta: { title: "TugTitleBar", icon: "PanelTop", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ===========================================================================
  // Animation & Theming
  // ===========================================================================

  registerCard({
    componentId: "gallery-animator",
    contentFactory: (_cardId) => <GalleryAnimator />,
    defaultMeta: { title: "TugAnimator", icon: "Play", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-scale-timing",
    contentFactory: (_cardId) => <GalleryScaleTiming />,
    defaultMeta: { title: "Scale & Timing", icon: "SlidersHorizontal", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-palette",
    contentFactory: (_cardId) => <GalleryPalette />,
    defaultMeta: { title: "Palette Engine", icon: "Palette", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-theme-generator",
    contentFactory: (_cardId) => <GalleryThemeGenerator />,
    defaultMeta: { title: "Theme Accessibility", icon: "Paintbrush", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // ===========================================================================
  // Architecture
  // ===========================================================================

  registerCard({
    componentId: "gallery-mutation",
    contentFactory: (_cardId) => <GalleryMutation />,
    defaultMeta: { title: "Mutation Model", icon: "GitBranch", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-mutation-tx",
    contentFactory: (_cardId) => <GalleryMutationTx />,
    defaultMeta: { title: "Mutation Transactions", icon: "Layers", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  // The cardId is passed through to GalleryObservableProps so inspector
  // controls can direct setProperty actions to the correct Tugcard responder
  // node via sendToTarget. [D04] Spec S07 (#s07-gallery-demo)
  registerCard({
    componentId: "gallery-observable-props",
    contentFactory: (cardId) => <GalleryObservableProps cardId={cardId} />,
    defaultMeta: { title: "Observable Props", icon: "SlidersHorizontal", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

  registerCard({
    componentId: "gallery-chain-actions",
    contentFactory: (_cardId) => <GalleryChainActions />,
    defaultMeta: { title: "Chain Actions", icon: "Zap", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });

}

// Re-export GalleryMutationTx so tests can import it from either location.
export { GalleryMutationTx };
