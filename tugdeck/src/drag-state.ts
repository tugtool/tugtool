/**
 * IDragState interface for card coupling.
 *
 * Spec S04: IDragState Interface
 *
 * This is a standalone shared module. It has no dependencies on panel-manager
 * or any other module, preventing circular dependency risks. Cards import this
 * narrow interface instead of the full PanelManager type.
 */

export interface IDragState {
  readonly isDragging: boolean;
}
