/**
 * DeckCanvas — single React root for the entire card canvas.
 *
 * Renders all CardFrames, TabBars, and card content in one unified React tree.
 * DeckManager creates one React root that renders DeckCanvas, eliminating the
 * previous per-panel createRoot calls and flushSync usage.
 *
 * Architecture:
 *   DeckManager.render() -> this.reactRoot.render(
 *     <DevNotificationProvider><DeckCanvas .../></DevNotificationProvider>
 *   )
 *   DeckCanvas manages:
 *     - feedData state (per feedId): updated via imperative onFrame calls
 *   DeckCanvas exposes DeckCanvasHandle for DeckManager imperative operations:
 *     - onFrame(feedId, payload): route feed data into React state
 *     - updatePanelPosition/Size/ZIndex: direct DOM mutations during sash drag (no re-render)
 *
 * [D04] Unified single React root with DeckCanvas
 * Spec S05, #step-8
 */

import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
  useEffect,
} from "react";
import type { CardState, TabItem } from "@/layout-tree";
import type { TugCardMeta } from "@/cards/card";
import type { TugConnection } from "@/connection";
import type { IDragState } from "@/drag-state";
import type { FeedIdValue } from "@/protocol";
import type { GuidePosition } from "@/snap";
import { CardFrame, type CardFrameCallbacks } from "./card-frame";
import { TabBar, type TabBarCallbacks } from "./tab-bar";
import { Dock, type DockCallbacks } from "./dock";
import { CardContextProvider } from "@/cards/card-context";
import { SnapGuideLine } from "./snap-guide-line";
import { VirtualSash, type SashGroup, type VirtualSashCallbacks, type PanelSnapshot } from "./virtual-sash";
import { SetFlashOverlay } from "./set-flash-overlay";

// ---- Flash overlay config ----

/**
 * Per-panel flash overlay configuration.
 * Describes which borders are suppressed for internal shared edges.
 */
export interface PanelFlashConfig {
  hideTop?: boolean;
  hideBottom?: boolean;
  hideLeft?: boolean;
  hideRight?: boolean;
}

// ---- CardConfig ----

/**
 * Config object describing a card type. Replaces the class-based ReactCardAdapter.
 * DeckCanvas uses this to instantiate card content components directly.
 */
export interface CardConfig {
  /** The React component to mount as card content */
  component: React.ComponentType;
  /** Feed IDs this card subscribes to */
  feedIds: readonly FeedIdValue[];
  /** Initial metadata shown in the CardHeader before the component calls useCardMeta */
  initialMeta: TugCardMeta;
  /** WebSocket connection (passed through context) */
  connection?: TugConnection | null;
  /** Drag state (passed through context) */
  dragState?: IDragState | null;
}

// ---- CanvasCallbacks ----

export interface CanvasCallbacks {
  onMoveEnd: (panelId: string, x: number, y: number) => void;
  onResizeEnd: (panelId: string, x: number, y: number, width: number, height: number) => void;
  onFocus: (panelId: string, opts?: { suppressZOrder?: boolean }) => void;
  onClose: (panelId: string) => void;
  onMoving: (panelId: string, x: number, y: number) => { x: number; y: number };
  onResizing: (
    panelId: string,
    x: number,
    y: number,
    width: number,
    height: number
  ) => { x: number; y: number; width: number; height: number };
  onTabActivate: (panelId: string, tabIndex: number) => void;
  onTabClose: (tabId: string) => void;
  onTabReorder: (panelId: string, fromIndex: number, toIndex: number) => void;
  onMetaUpdate: (tabId: string, meta: TugCardMeta) => void;
  dock: DockCallbacks;
}

// ---- DeckCanvasHandle ----

export interface DeckCanvasHandle {
  /**
   * Route an incoming feed frame into React state so card components receive it.
   * Called by DeckManager's TugConnection.onFrame() callbacks.
   */
  onFrame(feedId: FeedIdValue, payload: Uint8Array): void;
  /**
   * Mutate a panel's DOM position directly (no React re-render).
   * Used by DeckManager sash drag during pointermove for live updates.
   */
  updatePanelPosition(panelId: string, x: number, y: number): void;
  /**
   * Mutate a panel's DOM size directly (no React re-render).
   * Used by DeckManager sash drag during pointermove for live updates.
   */
  updatePanelSize(panelId: string, width: number, height: number): void;
  /**
   * Mutate a panel's z-index directly (no React re-render).
   * Used by DeckManager focusPanel to update z-order without full re-render.
   */
  updatePanelZIndex(panelId: string, zIndex: number): void;
  /**
   * Return the root DOM element of a panel.
   * Kept for DeckManager sash drag normalization; flash overlay now uses React.
   */
  getPanelElement(panelId: string): HTMLDivElement | null;
}

// ---- DeckCanvasProps ----

export interface DeckCanvasProps {
  panels: CardState[];
  cardConfigs: Map<string, CardConfig>;
  cardMetas: Map<string, TugCardMeta>;
  keyPanelId: string | null;
  /** The canvas container element (passed to CardFrame for drag bounds clamping). */
  canvasEl: HTMLElement;
  callbacks: CanvasCallbacks;
  connection: TugConnection | null;
  dragState: IDragState | null;
  /**
   * Per-panel docked corner mask: panelId → [TL, TR, BR, BL].
   * true = rounded corner, false = square corner (0px).
   * Computed by DeckManager from shared edges and passed as props
   * so CardFrame applies border-radius declaratively during render.
   * When absent or not set for a panel, all corners are rounded.
   */
  panelDockedCorners?: Map<string, [boolean, boolean, boolean, boolean]>;
  /**
   * Per-panel position offset for 1px overlap between docked panels.
   * Computed by DeckManager from shared edges and passed as props
   * so CardFrame applies the offset declaratively during render.
   * When absent or not set for a panel, no offset is applied.
   */
  panelPositionOffsets?: Map<string, { dx: number; dy: number }>;

  // ---- Overlay props (Step 8) ----

  /**
   * Active snap guide lines to render over the canvas during drag.
   * Computed by DeckManager's onMoving/onResizing callbacks.
   * Empty array (or absent) = no guides visible.
   */
  guides?: GuidePosition[];

  /**
   * Virtual sash groups to render at shared edges between docked panels.
   * Computed by DeckManager's recomputeSets() after each render.
   * Empty array (or absent) = no sashes.
   */
  sashGroups?: SashGroup[];

  /**
   * Panel snapshots needed by VirtualSash for drag calculations.
   * Map from panelId to its current position/size.
   * Provided by DeckManager alongside sashGroups.
   */
  sashPanelSnapshots?: Map<string, PanelSnapshot>;

  /**
   * Active flash overlays per panel.
   * Map from panelId to flash border config.
   * DeckManager sets this when a set is formed/broken; clears on onFlashEnd.
   */
  flashingPanels?: Map<string, PanelFlashConfig>;

  /**
   * Called when a VirtualSash drag ends.
   * DeckManager commits the new panel sizes/positions and triggers re-render.
   */
  onSashDragEnd?: (
    axis: "vertical" | "horizontal",
    aSideIds: string[],
    bSideIds: string[],
    delta: number
  ) => void;

  /**
   * Called when a flash overlay animation completes.
   * DeckManager removes the panel from flashingPanels.
   */
  onFlashEnd?: (panelId: string) => void;
}

// ---- CardContent ----

interface CardContentProps {
  tabId: string;
  tab: TabItem;
  isActive: boolean;
  cardConfigs: Map<string, CardConfig>;
  feedData: Map<FeedIdValue, Uint8Array>;
  connection: TugConnection | null;
  dragState: IDragState | null;
  onMetaUpdate: (tabId: string, meta: TugCardMeta) => void;
}

function CardContent({
  tabId,
  tab,
  isActive,
  cardConfigs,
  feedData,
  connection,
  dragState,
  onMetaUpdate,
}: CardContentProps) {
  const config = cardConfigs.get(tab.componentId);
  if (!config) return null;

  const Component = config.component;
  const cardConnection = config.connection !== undefined ? config.connection : connection;
  const cardDragState = config.dragState !== undefined ? config.dragState : dragState;

  // Filter feed data to only the feeds this card subscribes to
  const cardFeedData = new Map<FeedIdValue, Uint8Array>();
  for (const feedId of config.feedIds) {
    const data = feedData.get(feedId);
    if (data !== undefined) {
      cardFeedData.set(feedId, data);
    }
  }

  const dispatch = useCallback(
    (feedId: FeedIdValue, payload: Uint8Array) => {
      if (cardConnection) {
        cardConnection.send(feedId, payload);
      }
    },
    [cardConnection]
  );

  const updateMeta = useCallback(
    (meta: TugCardMeta) => {
      // Only active tabs push meta to the card header
      if (isActive) {
        onMetaUpdate(tabId, meta);
      }
    },
    [tabId, isActive, onMetaUpdate]
  );

  return (
    <CardContextProvider
      connection={cardConnection}
      feedData={cardFeedData}
      dimensions={{ width: 0, height: 0 }}
      dragState={cardDragState}
      updateMeta={updateMeta}
      dispatch={dispatch}
    >
      <Component />
    </CardContextProvider>
  );
}

// ---- DeckCanvas ----

export const DeckCanvas = forwardRef<DeckCanvasHandle, DeckCanvasProps>(
  function DeckCanvas(
    {
      panels,
      cardConfigs,
      cardMetas,
      keyPanelId,
      canvasEl,
      callbacks,
      connection,
      dragState,
      panelDockedCorners,
      panelPositionOffsets,
      guides,
      sashGroups,
      sashPanelSnapshots,
      flashingPanels,
      onSashDragEnd,
      onFlashEnd,
    },
    ref
  ) {
    // ---- Feed data state ----
    // Shared across all cards; each CardContent filters to its subscribed feeds.
    const [feedData, setFeedData] = useState<Map<FeedIdValue, Uint8Array>>(new Map());

    // ---- Panel element refs for imperative DOM mutations (sash drag, z-index) ----
    // Map from panelId -> panel root div element.
    const panelElementRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    // ---- Imperative handle ----

    useImperativeHandle(
      ref,
      () => ({
        onFrame(feedId: FeedIdValue, payload: Uint8Array) {
          setFeedData((prev) => {
            const next = new Map(prev);
            next.set(feedId, payload);
            return next;
          });
        },
        updatePanelPosition(panelId: string, x: number, y: number) {
          const el = panelElementRefs.current.get(panelId);
          if (el) {
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
          }
        },
        updatePanelSize(panelId: string, width: number, height: number) {
          const el = panelElementRefs.current.get(panelId);
          if (el) {
            el.style.width = `${width}px`;
            el.style.height = `${height}px`;
          }
        },
        updatePanelZIndex(panelId: string, zIndex: number) {
          const el = panelElementRefs.current.get(panelId);
          if (el) {
            el.style.zIndex = String(zIndex);
          }
        },
        getPanelElement(panelId: string): HTMLDivElement | null {
          return panelElementRefs.current.get(panelId) ?? null;
        },
      }),
      []
    );

    // Clean up panel refs when panels are removed
    useEffect(() => {
      const currentIds = new Set(panels.map((p) => p.id));
      for (const id of panelElementRefs.current.keys()) {
        if (!currentIds.has(id)) {
          panelElementRefs.current.delete(id);
        }
      }
    }, [panels]);

    const handleMetaUpdate = useCallback(
      (tabId: string, meta: TugCardMeta) => {
        callbacks.onMetaUpdate(tabId, meta);
      },
      [callbacks]
    );

    return (
      <>
        {panels.map((panel, i) => {
          const activeTab =
            panel.tabs.find((t) => t.id === panel.activeTabId) ?? panel.tabs[0];

          const meta =
            cardMetas.get(panel.activeTabId) ??
            (activeTab
              ? (cardConfigs.get(activeTab.componentId)?.initialMeta ?? {
                  title: activeTab.title,
                  icon: "Box",
                  closable: true,
                  menuItems: [],
                })
              : { title: "Panel", icon: "Box", closable: true, menuItems: [] });

          const isKey = panel.id === keyPanelId;
          const zIndex = 100 + i;

          const frameCallbacks: CardFrameCallbacks = {
            onMoveEnd: (x, y) => callbacks.onMoveEnd(panel.id, x, y),
            onResizeEnd: (x, y, width, height) =>
              callbacks.onResizeEnd(panel.id, x, y, width, height),
            onFocus: (opts) => callbacks.onFocus(panel.id, opts),
            onClose: () => callbacks.onClose(panel.id),
            onMoving: (x, y) => callbacks.onMoving(panel.id, x, y),
            onResizing: (x, y, width, height) =>
              callbacks.onResizing(panel.id, x, y, width, height),
          };

          const activeTabIndex = panel.tabs.findIndex((t) => t.id === panel.activeTabId);

          const tabBarCallbacks: TabBarCallbacks = {
            onTabActivate: (tabIndex) => callbacks.onTabActivate(panel.id, tabIndex),
            onTabClose: (tabId) => callbacks.onTabClose(tabId),
            onTabReorder: (fromIndex, toIndex) =>
              callbacks.onTabReorder(panel.id, fromIndex, toIndex),
          };

          const flashConfig = flashingPanels?.get(panel.id);

          return (
            <PanelContainer
              key={panel.id}
              panelId={panel.id}
              panelElementRefs={panelElementRefs}
              panelState={panel}
              meta={meta}
              isKey={isKey}
              zIndex={zIndex}
              canvasEl={canvasEl}
              callbacks={frameCallbacks}
              dockedCorners={panelDockedCorners?.get(panel.id)}
              positionOffset={panelPositionOffsets?.get(panel.id)}
              flashConfig={flashConfig}
              onFlashEnd={onFlashEnd ? () => onFlashEnd(panel.id) : undefined}
            >
              {panel.tabs.length > 1 && (
                <TabBar
                  tabs={panel.tabs}
                  activeTabIndex={Math.max(0, activeTabIndex)}
                  callbacks={tabBarCallbacks}
                />
              )}
              <div className="deck-canvas-card-area">
                {panel.tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className="deck-canvas-tab-slot"
                    style={{ display: tab.id === panel.activeTabId ? "" : "none", width: "100%", height: "100%" }}
                  >
                    <CardContent
                      tabId={tab.id}
                      tab={tab}
                      isActive={tab.id === panel.activeTabId}
                      cardConfigs={cardConfigs}
                      feedData={feedData}
                      connection={connection}
                      dragState={dragState}
                      onMetaUpdate={handleMetaUpdate}
                    />
                  </div>
                ))}
              </div>
            </PanelContainer>
          );
        })}
        {/* Snap guide lines rendered over the canvas during drag */}
        {guides?.map((guide, i) => (
          <SnapGuideLine key={`guide-${guide.axis}-${i}`} guide={guide} />
        ))}
        {/* Virtual sashes rendered at shared edges between docked panels */}
        {sashGroups?.map((group, i) => {
          const groupPanelIds = new Set([
            ...group.edges.map((e) => e.cardAId),
            ...group.edges.map((e) => e.cardBId),
          ]);
          const groupPanels = sashPanelSnapshots
            ? Array.from(groupPanelIds)
                .map((id) => sashPanelSnapshots.get(id))
                .filter((s): s is PanelSnapshot => s !== undefined)
            : [];
          const sashCallbacks: VirtualSashCallbacks = {
            onUpdatePanelSize: (panelId, width, height) => {
              const el = panelElementRefs.current.get(panelId);
              if (el) {
                el.style.width = `${width}px`;
                el.style.height = `${height}px`;
              }
            },
            onUpdatePanelPosition: (panelId, x, y) => {
              const el = panelElementRefs.current.get(panelId);
              if (el) {
                el.style.left = `${x}px`;
                el.style.top = `${y}px`;
              }
            },
            onDragEnd: onSashDragEnd ?? (() => {}),
          };
          return (
            <VirtualSash
              key={`sash-${i}-${group.axis}-${group.boundary}`}
              group={group}
              panels={groupPanels}
              callbacks={sashCallbacks}
            />
          );
        })}
        <Dock callbacks={callbacks.dock} />
      </>
    );
  }
);

// ---- PanelContainer ----
// Wraps CardFrame to register the panel's root element in panelElementRefs.

interface PanelContainerProps {
  panelId: string;
  panelElementRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  panelState: CardState;
  meta: TugCardMeta;
  isKey: boolean;
  zIndex: number;
  canvasEl: HTMLElement;
  callbacks: CardFrameCallbacks;
  dockedCorners?: [boolean, boolean, boolean, boolean];
  positionOffset?: { dx: number; dy: number };
  /** Flash overlay config for this panel, if active. */
  flashConfig?: PanelFlashConfig;
  /** Called when the flash overlay animation ends. */
  onFlashEnd?: () => void;
  children: React.ReactNode;
}

function PanelContainer({
  panelId,
  panelElementRefs,
  panelState,
  meta,
  isKey,
  zIndex,
  canvasEl,
  callbacks,
  dockedCorners,
  positionOffset,
  flashConfig,
  onFlashEnd,
  children,
}: PanelContainerProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (rootRef.current) {
      panelElementRefs.current.set(panelId, rootRef.current);
    }
    return () => {
      panelElementRefs.current.delete(panelId);
    };
  }, [panelId, panelElementRefs]);

  return (
    <CardFrame
      rootRef={rootRef}
      panelState={panelState}
      meta={meta}
      isKey={isKey}
      zIndex={zIndex}
      canvasEl={canvasEl}
      callbacks={callbacks}
      dockedCorners={dockedCorners}
      positionOffset={positionOffset}
    >
      {children}
      {flashConfig && onFlashEnd && (
        <SetFlashOverlay
          hideTop={flashConfig.hideTop}
          hideBottom={flashConfig.hideBottom}
          hideLeft={flashConfig.hideLeft}
          hideRight={flashConfig.hideRight}
          onAnimationEnd={onFlashEnd}
        />
      )}
    </CardFrame>
  );
}
