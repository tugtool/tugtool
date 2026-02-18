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

    // Create root container element
    this.rootEl = document.createElement("div");
    this.rootEl.className = "panel-root";
    this.rootEl.style.width = "100%";
    this.rootEl.style.height = "100%";
    container.appendChild(this.rootEl);

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

      // Remove the tab from the layout tree (L01.6: empty TabNode is removed
      // and topology is re-normalized by removeTab -> normalizeTree)
      this.dockState = {
        ...this.dockState,
        root: removeTab(this.dockState.root, tabItemId) ?? this.dockState.root,
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
    // Clear root element but preserve card mount containers in the map
    this.rootEl.innerHTML = "";

    this.renderNode(this.dockState.root, this.rootEl);

    // After render, run geometric minimum enforcement (L01.7)
    this.enforceGeometricMinimums();
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
   * For single-tab nodes: mount the card directly.
   * For multi-tab nodes (future step): only the active tab is visible,
   * inactive tabs are hidden with display:none but remain in DOM (D09).
   */
  private renderTabNode(node: TabNode, parentEl: HTMLElement): void {
    const containerEl = document.createElement("div");
    containerEl.className = "panel-card-container";
    parentEl.appendChild(containerEl);

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

      // Reparent into the current container (D09: appendChild, not recreate)
      containerEl.appendChild(mountEl);

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

  destroy(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    for (const ro of this.resizeObservers.values()) {
      ro.disconnect();
    }
    this.resizeObservers.clear();
    for (const card of this.cardRegistry.values()) {
      card.destroy();
    }
    this.cardRegistry.clear();
    window.removeEventListener("resize", () => this.handleResize());
  }
}
