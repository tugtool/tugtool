/**
 * DeckManager — canvas-based card renderer.
 *
 * Owns a flat DeckState (array of CardState), renders all cards via a single
 * React root (DeckCanvas), dispatches frames to cards via manager-level fan-out
 * (D10), and implements IDragState for card coupling (D05).
 *
 * In the unified single-root architecture (Step 7):
 * - One React root renders <DevNotificationProvider><DeckCanvas .../></DevNotificationProvider>
 * - DeckCanvas owns CardFrame, TabBar, and card content rendering
 * - DeckManager communicates with DeckCanvas via props (on re-render) and
 *   DeckCanvasHandle (for imperative operations during sash drag)
 * - ReactCardAdapter is a config object; DeckCanvas renders components directly
 *
 * [D01] Flat array replaces tree
 * [D04] Unified single React root with DeckCanvas
 * [D06] Key panel focus model with title bar tint
 * [D10] Manager-level fan-out per feed ID
 */

import { IDragState } from "./drag-state";
import { type DeckState, type CardState, type TabItem } from "./layout-tree";
import { buildDefaultLayout, serialize, deserialize } from "./serialization";
import { TugCard } from "./cards/card";
import type { TugCardMeta } from "./cards/card";
import { CARD_TITLES } from "./card-titles";
import { FeedId, FeedIdValue } from "./protocol";
import { TugConnection } from "./connection";
import React from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { DeckCanvas, type DeckCanvasHandle, type CardConfig, type CanvasCallbacks } from "./components/chrome/deck-canvas";
import { DevNotificationProvider, type DevNotificationRef } from "./contexts/dev-notification-context";
import { computeSnap, computeResizeSnap, computeEdgeVisibility, cardToRect, findSharedEdges, computeSets, SNAP_VISIBILITY_THRESHOLD, type Rect, type GuidePosition, type CardSet, type SharedEdge, type EdgeValidator } from "./snap";
import { CARD_TITLE_BAR_HEIGHT } from "./components/chrome/card-frame";
import type { DockCallbacks } from "./components/chrome/dock";

/** localStorage key for layout persistence */
const LAYOUT_STORAGE_KEY = "tugdeck-layout";

/** Debounce delay for saving layout (ms) */
const SAVE_DEBOUNCE_MS = 500;

/**
 * Output feed IDs that cards subscribe to.
 * We register exactly ONE callback per output feedId with the connection (D10).
 * Input feedIds (TERMINAL_INPUT, TERMINAL_RESIZE, CODE_INPUT, HEARTBEAT)
 * are excluded — only the cards/connection themselves write to those.
 */
const OUTPUT_FEED_IDS: FeedIdValue[] = [
  FeedId.TERMINAL_OUTPUT,
  FeedId.FILESYSTEM,
  FeedId.GIT,
  FeedId.STATS,
  FeedId.STATS_PROCESS_INFO,
  FeedId.STATS_TOKEN_USAGE,
  FeedId.STATS_BUILD_STATUS,
  FeedId.CODE_OUTPUT,
];

/**
 * Map componentId to a display title for new TabItems.
 */
function titleForComponent(componentId: string): string {
  return CARD_TITLES[componentId] ?? componentId;
}

export class DeckManager implements IDragState {
  private container: HTMLElement;
  private connection: TugConnection;

  /** Current canvas state (flat array of panels) */
  private deckState: DeckState;

  /** D10: one Set<TugCard> per output feedId */
  private cardsByFeed: Map<FeedIdValue, Set<TugCard>> = new Map();

  /** Most recent payload per feed, replayed to newly added panels */
  private lastPayload: Map<FeedIdValue, Uint8Array> = new Map();

  /**
   * Registry mapping TabItem.id -> TugCard instance.
   * Used for feedIds tracking and removeCard matching.
   */
  private cardRegistry: Map<string, TugCard> = new Map();

  /** Key panel: only code/terminal panels get title bar tint */
  private keyPanelId: string | null = null;

  /** D05: drag state flag */
  private _isDragging = false;

  /** Debounce timer for layout saves */
  private saveTimer: number | null = null;

  /** Card config objects keyed by componentId. Registered externally by main.ts. */
  private cardConfigs: Map<string, CardConfig> = new Map();

  /** Card factory functions keyed by componentId. Registered externally by main.ts. */
  private cardFactories: Map<string, () => TugCard> = new Map();

  /** Pool of guide line elements: 2 vertical (.snap-guide-line-x) + 2 horizontal (.snap-guide-line-y) */
  private guideElements: HTMLElement[] = [];

  /** Runtime set membership: groups of panels connected by shared edges (D05) */
  private sets: CardSet[] = [];

  /** Current shared edges between panels, computed alongside sets */
  private sharedEdges: SharedEdge[] = [];

  /** Virtual sash DOM elements for shared-edge resize (D04) */
  private sashElements: HTMLElement[] = [];

  /**
   * Transient context for the current set-move drag.
   * Initialized on first onMoving call, cleared in onMoveEnd.
   * D06: topmost-in-Y panel drags the set; others break out.
   */
  private _setMoveContext: {
    panelId: string;
    isTopMost: boolean;
    setMemberIds: string[];
    startPositions: Map<string, { x: number; y: number }>;
  } | null = null;

  /** Set key at drag start (confirmed membership from this.sets). null = not in a set. */
  private _dragInitialSetKey: string | null = null;

  /** Whether break-out flash has already fired during this drag. At most once per drag. */
  private _dragBreakOutFired = false;

  /** Bound keydown handler for panel cycling shortcut */
  private keydownHandler: (e: KeyboardEvent) => void;

  /** Single React root for the entire canvas (DeckCanvas + Dock + overlays) */
  private reactRoot: Root | null = null;

  /** Ref to DeckCanvas imperative handle for feed routing and imperative DOM updates */
  private deckCanvasRef: React.RefObject<DeckCanvasHandle | null>;

  /** Ref to DevNotificationProvider control interface for action-dispatch */
  private devNotificationRef: React.RefObject<DevNotificationRef | null>;

  /** Card metas per tabId, updated via onMetaUpdate callbacks from card components */
  private cardMetas: Map<string, TugCardMeta> = new Map();

  /**
   * Per-panel docked corner masks, keyed by panelId.
   * [TL, TR, BR, BL]: true = rounded, false = square (0px).
   * Computed by updateDockedStyles() from shared edges.
   * Passed as props to DeckCanvas → CardFrame for declarative border-radius.
   */
  private dockedCorners: Map<string, [boolean, boolean, boolean, boolean]> = new Map();

  /**
   * Per-panel position offsets for 1px overlap between docked panels.
   * { dx, dy } applied additively to panel.position in CardFrame render.
   * Computed by updateDockedStyles() from shared edges.
   * Passed as props to DeckCanvas → CardFrame for declarative positioning.
   */
  private positionOffsets: Map<string, { dx: number; dy: number }> = new Map();

  /**
   * Set of panelIds that should be forced to solo (all-rounded) corner appearance.
   * Applied as an override on top of the edge-computed dockedCorners during
   * updateDockedStyles(), so a breaking-out panel immediately shows solo styling
   * even before onMoveEnd updates the formal panel positions.
   * Cleared by onMoveEnd / onResizeEnd via recomputeSets().
   */
  private soloOverridePanels: Set<string> = new Set();

  constructor(container: HTMLElement, connection: TugConnection) {
    this.container = container;
    this.connection = connection;

    // Initialize cardsByFeed sets for all output feedIds (D10)
    for (const feedId of OUTPUT_FEED_IDS) {
      this.cardsByFeed.set(feedId, new Set());
    }

    // Register ONE callback per output feedId with the connection (D10).
    // Route frames to DeckCanvas state via imperative handle.
    for (const feedId of OUTPUT_FEED_IDS) {
      connection.onFrame(feedId, (payload: Uint8Array) => {
        this.lastPayload.set(feedId, payload);
        // Route to DeckCanvas React state (card components receive via context)
        if (this.deckCanvasRef.current) {
          this.deckCanvasRef.current.onFrame(feedId, payload);
        }
      });
    }

    // Preserve existing reconnect-resize behavior
    connection.onOpen(() => this.handleResize());

    // Canvas container needs position:relative for absolutely-positioned children
    container.style.position = "relative";

    // Create guide line element pool (D03: absolutely-positioned divs in canvas container)
    this.createGuideLines();

    // Initialize React root and refs
    this.deckCanvasRef = React.createRef<DeckCanvasHandle | null>();
    this.devNotificationRef = React.createRef<DevNotificationRef | null>();

    // Create the single React root
    this.reactRoot = createRoot(container);

    // Load or build the initial canvas state
    this.deckState = this.loadLayout();

    // Initial render
    this.render();

    // Listen for window resize
    window.addEventListener("resize", () => this.handleResize());

    // Keyboard shortcut: Control+` / Control+~ cycles panel focus
    this.keydownHandler = (e: KeyboardEvent) => this.handleKeyDown(e);
    document.addEventListener("keydown", this.keydownHandler);
  }

  // ---- IDragState ----

  get isDragging(): boolean {
    return this._isDragging;
  }

  // ---- Card Registration ----

  /**
   * Register a card config for a componentId.
   * DeckCanvas uses this config to render the card component directly.
   */
  registerCardConfig(componentId: string, config: CardConfig): void {
    this.cardConfigs.set(componentId, config);
  }

  /**
   * Register a card factory for a componentId.
   * Used by Dock and resetLayout to create new card instances.
   * Also registers the config for DeckCanvas rendering.
   */
  registerCardFactory(componentId: string, factory: () => TugCard): void {
    this.cardFactories.set(componentId, factory);
  }

  /**
   * Register a card config alongside a factory.
   * Call this to supply DeckCanvas with the component config for rendering.
   */
  registerCardConfigAndFactory(componentId: string, config: CardConfig, factory: () => TugCard): void {
    this.cardConfigs.set(componentId, config);
    this.cardFactories.set(componentId, factory);
  }

  /**
   * Register a card with the manager.
   *
   * DeckManager searches canvasState.cards for a panel with a tab whose
   * componentId matches. The card is added to fan-out sets and registered.
   *
   * @param card - The card instance
   * @param componentId - Component identifier (e.g. "code", "terminal")
   */
  addCard(card: TugCard, componentId: string): void {
    // Find the first panel containing a tab with the matching componentId
    let tabItem: TabItem | undefined;
    for (const panel of this.deckState.cards) {
      const found = panel.tabs.find((t) => t.componentId === componentId);
      if (found) {
        tabItem = found;
        break;
      }
    }

    if (!tabItem) {
      console.warn(`DeckManager.addCard: no panel found for componentId "${componentId}"`);
      return;
    }

    // Register in fan-out sets (D10)
    for (const feedId of card.feedIds) {
      const set = this.cardsByFeed.get(feedId as FeedIdValue);
      if (set) {
        set.add(card);
      }
    }

    // Record in registry
    this.cardRegistry.set(tabItem.id, card);

    // Set initial meta from card if available
    if (card.meta) {
      this.cardMetas.set(tabItem.id, card.meta);
    }

    // Replay last frame for each subscribed feed so the card isn't empty
    for (const feedId of card.feedIds) {
      const payload = this.lastPayload.get(feedId as FeedIdValue);
      if (payload && this.deckCanvasRef.current) {
        this.deckCanvasRef.current.onFrame(feedId as FeedIdValue, payload);
      }
    }
  }

  /**
   * Re-render to pick up card meta registered after initial render.
   * Call once after all addCard() calls to ensure menu buttons appear.
   */
  refresh(): void {
    this.render();
  }

  /**
   * Remove a card: removes from fan-out sets, removes its tab from the panel.
   * If the panel is now empty, removes it.
   */
  removeCard(card: TugCard): void {
    // Remove from fan-out sets (D10)
    for (const feedId of card.feedIds) {
      const set = this.cardsByFeed.get(feedId as FeedIdValue);
      if (set) {
        set.delete(card);
      }
    }

    // Find tabItemId for this card
    let tabItemId: string | null = null;
    for (const [id, c] of this.cardRegistry) {
      if (c === card) {
        tabItemId = id;
        break;
      }
    }

    if (tabItemId) {
      this.cardRegistry.delete(tabItemId);
      this.cardMetas.delete(tabItemId);

      // Remove the tab from the panel; remove panel if empty
      this.deckState = {
        cards: this.deckState.cards
          .map((panel) => {
            const newTabs = panel.tabs.filter((t) => t.id !== tabItemId);
            if (newTabs.length === panel.tabs.length) return panel;
            // Tab was in this panel
            const newActiveTabId = newTabs.find((t) => t.id === panel.activeTabId)
              ? panel.activeTabId
              : (newTabs[0]?.id ?? "");
            return { ...panel, tabs: newTabs, activeTabId: newActiveTabId };
          })
          .filter((panel) => panel.tabs.length > 0),
      };
    }

    card.destroy();
    this.render();
    this.scheduleSave();
  }

  // ---- Rendering ----

  /**
   * Re-render the entire canvas via the single React root.
   * All panel geometry, meta, and key-panel state flows through DeckCanvas props.
   *
   * Render order:
   *   1. recomputeSets() — updates this.sets, this.sharedEdges, this.dockedCorners,
   *      this.positionOffsets, and applies normalizeSetPositions() imperatively.
   *   2. reactRoot.render() — React renders with the freshly-computed docked style props.
   */
  private render(): void {
    if (!this.reactRoot) return;

    // Recompute sets and docked corner data before React render so the props
    // passed to DeckCanvas already reflect the current shared-edge topology.
    // normalizeSetPositions() inside recomputeSets() mutates panel element refs
    // imperatively using the panel elements from the previous React render —
    // those refs remain valid across renders until panels are removed.
    this.recomputeSets();

    // Compute key panel if not set
    const panels = this.deckState.cards;
    if (!this.keyPanelId || !panels.find((p) => p.id === this.keyPanelId)) {
      this.keyPanelId = null;
      for (let i = panels.length - 1; i >= 0; i--) {
        if (this.acceptsKey(panels[i].id)) {
          this.keyPanelId = panels[i].id;
          break;
        }
      }
    }

    const canvasCallbacks: CanvasCallbacks = {
      onMoveEnd: (panelId, x, y) => {
        this._isDragging = false;
        this.hideGuides();
        const panel = this.deckState.cards.find((p) => p.id === panelId);
        if (panel) {
          panel.position = { x, y };
        }
        const initialSetKey = this._dragInitialSetKey;
        const breakOutFired = this._dragBreakOutFired;
        this._setMoveContext = null;
        this._dragInitialSetKey = null;
        this._dragBreakOutFired = false;
        // Clear any solo overrides — positions are now final; recomputeSets()
        // inside render() will derive the correct docked corners from shared edges.
        this.soloOverridePanels.clear();
        this.ensureSetAdjacency();
        // Re-render: recomputeSets() runs first inside render(), updating sashes
        // and docked corner props; then React renders with the correct styling.
        this.render();
        // Flash on set creation/growth, or when re-joining after a break-out
        if (panel) {
          const finalSet = this.sets.find((s) => s.cardIds.includes(panelId));
          if (finalSet) {
            const finalSetKey = [...finalSet.cardIds].sort().join(",");
            if (finalSetKey !== initialSetKey || breakOutFired) {
              this.flashPanels(finalSet.cardIds);
            }
          }
        }
        this.scheduleSave();
      },
      onResizeEnd: (panelId, x, y, width, height) => {
        this._isDragging = false;
        this.hideGuides();
        const panel = this.deckState.cards.find((p) => p.id === panelId);
        if (panel) {
          panel.position = { x, y };
          panel.size = { width, height };
          // Notify the active card's resize observer will pick up the new size
        }
        this.soloOverridePanels.clear();
        this.ensureSetAdjacency();
        // Re-render: recomputeSets() runs first inside render(), updating sashes
        // and docked corner props.
        this.render();
        this.scheduleSave();
      },
      onFocus: (panelId, opts) => {
        // Capture set-move context BEFORE focusPanel reorders the panels array.
        const mySet = this.sets.find((s) => s.cardIds.includes(panelId));
        if (mySet) {
          let leaderId: string | null = null;
          let leaderY = Infinity;
          let leaderX = Infinity;
          for (const memberId of mySet.cardIds) {
            const memberPanel = this.deckState.cards.find((p) => p.id === memberId);
            if (!memberPanel) continue;
            if (
              memberPanel.position.y < leaderY ||
              (memberPanel.position.y === leaderY && memberPanel.position.x < leaderX)
            ) {
              leaderY = memberPanel.position.y;
              leaderX = memberPanel.position.x;
              leaderId = memberId;
            }
          }
          const isTopMost = leaderId === panelId;
          const startPositions = new Map<string, { x: number; y: number }>();
          for (const memberId of mySet.cardIds) {
            const memberPanel = this.deckState.cards.find((p) => p.id === memberId);
            if (memberPanel) {
              startPositions.set(memberId, { ...memberPanel.position });
            }
          }
          this._setMoveContext = {
            panelId,
            isTopMost,
            setMemberIds: mySet.cardIds,
            startPositions,
          };
          this._dragInitialSetKey = [...mySet.cardIds].sort().join(",");
        } else {
          this._setMoveContext = null;
          this._dragInitialSetKey = null;
        }
        this._dragBreakOutFired = false;
        // Command+click: move without raising (suppress z-order change)
        if (!opts?.suppressZOrder) {
          this.focusPanel(panelId);
        }
      },
      onClose: (panelId) => {
        const panel = this.deckState.cards.find((p) => p.id === panelId);
        if (panel) {
          const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId);
          if (activeTab) {
            const card = this.cardRegistry.get(activeTab.id);
            if (card) {
              this.removeCard(card);
            } else {
              // No card instance registered (e.g. for pure config-based panels)
              this.removePanelById(panelId);
            }
          }
        }
      },
      onMoving: (panelId, x, y) => {
        this._isDragging = true;

        const panel = this.deckState.cards.find((p) => p.id === panelId);
        if (!panel) return { x, y };

        // Use the context captured in onFocus
        if (this._setMoveContext === null) {
          const startPositions = new Map<string, { x: number; y: number }>();
          startPositions.set(panelId, { ...panel.position });
          this._setMoveContext = {
            panelId,
            isTopMost: false,
            setMemberIds: [],
            startPositions,
          };
        }

        const ctx = this._setMoveContext;

        if (ctx.isTopMost && ctx.setMemberIds.length > 1) {
          // SET-MOVE: move all set members by the same delta (D06).
          const myStart = ctx.startPositions.get(panelId)!;
          const deltaX = x - myStart.x;
          const deltaY = y - myStart.y;

          // Compute proposed positions for all siblings.
          const proposedPositions = new Map<string, { x: number; y: number }>();
          for (const memberId of ctx.setMemberIds) {
            const memberStart = ctx.startPositions.get(memberId)!;
            proposedPositions.set(memberId, {
              x: memberStart.x + deltaX,
              y: memberStart.y + deltaY,
            });
          }

          // Compute set bounding box at proposed positions.
          let bboxLeft = Infinity;
          let bboxTop = Infinity;
          let bboxRight = -Infinity;
          let bboxBottom = -Infinity;
          for (const memberId of ctx.setMemberIds) {
            const proposed = proposedPositions.get(memberId)!;
            const memberPanel = this.deckState.cards.find((p) => p.id === memberId)!;
            bboxLeft = Math.min(bboxLeft, proposed.x);
            bboxTop = Math.min(bboxTop, proposed.y);
            bboxRight = Math.max(bboxRight, proposed.x + memberPanel.size.width);
            bboxBottom = Math.max(bboxBottom, proposed.y + memberPanel.size.height);
          }

          // Snap bounding box against non-set panels with occlusion checking.
          const nonSetPanels = this.deckState.cards.filter(
            (p) => !ctx.setMemberIds.includes(p.id)
          );
          const nonSetRects: Rect[] = nonSetPanels.map((p) => cardToRect(p));

          const setBBox: Rect = {
            x: bboxLeft,
            y: bboxTop,
            width: bboxRight - bboxLeft,
            height: bboxBottom - bboxTop,
          };

          const setMoveZMap = new Map<string, number>();
          this.deckState.cards.forEach((p, idx) => {
            setMoveZMap.set(p.id, 100 + idx);
          });

          const setMoveTargetZ = nonSetPanels.map((p) => setMoveZMap.get(p.id) ?? 0);
          const setMoveExcludeIds = nonSetPanels.map((p) => new Set([p.id]));

          const setMoveValidator = this.buildSnapValidator(
            setBBox,
            setMoveTargetZ,
            setMoveExcludeIds,
            ""
          );

          const snap = computeSnap(setBBox, nonSetRects, setMoveValidator);
          this.showGuides(snap.guides);

          // Apply snap offset to all sibling positions.
          const snapDX = snap.x !== null ? snap.x - setBBox.x : 0;
          const snapDY = snap.y !== null ? snap.y - setBBox.y : 0;

          for (const memberId of ctx.setMemberIds) {
            if (memberId === panelId) continue; // dragged panel handled by CardFrame
            const proposed = proposedPositions.get(memberId)!;
            if (this.deckCanvasRef.current) {
              this.deckCanvasRef.current.updatePanelPosition(
                memberId,
                proposed.x + snapDX,
                proposed.y + snapDY
              );
            }
          }

          const finalX = x + snapDX;
          const finalY = y + snapDY;
          return { x: finalX, y: finalY };
        } else {
          // BREAK-OUT / SOLO: move only this panel; snap against external edges only.
          const others: Rect[] = [];
          const processedSetKeys = new Set<string>();
          const soloTargetZ: number[] = [];
          const soloExcludeIds: Set<string>[] = [];

          const soloZMap = new Map<string, number>();
          this.deckState.cards.forEach((p, idx) => {
            soloZMap.set(p.id, 100 + idx);
          });

          for (const p of this.deckState.cards) {
            if (p.id === panelId) continue;
            const pSet = this.sets.find((s) => s.cardIds.includes(p.id));
            if (pSet) {
              const setKey = [...pSet.cardIds].sort().join(",");
              if (!processedSetKeys.has(setKey)) {
                processedSetKeys.add(setKey);
                const filteredIds = pSet.cardIds.filter((id) => id !== panelId);
                if (filteredIds.length > 0) {
                  others.push(this.computeSetBBox({ cardIds: filteredIds }));
                  soloTargetZ.push(
                    Math.max(...filteredIds.map((id) => soloZMap.get(id) ?? 0))
                  );
                  soloExcludeIds.push(new Set(filteredIds));
                }
              }
            } else {
              others.push(cardToRect(p));
              soloTargetZ.push(soloZMap.get(p.id) ?? 0);
              soloExcludeIds.push(new Set([p.id]));
            }
          }

          const movingRect: Rect = {
            x,
            y,
            width: panel.size.width,
            height: panel.size.height,
          };
          const soloValidator = this.buildSnapValidator(
            movingRect,
            soloTargetZ,
            soloExcludeIds,
            panelId
          );

          const snap = computeSnap(movingRect, others, soloValidator);
          this.showGuides(snap.guides);
          const finalX = snap.x !== null ? snap.x : x;
          const finalY = snap.y !== null ? snap.y : y;
          this.detectDragSetChange(panelId, finalX, finalY, panel.size.width, panel.size.height);
          return { x: finalX, y: finalY };
        }
      },
      onResizing: (panelId, x, y, width, height) => {
        this._isDragging = true;
        const others: Rect[] = this.deckState.cards
          .filter((p) => p.id !== panelId)
          .map((p) => cardToRect(p));
        const resizingEdges = {
          left: x,
          right: x + width,
          top: y,
          bottom: y + height,
        };
        const snap = computeResizeSnap(resizingEdges, others);
        this.showGuides(snap.guides);
        let newX = snap.left !== undefined ? snap.left : x;
        let newY = snap.top !== undefined ? snap.top : y;
        const newRight = snap.right !== undefined ? snap.right : x + width;
        const newBottom = snap.bottom !== undefined ? snap.bottom : y + height;
        let newW = newRight - newX;
        let newH = newBottom - newY;
        const MIN_SIZE = 100;
        if (newW < MIN_SIZE) {
          newW = width;
          newX = x;
        }
        if (newH < MIN_SIZE) {
          newH = height;
          newY = y;
        }
        return { x: newX, y: newY, width: newW, height: newH };
      },
      onTabActivate: (panelId, tabIndex) => {
        const panel = this.deckState.cards.find((p) => p.id === panelId);
        if (panel) {
          this.handleTabActivate(panel, tabIndex);
        }
      },
      onTabClose: (tabId) => {
        this.handleTabClose(tabId);
      },
      onTabReorder: (panelId, fromIndex, toIndex) => {
        const panel = this.deckState.cards.find((p) => p.id === panelId);
        if (panel) {
          this.handleTabReorder(panel, fromIndex, toIndex);
        }
      },
      onMetaUpdate: (tabId, meta) => {
        this.cardMetas.set(tabId, meta);
        // Re-render to update the CardHeader with new meta
        this.render();
      },
      dock: this.buildDockCallbacks(),
    };

    this.reactRoot.render(
      React.createElement(
        DevNotificationProvider,
        { controlRef: this.devNotificationRef },
        React.createElement(DeckCanvas, {
          ref: this.deckCanvasRef,
          panels: this.deckState.cards,
          cardConfigs: this.cardConfigs,
          cardMetas: this.cardMetas,
          keyPanelId: this.keyPanelId,
          canvasEl: this.container,
          callbacks: canvasCallbacks,
          connection: this.connection,
          dragState: this,
          panelDockedCorners: this.dockedCorners,
          panelPositionOffsets: this.positionOffsets,
        })
      )
    );
  }

  /** DockCallbacks for the Dock component rendered inside DeckCanvas. */
  private _dockCallbacks: DockCallbacks | null = null;

  /** Set DockCallbacks from main.tsx (must be called before first render). */
  setDockCallbacks(callbacks: DockCallbacks): void {
    this._dockCallbacks = callbacks;
    // Re-render to pick up the new dock callbacks
    this.render();
  }

  /** Build DockCallbacks for the Dock component rendered inside DeckCanvas. */
  private buildDockCallbacks(): DockCallbacks {
    if (this._dockCallbacks) {
      return this._dockCallbacks;
    }
    // Default callbacks if none set externally
    return {
      onShowCard: (_cardType: string) => {},
      onResetLayout: () => this.resetLayout(),
      onRestartServer: () => this.sendControlFrame("restart"),
      onResetEverything: () => {
        localStorage.clear();
        this.sendControlFrame("reset");
      },
      onReloadFrontend: () => this.sendControlFrame("reload_frontend"),
    };
  }

  /** Set the action dispatch reference from main.tsx (legacy compatibility). */
  setActionDispatch(_dispatch: { dispatchAction: (action: Record<string, unknown>) => void }): void {
    // No-op: use setDockCallbacks instead.
  }

  /**
   * Move the given panel to the end of the panels array (highest z-order),
   * update z-index values, and update key panel state.
   */
  focusPanel(panelId: string): void {
    const idx = this.deckState.cards.findIndex((p) => p.id === panelId);
    if (idx === -1) return;

    // Check if this panel is in a set
    const mySet = this.sets.find((s) => s.cardIds.includes(panelId));

    if (mySet) {
      // Bring entire set to front. Leader = topmost in Y (smallest Y, then X).
      let leaderId = panelId;
      let leaderY = Infinity;
      let leaderX = Infinity;
      for (const id of mySet.cardIds) {
        const p = this.deckState.cards.find((pp) => pp.id === id);
        if (
          p &&
          (p.position.y < leaderY ||
            (p.position.y === leaderY && p.position.x < leaderX))
        ) {
          leaderY = p.position.y;
          leaderX = p.position.x;
          leaderId = id;
        }
      }
      const setMemberIds = new Set(mySet.cardIds);
      const setMembers: CardState[] = [];
      const nonSetMembers: CardState[] = [];
      for (const p of this.deckState.cards) {
        if (setMemberIds.has(p.id)) {
          setMembers.push(p);
        } else {
          nonSetMembers.push(p);
        }
      }
      // Leader goes last among set members
      const leaderPanel = setMembers.find((p) => p.id === leaderId)!;
      const otherSetMembers = setMembers.filter((p) => p.id !== leaderId);
      this.deckState.cards = [...nonSetMembers, ...otherSetMembers, leaderPanel];
    } else {
      // Solo panel: bring to front
      if (idx !== this.deckState.cards.length - 1) {
        const [panel] = this.deckState.cards.splice(idx, 1);
        this.deckState.cards.push(panel);
      }
    }

    // Update z-indices imperatively (no React re-render needed for z-index changes)
    for (let i = 0; i < this.deckState.cards.length; i++) {
      const p = this.deckState.cards[i];
      if (this.deckCanvasRef.current) {
        this.deckCanvasRef.current.updatePanelZIndex(p.id, 100 + i);
      }
    }

    this.scheduleSave();

    // Update key panel: only if the focused panel accepts key
    if (this.acceptsKey(panelId)) {
      this.keyPanelId = panelId;
      // Re-render to apply the key panel tint change
      this.render();
    }

    // Route keyboard focus to the key panel's active card.
    requestAnimationFrame(() => this.focusKeyPanelCard());
  }

  // ---- Tab callbacks ----

  /**
   * Switch the active tab in a panel.
   */
  private handleTabActivate(panel: CardState, newIndex: number): void {
    if (newIndex < 0 || newIndex >= panel.tabs.length) return;

    const newTab = panel.tabs[newIndex];
    if (newTab.id === panel.activeTabId) return;

    // Update panel state
    panel.activeTabId = newTab.id;

    // Re-render to show the new active tab (DeckCanvas handles display toggle)
    this.render();

    this.scheduleSave();
  }

  /**
   * Close a tab: find its card and remove it.
   */
  private handleTabClose(tabId: string): void {
    const card = this.cardRegistry.get(tabId);
    if (card) {
      this.removeCard(card);
    } else {
      // No card instance — remove the tab directly
      this.removeTabById(tabId);
    }
  }

  /**
   * Reorder tabs within a panel.
   */
  private handleTabReorder(panel: CardState, fromIndex: number, toIndex: number): void {
    if (
      fromIndex < 0 ||
      fromIndex >= panel.tabs.length ||
      toIndex < 0 ||
      toIndex >= panel.tabs.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    const [moved] = panel.tabs.splice(fromIndex, 1);
    panel.tabs.splice(toIndex, 0, moved);

    // Re-render to update TabBar
    this.render();

    this.scheduleSave();
  }

  // ---- Public panel management ----

  /**
   * Add a new card instance of the given componentId as a floating panel
   * at the center of the canvas. Called by Dock.
   */
  addNewCard(componentId: string): void {
    const factory = this.cardFactories.get(componentId);
    if (!factory) {
      console.warn(`DeckManager.addNewCard: no factory registered for "${componentId}"`);
      return;
    }

    const canvasW = this.container.clientWidth || 800;
    const canvasH = this.container.clientHeight || 600;
    const PANEL_W = 400;
    const PANEL_H = 300;
    const panelX = Math.max(0, (canvasW - PANEL_W) / 2);
    const panelY = Math.max(0, (canvasH - PANEL_H) / 2);

    const tabId = crypto.randomUUID();
    const newPanel: CardState = {
      id: crypto.randomUUID(),
      position: { x: panelX, y: panelY },
      size: { width: PANEL_W, height: PANEL_H },
      tabs: [
        {
          id: tabId,
          componentId,
          title: titleForComponent(componentId),
          closable: true,
        },
      ],
      activeTabId: tabId,
    };

    this.deckState.cards.push(newPanel);

    // Create card instance and register it for feedId tracking
    const card = factory();
    for (const feedId of card.feedIds) {
      const set = this.cardsByFeed.get(feedId as FeedIdValue);
      if (set) set.add(card);
    }
    this.cardRegistry.set(tabId, card);

    this.render();

    // Replay last frame so the card starts with current data
    for (const feedId of card.feedIds) {
      const payload = this.lastPayload.get(feedId as FeedIdValue);
      if (payload && this.deckCanvasRef.current) {
        this.deckCanvasRef.current.onFrame(feedId as FeedIdValue, payload);
      }
    }

    this.scheduleSave();
  }

  /**
   * Add a new tab to an existing panel (same componentId constraint).
   */
  addNewTab(panelId: string, componentId: string): void {
    const panel = this.deckState.cards.find((p) => p.id === panelId);
    if (!panel) {
      console.warn(`DeckManager.addNewTab: panel "${panelId}" not found`);
      return;
    }

    const existingComponentId = panel.tabs[0]?.componentId;
    if (existingComponentId && existingComponentId !== componentId) {
      console.warn(
        `DeckManager.addNewTab: panel "${panelId}" has componentId "${existingComponentId}", ` +
          `cannot add tab with componentId "${componentId}"`
      );
      return;
    }

    const factory = this.cardFactories.get(componentId);
    if (!factory) {
      console.warn(`DeckManager.addNewTab: no factory for "${componentId}"`);
      return;
    }

    const tabId = crypto.randomUUID();
    const newTab: TabItem = {
      id: tabId,
      componentId,
      title: titleForComponent(componentId),
      closable: true,
    };

    panel.tabs.push(newTab);
    panel.activeTabId = tabId;

    const card = factory();
    for (const feedId of card.feedIds) {
      const set = this.cardsByFeed.get(feedId as FeedIdValue);
      if (set) set.add(card);
    }
    this.cardRegistry.set(tabId, card);

    this.render();

    for (const feedId of card.feedIds) {
      const payload = this.lastPayload.get(feedId as FeedIdValue);
      if (payload && this.deckCanvasRef.current) {
        this.deckCanvasRef.current.onFrame(feedId as FeedIdValue, payload);
      }
    }

    this.scheduleSave();
  }

  /**
   * Find the topmost panel (highest z-index) containing a tab with the given componentId.
   */
  findPanelByComponent(componentId: string): CardState | null {
    for (let i = this.deckState.cards.length - 1; i >= 0; i--) {
      const panel = this.deckState.cards[i];
      if (panel.tabs.some((tab) => tab.componentId === componentId)) {
        return panel;
      }
    }
    return null;
  }

  /**
   * Close the topmost panel containing a tab with the given componentId.
   */
  closePanelByComponent(componentId: string): void {
    const panel = this.findPanelByComponent(componentId);
    if (!panel) return;

    const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId);
    if (activeTab) {
      const card = this.cardRegistry.get(activeTab.id);
      if (card) {
        this.removeCard(card);
      } else {
        this.removePanelById(panel.id);
      }
    }
  }

  /**
   * Remove a panel by ID (when no card instance is registered).
   */
  private removePanelById(panelId: string): void {
    this.deckState = {
      cards: this.deckState.cards.filter((p) => p.id !== panelId),
    };
    this.render();
    this.scheduleSave();
  }

  /**
   * Remove a tab by ID (when no card instance is registered).
   */
  private removeTabById(tabId: string): void {
    this.deckState = {
      cards: this.deckState.cards
        .map((panel) => {
          const newTabs = panel.tabs.filter((t) => t.id !== tabId);
          if (newTabs.length === panel.tabs.length) return panel;
          const newActiveTabId = newTabs.find((t) => t.id === panel.activeTabId)
            ? panel.activeTabId
            : (newTabs[0]?.id ?? "");
          return { ...panel, tabs: newTabs, activeTabId: newActiveTabId };
        })
        .filter((panel) => panel.tabs.length > 0),
    };
    this.render();
    this.scheduleSave();
  }

  /**
   * Destroy all current cards, reset to the default layout, and recreate
   * the default five cards using registered factories.
   */
  resetLayout(): void {
    this.destroyAllCards();
    this.keyPanelId = null;
    this.sets = [];
    this.sharedEdges = [];
    this.destroySashes();
    this._setMoveContext = null;
    this._dragInitialSetKey = null;
    this._dragBreakOutFired = false;

    const canvasW = this.container.clientWidth || 800;
    const canvasH = this.container.clientHeight || 600;
    this.deckState = buildDefaultLayout(canvasW, canvasH);

    this.render();

    const defaults = ["code", "terminal", "git", "files", "stats"];
    for (const componentId of defaults) {
      const factory = this.cardFactories.get(componentId);
      if (!factory) {
        console.warn(`DeckManager.resetLayout: no factory for "${componentId}"`);
        continue;
      }
      const card = factory();
      this.addCard(card, componentId);
    }

    this.scheduleSave();
  }

  /**
   * Send a control frame to the server.
   */
  sendControlFrame(action: string, params?: Record<string, unknown>): void {
    this.connection.sendControlFrame(action, params);
  }

  // ---- Resize Handling ----

  /**
   * Notify all mounted cards of their current container dimensions.
   * Called on reconnect (onOpen) and window resize.
   */
  handleResize(): void {
    // In the unified tree, ResizeObserver in CardContent handles resize.
    // This method is kept for connection.onOpen() callback compatibility.
  }

  // ---- Layout Persistence ----

  private loadLayout(): DeckState {
    try {
      const json = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (json) {
        const canvasWidth = this.container.clientWidth || 800;
        const canvasHeight = this.container.clientHeight || 600;
        return deserialize(json, canvasWidth, canvasHeight);
      }
    } catch (e) {
      console.warn("DeckManager: failed to load layout from localStorage", e);
    }
    const canvasWidth = this.container.clientWidth || 800;
    const canvasHeight = this.container.clientHeight || 600;
    return buildDefaultLayout(canvasWidth, canvasHeight);
  }

  private saveLayout(): void {
    try {
      const serialized = serialize(this.deckState);
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(serialized));
    } catch (e) {
      console.warn("DeckManager: failed to save layout to localStorage", e);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveLayout();
      this.saveTimer = null;
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Apply an external DeckState, re-render, and schedule a save.
   */
  applyLayout(deckState: DeckState): void {
    this.keyPanelId = null;
    this.deckState = deckState;
    this.render();
    this.scheduleSave();
  }

  /** Expose the current canvas state for testing */
  getDeckState(): DeckState {
    return this.deckState;
  }

  /** Expose card registry for testing */
  getCardRegistry(): Map<string, TugCard> {
    return this.cardRegistry;
  }

  /** Expose cardsByFeed for testing */
  getCardsByFeed(): Map<FeedIdValue, Set<TugCard>> {
    return this.cardsByFeed;
  }

  /** Expose the container element (for Dock and other chrome). */
  getContainer(): HTMLElement {
    return this.container;
  }

  /** Expose current panel sets for testing */
  getSets(): CardSet[] {
    return this.sets;
  }

  // ---- Private helpers ----

  /**
   * Recompute panel sets from current panel positions.
   */
  private recomputeSets(): void {
    const panelRects = this.deckState.cards.map((p) => ({
      id: p.id,
      rect: cardToRect(p),
    }));
    const sharedEdges = findSharedEdges(panelRects);
    const cardIds = this.deckState.cards.map((p) => p.id);
    this.sets = computeSets(cardIds, sharedEdges);
    this.sharedEdges = sharedEdges;
    this.normalizeSetPositions();
    this.destroySashes();
    this.createSashes();
    this.updateDockedStyles();
  }

  /**
   * Close small gaps between panels in sets by nudging "B" panels.
   */
  private normalizeSetPositions(): void {
    for (const edge of this.sharedEdges) {
      const panelA = this.deckState.cards.find((p) => p.id === edge.cardAId);
      const panelB = this.deckState.cards.find((p) => p.id === edge.cardBId);
      if (!panelA || !panelB) continue;

      if (edge.axis === "horizontal") {
        const target = panelA.position.y + panelA.size.height;
        if (panelB.position.y !== target) {
          panelB.position.y = target;
          if (this.deckCanvasRef.current) {
            this.deckCanvasRef.current.updatePanelPosition(
              edge.cardBId,
              panelB.position.x,
              panelB.position.y
            );
          }
        }
      } else {
        const target = panelA.position.x + panelA.size.width;
        if (panelB.position.x !== target) {
          panelB.position.x = target;
          if (this.deckCanvasRef.current) {
            this.deckCanvasRef.current.updatePanelPosition(
              edge.cardBId,
              panelB.position.x,
              panelB.position.y
            );
          }
        }
      }
    }
  }

  /**
   * Compute docked corner masks and position offsets from this.sharedEdges and
   * store them in this.dockedCorners / this.positionOffsets.
   *
   * Called by recomputeSets() inside render(). The stored values are passed to
   * DeckCanvas as props → CardFrame props, so border-radius and 1px overlap are
   * applied declaratively — no imperative DOM mutation.
   *
   * Solo overrides (soloOverridePanels): any panel in this set is forced to
   * fully-rounded corners and zero offset regardless of shared edges. Used to
   * immediately show a breaking-out panel as solo during drag, before onMoveEnd
   * updates the formal positions. Cleared when recomputeSets() is next called
   * from a non-drag context (onMoveEnd / onResizeEnd).
   */
  private updateDockedStyles(): void {
    const corners = new Map<string, [boolean, boolean, boolean, boolean]>();
    const offsets = new Map<string, { dx: number; dy: number }>();

    for (const card of this.deckState.cards) {
      corners.set(card.id, [true, true, true, true]);
      offsets.set(card.id, { dx: 0, dy: 0 });
    }

    for (const edge of this.sharedEdges) {
      const cornersA = corners.get(edge.cardAId);
      const cornersB = corners.get(edge.cardBId);
      const offsetB = offsets.get(edge.cardBId);
      if (!cornersA || !cornersB || !offsetB) continue;

      if (edge.axis === "horizontal") {
        cornersA[2] = false; // BR
        cornersA[3] = false; // BL
        cornersB[0] = false; // TL
        cornersB[1] = false; // TR
        offsetB.dy = -1;
      } else {
        cornersA[1] = false; // TR
        cornersA[2] = false; // BR
        cornersB[0] = false; // TL
        cornersB[3] = false; // BL
        offsetB.dx = -1;
      }
    }

    // Apply solo overrides: force breaking-out panels to fully-rounded appearance.
    for (const panelId of this.soloOverridePanels) {
      corners.set(panelId, [true, true, true, true]);
      offsets.set(panelId, { dx: 0, dy: 0 });
    }

    // Store computed values. The enclosing render() passes them to DeckCanvas.
    this.dockedCorners = corners;
    this.positionOffsets = offsets;
  }

  /** Create the pool of 4 guide line elements appended to the canvas container. */
  private createGuideLines(): void {
    const classes = [
      "snap-guide-line snap-guide-line-x",
      "snap-guide-line snap-guide-line-x",
      "snap-guide-line snap-guide-line-y",
      "snap-guide-line snap-guide-line-y",
    ];
    for (const cls of classes) {
      const el = document.createElement("div");
      el.className = cls;
      this.container.appendChild(el);
      this.guideElements.push(el);
    }
  }

  /**
   * Show guide lines at the specified positions.
   */
  private showGuides(guides: GuidePosition[]): void {
    const xGuides = guides.filter((g) => g.axis === "x");
    const yGuides = guides.filter((g) => g.axis === "y");
    for (let i = 0; i < 2; i++) {
      const el = this.guideElements[i];
      if (i < xGuides.length) {
        el.style.left = `${xGuides[i].position}px`;
        el.style.display = "block";
      } else {
        el.style.display = "none";
      }
    }
    for (let i = 0; i < 2; i++) {
      const el = this.guideElements[i + 2];
      if (i < yGuides.length) {
        el.style.top = `${yGuides[i].position}px`;
        el.style.display = "block";
      } else {
        el.style.display = "none";
      }
    }
  }

  /** Hide all guide line elements. */
  private hideGuides(): void {
    for (const el of this.guideElements) {
      el.style.display = "none";
    }
  }

  /**
   * Build an EdgeValidator for occlusion-aware snapping.
   */
  private buildSnapValidator(
    movingRect: Rect,
    targetZIndices: number[],
    targetExcludeIds: Set<string>[],
    excludePanelId: string
  ): EdgeValidator {
    const zMap = new Map<string, number>();
    this.deckState.cards.forEach((p, i) => {
      zMap.set(p.id, 100 + i);
    });

    const allOccluders: { rect: Rect; zIndex: number; id: string }[] = [];
    for (const p of this.deckState.cards) {
      if (p.id === excludePanelId) continue;
      allOccluders.push({ rect: cardToRect(p), zIndex: zMap.get(p.id) ?? 0, id: p.id });
    }

    const targetOccluders: Rect[][] = targetZIndices.map((tZ, idx) => {
      const excludeIds = targetExcludeIds[idx];
      return allOccluders
        .filter((op) => op.zIndex > tZ && !excludeIds.has(op.id))
        .map((op) => op.rect);
    });

    return (
      axis: "x" | "y",
      edgePosition: number,
      targetRect: Rect,
      targetIndex: number
    ): boolean => {
      const occluders = targetOccluders[targetIndex];
      if (!occluders || occluders.length === 0) return true;

      const isVertical = axis === "x";
      let rangeStart: number, rangeEnd: number;
      if (isVertical) {
        rangeStart = Math.max(movingRect.y, targetRect.y);
        rangeEnd = Math.min(
          movingRect.y + movingRect.height,
          targetRect.y + targetRect.height
        );
      } else {
        rangeStart = Math.max(movingRect.x, targetRect.x);
        rangeEnd = Math.min(
          movingRect.x + movingRect.width,
          targetRect.x + targetRect.width
        );
      }
      if (rangeStart >= rangeEnd) return false;

      return (
        computeEdgeVisibility(
          edgePosition,
          rangeStart,
          rangeEnd,
          isVertical,
          occluders
        ) >= SNAP_VISIBILITY_THRESHOLD
      );
    };
  }

  /** Compute the bounding box of all panels in a set. */
  private computeSetBBox(set: CardSet): Rect {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const id of set.cardIds) {
      const p = this.deckState.cards.find((panel) => panel.id === id);
      if (!p) continue;
      left = Math.min(left, p.position.x);
      top = Math.min(top, p.position.y);
      right = Math.max(right, p.position.x + p.size.width);
      bottom = Math.max(bottom, p.position.y + p.size.height);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  /**
   * Ensure all members of each set occupy contiguous positions in the panels array.
   */
  private ensureSetAdjacency(): void {
    if (this.sets.length === 0) return;

    const panelToSet = new Map<string, CardSet>();
    for (const set of this.sets) {
      for (const id of set.cardIds) {
        panelToSet.set(id, set);
      }
    }

    const setLeaderId = new Map<CardSet, string>();
    const setMaxIdx = new Map<CardSet, number>();
    for (const set of this.sets) {
      let bestId = set.cardIds[0];
      let bestY = Infinity;
      let bestX = Infinity;
      let maxIdx = -1;
      for (const id of set.cardIds) {
        const p = this.deckState.cards.find((pp) => pp.id === id);
        if (!p) continue;
        if (
          p.position.y < bestY ||
          (p.position.y === bestY && p.position.x < bestX)
        ) {
          bestY = p.position.y;
          bestX = p.position.x;
          bestId = id;
        }
        const idx = this.deckState.cards.indexOf(p);
        if (idx > maxIdx) maxIdx = idx;
      }
      setLeaderId.set(set, bestId);
      setMaxIdx.set(set, maxIdx);
    }

    const result: CardState[] = [];
    const placedSets = new Set<CardSet>();

    for (const panel of this.deckState.cards) {
      const set = panelToSet.get(panel.id);
      if (!set) {
        result.push(panel);
      } else if (!placedSets.has(set)) {
        const maxI = setMaxIdx.get(set)!;
        const myIdx = this.deckState.cards.indexOf(panel);
        if (myIdx === maxI) {
          placedSets.add(set);
          const leadId = setLeaderId.get(set)!;
          const setMembers = this.deckState.cards.filter((p) =>
            set.cardIds.includes(p.id)
          );
          const leader = setMembers.find((p) => p.id === leadId)!;
          const others = setMembers.filter((p) => p.id !== leadId);
          result.push(...others, leader);
        }
      }
    }

    this.deckState.cards = result;

    // Update z-indices
    for (let i = 0; i < this.deckState.cards.length; i++) {
      if (this.deckCanvasRef.current) {
        this.deckCanvasRef.current.updatePanelZIndex(this.deckState.cards[i].id, 100 + i);
      }
    }
  }

  /**
   * Detect break-out from a confirmed set during drag.
   */
  private detectDragSetChange(
    panelId: string,
    snappedX: number,
    snappedY: number,
    panelW: number,
    panelH: number
  ): void {
    if (!this._dragInitialSetKey || this._dragBreakOutFired) return;

    const snappedRect: Rect = { x: snappedX, y: snappedY, width: panelW, height: panelH };
    const allPanelRects = this.deckState.cards.map((p) => ({
      id: p.id,
      rect: p.id === panelId ? snappedRect : cardToRect(p),
    }));

    const edges = findSharedEdges(allPanelRects);
    const ids = allPanelRects.map((r) => r.id);
    const prospectiveSets = computeSets(ids, edges);
    const mySet = prospectiveSets.find((s) => s.cardIds.includes(panelId));
    const currentSetKey = mySet ? [...mySet.cardIds].sort().join(",") : null;

    if (currentSetKey !== this._dragInitialSetKey) {
      this.flashPanels([panelId]);
      this._dragBreakOutFired = true;
      // Reset docked corners for the breaking-out panel
      this.resetDockedStyleForPanel(panelId);
    }
  }

  /**
   * Reset docked style for a single panel to fully-rounded solo appearance.
   * Adds the panel to soloOverridePanels so that updateDockedStyles() (called
   * inside render() via recomputeSets()) applies fully-rounded corners even if
   * the shared edges still list this panel as docked (during break-out drag).
   *
   * Called at most once per drag (gated by _dragBreakOutFired), so the extra
   * render() call during drag is acceptable.
   */
  private resetDockedStyleForPanel(panelId: string): void {
    this.soloOverridePanels.add(panelId);
    this.render();
  }

  /** Flash overlay on one or more panels. */
  private flashPanels(cardIds: string[]): void {
    const panelSet = new Set(cardIds);

    for (const id of cardIds) {
      const el = this.deckCanvasRef.current?.getPanelElement(id);
      if (!el) continue;

      let topInternal = false;
      let bottomInternal = false;
      let leftInternal = false;
      let rightInternal = false;

      if (cardIds.length > 1) {
        for (const edge of this.sharedEdges) {
          if (!panelSet.has(edge.cardAId) || !panelSet.has(edge.cardBId)) continue;
          if (edge.axis === "vertical") {
            if (edge.cardAId === id) rightInternal = true;
            if (edge.cardBId === id) leftInternal = true;
          } else {
            if (edge.cardAId === id) bottomInternal = true;
            if (edge.cardBId === id) topInternal = true;
          }
        }
      }

      const flashEl = document.createElement("div");
      flashEl.className = "set-flash-overlay";

      if (topInternal) flashEl.style.borderTop = "none";
      if (bottomInternal) flashEl.style.borderBottom = "none";
      if (leftInternal) flashEl.style.borderLeft = "none";
      if (rightInternal) flashEl.style.borderRight = "none";

      el.appendChild(flashEl);
      flashEl.addEventListener("animationend", () => flashEl.remove());
    }
  }

  /** Remove all virtual sash elements from the DOM. */
  private destroySashes(): void {
    for (const el of this.sashElements) {
      el.remove();
    }
    this.sashElements = [];
  }

  /**
   * Create virtual sash elements for shared edges.
   */
  private createSashes(): void {
    type SashGroup = {
      axis: "vertical" | "horizontal";
      boundary: number;
      edges: SharedEdge[];
    };
    const groups: SashGroup[] = [];

    for (const edge of this.sharedEdges) {
      let added = false;
      for (const group of groups) {
        if (
          group.axis === edge.axis &&
          Math.abs(group.boundary - edge.boundaryPosition) <= 2
        ) {
          group.edges.push(edge);
          added = true;
          break;
        }
      }
      if (!added) {
        groups.push({
          axis: edge.axis,
          boundary: edge.boundaryPosition,
          edges: [edge],
        });
      }
    }

    for (const group of groups) {
      let overlapStart = Infinity;
      let overlapEnd = -Infinity;
      for (const edge of group.edges) {
        overlapStart = Math.min(overlapStart, edge.overlapStart);
        overlapEnd = Math.max(overlapEnd, edge.overlapEnd);
      }

      const sash = document.createElement("div");
      if (group.axis === "vertical") {
        sash.className = "virtual-sash virtual-sash-vertical";
        sash.style.left = `${group.boundary - 4}px`;
        sash.style.top = `${overlapStart}px`;
        sash.style.height = `${overlapEnd - overlapStart}px`;
      } else {
        sash.className = "virtual-sash virtual-sash-horizontal";
        sash.style.top = `${group.boundary - 4}px`;
        sash.style.left = `${overlapStart}px`;
        sash.style.width = `${overlapEnd - overlapStart}px`;
      }

      this.attachSashDrag(sash, group);
      this.container.appendChild(sash);
      this.sashElements.push(sash);
    }
  }

  /**
   * Attach pointer event handlers to a grouped sash for multi-panel resize.
   */
  private attachSashDrag(
    sash: HTMLElement,
    group: {
      axis: "vertical" | "horizontal";
      boundary: number;
      edges: SharedEdge[];
    }
  ): void {
    const MIN_SIZE = 100;

    sash.addEventListener("pointerdown", (downEvent: PointerEvent) => {
      downEvent.preventDefault();
      downEvent.stopPropagation();
      if (sash.setPointerCapture) {
        sash.setPointerCapture(downEvent.pointerId);
      }

      const aSideIds = new Set<string>();
      const bSideIds = new Set<string>();
      for (const edge of group.edges) {
        aSideIds.add(edge.cardAId);
        bSideIds.add(edge.cardBId);
      }

      type PanelSnap = {
        panel: CardState;
        startX: number;
        startY: number;
        startW: number;
        startH: number;
      };
      const aPanels: PanelSnap[] = [];
      const bPanels: PanelSnap[] = [];

      for (const id of aSideIds) {
        const panel = this.deckState.cards.find((p) => p.id === id);
        if (panel) {
          aPanels.push({
            panel,
            startX: panel.position.x,
            startY: panel.position.y,
            startW: panel.size.width,
            startH: panel.size.height,
          });
        }
      }
      for (const id of bSideIds) {
        const panel = this.deckState.cards.find((p) => p.id === id);
        if (panel) {
          bPanels.push({
            panel,
            startX: panel.position.x,
            startY: panel.position.y,
            startW: panel.size.width,
            startH: panel.size.height,
          });
        }
      }

      if (aPanels.length === 0 || bPanels.length === 0) return;

      const startClientX = downEvent.clientX;
      const startClientY = downEvent.clientY;

      const onMove = (e: PointerEvent) => {
        if (group.axis === "vertical") {
          let dx = e.clientX - startClientX;
          for (const s of aPanels) {
            dx = Math.max(dx, -(s.startW - MIN_SIZE));
          }
          for (const s of bPanels) {
            dx = Math.min(dx, s.startW - MIN_SIZE);
          }

          for (const s of aPanels) {
            s.panel.size.width = s.startW + dx;
            if (this.deckCanvasRef.current) {
              this.deckCanvasRef.current.updatePanelSize(s.panel.id, s.startW + dx, s.startH);
            }
          }
          for (const s of bPanels) {
            s.panel.position.x = s.startX + dx;
            s.panel.size.width = s.startW - dx;
            if (this.deckCanvasRef.current) {
              this.deckCanvasRef.current.updatePanelPosition(s.panel.id, s.startX + dx, s.startY);
              this.deckCanvasRef.current.updatePanelSize(s.panel.id, s.startW - dx, s.startH);
            }
          }
        } else {
          let dy = e.clientY - startClientY;
          for (const s of aPanels) {
            dy = Math.max(dy, -(s.startH - MIN_SIZE));
          }
          for (const s of bPanels) {
            dy = Math.min(dy, s.startH - MIN_SIZE);
          }

          for (const s of aPanels) {
            s.panel.size.height = s.startH + dy;
            if (this.deckCanvasRef.current) {
              this.deckCanvasRef.current.updatePanelSize(s.panel.id, s.startW, s.startH + dy);
            }
          }
          for (const s of bPanels) {
            s.panel.position.y = s.startY + dy;
            s.panel.size.height = s.startH - dy;
            if (this.deckCanvasRef.current) {
              this.deckCanvasRef.current.updatePanelPosition(s.panel.id, s.startX, s.startY + dy);
              this.deckCanvasRef.current.updatePanelSize(s.panel.id, s.startW, s.startH - dy);
            }
          }
        }

        // Move the sash element to track the boundary
        if (group.axis === "vertical") {
          const dx = e.clientX - startClientX;
          sash.style.left = `${group.boundary - 4 + dx}px`;
        } else {
          const dy = e.clientY - startClientY;
          sash.style.top = `${group.boundary - 4 + dy}px`;
        }
      };

      const onUp = (_e: PointerEvent) => {
        if (sash.releasePointerCapture) {
          sash.releasePointerCapture(downEvent.pointerId);
        }
        sash.removeEventListener("pointermove", onMove);
        sash.removeEventListener("pointerup", onUp);
        sash.removeEventListener("pointercancel", onUp);

        this.ensureSetAdjacency();
        // Re-render: recomputeSets() runs first inside render(), updating sashes
        // and docked corner props.
        this.render();
        this.scheduleSave();
      };

      sash.addEventListener("pointermove", onMove);
      sash.addEventListener("pointerup", onUp);
      sash.addEventListener("pointercancel", onUp);
    });
  }

  /**
   * Route keyboard focus to the key panel's active card.
   */
  private focusKeyPanelCard(): void {
    if (!this.keyPanelId) return;
    const panel = this.deckState.cards.find((p) => p.id === this.keyPanelId);
    if (!panel) return;
    // In the unified tree, card components manage their own focus.
    // Focus the panel's root element as a fallback.
    const el = this.deckCanvasRef.current?.getPanelElement(this.keyPanelId);
    if (el) {
      const focusable = el.querySelector<HTMLElement>("[tabindex], input, textarea, button");
      if (focusable) focusable.focus();
    }
  }

  /** Handle keyboard shortcuts at document level. */
  private handleKeyDown(e: KeyboardEvent): void {
    if (e.ctrlKey && (e.key === "`" || e.key === "~")) {
      e.preventDefault();
      this.cyclePanelFocus();
    }
  }

  /**
   * Cycle panel focus: bring the backmost panel to front.
   */
  private cyclePanelFocus(): void {
    const panels = this.deckState.cards;
    if (panels.length === 0) return;

    let targetId = panels[0].id;

    const targetSet = this.sets.find((s) => s.cardIds.includes(targetId));
    if (targetSet) {
      let leaderY = Infinity;
      let leaderX = Infinity;
      for (const id of targetSet.cardIds) {
        const p = panels.find((pp) => pp.id === id);
        if (
          p &&
          (p.position.y < leaderY ||
            (p.position.y === leaderY && p.position.x < leaderX))
        ) {
          leaderY = p.position.y;
          leaderX = p.position.x;
          targetId = id;
        }
      }
    }

    this.focusPanel(targetId);
  }

  /** Set of componentIds that accept key status. */
  private static readonly KEY_CAPABLE = new Set([
    "code",
    "terminal",
    "git",
    "files",
    "stats",
  ]);

  /**
   * Whether a panel accepts key status.
   */
  private acceptsKey(panelId: string): boolean {
    const panel = this.deckState.cards.find((p) => p.id === panelId);
    if (!panel) return false;
    const componentId = panel.tabs[0]?.componentId;
    return componentId !== undefined && DeckManager.KEY_CAPABLE.has(componentId);
  }

  /**
   * Destroy all current cards and clear all tracking maps.
   */
  private destroyAllCards(): void {
    for (const card of this.cardRegistry.values()) {
      card.destroy();
    }
    this.cardRegistry.clear();
    this.cardMetas.clear();

    for (const set of this.cardsByFeed.values()) {
      set.clear();
    }
  }

  destroy(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    // Unmount the single React root
    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }
    for (const card of this.cardRegistry.values()) {
      card.destroy();
    }
    this.cardRegistry.clear();
    // Remove guide line elements
    for (const el of this.guideElements) {
      el.remove();
    }
    this.guideElements = [];
    // Remove virtual sash elements
    this.destroySashes();
    // Clear transient drag context
    this._setMoveContext = null;
    this._dragInitialSetKey = null;
    this._dragBreakOutFired = false;
    document.removeEventListener("keydown", this.keydownHandler);
    window.removeEventListener("resize", () => this.handleResize());
  }
}
