<!-- tugplan-skeleton v2 -->

## Adopt React 19 + shadcn/ui for Tugdeck {#react-shadcn-adoption}

**Purpose:** Replace tugdeck's vanilla TypeScript DOM manipulation with React 19 components and shadcn/ui controls, using Bun + Vite as the build toolchain and bridging the Tuglook design token system into shadcn's CSS variable theming. Card content is migrated incrementally while the canvas layout engine and chrome layer remain vanilla TS.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | react-shadcn-adoption |
| Last updated | 2026-02-26 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Tugdeck has grown to ~19,000 lines of vanilla TypeScript across 33 source files and 23 test files. Features like conversation UI with streaming indicators, question forms with radio buttons and checkboxes, tool approval prompts, file attachment handling, settings panels, and dropdown menus are all built with raw `document.createElement` calls, manual event listener wiring, and hand-managed DOM state. The conversation card alone is 990 lines; the question card is 322 lines of createElement/appendChild that would be ~60 lines of JSX with shadcn's RadioGroup, Checkbox, and Button.

The vanilla TS approach now costs more than it saves. Every new interactive feature requires boilerplate DOM wiring, there is no component composition model, and accessibility/keyboard navigation must be hand-implemented for every control. The project has passed the crossover point where a component framework (React) plus a pre-built accessible component library (shadcn/ui via Radix) will reduce per-feature development time by 3-5x.

#### Strategy {#strategy}

- Scaffold the React + shadcn + Tailwind + Vite toolchain alongside existing code, then immediately migrate the Rust build pipeline (`build.rs`, `dev.rs`) to Vite's `dist/` output model — this front-loads the build system change and minimizes the window of instability between the frontend and Rust layers.
- Create a `ReactCardAdapter` bridge so React components render inside the existing `CardFrame` containers managed by the vanilla TS canvas layout engine; `deck-manager.ts` receives a targeted addition (calling optional `setCardFrame()` and `setActiveTab()` methods on the `TugCard` interface during render/tab-activate) to enable live meta updates, but its layout/state/serialization logic is unchanged.
- The adapter provides **live meta updates**: when a React component changes its title or menu items, the adapter pushes those changes to the `CardHeader` DOM immediately via a new `updateMeta()` method on CardHeader, rather than waiting for a full `DeckManager.render()` cycle.
- Migrate cards incrementally by complexity: About (trivial, no feeds) first as a proof-of-concept, then Settings (form controls), then Question/Approval (interactive forms), then the simple data cards (Files, Git, Stats, Developer), then Conversation (the largest and most complex), and finally Terminal.
- Replace each vanilla TS test with a React Testing Library test in the same step that converts the card.
- Keep the WebSocket connection layer (`connection.ts`, `protocol.ts`), canvas layout engine (`snap.ts`, `layout-tree.ts`, `serialization.ts`, `drag-state.ts`), and chrome layer (`card-menu.ts`, `tab-bar.ts`, `dock.ts`) as vanilla TS throughout this plan. `card-header.ts`, `card-frame.ts`, and `deck-manager.ts` remain vanilla TS but receive targeted method additions (`updateMeta()`, `setCardFrame()`) to support the React adapter's live meta update bridge. React should eventually own menu rendering via shadcn (planned follow-on); the adapter design supports this transition.
- Leverage the existing Tuglook-to-shadcn CSS variable bridge already present in `tokens.css` (the "Legacy aliases" section maps `--background`, `--foreground`, `--primary`, etc. from `--td-*` tokens); create `globals.css` as the Tailwind entry point that imports `tokens.css`, ensuring all three themes (Brio, Bluenote, Harmony) work automatically through the existing class-on-body mechanism.

#### Success Criteria (Measurable) {#success-criteria}

- All 8 card types render correctly as React components inside the existing canvas layout (`bun run build` succeeds, manual verification of each card type in all 3 themes)
- All card-level tests pass using React Testing Library (`bun test` exits 0)
- `cargo build` succeeds with the updated `build.rs` embedding Vite `dist/` output
- `cargo nextest run` exits 0 (no Rust test regressions)
- No regressions in WebSocket connectivity, card frame positioning/resizing, or snap behavior (existing deck-manager and snap tests pass unchanged)
- Vanilla TS card source files and their CSS are deleted; no dual-implementation code remains
- Visual result is functionally equivalent to the current vanilla TS implementation; pixel-level visual parity is NOT required — minor style drift from Tailwind/shadcn defaults is acceptable

#### Scope {#scope}

1. Scaffold Vite + React 19 + Tailwind CSS v4 + shadcn/ui toolchain in tugdeck
2. Update `build.rs` and `dev.rs` to run Vite build and embed full `dist/` directory (immediately after scaffold)
3. Create `globals.css` as Tailwind entry point importing `tokens.css` (which already provides the shadcn CSS variable bridge)
4. Build `ReactCardAdapter` implementing `TugCard` interface, mounting React roots inside `CardFrame` containers with live meta updates to `CardHeader`
5. Create React hooks: `useConnection` (WebSocket context), `useFeed` (feed subscription), `useTheme` (theme context)
6. Convert all 8 card types to React components with shadcn/ui controls
7. Replace all vanilla TS card tests with React Testing Library tests
8. Clean up: remove old vanilla TS card files, `cards.css`, `cards-chrome.css` card-content styles, and `assets.toml`

#### Non-goals (Explicitly out of scope) {#non-goals}

- Converting the chrome layer (card-header, card-menu, tab-bar, dock) to React; this is a planned follow-on where React owns menu rendering via shadcn DropdownMenu. Note: `card-header.ts` and `card-frame.ts` receive targeted `updateMeta()` method additions for the React adapter bridge, and `deck-manager.ts` receives targeted additions to call optional `setCardFrame()` and `setActiveTab()` methods on the `TugCard` interface during render/tab-activate — these are minimal additions, not conversions.
- Converting or modifying the canvas layout engine behavior (snap, layout-tree, serialization, drag-state); `deck-manager.ts` receives only targeted additions to call optional `setCardFrame()` and `setActiveTab()` methods on the `TugCard` interface during render/tab-activate, with no changes to layout, state management, or serialization logic
- Converting or modifying the WebSocket connection layer (connection.ts, protocol.ts) beyond wrapping in a React context
- Adding new features or UI capabilities not present in the current vanilla TS implementation
- Server-side rendering or any non-browser rendering target
- Replacing marked or shiki with alternative libraries
- Pixel-level visual parity with the vanilla TS implementation; functional equivalence with minor style drift is acceptable

#### Dependencies / Prerequisites {#dependencies}

- Bun runtime installed (already a project prerequisite)
- Node.js not required (Bun provides the runtime and package management)
- Existing tugdeck vanilla TS codebase is working and tests pass

#### Constraints {#constraints}

- Production build must be embeddable via rust-embed in the tugcast binary (single-file serving, no external CDN)
- Content Security Policy must remain: `script-src 'self' 'wasm-unsafe-eval'` (no inline scripts, no eval — Vite production build satisfies this)
- All three Tuglook themes (Brio, Bluenote, Harmony) must work correctly; functional equivalence to current implementation is required but pixel-level parity is not
- `CardFrame` remains vanilla TS; React mounts only inside the card content area below the header
- CustomEvent-based inter-component communication continues as the event bus mechanism during and after migration
- The user will NOT run the app mid-migration; there is no requirement for green `cargo build` between individual card conversion steps — only `bun test` and `bun run build` checkpoints until the build pipeline step

#### Assumptions {#assumptions}

- Vite config at `tugdeck/vite.config.ts`; existing `tsconfig.json` updated for JSX (tsx files)
- shadcn `components.json` configured with path alias `@/components` mapping to `tugdeck/src/components`
- `tokens.css` remains the source of truth for Tuglook design tokens; Tailwind theme references CSS custom properties rather than duplicating values
- `bun.lock` and `package.json` updated with new dependencies; `node_modules` not committed
- `lucide-react` added alongside `lucide` in the scaffold step; both coexist because chrome-layer files (card-header.ts, dock.ts) and retained vanilla card files import from `lucide`; `lucide` removal is deferred to the follow-on chrome-layer conversion plan
- `isomorphic-dompurify` retained until Step 10 cleanup because vanilla `message-renderer.ts` imports it; React components use `dompurify` directly with `dangerouslySetInnerHTML` for markdown rendering
- React components are `.tsx` files; pure TypeScript non-component files remain `.ts`
- Vite dev server (`bun run dev`) used for development only; production path is `build.rs` invoking Vite build
- DropdownMenu, Tabs, and Tooltip shadcn components are installed intentionally in the scaffold step to support the planned follow-on where React owns menu rendering

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Tailwind v4 CSS-only configuration vs config file (DECIDED) {#q01-tailwind-config}

**Question:** Tailwind CSS v4 supports CSS-only configuration via `@theme` directives. Should we use CSS-only config in `globals.css` or maintain a separate `tailwind.config.ts`?

**Why it matters:** CSS-only config is simpler and avoids a config file, but may be less familiar. A config file is more explicit but duplicates what can be done in CSS.

**Options (if known):**
- CSS-only via `@theme` in `globals.css` (Tailwind v4 default)
- Traditional `tailwind.config.ts` file

**Plan to resolve:** Evaluated. CSS-only is the correct choice.

**Resolution:** DECIDED — Use CSS-only configuration via `@theme` directives in `globals.css`. Tailwind v4's CSS-only approach is the default, avoids an extra config file, and aligns naturally with the existing `tokens.css` CSS custom property approach. No `tailwind.config.ts` file is created. The `@theme` block registers CSS custom properties from `tokens.css` into Tailwind's theme namespace (e.g., `--color-background: var(--background)`) so that utility classes like `bg-background`, `text-foreground`, `bg-primary` resolve correctly.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Two rendering models cause event conflicts | med | med | CustomEvent bus decouples models; test interop in Step 3 | Event delivery failures during card conversion |
| CSP blocks Vite output | high | low | Verify production build has no inline scripts in Step 1 | Build output contains inline script tags |
| xterm.js conflicts with React lifecycle | med | low | Wrap in useEffect + ref; proven pattern | Terminal card flickers or drops input after conversion |
| Tuglook theme tokens don't map cleanly to shadcn variables | med | low | Existing bridge in tokens.css already provides mapping; verify all needed variables present | Visual discrepancy in any theme after Step 1 |
| Live meta update causes flicker or layout shift in CardHeader | med | low | CardHeader.updateMeta() performs targeted DOM mutations (title text, icon swap, menu rebuild) rather than full re-render | Header flickers during conversation title changes |
| Vite dist/ output significantly larger than current bun build | med | low | Verify dist/ total size in Step 1 checkpoint; shiki grammar chunks (~600+ files, ~45 MB) are expected and desirable for lazy loading — only flag if non-shiki application chunks exceed 10 files or total dist/ exceeds 60 MB | dist/ total size exceeds 60 MB or non-shiki application JS chunks exceed 10 files |
| RTL + happy-dom incompatibility under bun test | med | med | Validate RTL render/fireEvent in Step 1; fallback: switch bunfig.toml to jsdom | RTL render() or fireEvent() fails or behaves incorrectly in happy-dom |

**Risk R01: Dual rendering model event conflicts** {#r01-dual-rendering}

- **Risk:** During migration, React cards and vanilla TS cards coexist. CustomEvents dispatched by React cards might not reach vanilla TS listeners or vice versa, causing broken interactions.
- **Mitigation:**
  - Both models use `document.addEventListener` / `document.dispatchEvent` — they share the same event target
  - React cards use `useEffect` for event subscription, matching the vanilla pattern
  - Integration test covers cross-model event delivery in Step 3
- **Residual risk:** Subtle timing differences between React's batched updates and synchronous vanilla TS handlers may surface in edge cases.

**Risk R02: CSP violation from Vite output** {#r02-csp-violation}

- **Risk:** Vite might inject inline scripts or use `eval()` in production builds, violating the existing Content Security Policy.
- **Mitigation:**
  - Verify production build output in Step 1 checkpoint
  - Vite's production mode does not inject inline scripts by default
  - If needed, configure `build.modulePreload.polyfill: false` in Vite config
- **Residual risk:** None if verified in Step 1.

**Risk R03: Live meta update causes header flicker** {#r03-meta-flicker}

- **Risk:** Frequent meta updates from React components (e.g., conversation title changing on every message) could cause visible flicker or layout shift in the CardHeader.
- **Mitigation:**
  - `CardHeader.updateMeta()` performs surgical DOM mutations: only updates the title textContent, swaps the icon SVG, and rebuilds the menu button if menu items changed
  - The adapter debounces or batches meta update events if needed
  - Meta changes that don't affect visible DOM (e.g., only callback references changed) skip DOM mutations
- **Residual risk:** Menu item count changes cause menu button to appear/disappear, which is an intentional layout shift.

---

### Design Decisions {#design-decisions}

> Record *decisions* (not options). Each decision includes the "why" so later phases don't reopen it accidentally.

#### [D01] Use Vite as bundler, replacing Bun's native bundler (DECIDED) {#d01-vite-bundler}

**Decision:** Use Vite (via `@vitejs/plugin-react` and `@tailwindcss/vite`) as the dev server and production bundler, replacing the current `bun build` command.

**Rationale:**
- Tailwind CSS v4 has first-party Vite support via `@tailwindcss/vite`; Bun's bundler requires an unproven community plugin
- Vite provides HMR for development, which Bun's bundler does not
- Vite's React plugin handles JSX transform, Fast Refresh, and production optimizations

**Implications:**
- `package.json` scripts change: `"build": "vite build"`, `"dev": "vite"`
- `build.rs` invokes `bun run build` instead of `bun build src/main.ts`
- `index.html` becomes the Vite entry point (HTML references the TS entry via `<script type="module">`)

#### [D02] Embed full Vite dist/ directory via rust-embed (DECIDED) {#d02-embed-vite-dist}

**Decision:** Update `build.rs` to run `bun run build` (Vite build), then embed the entire Vite `dist/` directory via rust-embed. Remove the `assets.toml` explicit file listing only after all Rust fixture and test updates are complete in the same step.

**Rationale:**
- Vite produces a self-contained `dist/` with hashed asset filenames and an `index.html` entry point
- The current `assets.toml` manifest model assumes known filenames; Vite's content-hashed output names are dynamic
- Embedding the whole `dist/` directory is simpler and more robust than parsing Vite's manifest to build a file list
- Removing `assets.toml` before Rust tests are updated would break the test suite

**Implications:**
- `assets.toml` is deleted at the end of the build pipeline step, after all Rust fixture and test updates
- `build.rs` copies the entire `dist/` subtree into `OUT_DIR/tugdeck/` instead of individual files
- `dev.rs` serves files exclusively from the `dist/` directory; no Vite dev server proxy or source-tree fallback — `bun run dev` is for standalone frontend work only
- The `AssetManifest` struct in `build.rs` and `dev.rs` is replaced with a directory copy

#### [D03] React mounts inside CardFrame content area only (DECIDED) {#d03-react-content-only}

**Decision:** React components render inside the card content area managed by `CardFrame`. The chrome layer (card-header, card-menu, tab-bar, dock) and the canvas layout engine remain vanilla TS. A `ReactCardAdapter` class implements the `TugCard` interface and bridges between the vanilla TS card system and React. The adapter design explicitly supports the planned follow-on where React owns menu rendering via shadcn DropdownMenu.

**Rationale:**
- Minimizes coupling between React and the canvas layout engine
- Allows incremental migration — one card at a time — without touching the frame/chrome layer
- CardFrame already treats card content as an opaque HTMLElement; React's `createRoot` mounts into the same container
- The adapter interface is designed so that when React takes over menus in the follow-on plan, the `useCardMeta` hook and event-driven pattern can be extended without architectural changes

**Implications:**
- Each React card component receives its container via `ReactCardAdapter.mount(container)`
- `ReactCardAdapter` creates a React root, passes connection/feed data via React context
- CardFrame callbacks (onResize, focus) are forwarded to React via context or props
- Chrome conversion is explicitly deferred to a follow-on plan

#### [D04] CustomEvents remain the inter-component event bus (DECIDED) {#d04-custom-events}

**Decision:** React cards dispatch and subscribe to `CustomEvent` on `document`, matching the existing vanilla TS behavior. No new event bus or state management library is introduced.

**Rationale:**
- The existing event system works across both rendering models during the migration period
- React cards subscribe via `useEffect` + `document.addEventListener`, which is idiomatic
- Introducing Redux, Zustand, or another state manager would add scope and complexity

**Implications:**
- React components use `useEffect` cleanup to remove event listeners
- Event payloads remain the same `CustomEvent.detail` objects
- After all cards are React, a future plan could migrate to React context or a state library, but this is not required

#### [D05] Leverage existing Tuglook-to-shadcn token bridge in tokens.css (DECIDED) {#d05-token-bridge}

**Decision:** The existing `tokens.css` already provides a complete shadcn CSS variable bridge in its "Legacy aliases" section (variables like `--background`, `--foreground`, `--primary`, `--border`, `--ring`, `--radius`, etc. mapped from `--td-*` tokens). The `globals.css` file serves as the Tailwind CSS entry point and imports `tokens.css` but does NOT redefine the shadcn variable bridge.

**Rationale:**
- `tokens.css` already maps all shadcn-expected variable names to `--td-*` semantic tokens
- Duplicating these mappings in `globals.css` would create a maintenance burden and risk divergence
- Theme switching via class-on-body already works because `--td-*` tokens are overridden per theme and the shadcn aliases follow via `var()` references

**Implications:**
- `globals.css` imports `@tailwindcss` and `tokens.css`; no shadcn variable definitions in `globals.css`
- If future shadcn components need additional CSS variables not yet bridged, add them to `tokens.css` in the "Legacy aliases" section
- `tokens.css` remains the single source of truth for all design tokens and shadcn variable mappings

#### [D06] Create React tests alongside vanilla; defer deletion to cleanup step (DECIDED) {#d06-replace-tests}

**Decision:** Write React Testing Library tests for each card during its conversion step, but defer deletion of vanilla TS card files and their tests to the final cleanup step (Step 10). Vanilla files are retained during migration because (a) conversation submodule files are imported by the vanilla conversation-card.ts until it is converted, and (b) chrome-layer test files (`__tests__/card-menus.test.ts`, `__tests__/card-header.test.ts`, `__tests__/e2e-integration.test.ts`) import vanilla card classes and must be updated atomically when those files are deleted.

**Rationale:**
- Prevents build breakage from cascading import failures (conversation submodules imported by vanilla conversation-card.ts; standalone cards imported by chrome-layer tests)
- Maintains test coverage continuity — React RTL tests are added before vanilla tests are removed
- Chrome-layer test updates are consolidated in one step rather than scattered across conversion steps

**Implications:**
- Each card conversion step creates the React component and RTL tests but does NOT delete vanilla files
- Step 10 performs all vanilla file deletion, updates `__tests__/` imports, and removes card-content CSS
- During migration, both vanilla and React versions of each card exist in the source tree; only the React version is wired into `main.tsx`
- `@testing-library/react` and `@testing-library/jest-dom` added as dev dependencies in Step 1
- happy-dom continues as the test environment for existing vanilla tests; RTL compatibility with happy-dom under bun test is validated in Step 1 — if `render()` and `fireEvent()` do not work correctly with happy-dom, the fallback is to switch `bunfig.toml` to jsdom for RTL test files
- Test isolation: bun test runs each test file in a separate worker with a fresh global scope, so vanilla tests that manually create Window instances or set globals cannot pollute RTL tests and vice versa. No special isolation configuration is needed beyond bun's default per-file isolation.

#### [D07] Use cn() utility for conditional class merging (DECIDED) {#d07-cn-utility}

**Decision:** Create a `cn()` utility function (standard shadcn pattern) combining `clsx` and `tailwind-merge` for conditional class name construction.

**Rationale:**
- shadcn components use `cn()` throughout; it's a required utility
- `clsx` handles conditional class names; `tailwind-merge` resolves Tailwind class conflicts
- This is the standard pattern used by every shadcn installation

**Implications:**
- `src/lib/utils.ts` exports `cn()`
- All React components use `cn()` for class name merging
- `clsx` and `tailwind-merge` are production dependencies

#### [D08] ReactCardAdapter bridges TugCard interface to React with live meta updates (DECIDED) {#d08-react-adapter}

**Decision:** Create a `ReactCardAdapter` class that implements the `TugCard` interface. It accepts a React component factory function and handles mounting/unmounting React roots inside CardFrame containers, forwarding feed frames and resize events via React context. Dynamic card meta (title, icon, menu items with stateful callbacks) is bridged via an event-driven pattern: React components dispatch `CustomEvent("card-meta-update")` on their container element, and the adapter **immediately pushes the updated meta to the CardHeader** via a new `CardHeader.updateMeta()` method that performs targeted DOM mutations (title text, icon swap, menu rebuild). This is NOT a cache-for-next-render pattern — the header updates live.

**Rationale:**
- The deck-manager's card registration system expects `TugCard` instances with `mount()`, `onFrame()`, `onResize()`, and `destroy()` methods
- The adapter pattern allows React components to be used without modifying deck-manager or card-frame
- Feed data is passed through a React context provider so components can subscribe to specific feeds
- Every existing card implements `meta` as a dynamic getter with menu callbacks that close over internal state (e.g., FilesCard's "Clear History" calls `this.eventList.innerHTML`, ConversationCard's title reads `this.projectDir`); static meta at construction time cannot bridge React state, so event-driven updates are needed
- **Live updates are required**: when the conversation title changes, the header must update immediately — not on the next `DeckManager.render()` cycle. The adapter achieves this by calling `CardHeader.updateMeta(newMeta)` directly when it receives a `card-meta-update` event, which performs surgical DOM mutations on the title element, icon, and menu button

**Implications:**
- `ReactCardAdapter` creates a React `createRoot` in `mount()` and calls `root.unmount()` in `destroy()`
- A `CardContext` provides `connection`, `feedData`, `dimensions`, `dragState`, and a `updateMeta` callback to React components
- The adapter maintains a small event queue for frames received before React hydrates
- React components use a `useCardMeta` hook to dispatch meta updates; the adapter listens and immediately pushes to CardHeader
- `CardHeader` gains a new `updateMeta(meta: TugCardMeta)` method that performs targeted DOM mutations: updates title textContent, swaps icon SVG element, and rebuilds the menu button/dropdown if menu items changed
- `CardFrame` gains an `updateMeta(meta: TugCardMeta)` method that delegates to its CardHeader instance
- The adapter stores a reference to its CardFrame (set via a new `setCardFrame()` method called by DeckManager after card registration) and calls `cardFrame.updateMeta(newMeta)` on each meta update event

---

### Specification {#specification}

#### Inputs and Outputs {#inputs-outputs}

**Spec S01: ReactCardAdapter interface** {#s01-react-adapter}

In the existing codebase, every card implements `meta` as a dynamic getter that returns `TugCardMeta` with menu item callbacks that close over the card's internal state (e.g., `FilesCard.meta` returns a "Clear History" action that calls `this.eventList.innerHTML = ""`; `ConversationCard.meta` returns a dynamic title based on `this.projectDir`). When cards become React components, their state lives inside the React tree and is not accessible from a static meta object created at construction time.

The adapter solves this with a **live meta update** pattern: the React component dispatches a `CustomEvent("card-meta-update")` on its container whenever menu-relevant state changes. The adapter listens for this event and immediately pushes the updated meta to the CardHeader via `cardFrame.updateMeta(newMeta)`, which calls `CardHeader.updateMeta()` to perform targeted DOM mutations. The adapter also caches the latest meta in `_meta` so the `meta` getter returns current values if queried.

```typescript
import { TugCard, TugCardMeta } from "./cards/card";
import { FeedIdValue } from "./protocol";
import { TugConnection } from "./connection";
import { CardFrame } from "./card-frame";

interface ReactCardConfig {
  component: React.ComponentType<CardProps>;
  feedIds: readonly FeedIdValue[];
  initialMeta: TugCardMeta;
  connection?: TugConnection;
  collapsible?: boolean;
}

interface CardProps {
  // Provided via context, not direct props
}

class ReactCardAdapter implements TugCard {
  readonly feedIds: readonly FeedIdValue[];
  readonly collapsible?: boolean;
  private _meta: TugCardMeta;
  private _cardFrame: CardFrame | null = null;
  private _isActiveTab: boolean = true;

  constructor(config: ReactCardConfig);

  /** Dynamic meta getter — returns the latest meta from the React component.
   *  Initially returns initialMeta from config; updated when the React
   *  component dispatches a "card-meta-update" CustomEvent on its container. */
  get meta(): TugCardMeta;

  /** Called by DeckManager via optional method check on TugCard interface.
   *  Provides the CardFrame reference for live meta updates. Called for ALL
   *  tabs in a panel, not just the active tab. Accepts null to clear the
   *  reference before CardFrame destruction during render() teardown. */
  setCardFrame(frame: CardFrame | null): void;

  /** Called by DeckManager.handleTabActivate() via optional method check on
   *  TugCard interface. When active, cached meta is immediately pushed to
   *  CardFrame. When inactive, meta updates are cached but NOT pushed to
   *  CardFrame (to avoid overwriting the active tab's header). */
  setActiveTab(active: boolean): void;

  mount(container: HTMLElement): void;
  onFrame(feedId: FeedIdValue, payload: Uint8Array): void;
  onResize(width: number, height: number): void;
  focus?(): void;
  destroy(): void;
  setDragState(dragState: IDragState): void;
}
```

**Note on `setDragState`:** `setDragState(dragState)` is a method on the concrete `ReactCardAdapter` class, NOT part of the `TugCard` interface. Call sites in `main.tsx` call it on the concrete adapter type after construction. This avoids adding drag-specific concerns to the `TugCard` interface.

**Note on `setCardFrame` and `setActiveTab` in the `TugCard` interface:** These two methods are added as **optional** fields on the `TugCard` interface (`setCardFrame?(frame: CardFrame | null): void` and `setActiveTab?(active: boolean): void`). This keeps `DeckManager` polymorphic — it checks for method existence (`if (card.setCardFrame) card.setCardFrame(frame)`) rather than using `instanceof ReactCardAdapter`. No runtime type checks are needed, and existing card implementations are unaffected because TypeScript optional interface fields do not require implementors to provide them.

**Stale CardFrame guard:** During `DeckManager.render()`, all existing CardFrames are destroyed before new ones are created. If a React meta update fires during this window, the adapter would call `updateMeta()` on a destroyed CardFrame. This is prevented with a combined defense:
1. **DeckManager side:** Before destroying CardFrames in `render()`, iterate all registered cards and call `card.setCardFrame(null)` for any card that implements the optional method. This clears the adapter's reference before the old frame is destroyed.
2. **Adapter side:** The adapter's meta push path (`_cardFrame?.updateMeta(newMeta)`) uses optional chaining, so a null `_cardFrame` safely no-ops. This is belt-and-suspenders — even if the DeckManager clear is missed, the adapter will not crash.

**Live meta update protocol:** React components call a `useCardMeta(meta: TugCardMeta)` hook (provided via `CardContext`) that dispatches `new CustomEvent("card-meta-update", { detail: meta })` on the adapter's container element whenever the meta value changes. The adapter listens for this event in `mount()` and:
1. **Replaces** the entire cached `_meta` with the new meta object (no merge — full replacement ensures menu item callbacks reference the latest React state closures)
2. If `_cardFrame` is set **AND** `_isActiveTab` is true, calls `_cardFrame.updateMeta(newMeta)` which delegates to `CardHeader.updateMeta(newMeta)`. If `_isActiveTab` is false, the meta is cached but NOT pushed to CardFrame (to avoid overwriting the header of a panel where a different tab is active).

**Multi-tab panel behavior:** In multi-tab panels, DeckManager calls `card.setCardFrame(frame)` for ALL tabs' cards that implement the optional method (they all share the same CardFrame). `card.setActiveTab(true/false)` is called by `DeckManager.handleTabActivate()` via optional method check to mark which card is active. When `setActiveTab(true)` is called, the adapter immediately pushes its cached `_meta` to the CardFrame, ensuring the header reflects the newly active tab's title, icon, and menu items.

**CardHeader.updateMeta(meta)** performs surgical DOM updates:
- **First**: closes and destroys the active menu if one is open (`this.activeMenu.destroy(); this.activeMenu = null`) — this prevents stale menu UI or leaked event handlers when meta changes trigger a menu rebuild
- Updates the title `textContent` if the title changed
- Swaps the icon SVG element if the icon name changed
- Rebuilds the menu button and dropdown binding if `menuItems` changed (add/remove button, update items)
- Preserves all other header DOM (collapse button, close button, drag handler)

This ensures that when a conversation title changes, the header updates immediately — not on the next `DeckManager.render()` cycle.

**Spec S02: CardContext shape** {#s02-card-context}

```typescript
interface CardContextValue {
  connection: TugConnection | null;
  feedData: Map<FeedIdValue, Uint8Array>;
  dimensions: { width: number; height: number };
  dragState: IDragState | null;
  dispatch: (feedId: FeedIdValue, payload: Uint8Array) => void;
  /** Update the card's TugCardMeta (title, icon, menu items).
   *  Dispatches a CustomEvent on the container so the adapter
   *  immediately pushes the new meta to CardHeader for live DOM update. */
  updateMeta: (meta: TugCardMeta) => void;
}
```

**Spec S03: globals.css Tailwind entry point** {#s03-globals-css}

The `globals.css` file serves as the Tailwind CSS entry point. It does NOT redefine shadcn CSS variables because `tokens.css` already provides the complete shadcn variable bridge in its "Legacy aliases" section (lines 242-271), mapping `--background`, `--foreground`, `--primary`, `--secondary`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`, etc. to the corresponding `--td-*` semantic tokens. These mappings already respond correctly to theme switching via class-on-body since the `--td-*` tokens are overridden in `.td-theme-bluenote` and `.td-theme-harmony`.

```css
@import "tailwindcss";
@import "../styles/tokens.css";

/*
 * shadcn CSS variable bridge is already defined in tokens.css
 * under "Legacy aliases (runtime contracts - Table T06)".
 *
 * Variables provided by tokens.css:
 *   --background, --foreground, --card, --card-foreground,
 *   --muted, --muted-foreground, --popover, --popover-foreground,
 *   --border, --border-muted, --input, --ring,
 *   --primary, --primary-foreground,
 *   --secondary, --secondary-foreground,
 *   --accent, --accent-foreground,
 *   --destructive, --destructive-foreground,
 *   --success, --success-foreground,
 *   --warning, --warning-foreground,
 *   --info, --info-foreground,
 *   --radius, --radius-sm, --radius-lg
 *
 * Do NOT duplicate the variable definitions here. tokens.css is the source of truth.
 * The @theme block below registers these variables with Tailwind v4 so that
 * utility classes like bg-background, text-foreground, bg-primary etc. resolve.
 */

/*
 * Tailwind v4 @theme registration: maps CSS custom properties from tokens.css
 * into Tailwind's theme namespace so utility classes work.
 * Without this block, classes like bg-primary and text-foreground will NOT resolve.
 */
@theme {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: var(--radius-sm);
  --radius-md: var(--radius);
  --radius-lg: var(--radius-lg);
}
```

If additional shadcn variables are needed for new components not covered by the existing bridge, add the CSS variable to `tokens.css` in the "Legacy aliases" section AND register it in the `@theme` block in `globals.css`.

**Table T01: shadcn components to install** {#t01-shadcn-components}

| Component | Radix Dependency | Used By | Notes |
|-----------|-----------------|---------|-------|
| Button | — | All cards | |
| Input | — | Settings, Conversation | |
| Textarea | — | Conversation | |
| Checkbox | @radix-ui/react-checkbox | Question card | |
| RadioGroup | @radix-ui/react-radio-group | Question card, Settings | |
| Switch | @radix-ui/react-switch | Settings | |
| DropdownMenu | @radix-ui/react-dropdown-menu | Card menus (follow-on) | Installed for planned React menu ownership |
| Dialog | @radix-ui/react-dialog | Future use | Installed for follow-on features |
| Card | — | All cards | |
| Tabs | @radix-ui/react-tabs | Tab bar (follow-on) | Installed for planned React chrome ownership |
| ScrollArea | @radix-ui/react-scroll-area | Conversation, Files, Git | |
| Select | @radix-ui/react-select | Settings, Files | |
| Tooltip | @radix-ui/react-tooltip | Toolbar buttons (follow-on) | Installed for planned React chrome ownership |

**Table T02: Dependency changes** {#t02-dependency-changes}

| Action | Package | Category |
|--------|---------|----------|
| Add | react, react-dom | production |
| Add | @types/react, @types/react-dom | dev |
| Add | tailwindcss, @tailwindcss/vite | dev |
| Add | @vitejs/plugin-react | dev |
| Add | class-variance-authority | production |
| Add | clsx, tailwind-merge | production |
| Add | lucide-react | production |
| Add | @testing-library/react, @testing-library/jest-dom | dev |
| Add | vite | dev |
| Keep | dompurify, @types/dompurify | production (already present; React components use dompurify directly instead of isomorphic-dompurify) |
| Keep | lucide | production (still imported by chrome-layer files and retained vanilla cards; removal deferred to follow-on chrome conversion plan) |
| Keep | isomorphic-dompurify | production (still imported by retained vanilla message-renderer.ts; removal deferred to Step 10) |

**Table T03: Card conversion order and complexity** {#t03-card-order}

| Order | Card | Lines (vanilla TS) | Feeds | Interactive Controls | Difficulty |
|-------|------|-------------------|-------|---------------------|------------|
| 1 | About | 83 | none | none | trivial |
| 2 | Settings | 317 | none | radio, switch, button | medium |
| 3 | Question | 322 | — (submodule) | radio, checkbox, input, button | medium |
| 4 | Approval | 156 | — (submodule) | button (allow/deny) | easy |
| 5 | Files | 148 | FILESYSTEM | select (max entries), button (clear) | easy |
| 6 | Git | 232 | GIT | none (display only) | easy |
| 7 | Stats | 382 | STATS, STATS_PROCESS_INFO, STATS_TOKEN_USAGE, STATS_BUILD_STATUS | toggle (sections), button (refresh) | medium |
| 8 | Developer | 518 | GIT | button, toggle, git status display, 3-category change tracking | medium-hard |
| 9 | Conversation | 990 + submodules | CODE_OUTPUT | textarea, button, scroll, markdown | hard |
| 10 | Terminal | 260 | TERMINAL_OUTPUT | xterm.js imperative integration | medium |

#### Internal Architecture {#internal-architecture}

**Spec S04: React mounting architecture** {#s04-mounting-architecture}

```
DeckManager (vanilla TS, unchanged)
  └─ CardFrame (vanilla TS, gains updateMeta() method)
       ├─ CardHeader (vanilla TS, gains updateMeta() method for live DOM updates)
       └─ cardAreaEl (HTMLElement)
            └─ React.createRoot()
                 └─ <CardContextProvider>
                      └─ <SettingsCard /> (or any React card)
```

The `ReactCardAdapter.mount(container)` call:
1. Creates a React root via `createRoot(container)`
2. Renders a `<CardContextProvider>` wrapping the React card component
3. The provider supplies connection, feed data, dimensions, and drag state
4. `onFrame()` updates feed data in a ref, triggering a re-render via state update
5. `onResize()` updates dimensions in state
6. `destroy()` calls `root.unmount()` and cleans up

The live meta update flow:
1. React component calls `useCardMeta({ title, icon, menuItems, closable })` with current state
2. Hook dispatches `CustomEvent("card-meta-update")` on the container element
3. Adapter receives event, caches new meta, calls `cardFrame.updateMeta(newMeta)`
4. CardFrame delegates to `cardHeader.updateMeta(newMeta)` for immediate DOM mutation
5. CardHeader updates title text, icon SVG, and menu button as needed

**Spec S05: Vite configuration** {#s05-vite-config}

```typescript
// tugdeck/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Note: no server.proxy config — dev.rs serves from dist/ only;
  // `bun run dev` (Vite dev server) is for standalone frontend work
  // and uses its own WebSocket proxy configured here if needed:
  server: {
    proxy: {
      "/ws": {
        target: "ws://localhost:7080",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
```

**Spec S06: Updated build.rs flow** {#s06-build-rs}

```
1. Check Bun is installed
2. Run `bun install` if node_modules missing
3. Run `bun run build` (invokes `vite build`)
4. Copy CONTENTS of `dist/` into `OUT_DIR/tugdeck/` (flat — `index.html` at root of embed folder, not nested in a `dist/` subdirectory)
5. Set rerun-if-changed for `tugdeck/src/`, `tugdeck/package.json`, `tugdeck/vite.config.ts`, `tugdeck/index.html`
```

The current per-file copy loop from `assets.toml` is replaced with a recursive copy of the CONTENTS of `dist/` into `OUT_DIR/tugdeck/`. The `index.html` must be at the root of the embed folder (not nested in a `dist/` subdirectory) for rust-embed to serve it correctly.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/vite.config.ts` | Vite configuration with React and Tailwind plugins |
| `tugdeck/components.json` | shadcn/ui configuration for component paths |
| `tugdeck/src/globals.css` | Tailwind entry point; imports tokens.css (shadcn bridge already in tokens.css) |
| `tugdeck/src/lib/utils.ts` | `cn()` utility for conditional class merging |
| `tugdeck/src/lib/markdown.ts` | Pure TS utility: `renderMarkdown`, `SANITIZE_CONFIG`, `enhanceCodeBlocks` extracted from message-renderer.ts |
| `tugdeck/src/main.tsx` | Renamed from main.ts; CSS imports added at top; card registrations modified incrementally in Steps 4-9 |
| `tugdeck/src/hooks/use-connection.ts` | React context hook for WebSocket connection |
| `tugdeck/src/hooks/use-feed.ts` | React hook for subscribing to feed data |
| `tugdeck/src/hooks/use-theme.ts` | React context hook for theme management |
| `tugdeck/src/hooks/use-card-meta.ts` | Hook for React components to dispatch meta updates to adapter |
| `tugdeck/src/cards/react-card-adapter.ts` | `ReactCardAdapter` implementing `TugCard` for React components |
| `tugdeck/src/cards/card-context.tsx` | `CardContext` and `CardContextProvider` |
| `tugdeck/src/components/ui/button.tsx` | shadcn Button component |
| `tugdeck/src/components/ui/input.tsx` | shadcn Input component |
| `tugdeck/src/components/ui/textarea.tsx` | shadcn Textarea component |
| `tugdeck/src/components/ui/checkbox.tsx` | shadcn Checkbox component |
| `tugdeck/src/components/ui/radio-group.tsx` | shadcn RadioGroup component |
| `tugdeck/src/components/ui/switch.tsx` | shadcn Switch component |
| `tugdeck/src/components/ui/dropdown-menu.tsx` | shadcn DropdownMenu component |
| `tugdeck/src/components/ui/dialog.tsx` | shadcn Dialog component |
| `tugdeck/src/components/ui/card.tsx` | shadcn Card component |
| `tugdeck/src/components/ui/tabs.tsx` | shadcn Tabs component |
| `tugdeck/src/components/ui/scroll-area.tsx` | shadcn ScrollArea component |
| `tugdeck/src/components/ui/select.tsx` | shadcn Select component |
| `tugdeck/src/components/ui/tooltip.tsx` | shadcn Tooltip component |
| `tugdeck/src/components/cards/about-card.tsx` | React About card component |
| `tugdeck/src/components/cards/settings-card.tsx` | React Settings card component |
| `tugdeck/src/components/cards/conversation/question-card.tsx` | React Question card component |
| `tugdeck/src/components/cards/conversation/approval-prompt.tsx` | React Approval prompt component |
| `tugdeck/src/components/cards/files-card.tsx` | React Files card component |
| `tugdeck/src/components/cards/git-card.tsx` | React Git card component |
| `tugdeck/src/components/cards/stats-card.tsx` | React Stats card component |
| `tugdeck/src/components/cards/developer-card.tsx` | React Developer card component |
| `tugdeck/src/components/cards/conversation/conversation-card.tsx` | React Conversation card component |
| `tugdeck/src/components/cards/conversation/message-renderer.tsx` | React message renderer component |
| `tugdeck/src/components/cards/conversation/code-block.tsx` | React code block component |
| `tugdeck/src/components/cards/conversation/tool-card.tsx` | React tool card component |
| `tugdeck/src/components/cards/conversation/attachment-handler.tsx` | React attachment handler component |
| `tugdeck/src/components/cards/conversation/streaming-state.tsx` | Streaming state rewritten as React-compatible module (vanilla version manipulates DOM directly) |
| `tugdeck/src/components/cards/terminal-card.tsx` | React Terminal card component (xterm.js wrapper) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ReactCardAdapter` | class | `tugdeck/src/cards/react-card-adapter.ts` | Implements `TugCard`, bridges to React, pushes live meta to CardHeader |
| `CardContext` | context | `tugdeck/src/cards/card-context.tsx` | React context for card data |
| `CardContextProvider` | component | `tugdeck/src/cards/card-context.tsx` | Provider wrapping card content |
| `CardHeader.updateMeta` | method | `tugdeck/src/card-header.ts` | New method: targeted DOM mutation for live title/icon/menu updates. Requires refactoring constructor to store titleEl/iconEl/menuBtn as instance fields. |
| `CardFrame.updateMeta` | method | `tugdeck/src/card-frame.ts` | New method: delegates to CardHeader.updateMeta() |
| `TugCard.setCardFrame?` | optional method | `tugdeck/src/cards/card.ts` | Optional method on TugCard interface; accepts `CardFrame | null`; DeckManager calls via existence check (no instanceof) |
| `TugCard.setActiveTab?` | optional method | `tugdeck/src/cards/card.ts` | Optional method on TugCard interface; DeckManager calls via existence check (no instanceof) |
| `DeckManager.render` (modified) | method | `tugdeck/src/deck-manager.ts` | Addition: calls card.setCardFrame(cardFrame) and card.setActiveTab(isActive) via optional method checks for ALL tabs |
| `DeckManager.handleTabActivate` (modified) | method | `tugdeck/src/deck-manager.ts` | Addition: calls card.setActiveTab(false/true) via optional method checks to update header meta on tab switch |
| `useConnection` | hook | `tugdeck/src/hooks/use-connection.ts` | Access WebSocket connection |
| `useFeed` | hook | `tugdeck/src/hooks/use-feed.ts` | Subscribe to feed data |
| `useTheme` | hook | `tugdeck/src/hooks/use-theme.ts` | Access current theme |
| `useCardMeta` | hook | `tugdeck/src/hooks/use-card-meta.ts` | Dispatch meta updates to adapter via CustomEvent |
| `cn` | function | `tugdeck/src/lib/utils.ts` | Class name merge utility |
| `renderMarkdown` | function | `tugdeck/src/lib/markdown.ts` | Pure TS markdown rendering (extracted from message-renderer.ts) |
| `SANITIZE_CONFIG` | const | `tugdeck/src/lib/markdown.ts` | DOMPurify sanitization config (extracted from message-renderer.ts) |

---

### Documentation Plan {#documentation-plan}

- [ ] Update `tugdeck/README.md` (if it exists) with new build commands (`bun run dev`, `bun run build`)
- [ ] Add inline JSDoc to `ReactCardAdapter`, `CardContext`, and all hooks
- [ ] Document in `globals.css` comments that shadcn variable bridge lives in `tokens.css` "Legacy aliases" section
- [ ] Document `CardHeader.updateMeta()` method with JSDoc explaining the live update protocol

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test individual React components in isolation with RTL | Each card conversion step |
| **Integration** | Test ReactCardAdapter bridging to TugCard interface, including live meta updates | Step 3 (adapter creation) |
| **Golden / Contract** | Verify feed data parsing produces expected React renders | Conversation card, stats card |
| **Drift Prevention** | Ensure existing deck-manager/snap tests still pass | Every step checkpoint |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **Step sequencing rationale:** The build pipeline migration (Step 2) is placed immediately after scaffolding to minimize the window of instability between the frontend toolchain change and the Rust build/embed layer. The user will not run the app mid-migration, so there is no requirement for green `cargo build` between individual card conversion steps. Checkpoints for Steps 3-9 are tugdeck-only (`bun test`, `bun run build`).

#### Step 1: Scaffold Vite + React + Tailwind + shadcn toolchain {#step-1}

**Commit:** `feat(tugdeck): scaffold React 19 + Vite + Tailwind v4 + shadcn/ui toolchain`

**References:** [D01] Vite bundler, [D05] Token bridge, [D07] cn utility, Spec S03, Spec S05, Table T01, Table T02, Risk R02, (#strategy, #constraints, #assumptions)

**Artifacts:**
- `tugdeck/vite.config.ts` — Vite config with React and Tailwind plugins
- `tugdeck/components.json` — shadcn component configuration
- `tugdeck/src/globals.css` — Tailwind entry point importing tokens.css (shadcn bridge already exists in tokens.css)
- `tugdeck/src/lib/utils.ts` — `cn()` utility
- `tugdeck/tsconfig.json` — updated with JSX support, path aliases
- `tugdeck/package.json` — updated with all new dependencies per Table T02
- `tugdeck/src/main.tsx` — renamed from `main.ts`, CSS imports added at top
- `tugdeck/index.html` — updated as Vite entry point with `<script type="module" src="/src/main.tsx">`
- `tugdeck/public/fonts/` — woff2 font files moved to Vite's public directory for static serving
- All 13 shadcn UI components installed into `src/components/ui/` per Table T01

**Tasks:**
- [ ] Install production dependencies: react, react-dom, class-variance-authority, clsx, tailwind-merge, lucide-react (note: dompurify and @types/dompurify are already present — no install needed)
- [ ] Install dev dependencies: @types/react, @types/react-dom, tailwindcss, @tailwindcss/vite, @vitejs/plugin-react, vite, @testing-library/react, @testing-library/jest-dom
- [ ] Do NOT remove `lucide` — it is still imported by chrome-layer files (card-header.ts, dock.ts) and all retained vanilla card files; both `lucide` and `lucide-react` coexist as dependencies; `lucide` removal belongs in the follow-on chrome-layer conversion plan
- [ ] Do NOT remove `isomorphic-dompurify` — it is still imported by retained vanilla `message-renderer.ts`; removal deferred to Step 10 cleanup
- [ ] Create `vite.config.ts` per Spec S05 with React plugin, Tailwind plugin, and `@` path alias
- [ ] Update `tsconfig.json`: add `"jsx": "react-jsx"`, `"jsxImportSource": "react"`, update `include` to cover `**/*.tsx`, add path alias `"@/*": ["./src/*"]`
- [ ] Create `components.json` for shadcn with path alias configuration
- [ ] Create `src/globals.css` per Spec S03: `@import "tailwindcss"` and `@import "../styles/tokens.css"` (relative path from `src/` up to `styles/`) — do NOT redefine shadcn CSS variables since `tokens.css` already provides the complete bridge in its "Legacy aliases" section
- [ ] Create `src/lib/utils.ts` with `cn()` function using clsx + tailwind-merge
- [ ] Install all 13 shadcn components listed in Table T01 via `bunx shadcn@latest add`
- [ ] Handle font assets using the **public directory approach** (simpler and more predictable than CSS-imported assets): copy woff2 files from `styles/fonts/` to `public/fonts/` so Vite serves them as static assets with stable filenames (not content-hashed). Update `@font-face` declarations in `tokens.css` to use absolute paths: change `url("fonts/Hack-Regular.woff2")` to `url("/fonts/Hack-Regular.woff2")` (Vite serves `public/` at the root, so `/fonts/` resolves correctly in both dev and production). Do NOT use relative paths or CSS `@import` for fonts — the public directory approach ensures fonts are served at predictable URLs regardless of CSS bundling.
- [ ] Import xterm CSS in `main.tsx` via `import "@xterm/xterm/css/xterm.css"` — the current `app.css` in `assets.toml` is actually a mapping of `node_modules/@xterm/xterm/css/xterm.css`; with Vite, this CSS is imported directly from the node_modules package
- [ ] Handle remaining vanilla CSS files: **default approach** is to import `cards-chrome.css` and `dock.css` from `main.tsx` (e.g., `import "../styles/cards-chrome.css"`, `import "../styles/dock.css"`) so Vite bundles them into the output alongside globals.css — this is the preferred approach because it consolidates all CSS into a single build pipeline. **Fallback only if specificity issues are observed**: keep them as `<link>` tags in `index.html` with paths adjusted for Vite's public directory serving. Verify CSS ordering is correct after the import approach.
- [ ] Update `index.html` to be a Vite entry point: replace `<script src="app.js">` with `<script type="module" src="/src/main.tsx">`, remove separate CSS `<link>` tags for files now imported via JS (tokens.css via globals.css, cards.css, app.css); keep `<link>` tags for chrome/dock CSS if not imported via JS; preserve the `#disconnect-banner` div and `#deck-container` div — these are managed by vanilla TS (connection.ts and deck-manager.ts respectively) and must remain in the HTML
- [ ] Move the inline `<style>` block from `index.html` into `globals.css` — it contains body background/grid styling (`--td-canvas`, `--td-grid-color` grid lines), html/body reset (`margin:0; height:100%; overflow:hidden`), and `#deck-container` sizing (`width: calc(100% - 48px)`); these rules use Tuglook CSS custom properties and belong in the global stylesheet rather than inline HTML; the CSP already allows `'unsafe-inline'` for styles, so this is a cleanup not a requirement, but it centralizes all global styles in one file
- [ ] Rename `src/main.ts` to `src/main.tsx` directly (main.ts is entirely side-effect code with no exports; it needs no JSX yet but must be .tsx for the Vite entry point); add CSS imports at the top: `import "./globals.css"` (which imports tokens.css), and imports for chrome/dock CSS; the existing card registration logic remains in-place and is modified incrementally in Steps 4-9 as each card is swapped to a `ReactCardAdapter` instance
- [ ] Verify `bun run dev` starts Vite dev server without errors
- [ ] Verify `bun run build` produces a `dist/` directory with `index.html` and hashed assets
- [ ] Verify dist/ output is comparable to current bun build: the existing build already produces ~692 files totaling ~45 MB due to shiki grammar code splitting — these grammar chunks are expected and desirable for lazy loading. Check `du -sh dist/` (should be under 60 MB) and verify non-shiki application JS chunks in `dist/assets/` are fewer than 10 files. Only investigate `build.rollupOptions.output.manualChunks` if Vite produces significantly more or larger output than the current bun build.
- [ ] Verify font files are present in `dist/fonts/` and render correctly

**Tests:**
- [ ] `bun run build` exits 0 and `dist/index.html` exists
- [ ] `dist/index.html` contains no inline `<script>` tags (CSP compliance per Risk R02)
- [ ] shadcn Button component can be imported and rendered in a trivial test
- [ ] RTL + happy-dom validation: write a minimal test that calls `render(<button>click me</button>)`, then `fireEvent.click(screen.getByText("click me"))`, and verifies the click handler was called — this proves RTL render(), screen queries, and fireEvent() work correctly under happy-dom + bun test. If this test fails, switch `bunfig.toml` from happy-dom to jsdom and re-verify.
- [ ] Font files are present in `dist/fonts/` (woff2 files copied from public/)

**Checkpoint:**
- [ ] `bun run build` exits 0
- [ ] `ls dist/` shows `index.html` and `assets/` directory
- [ ] `ls dist/fonts/` shows woff2 font files
- [ ] `grep -c 'script.*src' dist/index.html` shows exactly 1 external script reference
- [ ] `du -sh dist/` reports total size under 60 MB (shiki grammar chunks account for ~45 MB and are expected); non-shiki application JS chunks in `dist/assets/` are fewer than 10 files
- [ ] `bun test` still passes for all existing tests (no regression)

---

#### Step 2: Update build.rs and dev.rs for Vite dist/ embedding {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugcast): update build.rs and dev.rs for Vite dist/ embedding`

**References:** [D02] Embed Vite dist, Spec S06, (#constraints)

> This step migrates the Rust build pipeline immediately after scaffolding to minimize the instability window. It has significant scope in the Rust build and dev-mode serving layers. Break into substeps. The `assets.toml` file is deleted only after all Rust fixture and test updates are complete (in Step 2.3).

**Tasks:**
- [ ] Complete substeps 2.1 through 2.3 below

**Tests:**
- [ ] All substep tests pass

**Checkpoint:**
- [ ] All substep checkpoints pass

##### Step 2.1: Update build.rs to run Vite build and copy dist/ {#step-2-1}

**Depends on:** #step-1

**Commit:** `feat(tugcast): update build.rs to invoke Vite build and copy dist/ directory`

**References:** [D02] Embed Vite dist, Spec S06, (#constraints)

**Artifacts:**
- Updated: `tugcode/crates/tugcast/build.rs` — runs `bun run build` (Vite), copies `dist/` recursively

**Tasks:**
- [ ] Replace `bun build src/main.ts --outfile=...` with `bun run build` (which invokes `vite build` and produces `dist/`)
- [ ] Remove the `AssetManifest` struct, `toml` parsing, and per-file copy loop
- [ ] Replace with a recursive directory copy of the CONTENTS of `tugdeck/dist/` into `OUT_DIR/tugdeck/` (walk the directory tree, create subdirectories, copy all files). The contents are copied flat — `dist/index.html` becomes `OUT_DIR/tugdeck/index.html`, `dist/assets/index-abc123.js` becomes `OUT_DIR/tugdeck/assets/index-abc123.js`. Do NOT create a nested `OUT_DIR/tugdeck/dist/` subdirectory — `index.html` must be at the root of the embed folder for rust-embed to serve it correctly.
- [ ] Do NOT delete `tugdeck/assets.toml` yet — it is removed in Step 2.3 after all Rust tests are updated
- [ ] Update `rerun-if-changed` paths: add `tugdeck/vite.config.ts`, `tugdeck/index.html`; remove the `assets.toml` path; keep `tugdeck/src/` and `tugdeck/package.json`
- [ ] Verify `cargo build` succeeds from the `tugcode/` directory

**Tests:**
- [ ] `cargo build` succeeds and produces the tugcast binary
- [ ] The `OUT_DIR/tugdeck/` directory contains `index.html` and hashed JS/CSS assets

**Checkpoint:**
- [ ] `cargo build` exits 0 from `tugcode/`

---

##### Step 2.2: Rewrite dev.rs serving model for Vite dist structure {#step-2-2}

**Depends on:** #step-2-1

**Commit:** `refactor(tugcast): rewrite dev.rs asset serving for Vite dist/ structure`

**References:** [D02] Embed Vite dist, Spec S06, (#constraints)

**Artifacts:**
- Updated: `tugcode/crates/tugcast/src/dev.rs` — rewritten serving model

**Tasks:**
- [ ] Remove `AssetManifest` struct, `BuildConfig` struct, and all toml parsing from `dev.rs`
- [ ] Rewrite `DevState` struct to work with Vite's `dist/` directory structure: replace `files: HashMap` with `dist_dir: PathBuf`; `index_path` points to `dist/index.html`; remove `dirs: Vec<(String, PathBuf, glob::Pattern)>` (no glob-pattern serving needed); remove `fallback: PathBuf` (dist_dir IS the only serving root); `source_tree` field is retained for the file watcher but is NOT used for asset serving
- [ ] Rewrite `serve_dev_asset` to serve files exclusively from `dist_dir` — three-tier lookup (files map, dirs glob, fallback) collapses to a single directory walk against `dist_dir`; no Vite dev server proxy, no fallback-to-source-tree serving
- [ ] Rewrite `load_manifest` (rename to `load_dev_state`): construct `DevState` by verifying `tugdeck/dist/index.html` exists in the source tree rather than parsing `assets.toml`
- [ ] Rewrite `validate_manifest` (rename to `validate_dev_state`): verify `dist_dir` exists and contains `index.html`; remove all `files` map and `dirs` glob validation; remove `fallback` directory check
- [ ] Rewrite `watch_dirs_from_manifest` (rename to `watch_dirs`): return `[dist_dir, source_tree.join("tugdeck/src")]` instead of collecting directories from the manifest files map and dirs vector
- [ ] Update the file watcher configuration to watch `tugdeck/dist/` and `tugdeck/src/` rather than individual manifest entries
- [ ] Update `enable_dev_mode()` in `dev.rs`: change the `frontend_path` passed to `dev_compiled_watcher` from `tugdeck/dist/app.js` to `tugdeck/dist/index.html` — Vite always produces `dist/index.html` with stable naming, while JS/CSS assets have content-hashed filenames (e.g., `assets/index-abc123.js`); polling `dist/app.js` would silently fail since that file no longer exists after the Vite migration, breaking the dev mode `restart_available` notification flow
- [ ] Verify dev mode serves the frontend correctly from dist/ only — all assets resolved from the dist/ directory, no source-tree fallback
- [ ] Note: all `test_serve_dev_asset_*` unit test fixture updates are deferred to Step 2.3 to keep this step focused on production code changes

**Tests:**
- [ ] Dev mode serves `index.html` from Vite dist/ directory
- [ ] Dev mode serves hashed JS/CSS assets from dist/assets/
- [ ] Dev mode serves font files from dist/fonts/
- [ ] Dev mode returns 404 for files not present in dist/ (no fallback to source tree)

**Checkpoint:**
- [ ] `cargo build` exits 0 from `tugcode/`

---

##### Step 2.3: Update Rust test fixtures and delete assets.toml {#step-2-3}

**Depends on:** #step-2-2

**Commit:** `test(tugcast): update dev.rs and integration test fixtures for Vite dist/ structure; remove assets.toml`

**References:** [D02] Embed Vite dist, Spec S06, (#step-2-1, #step-2-2)

**Artifacts:**
- Updated: `tugcode/crates/tugcast/src/dev.rs` test fixtures (38 test functions — this is significant scope; includes all `test_serve_dev_asset_*` path traversal/lookup/fallback tests, `test_load_manifest`/`test_validate_manifest` tests, `test_watch_dirs` tests, `test_enable_dev_mode` tests, and `test_dev_compiled_watcher` tests)
- Updated: `tugcode/crates/tugcast/src/integration_tests.rs` test fixtures (26 test functions — includes asset serving integration tests, WebSocket tests that set up dev state, and end-to-end connection tests)
- Deleted: `tugdeck/assets.toml`

**Tasks:**
- [ ] Update all 38 dev.rs test functions: every test that constructs `DevState` must replace `AssetManifest`/`files`/`dirs`/`fallback` fixtures with Vite dist/-based directory structures (create temp dirs with `dist/index.html`, `dist/assets/` with hashed filenames). Key test groups:
  - `test_serve_dev_asset_*` (path traversal, files lookup, dirs/glob lookup, fallback, 404, index.html injection) — adjust expectations for single-directory serving from `dist_dir` instead of three-tier lookup
  - `test_load_manifest` / `test_validate_manifest` — rewrite for renamed `load_dev_state` / `validate_dev_state` functions that expect a `dist/` directory instead of `assets.toml`
  - `test_watch_dirs_from_manifest` — rewrite for renamed `watch_dirs` function that returns `[dist_dir, src_dir]`
  - `test_enable_dev_mode` / `test_dev_compiled_watcher` — update frontend_path from `dist/app.js` to `dist/index.html`
- [ ] Update all 26 integration_tests.rs test functions that write `assets.toml` fixtures or construct `DevState`: replace with Vite `dist/` directory structures. Update asset serving assertions for hashed filenames and Vite's index.html referencing pattern.
- [ ] Delete `tugdeck/assets.toml` — all Rust code and tests have been updated to work without it
- [ ] Verify all Rust tests pass

**Tests:**
- [ ] All dev.rs unit tests pass with updated fixtures
- [ ] All integration_tests.rs tests pass with updated fixtures
- [ ] `cargo nextest run` in `tugcode/` exits 0

**Checkpoint:**
- [ ] `cargo nextest run` exits 0 from `tugcode/`
- [ ] `tugdeck/assets.toml` no longer exists

---

#### Step 2 Summary {#step-2-summary}

**Depends on:** #step-2-3

**Commit:** `test(tugcast): verify complete build pipeline integration`

**References:** [D02] Embed Vite dist, Spec S06, (#step-2-1, #step-2-2, #step-2-3)

After completing Steps 2.1-2.3, you will have:
- build.rs running Vite build and embedding full dist/ directory
- dev.rs serving Vite dist/ structure with correct content types
- All Rust test fixtures updated for the new asset model
- assets.toml removed (only after all Rust tests pass)

**Tasks:**
- [ ] Verify full build pipeline: `bun run build` produces dist/, `cargo build` embeds it, binary serves frontend

**Tests:**
- [ ] `cargo nextest run` exits 0

**Checkpoint:**
- [ ] `cargo build` exits 0 from `tugcode/`
- [ ] `cargo nextest run` exits 0 from `tugcode/`
- [ ] The built binary serves `index.html` correctly when run
- [ ] The built binary serves font files at `/fonts/*.woff2` paths (verify `dist/fonts/` is preserved through the `OUT_DIR/tugdeck/` copy and rust-embed serves them with correct `font/woff2` content type; absolute `/fonts/` URLs in `@font-face` declarations must resolve correctly in the embedded context, not just in Vite dev)
- [ ] `bun test` still passes (no tugdeck regression)

---

#### Step 3: Create ReactCardAdapter and card infrastructure {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): add ReactCardAdapter, CardContext, React hooks, and CardHeader.updateMeta()`

**References:** [D03] React content only, [D04] CustomEvents, [D08] React adapter, Spec S01, Spec S02, Spec S04, Risk R03, (#internal-architecture)

**Artifacts:**
- `tugdeck/src/cards/react-card-adapter.ts` — `ReactCardAdapter` implementing `TugCard` with live meta updates
- `tugdeck/src/cards/card-context.tsx` — `CardContext` and `CardContextProvider`
- `tugdeck/src/hooks/use-connection.ts` — WebSocket connection hook
- `tugdeck/src/hooks/use-feed.ts` — Feed subscription hook
- `tugdeck/src/hooks/use-theme.ts` — Theme context hook
- `tugdeck/src/hooks/use-card-meta.ts` — Hook for React components to update card meta (triggers live header update)
- Updated: `tugdeck/src/card-header.ts` — refactored to store DOM element references as instance fields; gains `updateMeta(meta: TugCardMeta)` method for live DOM updates
- Updated: `tugdeck/src/card-frame.ts` — gains `updateMeta(meta: TugCardMeta)` method delegating to CardHeader
- Updated: `tugdeck/src/cards/card.ts` — adds optional `setCardFrame?(frame: CardFrame | null): void` and `setActiveTab?(active: boolean): void` to TugCard interface
- Updated: `tugdeck/src/deck-manager.ts` — in `render()`, calls `card.setCardFrame(null)` for all cards before destroying old CardFrames (prevents stale reference), then calls `card.setCardFrame(cardFrame)` and `card.setActiveTab(isActive)` via optional method checks (not instanceof) for ALL tabs after creating new CardFrames; in `handleTabActivate()`, calls `card.setActiveTab(false/true)` via optional method checks so the header updates to reflect the newly active card's meta. No changes to layout, state management, or serialization logic.

**Tasks:**
- [ ] Refactor `CardHeader` constructor to store `titleEl`, `iconEl`, and `menuBtn` as private instance fields instead of local variables, so `updateMeta()` can access them for targeted DOM mutations. Specific changes required:
  - Store `titleEl` as `this.titleEl` (private instance field)
  - Store `iconEl` as `this.iconEl` (private instance field)
  - Store `menuBtn` as `this.menuBtn` (private instance field, nullable — null when no menu items)
  - **Critical closure fix** (also fixes a pre-existing limitation for vanilla cards whose `meta` getter returns different menu items over time — currently the menu always shows the items from construction time): change the menu button click handler from `new DropdownMenu(meta.menuItems, menuBtn)` (which closes over the constructor's `meta` parameter and would never see updated menu items) to `new DropdownMenu(this.meta.menuItems, this.menuBtn!)` (which reads from the instance field that `updateMeta()` keeps current)
  - Store `this.collapseBtn` reference (already an instance field) — needed by `updateMeta()` to insert a new menu button before the collapse button using `this.el.insertBefore(this.menuBtn, this.collapseBtn)`
- [ ] Extend `ICON_MAP` in `card-header.ts` to include all icons used by card meta: add `Code` (used by Developer card), and any other icons referenced by React card `initialMeta` that are not already in the map. Import the missing icons from `lucide`.
- [ ] Add `updateMeta(meta: TugCardMeta)` method to `CardHeader`:
  - **First**: if `this.activeMenu` is non-null, call `this.activeMenu.destroy()` and set `this.activeMenu = null` — this closes and destroys any open dropdown menu before rebuilding, preventing stale menu UI or leaked event handlers
  - Update `this.titleEl.textContent` if `meta.title` differs from stored `this.meta.title`
  - Swap icon SVG element if `meta.icon` differs (look up new icon in `ICON_MAP`, replace child of `this.iconEl`)
  - Rebuild menu button if `meta.menuItems` changed: if count went from 0 to >0, create `this.menuBtn` with the same structure as the constructor (EllipsisVertical icon, click handler using `this.meta.menuItems`), and insert before collapse button via `this.el.insertBefore(this.menuBtn, this.collapseBtn)`; if >0 to 0, call `this.menuBtn.remove()` and set `this.menuBtn = null`; if still >0 but items differ, no DOM change needed — the click handler already reads from `this.meta.menuItems` which will be updated when `this.meta` is stored at the end of the method
  - Store the new meta in `this.meta` after all updates
- [ ] Add `updateMeta(meta: TugCardMeta)` method to `CardFrame` that delegates to `this.cardHeader.updateMeta(meta)`
- [ ] Add optional `setCardFrame?(frame: CardFrame | null): void` and `setActiveTab?(active: boolean): void` fields to the `TugCard` interface in `tugdeck/src/cards/card.ts` — `setCardFrame` accepts null to support clearing the reference before CardFrame destruction during render() teardown; these optional fields keep DeckManager polymorphic without requiring `instanceof` checks; existing vanilla card implementations are unaffected
- [ ] Modify `DeckManager.render()`:
  - **Before destroying CardFrames**: iterate all registered cards and call `card.setCardFrame(null)` for any card that implements the optional method — this clears stale CardFrame references before the old frames are destroyed, preventing meta updates from reaching destroyed DOM
  - **In the per-tab loop** (where card containers are created/reparented): for each tab's registered card, check if `card.setCardFrame` exists (optional method check, NOT `instanceof`); if so, call `card.setCardFrame(cardFrame)` for ALL tabs in the panel (not just the active tab — they all share the same CardFrame) and call `card.setActiveTab!(isActive)` where `isActive` is `tab.id === panel.activeTabId`. This ensures all adapters have the CardFrame reference but only the active one pushes meta to the header.
- [ ] Modify `DeckManager.handleTabActivate()`: after updating `panel.activeTabId`, for the previous active tab's card and the new active tab's card, check if `card.setActiveTab` exists (optional method check, NOT `instanceof`); if so, call `prevCard.setActiveTab(false)` and `newCard.setActiveTab(true)`. The `setActiveTab(true)` call immediately pushes the new adapter's cached meta to `CardFrame.updateMeta()`, updating the header title, icon, and menu items to reflect the newly active tab. No other changes to handleTabActivate logic (hide/show mount elements, onResize, etc. remain as-is).
- [ ] Create `CardContext` with shape per Spec S02 (connection, feedData, dimensions, dragState, dispatch, updateMeta)
- [ ] Create `CardContextProvider` that wraps React card components and provides context values, including an `updateMeta` callback that dispatches `CustomEvent("card-meta-update")` on the container element
- [ ] Create `ReactCardAdapter` class per Spec S01:
  - `constructor(config)`: stores `initialMeta` as the initial cached meta value
  - `get meta()`: returns the cached `_meta` (initially `initialMeta`, updated by event listener)
  - `setCardFrame(frame | null)`: stores the CardFrame reference for live meta updates (called for ALL tabs in a panel, not just the active tab); accepts null to clear the reference before CardFrame destruction during render() teardown
  - `setActiveTab(active)`: sets `_isActiveTab`; when `active` is true and `_cardFrame` is set, immediately pushes cached `_meta` to `_cardFrame.updateMeta()` so the header reflects this adapter's meta
  - `mount(container)`: creates React root, adds `"card-meta-update"` event listener on container that (a) **replaces** entire `_meta` with the new meta object (no merge — full replacement ensures menu callbacks reference latest React state closures) and (b) if `_isActiveTab` is true, calls `this._cardFrame?.updateMeta(newMeta)` for immediate CardHeader DOM update; renders `<CardContextProvider><Component /></CardContextProvider>`
  - `onFrame(feedId, payload)`: updates feed data in state, triggers re-render
  - `onResize(width, height)`: updates dimensions in state
  - `destroy()`: removes event listener, calls `root.unmount()`, cleans up
  - `setDragState()`: stores drag state reference for context (this is on the concrete `ReactCardAdapter` class, NOT the `TugCard` interface; `main.tsx` calls it on the concrete type)
  - `focus()`: delegates to a ref-based focus method if the card component exposes one
- [ ] Create `useCardMeta` hook that calls `updateMeta` from CardContext whenever the meta value changes (uses useEffect to dispatch only on change); React components call this with their current meta including menu item callbacks that close over React state — the adapter pushes these to CardHeader immediately
- [ ] Create `useConnection` hook that reads connection from CardContext
- [ ] Create `useFeed` hook that subscribes to specific feed IDs from CardContext feedData
- [ ] Create `useTheme` hook that reads the current body class and provides theme name + setter
- [ ] Test that `ReactCardAdapter` correctly implements the `TugCard` interface (mount, onFrame, onResize, destroy lifecycle) and that live meta updates propagate to CardHeader DOM

**Tests:**
- [ ] ReactCardAdapter mounts a test React component into a container div
- [ ] ReactCardAdapter.onFrame() delivers feed data to the mounted React component via context
- [ ] ReactCardAdapter.onResize() updates dimensions accessible via context
- [ ] ReactCardAdapter.destroy() unmounts the React root and cleans the container
- [ ] ReactCardAdapter.meta returns initialMeta before any updates
- [ ] ReactCardAdapter.meta returns updated meta after React component dispatches card-meta-update event
- [ ] Live meta update: when React component dispatches card-meta-update, CardHeader title DOM element textContent updates immediately
- [ ] Live meta update: when React component changes icon, CardHeader icon SVG element is swapped
- [ ] Live meta update: when React component adds menu items, CardHeader menu button appears
- [ ] Multi-tab: when adapter's `_isActiveTab` is false, meta updates are cached but NOT pushed to CardFrame
- [ ] Multi-tab: calling `setActiveTab(true)` pushes cached meta to CardFrame immediately, updating header title
- [ ] Multi-tab: calling `setActiveTab(false)` on the previous adapter prevents further meta pushes
- [ ] Stale CardFrame guard: after calling `setCardFrame(null)`, a subsequent meta update event does not throw (adapter's optional chaining on `_cardFrame?.updateMeta()` safely no-ops)
- [ ] Stale CardFrame guard: after calling `setCardFrame(null)` then `setCardFrame(newFrame)`, meta updates flow to the new CardFrame
- [ ] Menu item callbacks in updated meta correctly invoke React state operations
- [ ] useFeed hook returns updated data when onFrame is called
- [ ] useConnection hook provides the TugConnection instance
- [ ] useCardMeta hook dispatches meta update event on the container

**Checkpoint:**
- [ ] `bun test` passes including new ReactCardAdapter tests and live meta update tests
- [ ] `bun run build` exits 0

---

#### Step 4: Convert About card (proof of concept) {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugdeck): convert About card to React component`

**References:** [D03] React content only, [D06] Replace tests, [D08] React adapter, Table T03, (#strategy)

**Artifacts:**
- `tugdeck/src/components/cards/about-card.tsx` — React About card component
- Updated `src/main.tsx` — registers About card via `ReactCardAdapter` instead of vanilla `AboutCard`
- Vanilla `tugdeck/src/cards/about-card.ts` retained; deletion deferred to Step 10

**Tasks:**
- [ ] Create `about-card.tsx` as a React functional component rendering the logo SVG, app name, version, description, and copyright using Tailwind utility classes
- [ ] Use shadcn Card component for the container layout
- [ ] Replace lucide `createElement` icon usage with lucide-react `<Info />` component import
- [ ] Update `main.tsx` card factory registration: replace `new AboutCard()` with `new ReactCardAdapter({ component: AboutCard, feedIds: [], initialMeta: { title: "About", icon: "Info", closable: true, menuItems: [] } })`
- [ ] Do NOT delete `src/cards/about-card.ts` — all vanilla file deletion is consolidated in Step 10
- [ ] Write React Testing Library test for About card: renders logo, name "Tug", version, copyright text

**Tests:**
- [ ] About card renders app name "Tug" (RTL: `screen.getByText("Tug")`)
- [ ] About card renders version string (RTL: `screen.getByText(/Version/)`)
- [ ] About card renders copyright notice

**Checkpoint:**
- [ ] `bun test` passes including new About card RTL test
- [ ] `bun run build` exits 0
- [ ] About card renders correctly in all 3 themes (manual visual verification; functional equivalence, not pixel parity)

---

#### Step 5: Convert Settings card {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugdeck): convert Settings card to React with shadcn controls`

**References:** [D03] React content only, [D04] CustomEvents, [D05] Token bridge, [D06] Replace tests, Table T01, Table T03, (#strategy)

**Artifacts:**
- `tugdeck/src/components/cards/settings-card.tsx` — React Settings card
- Vanilla `tugdeck/src/cards/settings-card.ts` retained; deletion deferred to Step 10

**Tasks:**
- [ ] Create `settings-card.tsx` with shadcn RadioGroup for theme selection (Brio, Bluenote, Harmony), Switch for dev mode toggle, and Button for source tree path picker
- [ ] Use `useConnection` hook to access the WebSocket connection for **sending** commands: `connection.sendControlFrame("set-dev-mode", { enabled })` for dev mode toggle and `connection.sendControlFrame("choose-source-tree")` for the source tree picker. Note: **responses** come back through the `window.__tugBridge` callback pattern (onDevModeChanged, onDevModeError, onSourceTreeSelected), NOT through the WebSocket connection — the bridge pattern is the return channel for Swift/WebKit-mediated operations
- [ ] Use `useTheme` hook for reading/setting the current theme
- [ ] Wire theme selection to call `applyTheme` which updates `localStorage`, toggles body classes, and dispatches `CustomEvent("td-theme-change")` (same behavior as vanilla TS)
- [ ] Implement the `window.__tugBridge` callback bridge pattern in an inline `useEffect` with cleanup:
  - On mount: register `__tugBridge.onSettingsLoaded`, `onDevModeChanged`, `onDevModeError`, `onSourceTreeSelected`, `onSourceTreeCancelled` callbacks that update React state
  - Call `webkit.messageHandlers.getSettings.postMessage({})` to request initial settings
  - On unmount: clear all `__tugBridge` callbacks (set to `undefined`) and clear any pending confirmation timeout
  - If `webkit.messageHandlers.getSettings` is not available (browser-only mode), show fallback message
- [ ] Implement the dev mode toggle confirmed/error/timeout lifecycle in React state:
  - On toggle: disable the Switch, start a 3-second timeout, call `sendControlFrame("set-dev-mode", { enabled })`
  - On `onDevModeChanged(confirmed)`: clear timeout, update checked state to `confirmed`, re-enable Switch
  - On `onDevModeError(message)`: clear timeout, revert checked state, re-enable Switch, show error note
  - On timeout: revert checked state, re-enable Switch, show "dev mode toggle requires the Tug app" note
- [ ] Implement source tree picker flow: `onSourceTreeSelected(path)` updates the displayed path and enables/disables dev mode availability based on whether a path is set
- [ ] Update `main.tsx` to register Settings via `ReactCardAdapter` with `connection` in config: `new ReactCardAdapter({ component: SettingsCard, feedIds: [], initialMeta: { title: "Settings", icon: "Settings", closable: true, menuItems: [] }, connection })`
- [ ] Do NOT delete `src/cards/settings-card.ts` — all vanilla file deletion is consolidated in Step 10
- [ ] Write RTL tests for Settings card

**Tests:**
- [ ] Settings card renders theme radio options for all 3 themes
- [ ] Clicking a theme option applies the theme class to body and dispatches the theme change event
- [ ] Dev mode switch is disabled when no source tree is set
- [ ] Dev mode switch calls sendControlFrame on toggle
- [ ] Dev mode switch reverts state on timeout when bridge doesn't respond
- [ ] onDevModeChanged callback updates switch state
- [ ] Source tree path displays "(not set)" initially and updates on onSourceTreeSelected
- [ ] Choose button calls sendControlFrame("choose-source-tree")
- [ ] Bridge callbacks are cleaned up on unmount

**Checkpoint:**
- [ ] `bun test` passes including Settings card RTL tests
- [ ] `bun run build` exits 0
- [ ] Theme switching works end-to-end (manual verification): selecting Bluenote/Harmony/Brio changes theme

---

#### Step 6: Convert Question card and Approval prompt {#step-6}

**Depends on:** #step-5

**Commit:** `feat(tugdeck): convert Question card and Approval prompt to React`

**References:** [D03] React content only, [D04] CustomEvents, [D06] Replace tests, Table T01, Table T03, (#strategy)

> This step is broken into substeps. See Steps 6.1 and 6.2 for individual commits and checkpoints.
>
> **Important:** Question and Approval are submodules of ConversationCard, NOT standalone cards registered with DeckManager. These React components are created and tested in isolation here, but they are NOT wired into the live app via ReactCardAdapter — they will be composed into the React ConversationCard in Step 8.3. No `main.tsx` registration changes occur in this step.

**Tasks:**
- [ ] Complete substeps 6.1 and 6.2 below

**Tests:**
- [ ] All substep tests pass

**Checkpoint:**
- [ ] All substep checkpoints pass

##### Step 6.1: Convert Question card {#step-6-1}

**Depends on:** #step-5

**Commit:** `feat(tugdeck): convert Question card to React with shadcn form controls`

**References:** [D03] React content only, [D04] CustomEvents, [D06] Replace tests, Table T01, Table T03, (#strategy)

**Artifacts:**
- `tugdeck/src/components/cards/conversation/question-card.tsx` — React Question card
- Vanilla `tugdeck/src/cards/conversation/question-card.ts` retained (still imported by vanilla conversation-card.ts)

**Tasks:**
- [ ] Create `question-card.tsx` as a standalone React component (NOT registered with DeckManager — it is composed into the React ConversationCard in Step 8.3) using shadcn RadioGroup for single-select questions, Checkbox for multi-select, Input for text input, and Button for submit/cancel
- [ ] Accept question data as props (question text, options, type) consistent with the `Question` type from `conversation/types.ts`
- [ ] Dispatch answer via the existing `QuestionAnswerInput` CustomEvent when submitted
- [ ] Handle all question types: single-select (radio), multi-select (checkbox), free-text (input)
- [ ] Do NOT delete vanilla `question-card.ts` — it is still imported by vanilla `conversation-card.ts`; deletion is deferred to Step 10
- [ ] Write RTL tests for the new React component

**Tests:**
- [ ] Question card renders radio buttons for single-select questions
- [ ] Question card renders checkboxes for multi-select questions
- [ ] Question card renders text input for free-text questions
- [ ] Submit button dispatches the answer event with correct payload
- [ ] Cancel button dispatches cancel event

**Checkpoint:**
- [ ] `bun test` passes including Question card RTL tests
- [ ] `bun run build` exits 0

---

##### Step 6.2: Convert Approval prompt {#step-6-2}

**Depends on:** #step-6-1

**Commit:** `feat(tugdeck): convert Approval prompt to React with shadcn buttons`

**References:** [D03] React content only, [D06] Replace tests, Table T03, (#strategy)

**Artifacts:**
- `tugdeck/src/components/cards/conversation/approval-prompt.tsx` — React Approval prompt
- Vanilla `tugdeck/src/cards/conversation/approval-prompt.ts` retained (still imported by vanilla conversation-card.ts)

**Tasks:**
- [ ] Create `approval-prompt.tsx` as a standalone React component (NOT registered with DeckManager — it is composed into the React ConversationCard in Step 8.3) using shadcn Button with primary variant for "Allow" and destructive variant for "Deny"
- [ ] Accept approval request data as props consistent with `ToolApprovalRequest` type
- [ ] Dispatch `ToolApprovalInput` CustomEvent on allow/deny
- [ ] Display the tool name and description from the approval request
- [ ] Do NOT delete vanilla `approval-prompt.ts` — it is still imported by vanilla `conversation-card.ts`; deletion is deferred to Step 10
- [ ] Write RTL tests for the new React component

**Tests:**
- [ ] Approval prompt renders tool name and description
- [ ] Allow button dispatches approval event with `approved: true`
- [ ] Deny button dispatches approval event with `approved: false`
- [ ] Buttons use correct shadcn variants (primary for allow, destructive for deny)

**Checkpoint:**
- [ ] `bun test` passes including Approval prompt RTL tests
- [ ] `bun run build` exits 0

---

#### Step 6 Summary {#step-6-summary}

**Depends on:** #step-6-2

**Commit:** `test(tugdeck): verify Question card and Approval prompt integration`

**References:** [D03] React content only, [D06] Replace tests, (#step-6-1, #step-6-2)

After completing Steps 6.1-6.2, you will have:
- Question card React component created with shadcn RadioGroup, Checkbox, Input, Button
- Approval prompt React component created with shadcn Button variants
- Both components tested in isolation with RTL (rendering, event dispatch, form interaction)
- These React components are being prepared for integration into the React ConversationCard in Step 8; they cannot be used in the live app until the vanilla ConversationCard is converted, because the vanilla ConversationCard instantiates the vanilla submodules directly

**Tasks:**
- [ ] Verify both Question card and Approval prompt React components render correctly in isolated RTL tests

**Tests:**
- [ ] `bun test` passes all tests including both new RTL tests

**Checkpoint:**
- [ ] `bun test` passes all tests including both new RTL tests
- [ ] `bun run build` exits 0

---

#### Step 7: Convert simple data cards (Files, Git, Stats, Developer) {#step-7}

**Depends on:** #step-6

**Commit:** `feat(tugdeck): convert Files, Git, Stats, Developer cards to React`

**References:** [D03] React content only, [D04] CustomEvents, [D06] Replace tests, Table T03, (#strategy)

> This step is broken into substeps. See Steps 7.1-7.4b for individual commits and checkpoints. Developer card (Step 7.4) is further split into 7.4a (data/state) and 7.4b (actions/notifications) for manageable commit granularity.

**Tasks:**
- [ ] Complete substeps 7.1 through 7.4b below

**Tests:**
- [ ] All substep tests pass

**Checkpoint:**
- [ ] All substep checkpoints pass

##### Step 7.1: Convert Files card {#step-7-1}

**Depends on:** #step-6

**Commit:** `feat(tugdeck): convert Files card to React component`

**References:** [D03] React content only, [D06] Replace tests, [D08] React adapter, Table T03, (#strategy)

**Artifacts:**
- `tugdeck/src/components/cards/files-card.tsx` — React Files card
- Vanilla `tugdeck/src/cards/files-card.ts` retained; deletion deferred to Step 10

**Tasks:**
- [ ] Create `files-card.tsx` using `useFeed` hook to subscribe to `FeedId.FILESYSTEM`
- [ ] Render filesystem events as a scrolling list using shadcn ScrollArea
- [ ] Use lucide-react icons (FilePlus, FilePen, FileX, FileSymlink) for event type indicators
- [ ] Implement "Clear History" action and "Max Entries" select using shadcn Select
- [ ] Use `useCardMeta` hook to provide dynamic meta with "Clear History" menu item — the adapter will push this to CardHeader live
- [ ] Update `main.tsx` to register Files via `ReactCardAdapter`
- [ ] Do NOT delete vanilla `files-card.ts` — imported by `__tests__/card-menus.test.ts` and `__tests__/card-header.test.ts`; deletion deferred to Step 10
- [ ] Write RTL tests

**Tests:**
- [ ] Files card renders filesystem events with correct icons
- [ ] Clear History action clears the event list
- [ ] Max Entries select limits displayed events
- [ ] New feed frames append to the event list

**Checkpoint:**
- [ ] `bun test` passes
- [ ] `bun run build` exits 0

---

##### Step 7.2: Convert Git card {#step-7-2}

**Depends on:** #step-7-1

**Commit:** `feat(tugdeck): convert Git card to React component`

**References:** [D03] React content only, [D06] Replace tests, Table T03, (#strategy)

**Artifacts:**
- `tugdeck/src/components/cards/git-card.tsx` — React Git card
- Vanilla `tugdeck/src/cards/git-card.ts` retained; deletion deferred to Step 10

**Tasks:**
- [ ] Create `git-card.tsx` using `useFeed` hook to subscribe to `FeedId.GIT`
- [ ] Render git status information (branch, changed files, staging area) using Tailwind utilities
- [ ] Use lucide-react icons for git status indicators
- [ ] Use shadcn ScrollArea for file list overflow
- [ ] Update `main.tsx` registration
- [ ] Do NOT delete vanilla `git-card.ts` — imported by `__tests__/card-menus.test.ts` and `__tests__/card-header.test.ts`; deletion deferred to Step 10
- [ ] Write RTL tests

**Tests:**
- [ ] Git card renders branch name from feed data
- [ ] Git card renders changed file list with status indicators
- [ ] Git card updates when new feed frames arrive

**Checkpoint:**
- [ ] `bun test` passes
- [ ] `bun run build` exits 0

---

##### Step 7.3: Convert Stats card {#step-7-3}

**Depends on:** #step-7-2

**Commit:** `feat(tugdeck): convert Stats card to React component`

**References:** [D03] React content only, [D06] Replace tests, Table T03, (#strategy)

**Artifacts:**
- `tugdeck/src/components/cards/stats-card.tsx` — React Stats card
- Vanilla `tugdeck/src/cards/stats-card.ts` retained; deletion deferred to Step 10

**Tasks:**
- [ ] Create `stats-card.tsx` using `useFeed` hook to subscribe to `FeedId.STATS`, `FeedId.STATS_PROCESS_INFO`, `FeedId.STATS_TOKEN_USAGE`, `FeedId.STATS_BUILD_STATUS`
- [ ] Render stats sections (token counts, costs, timing) using Tailwind grid/flex utilities
- [ ] Implement section toggle visibility using shadcn Switch or local React state
- [ ] Use shadcn ScrollArea for overflow
- [ ] Update `main.tsx` registration
- [ ] Do NOT delete vanilla `stats-card.ts` — imported by `__tests__/card-menus.test.ts` and `__tests__/card-header.test.ts`; deletion deferred to Step 10
- [ ] Write RTL tests

**Tests:**
- [ ] Stats card renders stat sections from feed data
- [ ] Section visibility toggles work correctly
- [ ] Stats update when new feed frames arrive

**Checkpoint:**
- [ ] `bun test` passes
- [ ] `bun run build` exits 0

---

##### Step 7.4a: Convert Developer card — data layer and state machine {#step-7-4a}

**Depends on:** #step-7-3

**Commit:** `feat(tugdeck): convert Developer card data layer — categorizeFile, feed parsing, per-row state machine`

**References:** [D03] React content only, [D06] Replace tests, Table T03, (#strategy)

**Artifacts:**
- `tugdeck/src/components/cards/developer-card.tsx` — React Developer card (data layer and row rendering)
- Vanilla `tugdeck/src/cards/developer-card.ts` and `developer-card.test.ts` retained; deletion deferred to Step 10

**Tasks:**
- [ ] Create `developer-card.tsx` with 3-category row layout: Styles (CSS/HTML), Code (JS/TS/Rust), App (.swift) — each row has a status dot, label, status text, and placeholder for action buttons (wired in Step 7.4b)
- [ ] Port the `categorizeFile(path)` function (or import it as a pure TS utility) that classifies git file paths into Styles/Code/App categories based on file extension and directory prefix patterns
- [ ] Use `useFeed` hook to subscribe to `FeedId.GIT` for git status feed data; parse `GitStatus` payload to compute per-row edited file counts from staged + unstaged arrays using `categorizeFile`
- [ ] Implement per-row state machine: Clean (green dot) -> Edited (yellow dot, shows count) -> Stale (red dot, shows action button); track `lastCleanTs`, `firstDirtySinceTs`, `editedCount`, `isStale`, `staleCount` per row using React state
- [ ] Implement "Reloaded" flash for Styles row: when styles transition from dirty to clean, show "Reloaded" text briefly then revert to "Clean" using a timeout
- [ ] Do NOT delete vanilla `developer-card.ts` — all vanilla file deletion is consolidated in Step 10
- [ ] Write RTL tests for data layer and state machine

**Tests:**
- [ ] Developer card renders 3 rows: Styles, Code, App
- [ ] All rows show "Clean" status with green dot initially (when no edited files)
- [ ] Rows update to "Edited" status with yellow dot and file count when git feed reports changes in matching category
- [ ] categorizeFile correctly classifies file paths into Styles/Code/App categories
- [ ] Styles row shows "Reloaded" flash when transitioning from dirty to clean

**Checkpoint:**
- [ ] `bun test` passes
- [ ] `bun run build` exits 0

---

##### Step 7.4b: Convert Developer card — bridge events, actions, and notifications {#step-7-4b}

**Depends on:** #step-7-4a

**Commit:** `feat(tugdeck): convert Developer card actions — bridge events, badge dispatch, action buttons, build progress`

**References:** [D03] React content only, [D04] CustomEvents, [D06] Replace tests, [D08] React adapter, Table T03, (#strategy)

**Artifacts:**
- Updated: `tugdeck/src/components/cards/developer-card.tsx` — adds action buttons, bridge events, badge dispatch, build progress
- Updated: `src/main.tsx` — registers Developer via `ReactCardAdapter`

**Tasks:**
- [ ] Implement "Restart" button for Code row using shadcn Button — dispatches `CustomEvent("td-dev-restart")` via connection; show/hide based on `codeIsStale` state
- [ ] Implement "Relaunch" button for App row using shadcn Button — dispatches `CustomEvent("td-dev-relaunch")` via connection; show/hide based on `appIsStale` state; hide entire App row if WebKit bridge (`window.webkit`) is not available
- [ ] Listen for `td-dev-notification` CustomEvent (dispatched by connection layer) to update stale state and stale counts for Code and App rows
- [ ] Dispatch `td-dev-badge` CustomEvent with total stale count for dock badge updates
- [ ] Implement build progress indicator: listen for build status feed data and show/hide progress bar with build output
- [ ] Use `useConnection` hook for sending dev commands; pass `connection` through the `ReactCardAdapter` config
- [ ] Update `main.tsx` to register Developer via `ReactCardAdapter` with `connection` in config: `new ReactCardAdapter({ component: DeveloperCard, feedIds: [FeedId.GIT], initialMeta: { title: "Developer", icon: "Code", closable: true, menuItems: [] }, connection })`
- [ ] Write RTL tests for actions and bridge events

**Tests:**
- [ ] Code row shows "Restart" button when stale notification received
- [ ] App row shows "Relaunch" button when stale notification received
- [ ] Clicking "Restart" dispatches the restart event
- [ ] Clicking "Relaunch" dispatches the relaunch event
- [ ] App row is hidden when WebKit bridge is not available
- [ ] td-dev-badge event dispatched with correct stale count
- [ ] Build progress indicator shows/hides based on build status feed
- [ ] Developer card renders correctly with connection context provided

**Checkpoint:**
- [ ] `bun test` passes
- [ ] `bun run build` exits 0

---

#### Step 7 Summary {#step-7-summary}

**Depends on:** #step-7-4b

**Commit:** `test(tugdeck): verify all data card React conversions`

**References:** [D03] React content only, [D06] Replace tests, (#step-7-1, #step-7-2, #step-7-3, #step-7-4a, #step-7-4b)

After completing Steps 7.1-7.4b, you will have:
- Files, Git, Stats, and Developer cards all converted to React
- All four cards using `useFeed` for data subscription and shadcn/Tailwind for rendering
- RTL tests for all four cards
- Only Conversation and Terminal cards remain as vanilla TS

**Tasks:**
- [ ] Verify all 4 data cards render correctly with feed data in all 3 themes

**Tests:**
- [ ] `bun test` passes all tests including all data card RTL tests

**Checkpoint:**
- [ ] `bun test` passes all tests including all data card RTL tests
- [ ] `bun run build` exits 0
- [ ] All 4 converted cards render correctly with feed data in all 3 themes (manual verification; functional equivalence, not pixel parity)

---

#### Step 8: Convert Conversation card and submodules {#step-8}

**Depends on:** #step-7

**Commit:** `feat(tugdeck): convert Conversation card and all submodules to React`

**References:** [D03] React content only, [D04] CustomEvents, [D06] Replace tests, [D08] React adapter, Spec S02, Table T03, (#strategy)

> This is the largest and most complex card conversion. Break into substeps for manageable commits.

**Tasks:**
- [ ] Complete substeps 8.1 through 8.3 below

**Tests:**
- [ ] All substep tests pass

**Checkpoint:**
- [ ] All substep checkpoints pass

##### Step 8.1: Convert message renderer and code block {#step-8-1}

**Depends on:** #step-7

**Commit:** `feat(tugdeck): convert message-renderer and code-block to React components`

**References:** [D03] React content only, [D06] Replace tests, (#strategy)

**Artifacts:**
- `tugdeck/src/lib/markdown.ts` — pure TS utility extracting `renderMarkdown`, `SANITIZE_CONFIG`, and `enhanceCodeBlocks` from vanilla message-renderer.ts
- `tugdeck/src/components/cards/conversation/message-renderer.tsx` — React message renderer component (imports from `src/lib/markdown.ts`)
- `tugdeck/src/components/cards/conversation/code-block.tsx` — React code block component
- Vanilla `tugdeck/src/cards/conversation/message-renderer.ts` and `code-block.ts` retained (still imported by vanilla conversation-card.ts)

**Tasks:**
- [ ] Extract `renderMarkdown`, `SANITIZE_CONFIG`, and `enhanceCodeBlocks` from vanilla `message-renderer.ts` into a new pure TS utility file `src/lib/markdown.ts` — these are framework-agnostic functions that both the React component and `__tests__/e2e-integration.test.ts` can import; update vanilla `message-renderer.ts` to re-export from `src/lib/markdown.ts` so existing imports remain valid
- [ ] Create `message-renderer.tsx` that imports from `src/lib/markdown.ts` and renders markdown content via `dangerouslySetInnerHTML` with dompurify sanitization
- [ ] Create `code-block.tsx` that wraps shiki syntax highlighting in a React component with copy-to-clipboard button (shadcn Button)
- [ ] Both components accept content as props and render within shadcn ScrollArea as needed
- [ ] Do NOT delete vanilla versions — they are still imported by vanilla `conversation-card.ts`; deletion is deferred to Step 10
- [ ] Write RTL tests

**Tests:**
- [ ] Message renderer converts markdown to HTML and renders it
- [ ] Message renderer sanitizes HTML via dompurify
- [ ] Code block renders syntax-highlighted code
- [ ] Code block copy button copies to clipboard

**Checkpoint:**
- [ ] `bun test` passes
- [ ] `bun run build` exits 0

---

##### Step 8.2: Convert tool card and attachment handler {#step-8-2}

**Depends on:** #step-8-1

**Commit:** `feat(tugdeck): convert tool-card and attachment-handler to React components`

**References:** [D03] React content only, [D04] CustomEvents, [D06] Replace tests, (#strategy)

**Artifacts:**
- `tugdeck/src/components/cards/conversation/tool-card.tsx` — React tool card
- `tugdeck/src/components/cards/conversation/attachment-handler.tsx` — React attachment handler
- Vanilla `tugdeck/src/cards/conversation/tool-card.ts` and `attachment-handler.ts` retained (still imported by vanilla conversation-card.ts)

**Tasks:**
- [ ] Create `tool-card.tsx` rendering tool use/result pairs with expandable detail sections
- [ ] Create `attachment-handler.tsx` with drag-and-drop file attachment, paste handling, and chip display using Tailwind utilities and shadcn Button for the attach button
- [ ] Wire drag events using React event handlers and useEffect for document-level listeners
- [ ] Do NOT delete vanilla versions — they are still imported by vanilla `conversation-card.ts`; deletion is deferred to Step 10
- [ ] Write RTL tests

**Tests:**
- [ ] Tool card renders tool name and status
- [ ] Tool card expands to show detail content
- [ ] Attachment handler renders attachment chips
- [ ] Attachment handler accepts file drops (simulated via RTL)

**Checkpoint:**
- [ ] `bun test` passes
- [ ] `bun run build` exits 0

---

##### Step 8.3: Convert main Conversation card {#step-8-3}

**Depends on:** #step-8-2

**Commit:** `feat(tugdeck): convert Conversation card to React, integrating all submodules`

**References:** [D03] React content only, [D04] CustomEvents, [D06] Replace tests, [D08] React adapter, Spec S02, Table T03, (#strategy)

**Artifacts:**
- `tugdeck/src/components/cards/conversation/conversation-card.tsx` — React Conversation card
- `tugdeck/src/components/cards/conversation/streaming-state.tsx` — rewritten as React-compatible streaming state (the vanilla version directly manipulates DOM and must be rewritten, not just moved)
- Updated `src/main.tsx` — registers Conversation via `ReactCardAdapter`
- Vanilla `tugdeck/src/cards/conversation-card.ts` retained; deletion deferred to Step 10

**Tasks:**
- [ ] Create `conversation-card.tsx` composing message-renderer, code-block, tool-card, approval-prompt, question-card, and attachment-handler React components
- [ ] Use shadcn Textarea for message input with auto-resize behavior
- [ ] Use shadcn Button for send (ArrowUp icon), stop (Square icon), and interrupt (Octagon icon)
- [ ] Use shadcn ScrollArea for the message list with auto-scroll to bottom on new messages
- [ ] Rewrite streaming state as a React-compatible module (`streaming-state.tsx`); the vanilla `StreamingState` class directly manipulates DOM elements (`classList.add`, `createElement`, `appendChild`) and cannot be used as-is — rewrite to expose streaming state as React state (useState/useReducer) with CSS class application via className props
- [ ] Implement message ordering using the existing `MessageOrderingBuffer` (keep as pure TS utility)
- [ ] Implement session cache integration for IndexedDB persistence (keep `SessionCache` as pure TS, wrap in useEffect)
- [ ] Implement command history (up/down arrow) using React state
- [ ] Wire input submission to dispatch `UserMessageInput` CustomEvent via connection
- [ ] Wire all conversation events (AssistantText, ToolUse, ToolResult, TurnComplete, etc.) through `useFeed` and `onFrame`
- [ ] Use `useCardMeta` hook to provide dynamic meta with conversation title that updates live — when the conversation title changes (e.g., from project dir or assistant response), the adapter immediately pushes the new title to CardHeader for live DOM update per [D08]
- [ ] Update `main.tsx` to register Conversation via `ReactCardAdapter` with `setDragState` support
- [ ] Do NOT delete vanilla `conversation-card.ts` — deletion of all vanilla files is consolidated in Step 10
- [ ] Write comprehensive RTL tests

**Tests:**
- [ ] Conversation card renders message input area with send button
- [ ] Typing a message and clicking send dispatches the correct event
- [ ] Incoming assistant text messages render in the message list
- [ ] Tool use/result events render tool cards inline
- [ ] Approval requests render the approval prompt
- [ ] Questions render the question card
- [ ] Streaming indicator shows during active turns
- [ ] Auto-scroll follows new messages
- [ ] Session cache restores messages on mount
- [ ] Live meta update: conversation title change triggers immediate CardHeader title update

**Checkpoint:**
- [ ] `bun test` passes all tests including comprehensive Conversation card tests
- [ ] `bun run build` exits 0
- [ ] Conversation card works end-to-end with live WebSocket connection (manual verification)

---

#### Step 8 Summary {#step-8-summary}

**Depends on:** #step-8-3

**Commit:** `test(tugdeck): verify complete Conversation card React conversion`

**References:** [D03] React content only, [D06] Replace tests, [D08] React adapter, (#step-8-1, #step-8-2, #step-8-3)

After completing Steps 8.1-8.3, you will have:
- Complete Conversation card converted to React with all submodules
- Message rendering, code blocks, tool cards, approvals, questions, and attachments all React components
- Session cache and streaming state integrated via React lifecycle hooks
- Live meta updates flowing from React conversation state to CardHeader DOM
- Only Terminal card remains as vanilla TS

**Tasks:**
- [ ] Verify full conversation flow works with all submodules in all 3 themes

**Tests:**
- [ ] `bun test` passes all tests including all Conversation card RTL tests

**Checkpoint:**
- [ ] `bun test` passes all tests including all Conversation card RTL tests
- [ ] `bun run build` exits 0
- [ ] Full conversation flow works end-to-end (manual verification)

---

#### Step 9: Convert Terminal card {#step-9}

**Depends on:** #step-8

**Commit:** `feat(tugdeck): convert Terminal card to React (xterm.js wrapper)`

**References:** [D03] React content only, [D06] Replace tests, Table T03, (#strategy, #constraints)

**Artifacts:**
- `tugdeck/src/components/cards/terminal-card.tsx` — React Terminal card wrapping xterm.js
- Updated `src/main.tsx` — registers Terminal via `ReactCardAdapter`
- Vanilla `tugdeck/src/cards/terminal-card.ts` retained; deletion deferred to Step 10

**Tasks:**
- [ ] Create `terminal-card.tsx` using a ref-based xterm.js integration pattern: `useRef` for the terminal container, `useEffect` for xterm.js initialization and cleanup
- [ ] Use `useFeed` hook for terminal data feed subscription
- [ ] Use `useConnection` hook for sending terminal input back via WebSocket
- [ ] Handle resize events via `onResize` context to call xterm.js `fit()` addon
- [ ] Preserve the existing xterm.js addon configuration (fit, web-links, webgl)
- [ ] Update `main.tsx` to register Terminal via `ReactCardAdapter` with `setDragState` support
- [ ] Do NOT delete vanilla `terminal-card.ts` — all vanilla file deletion is consolidated in Step 10
- [ ] Write RTL tests (limited scope since xterm.js manages its own DOM)

**Tests:**
- [ ] Terminal card mounts xterm.js instance into a container ref
- [ ] Terminal card calls fit() on resize
- [ ] Terminal card cleans up xterm.js on unmount

**Checkpoint:**
- [ ] `bun test` passes
- [ ] `bun run build` exits 0
- [ ] Terminal card renders and accepts input with live connection (manual verification)

---

#### Step 10: Cleanup — remove vanilla TS card files and card CSS {#step-10}

**Depends on:** #step-9

**Commit:** `refactor(tugdeck): remove vanilla TS card files and card-content CSS`

**References:** [D06] Replace tests, (#scope)

**Artifacts:**
- Deleted: all vanilla TS card files in `src/cards/` (about-card.ts, settings-card.ts, files-card.ts, git-card.ts, stats-card.ts, developer-card.ts, terminal-card.ts, conversation-card.ts)
- Deleted: conversation submodule vanilla files (question-card.ts, approval-prompt.ts, tool-card.ts, attachment-handler.ts, message-renderer.ts, code-block.ts, streaming-state.ts)
- Deleted: vanilla TS card test files (conversation-card.test.ts, developer-card.test.ts, and conversation submodule tests: question-card.test.ts, approval-prompt.test.ts, tool-card.test.ts, attachment-handler.test.ts, message-renderer.test.ts, code-block.test.ts, streaming-state.test.ts, session-integration.test.ts)
- Updated: `src/__tests__/card-menus.test.ts` — remove vanilla card class imports; simplify to test chrome layer with mock TugCardMeta objects
- Updated: `src/__tests__/card-header.test.ts` — remove vanilla card class imports; simplify to test chrome layer with mock TugCardMeta objects
- Updated: `src/__tests__/e2e-integration.test.ts` — replace ConversationCard import with `ReactCardAdapter`-wrapped equivalent; update `renderMarkdown`/`SANITIZE_CONFIG` imports to `../lib/markdown`
- Deleted: `styles/cards.css` card-content class rules (rules for `.files-card`, `.git-card`, `.stats-card`, `.conversation-*`, `.about-card`, `.developer-card`, `.settings-*`, `.tool-card`, `.approval-*`, `.question-*`)
- Preserved: `styles/tokens.css` (design tokens — source of truth)
- Preserved: `styles/cards-chrome.css` (card-header, card-menu styles — chrome stays vanilla TS)
- Preserved: `styles/dock.css` (dock styles — chrome stays vanilla TS)

**Tasks:**
- [ ] Delete all vanilla TS card implementation files listed above
- [ ] Delete all vanilla TS card test files that have been replaced by RTL tests
- [ ] Update `src/__tests__/card-menus.test.ts`: remove imports of vanilla card classes (`GitCard`, `FilesCard`, `StatsCard`, `ConversationCard`); simplify to test chrome-layer menu behavior with mock `TugCardMeta` objects rather than instantiating full card components — these tests verify CardHeader/DropdownMenu rendering and interaction, not card internals; ReactCardAdapter meta propagation is already tested in Step 3
- [ ] Update `src/__tests__/card-header.test.ts`: remove imports of vanilla card classes (`ConversationCard`, `GitCard`, `FilesCard`, `StatsCard`); simplify to test CardHeader rendering, collapse, close, and menu behavior with mock `TugCardMeta` objects — the full adapter meta bridge is tested in Step 3; also add tests for `CardHeader.updateMeta()` if not covered in Step 3
- [ ] Update `src/__tests__/e2e-integration.test.ts`: replace import of `ConversationCard` with `ReactCardAdapter`-wrapped equivalent; update `renderMarkdown` and `SANITIZE_CONFIG` imports from `../cards/conversation/message-renderer` to `../lib/markdown` (the pure TS utility extracted in Step 8.1)
- [ ] Remove `isomorphic-dompurify` from `package.json` dependencies — no remaining imports after vanilla `message-renderer.ts` is deleted; React `message-renderer.tsx` uses `dompurify` directly
- [ ] Remove card-content CSS class rules from `cards.css` (keep only rules used by chrome layer if any; if cards.css is purely card-content styles, delete the entire file)
- [ ] Verify no remaining imports reference the deleted files (check `main.tsx`, `deck-manager.ts`, all `__tests__/` files)
- [ ] Verify the card interface (`card.ts`) is preserved since ReactCardAdapter implements it
- [ ] Verify `ordering.ts`, `session-cache.ts`, and `types.ts` in `src/cards/conversation/` are preserved as pure TS utilities used by React components (vanilla `streaming-state.ts` is deleted since it was rewritten as `streaming-state.tsx` in `src/components/cards/conversation/`)

**Tests:**
- [ ] `bun run build` exits 0 (no broken imports)
- [ ] `bun test` exits 0 (all RTL tests pass, no vanilla TS tests remain)

**Checkpoint:**
- [ ] `bun run build` exits 0
- [ ] `bun test` exits 0
- [ ] `cargo build` exits 0 from `tugcode/`
- [ ] `cargo nextest run` exits 0 from `tugcode/`
- [ ] No vanilla TS card files remain in `src/cards/` (only `card.ts` interface, `react-card-adapter.ts`, `card-context.tsx`, and pure TS utilities)

---

### Deliverables and Checkpoints {#deliverables}

> This is the single place we define "done" for the phase. Keep it crisp and testable.

**Deliverable:** All 8 tugdeck card types registered with the deck manager (Conversation — including its Question and Approval subcomponents — Terminal, Files, Git, Stats, About, Settings, Developer) are rendered as React components using shadcn/ui controls inside the existing CardFrame layout, with the Tuglook design token system bridged to shadcn CSS variables, built by Vite, and embedded in the tugcast binary via rust-embed. CardHeader receives live meta updates from React components via the adapter.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] All 8 card types registered with the deck manager render as React components, including Conversation's Question and Approval subcomponents (`bun run build` exits 0, manual verification of each card)
- [ ] All card-level tests pass as React Testing Library tests (`bun test` exits 0)
- [ ] `cargo build` succeeds with updated `build.rs` embedding Vite `dist/`
- [ ] `cargo nextest run` exits 0 (no Rust test regressions)
- [ ] All 3 Tuglook themes (Brio, Bluenote, Harmony) render correctly in all cards (functional equivalence; pixel-level parity not required)
- [ ] No vanilla TS card implementation files remain (only interfaces, adapters, pure TS utilities)
- [ ] WebSocket connectivity, card frame positioning, snap behavior, and deck serialization work without regression
- [ ] Live meta updates work: conversation title changes are reflected immediately in CardHeader without requiring DeckManager.render()

**Acceptance tests:**
- [ ] `bun run build && ls dist/index.html` — Vite build succeeds
- [ ] `bun test` — all RTL tests pass
- [ ] `cd tugcode && cargo build` — Rust build succeeds
- [ ] `cd tugcode && cargo nextest run` — Rust tests pass
- [ ] Manual: open tugdeck in browser, verify all 8 card types render (including Conversation with question/approval subcomponents), switch themes, resize cards, send a conversation message, verify header title updates live when conversation title changes

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Convert chrome layer to React: React owns menu rendering via shadcn DropdownMenu, tab bar via shadcn Tabs, toolbar via shadcn Tooltip (card-header, card-menu, tab-bar, dock); remove `lucide` dependency (replaced by `lucide-react`)
- [ ] Evaluate migrating canvas layout engine to use React for card positioning
- [ ] Add shadcn Command component for command palette
- [ ] Add shadcn Toast/Sonner for notifications
- [ ] Evaluate replacing CustomEvent bus with React context or state management library
- [ ] Add shadcn ContextMenu for right-click support on cards

| Checkpoint | Verification |
|------------|--------------|
| Vite build produces valid dist/ | `bun run build` exits 0, `dist/index.html` exists |
| All RTL tests pass | `bun test` exits 0 |
| Rust build embeds dist/ | `cargo build` exits 0 |
| Rust tests pass | `cargo nextest run` exits 0 |
| No vanilla TS card files | `ls src/cards/*.ts` shows only card.ts, react-card-adapter.ts |
| Live meta updates work | Manual: conversation title change updates header immediately |
