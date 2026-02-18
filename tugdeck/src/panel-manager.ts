/**
 * PanelManager — canvas-based panel renderer.
 *
 * Owns a flat CanvasState (array of PanelState), renders each panel as a
 * FloatingPanel absolutely positioned on the canvas, dispatches frames
 * to cards via manager-level fan-out (D10), and implements IDragState for
 * card coupling (D05).
 *
 * [D01] Flat array replaces tree
 * [D06] Key panel focus model with title bar tint
 * [D09] Card instance identity preserved via container reparenting
 * [D10] Manager-level fan-out per feed ID
 */

import { IDragState } from "./drag-state";
import { type CanvasState, type PanelState, type TabItem, type TabNode } from "./layout-tree";
import { buildDefaultLayout, serialize, deserialize } from "./serialization";
import { TugCard } from "./cards/card";
import { FeedId, FeedIdValue } from "./protocol";
import { TugConnection } from "./connection";
import { TabBar } from "./tab-bar";
import { FloatingPanel, FLOATING_TITLE_BAR_HEIGHT } from "./floating-panel";

/** localStorage key for layout persistence */
const LAYOUT_STORAGE_KEY = "tugdeck-layout";

/** Debounce delay for saving layout (ms) */
const SAVE_DEBOUNCE_MS = 500;

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
 * Construct a TabNode adapter from a PanelState for use with TabBar (D07).
 * TabBar still takes TabNode; PanelState stores activeTabId (string).
 */
function constructTabNode(panel: PanelState): TabNode {
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
    conversation: "Conversation",
    terminal: "Terminal",
    git: "Git",
    files: "Files",
    stats: "Stats",
  };
  return titles[componentId] ?? componentId;
}

export class PanelManager implements IDragState {
  private container: HTMLElement;
  private connection: TugConnection;

  /** Current canvas state (flat array of panels) */
  private canvasState: CanvasState;

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
   * FloatingPanel instances keyed by panel.id.
   * Destroyed and recreated on render.
   */
  private floatingPanels: Map<string, FloatingPanel> = new Map();

  /** Key panel: only conversation/terminal panels get title bar tint */
  private keyPanelId: string | null = null;

  /** D05: drag state flag */
  private _isDragging = false;

  /** Debounce timer for layout saves */
  private saveTimer: number | null = null;

  /** Card factory functions keyed by componentId. Registered externally by main.ts. */
  private cardFactories: Map<string, () => TugCard> = new Map();

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
    this.rootEl.className = "panel-root";
    this.rootEl.style.width = "100%";
    this.rootEl.style.height = "100%";
    container.appendChild(this.rootEl);

    // Load or build the initial canvas state
    this.canvasState = this.loadLayout();

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
   * PanelManager searches canvasState.panels for a panel with a tab whose
   * componentId matches. The card is added to fan-out sets and registered.
   *
   * @param card - The card instance
   * @param componentId - Component identifier (e.g. "conversation", "terminal")
   */
  addCard(card: TugCard, componentId: string): void {
    // Find the first panel containing a tab with the matching componentId
    let tabItem: TabItem | undefined;
    for (const panel of this.canvasState.panels) {
      const found = panel.tabs.find((t) => t.componentId === componentId);
      if (found) {
        tabItem = found;
        break;
      }
    }

    if (!tabItem) {
      console.warn(`PanelManager.addCard: no panel found for componentId "${componentId}"`);
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
      this.canvasState = {
        panels: this.canvasState.panels
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
   * Re-render the entire canvas: destroy existing FloatingPanel and TabBar
   * instances, then create one FloatingPanel per PanelState in array order
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

    // Destroy existing FloatingPanel DOM instances (removes from DOM)
    for (const fp of this.floatingPanels.values()) {
      fp.destroy();
    }
    this.floatingPanels.clear();

    // Clear rootEl (floating panels are appended to container, not rootEl)
    this.rootEl.innerHTML = "";

    const panels = this.canvasState.panels;
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];

      // Resolve card meta from the active tab's card (if registered)
      const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId)
        ?? panel.tabs[0];
      const cardMeta = activeTab
        ? this.cardRegistry.get(activeTab.id)?.meta
        : undefined;

      const fp = new FloatingPanel(
        panel,
        {
          onMoveEnd: (x, y) => {
            panel.position = { x, y };
            this.scheduleSave();
          },
          onResizeEnd: (x, y, width, height) => {
            panel.position = { x, y };
            panel.size = { width, height };
            // Notify the active card of its new size
            const activeTabId = panel.activeTabId;
            const card = this.cardRegistry.get(activeTabId);
            if (card) card.onResize(width, height - FLOATING_TITLE_BAR_HEIGHT);
            this.scheduleSave();
          },
          onFocus: () => {
            this.focusPanel(panel.id);
          },
          onClose: () => {
            const activeTabId = panel.activeTabId;
            const card = this.cardRegistry.get(activeTabId);
            if (card) {
              this.removeCard(card);
            }
          },
        },
        this.container,
        cardMeta
      );

      // Assign z-index in array order (100, 101, 102, ...)
      fp.setZIndex(100 + i);

      this.container.appendChild(fp.getElement());
      this.floatingPanels.set(panel.id, fp);

      // Mount cards via D09 reparenting
      for (const tab of panel.tabs) {
        const isActive = tab.id === panel.activeTabId;

        let mountEl = this.cardContainers.get(tab.id);
        if (!mountEl) {
          mountEl = document.createElement("div");
          mountEl.className = "panel-card-mount";
          this.cardContainers.set(tab.id, mountEl);
        }

        // Show/hide based on active tab
        mountEl.style.display = isActive ? "" : "none";

        // Reparent into floating panel card area (D09)
        fp.getCardAreaElement().appendChild(mountEl);

        // Mount the card if registered and not yet mounted
        const card = this.cardRegistry.get(tab.id);
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
        // Single-tab panel: CardHeader is rendered by FloatingPanel internally.
        // If we have a card with meta, update header retroactively via addCard path.
        // (FloatingPanel already created header from cardMeta if provided.)
      }
    }

    // Apply key panel state: if no keyPanelId set (or it no longer exists),
    // find the last acceptsKey panel and make it key.
    if (!this.keyPanelId || !this.floatingPanels.has(this.keyPanelId)) {
      this.keyPanelId = null;
      for (let i = panels.length - 1; i >= 0; i--) {
        if (this.acceptsKey(panels[i].id)) {
          this.keyPanelId = panels[i].id;
          break;
        }
      }
    }
    for (const [id, fp] of this.floatingPanels) {
      fp.setKey(id === this.keyPanelId);
    }
  }

  /**
   * Move the given panel to the end of the panels array (highest z-order),
   * update z-index values, and update key panel state.
   *
   * Key panel model: only conversation/terminal panels become key.
   * Clicking a non-key panel brings it to front but does not change keyPanelId.
   */
  focusPanel(panelId: string): void {
    const idx = this.canvasState.panels.findIndex((p) => p.id === panelId);
    if (idx === -1) return;

    // Bring to front if not already last
    if (idx !== this.canvasState.panels.length - 1) {
      const [panel] = this.canvasState.panels.splice(idx, 1);
      this.canvasState.panels.push(panel);

      // Update z-index to match new array order
      for (const [id, fp] of this.floatingPanels) {
        const newIdx = this.canvasState.panels.findIndex((p) => p.id === id);
        if (newIdx !== -1) {
          fp.setZIndex(100 + newIdx);
        }
      }

      this.scheduleSave();
    }

    // Update key panel: only if the focused panel accepts key
    if (this.acceptsKey(panelId)) {
      const prevKeyFp = this.keyPanelId ? this.floatingPanels.get(this.keyPanelId) : null;
      if (prevKeyFp && this.keyPanelId !== panelId) {
        prevKeyFp.setKey(false);
      }
      this.keyPanelId = panelId;
      const newKeyFp = this.floatingPanels.get(panelId);
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
  private handleTabActivate(panel: PanelState, newIndex: number): void {
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
  private handleTabReorder(panel: PanelState, fromIndex: number, toIndex: number): void {
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
   * at the center of the canvas. Called by TugMenu.
   */
  addNewCard(componentId: string): void {
    const factory = this.cardFactories.get(componentId);
    if (!factory) {
      console.warn(`PanelManager.addNewCard: no factory registered for "${componentId}"`);
      return;
    }

    const canvasW = this.container.clientWidth || 800;
    const canvasH = this.container.clientHeight || 600;
    const PANEL_W = 400;
    const PANEL_H = 300;
    const panelX = Math.max(0, (canvasW - PANEL_W) / 2);
    const panelY = Math.max(0, (canvasH - PANEL_H) / 2);

    const tabId = crypto.randomUUID();
    const newPanel: PanelState = {
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

    this.canvasState.panels.push(newPanel);

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
    const panel = this.canvasState.panels.find((p) => p.id === panelId);
    if (!panel) {
      console.warn(`PanelManager.addNewTab: panel "${panelId}" not found`);
      return;
    }

    // Verify same-componentId constraint
    const existingComponentId = panel.tabs[0]?.componentId;
    if (existingComponentId && existingComponentId !== componentId) {
      console.warn(
        `PanelManager.addNewTab: panel "${panelId}" has componentId "${existingComponentId}", ` +
        `cannot add tab with componentId "${componentId}"`
      );
      return;
    }

    const factory = this.cardFactories.get(componentId);
    if (!factory) {
      console.warn(`PanelManager.addNewTab: no factory for "${componentId}"`);
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
   * Destroy all current cards, reset to the default layout, and recreate
   * the default five cards using registered factories.
   */
  resetLayout(): void {
    this.destroyAllCards();
    this.keyPanelId = null;

    const canvasW = this.container.clientWidth || 800;
    const canvasH = this.container.clientHeight || 600;
    this.canvasState = buildDefaultLayout(canvasW, canvasH);

    this.render();

    const defaults = ["conversation", "terminal", "git", "files", "stats"];
    for (const componentId of defaults) {
      const factory = this.cardFactories.get(componentId);
      if (!factory) {
        console.warn(`PanelManager.resetLayout: no factory for "${componentId}"`);
        continue;
      }
      const card = factory();
      this.addCard(card, componentId);
    }

    this.scheduleSave();
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

  private loadLayout(): CanvasState {
    try {
      const json = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (json) {
        const canvasWidth = this.container.clientWidth || 800;
        const canvasHeight = this.container.clientHeight || 600;
        return deserialize(json, canvasWidth, canvasHeight);
      }
    } catch (e) {
      console.warn("PanelManager: failed to load layout from localStorage", e);
    }
    const canvasWidth = this.container.clientWidth || 800;
    const canvasHeight = this.container.clientHeight || 600;
    return buildDefaultLayout(canvasWidth, canvasHeight);
  }

  private saveLayout(): void {
    try {
      const serialized = serialize(this.canvasState);
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
   * Apply an external CanvasState, re-render, and schedule a save.
   */
  applyLayout(canvasState: CanvasState): void {
    this.keyPanelId = null;
    this.canvasState = canvasState;
    this.render();
    this.scheduleSave();
  }

  /** Expose the current canvas state for testing */
  getCanvasState(): CanvasState {
    return this.canvasState;
  }

  /** Expose card registry for testing */
  getCardRegistry(): Map<string, TugCard> {
    return this.cardRegistry;
  }

  /** Expose cardsByFeed for testing */
  getCardsByFeed(): Map<FeedIdValue, Set<TugCard>> {
    return this.cardsByFeed;
  }

  /** Expose the container element (for TugMenu button placement). */
  getContainer(): HTMLElement {
    return this.container;
  }

  /**
   * Register a card factory for a componentId.
   * Used by TugMenu and resetLayout to create new card instances.
   */
  registerCardFactory(componentId: string, factory: () => TugCard): void {
    this.cardFactories.set(componentId, factory);
  }

  // ---- Private helpers ----

  /**
   * Route keyboard focus to the key panel's active card.
   * Called after any focus change so the key panel always receives key events.
   */
  private focusKeyPanelCard(): void {
    if (!this.keyPanelId) return;
    const panel = this.canvasState.panels.find((p) => p.id === this.keyPanelId);
    if (!panel) return;
    const card = this.cardRegistry.get(panel.activeTabId);
    if (card?.focus) {
      card.focus();
    }
  }

  /** Set of componentIds that accept key status. */
  private static readonly KEY_CAPABLE = new Set([
    "conversation", "terminal", "git", "files",
  ]);

  /**
   * Whether a panel accepts key status (title bar tint + key events).
   * Most panels are key-capable; stats is the exception (display-only).
   */
  private acceptsKey(panelId: string): boolean {
    const panel = this.canvasState.panels.find((p) => p.id === panelId);
    if (!panel) return false;
    const componentId = panel.tabs[0]?.componentId;
    return componentId !== undefined && PanelManager.KEY_CAPABLE.has(componentId);
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
    for (const fp of this.floatingPanels.values()) {
      fp.destroy();
    }
    this.floatingPanels.clear();
    for (const card of this.cardRegistry.values()) {
      card.destroy();
    }
    this.cardRegistry.clear();
    window.removeEventListener("resize", () => this.handleResize());
  }
}
