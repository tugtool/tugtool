/**
 * PanelManager — replaces DeckManager.
 *
 * Owns the layout tree, renders it as nested flex containers, dispatches frames
 * to cards via manager-level fan-out (D10), implements IDragState for card
 * coupling (D05), and preserves card instance identity during layout mutations (D09).
 */

import { IDragState } from "./drag-state";
import {
  type DockState,
  type LayoutNode,
  type SplitNode,
  type TabNode,
  type TabItem,
  normalizeTree,
  removeTab,
  findTabNode,
} from "./layout-tree";
import {
  buildDefaultLayout,
  serialize,
  deserialize,
  validateDockState,
} from "./serialization";
import { TugCard } from "./cards/card";
import { FeedId, FeedIdValue } from "./protocol";
import { TugConnection } from "./connection";
import { createSash } from "./sash";
import { TabBar } from "./tab-bar";
import { DockOverlay, computeDropZone, isCursorInsideCanvas, type TabNodeRect, type DropZoneResult } from "./dock-target";
import { insertNode } from "./layout-tree";
import { FloatingPanel } from "./floating-panel";
import type { FloatingGroup } from "./layout-tree";

/** localStorage key for layout persistence */
const LAYOUT_STORAGE_KEY = "tugdeck-layout";

/** Debounce delay for saving layout (ms) */
const SAVE_DEBOUNCE_MS = 500;

/** Minimum panel size in pixels (L01.7 geometric layer) */
const MIN_SIZE_PX = 100;

/** Maximum geometry-adjustment passes before giving up */
const MAX_GEO_PASSES = 3;

/**
 * Output feed IDs that cards subscribe to.
 * We register exactly ONE callback per output feedId with the connection (D10).
 * Input feedIds (TERMINAL_INPUT, TERMINAL_RESIZE, CONVERSATION_INPUT, HEARTBEAT)
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
  FeedId.CONVERSATION_OUTPUT,
];

/**
 * PanelManager renders the layout tree from layout-tree.ts as nested flex
 * containers with sash resizing between siblings.
 *
 * Implements IDragState so cards can query drag state without importing the
 * full manager.
 */
export class PanelManager implements IDragState {
  private container: HTMLElement;
  private connection: TugConnection;

  /** Current dock state (tree + floating panels) */
  private dockState: DockState;

  /** D10: one Set<TugCard> per output feedId */
  private cardsByFeed: Map<FeedIdValue, Set<TugCard>> = new Map();

  /**
   * Registry mapping TabItem.id -> TugCard instance.
   * Used to mount cards into the correct containers during renderTree.
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
   * TabBar instances keyed by TabNode.id.
   * Destroyed and recreated on render; exposed for step 3 dock targeting.
   */
  private tabBars: Map<string, TabBar> = new Map();

  /** Drop zone overlay (created once in constructor). */
  private overlay!: DockOverlay;

  /** Drag ghost element (created per drag session). */
  private dragGhost: HTMLElement | null = null;

  /** Active drag session info. */
  private dragSource: {
    tabNodeId: string;
    tabId: string;
    tabIndex: number;
    card: TugCard | null;
    /** 'docked' for tab-bar drag-out; 'floating' for floating panel title-bar drag */
    sourceType: "docked" | "floating";
    /** Cached rects at drag start for 60fps performance */
    canvasRect: DOMRect;
    tabNodeRects: TabNodeRect[];
  } | null = null;

  /** FloatingPanel instances keyed by TabNode.id of their node */
  private floatingPanels: Map<string, FloatingPanel> = new Map();

  /** Next z-index value for floating panel focus management */
  private nextZIndex = 100;

  /** Last computed drop zone during an active drag. */
  private currentDropZone: DropZoneResult | null = null;

  /** Document-level listeners registered during drag (cleaned up on end). */
  private dragMoveHandler: ((e: PointerEvent) => void) | null = null;
  private dragUpHandler: ((e: PointerEvent) => void) | null = null;
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;

  /** D05: drag state flag */
  private _isDragging = false;

  /** Debounce timer for layout saves */
  private saveTimer: number | null = null;

  /** Root panel DOM element */
  private rootEl: HTMLElement;

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
    this.rootEl.className = "panel-root";
    this.rootEl.style.width = "100%";
    this.rootEl.style.height = "100%";
    container.appendChild(this.rootEl);

    // Create dock overlay (single instance, reused across drags)
    this.overlay = new DockOverlay(container);

    // Load or build the initial layout
    this.dockState = this.loadLayout();

    // Initial render
    this.render();

    // Listen for window resize
    window.addEventListener("resize", () => this.handleResize());
  }

  // ---- IDragState ----

  get isDragging(): boolean {
    return this._isDragging;
  }

  // ---- Card Registration ----

  /**
   * Register a card with the manager.
   *
   * PanelManager searches the layout tree for a TabItem whose componentId
   * matches the provided componentId. The card is added to the fan-out sets
   * for each of its feedIds, then mounted into the matching container.
   *
   * @param card - The card instance
   * @param componentId - Component identifier (e.g. "conversation", "terminal")
   */
  addCard(card: TugCard, componentId: string): void {
    // Find the matching TabItem in the layout tree
    const tabItem = this.findTabItemByComponentId(this.dockState.root, componentId);
    if (!tabItem) {
      console.warn(`PanelManager.addCard: no TabItem found for componentId "${componentId}"`);
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
    }
  }

  /**
   * Remove a card: removes from fan-out sets, calls card.destroy(), removes from tree.
   *
   * @param card - The card instance to remove
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

      // Remove the tab from the docked layout tree (L01.6: empty TabNode is removed
      // and topology is re-normalized by removeTab -> normalizeTree).
      // Also filter out any FloatingGroup whose node contains this tab, preventing
      // phantom empty floating panels after card destruction.
      this.dockState = {
        root: removeTab(this.dockState.root, tabItemId) ?? this.dockState.root,
        floating: this.dockState.floating.filter(
          (fg) => !fg.node.tabs.some((t) => t.id === tabItemId)
        ),
      };
    }

    // Destroy the card
    card.destroy();

    // Re-render and persist the updated tree
    this.render();
    this.scheduleSave();
  }

  // ---- Rendering ----

  /**
   * Re-render the entire layout tree.
   *
   * Clears the root element and rebuilds nested flex containers.
   * Existing card mount containers (from cardContainers map) are reparented
   * rather than recreated (D09 instance identity).
   */
  private render(): void {
    // Destroy existing TabBar instances before clearing the DOM
    for (const tb of this.tabBars.values()) {
      tb.destroy();
    }
    this.tabBars.clear();

    // Clear root element but preserve card mount containers in the map
    this.rootEl.innerHTML = "";

    this.renderNode(this.dockState.root, this.rootEl);

    // After render, run geometric minimum enforcement (L01.7)
    this.enforceGeometricMinimums();

    // Render floating panels
    this.renderFloatingPanels();
  }

  private renderFloatingPanels(): void {
    // Destroy old FloatingPanel DOM instances
    for (const fp of this.floatingPanels.values()) {
      fp.destroy();
    }
    this.floatingPanels.clear();

    for (const fg of this.dockState.floating) {
      const nodeId = fg.node.id;
      const fp = new FloatingPanel(fg, {
        onMoveEnd: (x, y) => {
          fg.position = { x, y };
          this.scheduleSave();
        },
        onResizeEnd: (x, y, width, height) => {
          fg.position = { x, y };
          fg.size = { width, height };
          // Notify the active card of its new size
          const activeTab = fg.node.tabs[fg.node.activeTabIndex];
          if (activeTab) {
            const card = this.cardRegistry.get(activeTab.id);
            if (card) card.onResize(width, height - 28); // subtract title bar
          }
          this.scheduleSave();
        },
        onFocus: () => {
          fp.setZIndex(++this.nextZIndex);
        },
        onDragOut: (startEvent: PointerEvent) => {
          // Re-dock drag: floating panel title bar dragged over dock zones
          const activeTab = fg.node.tabs[fg.node.activeTabIndex];
          if (!activeTab) return;
          this.handleFloatingDragOut(nodeId, activeTab.id, 0, startEvent);
        },
      }, this.container);

      fp.setZIndex(this.nextZIndex);
      this.container.appendChild(fp.getElement());
      this.floatingPanels.set(nodeId, fp);

      // Mount the card into the floating panel's card area via D09 reparenting
      for (const tab of fg.node.tabs) {
        const isActive = fg.node.tabs.indexOf(tab) === fg.node.activeTabIndex;
        let mountEl = this.cardContainers.get(tab.id);
        if (!mountEl) {
          mountEl = document.createElement("div");
          mountEl.className = "panel-card-mount";
          this.cardContainers.set(tab.id, mountEl);
        }
        mountEl.style.display = isActive ? "block" : "none";
        mountEl.style.width = "100%";
        mountEl.style.height = "100%";
        mountEl.style.overflow = "hidden";
        fp.getCardAreaElement().appendChild(mountEl);

        const card = this.cardRegistry.get(tab.id);
        if (card && mountEl.children.length === 0) {
          card.mount(mountEl);
          this.observeContainer(tab.id, mountEl, card);
        }
      }
    }
  }

  /**
   * Recursively render a layout node into parentEl.
   */
  private renderNode(node: LayoutNode, parentEl: HTMLElement): void {
    if (node.type === "split") {
      this.renderSplit(node, parentEl);
    } else {
      this.renderTabNode(node, parentEl);
    }
  }

  /**
   * Render a SplitNode as a flex container with sashes between children.
   */
  private renderSplit(node: SplitNode, parentEl: HTMLElement): void {
    const splitEl = document.createElement("div");
    splitEl.className =
      node.orientation === "horizontal"
        ? "panel-split panel-split-horizontal"
        : "panel-split panel-split-vertical";

    parentEl.appendChild(splitEl);

    // Collect child wrapper elements for sash callback
    const childWrappers: HTMLElement[] = [];

    for (let i = 0; i < node.children.length; i++) {
      const weight = node.weights[i] ?? 1 / node.children.length;
      const childWrapper = document.createElement("div");
      childWrapper.className = "panel-split-child";
      childWrapper.style.flex = `${weight} 1 0`;
      // Prevent flex children from overflowing
      childWrapper.style.overflow = "hidden";
      childWrapper.style.minWidth = "0";
      childWrapper.style.minHeight = "0";

      splitEl.appendChild(childWrapper);
      childWrappers.push(childWrapper);

      this.renderNode(node.children[i], childWrapper);

      // Insert sash between siblings
      if (i < node.children.length - 1) {
        const sashEl = createSash(
          node.orientation,
          i,
          () => this.getNodeWeights(node),
          () => childWrappers,
          () => splitEl,
          () => {
            this._isDragging = true;
          },
          (finalWeights: number[]) => {
            this._isDragging = false;
            // Update the node's weights in the tree
            this.applySashWeights(node, finalWeights);
            // Normalize and save
            const normalized = normalizeTree(this.dockState.root);
            if (normalized) {
              this.dockState = { ...this.dockState, root: normalized };
            }
            this.scheduleSave();
            // Re-render to reflect updated weights
            this.render();
            this.handleResize();
          },
          (liveWeights: number[]) => {
            // Update wrapper flex values in real-time (already done in createSash)
            this.applyLiveWeights(childWrappers, liveWeights);
          }
        );
        splitEl.appendChild(sashEl);
      }
    }
  }

  /**
   * Render a TabNode as a card container.
   *
   * Single-tab: no tab bar; card fills the entire container.
   * Multi-tab: TabBar at top (28px, flex-shrink:0), card area below (flex:1).
   * Inactive tabs are hidden with display:none but remain in DOM (D09).
   */
  private renderTabNode(node: TabNode, parentEl: HTMLElement): void {
    const containerEl = document.createElement("div");
    containerEl.className = "panel-card-container";
    // data-tab-node-id enables TabNodeRect collection during drag
    containerEl.dataset.tabNodeId = node.id;
    parentEl.appendChild(containerEl);

    // Create the card area wrapper — all mount elements live inside this.
    const cardAreaEl = document.createElement("div");
    cardAreaEl.className = "panel-card-area";
    containerEl.appendChild(cardAreaEl);

    // Create TabBar for multi-tab nodes (single-tab nodes get no tab bar).
    if (node.tabs.length > 1) {
      const tabBar = new TabBar(node, {
        onTabActivate: (tabIndex: number) => {
          this.handleTabActivate(node, tabIndex);
        },
        onTabClose: (tabId: string) => {
          this.handleTabClose(tabId);
        },
        onTabReorder: (fromIndex: number, toIndex: number) => {
          this.handleTabReorder(node, fromIndex, toIndex);
        },
        onDragOut: (tabId: string, tabIndex: number, startEvent: PointerEvent) => {
          this.handleDragOut(node.id, tabId, tabIndex, startEvent);
        },
      });
      // Tab bar is inserted BEFORE the card area in the flex column
      containerEl.insertBefore(tabBar.getElement(), cardAreaEl);
      this.tabBars.set(node.id, tabBar);
    }

    // Render each tab's card mount inside the card area
    for (let i = 0; i < node.tabs.length; i++) {
      const tab = node.tabs[i];
      const isActive = i === node.activeTabIndex;

      // Reuse existing mount container (D09) or create a new one
      let mountEl = this.cardContainers.get(tab.id);
      if (!mountEl) {
        mountEl = document.createElement("div");
        mountEl.className = "panel-card-mount";
        this.cardContainers.set(tab.id, mountEl);
      }

      // Reparent into the card area (D09: appendChild preserves card DOM)
      cardAreaEl.appendChild(mountEl);

      // Show/hide based on active tab
      mountEl.style.display = isActive ? "block" : "none";
      mountEl.style.width = "100%";
      mountEl.style.height = "100%";
      mountEl.style.overflow = "hidden";

      // Mount the card if registered and not yet mounted
      const card = this.cardRegistry.get(tab.id);
      if (card && mountEl.children.length === 0) {
        card.mount(mountEl);
        this.observeContainer(tab.id, mountEl, card);
      }
    }
  }

  // ---- Tab bar callbacks ----

  /**
   * Switch the active tab in a TabNode.
   *
   * Hides the previous active card (display:none), shows the new one
   * (display:block), then fires a mandatory onResize so cards like
   * xterm.js FitAddon can recover from the zero-size hidden state (D09).
   */
  private handleTabActivate(node: TabNode, newIndex: number): void {
    if (newIndex === node.activeTabIndex) return;
    if (newIndex < 0 || newIndex >= node.tabs.length) return;

    // Hide current active tab's mount element
    const prevTab = node.tabs[node.activeTabIndex];
    const prevMountEl = this.cardContainers.get(prevTab.id);
    if (prevMountEl) {
      prevMountEl.style.display = "none";
    }

    // Update tree state
    node.activeTabIndex = newIndex;

    // Show newly active tab's mount element
    const newTab = node.tabs[newIndex];
    const newMountEl = this.cardContainers.get(newTab.id);
    if (newMountEl) {
      newMountEl.style.display = "block";

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
    const tabBar = this.tabBars.get(node.id);
    if (tabBar) {
      tabBar.update(node);
    }

    this.scheduleSave();
  }

  /**
   * Close a tab: remove the card instance, update the tree, re-render.
   *
   * removeCard() calls removeTab() (which normalizes the tree), then calls
   * render() and scheduleSave(). No extra work needed here.
   */
  private handleTabClose(tabId: string): void {
    const card = this.cardRegistry.get(tabId);
    if (card) {
      this.removeCard(card);
    }
  }

  /**
   * Reorder tabs within a TabNode.
   *
   * Moves tabs[fromIndex] to toIndex, adjusts activeTabIndex, refreshes
   * the TabBar, and schedules a layout save. Does NOT do a full re-render.
   */
  private handleTabReorder(node: TabNode, fromIndex: number, toIndex: number): void {
    if (
      fromIndex < 0 ||
      fromIndex >= node.tabs.length ||
      toIndex < 0 ||
      toIndex >= node.tabs.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    const [moved] = node.tabs.splice(fromIndex, 1);
    node.tabs.splice(toIndex, 0, moved);

    // Adjust activeTabIndex to follow the moved tab if it was active,
    // or shift it to stay on the same logical tab.
    if (node.activeTabIndex === fromIndex) {
      node.activeTabIndex = toIndex;
    } else if (fromIndex < node.activeTabIndex && toIndex >= node.activeTabIndex) {
      node.activeTabIndex -= 1;
    } else if (fromIndex > node.activeTabIndex && toIndex <= node.activeTabIndex) {
      node.activeTabIndex += 1;
    }

    // Refresh tab bar visuals only (no full tree re-render needed)
    const tabBar = this.tabBars.get(node.id);
    if (tabBar) {
      tabBar.update(node);
    }

    this.scheduleSave();
  }

  // ---- Drag-and-drop lifecycle ----

  /**
   * Called by TabBar.onDragOut when a tab is dragged outside the tab bar.
   * Transitions from within-bar reorder to dock targeting drag mode.
   */
  private handleDragOut(
    tabNodeId: string,
    tabId: string,
    tabIndex: number,
    startEvent: PointerEvent
  ): void {
    this._isDragging = true;

    // Find the card registered for this tab item
    const card = this.cardRegistry.get(tabId) ?? null;

    // Collect TabNodeRects at drag start (cached for 60fps during drag)
    const canvasRect = this.container.getBoundingClientRect();
    const tabNodeRects = this.collectTabNodeRects();

    this.dragSource = { tabNodeId, tabId, tabIndex, card, sourceType: "docked", canvasRect, tabNodeRects };
    this.currentDropZone = null;

    // Create drag ghost tracking the cursor
    this.dragGhost = this.createDragGhost(tabId, startEvent);

    // Register Escape key handler
    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this.cancelDrag();
      }
    };
    document.addEventListener("keydown", this.escapeHandler);

    // Register document-level pointer handlers (BEFORE pointer capture is fully released
    // by the tab element, so no events are lost)
    this.dragMoveHandler = (e: PointerEvent) => this.onDragMove(e);
    this.dragUpHandler = (e: PointerEvent) => this.onDragUp(e);
    document.addEventListener("pointermove", this.dragMoveHandler);
    document.addEventListener("pointerup", this.dragUpHandler);
  }

  /**
   * Called by FloatingPanel.onDragOut when a floating panel's title bar is dragged.
   * Sets up document-level pointer listeners to handle re-dock targeting.
   */
  private handleFloatingDragOut(
    tabNodeId: string,
    tabId: string,
    tabIndex: number,
    startEvent: PointerEvent
  ): void {
    this._isDragging = true;

    const card = this.cardRegistry.get(tabId) ?? null;
    const canvasRect = this.container.getBoundingClientRect();
    const tabNodeRects = this.collectTabNodeRects();

    this.dragSource = {
      tabNodeId,
      tabId,
      tabIndex,
      card,
      sourceType: "floating",
      canvasRect,
      tabNodeRects,
    };
    this.currentDropZone = null;

    this.dragGhost = this.createDragGhost(tabId, startEvent);

    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.cancelDrag();
    };
    document.addEventListener("keydown", this.escapeHandler);

    this.dragMoveHandler = (e: PointerEvent) => this.onDragMove(e);
    this.dragUpHandler = (e: PointerEvent) => this.onDragUp(e);
    document.addEventListener("pointermove", this.dragMoveHandler);
    document.addEventListener("pointerup", this.dragUpHandler);
  }

  /**
   * Undock a tab from the docked tree and create a floating panel at the cursor.
   * Card instance is preserved via D09 reparenting.
   */
  private undockToFloating(
    source: NonNullable<typeof this.dragSource>,
    cursorX: number,
    cursorY: number
  ): void {
    const sourceNode = findTabNode(this.dockState.root, source.tabNodeId);
    if (!sourceNode) { this.render(); return; }

    const sourceTabItem = sourceNode.tabs.find((t) => t.id === source.tabId);
    if (!sourceTabItem) { this.render(); return; }

    // Remove tab from source tree
    let newRoot: import("./layout-tree").LayoutNode;
    if (sourceNode.tabs.length > 1) {
      const newTabs = sourceNode.tabs.filter((t) => t.id !== source.tabId);
      newRoot = replaceTabNodeTabs(this.dockState.root, source.tabNodeId, newTabs,
        Math.min(sourceNode.activeTabIndex, newTabs.length - 1));
    } else {
      newRoot = removeTab(this.dockState.root, source.tabId) ?? this.dockState.root;
    }

    const normalized = normalizeTree(newRoot);

    // Place floating panel at cursor (offset so panel appears under cursor)
    const canvasRect = this.container.getBoundingClientRect();
    const FLOAT_W = 400;
    const FLOAT_H = 300;
    const floatX = Math.max(0, Math.min(canvasRect.width - FLOAT_W, cursorX - canvasRect.left - FLOAT_W / 2));
    const floatY = Math.max(0, Math.min(canvasRect.height - FLOAT_H, cursorY - canvasRect.top - 14));

    // Build FloatingGroup using the source TabItem
    const floatingTabNode: import("./layout-tree").TabNode = {
      type: "tab",
      id: crypto.randomUUID(),
      tabs: [sourceTabItem],
      activeTabIndex: 0,
    };
    const newFloatingGroup: FloatingGroup = {
      position: { x: floatX, y: floatY },
      size: { width: FLOAT_W, height: FLOAT_H },
      node: floatingTabNode,
    };

    this.dockState = {
      root: normalized ?? newRoot,
      floating: [...this.dockState.floating, newFloatingGroup],
    };

    this.render();

    // Notify the card of its new size
    if (source.card) {
      source.card.onResize(FLOAT_W, FLOAT_H - 28);
    }

    this.scheduleSave();
  }

  private onDragMove(e: PointerEvent): void {
    if (!this.dragSource) return;

    // Update ghost position
    if (this.dragGhost) {
      this.dragGhost.style.left = `${e.clientX - this.dragSource.canvasRect.left + 10}px`;
      this.dragGhost.style.top = `${e.clientY - this.dragSource.canvasRect.top + 10}px`;
    }

    // Compute drop zone using cached rects
    const result = computeDropZone(
      e.clientX,
      e.clientY,
      this.dragSource.canvasRect,
      this.dragSource.tabNodeRects
    );

    this.currentDropZone = result;

    if (result) {
      this.overlay.show(result.overlayRect);
    } else {
      this.overlay.hide();
    }
  }

  private onDragUp(e: PointerEvent): void {
    if (!this.dragSource) return;

    // Compute final drop zone at release position
    const finalZone = computeDropZone(
      e.clientX,
      e.clientY,
      this.dragSource.canvasRect,
      this.dragSource.tabNodeRects
    );

    const source = this.dragSource;
    this.cleanupDrag();

    if (!finalZone) {
      if (isCursorInsideCanvas(e.clientX, e.clientY, source.canvasRect)) {
        // Dropped inside canvas but not on a dock zone -> undock to floating
        this.undockToFloating(source, e.clientX, e.clientY);
      } else {
        // Dropped outside canvas -> cancel
        this.render();
      }
      return;
    }

    this.executeDrop(source, finalZone);
  }

  private cancelDrag(): void {
    this.cleanupDrag();
    // Re-render to restore original card positions (tree was not mutated)
    this.render();
  }

  /**
   * Execute the drop: remove the tab from the source TabNode (if multi-tab),
   * insert it at the drop target via insertNode, then re-render.
   * Card instance is preserved throughout (D09).
   */
  private executeDrop(
    source: NonNullable<typeof this.dragSource>,
    result: DropZoneResult
  ): void {
    let sourceTabItem: import("./layout-tree").TabItem | undefined;
    let newRoot: import("./layout-tree").LayoutNode = this.dockState.root;
    let newFloating: FloatingGroup[] = this.dockState.floating;

    if (source.sourceType === "floating") {
      // Find the FloatingGroup containing this tab
      const fgIndex = this.dockState.floating.findIndex(
        (fg) => fg.node.id === source.tabNodeId
      );
      if (fgIndex === -1) { this.render(); return; }
      const fg = this.dockState.floating[fgIndex];
      sourceTabItem = fg.node.tabs.find((t) => t.id === source.tabId);
      if (!sourceTabItem) { this.render(); return; }

      // Remove from floating array (whole group; floating panels are single-tab for now)
      newFloating = this.dockState.floating.filter((_, i) => i !== fgIndex);
    } else {
      // Docked source
      const sourceNode = findTabNode(this.dockState.root, source.tabNodeId);
      if (!sourceNode) { this.render(); return; }

      sourceTabItem = sourceNode.tabs.find((t) => t.id === source.tabId);
      if (!sourceTabItem) { this.render(); return; }

      if (sourceNode.tabs.length > 1) {
        const newTabs = sourceNode.tabs.filter((t) => t.id !== source.tabId);
        const newActiveIndex = Math.min(sourceNode.activeTabIndex, newTabs.length - 1);
        newRoot = replaceTabNodeTabs(this.dockState.root, source.tabNodeId, newTabs, newActiveIndex);
      } else {
        newRoot = removeTab(this.dockState.root, source.tabId) ?? this.dockState.root;
      }
    }

    // Insert the tab at the drop target
    newRoot = insertNode(newRoot, result.targetTabNodeId, result.zone, sourceTabItem);

    // Normalize the tree
    const normalized = normalizeTree(newRoot);
    this.dockState = { root: normalized ?? newRoot, floating: newFloating };

    // Re-render (D09: renderTabNode reuses existing mount element for sourceTabItem.id)
    this.render();
    this.scheduleSave();
  }

  private cleanupDrag(): void {
    this._isDragging = false;
    this.dragSource = null;
    this.currentDropZone = null;

    if (this.dragGhost) {
      this.dragGhost.remove();
      this.dragGhost = null;
    }

    this.overlay.hideNow();

    if (this.dragMoveHandler) {
      document.removeEventListener("pointermove", this.dragMoveHandler);
      this.dragMoveHandler = null;
    }
    if (this.dragUpHandler) {
      document.removeEventListener("pointerup", this.dragUpHandler);
      this.dragUpHandler = null;
    }
    if (this.escapeHandler) {
      document.removeEventListener("keydown", this.escapeHandler);
      this.escapeHandler = null;
    }
  }

  /**
   * Collect bounding rects for all docked TabNodes.
   * Reads data-tab-node-id attributes stamped on panel-card-container elements.
   */
  private collectTabNodeRects(): TabNodeRect[] {
    const containers = Array.from(
      this.rootEl.querySelectorAll<HTMLElement>("[data-tab-node-id]")
    );
    return containers.map((el) => {
      const tabNodeId = el.dataset.tabNodeId!;
      const tabNode = findTabNode(this.dockState.root, tabNodeId);
      const tabBarHeight = tabNode && tabNode.tabs.length > 1 ? 28 : 0;
      return {
        tabNodeId,
        rect: el.getBoundingClientRect(),
        tabBarHeight,
      };
    });
  }

  /**
   * Create a lightweight drag ghost tracking the cursor.
   * Shows the title of the dragged tab.
   */
  private createDragGhost(tabId: string, startEvent: PointerEvent): HTMLElement {
    const ghost = document.createElement("div");
    ghost.className = "dock-drag-ghost";

    // Find the tab title
    const tabItem = this.findTabItemById(this.dockState.root, tabId);
    ghost.textContent = tabItem?.title ?? "Tab";

    // Position at cursor
    const canvasRect = this.container.getBoundingClientRect();
    ghost.style.left = `${startEvent.clientX - canvasRect.left + 10}px`;
    ghost.style.top = `${startEvent.clientY - canvasRect.top + 10}px`;

    this.container.appendChild(ghost);
    return ghost;
  }

  private findTabItemById(node: import("./layout-tree").LayoutNode, tabId: string): TabItem | null {
    if (node.type === "tab") {
      return node.tabs.find((t) => t.id === tabId) ?? null;
    }
    for (const child of node.children) {
      const found = this.findTabItemById(child, tabId);
      if (found) return found;
    }
    return null;
  }

  // ---- Geometric Minimum Enforcement (L01.7, geometric layer) ----

  /**
   * After renderTree(), walk rendered DOM and verify each docked container
   * is at least MIN_SIZE_PX in each dimension. If not, adjust the parent
   * SplitNode's weights and re-render.
   *
   * Guards against infinite loops with MAX_GEO_PASSES.
   */
  private enforceGeometricMinimums(pass: number = 0): void {
    if (pass >= MAX_GEO_PASSES) return;

    let adjusted = false;
    adjusted = this.checkAndAdjustSplit(this.dockState.root, adjusted);

    if (adjusted) {
      // Re-render and check again
      this.rootEl.innerHTML = "";
      this.renderNode(this.dockState.root, this.rootEl);
      this.enforceGeometricMinimums(pass + 1);
    }
  }

  /**
   * Walk the tree looking for split nodes where a child container is under
   * MIN_SIZE_PX. Adjust weights proportionally.
   */
  private checkAndAdjustSplit(node: LayoutNode, adjusted: boolean): boolean {
    if (node.type === "tab") return adjusted;

    // Check each child's actual pixel size
    const splitEl = this.findSplitElement(node);
    if (!splitEl) return adjusted;

    const children = Array.from(
      splitEl.querySelectorAll(":scope > .panel-split-child")
    ) as HTMLElement[];

    if (children.length !== node.children.length) return adjusted;

    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      const size =
        node.orientation === "horizontal" ? rect.width : rect.height;

      if (size < MIN_SIZE_PX && size > 0) {
        // Redistribute: give this child more weight, take from the largest neighbor
        const shortfall = (MIN_SIZE_PX - size) / (
          node.orientation === "horizontal"
            ? (splitEl.getBoundingClientRect().width || 1)
            : (splitEl.getBoundingClientRect().height || 1)
        );

        // Find the neighbor with the most weight to take from
        let largestIdx = i === 0 ? 1 : 0;
        for (let j = 0; j < node.weights.length; j++) {
          if (j !== i && node.weights[j] > node.weights[largestIdx]) {
            largestIdx = j;
          }
        }

        const newWeights = [...node.weights];
        newWeights[i] += shortfall;
        newWeights[largestIdx] = Math.max(0, newWeights[largestIdx] - shortfall);

        // Renormalize
        const total = newWeights.reduce((s, w) => s + w, 0);
        node.weights = total > 0 ? newWeights.map((w) => w / total) : newWeights;

        adjusted = true;
      }

      // Recurse into children
      adjusted = this.checkAndAdjustSplit(node.children[i], adjusted);
    }

    return adjusted;
  }

  /**
   * Find the rendered split element that corresponds to a SplitNode.
   * We use a simple depth-first traversal of the panel-split elements
   * to match against the tree structure.
   */
  private findSplitElement(node: SplitNode): HTMLElement | null {
    // We can't directly associate DOM elements with tree nodes without a Map.
    // For the geometric pass, we traverse the DOM in parallel with the tree.
    return this.findSplitElementInDom(node, this.rootEl);
  }

  private findSplitElementInDom(
    node: SplitNode,
    searchRoot: HTMLElement
  ): HTMLElement | null {
    // Find all direct panel-split elements
    const splits = Array.from(
      searchRoot.querySelectorAll(":scope > .panel-split, :scope > .panel-split-child > .panel-split")
    ) as HTMLElement[];

    for (const el of splits) {
      const childCount = el.querySelectorAll(":scope > .panel-split-child").length;
      const isHorizontal = el.classList.contains("panel-split-horizontal");
      if (
        childCount === node.children.length &&
        isHorizontal === (node.orientation === "horizontal")
      ) {
        return el;
      }
    }
    return null;
  }

  // ---- Helpers ----

  private getNodeWeights(node: SplitNode): number[] {
    return [...node.weights];
  }

  private applyLiveWeights(wrappers: HTMLElement[], weights: number[]): void {
    for (let i = 0; i < wrappers.length; i++) {
      wrappers[i].style.flex = `${weights[i]} 1 0`;
    }
  }

  private applySashWeights(node: SplitNode, weights: number[]): void {
    // Update the node's weights in place
    for (let i = 0; i < weights.length && i < node.weights.length; i++) {
      node.weights[i] = weights[i];
    }
  }

  private findTabItemByComponentId(
    node: LayoutNode,
    componentId: string
  ): TabItem | null {
    if (node.type === "tab") {
      for (const tab of node.tabs) {
        if (tab.componentId === componentId) {
          return tab;
        }
      }
      return null;
    }
    for (const child of node.children) {
      const found = this.findTabItemByComponentId(child, componentId);
      if (found) return found;
    }
    return null;
  }

  // ---- Resize Handling ----

  private observeContainer(
    tabItemId: string,
    mountEl: HTMLElement,
    card: TugCard
  ): void {
    // Disconnect any existing observer for this tabItemId
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

  private loadLayout(): DockState {
    try {
      const json = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (json) {
        const canvasWidth = this.container.clientWidth;
        const canvasHeight = this.container.clientHeight;
        return deserialize(json, canvasWidth, canvasHeight);
      }
    } catch (e) {
      console.warn("PanelManager: failed to load layout from localStorage", e);
    }
    return buildDefaultLayout();
  }

  private saveLayout(): void {
    try {
      const serialized = serialize(this.dockState);
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(serialized));
    } catch (e) {
      console.warn("PanelManager: failed to save layout to localStorage", e);
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
   * Validate and save the current dockState, then re-render.
   * Used after external tree mutations (e.g., removeTab).
   */
  applyLayout(dockState: DockState): void {
    const validated = validateDockState(
      dockState,
      this.container.clientWidth,
      this.container.clientHeight
    );
    this.dockState = validated;
    this.render();
    this.scheduleSave();
  }

  /** Expose the current dock state for testing and future steps */
  getDockState(): DockState {
    return this.dockState;
  }

  /** Expose card registry for testing */
  getCardRegistry(): Map<string, TugCard> {
    return this.cardRegistry;
  }

  /** Expose cardsByFeed for testing */
  getCardsByFeed(): Map<FeedIdValue, Set<TugCard>> {
    return this.cardsByFeed;
  }

  /**
   * Expose tab bar instances for step 3 dock targeting.
   * Returns the TabBar for a given TabNode.id, or undefined if none.
   */
  getTabBar(tabNodeId: string): TabBar | undefined {
    return this.tabBars.get(tabNodeId);
  }

  /**
   * Find a TabNode in the current tree by id (thin wrapper around findTabNode).
   * Useful for step 3 where dock-target.ts needs TabNode references.
   */
  findTabNodeById(tabNodeId: string): import("./layout-tree").TabNode | null {
    return findTabNode(this.dockState.root, tabNodeId);
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
    for (const card of this.cardRegistry.values()) {
      card.destroy();
    }
    this.cardRegistry.clear();
    this.cleanupDrag();
    this.overlay.destroy();
    window.removeEventListener("resize", () => this.handleResize());
  }
}

// ---- Module-level helpers ----

/**
 * Replace the tabs array and activeTabIndex of a specific TabNode in the tree,
 * returning a new root without modifying the original tree.
 * Used during drop execution to remove a tab from its source node.
 */
function replaceTabNodeTabs(
  node: import("./layout-tree").LayoutNode,
  targetNodeId: string,
  newTabs: import("./layout-tree").TabItem[],
  newActiveIndex: number
): import("./layout-tree").LayoutNode {
  if (node.type === "tab") {
    if (node.id === targetNodeId) {
      return { ...node, tabs: newTabs, activeTabIndex: newActiveIndex };
    }
    return node;
  }
  return {
    ...node,
    children: node.children.map((child) =>
      replaceTabNodeTabs(child, targetNodeId, newTabs, newActiveIndex)
    ),
  };
}
