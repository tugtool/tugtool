/**
 * DeckManager — canvas-based card renderer.
 *
 * Owns a flat DeckState (array of CardState), renders each card as a
 * CardFrame absolutely positioned on the canvas, dispatches frames
 * to cards via manager-level fan-out (D10), and implements IDragState for
 * card coupling (D05).
 *
 * [D01] Flat array replaces tree
 * [D06] Key panel focus model with title bar tint
 * [D09] Card instance identity preserved via container reparenting
 * [D10] Manager-level fan-out per feed ID
 */

import { IDragState } from "./drag-state";
import { type DeckState, type CardState, type TabItem, type TabNode } from "./layout-tree";
import { buildDefaultLayout, serialize, deserialize } from "./serialization";
import { TugCard } from "./cards/card";
import { FeedId, FeedIdValue } from "./protocol";
import { TugConnection } from "./connection";
import { TabBar } from "./tab-bar";
import { CardFrame, CARD_TITLE_BAR_HEIGHT } from "./card-frame";
import { computeSnap, computeResizeSnap, computeEdgeVisibility, cardToRect, findSharedEdges, computeSets, SNAP_VISIBILITY_THRESHOLD, type Rect, type GuidePosition, type CardSet, type SharedEdge, type EdgeValidator } from "./snap";

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
 * Construct a TabNode adapter from a CardState for use with TabBar (D07).
 * TabBar still takes TabNode; CardState stores activeTabId (string).
 */
function constructTabNode(panel: CardState): TabNode {
  const activeIndex = panel.tabs.findIndex((t) => t.id === panel.activeTabId);
  return {
    type: "tab",
    id: panel.id,
    tabs: panel.tabs,
    activeTabIndex: Math.max(0, activeIndex),
  };
}

/**
 * Map componentId to a display title for new TabItems.
 */
function titleForComponent(componentId: string): string {
  const titles: Record<string, string> = {
    code: "Code",
    terminal: "Terminal",
    git: "Git",
    files: "Files",
    stats: "Stats",
    about: "About",
    settings: "Settings",
    developer: "Developer",
  };
  return titles[componentId] ?? componentId;
}

export class DeckManager implements IDragState {
  private container: HTMLElement;
  private connection: TugConnection;

  /** Current canvas state (flat array of panels) */
  private deckState: DeckState;

  /** D10: one Set<TugCard> per output feedId */
  private cardsByFeed: Map<FeedIdValue, Set<TugCard>> = new Map();

  /** Most recent payload per feed, replayed to newly added cards */
  private lastPayload: Map<FeedIdValue, Uint8Array> = new Map();

  /**
   * Registry mapping TabItem.id -> TugCard instance.
   */
  private cardRegistry: Map<string, TugCard> = new Map();

  /**
   * DOM reparenting map (D09): TabItem.id -> card mount container element.
   * On re-render, existing containers are reused via appendChild rather than recreated.
   */
  private cardContainers: Map<string, HTMLElement> = new Map();

  /**
   * ResizeObserver per card container for accurate resize detection.
   */
  private resizeObservers: Map<string, ResizeObserver> = new Map();

  /**
   * TabBar instances keyed by panel.id (for multi-tab panels).
   * Destroyed and recreated on render.
   */
  private tabBars: Map<string, TabBar> = new Map();

  /**
   * CardFrame instances keyed by panel.id.
   * Destroyed and recreated on render.
   */
  private cardFrames: Map<string, CardFrame> = new Map();

  /** Key panel: only code/terminal panels get title bar tint */
  private keyPanelId: string | null = null;

  /** D05: drag state flag */
  private _isDragging = false;

  /** Debounce timer for layout saves */
  private saveTimer: number | null = null;

  /** Card factory functions keyed by componentId. Registered externally by main.ts. */
  private cardFactories: Map<string, () => TugCard> = new Map();

  /** Root panel DOM element */
  private rootEl: HTMLElement;

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

  constructor(container: HTMLElement, connection: TugConnection) {
    this.container = container;
    this.connection = connection;

    // Initialize cardsByFeed sets for all output feedIds (D10)
    for (const feedId of OUTPUT_FEED_IDS) {
      this.cardsByFeed.set(feedId, new Set());
    }

    // Register ONE callback per output feedId with the connection (D10).
    // These callbacks are registered once and never removed.
    for (const feedId of OUTPUT_FEED_IDS) {
      connection.onFrame(feedId, (payload: Uint8Array) => {
        this.lastPayload.set(feedId, payload);
        const cards = this.cardsByFeed.get(feedId);
        if (cards) {
          for (const card of cards) {
            card.onFrame(feedId, payload);
          }
        }
      });
    }

    // Preserve existing reconnect-resize behavior
    connection.onOpen(() => this.handleResize());

    // Canvas container needs position:relative for absolutely-positioned children
    container.style.position = "relative";

    // Create root container element
    this.rootEl = document.createElement("div");
    this.rootEl.className = "deck-root";
    this.rootEl.style.width = "100%";
    this.rootEl.style.height = "100%";
    container.appendChild(this.rootEl);

    // Create guide line element pool (D03: absolutely-positioned divs in canvas container)
    this.createGuideLines();

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

    // Mount into the pre-rendered container if it already exists
    const mountEl = this.cardContainers.get(tabItem.id);
    if (mountEl) {
      card.mount(mountEl);
      this.observeContainer(tabItem.id, mountEl, card);
      // Deferred resize: double-rAF ensures both style recalculation and
      // layout pass complete before measuring. Critical for xterm.js FitAddon.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const { clientWidth, clientHeight } = mountEl;
          if (clientWidth > 0 && clientHeight > 0) {
            card.onResize(clientWidth, clientHeight);
          }
        });
      });
      // After mount, ensure the key panel has DOM focus.
      // Cards must not self-focus on mount — the panel manager owns focus.
      requestAnimationFrame(() => this.focusKeyPanelCard());
    }

    // Replay last frame for each subscribed feed so the card isn't empty
    for (const feedId of card.feedIds) {
      const payload = this.lastPayload.get(feedId as FeedIdValue);
      if (payload) {
        card.onFrame(feedId, payload);
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
   * Remove a card: removes from fan-out sets, calls card.destroy(),
   * removes its tab from the panel. If the panel is now empty, removes it.
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

      // Disconnect ResizeObserver
      const ro = this.resizeObservers.get(tabItemId);
      if (ro) {
        ro.disconnect();
        this.resizeObservers.delete(tabItemId);
      }

      this.cardContainers.delete(tabItemId);

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
   * Re-render the entire canvas: destroy existing CardFrame and TabBar
   * instances, then create one CardFrame per CardState in array order
   * (index = z-order). Key-capable panels get title bar tint via setKey().
   *
   * Existing card mount containers are reparented rather than recreated (D09).
   */
  private render(): void {
    // Destroy existing TabBar instances
    for (const tb of this.tabBars.values()) {
      tb.destroy();
    }
    this.tabBars.clear();

    // Destroy existing CardFrame DOM instances (removes from DOM)
    for (const fp of this.cardFrames.values()) {
      fp.destroy();
    }
    this.cardFrames.clear();

    // Clear rootEl (floating panels are appended to container, not rootEl)
    this.rootEl.innerHTML = "";

    const panels = this.deckState.cards;
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];

      // Resolve card meta from the active tab's card (if registered)
      const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId)
        ?? panel.tabs[0];
      const cardMeta = activeTab
        ? this.cardRegistry.get(activeTab.id)?.meta
        : undefined;

      const fp = new CardFrame(
        panel,
        {
          onMoveEnd: (x, y) => {
            this._isDragging = false;
            this.hideGuides();
            panel.position = { x, y };
            const initialSetKey = this._dragInitialSetKey;
            const breakOutFired = this._dragBreakOutFired;
            this._setMoveContext = null;
            this._dragInitialSetKey = null;
            this._dragBreakOutFired = false;
            this.recomputeSets();
            this.ensureSetAdjacency();
            // Flash on set creation/growth, or when re-joining after a break-out
            const finalSet = this.sets.find((s) => s.cardIds.includes(panel.id));
            if (finalSet) {
              const finalSetKey = [...finalSet.cardIds].sort().join(",");
              if (finalSetKey !== initialSetKey || breakOutFired) {
                this.flashPanels(finalSet.cardIds);
              }
            }
            this.scheduleSave();
          },
          onResizeEnd: (x, y, width, height) => {
            this._isDragging = false;
            this.hideGuides();
            panel.position = { x, y };
            panel.size = { width, height };
            // Notify the active card of its new size
            const activeTabId = panel.activeTabId;
            const card = this.cardRegistry.get(activeTabId);
            if (card) card.onResize(width, height - CARD_TITLE_BAR_HEIGHT);
            this.recomputeSets();
            this.ensureSetAdjacency();
            this.scheduleSave();
          },
          onFocus: (opts) => {
            // Capture set-move context BEFORE focusPanel reorders the panels array.
            // Topmost = smallest Y coordinate (visually highest on screen).
            // Tiebreaker: smallest X (leftmost). Exactly one panel per set.
            const mySet = this.sets.find((s) => s.cardIds.includes(panel.id));
            if (mySet) {
              let leaderId: string | null = null;
              let leaderY = Infinity;
              let leaderX = Infinity;
              for (const memberId of mySet.cardIds) {
                const memberPanel = this.deckState.cards.find((p) => p.id === memberId);
                if (!memberPanel) continue;
                if (memberPanel.position.y < leaderY ||
                    (memberPanel.position.y === leaderY && memberPanel.position.x < leaderX)) {
                  leaderY = memberPanel.position.y;
                  leaderX = memberPanel.position.x;
                  leaderId = memberId;
                }
              }
              const isTopMost = leaderId === panel.id;
              const startPositions = new Map<string, { x: number; y: number }>();
              for (const memberId of mySet.cardIds) {
                const memberPanel = this.deckState.cards.find((p) => p.id === memberId);
                if (memberPanel) {
                  startPositions.set(memberId, { ...memberPanel.position });
                }
              }
              this._setMoveContext = {
                panelId: panel.id,
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
              this.focusPanel(panel.id);
            }
          },
          onClose: () => {
            const activeTabId = panel.activeTabId;
            const card = this.cardRegistry.get(activeTabId);
            if (card) {
              this.removeCard(card);
            }
          },
          onMoving: (x, y) => {
            this._isDragging = true;

            // Use the context captured in onFocus (before focusPanel reordered panels).
            // If no context (panel not in a set), create a solo context now.
            if (this._setMoveContext === null) {
              const startPositions = new Map<string, { x: number; y: number }>();
              startPositions.set(panel.id, { ...panel.position });
              this._setMoveContext = {
                panelId: panel.id,
                isTopMost: false,
                setMemberIds: [],
                startPositions,
              };
            }

            const ctx = this._setMoveContext;

            if (ctx.isTopMost && ctx.setMemberIds.length > 1) {
              // SET-MOVE: move all set members by the same delta (D06).
              const myStart = ctx.startPositions.get(panel.id)!;
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
              const nonSetPanels = this.deckState.cards
                .filter((p) => !ctx.setMemberIds.includes(p.id));
              const nonSetRects: Rect[] = nonSetPanels.map((p) => cardToRect(p));

              const setBBox: Rect = {
                x: bboxLeft,
                y: bboxTop,
                width: bboxRight - bboxLeft,
                height: bboxBottom - bboxTop,
              };

              // Build occlusion validator: set members (high z-index) can occlude non-set panel edges.
              // No single panel excluded — set members remain as valid occluders.
              const setMoveZMap = new Map<string, number>();
              this.deckState.cards.forEach((p, i) => { setMoveZMap.set(p.id, 100 + i); });

              const setMoveTargetZ = nonSetPanels.map(p => setMoveZMap.get(p.id) ?? 0);
              const setMoveExcludeIds = nonSetPanels.map(p => new Set([p.id]));

              const setMoveValidator = this.buildSnapValidator(
                setBBox, setMoveTargetZ, setMoveExcludeIds, ""
              );

              const snap = computeSnap(setBBox, nonSetRects, setMoveValidator);
              this.showGuides(snap.guides);

              // Apply snap offset to all sibling positions.
              const snapDX = snap.x !== null ? snap.x - setBBox.x : 0;
              const snapDY = snap.y !== null ? snap.y - setBBox.y : 0;

              for (const memberId of ctx.setMemberIds) {
                if (memberId === panel.id) continue; // dragged panel handled by CardFrame
                const proposed = proposedPositions.get(memberId)!;
                const siblingFp = this.cardFrames.get(memberId);
                if (siblingFp) {
                  siblingFp.updatePosition(proposed.x + snapDX, proposed.y + snapDY);
                }
              }

              const finalX = x + snapDX;
              const finalY = y + snapDY;
              return { x: finalX, y: finalY };
            } else {
              // BREAK-OUT / SOLO: move only this panel; snap against external edges only.
              // Replace set members with set bounding boxes so internal edges are invisible.
              // Exclude the dragged panel from set bboxes to prevent phantom snap targets.
              const others: Rect[] = [];
              const processedSetKeys = new Set<string>();
              const soloTargetZ: number[] = [];
              const soloExcludeIds: Set<string>[] = [];

              // Z-index map: panelId -> z-index (100 + array position)
              const soloZMap = new Map<string, number>();
              this.deckState.cards.forEach((p, i) => { soloZMap.set(p.id, 100 + i); });

              for (const p of this.deckState.cards) {
                if (p.id === panel.id) continue;
                const pSet = this.sets.find((s) => s.cardIds.includes(p.id));
                if (pSet) {
                  const setKey = [...pSet.cardIds].sort().join(",");
                  if (!processedSetKeys.has(setKey)) {
                    processedSetKeys.add(setKey);
                    // Exclude the dragged panel from the set bbox computation
                    const filteredIds = pSet.cardIds.filter(id => id !== panel.id);
                    if (filteredIds.length > 0) {
                      others.push(this.computeSetBBox({ cardIds: filteredIds }));
                      soloTargetZ.push(Math.max(...filteredIds.map(id => soloZMap.get(id) ?? 0)));
                      soloExcludeIds.push(new Set(filteredIds));
                    }
                  }
                } else {
                  others.push(cardToRect(p));
                  soloTargetZ.push(soloZMap.get(p.id) ?? 0);
                  soloExcludeIds.push(new Set([p.id]));
                }
              }

              const movingRect: Rect = { x, y, width: panel.size.width, height: panel.size.height };
              const soloValidator = this.buildSnapValidator(
                movingRect, soloTargetZ, soloExcludeIds, panel.id
              );

              const snap = computeSnap(movingRect, others, soloValidator);
              this.showGuides(snap.guides);
              const finalX = snap.x !== null ? snap.x : x;
              const finalY = snap.y !== null ? snap.y : y;
              this.detectDragSetChange(panel.id, finalX, finalY, panel.size.width, panel.size.height);
              return { x: finalX, y: finalY };
            }
          },
          onResizing: (x, y, width, height) => {
            this._isDragging = true;
            // Collect Rects for all other panels (exclude the one being resized)
            const others: Rect[] = this.deckState.cards
              .filter((p) => p.id !== panel.id)
              .map((p) => cardToRect(p));
            // Pass all four edges; computeResizeSnap only snaps edges within threshold
            const resizingEdges = {
              left: x,
              right: x + width,
              top: y,
              bottom: y + height,
            };
            const snap = computeResizeSnap(resizingEdges, others);
            this.showGuides(snap.guides);
            // Reconstruct geometry from snapped edge values
            let newX = snap.left !== undefined ? snap.left : x;
            let newY = snap.top !== undefined ? snap.top : y;
            const newRight = snap.right !== undefined ? snap.right : (x + width);
            const newBottom = snap.bottom !== undefined ? snap.bottom : (y + height);
            let newW = newRight - newX;
            let newH = newBottom - newY;
            // Enforce minimum size — if snapping would violate it, skip that snap
            const MIN_SIZE = 100;
            if (newW < MIN_SIZE) { newW = width; newX = x; }
            if (newH < MIN_SIZE) { newH = height; newY = y; }
            return { x: newX, y: newY, width: newW, height: newH };
          },
        },
        this.container,
        cardMeta
      );

      // Assign z-index in array order (100, 101, 102, ...)
      fp.setZIndex(100 + i);

      this.container.appendChild(fp.getElement());
      this.cardFrames.set(panel.id, fp);

      // Mount cards via D09 reparenting
      for (const tab of panel.tabs) {
        const isActive = tab.id === panel.activeTabId;

        let mountEl = this.cardContainers.get(tab.id);
        if (!mountEl) {
          mountEl = document.createElement("div");
          mountEl.className = "card-mount";
          this.cardContainers.set(tab.id, mountEl);
        }

        // Show/hide based on active tab
        mountEl.style.display = isActive ? "" : "none";

        // Reparent into floating panel card area (D09)
        fp.getCardAreaElement().appendChild(mountEl);

        // Mount the card if registered; auto-create from factory if
        // the tab was restored from persisted layout with no card instance.
        let card = this.cardRegistry.get(tab.id);
        if (!card) {
          const factory = this.cardFactories.get(tab.componentId);
          if (factory) {
            card = factory();
            for (const feedId of card.feedIds) {
              const set = this.cardsByFeed.get(feedId as FeedIdValue);
              if (set) set.add(card);
            }
            this.cardRegistry.set(tab.id, card);
          }
        }
        if (card && mountEl.children.length === 0) {
          card.mount(mountEl);
          this.observeContainer(tab.id, mountEl, card);
        }
      }

      // Create TabBar for multi-tab panels (D05/D07)
      if (panel.tabs.length > 1) {
        const tabNode = constructTabNode(panel);
        const tabBar = new TabBar(tabNode, {
          onTabActivate: (tabIndex: number) => {
            this.handleTabActivate(panel, tabIndex);
          },
          onTabClose: (tabId: string) => {
            this.handleTabClose(tabId);
          },
          onTabReorder: (fromIndex: number, toIndex: number) => {
            this.handleTabReorder(panel, fromIndex, toIndex);
          },
        });
        // Insert tab bar before card area
        fp.getCardAreaElement().parentElement?.insertBefore(
          tabBar.getElement(),
          fp.getCardAreaElement()
        );
        this.tabBars.set(panel.id, tabBar);
      } else if (panel.tabs.length === 1 && activeTab) {
        // Single-tab panel: CardHeader is rendered by CardFrame internally.
        // If we have a card with meta, update header retroactively via addCard path.
        // (CardFrame already created header from cardMeta if provided.)
      }
    }

    // Apply key panel state: if no keyPanelId set (or it no longer exists),
    // find the last acceptsKey panel and make it key.
    if (!this.keyPanelId || !this.cardFrames.has(this.keyPanelId)) {
      this.keyPanelId = null;
      for (let i = panels.length - 1; i >= 0; i--) {
        if (this.acceptsKey(panels[i].id)) {
          this.keyPanelId = panels[i].id;
          break;
        }
      }
    }
    for (const [id, fp] of this.cardFrames) {
      fp.setKey(id === this.keyPanelId);
    }

    // Always recompute sets after render so this.sets is never stale.
    this.recomputeSets();
  }

  /**
   * Move the given panel to the end of the panels array (highest z-order),
   * update z-index values, and update key panel state.
   *
   * Key panel model: only conversation/terminal panels become key.
   * Clicking a non-key panel brings it to front but does not change keyPanelId.
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
        if (p && (p.position.y < leaderY || (p.position.y === leaderY && p.position.x < leaderX))) {
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

    // Update z-index to match new array order
    for (const [id, fp] of this.cardFrames) {
      const newIdx = this.deckState.cards.findIndex((p) => p.id === id);
      if (newIdx !== -1) {
        fp.setZIndex(100 + newIdx);
      }
    }

    this.scheduleSave();

    // Update key panel: only if the focused panel accepts key
    if (this.acceptsKey(panelId)) {
      const prevKeyFp = this.keyPanelId ? this.cardFrames.get(this.keyPanelId) : null;
      if (prevKeyFp && this.keyPanelId !== panelId) {
        prevKeyFp.setKey(false);
      }
      this.keyPanelId = panelId;
      const newKeyFp = this.cardFrames.get(panelId);
      if (newKeyFp) {
        newKeyFp.setKey(true);
      }
    }

    // Route keyboard focus to the key panel's active card.
    // Deferred to next frame so it runs after the browser's default
    // mousedown focus handling settles — otherwise the browser can
    // move focus to the clicked element after our .focus() call.
    requestAnimationFrame(() => this.focusKeyPanelCard());
  }

  // ---- Tab callbacks ----

  /**
   * Switch the active tab in a panel.
   * Hides the previous active card, shows the new one, fires onResize.
   */
  private handleTabActivate(panel: CardState, newIndex: number): void {
    if (newIndex < 0 || newIndex >= panel.tabs.length) return;

    const newTab = panel.tabs[newIndex];
    if (newTab.id === panel.activeTabId) return;

    // Hide current active tab's mount element
    const prevMountEl = this.cardContainers.get(panel.activeTabId);
    if (prevMountEl) {
      prevMountEl.style.display = "none";
    }

    // Update panel state
    panel.activeTabId = newTab.id;

    // Show newly active tab's mount element
    const newMountEl = this.cardContainers.get(newTab.id);
    if (newMountEl) {
      newMountEl.style.display = "";

      // Mandatory onResize after making element visible (D09 / xterm.js FitAddon)
      const card = this.cardRegistry.get(newTab.id);
      if (card) {
        const rect = newMountEl.getBoundingClientRect();
        const w = rect.width || newMountEl.clientWidth;
        const h = rect.height || newMountEl.clientHeight;
        if (w > 0 && h > 0) {
          card.onResize(w, h);
        }
      }
    }

    // Refresh tab bar visuals
    const tabBar = this.tabBars.get(panel.id);
    if (tabBar) {
      tabBar.update(constructTabNode(panel));
    }

    this.scheduleSave();
  }

  /**
   * Close a tab: find its card and remove it.
   */
  private handleTabClose(tabId: string): void {
    const card = this.cardRegistry.get(tabId);
    if (card) {
      this.removeCard(card);
    }
  }

  /**
   * Reorder tabs within a panel.
   * Moves tabs[fromIndex] to toIndex, adjusts activeTabId, refreshes TabBar.
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

    // activeTabId doesn't change (it's by id, not index)

    // Refresh tab bar visuals only (no full re-render needed)
    const tabBar = this.tabBars.get(panel.id);
    if (tabBar) {
      tabBar.update(constructTabNode(panel));
    }

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
      tabs: [{
        id: tabId,
        componentId,
        title: titleForComponent(componentId),
        closable: true,
      }],
      activeTabId: tabId,
    };

    this.deckState.cards.push(newPanel);

    // Create card instance and register it
    const card = factory();
    for (const feedId of card.feedIds) {
      const set = this.cardsByFeed.get(feedId as FeedIdValue);
      if (set) set.add(card);
    }
    this.cardRegistry.set(tabId, card);

    this.render();

    // Replay last frame for each subscribed feed so the card isn't empty
    for (const feedId of card.feedIds) {
      const payload = this.lastPayload.get(feedId as FeedIdValue);
      if (payload) {
        card.onFrame(feedId, payload);
      }
    }

    this.scheduleSave();
  }

  /**
   * Add a new tab to an existing panel (same componentId constraint).
   * Called by card-level "New Tab" actions.
   */
  addNewTab(panelId: string, componentId: string): void {
    const panel = this.deckState.cards.find((p) => p.id === panelId);
    if (!panel) {
      console.warn(`DeckManager.addNewTab: panel "${panelId}" not found`);
      return;
    }

    // Verify same-componentId constraint
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

    // Replay last frame for each subscribed feed so the card isn't empty
    for (const feedId of card.feedIds) {
      const payload = this.lastPayload.get(feedId as FeedIdValue);
      if (payload) {
        card.onFrame(feedId, payload);
      }
    }

    this.scheduleSave();
  }

  /**
   * Find the topmost panel (highest z-index) containing a tab with the given componentId.
   * Returns null if no panel found.
   * Iterates in reverse order (topmost first) per D09.
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
   * No-op if no panel found.
   */
  closePanelByComponent(componentId: string): void {
    const panel = this.findPanelByComponent(componentId);
    if (!panel) {
      return;
    }

    // Find the active card for this panel and remove it
    const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId);
    if (activeTab) {
      const card = this.cardRegistry.get(activeTab.id);
      if (card) {
        this.removeCard(card);
      }
    }
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
   * Used by Dock to trigger restart/reset/reload_frontend actions.
   */
  sendControlFrame(action: string, params?: Record<string, unknown>): void {
    this.connection.sendControlFrame(action, params);
  }

  // ---- Resize Handling ----

  private observeContainer(
    tabItemId: string,
    mountEl: HTMLElement,
    card: TugCard
  ): void {
    const existing = this.resizeObservers.get(tabItemId);
    if (existing) {
      existing.disconnect();
    }

    const ro = new ResizeObserver(() => {
      if (this._isDragging) return;
      const { clientWidth, clientHeight } = mountEl;
      if (clientWidth > 0 && clientHeight > 0) {
        card.onResize(clientWidth, clientHeight);
      }
    });
    ro.observe(mountEl);
    this.resizeObservers.set(tabItemId, ro);
  }

  /**
   * Notify all mounted cards of their current container dimensions.
   * Called on reconnect (onOpen) and window resize.
   */
  handleResize(): void {
    for (const [tabItemId, card] of this.cardRegistry) {
      const mountEl = this.cardContainers.get(tabItemId);
      if (mountEl) {
        const { clientWidth, clientHeight } = mountEl;
        if (clientWidth > 0 && clientHeight > 0) {
          card.onResize(clientWidth, clientHeight);
        }
      }
    }
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

  /**
   * Register a card factory for a componentId.
   * Used by Dock and resetLayout to create new card instances.
   */
  registerCardFactory(componentId: string, factory: () => TugCard): void {
    this.cardFactories.set(componentId, factory);
  }

  // ---- Private helpers ----

  /**
   * Recompute panel sets from current panel positions.
   * Called after move-end, resize-end, and panel close.
   * D05: Sets are runtime-only, derived from panel positions.
   * D07: Shared-edge detection algorithm.
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
   * Close small gaps between panels in sets by nudging "B" panels
   * (below or right-of) so their edges meet exactly.
   */
  private normalizeSetPositions(): void {
    for (const edge of this.sharedEdges) {
      const panelA = this.deckState.cards.find((p) => p.id === edge.cardAId);
      const panelB = this.deckState.cards.find((p) => p.id === edge.cardBId);
      if (!panelA || !panelB) continue;

      if (edge.axis === "horizontal") {
        // A is above B: set B.top = A.bottom
        const target = panelA.position.y + panelA.size.height;
        if (panelB.position.y !== target) {
          panelB.position.y = target;
          const fp = this.cardFrames.get(edge.cardBId);
          if (fp) fp.updatePosition(panelB.position.x, panelB.position.y);
        }
      } else {
        // A is left of B: set B.left = A.right
        const target = panelA.position.x + panelA.size.width;
        if (panelB.position.x !== target) {
          panelB.position.x = target;
          const fp = this.cardFrames.get(edge.cardBId);
          if (fp) fp.updatePosition(panelB.position.x, panelB.position.y);
        }
      }
    }
  }

  /**
   * Apply 1px overlap and corner radius adjustments for docked card sets.
   *
   * For each shared edge:
   * - Horizontal (A above B): B scoots up 1px; A loses bottom corners, B loses top corners
   * - Vertical (A left of B): B scoots left 1px; A loses right corners, B loses left corners
   *
   * Corner radius is tracked per-card as a 4-element array [TL, TR, BR, BL].
   */
  private updateDockedStyles(): void {
    const RADIUS = "6px";
    const HEADER_RADIUS = "5px";

    // Track which corners should be squared per card: [TL, TR, BR, BL]
    // true = keep radius, false = zero
    const corners = new Map<string, [boolean, boolean, boolean, boolean]>();
    // Track 1px offsets per card
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
        // A is above B (A.bottom ~ B.top)
        cornersA[2] = false; // BR
        cornersA[3] = false; // BL
        cornersB[0] = false; // TL
        cornersB[1] = false; // TR
        offsetB.dy = -1;
      } else {
        // A is left of B (A.right ~ B.left)
        cornersA[1] = false; // TR
        cornersA[2] = false; // BR
        cornersB[0] = false; // TL
        cornersB[3] = false; // BL
        offsetB.dx = -1;
      }
    }

    // Apply styles to card frame elements
    for (const card of this.deckState.cards) {
      const fp = this.cardFrames.get(card.id);
      if (!fp) continue;

      const el = fp.getElement();
      const c = corners.get(card.id)!;
      const o = offsets.get(card.id)!;

      // Build border-radius string: TL TR BR BL
      const r = (v: boolean) => v ? RADIUS : "0";
      const hr = (v: boolean) => v ? HEADER_RADIUS : "0";
      el.style.borderRadius = `${r(c[0])} ${r(c[1])} ${r(c[2])} ${r(c[3])}`;

      // Apply to child elements
      const header = el.querySelector(".card-header") as HTMLElement | null;
      if (header) {
        header.style.borderRadius = `${hr(c[0])} ${hr(c[1])} 0 0`;
      }
      const content = el.querySelector(".card-frame-content") as HTMLElement | null;
      if (content) {
        content.style.borderRadius = `0 0 ${hr(c[2])} ${hr(c[3])}`;
      }

      // Apply 1px overlap by nudging the DOM element position directly.
      // The logical cardState position stays unchanged for edge detection.
      if (o.dx !== 0 || o.dy !== 0) {
        const card = this.deckState.cards.find((c) => c.id === fp.getCardState().id);
        if (card) {
          el.style.top = `${card.position.y + o.dy}px`;
          el.style.left = `${card.position.x + o.dx}px`;
        }
      }
    }
  }

  /** Reset docked styles on a single panel to fully-rounded solo appearance. */
  private resetDockedStyles(panelId: string): void {
    const fp = this.cardFrames.get(panelId);
    if (!fp) return;
    const el = fp.getElement();
    el.style.borderRadius = "6px";
    // Restore DOM position to logical position
    const card = this.deckState.cards.find((c) => c.id === panelId);
    if (card) {
      el.style.top = `${card.position.y}px`;
      el.style.left = `${card.position.x}px`;
    }
    const header = el.querySelector(".card-header") as HTMLElement | null;
    if (header) header.style.borderRadius = "5px 5px 0 0";
    const content = el.querySelector(".card-frame-content") as HTMLElement | null;
    if (content) content.style.borderRadius = "0 0 5px 5px";
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
   * Show guide lines at the specified positions. Hides any unused guide elements.
   * Spec S06: Guide lines shown when snap target detected.
   */
  private showGuides(guides: GuidePosition[]): void {
    const xGuides = guides.filter((g) => g.axis === "x");
    const yGuides = guides.filter((g) => g.axis === "y");
    // guideElements[0..1] are vertical (x-axis), [2..3] are horizontal (y-axis)
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

  /** Hide all guide line elements. Called on drag end. */
  private hideGuides(): void {
    for (const el of this.guideElements) {
      el.style.display = "none";
    }
  }

  /**
   * Build an EdgeValidator for occlusion-aware snapping.
   *
   * For each target rect, checks whether the snap edge is visible (not covered
   * by higher-z panels) along the perpendicular intersection with the moving rect.
   *
   * @param movingRect - The rect being moved (used for perpendicular range)
   * @param targetZIndices - z-index per entry in the targets array
   * @param targetExcludeIds - panel IDs to skip as occluders for each target
   * @param excludePanelId - panel ID to exclude from all occluder lists (the moving panel)
   */
  private buildSnapValidator(
    movingRect: Rect,
    targetZIndices: number[],
    targetExcludeIds: Set<string>[],
    excludePanelId: string
  ): EdgeValidator {
    // Build z-index map for all panels
    const zMap = new Map<string, number>();
    this.deckState.cards.forEach((p, i) => { zMap.set(p.id, 100 + i); });

    // All panels except the moving one, with z-index info
    const allOccluders: { rect: Rect; zIndex: number; id: string }[] = [];
    for (const p of this.deckState.cards) {
      if (p.id === excludePanelId) continue;
      allOccluders.push({ rect: cardToRect(p), zIndex: zMap.get(p.id) ?? 0, id: p.id });
    }

    // Precompute per-target occluder rects
    const targetOccluders: Rect[][] = targetZIndices.map((tZ, idx) => {
      const excludeIds = targetExcludeIds[idx];
      return allOccluders
        .filter(op => op.zIndex > tZ && !excludeIds.has(op.id))
        .map(op => op.rect);
    });

    return (axis: "x" | "y", edgePosition: number, targetRect: Rect, targetIndex: number): boolean => {
      const occluders = targetOccluders[targetIndex];
      if (!occluders || occluders.length === 0) return true;

      const isVertical = axis === "x";
      let rangeStart: number, rangeEnd: number;
      if (isVertical) {
        rangeStart = Math.max(movingRect.y, targetRect.y);
        rangeEnd = Math.min(movingRect.y + movingRect.height, targetRect.y + targetRect.height);
      } else {
        rangeStart = Math.max(movingRect.x, targetRect.x);
        rangeEnd = Math.min(movingRect.x + movingRect.width, targetRect.x + targetRect.width);
      }
      if (rangeStart >= rangeEnd) return false;

      return computeEdgeVisibility(
        edgePosition, rangeStart, rangeEnd, isVertical, occluders
      ) >= SNAP_VISIBILITY_THRESHOLD;
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
   * The leader (topmost in Y, i.e. smallest Y) gets the highest z-index in the group
   * so its title bar is always accessible.
   */
  private ensureSetAdjacency(): void {
    if (this.sets.length === 0) return;

    // Map each panel id to its set (if any)
    const panelToSet = new Map<string, CardSet>();
    for (const set of this.sets) {
      for (const id of set.cardIds) {
        panelToSet.set(id, set);
      }
    }

    // For each set, find the leader (smallest Y, then X) and its current array position.
    // The group will be placed at the max index of any set member (so the set
    // stays at the "front" of the z-order stack).
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
        if (p.position.y < bestY || (p.position.y === bestY && p.position.x < bestX)) {
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

    // Build new array: when we reach the highest-index set member, insert the
    // entire group with leader last (highest z). Non-leader members encountered
    // earlier are skipped.
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
          const setMembers = this.deckState.cards.filter((p) => set.cardIds.includes(p.id));
          const leader = setMembers.find((p) => p.id === leadId)!;
          const others = setMembers.filter((p) => p.id !== leadId);
          result.push(...others, leader);
        }
        // else: skip non-leader member (placed when we reach maxIdx)
      }
      // else: set already placed, skip
    }

    this.deckState.cards = result;

    // Update z-indices
    for (const [id, fp] of this.cardFrames) {
      const idx = this.deckState.cards.findIndex((p) => p.id === id);
      if (idx >= 0) fp.setZIndex(100 + idx);
    }
  }

  /**
   * Detect break-out from a confirmed set during drag.
   * Compares against _dragInitialSetKey (confirmed at drag start), NOT live
   * prospective state. Fires at most once per drag via _dragBreakOutFired.
   */
  private detectDragSetChange(
    panelId: string, snappedX: number, snappedY: number, panelW: number, panelH: number
  ): void {
    // Only check if panel started in a confirmed set and hasn't already flashed
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
      // Panel is no longer in its original confirmed set — flash once
      this.flashPanels([panelId]);
      this._dragBreakOutFired = true;
      // Restore rounded corners immediately so the panel looks solo during drag
      this.resetDockedStyles(panelId);
    }
  }

  /** Flash overlay on one or more panels. Overlays are children of the panel element so they move with it. */
  private flashPanels(cardIds: string[]): void {
    const panelSet = new Set(cardIds);

    for (const id of cardIds) {
      const fp = this.cardFrames.get(id);
      if (!fp) continue;

      // Determine which edges are internal (shared with another panel in this group)
      let topInternal = false;
      let bottomInternal = false;
      let leftInternal = false;
      let rightInternal = false;

      if (cardIds.length > 1) {
        for (const edge of this.sharedEdges) {
          if (!panelSet.has(edge.cardAId) || !panelSet.has(edge.cardBId)) continue;
          if (edge.axis === "vertical") {
            // A.right ~ B.left
            if (edge.cardAId === id) rightInternal = true;
            if (edge.cardBId === id) leftInternal = true;
          } else {
            // A.bottom ~ B.top
            if (edge.cardAId === id) bottomInternal = true;
            if (edge.cardBId === id) topInternal = true;
          }
        }
      }

      const el = document.createElement("div");
      el.className = "set-flash-overlay";

      // Hide borders on internal edges so only the set perimeter flashes.
      // Individual border properties avoid the corner gaps that clipPath creates.
      if (topInternal) el.style.borderTop = "none";
      if (bottomInternal) el.style.borderBottom = "none";
      if (leftInternal) el.style.borderLeft = "none";
      if (rightInternal) el.style.borderRight = "none";

      fp.getElement().appendChild(el);
      el.addEventListener("animationend", () => el.remove());
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
   * Groups edges at the same boundary into a single sash that resizes
   * ALL panels on both sides of the boundary.
   */
  private createSashes(): void {
    // Group shared edges by axis + boundary position
    type SashGroup = { axis: "vertical" | "horizontal"; boundary: number; edges: SharedEdge[] };
    const groups: SashGroup[] = [];

    for (const edge of this.sharedEdges) {
      let added = false;
      for (const group of groups) {
        if (group.axis === edge.axis && Math.abs(group.boundary - edge.boundaryPosition) <= 2) {
          group.edges.push(edge);
          added = true;
          break;
        }
      }
      if (!added) {
        groups.push({ axis: edge.axis, boundary: edge.boundaryPosition, edges: [edge] });
      }
    }

    for (const group of groups) {
      // Compute sash geometry from union of all edge overlaps
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
   * All panels on both sides of the boundary resize together.
   * Does NOT set _isDragging so cards can live-resize via ResizeObserver.
   */
  private attachSashDrag(
    sash: HTMLElement,
    group: { axis: "vertical" | "horizontal"; boundary: number; edges: SharedEdge[] }
  ): void {
    const MIN_SIZE = 100;

    sash.addEventListener("pointerdown", (downEvent: PointerEvent) => {
      downEvent.preventDefault();
      downEvent.stopPropagation();
      if (sash.setPointerCapture) {
        sash.setPointerCapture(downEvent.pointerId);
      }

      // Collect all panels on each side of the boundary
      const aSideIds = new Set<string>();
      const bSideIds = new Set<string>();
      for (const edge of group.edges) {
        aSideIds.add(edge.cardAId);
        bSideIds.add(edge.cardBId);
      }

      type PanelSnap = {
        panel: CardState;
        fp: CardFrame;
        startX: number; startY: number;
        startW: number; startH: number;
      };
      const aPanels: PanelSnap[] = [];
      const bPanels: PanelSnap[] = [];

      for (const id of aSideIds) {
        const panel = this.deckState.cards.find((p) => p.id === id);
        const fp = this.cardFrames.get(id);
        if (panel && fp) {
          aPanels.push({
            panel, fp,
            startX: panel.position.x, startY: panel.position.y,
            startW: panel.size.width, startH: panel.size.height,
          });
        }
      }
      for (const id of bSideIds) {
        const panel = this.deckState.cards.find((p) => p.id === id);
        const fp = this.cardFrames.get(id);
        if (panel && fp) {
          bPanels.push({
            panel, fp,
            startX: panel.position.x, startY: panel.position.y,
            startW: panel.size.width, startH: panel.size.height,
          });
        }
      }

      if (aPanels.length === 0 || bPanels.length === 0) return;

      const startClientX = downEvent.clientX;
      const startClientY = downEvent.clientY;

      const onMove = (e: PointerEvent) => {
        if (group.axis === "vertical") {
          let dx = e.clientX - startClientX;
          // Clamp: all A-side panels must stay >= MIN_SIZE width
          for (const s of aPanels) {
            dx = Math.max(dx, -(s.startW - MIN_SIZE));
          }
          // Clamp: all B-side panels must stay >= MIN_SIZE width
          for (const s of bPanels) {
            dx = Math.min(dx, s.startW - MIN_SIZE);
          }

          for (const s of aPanels) {
            s.fp.updateSize(s.startW + dx, s.startH);
          }
          for (const s of bPanels) {
            s.fp.updatePosition(s.startX + dx, s.startY);
            s.fp.updateSize(s.startW - dx, s.startH);
          }
        } else {
          let dy = e.clientY - startClientY;
          // Clamp: all A-side panels must stay >= MIN_SIZE height
          for (const s of aPanels) {
            dy = Math.max(dy, -(s.startH - MIN_SIZE));
          }
          // Clamp: all B-side panels must stay >= MIN_SIZE height
          for (const s of bPanels) {
            dy = Math.min(dy, s.startH - MIN_SIZE);
          }

          for (const s of aPanels) {
            s.fp.updateSize(s.startW, s.startH + dy);
          }
          for (const s of bPanels) {
            s.fp.updatePosition(s.startX, s.startY + dy);
            s.fp.updateSize(s.startW, s.startH - dy);
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

        // Notify all affected cards so both sides live-resize
        for (const s of [...aPanels, ...bPanels]) {
          const card = this.cardRegistry.get(s.panel.activeTabId);
          if (card) {
            card.onResize(s.panel.size.width, s.panel.size.height - CARD_TITLE_BAR_HEIGHT);
          }
        }
      };

      const onUp = (_e: PointerEvent) => {
        if (sash.releasePointerCapture) {
          sash.releasePointerCapture(downEvent.pointerId);
        }
        sash.removeEventListener("pointermove", onMove);
        sash.removeEventListener("pointerup", onUp);
        sash.removeEventListener("pointercancel", onUp);

        // Notify all affected cards of final sizes
        for (const s of [...aPanels, ...bPanels]) {
          const card = this.cardRegistry.get(s.panel.activeTabId);
          if (card) {
            card.onResize(s.panel.size.width, s.panel.size.height - CARD_TITLE_BAR_HEIGHT);
          }
        }

        this.recomputeSets();
        this.ensureSetAdjacency();
        this.scheduleSave();
      };

      sash.addEventListener("pointermove", onMove);
      sash.addEventListener("pointerup", onUp);
      sash.addEventListener("pointercancel", onUp);
    });
  }

  /**
   * Route keyboard focus to the key panel's active card.
   * Called after any focus change so the key panel always receives key events.
   */
  private focusKeyPanelCard(): void {
    if (!this.keyPanelId) return;
    const panel = this.deckState.cards.find((p) => p.id === this.keyPanelId);
    if (!panel) return;
    const card = this.cardRegistry.get(panel.activeTabId);
    if (card?.focus) {
      card.focus();
    }
  }

  /** Handle keyboard shortcuts at document level. */
  private handleKeyDown(e: KeyboardEvent): void {
    // Control+` or Control+~ for panel focus cycling
    if (e.ctrlKey && (e.key === "`" || e.key === "~")) {
      e.preventDefault();
      this.cyclePanelFocus();
    }
  }

  /**
   * Cycle panel focus: bring the backmost panel to front.
   * Repeated presses rotate through all panels in z-order.
   * When the target panel is in a set, focus the set leader (topmost Y)
   * so the key tint highlights the most prominent title bar.
   */
  private cyclePanelFocus(): void {
    const panels = this.deckState.cards;
    if (panels.length === 0) return;

    let targetId = panels[0].id;

    // If the target is in a set, focus the leader (smallest Y, then X)
    const targetSet = this.sets.find((s) => s.cardIds.includes(targetId));
    if (targetSet) {
      let leaderY = Infinity;
      let leaderX = Infinity;
      for (const id of targetSet.cardIds) {
        const p = panels.find((pp) => pp.id === id);
        if (p && (p.position.y < leaderY || (p.position.y === leaderY && p.position.x < leaderX))) {
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
    "code", "terminal", "git", "files", "stats",
  ]);

  /**
   * Whether a panel accepts key status (title bar tint + key events).
   * Most panels are key-capable; stats is the exception (display-only).
   */
  private acceptsKey(panelId: string): boolean {
    const panel = this.deckState.cards.find((p) => p.id === panelId);
    if (!panel) return false;
    const componentId = panel.tabs[0]?.componentId;
    return componentId !== undefined && DeckManager.KEY_CAPABLE.has(componentId);
  }

  /**
   * Destroy all current cards and clear all tracking maps.
   * Used internally by resetLayout.
   */
  private destroyAllCards(): void {
    for (const ro of this.resizeObservers.values()) {
      ro.disconnect();
    }
    this.resizeObservers.clear();

    for (const card of this.cardRegistry.values()) {
      card.destroy();
    }
    this.cardRegistry.clear();
    this.cardContainers.clear();

    for (const set of this.cardsByFeed.values()) {
      set.clear();
    }
  }

  destroy(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    for (const ro of this.resizeObservers.values()) {
      ro.disconnect();
    }
    this.resizeObservers.clear();
    for (const tb of this.tabBars.values()) {
      tb.destroy();
    }
    this.tabBars.clear();
    for (const fp of this.cardFrames.values()) {
      fp.destroy();
    }
    this.cardFrames.clear();
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
