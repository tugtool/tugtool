# tug-split-pane

*A flexible split-pane layout primitive that divides a region into two or more resizable children, separated by draggable sashes that can snap closed and reopen.*

Motivation: in T3.4 we will place `tug-prompt-entry` at the bottom of the Tide card and `tug-markdown-view` above it. We need a reusable, meticulously-crafted split surface before that work — not a one-off layout in the Tide card. `tug-split-pane` becomes a general tugways layout primitive that any card composition can use.

---

## Goals

- **Horizontal or vertical splits.** A split is named by the orientation of its *dividing line*: `horizontal` = a horizontal sash dividing top/bottom panes, `vertical` = a vertical sash dividing left/right panes. This matches macOS / VS Code terminology and the user's mental model ("horizontally-split card with a markdown view on top").
- **N-way panes.** Two is the common case but the API supports arbitrary `n ≥ 2`. Nested split panes yield arbitrary 2D layouts.
- **Resizable sashes.** Drag to resize. Keyboard accessible (arrow keys when sash is focused). ARIA `separator` role.
- **Per-pane size constraints.** Each pane declares `minSize` and optional `maxSize`, in pixels or percentage. The group enforces them during drag and on container resize.
- **Snap-to-close.** When a pane is dragged below a snap threshold, it collapses to `collapsedSize` (usually 0). Reopening is via drag or imperative API.
- **Stylable sash.** The sash is a tokened element that accepts a width (thickness), color, and optional icon (grip indicator). Hover / active / focus states are CSS tokens.
- **Persistent layouts.** Optional `storageKey` saves the split ratio across reloads.
- **Composable with TugBox.** Each pane's content is opaque — typically a TugBox, but anything is allowed. The split pane does not impose visual chrome on its children.

Non-goals: animation choreography during snap (we use plain CSS transitions), multi-touch, drag-to-reorder panes.

---

## Research

**Radix UI — not applicable.** Radix has no split-pane or resizable primitive. Their focus is controls and dialogs, not layout. Confirmed against the Radix Primitives catalogue (`@radix-ui/react-accordion`, `-slider`, `-popover`, etc.; no `-split-pane`, `-panels`, or `-resizable`).

**Candidate 1 — `react-resizable-panels`** (Brian Vaughn / bvaughn). License: MIT. Active, ~5.2k stars, 160+ releases.
- Horizontal + vertical, nestable, keyboard-accessible separator (WAI-ARIA).
- Collapsible panels with `collapsible`, `collapsedSize`, and `onCollapse` callbacks — our "snap to close" requirement maps directly.
- Min / max / default sizes as percentages.
- Persistent layout via `autoSaveId` + local storage.
- Styling: class names and `data-*` attributes on the separator; the consumer supplies all visuals. A minor caveat — the library enforces `flex-grow`/`flex-shrink` on panels; thickness of the sash is free but panel size during drag is driven via inline style on flex items.
- Used by shadcn/ui's "Resizable" component, which is the closest analog in the React ecosystem to how tugways wraps Radix. Pattern-compatible: renderless-ish primitives + consumer styling.

**Candidate 2 — `allotment`** (John Walley). License: MIT. Active, derived from VS Code's split-view.
- Horizontal + vertical, nestable, keyboard accessible.
- Built-in "snap to zero" threshold + double-click sash to reset to preferred sizes.
- Ref-based imperative API (`.reset()`, `.resize()`).
- CSS variables for theming sash color / focus ring.
- Closer to the VS Code "industry standard" look. More opinionated about visual chrome, which is both a pro (great defaults) and con (harder to re-skin into tugways tokens).

**Candidate 3 — `react-split-pane` / `react-split` / `@devbookhq/splitter`.** Older, less maintained, or wrap non-React libraries. Not recommended.

**Candidate 4 — hand-rolled.** The resize math is not hard: constrained 1D layout with min/max clamping and optional snapping. What *is* hard, and what these libraries already solve, is the long tail:
- WAI-ARIA `separator` semantics and keyboard navigation
- Pointer capture across the viewport (drags that leave the target)
- Touch + mouse + pen unification
- `ResizeObserver` integration for container-size changes
- Persistent layouts + responsive reflow
- Edge cases around zero-size panels and conditional visibility

Rolling our own means re-solving these. Given we are already comfortable wrapping Radix primitives with tugways chrome, the same pattern applies here.

**Recommendation: wrap `react-resizable-panels`.** It is MIT, actively maintained, pattern-compatible with our Radix-wrapping conventions, and exposes primitives that map cleanly onto the props we want. Allotment is a reasonable fallback if its VS Code ergonomics (double-click reset, built-in snap threshold) turn out to matter more than class-based styling freedom — but our experience wrapping Radix slider, tooltip, popover, etc. with fully-tokened CSS strongly favors the Vaughn library.

### L06 note

`react-resizable-panels` drives panel sizes via inline `flex-grow`/`flex-shrink` on the panel elements and tracks layout in React state. During a drag, this causes React re-renders at pointer-event cadence. This is the same tradeoff as `@radix-ui/react-slider` (which we already wrap) — the intermediate values are technically appearance-only, but the upstream library routes them through React. We accept this tradeoff because:
1. The re-renders are narrow (the panel group and direct children only, not the content subtrees — children are memoized via `React.memo` where appropriate).
2. The committed layout *is* data (it persists, it's queryable, it drives which pane is collapsed), so having it in React is correct per L06's test.
3. The during-drag preview is visually indistinguishable from a pure CSS approach at 60fps on our hardware targets.

If profiling reveals drag-time jank inside heavy panes (a very large `tug-markdown-view`, for instance), the mitigation is to put the content in its own memoized boundary — not to rip out the library.

---

## Terminology

We deliberately name orientation by the *dividing line*, not the arrangement of panes. Both terms are used in the wild and each is someone's "wrong", so we pick one and stick to it:

| Prop value    | Dividing line | Pane arrangement |
|---------------|---------------|------------------|
| `horizontal`  | Horizontal    | Stacked (top / bottom) |
| `vertical`    | Vertical      | Side by side (left / right) |

This matches NSSplitView's semantics (`NSSplitViewDividerStyle` + `isVertical`: a vertical divider yields side-by-side panes) and VS Code's split terminology. The JSDoc on the `orientation` prop spells this out explicitly with a diagram so there is no confusion.

---

## Use case: Tide card

```
┌─────────────────────────────────────────┐
│  Tide                              [x]  │  ← card title bar
├─────────────────────────────────────────┤
│                                         │
│  tug-markdown-view                      │  ← pane 1
│  (scrolled content, history, etc.)      │
│                                         │
├──────── ═════ ─────────────────────────┤  ← horizontal sash (grip)
│                                         │
│  tug-prompt-entry                       │  ← pane 2
│                                         │
└─────────────────────────────────────────┘
```

Behavior:
- Default split: 70/30 (top is larger).
- Minimum for the prompt-entry pane: enough to show one line of input + route indicator + submit button (≈ 80px depending on size).
- Maximum for the prompt-entry pane: ~50% (user can still see recent history).
- Minimum for the markdown-view pane: enough to show ~3 lines of content.
- No snap-to-close in this specific layout — both panes are always needed. Snap-to-close is available for other cards that want it (e.g., an inspector that collapses).

---

## Props

```typescript
export type TugSplitPaneOrientation = "horizontal" | "vertical";

/** Size specification: a number is pixels; a string ending in "%" is percent. */
export type TugSplitSize = number | `${number}%`;

/**
 * Per-pane configuration. One element per child <TugSplitPanel>.
 */
export interface TugSplitPanelProps extends React.ComponentPropsWithoutRef<"div"> {
  /** Stable id. Required when using storageKey or imperative API. */
  id?: string;
  /** Initial size. Default: equal division. */
  defaultSize?: TugSplitSize;
  /** Controlled size. Use with onSizeChange. */
  size?: TugSplitSize;
  /** Callback after the user finishes dragging. Not called mid-drag. */
  onSizeCommit?: (size: number) => void;
  /** Minimum size. Enforced during drag and on container resize. */
  minSize?: TugSplitSize;
  /** Maximum size. Optional. */
  maxSize?: TugSplitSize;
  /** Panel can be collapsed by dragging past the snap threshold. Default: false. */
  collapsible?: boolean;
  /** Size when collapsed. Default: 0. */
  collapsedSize?: TugSplitSize;
  /** Drag distance past minSize before snap-to-collapse fires, in px. Default: 20. */
  snapThreshold?: number;
  /** Fires when collapsed state toggles. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Disables drag-to-resize for this panel's leading sash. */
  resizable?: boolean;
  children?: React.ReactNode;
}

/**
 * The sash (divider) between two adjoining panes.
 * In the DOM, exactly one sash lives between every pair of adjoining panels.
 * Authors do not mount these directly — they are rendered by TugSplitPane.
 * Authors customize via the sash prop on TugSplitPane.
 */
export interface TugSplitSashConfig {
  /**
   * Thickness in px. Applied to the sash's cross-axis dimension.
   * @default 6
   */
  thickness?: number;
  /**
   * Whether to render a grip icon in the sash. The icon is a tugways icon name
   * or a React node. When omitted, no icon is rendered (plain color bar).
   */
  icon?: React.ReactNode | TugIconName;
  /**
   * Size of the interactive hit area along the drag axis, in px.
   * Can be larger than the visible thickness (common pattern: a 1-2px visible
   * line with an 8-10px invisible hit area).
   * @default max(thickness, 8)
   */
  hitArea?: number;
}

export interface TugSplitPaneProps extends React.ComponentPropsWithoutRef<"div"> {
  /**
   * Orientation of the dividing line(s).
   * - "horizontal": horizontal sash(es), panels stacked top to bottom.
   * - "vertical":   vertical sash(es),   panels side by side.
   * @selector .tug-split-pane-horizontal | .tug-split-pane-vertical
   * @default "horizontal"
   */
  orientation?: TugSplitPaneOrientation;
  /**
   * Sash visual configuration. A single config applies to every sash in this group.
   * For per-sash customization, compose nested TugSplitPanes.
   */
  sash?: TugSplitSashConfig;
  /**
   * Persist the layout under this key in localStorage. Optional.
   * When present, every TugSplitPanel should have a stable id.
   */
  storageKey?: string;
  /**
   * Size variant — controls default sash thickness and grip icon size.
   * @selector .tug-split-pane-sm | .tug-split-pane-md | .tug-split-pane-lg
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /** Children must be TugSplitPanel elements. */
  children: React.ReactNode;
}
```

### Why two components (`TugSplitPane` + `TugSplitPanel`)

Because size constraints are *per pane*. Putting them on the parent would require parallel-array props (`minSizes={[100, 50]}`), which is brittle. The `react-resizable-panels` API uses the same pattern (Group + Panel + Separator), and it is the clearest way to express "this specific child has these constraints." The sash is not a separate JSX element that authors mount — `TugSplitPane` renders one between each adjacent pair of panels automatically. Authors customize sash appearance once via the `sash` prop.

### Why the sash config is on the parent, not the panel

A sash lives *between* two panels, so it does not belong to either of them. Putting sash configuration on a panel would make it ambiguous ("leading? trailing?") and would force authors to duplicate styling on every panel. The parent-level `sash` config is the natural place for this.

---

## Snap behavior

1. User drags the sash toward a panel that is `collapsible: true`.
2. As the panel's size approaches its `minSize`, drag continues to shrink it normally.
3. Once the pointer has traveled `snapThreshold` pixels past `minSize`, the panel snaps to `collapsedSize` (typically 0) and `onCollapsedChange(true)` fires.
4. On the return drag, the panel reopens from `collapsedSize` directly to `minSize` once the pointer has traveled `snapThreshold` pixels *back* from the collapsed edge. This matches macOS / VS Code split behavior.
5. Programmatic expand/collapse is available via ref (`.collapsePanel(id)`, `.expandPanel(id)`).

Collapsed panels remain mounted (`display: none` is *not* used) so that their internal state is preserved. We toggle a `data-collapsed` attribute and drive the visual collapse with CSS: `.tug-split-panel[data-collapsed="true"] { flex: 0 0 0 !important; overflow: hidden; }`.

---

## Sash design

```
Horizontal sash (panes stacked top/bottom):
 ────────────────────────────────────
              ╺━━━╸               ← optional grip icon, centered
 ────────────────────────────────────

Vertical sash (panes side by side):
 │   │
 │ ╻ │
 │ ┃ │  ← optional grip icon, centered
 │ ╹ │
 │   │
```

- **Visible thickness** is token-driven (`--tug7-split-sash-thickness`) with sensible defaults per size variant.
- **Hit area** is wider than the visible thickness using negative margin / `::before` absolute positioning. Pattern: a 2px visible bar with a 10px hit area feels premium.
- **Grip icon** is optional. Defaults to `grip-horizontal` / `grip-vertical` from Lucide when `sash.icon` is not passed. Color and size inherit from tokens.
- **States** (CSS only, no React state): rest, hover, active (dragging), focus-visible (keyboard).
- **Cursor**: `ns-resize` for horizontal sashes, `ew-resize` for vertical sashes. Applied during hover and forced on `<body>` during drag (the underlying library handles the body-cursor escalation).
- **ARIA**: `role="separator"`, `aria-orientation`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax` (provided by the underlying library). Focusable with Tab; Arrow keys move it by a fixed step (default 10px), Home/End move to min/max, Enter toggles collapse on collapsible panels.

---

## Files

```
tugdeck/src/components/tugways/tug-split-pane.tsx
tugdeck/src/components/tugways/tug-split-pane.css
tugdeck/src/components/tugways/cards/gallery-split-pane.tsx
```

Plus the dependency: `bun add react-resizable-panels`.

---

## TSX structure

- CSS import first
- `forwardRef` on `TugSplitPane` root; returned ref exposes imperative methods (`collapsePanel`, `expandPanel`, `getLayout`, `setLayout`) by forwarding to the underlying `PanelGroup` ref
- `data-slot="tug-split-pane"` on the root, `data-slot="tug-split-panel"` on each panel, `data-slot="tug-split-sash"` on each sash
- `cn()` for class composition
- Spread `...rest` on the root
- Wraps `react-resizable-panels`' `PanelGroup`, `Panel`, `PanelResizeHandle`
- `TugSplitPanel` is a thin wrapper around `Panel` that also carries the tugways `TugSplitPanelProps` interface and forwards the size/constraint props
- Sash is rendered internally by `TugSplitPane` by interleaving `<PanelResizeHandle>` elements between consecutive `<TugSplitPanel>` children, reading the `sash` prop for styling. Children are validated at dev time (must all be `TugSplitPanel`, no arbitrary elements).

### Renderless sash? No — single-node sash with CSS

The sash is rendered by `TugSplitPane`, not the consumer. Consumers customize via the `sash` prop, which flows into CSS variables on the group. This keeps the API small: one prop tree, one set of tokens, no need to drill `sash={…}` into every panel.

---

## CSS structure

- `@tug-pairings` block (compact + expanded)
- Body-scoped aliases: `--tugx-split-pane-*` resolving to `--tug7-*` in one hop
- `.tug-split-pane` — root flex container; flex-direction driven by `data-orientation`
- `.tug-split-pane-horizontal` / `.tug-split-pane-vertical` — orientation modifiers
- `.tug-split-panel` — each pane; `flex: <size>` driven by inline style from the library
- `.tug-split-panel[data-collapsed="true"]` — collapsed state
- `.tug-split-sash` — draggable divider; cross-axis size = thickness, main-axis size = 100%
- `.tug-split-sash-grip` — optional centered icon
- `.tug-split-sash[data-state="hover"]`, `[data-state="active"]`, `[data-focus-visible]` — states (library provides data attrs where possible)
- Size variants: `.tug-split-pane-sm`, `.tug-split-pane-md`, `.tug-split-pane-lg`

---

## Token design

Seven-slot `--tug7-split-*` tokens following the token naming convention. Initial set:

| Token                                    | Purpose |
|------------------------------------------|---------|
| `--tug7-split-sash-bg-normal-rest`       | sash fill, resting |
| `--tug7-split-sash-bg-normal-hover`      | sash fill, hover |
| `--tug7-split-sash-bg-normal-active`     | sash fill, dragging |
| `--tug7-split-sash-fg-normal-rest`       | grip icon color, resting |
| `--tug7-split-sash-fg-normal-hover`      | grip icon color, hover |
| `--tug7-split-sash-ring-focus`           | keyboard focus ring |
| `--tug7-split-sash-thickness-sm/md/lg`   | visible sash thickness per size |
| `--tug7-split-sash-hit-area-sm/md/lg`    | interactive hit area per size |
| `--tug7-split-sash-grip-size-sm/md/lg`   | grip icon size per size |
| `--tug7-split-pane-gap`                  | optional gap inside the hit area for a "snap gap" look |

Pair with both `brio.css` and `harmony.css`. Document the pairings in the module docstring and CSS header.

Per [L20] token sovereignty, `tug-split-pane` does not restyle its children. Panes are opaque regions — whatever lives inside (typically a TugBox) owns its own tokens.

---

## Gallery card

`cards/gallery-split-pane.tsx` is an interactive demo showing:

- Horizontal split (the Tide use case): markdown above, prompt below
- Vertical split: a 2-pane side-by-side layout
- 3-pane split with a collapsible center pane (click a button to collapse/expand)
- Nested split: vertical outer with a horizontal inner pane on the right
- Sash variants: thin + no icon, thick + grip icon, color overrides via inline tokens
- Size variants: sm / md / lg
- Snap-to-close demo: drag the prompt pane below its minimum, watch it collapse; drag back to reopen
- Persistent layout demo: reload the page, layout is restored
- Disabled pane (non-resizable sash)
- Live readout of current layout ratio (demonstrates `onSizeCommit` callback)

Each sub-demo has a short caption explaining what it shows. The gallery is the reference the Tide card integration will look at when mounting T3.4 content.

---

## Checkpoints

- `bun add react-resizable-panels` and verify MIT license in the resolved package
- `bun run build` exits 0
- `bun run test` exits 0
- `bun run audit:tokens lint` exits 0
- Drag resize works in both orientations
- Keyboard: Tab to sash, arrow keys resize, Enter toggles collapse on collapsible panels
- Min/max sizes enforced during drag and on container resize
- Snap-to-close fires after `snapThreshold` px past min; reopens symmetrically
- Collapsed pane preserves internal state (test: type into an input in the collapsed pane, expand, still there)
- Persistent layout: set a layout, reload, layout is restored when `storageKey` is set
- Imperative ref API: `.collapsePanel()`, `.expandPanel()`, `.getLayout()`, `.setLayout()` all work
- `onSizeCommit` fires on pointer-up, not during drag
- `onCollapsedChange` fires when snap toggles
- ARIA: `role="separator"` + `aria-orientation` + `aria-valuenow` present on every sash
- Nested split panes render and resize independently
- Sash `icon`, `thickness`, `hitArea` props all visibly affect the result
- Conforms to the component authoring guide checklist ([L19])
- All tokens follow the seven-slot `--tug7-split-*` convention ([L20])
- Pairings declared in both `brio.css` and `harmony.css` ([L16])

---

## Plan-of-work summary

This document is the design spec. Implementation will follow the standard tugplug plan/implement workflow with roughly these steps:

1. Add `react-resizable-panels` dependency; verify license
2. Author `tug-split-pane.tsx` wrapping `PanelGroup` + `Panel` + `PanelResizeHandle`, with `TugSplitPane` and `TugSplitPanel` exports
3. Author `tug-split-pane.css` with tokens, pairings, size variants, states
4. Add tokens to `brio.css` and `harmony.css`
5. Author `gallery-split-pane.tsx` demo card
6. Add gallery registration
7. Polish: keyboard behavior, snap thresholds, focus rings, ARIA verification
8. Update `component-library-roadmap.md` and link this doc from the Tide roadmap's T3.4 prerequisites

Once `tug-split-pane` is in place, T3.4 picks up with confidence: the Tide card's content area becomes a `<TugSplitPane orientation="horizontal">` with `tug-markdown-view` on top and `tug-prompt-entry` on the bottom, and the rest of T3.4 is about the prompt-entry composition itself.
