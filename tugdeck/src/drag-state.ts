/**
 * IDragState interface for card coupling.
 *
 * Spec S04: IDragState Interface
 *
 * This is a standalone shared module. It has no dependencies on deck-manager
 * or any other module, preventing circular dependency risks. Cards import this
 * narrow interface instead of the full DeckManager type.
 */

export interface IDragState {
  readonly isDragging: boolean;
}
