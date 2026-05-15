/**
 * Gallery card registrations.
 *
 * Registers all twenty-three gallery card types in the global card registry.
 * Also exports GALLERY_DEFAULT_CARDS and small adapter components.
 *
 * **Authoritative references:**
 * - [D01] Seven separate componentIds for gallery sections
 * - [D08] Normal tabs: each section is a distinct componentId
 * - [D09] Every registration has a contentFactory
 * - [D06] Gallery palette tab follows existing gallery card pattern
 * -: Gallery registrations
 * -: Gallery default tabs
 * - (#s03-gallery-registrations, #s04-gallery-default-tabs, #symbol-inventory)
 *
 * @module components/tugways/cards/gallery-registrations
 */

import React, { useId, useState } from "react";
import { Star } from "lucide-react";
import { registerCard, type CardSizePolicy } from "@/card-registry";
import { TugBadge } from "@/components/tugways/tug-badge";
import type { TugBadgeEmphasis, TugBadgeRole, TugBadgeSize } from "@/components/tugways/tug-badge";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import type { TugPopupButtonItem } from "@/components/tugways/tug-popup-button";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import type { CardState } from "@/layout-tree";
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
import { GalleryIconButton } from "./gallery-icon-button";
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
import { GalleryCardBanner } from "./gallery-card-banner";
import { GalleryAlert } from "./gallery-alert";
import { GalleryTugInlineDialog } from "./gallery-tug-inline-dialog";
import { GalleryTugDialogButton } from "./gallery-tug-dialog-button";
import { GallerySheet } from "./gallery-sheet";
import { GalleryBulletin } from "./gallery-bulletin";
import { GalleryMarkdownView } from "./gallery-markdown-view";
import { GalleryListView } from "./gallery-list-view";
import { GalleryListViewFilter } from "./gallery-list-view-filter";
import { GalleryListViewHeaders } from "./gallery-list-view-headers";
import { GalleryTranscriptEntry } from "./gallery-transcript-entry";
import { GalleryAtom } from "./gallery-atom";
import { GalleryPromptEntry } from "./gallery-prompt-entry";
import { GalleryTextEditor } from "./gallery-text-editor";
import { GallerySplitPane } from "./gallery-split-pane";
import { GalleryStatePreservation } from "./gallery-state-preservation";
import { GalleryTugCue } from "./gallery-tug-cue";
import {
  GalleryBashToolBlock,
  GalleryBashMountInSavedState,
} from "./gallery-bash-tool-block";
import { GalleryPinnedHeaders } from "./gallery-pinned-headers";
import { GalleryTideThinking } from "./gallery-tide-thinking";
import { GalleryJsonTreeBlock } from "./gallery-json-tree-block";
import { GalleryToolBlockFile } from "./gallery-tool-block-file";
import { GalleryToolBlockDefault } from "./gallery-tool-block-default";
import "./gallery.css";
import { TUG_ACTIONS } from "../action-vocabulary";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// GALLERY_DEFAULT_CARDS
// ---------------------------------------------------------------------------

/**
 * Default card templates for the gallery host stack.
 *
 * Only `gallery-buttons` uses these — passed as `defaultCards` so that
 * `addCard("gallery-buttons")` creates a starter stack with one card from
 * each of the first four `+` menu groups (Buttons, Text Input & Display,
 * Selection, Overlays). The remaining component demos are still discoverable
 * via the `+` type picker. Template `id` values are placeholders:
 * `DeckManager.addCard` replaces them with fresh UUIDs.
 */
export const GALLERY_DEFAULT_CARDS: readonly CardState[] = [
  { id: "template", componentId: "gallery-buttons",  title: "TugPushButton", closable: true },
  { id: "template", componentId: "gallery-input",    title: "TugInput",      closable: true },
  { id: "template", componentId: "gallery-checkbox", title: "TugCheckbox",   closable: true },
  { id: "template", componentId: "gallery-popover",  title: "TugPopover",    closable: true },
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
// ---------------------------------------------------------------------------
// Gallery size policies
// ---------------------------------------------------------------------------

/** Component Gallery (multi-tab entry point): large enough to show content. */
const GALLERY_ENTRY_SIZE: CardSizePolicy = {
  min: { width: 450, height: 350 },
  preferred: { width: 900, height: 720 },
};

/** Standard gallery component card (most variant grids, form demos). */
const GALLERY_COMPONENT_SIZE: CardSizePolicy = {
  min: { width: 300, height: 250 },
  preferred: { width: 500, height: 400 },
};

/** Complex gallery cards (palette, theme generator, animator, markdown, sheet). */
const GALLERY_COMPLEX_SIZE: CardSizePolicy = {
  min: { width: 400, height: 350 },
  preferred: { width: 640, height: 520 },
};

/**
 * Must be called before `DeckManager.addCard("gallery-buttons")` is invoked.
 * In `main.tsx`, call this before constructing the DeckManager.
 *
 * Each gallery card type:
 * - `family: "developer"` -- appears only in developer-family type pickers
 * - `acceptsFamilies: ["developer"]` -- type picker shows only developer cards
 * - `closable: true` -- gallery cards can be closed and re-added via [+]
 *
 * Only `gallery-buttons` has `defaultCards` and `defaultTitle`:
 * - `defaultCards: GALLERY_DEFAULT_CARDS` -- seeds the gallery stack with one
 *    card from each of the first four `+` menu groups
 * - `defaultTitle: "Component Gallery"` -- card header prefix
 *
 * **Authoritative reference:** (#s03-gallery-registrations), [D06]
 */
/**
 * Category declarations for the [+] type picker. Each gallery card
 * registration passes one of these as its `category` field. TugTabBar
 * groups registrations by `category.label` in first-encountered order —
 * there is no hardcoded list of component IDs in the tab bar anymore.
 */
const CATEGORIES = {
  buttons: { label: "Buttons", icon: "MousePointerClick" },
  textInput: { label: "Text Input & Display", icon: "TextCursorInput" },
  blockRenderers: { label: "Block Renderers", icon: "Blocks" },
  selection: { label: "Selection", icon: "CheckSquare" },
  overlays: { label: "Overlays", icon: "MessageSquareMore" },
  feedback: { label: "Feedback & Status", icon: "Activity" },
  layout: { label: "Layout & Structure", icon: "Box" },
  animation: { label: "Animation & Theming", icon: "Play" },
  architecture: { label: "Architecture", icon: "GitBranch" },
} as const;

export function registerGalleryCards(): void {

  // ===========================================================================
  // Buttons
  // ===========================================================================

  // gallery-buttons (entry-point: carries defaultCards + defaultTitle)
  registerCard({
    componentId: "gallery-buttons",
    contentFactory: (_cardId) => <GalleryPushButton />,
    defaultMeta: { title: "TugPushButton", icon: "MousePointerClick", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    defaultCards: GALLERY_DEFAULT_CARDS,
    defaultTitle: "Component Gallery",
    sizePolicy: GALLERY_ENTRY_SIZE,
    category: CATEGORIES.buttons,
  });

  registerCard({
    componentId: "gallery-default-button",
    contentFactory: (_cardId) => <GalleryDefaultButton />,
    defaultMeta: { title: "TugDefaultButton", icon: "CornerDownLeft", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.buttons,
  });

  registerCard({
    componentId: "gallery-popup-button",
    contentFactory: (_cardId) => <GalleryPopupButton />,
    defaultMeta: { title: "TugPopupButton", icon: "ChevronDown", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.buttons,
  });

  registerCard({
    componentId: "gallery-icon-button",
    contentFactory: (_cardId) => <GalleryIconButton />,
    defaultMeta: { title: "TugIconButton", icon: "MousePointer2", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.buttons,
  });

  // Design exploration for `TugCue` — the upcoming public component for
  // "soft inline banner that's also a click target." Six prototype
  // variants; user vets before the production component ships.
  registerCard({
    componentId: "gallery-tug-cue",
    contentFactory: (_cardId) => <GalleryTugCue />,
    defaultMeta: { title: "TugCue", icon: "Lightbulb", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.buttons,
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
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.textInput,
  });

  registerCard({
    componentId: "gallery-value-input",
    contentFactory: (_cardId) => <GalleryValueInput />,
    defaultMeta: { title: "TugValueInput", icon: "Hash", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.textInput,
  });

  registerCard({
    componentId: "gallery-textarea",
    contentFactory: (_cardId) => <GalleryTextarea />,
    defaultMeta: { title: "TugTextarea", icon: "TextAlignStart", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.textInput,
  });

  registerCard({
    componentId: "gallery-prompt-entry",
    contentFactory: (cardId) => <GalleryPromptEntry cardId={cardId} />,
    defaultMeta: { title: "TugPromptEntry", icon: "MessageSquareText", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.textInput,
    engineKind: "em",
  });

  registerCard({
    componentId: "gallery-text-editor",
    contentFactory: (cardId) => <GalleryTextEditor cardId={cardId} />,
    defaultMeta: { title: "TugTextEditor", icon: "TextCursorInput", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.textInput,
    engineKind: "em",
  });

  registerCard({
    componentId: "gallery-label",
    contentFactory: (_cardId) => <GalleryLabel />,
    defaultMeta: { title: "TugLabel", icon: "Type", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.textInput,
  });

  registerCard({
    componentId: "gallery-markdown-view",
    contentFactory: (_cardId) => <GalleryMarkdownView />,
    defaultMeta: { title: "TugMarkdownView", icon: "FileText", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.textInput,
  });

  // Pre-baked variant: mounts with 50KB of static markdown loaded
  // immediately. Used by [AT0014] / [AT0023] harness tests
  // for predictable scrollable content; useful as a manual
  // theme-debug fixture too. Same component code, distinct id.
  registerCard({
    componentId: "gallery-markdown-50kb",
    contentFactory: (_cardId) => <GalleryMarkdownView staticContentSize="50kb" />,
    defaultMeta: { title: "TugMarkdownView (50KB)", icon: "FileText", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.textInput,
  });

  // Pre-baked variant: mounts with 1KB of static markdown — small
  // enough that all blocks fit in one viewport, so block-container
  // children render fully and are stable across re-mount. Used by
  // the cold-boot selection harness test where deterministic
  // anchor paths matter; the 50KB variant exercises the
  // virtualization-aware path separately.
  registerCard({
    componentId: "gallery-markdown-1kb",
    contentFactory: (_cardId) => <GalleryMarkdownView staticContentSize="1kb" />,
    defaultMeta: { title: "TugMarkdownView (1KB)", icon: "FileText", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.textInput,
  });

  registerCard({
    componentId: "gallery-transcript-entry",
    contentFactory: (_cardId) => <GalleryTranscriptEntry />,
    defaultMeta: { title: "TugTranscriptEntry", icon: "MessagesSquare", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.textInput,
  });

  registerCard({
    componentId: "gallery-list-view",
    contentFactory: (_cardId) => <GalleryListView />,
    defaultMeta: { title: "TugListView", icon: "List", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.textInput,
  });

  // Companion to `gallery-list-view`: same dataset, but the inner
  // `TugListView` carries `scrollKey="gallery-list-view-scroll"` so
  // the [A9] region-scroll axis captures the list's position into
  // `bag.regionScroll`, AND mounts in `inline` mode (every cell in
  // the DOM, no windowing) to mirror the tide-card transcript
  // configuration. The region-scroll-anchor app-tests
  // (`at0059-region-scroll-anchor-save.test.ts`,
  // `at0060-tide-card-content-settled.test.ts`,
  // `at0061-region-scroll-anchor-apply.test.ts`) drive this card.
  registerCard({
    componentId: "gallery-list-view-scroll-keyed",
    contentFactory: (_cardId) => (
      <GalleryListView
        scrollKey="gallery-list-view-scroll"
        inline
        disableStreaming
      />
    ),
    defaultMeta: {
      title: "TugListView (scroll-keyed)",
      icon: "List",
      closable: true,
    },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.textInput,
  });

  // Visual smoke for `TugListView`'s row-role feature
  // (`roleForIndex` → `data-list-cell-role` + `tabIndex={-1}` +
  // `onSelect` gating). Companion to `gallery-list-view` above:
  // that card exercises mutation, streaming, and windowing; this
  // one scopes to the role contract introduced by Phase 0 of
  // `tugplan-tide-picker-redesign`.
  registerCard({
    componentId: "gallery-list-view-headers",
    contentFactory: (_cardId) => <GalleryListViewHeaders />,
    defaultMeta: { title: "TugListView (headers)", icon: "List", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.textInput,
  });

  // Visual smoke for `useFilteredDataSource` — the Phase 1
  // UISearchController-style decorator hook. A `TugInput` above the
  // list view drives a substring predicate; the host owns the input
  // and the primitive consumes the derived data source.
  registerCard({
    componentId: "gallery-list-view-filter",
    contentFactory: (_cardId) => <GalleryListViewFilter />,
    defaultMeta: { title: "TugListView (filter)", icon: "Search", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.textInput,
  });

  // ===========================================================================
  // Block Renderers
  //
  // Tide assistant-rendering surfaces: the body kinds, tool wrappers,
  // and chrome that render a transcript's tool calls and reasoning.
  // Registered in alphabetical order by display title so the [+]
  // picker reads predictably.
  // ===========================================================================

  // Visual fixture for the smart-pick routing inside BashToolBlock:
  // echo (TerminalBlock) vs git show / git diff (DiffBlock) vs git status
  // (TerminalBlock again, must not false-positive).
  registerCard({
    componentId: "gallery-bash-tool-block",
    contentFactory: (_cardId) => <GalleryBashToolBlock />,
    defaultMeta: { title: "BashToolBlock", icon: "Terminal", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.blockRenderers,
  });

  // Mount-in-saved-state fixture: a long-stdout BashToolBlock that
  // engages both the fold axis (TerminalBlock collapsed/expanded via
  // `bag.components`) and the inner-scroll axis (virtualized scroller
  // via `bag.regionScroll`). Drives
  // `tests/app-test/at0067-bash-block-mount-in-saved-state.test.ts`
  // and `tests/app-test/at0068-bash-block-inner-scroll-from-creation.test.ts`.
  // See `tuglaws/state-preservation.md` → "Restoring saved state at
  // mount".
  registerCard({
    componentId: "gallery-bash-mount-in-saved-state",
    contentFactory: (_cardId) => <GalleryBashMountInSavedState />,
    defaultMeta: {
      title: "BashToolBlock — Mount-in-saved-state",
      icon: "Terminal",
      closable: true,
    },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.blockRenderers,
  });

  // DefaultToolWrapper — the [D11] fallback for tool calls with no
  // bespoke wrapper: unknown tools (with a caution badge) and
  // audit-confirmed long-tail tools.
  registerCard({
    componentId: "gallery-tool-block-default",
    contentFactory: (_cardId) => <GalleryToolBlockDefault />,
    defaultMeta: { title: "DefaultToolWrapper", icon: "Wrench", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.blockRenderers,
  });

  // File tool wrappers — ReadToolBlock + EditToolBlock side by side.
  registerCard({
    componentId: "gallery-tool-block-file",
    contentFactory: (_cardId) => <GalleryToolBlockFile />,
    defaultMeta: { title: "File Tool Wrappers", icon: "Files", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.blockRenderers,
  });

  // JsonTreeBlock — the collapsible JSON body kind, standalone.
  registerCard({
    componentId: "gallery-json-tree-block",
    contentFactory: (_cardId) => <GalleryJsonTreeBlock />,
    defaultMeta: { title: "JsonTreeBlock", icon: "Braces", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.blockRenderers,
  });

  // Diagnostic fixture for the body-kind pinned-header behavior:
  // three standalone body kinds (FileBlock / DiffBlock / TerminalBlock)
  // inside their own fixed-height scroll wrappers, deliberately
  // detached from the transcript chain so the binding scrollport is
  // unambiguous.
  registerCard({
    componentId: "gallery-pinned-headers",
    contentFactory: (_cardId) => <GalleryPinnedHeaders />,
    defaultMeta: { title: "Pinned Headers (diagnostic)", icon: "Pin", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.blockRenderers,
  });

  // TideThinkingBlock — the inline collapsible reasoning chrome.
  registerCard({
    componentId: "gallery-tide-thinking",
    contentFactory: (_cardId) => <GalleryTideThinking />,
    defaultMeta: { title: "TideThinkingBlock", icon: "Brain", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.blockRenderers,
  });

  // ===========================================================================
  // Selection
  // ===========================================================================

  registerCard({
    componentId: "gallery-checkbox",
    contentFactory: (_cardId) => <GalleryCheckbox />,
    defaultMeta: { title: "TugCheckbox", icon: "SquareCheck", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.selection,
  });

  registerCard({
    componentId: "gallery-switch",
    contentFactory: (_cardId) => <GallerySwitch />,
    defaultMeta: { title: "TugSwitch", icon: "ToggleRight", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.selection,
  });

  registerCard({
    componentId: "gallery-radio-group",
    contentFactory: (_cardId) => <GalleryRadioGroup />,
    defaultMeta: { title: "TugRadioGroup", icon: "CircleDot", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.selection,
  });

  registerCard({
    componentId: "gallery-choice-group",
    contentFactory: (_cardId) => <GalleryChoiceGroup />,
    defaultMeta: { title: "TugChoiceGroup", icon: "ToggleLeft", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.selection,
  });

  registerCard({
    componentId: "gallery-option-group",
    contentFactory: (_cardId) => <GalleryOptionGroup />,
    defaultMeta: { title: "TugOptionGroup", icon: "ToggleLeft", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.selection,
  });

  registerCard({
    componentId: "gallery-slider",
    contentFactory: (_cardId) => <GallerySlider />,
    defaultMeta: { title: "TugSlider", icon: "SlidersHorizontal", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.selection,
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
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.overlays,
  });

  registerCard({
    componentId: "gallery-confirm-popover",
    contentFactory: (_cardId) => <GalleryConfirmPopover />,
    defaultMeta: { title: "TugConfirmPopover", icon: "ShieldAlert", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.overlays,
  });

  registerCard({
    componentId: "gallery-context-menu",
    contentFactory: (_cardId) => <GalleryContextMenu />,
    defaultMeta: { title: "TugContextMenu", icon: "MousePointer2", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.overlays,
  });

  registerCard({
    componentId: "gallery-tooltip",
    contentFactory: (_cardId) => <GalleryTooltip />,
    defaultMeta: { title: "TugTooltip", icon: "MessageSquare", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.overlays,
  });

  registerCard({
    componentId: "gallery-sheet",
    contentFactory: (_cardId) => <GallerySheet />,
    defaultMeta: { title: "TugSheet", icon: "PanelTopOpen", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.overlays,
  });

  registerCard({
    componentId: "gallery-alert",
    contentFactory: (_cardId) => <GalleryAlert />,
    defaultMeta: { title: "TugAlert", icon: "CircleAlert", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.overlays,
  });

  registerCard({
    componentId: "gallery-tug-inline-dialog",
    contentFactory: (_cardId) => <GalleryTugInlineDialog />,
    defaultMeta: {
      title: "TugInlineDialog",
      icon: "ShieldAlert",
      closable: true,
    },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.overlays,
  });

  registerCard({
    componentId: "gallery-tug-dialog-button",
    contentFactory: (_cardId) => <GalleryTugDialogButton />,
    defaultMeta: {
      title: "TugDialogButton",
      icon: "MousePointerClick",
      closable: true,
    },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.overlays,
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
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.feedback,
  });

  registerCard({
    componentId: "gallery-badge",
    contentFactory: (_cardId) => <GalleryBadge />,
    defaultMeta: { title: "TugBadge", icon: "Tag", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.feedback,
  });

  registerCard({
    componentId: "gallery-banner",
    contentFactory: (_cardId) => <GalleryBanner />,
    defaultMeta: { title: "TugBanner", icon: "TriangleAlert", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.feedback,
  });

  registerCard({
    componentId: "gallery-card-banner",
    contentFactory: (_cardId) => <GalleryCardBanner />,
    defaultMeta: { title: "TugPaneBanner", icon: "CircleAlert", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.feedback,
  });

  registerCard({
    componentId: "gallery-bulletin",
    contentFactory: (_cardId) => <GalleryBulletin />,
    defaultMeta: { title: "TugBulletin", icon: "Bell", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.feedback,
  });

  registerCard({
    componentId: "gallery-skeleton",
    contentFactory: (_cardId) => <GallerySkeleton />,
    defaultMeta: { title: "TugSkeleton", icon: "Loader", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.feedback,
  });

  registerCard({
    componentId: "gallery-marquee",
    contentFactory: (_cardId) => <GalleryMarquee />,
    defaultMeta: { title: "TugMarquee", icon: "MoveHorizontal", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.feedback,
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
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.layout,
  });

  registerCard({
    componentId: "gallery-atom",
    contentFactory: (_cardId) => <GalleryAtom />,
    defaultMeta: { title: "TugAtom", icon: "AtSign", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.layout,
  });

  registerCard({
    componentId: "gallery-accordion",
    contentFactory: (_cardId) => <GalleryAccordion />,
    defaultMeta: { title: "TugAccordion", icon: "ChevronDown", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.layout,
  });

  registerCard({
    componentId: "gallery-split-pane",
    contentFactory: (_cardId) => <GallerySplitPane />,
    defaultMeta: { title: "TugSplitPane", icon: "Rows2", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.layout,
  });

  registerCard({
    componentId: "gallery-separator",
    contentFactory: (_cardId) => <GallerySeparator />,
    defaultMeta: { title: "TugSeparator", icon: "Minus", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.layout,
  });

  registerCard({
    componentId: "gallery-tabbar",
    contentFactory: (_cardId) => <GalleryTabBar />,
    defaultMeta: { title: "TugTabBar", icon: "PanelTop", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.layout,
  });

  registerCard({
    componentId: "gallery-title-bar",
    contentFactory: (_cardId) => <GalleryTitleBar />,
    defaultMeta: { title: "TugTitleBar", icon: "PanelTop", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.layout,
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
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.animation,
  });

  registerCard({
    componentId: "gallery-scale-timing",
    contentFactory: (_cardId) => <GalleryScaleTiming />,
    defaultMeta: { title: "Scale & Timing", icon: "SlidersHorizontal", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.animation,
  });

  registerCard({
    componentId: "gallery-palette",
    contentFactory: (_cardId) => <GalleryPalette />,
    defaultMeta: { title: "Palette Engine", icon: "Palette", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.animation,
  });

  registerCard({
    componentId: "gallery-theme-generator",
    contentFactory: (_cardId) => <GalleryThemeGenerator />,
    defaultMeta: { title: "Theme Accessibility", icon: "Paintbrush", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.animation,
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
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.architecture,
  });

  registerCard({
    componentId: "gallery-mutation-tx",
    contentFactory: (_cardId) => <GalleryMutationTx />,
    defaultMeta: { title: "Mutation Transactions", icon: "Layers", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPLEX_SIZE,
    category: CATEGORIES.architecture,
  });

  // The cardId is passed through to GalleryObservableProps so inspector
  // controls can direct setProperty actions to the correct TugPane responder
  // node via sendToTarget. [D04] (#s07-gallery-demo)
  registerCard({
    componentId: "gallery-observable-props",
    contentFactory: (cardId) => <GalleryObservableProps cardId={cardId} />,
    defaultMeta: { title: "Observable Props", icon: "SlidersHorizontal", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.architecture,
  });

  registerCard({
    componentId: "gallery-chain-actions",
    contentFactory: (_cardId) => <GalleryChainActions />,
    defaultMeta: { title: "Chain Actions", icon: "Zap", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.architecture,
  });

  // Canonical manual-verification card for the Component State
  // Preservation Protocol ([D13], [A9]). Every component that opts in
  // should land a new section here so reload / tab-switch / cmd-tab
  // survival is easy to sanity-check by hand.
  registerCard({
    componentId: "gallery-state-preservation",
    contentFactory: (_cardId) => <GalleryStatePreservation />,
    defaultMeta: { title: "State Preservation", icon: "Save", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
    sizePolicy: GALLERY_COMPONENT_SIZE,
    category: CATEGORIES.architecture,
  });

}

// Re-export GalleryMutationTx so tests can import it from either location.
export { GalleryMutationTx };
