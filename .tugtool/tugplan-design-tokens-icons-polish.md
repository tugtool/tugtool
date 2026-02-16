## Phase 5.0: Design Tokens, Icons & Terminal Polish {#phase-design-tokens}

**Purpose:** Establish the foundational styling infrastructure -- design token system, Lucide icon library, and terminal polish -- that all subsequent tugdeck UI work depends on. After this phase, zero hardcoded hex values remain in CSS or TypeScript, all text-character icons are replaced with SVG icons, and terminal resize is flash-free.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | -- |
| Last updated | 2025-02-16 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phases 1-4 built the tugdeck frontend: terminal bridge, multi-card deck, stats/polish/resilience, and the Bun pivot. The current CSS uses hardcoded hex values throughout (`#1e1e1e`, `#4ec9b0`, `#d4d4d4`, etc.), icons are text characters (`+`, `~`, `-`, `>`), and the terminal flashes during resize due to synchronous `fitAddon.fit()` calls. Before building the conversation card (Phase 7) -- which has the most complex styling of any card -- we need a proper token system so every color has a semantic name, consistent iconography, and polished terminal behavior.

The design document at `roadmap/component-roadmap-2.md` Section 5 specifies the complete token architecture, icon inventory, and terminal polish requirements for this phase.

#### Strategy {#strategy}

- **Tokens first.** Create the CSS custom property system (Tier 1 palette + Tier 2 semantic tokens) in a dedicated `tokens.css` file, then migrate all hardcoded colors in CSS and TypeScript files to use semantic tokens.
- **Icons second.** Install Lucide via `bun add lucide`, replace all text-character icons in files-card and git-card with SVG icons, and add ChevronUp/ChevronDown icons to card collapse buttons.
- **Polish last.** Apply global card padding, implement resize debounce to eliminate terminal flash, and add grid gap -- these are visual refinements that depend on the token system being in place.
- **Compile-clean at every step.** Each step produces a `bun build`-clean bundle. No step leaves broken references.
- **Zero regressions.** Every step preserves all existing functionality: resize, collapse, WebSocket reconnect, layout persistence.

#### Stakeholders / Primary Customers {#stakeholders}

1. tugdeck end users (operators viewing the dashboard)
2. Future phase implementers (Phase 7 conversation card, Phase 8 panel system)

#### Success Criteria (Measurable) {#success-criteria}

- Zero hardcoded hex values remain in CSS files (`grep -c '#[0-9a-fA-F]\{6\}' tugdeck/styles/*.css` returns 0)
- Zero hardcoded hex values remain in TypeScript files (`grep -c '#[0-9a-fA-F]\{6\}' tugdeck/src/**/*.ts` returns 0)
- Zero text-character icons remain in card TypeScript files (no `+`, `~`, `-`, `>` used as icon literals)
- All Lucide icons inherit `currentColor` and render at correct size
- Terminal text has visible padding on all sides (visual inspection)
- Dragging resize handles does not cause terminal flashing (visual inspection)
- `bun build tugdeck/src/main.ts --outfile=dist/app.js --minify` succeeds
- `cargo build -p tugcast` succeeds (build.rs invokes bun)
- Grid has 2px visual separation between cards (visual inspection)

#### Scope {#scope}

1. Create `tugdeck/styles/tokens.css` with Tier 1 palette and Tier 2 semantic tokens
2. Migrate all hardcoded hex values in `cards.css`, `deck.css`, and `index.html` to semantic tokens
3. Migrate all hardcoded hex values in TypeScript files (`terminal-card.ts`, `stats-card.ts`) to read CSS tokens via `getComputedStyle`
4. Install Lucide and replace text-character icons in `files-card.ts` and `git-card.ts` with SVG icons
5. Replace collapse button text characters (`+`/`-`) with ChevronUp/ChevronDown SVG icons in `deck.ts`
6. Add 8px padding to all `.card-slot` elements
7. Implement resize debounce using `requestAnimationFrame` in `terminal-card.ts`
8. Add 2px grid gap to `.deck-grid`

#### Non-goals (Explicitly out of scope) {#non-goals}

- Light theme or theme switching (dark-only for now)
- Conversation card icons (Phase 7 scope; defined in design doc Section 5.6 but not needed until then)
- Panel system changes (Phase 8 scope)
- Syntax highlighting tokens (Phase 7 scope; defined in design doc Section 7.4)
- Accessibility audit (deferred per design doc Section 12)

#### Dependencies / Prerequisites {#dependencies}

- Phase 4 (Bun Pivot) completed: commit `b98163a`
- Bun installed and functional as build toolchain
- Design document at `roadmap/component-roadmap-2.md` Section 5

#### Constraints {#constraints}

- Bundle must remain buildable with `bun build` (no webpack/vite/esbuild)
- All CSS custom properties must work in modern browsers (Chrome, Firefox, Safari, Edge)
- Lucide must be installed as framework-agnostic ES module (no React dependency)
- `cargo build -p tugcast` must continue to succeed (build.rs integration)

#### Assumptions {#assumptions}

- Lucide will be installed via `bun add lucide` as specified in the design doc
- All existing functionality (collapse, resize, drag handles, WebSocket connection) must be preserved
- The xterm.js theme object will read CSS tokens once at terminal initialization time via `getComputedStyle`
- Sparkline colors will read CSS tokens once at SubCard instantiation time via `getComputedStyle`
- Icon SVGs will be created using Lucide's `createElement` API (framework-agnostic)
- All icon elements will use `currentColor` to inherit semantic token colors from parent elements
- The resize debounce will suppress `fit()` calls during drag and fire once on `pointerup`
- The design token system follows the exact naming and structure from the design document Section 5.5

---

### 5.0.0 Design Decisions {#design-decisions}

#### [D01] Two-tier token architecture: palette + semantic (DECIDED) {#d01-two-tier-tokens}

**Decision:** Use a two-tier CSS custom property system: Tier 1 raw palette values (never referenced by components) and Tier 2 semantic tokens (referenced by all components). Follows shadcn/ui convention.

**Rationale:**
- Semantic tokens give every color a purpose, making future theme changes a single-file edit
- The palette tier provides indirection: changing `--palette-green` updates every semantic token that references it
- shadcn/ui convention (name/name-foreground pairs) guarantees accessible contrast by construction

**Implications:**
- Components must never use `--palette-*` tokens directly
- Every color in CSS and TypeScript must map to a semantic token
- New tokens must be added to `tokens.css` before use in any component

#### [D02] Tokens in a dedicated CSS file imported first (DECIDED) {#d02-tokens-file}

**Decision:** Create `tugdeck/styles/tokens.css` as a standalone file imported first in `index.html`, before all other stylesheets.

**Rationale:**
- Keeps token definitions in a single source of truth
- Importing first ensures all subsequent CSS can reference tokens
- Clean separation: tokens.css defines values, other CSS files consume them

**Implications:**
- `index.html` must add `<link rel="stylesheet" href="tokens.css">` before existing stylesheet links
- All CSS files become dependent on tokens.css being loaded first

#### [D03] TypeScript reads CSS tokens via getComputedStyle at initialization (DECIDED) {#d03-ts-reads-tokens}

**Decision:** TypeScript files that set inline colors (terminal-card.ts xterm theme, stats-card.ts sparkline colors) read CSS token values once at card initialization time using `getComputedStyle(document.documentElement).getPropertyValue('--token-name')`.

**Rationale:**
- Single read at initialization is simple and efficient
- Avoids runtime overhead of reading computed style on every frame
- Token values do not change at runtime (no theme switching in this phase)

**Implications:**
- `terminal-card.ts` must read `--background` and `--foreground` in `mount()` before creating the Terminal
- `stats-card.ts` SubCard constructor must read `--chart-1`, `--chart-2`, `--chart-3` for sparkline colors
- If future phases add theme switching, these reads must be repeated

#### [D04] Lucide icons via createElement API (DECIDED) {#d04-lucide-createelement}

**Decision:** Use Lucide's framework-agnostic `createElement` function to create SVG icon elements dynamically in TypeScript card code.

**Rationale:**
- No React dependency required
- `createElement` returns an SVG element that can be appended to the DOM directly
- Tree-shaking works via individual named imports (`import { FilePlus } from "lucide"`)

**Implications:**
- Each card file imports only the specific icons it needs
- Icons are created as DOM elements, not HTML strings (safer, no innerHTML for icons)
- All icons must have `currentColor` as their color source (default Lucide behavior)

#### [D05] Resize debounce via requestAnimationFrame during drag (DECIDED) {#d05-resize-debounce}

**Decision:** Debounce `fitAddon.fit()` calls using `requestAnimationFrame`. During active drag (pointer held on drag handle), suppress `fit()` calls entirely. On `pointerup` (drag end), perform a single `fit()`.

**Rationale:**
- `requestAnimationFrame` batches resize operations to the display refresh rate
- Suppressing during drag eliminates flash entirely (no intermediate terminal redraws)
- Single `fit()` on `pointerup` ensures final size is correct
- Adapts to existing DeckManager `pointerdown`/`pointermove`/`pointerup` structure

**Implications:**
- `terminal-card.ts` ResizeObserver callback must check a `dragging` flag before calling `fit()`
- DeckManager must expose drag state to terminal card (or terminal card must track its own debounce)
- Window resize events (non-drag) still get debounced via `requestAnimationFrame` for smoothness

#### [D06] Global card padding on .card-slot elements (DECIDED) {#d06-card-padding}

**Decision:** Apply `padding: 8px; box-sizing: border-box;` to all `.card-slot` elements globally. Card headers remain flush with card edges by sitting outside the padded content area.

**Rationale:**
- Consistent internal padding across all cards with a single CSS rule
- `box-sizing: border-box` ensures padding does not change the slot's grid-allocated size
- The FitAddon calculates terminal dimensions from the container's inner dimensions, so the terminal automatically shrinks to fit within the padding

**Implications:**
- Card content (event lists, git content, stats content) gains 8px padding on all sides
- Card headers need to be positioned to remain flush (negative margin or structural change)
- Terminal card automatically adjusts via FitAddon

---

### 5.0.1 Specification {#specification}

#### 5.0.1.1 Token Definitions {#token-definitions}

**Table T01: Tier 1 Palette Tokens** {#t01-palette-tokens}

| Token | Value | Description |
|-------|-------|-------------|
| `--palette-gray-1` | `#1e1e1e` | Darkest gray (page background) |
| `--palette-gray-2` | `#252526` | Dark gray (card headers) |
| `--palette-gray-3` | `#2d2d2d` | Medium-dark gray (muted surfaces) |
| `--palette-gray-4` | `#3c3c3c` | Medium gray (borders) |
| `--palette-gray-5` | `#808080` | Mid gray (secondary text) |
| `--palette-gray-6` | `#cccccc` | Light gray (card text) |
| `--palette-gray-7` | `#d4d4d4` | Near-white (primary text) |
| `--palette-gray-8` | `#ffffff` | White |
| `--palette-blue-1` | `#0e639c` | Dark blue (primary actions) |
| `--palette-blue-2` | `#569cd6` | Medium blue (accent) |
| `--palette-blue-3` | `#9cdcfe` | Light blue (info) |
| `--palette-green` | `#4ec9b0` | Green (success) |
| `--palette-yellow` | `#dcdcaa` | Yellow (warning) |
| `--palette-red` | `#f44747` | Red (destructive) |
| `--palette-orange` | `#ce9178` | Orange (strings) |
| `--palette-purple` | `#c586c0` | Purple (reserved) |

**Table T02: Tier 2 Semantic Tokens** {#t02-semantic-tokens}

| Token | Value | Purpose |
|-------|-------|---------|
| `--background` | `var(--palette-gray-1)` | Page canvas |
| `--foreground` | `var(--palette-gray-7)` | Primary text |
| `--card` | `var(--palette-gray-2)` | Card headers, elevated surfaces |
| `--card-foreground` | `var(--palette-gray-6)` | Text on card surfaces |
| `--muted` | `var(--palette-gray-3)` | Recessed/subtle surface |
| `--muted-foreground` | `var(--palette-gray-5)` | Secondary text, timestamps |
| `--popover` | `var(--palette-gray-3)` | Floating surfaces |
| `--popover-foreground` | `var(--palette-gray-7)` | Text on popovers |
| `--border` | `var(--palette-gray-4)` | Default border |
| `--border-muted` | `var(--palette-gray-3)` | Subtle dividers |
| `--input` | `var(--palette-gray-4)` | Input field border |
| `--ring` | `var(--palette-blue-2)` | Focus ring |
| `--primary` | `var(--palette-blue-1)` | Primary actions |
| `--primary-foreground` | `var(--palette-gray-8)` | Text on primary |
| `--secondary` | `var(--palette-gray-3)` | Secondary actions |
| `--secondary-foreground` | `var(--palette-gray-7)` | Text on secondary |
| `--accent` | `var(--palette-blue-2)` | Highlight, selection |
| `--accent-foreground` | `var(--palette-gray-1)` | Text on accent |
| `--success` | `var(--palette-green)` | Created, clean, passing |
| `--success-foreground` | `var(--palette-gray-1)` | Text on success |
| `--warning` | `var(--palette-yellow)` | Modified, building |
| `--warning-foreground` | `var(--palette-gray-1)` | Text on warning |
| `--destructive` | `var(--palette-red)` | Removed, failed, error |
| `--destructive-foreground` | `var(--palette-gray-8)` | Text on destructive |
| `--info` | `var(--palette-blue-3)` | Renamed, informational |
| `--info-foreground` | `var(--palette-gray-1)` | Text on info |
| `--radius` | `6px` | Default border radius |
| `--radius-sm` | `4px` | Small border radius |
| `--radius-lg` | `8px` | Large border radius |
| `--chart-1` | `var(--palette-green)` | CPU/Memory sparkline |
| `--chart-2` | `var(--palette-blue-2)` | Token Usage sparkline |
| `--chart-3` | `var(--palette-yellow)` | Build Status sparkline |
| `--chart-4` | `var(--palette-red)` | Error/threshold sparkline |
| `--chart-5` | `var(--palette-purple)` | Reserved |

**Table T03: Hardcoded-to-Semantic Migration Map** {#t03-migration-map}

| Hardcoded Value | Semantic Token | Files Using It |
|-----------------|---------------|----------------|
| `#1e1e1e` | `var(--background)` | `index.html`, `cards.css` (files-card bg, git-card bg, stats-card bg), `terminal-card.ts` (xterm theme) |
| `#252526` | `var(--card)` | `cards.css` (card-header bg) |
| `#3c3c3c` | `var(--border)` | `cards.css` (card-header border, stat-sub-card border, card-slot borders), `deck.css` (mentioned implicitly) |
| `#d4d4d4` | `var(--foreground)` | `cards.css` (files-card text, git-card text, stats-card text, stat-value text), `terminal-card.ts` (xterm foreground) |
| `#cccccc` | `var(--card-foreground)` | `cards.css` (card-header text, collapse-btn hover) |
| `#808080` | `var(--muted-foreground)` | `cards.css` (collapse-btn text, git head-message, git section-title, stat-name, stat-na, untracked file status) |
| `#4ec9b0` | `var(--success)` | `cards.css` (event-created, staged file-status, clean-status), `stats-card.ts` (processInfo sparkline color) |
| `#dcdcaa` | `var(--warning)` | `cards.css` (event-modified, unstaged file-status), `stats-card.ts` (buildStatus sparkline color) |
| `#f44747` | `var(--destructive)` | `cards.css` (event-removed) |
| `#569cd6` | `var(--accent)` | `cards.css` (event-renamed), `stats-card.ts` (tokenUsage sparkline color) |
| `#0e639c` | `var(--primary)` | `cards.css` (branch-badge bg) |
| `#9cdcfe` | `var(--info)` | `cards.css` (ahead-behind) |
| `#ffffff` | `var(--primary-foreground)` | `cards.css` (branch-badge text), `deck.css` (disconnect-banner text) |

#### 5.0.1.2 Lucide Icon Inventory (This Phase) {#icon-inventory}

**Table T04: Icon Replacements** {#t04-icon-replacements}

| Context | Current | Lucide Icon | Import Name | File |
|---------|---------|-------------|-------------|------|
| Files: Created | `+` | green plus | `FilePlus` | `files-card.ts` |
| Files: Modified | `~` | yellow pencil | `FileEdit` | `files-card.ts` |
| Files: Removed | `-` | red x | `FileX` | `files-card.ts` |
| Files: Renamed | `>` | blue arrow | `FileSymlink` | `files-card.ts` |
| Git: Staged | status char | check circle | `CircleCheck` | `git-card.ts` |
| Git: Unstaged | status char | circle dot | `CircleDot` | `git-card.ts` |
| Git: Untracked | `?` | circle dashed | `CircleDashed` | `git-card.ts` |
| Git: Branch | text | git branch | `GitBranch` | `git-card.ts` |
| Card: Collapse | `-` | chevron up | `ChevronUp` | `deck.ts` |
| Card: Expand | `+` | chevron down | `ChevronDown` | `deck.ts` |
| Stats: CPU/Memory | text | activity | `Activity` | `stats-card.ts` |
| Stats: Tokens | text | coins | `Coins` | `stats-card.ts` |
| Stats: Build | text | hammer | `Hammer` | `stats-card.ts` |

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Lucide bundle size bloat | low | low | Individual named imports enable tree-shaking | Bundle size increases > 20KB |
| CSS token cascade issues | medium | low | Import `tokens.css` first; verify computed values at runtime | Colors render incorrectly in any browser |
| Terminal resize debounce breaks input | medium | low | Preserve existing `onData` keyboard forwarding unchanged; debounce only affects `fit()` | Keyboard input stops working during resize |
| Sparkline colors stale after token read | low | low | Read once at initialization; no theme switching in this phase | Theme switching added in future phase |

**Risk R01: Lucide import compatibility with Bun bundler** {#r01-lucide-bun-compat}

- **Risk:** Lucide's ES module exports may not tree-shake correctly with Bun's bundler, resulting in the entire icon set being included.
- **Mitigation:** Use individual named imports (`import { FilePlus } from "lucide"`). Verify bundle size before and after. If tree-shaking fails, switch to `lucide-static` (SVG strings) or import from subpaths.
- **Residual risk:** Bundle may include unused icons if Bun's tree-shaking is incomplete; acceptable if under 50KB overhead.

---

### 5.0.5 Execution Steps {#execution-steps}

#### Step 0: Design Token System {#step-0}

**Commit:** `feat(tugdeck): add design token system with CSS custom properties`

**References:** [D01] Two-tier token architecture, [D02] Tokens in dedicated CSS file, [D03] TypeScript reads CSS tokens via getComputedStyle, Table T01, Table T02, Table T03, (#token-definitions, #t01-palette-tokens, #t02-semantic-tokens, #t03-migration-map, #context, #strategy)

**Artifacts:**
- New file: `tugdeck/styles/tokens.css` (Tier 1 palette + Tier 2 semantic tokens)
- Modified: `tugdeck/index.html` (add tokens.css import before other stylesheets)
- Modified: `tugdeck/styles/cards.css` (replace all hardcoded hex with `var(--token)`)
- Modified: `tugdeck/styles/deck.css` (replace hardcoded hex in disconnect-banner)
- Modified: `tugdeck/src/cards/terminal-card.ts` (read `--background` and `--foreground` via getComputedStyle for xterm theme)
- Modified: `tugdeck/src/cards/stats-card.ts` (read `--chart-1`, `--chart-2`, `--chart-3` via getComputedStyle for sparkline colors)

**Tasks:**
- [ ] Create `tugdeck/styles/tokens.css` with `:root` block containing all Tier 1 palette tokens from Table T01
- [ ] Add Tier 2 semantic tokens to `tokens.css` referencing palette tokens, per Table T02
- [ ] Add `<link rel="stylesheet" href="tokens.css">` as the first stylesheet in `tugdeck/index.html`, before `app.css`
- [ ] Replace `background: #1e1e1e` in `index.html` inline style with `background: var(--background)`
- [ ] Replace all hardcoded hex values in `tugdeck/styles/cards.css` with semantic token references per Table T03:
  - `#252526` -> `var(--card)` in `.card-header`
  - `#cccccc` -> `var(--card-foreground)` in `.card-header` and `.collapse-btn:hover`
  - `#3c3c3c` -> `var(--border)` in `.card-header` border, `.stat-sub-card` border, card-slot borders
  - `#808080` -> `var(--muted-foreground)` in `.collapse-btn`, `.head-message`, `.section-title`, `.stat-name`, `.stat-na`, `.untracked .file-status`
  - `#1e1e1e` -> `var(--background)` in `.files-card`, `.git-card`, `.stats-card` backgrounds
  - `#d4d4d4` -> `var(--foreground)` in `.files-card`, `.git-card`, `.stats-card`, `.stat-value` text colors
  - `#4ec9b0` -> `var(--success)` in `.event-created`, `.staged .file-status`, `.clean-status`
  - `#dcdcaa` -> `var(--warning)` in `.event-modified`, `.unstaged .file-status`
  - `#f44747` -> `var(--destructive)` in `.event-removed`
  - `#569cd6` -> `var(--accent)` in `.event-renamed`
  - `#0e639c` -> `var(--primary)` in `.branch-badge` background
  - `#ffffff` -> `var(--primary-foreground)` in `.branch-badge` text color
  - `#9cdcfe` -> `var(--info)` in `.ahead-behind`
- [ ] Replace hardcoded hex values in `tugdeck/styles/deck.css`:
  - `#ffffff` -> `var(--foreground)` in `.disconnect-banner` text color (white text on dark banner is appropriate)
- [ ] In `terminal-card.ts` `mount()`, read CSS tokens via `getComputedStyle(document.documentElement).getPropertyValue()` for `--background` and `--foreground`, then pass to xterm Terminal theme object (trimming whitespace from returned values)
- [ ] In `stats-card.ts`, add a helper function to read a CSS token value: `function getCSSToken(name: string): string` that calls `getComputedStyle(document.documentElement).getPropertyValue(name).trim()`
- [ ] In `stats-card.ts` `mount()`, read `--chart-1`, `--chart-2`, `--chart-3` and pass to SubCard constructors instead of hardcoded hex values
- [ ] In `stats-card.ts`, remove the hardcoded default `color: string = "#4ec9b0"` from the `Sparkline` class constructor parameter (line 20). Since all `Sparkline` instantiations go through `SubCard` which always passes an explicit color argument, the default is unnecessary. Either remove the default entirely (making the parameter required) or change it to an empty string as a safety fallback

**Tests:**
- [ ] Visual inspection: all cards render with identical colors as before (pixel-perfect; tokens resolve to same hex values)
- [ ] `bun build tugdeck/src/main.ts --outfile=dist/app.js --minify` succeeds
- [ ] `cargo build -p tugcast` succeeds

**Checkpoint:**
- [ ] `grep -rn '#[0-9a-fA-F]\{6\}' tugdeck/styles/cards.css` returns no matches (zero hardcoded hex in cards.css)
- [ ] `grep -rn '#[0-9a-fA-F]\{6\}' tugdeck/styles/deck.css` returns no matches except in comments (zero hardcoded hex in deck.css)
- [ ] `grep -rn '#[0-9a-fA-F]\{6\}' tugdeck/src/cards/terminal-card.ts` returns no matches
- [ ] `grep -rn '#[0-9a-fA-F]\{6\}' tugdeck/src/cards/stats-card.ts` returns no matches
- [ ] `grep -rn '#[0-9a-fA-F]\{6\}' tugdeck/index.html` returns no matches
- [ ] `bun build tugdeck/src/main.ts --outfile=dist/app.js --minify` succeeds
- [ ] `cargo build -p tugcast` succeeds
- [ ] Visual inspection: dashboard renders identically to before (same colors, same layout)

**Rollback:**
- Revert commit; delete `tugdeck/styles/tokens.css`; restore original hex values in all modified files

**Commit after all checkpoints pass.**

---

#### Step 1: Lucide Icons {#step-1}

**Depends on:** #step-0

**Commit:** `feat(tugdeck): replace text-character icons with Lucide SVGs`

**References:** [D04] Lucide icons via createElement API, Table T04, Risk R01, (#icon-inventory, #t04-icon-replacements, #strategy)

**Artifacts:**
- Modified: `tugdeck/package.json` (add `lucide` dependency)
- Modified: `tugdeck/src/cards/files-card.ts` (replace `+`/`~`/`-`/`>` with FilePlus/FileEdit/FileX/FileSymlink icons)
- Modified: `tugdeck/src/cards/git-card.ts` (replace status characters with CircleCheck/CircleDot/CircleDashed icons; add GitBranch icon)
- Modified: `tugdeck/src/cards/stats-card.ts` (add Activity/Coins/Hammer icons to sub-card headers)
- Modified: `tugdeck/src/deck.ts` (replace `+`/`-` collapse button text with ChevronDown/ChevronUp SVG icons)
- Modified: `tugdeck/styles/cards.css` (adjust `.event-icon` and `.file-status` sizing for SVG elements; style collapse button for SVG)

**Tasks:**
- [ ] Run `bun add lucide` in `tugdeck/` directory to install the Lucide package
- [ ] In `files-card.ts`, refactor icon creation and entry DOM construction:
  - Import `{ createElement }` from `lucide` and the four icon definitions: `FilePlus`, `FileEdit`, `FileX`, `FileSymlink`
  - Change `iconForKind()` to return an SVG element (not a string) using `createElement(iconDef)` with `width: 14` and `height: 14` attributes (matching current `.event-icon` width). Icons inherit `currentColor` from parent element (default Lucide behavior).
  - Refactor `onFrame()` entry creation: the current code builds each entry using a single `entry.innerHTML = ...` call that creates both the icon span and label span together as an HTML string. Replace this with programmatic DOM construction:
    1. Create the `entry` div via `document.createElement("div")` and set className
    2. Create the icon span via `document.createElement("span")`, set className to `"event-icon"`, and append the SVG element returned by the new `iconForKind()` method
    3. Create the label span via `document.createElement("span")`, set className to `"event-label"`, and set its `textContent` to the label string
    4. Append both spans to the entry div
  - This eliminates `innerHTML` usage for entry construction entirely
- [ ] In `git-card.ts`, refactor status icon creation and entry DOM construction:
  - Import `{ createElement }` from `lucide` and icons: `GitBranch`, `CircleCheck`, `CircleDot`, `CircleDashed`
  - In `renderFileSection()`: the current code uses `entry.innerHTML = ...` to create both file-status and file-path spans as a single HTML string. Replace with programmatic DOM construction:
    1. Create file-status span via `document.createElement("span")`, set className
    2. Create the appropriate icon element: if className is `"staged"` use `CircleCheck`, if `"unstaged"` use `CircleDot`. Set icon size to 14px.
    3. Append the icon SVG element to the file-status span
    4. Create file-path span via `document.createElement("span")`, set className, set `textContent` to `file.path`
    5. Append both spans to the entry div
  - In `renderUntrackedSection()`: same refactor pattern -- replace `entry.innerHTML` with programmatic DOM construction using `CircleDashed` icon for the file-status span and `textContent` for the file-path span
  - In `render()`, add GitBranch icon element (14px) before branch badge text in the branch-section div
- [ ] In `stats-card.ts`, add icons to sub-card headers:
  - Import `{ createElement }` from `lucide` and icons: `Activity`, `Coins`, `Hammer`
  - In SubCard constructor, accept an optional icon parameter
  - Prepend icon element before the name span in the stat-header
  - Set icon size to 12px to match sub-card header text
- [ ] In `deck.ts`, replace collapse button text characters with Lucide icons:
  - Import `{ createElement }` from `lucide` and icons: `ChevronUp`, `ChevronDown`
  - In `addCard()`, create ChevronUp or ChevronDown SVG element instead of `+`/`-` text
  - In `applyCollapse()` and `applyExpand()`, replace button content with appropriate icon
  - Set icon size to 14px matching current collapse button font size
- [ ] Update `cards.css`:
  - Adjust `.event-icon` to use `display: flex; align-items: center; justify-content: center;` for SVG centering
  - Adjust `.file-status` similarly for SVG centering
  - Update `.collapse-btn` to remove `font-family: monospace` and add flex centering for SVG
  - Add `svg { display: block; }` scoped within icon containers to prevent inline spacing

**Tests:**
- [ ] Visual inspection: files card shows FilePlus (green), FileEdit (yellow), FileX (red), FileSymlink (blue) icons
- [ ] Visual inspection: git card shows CircleCheck (green), CircleDot (yellow), CircleDashed (gray) icons
- [ ] Visual inspection: git card shows GitBranch icon next to branch name
- [ ] Visual inspection: stats card shows Activity, Coins, Hammer icons in sub-card headers
- [ ] Visual inspection: collapse buttons show ChevronUp when expanded, ChevronDown when collapsed
- [ ] All icons render at correct size and inherit `currentColor` from parent
- [ ] `bun build tugdeck/src/main.ts --outfile=dist/app.js --minify` succeeds

**Checkpoint:**
- [ ] `bun build tugdeck/src/main.ts --outfile=dist/app.js --minify` succeeds
- [ ] `cargo build -p tugcast` succeeds
- [ ] No text-character icons (`+`, `~`, `-`, `>`, `?`) used as icon literals in card TypeScript files (verify with grep)
- [ ] Bundle size increase from Lucide is under 50KB (check dist/app.js size before and after)
- [ ] Visual inspection: all icons render correctly with semantic token colors
- [ ] Collapse/expand still works correctly with new icons

**Rollback:**
- Revert commit; run `bun remove lucide` in `tugdeck/`; restore original text-character icon methods

**Commit after all checkpoints pass.**

---

#### Step 2: Terminal Polish {#step-2}

**Depends on:** #step-0

**Commit:** `feat(tugdeck): add card padding, resize debounce, and grid gap`

**References:** [D05] Resize debounce via requestAnimationFrame during drag, [D06] Global card padding on .card-slot elements, (#strategy, #context)

**Artifacts:**
- Modified: `tugdeck/styles/deck.css` (add `gap: 2px` to `.deck-grid`; add `padding: 8px; box-sizing: border-box;` to `.card-slot`)
- Modified: `tugdeck/styles/cards.css` (adjust card header positioning to remain flush despite card-slot padding)
- Modified: `tugdeck/src/cards/terminal-card.ts` (implement resize debounce using `requestAnimationFrame`; suppress `fit()` during active drag; accept DeckManager reference for drag-state checking)
- Modified: `tugdeck/src/deck.ts` (expose `isDragging` accessor; suppress `handleResize()` during drag pointermove; trigger single `handleResize()` on pointerup)
- Modified: `tugdeck/src/main.ts` (pass DeckManager reference to TerminalCard so it can check drag state)

**Tasks:**
- [ ] In `deck.css`, add `gap: 2px;` to `.deck-grid` (replacing existing `gap: 0;`)
- [ ] In `deck.css`, add padding to all card slots:
  ```css
  .card-slot {
    padding: 8px;
    box-sizing: border-box;
  }
  ```
- [ ] In `cards.css`, adjust card headers to remain flush with card edges:
  - Add negative margins to `.card-header`: `margin: -8px -8px 0 -8px;` to counteract parent padding
  - This positions the header at the card slot edge while content below gets the 8px padding
- [ ] In `deck.ts`, expose drag state so terminal card can suppress `fit()` during active drag:
  - Add a `private _isDragging = false` field to `DeckManager`
  - In `setupColDrag()` and `setupRowDrag()`, set `this._isDragging = true` in the `pointerdown` handler and `this._isDragging = false` in the `pointerup` handler
  - Add a public `get isDragging(): boolean` accessor
  - In the `pointerup` handlers (both col and row), after setting `_isDragging = false`, call `this.handleResize()` to trigger a single final resize notification to all cards (this is the "single fit on pointerup" from D05)
  - In the `pointermove` handlers, remove the existing `this.handleResize()` call -- during drag, cards should NOT receive resize notifications (grid tracks still update visually, but terminal `fit()` is suppressed)
- [ ] In `terminal-card.ts`, implement two-mode resize handling per D05:
  - Add a `resizeDebounceId: number | null = null` field
  - Add a `deckManager: DeckManager | null = null` field and accept it as an optional constructor parameter (or add a `setDeckManager(dm: DeckManager)` setter called after construction in `main.ts`)
  - **ResizeObserver callback** (fires for window resize, layout reflow, etc.): use `requestAnimationFrame` debounce:
    ```typescript
    if (this.resizeDebounceId !== null) {
      cancelAnimationFrame(this.resizeDebounceId);
    }
    this.resizeDebounceId = requestAnimationFrame(() => {
      if (this.fitAddon) this.fitAddon.fit();
      this.resizeDebounceId = null;
    });
    ```
  - **`onResize()` method** (called by DeckManager): check `this.deckManager?.isDragging`. If dragging, do nothing (suppress `fit()` entirely). If not dragging (this is the single fit on pointerup, or a non-drag resize), perform a single immediate `fit()` call.
  - Cancel any pending animation frame in `destroy()`
- [ ] Verify that keyboard input forwarding (`terminal.onData`) is unaffected by debounce changes
- [ ] Verify that the terminal resize frame sent to server (`terminal.onResize`) still fires correctly after the debounced/post-drag `fit()` call
- [ ] Verify that the terminal redraws correctly after drag ends (the single `handleResize()` call in `pointerup` triggers `onResize()` with `isDragging === false`, which calls `fit()` once)

**Tests:**
- [ ] Visual inspection: terminal text has visible 8px padding on all sides
- [ ] Visual inspection: all card content areas have consistent 8px internal padding
- [ ] Visual inspection: card headers remain flush with card edges (no padding on headers)
- [ ] Visual inspection: dragging resize handles does not cause terminal flashing
- [ ] Visual inspection: moving browser window does not cause terminal flashing
- [ ] Visual inspection: 2px gap visible between all grid cells
- [ ] All existing functionality preserved: collapse/expand, drag resize, WebSocket reconnect, layout persistence

**Checkpoint:**
- [ ] `bun build tugdeck/src/main.ts --outfile=dist/app.js --minify` succeeds
- [ ] `cargo build -p tugcast` succeeds
- [ ] Visual inspection: terminal has 8px padding on all sides
- [ ] Visual inspection: resize drag is flash-free
- [ ] Visual inspection: 2px grid gap visible between cards
- [ ] Collapse/expand cards still works correctly
- [ ] Layout persistence (localStorage) still works correctly

**Rollback:**
- Revert commit; restore `gap: 0;` in deck.css; remove card-slot padding; restore direct `fit()` calls in terminal-card.ts

**Commit after all checkpoints pass.**

---

### 5.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A tugdeck frontend with a complete design token system, Lucide SVG icons, and polished terminal behavior -- ready to serve as the styling foundation for the conversation card (Phase 7) and panel system (Phase 8).

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `grep -rn '#[0-9a-fA-F]\{6\}' tugdeck/styles/*.css` returns zero matches (zero hardcoded hex in all CSS)
- [ ] `grep -rn '#[0-9a-fA-F]\{6\}' tugdeck/src/**/*.ts` returns zero matches (zero hardcoded hex in all TypeScript)
- [ ] `grep -rn '#[0-9a-fA-F]\{6\}' tugdeck/index.html` returns zero matches
- [ ] No text-character icons remain in card TypeScript files
- [ ] All Lucide icons render correctly and inherit `currentColor`
- [ ] Terminal has visible 8px padding on all sides
- [ ] Resize drag is flash-free
- [ ] 2px grid gap visible between cards
- [ ] `bun build tugdeck/src/main.ts --outfile=dist/app.js --minify` succeeds
- [ ] `cargo build -p tugcast` succeeds
- [ ] All existing functionality preserved (collapse, resize, drag handles, WebSocket reconnect, layout persistence)

**Acceptance tests:**
- [ ] Visual inspection: dashboard renders with identical colors to pre-migration (tokens resolve to same hex values)
- [ ] Visual inspection: all icons render as SVG at correct size with correct colors
- [ ] Integration test: drag resize handles -- terminal does not flash, final size is correct
- [ ] Integration test: collapse/expand cards -- icons switch between ChevronUp/ChevronDown correctly
- [ ] Integration test: reload page -- layout is restored from localStorage, colors are correct

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 7: Conversation card styling (uses semantic tokens defined here)
- [ ] Phase 7: Conversation card icons (Lucide icons from Section 5.6 not yet needed)
- [ ] Phase 7: Syntax highlighting tokens (`--syntax-*` tokens from Section 7.4)
- [ ] Phase 8: Panel system (uses tokens and icons defined here)
- [ ] Future: Light theme support (change palette values in tokens.css, all components update automatically)

| Checkpoint | Verification |
|------------|--------------|
| Zero hardcoded hex in CSS | `grep -rn '#[0-9a-fA-F]\{6\}' tugdeck/styles/*.css` returns 0 |
| Zero hardcoded hex in TS | `grep -rn '#[0-9a-fA-F]\{6\}' tugdeck/src/**/*.ts` returns 0 |
| Bundle builds | `bun build tugdeck/src/main.ts --outfile=dist/app.js --minify` succeeds |
| Cargo builds | `cargo build -p tugcast` succeeds |
| Flash-free resize | Visual inspection during drag resize |

**Commit after all checkpoints pass.**
