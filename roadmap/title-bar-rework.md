<!-- devise-skeleton v4 -->

## Title Bar Rework — Three Chrome Tiers, Adopted {#phase-slug}

**Purpose:** Take the three-tier card chrome ratified in the *Card Chrome Tiers* gallery spike — 72px document masthead / 36px utility title bar / 32px rail — out of the fixture and onto the shipping cards: the Text, File viewer, and Diff cards wear document mastheads, the Lens, Jots, and Gazette rails wear the flush racing-stripes rail chrome, and every utility card keeps the 36px bar it has today.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-08-10 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The deck's chrome today has two heights (`tuglaws/pane-model.md` § "Chrome has two heights, and the taller one is a masthead"), and exactly one card wears the taller one: the Session card. The *Card Chrome Tiers* spike (`tugdeck/src/components/tugways/cards/gallery-card-chrome.tsx`, Maker ▸ Layout & Structure) proposed and ratified a third distinction: a **document** card (Text, File viewer, Diff) says its own name and where it lives in a 72px masthead; a **utility** card (Settings, Keyboard, gallery cards) keeps the 36px tinted bar; a **rail** (Lens, Jots, Gazette) — which the layout imposer already treats as a different kind of thing — wears a 32px flush bar with an uppercase tracked label, a tinted glyph, and racing stripes.

The chrome side of this is **already real, shipping code**, not spike code: `CardMastheadPayload` is a union (`session-masthead` | `card-masthead`) in `tugdeck/src/lib/card-title-store.ts`; `CardMasthead` (`tugdeck/src/components/tugways/card-masthead.tsx`) composes `TugSessionRow` on the shared `masthead-frame.css` tier exactly as the session masthead does; `CardTitleBar` (`tugdeck/src/components/chrome/tug-pane.tsx`) renders either masthead kind and takes a `sidebar` prop; and the full rail treatment lives in `tugdeck/src/components/tugways/tug-pane.css` under `.tug-pane-title-bar[data-role="sidebar"]`. What does not exist is any **publisher or role pass**: no shipping card publishes a `card-masthead` payload, and `TugPane` never passes `sidebar` to `CardTitleBar`, so outside the gallery fixture the document tier and the rail tier are dead code. This plan is the adoption: publishers, the role pass, the tokens, the icons, the Text card's chrome consolidation, the tests, and the doctrine updates.

#### Strategy {#strategy}

- **Adoption is publication.** The chrome is generic and finished; each step teaches one card (or the pane) to use what already ships. No new tier component is authored anywhere in this plan.
- Land the **rail** first — it is pure plumbing (a prop pass, a CSS rule relocation, three icons, one theme token) with no content decisions left.
- Land the **Text card** next, in two steps: first move its actions into the pane `…` menu (so the top bar has no remaining job), then publish the masthead, delete `TextCardTopBar`, and move the save-state cell up to the masthead's third line.
- **File viewer** and **Diff** follow as small, independent publisher steps.
- Doctrine (`tuglaws/pane-model.md`, `tuglaws/design-decisions.md`) and the gallery fixture's "nothing is wired" docstring update once the code is true.
- App-test coverage lands as its own step with `@covers` declarations, then one integration checkpoint sweeps the selection.

#### Success Criteria (Measurable) {#success-criteria}

- A Text card bound to a file shows a 72px masthead: filename (dirty dot in manual mode), start-truncated full path, and the save-state line — verified by app-test assertions on `[data-testid="card-masthead-title"]` / `-description` / `-detail` and a measured 72px `.tug-pane-title-bar` height.
- The Text card renders **no** `text-card-top-bar` element, and Save / Move To… / Editor Options are reachable from the pane `…` menu (`[data-testid="tug-pane-title-bar-menu-button"]`).
- A File viewer card and a Project Diff card each show a masthead with the content in **Table T01**.
- A pinned Lens/Jots/Gazette pane's bar is 32px, flush (`background-color` = `--tugx-pane-bg`), with an uppercase tracked label and both stripe bands — and `--tugx-pane-chrome-height` reads 32px **on the pane element**, not just the bar.
- Utility cards (Settings, Keyboard, About, gallery) are pixel-unchanged at 36px.
- `cd tugdeck && bunx tsc --noEmit` and `bunx vite build` clean; `bun run audit:theme-contrast` passes; `just app-test-covers-check` passes; the selective app-test run for the changed files passes.

#### Scope {#scope}

1. `TugPane` → `CardTitleBar` sidebar role pass, pane-level role stamp, rail chrome-height publication at pane scope, `--tug-rail-chrome-height` in the six themes.
2. Rail icons for Lens, Jots, Gazette.
3. Text card: `…` menu migration (Save / Move To… / Editor Options sheet), masthead publication, `TextCardTopBar` deletion, save-state relocation out of the status bar.
4. File viewer card masthead publication.
5. Diff card masthead publication.
6. Doctrine updates: `tuglaws/pane-model.md`, `tuglaws/design-decisions.md` (including the stale width-control paragraph), gallery fixture docstring.
7. App-test coverage for the document masthead and the rail tier.

#### Non-goals (Explicitly out of scope) {#non-goals}

- No change to the Session card's masthead, `SessionMasthead`, `TugSessionRow`, or `masthead-frame.css` — they are the finished substrate this plan mounts things on.
- No re-litigation of the rail treatment. Racing stripes are settled: flush ground, three 1px stripes on a 3px pitch, neutral ink only, focus signaled by brightening — never the accent color, never a hue change.
- No masthead for utility cards, the Pulse card, or the About card; no rail chrome for anything but Lens/Jots/Gazette.
- No redesign of the Text card's find bar, conflict sheets, or the status bar's settable/number clusters — only the save cell moves.
- No changes to the tab-bar metrics: the masthead and the tab bar stack (72 + 36); tab rows stay on `--tug-chrome-height`.

#### Dependencies / Prerequisites {#dependencies}

- The shipped chrome substrate, all already on `main`: `CardMasthead` + `masthead-frame.css` (commit `683c08269` and the follow-up that made both mastheads mount `TugSessionRow`), the `CardMastheadPayload` union, `CardTitleBar`'s `masthead` and `sidebar` props, and the rail CSS in `tug-pane.css`.
- `paneTitleBarMenuStore` (`tugdeck/src/lib/pane-title-bar-menu-store.ts`) — the existing generic `…` channel the Text card migration publishes into.

#### Constraints {#constraints}

- Tugdeck verification: `bunx vite build` before declaring any change done (the debug app loads the prod rollup bundle); bun, never npm.
- App-tests are selective (`just app-test-changed` / explicit files); never a sweep, never piped output; new tests must carry `@covers`.
- Theme token work must pass `bun run audit:theme-contrast` (no theme may exceed the brio budget).
- Only the user commits on `main`; `/tugplug:implement` commits per-step on its dash worktree only.

#### Assumptions {#assumptions}

- The 32px rail height from the spike is the ratified height (the spike's open question defaulted to what shipped in `tug-pane.css`'s fallback; nothing in review moved it).
- A floating (unpinned) Lens/Jots/Gazette pane wears the ordinary 36px bar — rail chrome is a property of *standing in the rail*, which is what `sidebarSide` says (see [P04]).

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows `tuglaws/devise-skeleton.md` v4: explicit `{#anchor}` headings, `[P##]` plan-local decisions, `**References:**` and `**Depends on:**` lines on every step, no line-number citations.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Where do the Text card's actions go? (DECIDED) {#q01-text-actions}

**Question:** When the masthead takes the path line, where do the top bar's Save / Move To… button and the editor-options gear go?

**Resolution:** DECIDED (see [P02]) — user chose the pane `…` menu, 2026-08-10. `TextCardTopBar` is deleted; the gear's popover becomes an Editor Options sheet because a menu item cannot anchor a popover.

#### [Q02] Does a document masthead carry a third line, and what does the Text card's say? (DECIDED) {#q02-third-line}

**Question:** Two or three lines for document mastheads; the Text card's candidate facts already live in its bottom status bar.

**Resolution:** DECIDED (see [P03]) — user directive, 2026-08-10: "move this save data to the third line in the title bar. Leave all the other metadata and controls that are on the bottom now right where they are." The Text card's third line is the save state, moved out of the status bar; the status bar keeps its settable pair (line ending, language) and number pair (caret, counts). File viewer and Diff publish the third-line content in **Table T01**.

#### [Q03] Image dimensions on the File viewer's third line (DEFERRED) {#q03-image-dimensions}

**Question:** The spike's File viewer example showed `PNG · 2560 × 812 · 341 KB`. `ImageBlock` does not currently expose `naturalWidth/Height` upward, and the card streams bytes via `<img src=blobUrl(path)>` so it never holds a byte count.

**Resolution:** DEFERRED — initial adoption publishes the kind label (and PDF page count, which `PdfView` already knows via `doc.numPages`). Wiring an intrinsic-size callback out of `ImageBlock` is a follow-on (#roadmap); the masthead's `detail` accepts it without structural change when it arrives.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Payload churn re-notifying the store per keystroke | med | low | R01 | profiler shows title-store notifies during typing |
| Rail height at pane scope regresses scrim/sheet/banner seats | med | low | R02 | any surface floats 4px high on a rail |
| Losing the save affordance's visibility | low | med | R03 | user feedback after landing |

**Risk R01: Save-state on the third line makes `cardTitleStore.set` chatty** {#r01-title-store-churn}

- **Risk:** The Text card's masthead payload now changes on every save-state transition and dirty flip; a naive publisher could call `set` per keystroke.
- **Mitigation:** The publisher effect depends only on `snapshot.fileName`, `snapshot.readOnly`, `snapshot.saveMode`, `snapshot.saveState`, `snapshot.conflict`, `snapshot.lastSavedAt`, `isDirty`, and the path — the same facts the status bar already re-renders on. `CardTitleStore.set` is equality-guarded (`sameMasthead` compares every `DocumentMastheadPayload` field), so an unchanged payload never notifies.
- **Residual risk:** `saveState === "editing"` still flips once per edit burst; that is one store notify, same cost as today's dirty-dot title update.

**Risk R02: Moving the rail chrome-height to pane scope changes four consumers' geometry** {#r02-pane-scope-height}

- **Risk:** `--tugx-pane-chrome-height` at 32px on the pane now positions the pane scrim's top, the sheet clip's top, and the pane banner's top on rails — surfaces the spike never exercised.
- **Mitigation:** This is the *correct* seating (the bar really is 32px tall; a scrim seated at 36px would overlap nothing but leave a 4px lit strip). The app-test step asserts the pane-level property value and the bar height together.
- **Residual risk:** None identified; rails rarely host sheets, and the Lens's own surfaces live below the bar regardless.

**Risk R03: Save loses its always-visible button** {#r03-save-visibility}

- **Risk:** Save moves from a persistent icon to a `…` menu item; the save *state* stays visible (masthead third line) but the *gesture* takes one more click.
- **Mitigation:** ⌘S (`onSaveCommand` through the editor) and the native File ▸ Save (the `menuState.file` block the card already publishes) are untouched and remain the primary gestures; the masthead's third line makes the state more visible than the old status-bar cell.
- **Residual risk:** Pointer-first users lose a one-click Save; accepted by [Q01]'s resolution.

---

### Design Decisions {#design-decisions}

#### [P01] Adoption is publication; the chrome is finished (DECIDED) {#p01-adoption-is-publication}

**Decision:** No step in this plan authors a new chrome tier, masthead component, or rail treatment. Every step either publishes into an existing channel (`cardTitleStore`, `paneTitleBarMenuStore`) or passes an existing prop (`sidebar`).

**Rationale:**
- `CardMasthead` already composes `TugSessionRow` on `masthead-frame.css`; a second ladder anywhere is the exact defect two review rounds just removed.
- `CardTitleBar` already branches on `masthead.kind` and `sidebar`; the gallery fixture proves both paths against real tokens.

**Implications:**
- Implementation diffs are almost entirely in card files and `tug-pane.tsx`'s mount site; `card-masthead.tsx`, `masthead-frame.css`, and the rail rules in `tug-pane.css` should see **no edits** except the one CSS relocation in [P04].

#### [P02] Text card actions migrate to the pane `…` menu; `TextCardTopBar` is deleted; the gear becomes an Editor Options sheet (DECIDED) {#p02-text-actions-menu}

**Decision:** The Text card publishes its actions via `paneTitleBarMenuStore`: **Save** (manual mode, enabled per the existing `canSave` gate), **Move To…** (automatic-mode drafts with the native picker present), and **Editor Options…**, which opens a card sheet hosting the shared `TextCardControls`. `TextCardTopBar` (`text-card-top-bar.tsx`) is deleted along with its CSS block in `text-card.css`.

**Rationale:**
- Resolves [Q01] per the user's choice: one chrome tier, no strip under the masthead.
- `PaneTitleBarMenuItem` is `{id, label, checked?, onSelect}` — a flat menu row. It cannot host or anchor the gear's `TugPopover`, so the options surface moves to the card's existing sheet idiom (the card already runs `renderSheet()` for save/conflict sheets; the options sheet joins that family, composing `TugSheet` + `TextCardControls`, both real Tug components).
- The path line's jobs (start-truncation via `dir="rtl"` + LRM, click-to-reveal-in-Finder) already exist in `CardMasthead`'s description line (`descriptionKind: "path"`, `onActivateDescription`).

**Implications:**
- `PaneTitleBarMenuItem` needs a `disabled?: boolean` field (Save is present-but-disabled on a clean titled buffer, mirroring the File ▸ Save gate — an item that vanishes and reappears is a menu the hand cannot learn). `CardTitleBar`'s `TugPopupMenu` mapping passes it through.
- The menu items re-publish when their gates change (`canSave`, `canMoveTo`); publication is a `useLayoutEffect` keyed on those facts, cleared on unmount.
- `onActivateDescription` wires to the existing `revealInFinder` for bound files and is omitted for untitled buffers.

#### [P03] The Text card's third line is its save state, moved — not copied — from the status bar (DECIDED) {#p03-save-state-third-line}

**Decision:** The masthead `detail` is exactly what the status bar's left cell says today — the `saveText(saveMode, saveState, conflict, lastSavedAt)` function in `text-card-status-bar.tsx` ("Saving…" / "Edited" / "Unsaved" / "Saved" / "Saved: 12:04:11 PM" / "File changed" / "File deleted"). The `saveText` helper and the save cell move out of the status bar; the settable pair and number pair stay exactly where they are.

**Rationale:**
- Resolves [Q02] per the user's directive verbatim.
- A moved fact, not a duplicated one: two surfaces saying "Edited" would drift the moment one gains a timestamp.

**Implications:**
- `saveText` relocates to `text-card.tsx` (or a small shared module) since the status bar no longer calls it; `TextCardStatusBar` loses the `saveMode`/`saveState`/`conflict`/`lastSavedAt` props that fed only that cell (keep any still needed by the settable pair — `saveMode` gates nothing else there; verify at implementation).
- The manual-mode conflict wording rides the third line now; the automatic-mode conflict `TugPaneBanner` is untouched.
- The status-bar app-test surface changes: `[data-testid="text-card-status-save"]` ceases to exist; any existing assertion on it moves to `[data-testid="card-masthead-detail"]`.

#### [P04] The sidebar role is stamped on the pane element, from `sidebarSide` (DECIDED) {#p04-role-on-pane}

**Decision:** `TugPane` passes `sidebar={sidebarSide !== undefined}` to `CardTitleBar` **and** stamps `data-role="sidebar"` on the `.tug-pane` root element (beside the existing `data-masthead` / `data-lens` attributes it already sets there). The rail's `--tugx-pane-chrome-height: var(--tug-rail-chrome-height, 32px)` declaration moves from `.tug-pane-title-bar[data-role="sidebar"]` up to `.tug-pane[data-role="sidebar"]`, beside `.tug-pane[data-masthead="true"]`'s.

**Rationale:**
- The height must be pane-scoped so the scrim, sheet clip, and banner seat below a 32px bar — the same publication the masthead already has. The CSS comment in `tug-pane.css` § "The rail tier" says exactly this and names this plan's move.
- The role cannot be derived in CSS from the bar's attribute: `:has()` does not invalidate on a descendant attribute change in WebKit.
- `sidebarSide` is the truth the pane already holds (it is what suppresses the width control and drives `imposeSidebarStyle`); an unpinned rail card has `sidebarSide === undefined` and correctly wears the 36px bar.

**Implications:**
- All rail ink/stripe/label rules stay keyed on the **bar's** `[data-role="sidebar"]` (they style the bar); only the height declaration moves to the pane.
- A masthead-publishing card standing in a rail is impossible today (no document card is a sidebar card) and stays undefined behavior; the pane attributes are mutually exclusive in practice.

#### [P05] Rail icons: Telescope, NotebookPen, Newspaper (DECIDED) {#p05-rail-icons}

**Decision:** `defaultMeta.icon` gains `"Telescope"` on Lens (`tugdeck/src/components/lens/lens-register-card.tsx`), `"NotebookPen"` on Jots (`tugdeck/src/components/jots/jots-card-registration.tsx`), `"Newspaper"` on Gazette (`tugdeck/src/components/gazette/gazette-card-registration.tsx`).

**Rationale:**
- Lens and Jots are the spike's own picks (rendered in the fixture's Tier 3 rows); Gazette follows the same literal-noun register.
- The rail glyph draws in `--tugx-rail-icon-ink` (the theme's indigo icon role) — the mark is the tinted element the treatment calls for.

**Implications:**
- `defaultMeta.icon` also feeds the stack-picker rows and any surface reading `CardMeta.icon`; those surfaces gain the same glyphs, which is wanted.

#### [P06] `--tug-rail-chrome-height: 32px` is promoted into the six themes (DECIDED) {#p06-rail-height-token}

**Decision:** Each of `tugdeck/styles/themes/{brio,nocturne,bravura,harmony,aria,vivace}.css` declares `--tug-rail-chrome-height: 32px` beside the existing `--tug-masthead-height: 72px`. The `var(--tug-rail-chrome-height, 32px)` fallback at the point of use stays.

**Rationale:**
- The masthead height is a theme token; the rail height is the same kind of fact and a theme retuning one should find both in the same place.
- The fallback stays per the CSS-knob doctrine — defaults live in `var()` at the point of use.

**Implications:**
- Hand-edit all six files (they are hand-authored; there is no generation script).

#### [P07] Document masthead content per card is fixed by Table T01 (DECIDED) {#p07-masthead-content}

**Decision:** Each adopting card publishes exactly the content in **Table T01** (#t01-masthead-content). Titles keep their existing string-channel conventions (the Text card's trailing dirty dot ` •`, the read-only suffix); the string channel and the masthead publish in **one** `cardTitleStore.set(cardId, title, payload)` call so tab bar, Window menu, and masthead can never disagree.

**Rationale:**
- The string channel remains the reader surface for tabs and menus; splitting the two publishes would race the equality guard and double-notify.
- Every description/detail fact in T01 is one the card already holds in the snapshot it renders from — no new stores, no new fetches ([P01]).

**Implications:**
- The Text card's current title effect (the `cardTitleStore.set(cardId, isManual && isDirty ? \`${base} •\` : base)` block) grows the payload argument rather than gaining a sibling effect.
- The Diff card's "publish only when there is a better name" rule extends: a scoped pop-out diff publishes a masthead too (its title is the registry's "Diff" plus its file scope — see T01), so the override-only-when-better rule now applies to the *string*, while the masthead publishes for both guises.

#### [P08] The File viewer's icon and detail come from `classifyFileKind` (DECIDED) {#p08-file-viewer-kind}

**Decision:** The File viewer's masthead icon and third line derive from `classifyFileKind(path)` (`tugdeck/src/lib/file-kinds.ts`): images get icon `"Image"` and a kind label ("PNG image", from the extension), PDFs get icon `"FileText"` and `"PDF"` — extended to `"PDF · N pages"` once `PdfView` reports `doc.numPages` upward through an existing or new callback prop.

**Rationale:**
- The kind classification already exists and already branches the card body; the masthead reads the same fact.
- Dimensions and byte size are deferred ([Q03]).

**Implications:**
- `PdfView` gains an optional `onDocumentInfo?: (info: { pages: number }) => void` (or the page count is read from the `PdfViewState` it already reports) — smallest honest wiring, decided at implementation; either way the payload republishes through the same equality-guarded `set`.

---

### Deep Dives {#deep-dives}

#### The wiring that already exists (read this before touching anything) {#existing-wiring}

- **`TugPane` → masthead:** `tug-pane.tsx` subscribes `activeCardMasthead` from `cardTitleStore.getMasthead(activeCardId)` via `useSyncExternalStore` and passes it to `CardTitleBar masthead={…}`; the pane root already stamps `data-masthead="true"` when non-null. Chrome follows the **active** card; the masthead and tab bar stack (72 + 36).
- **`CardTitleBar` → renderer:** `masthead.kind === "card-masthead"` mounts `<CardMasthead payload={masthead} />` (unkeyed — reconciling a new path onto the same element is correct); `"session-masthead"` mounts `SessionMasthead` keyed by session id. The masthead **replaces** the registry icon + title string in the bar; the controls cluster is untouched and publishes `--tugx-pane-controls-width` for the masthead's line-end reserves.
- **`CardMasthead` contracts:** never pass `indicatorSize` (its arithmetic reads the phase-dot glyph's geometry; a solid glyph would pull left); the payload's `description: null` and absent `detail` are rendered as `""`, never `undefined` (presence of the description node is what selects the three-level stack via `:has(> .tug-session-row-description)`, and `TugPulse` prints "None" for an absent activity). These are already handled **inside** `CardMasthead` — publishers just fill `DocumentMastheadPayload` honestly.
- **Rail CSS:** everything under `tug-pane.css` § "The rail tier" is finished — flush ground on `--tugx-pane-bg`, three published ink knobs (`--tugx-rail-stripe-ink` / `-label-ink` / `-icon-ink`) with the focused pair as base and the recede keyed off `.tug-pane:not([data-focused="true"])` (deliberate inverted polarity — descendant-selector correctness), `order: 1` + `margin-inline-start: auto` on the controls so the `::after` stripe band lays out before them, stripe bands as `::before`/`::after` at `flex: 1 1 0`.
- **Width control on rails:** already suppressed — `TugPane` omits `widthPreset`/`onSetWidth` when `sidebarSide !== undefined`. No change needed.
- **`…` menu:** `CardTitleBar` already subscribes `paneTitleBarMenuStore.get(activeCardId)` and renders the `MoreHorizontal` button + `TugPopupMenu` when items exist. The Text card only has to publish.

#### Text card facts inventory (what feeds the payload) {#text-card-facts}

From `text-card.tsx`'s existing `snapshot` (`TextCardStore`): `fileName`, `path`, `readOnly`, `saveMode`, `saveState`, `conflict`, `lastSavedAt`, `draftId`, `untitled`; plus the derived `isDirty` and `isManual` the title effect already uses. The masthead effect is the current title-sync `useLayoutEffect` with the payload added — same deps plus the save-state facts. Untitled buffers: today the card *clears* the title override when `fileName === null`; under the masthead it publishes `title: "Untitled"`, `description: null`, so an untitled draft wears the tier too (a document card that dropped to 36px while untitled would reflow the editor on first save).

**Table T01: Document masthead content per card** {#t01-masthead-content}

| Card | icon | title | description (`descriptionKind`) | detail |
|------|------|-------|--------------------------------|--------|
| Text | `"FileText"` | `fileName` (+ ` (read-only)` / manual-dirty ` •`, as today); `"Untitled"` when unbound | full `path` (`"path"`); `null` when untitled | `saveText(…)` — the relocated save state ([P03]) |
| File viewer | by kind ([P08]): `"Image"` / `"FileText"` | `basename(path)` (as today) | full `path` (`"path"`) | kind label; `"PDF · N pages"` when known ([P08], [Q03]) |

Description-line **clicks are inert in this phase**: `CardTitleBar` mounts `CardMasthead` without `onActivateDescription` (there is no pane↔card channel for it yet), so Reveal in Finder travels as a `…` menu item on the Text and File viewer cards instead — `paneTitleBarMenuStore` already exists and needs nothing new. Wiring an actionable description (a masthead-action channel mirroring the menu store) is a follow-on (#roadmap).
| Diff (project guise) | `"GitCompareArrows"` | `"Project Diff"` (as today) | `"{file_count} files · +{total_added} −{total_removed}"` from `GitDiffPayload` (`"text"`) | `base` ref line, e.g. `"vs HEAD"` from `payload.base`; `null` while loading |
| Diff (scoped pop-out) | `"GitCompareArrows"` | registry `"Diff"` string channel unchanged; masthead title = the scoped file's basename | scoped file's path (`"path"`) | per-file `+added −removed` |

Diff notes: the store is `createGitDiffStore()` (`tugdeck/src/lib/git-diff-store.ts`); `GitDiffSnapshot.payload` carries `file_count`, `total_added`, `total_removed`, `base`, `no_repo`. Publish the masthead only when `phase === "ready"` and `!no_repo`; before that the card keeps its current string-only publish (36px bar) — the tier arriving with the data beats an empty 72px band captioning a spinner.

#### What the gallery fixture becomes {#gallery-after}

`gallery-card-chrome.tsx` stays as the tiers' design reference, but its docstring's "Nothing in this file is wired into a shipping card" paragraph becomes false and must be rewritten to say the tiers ship and the fixture is the comparative reference. Its "As shipped, for comparison" rows (a content card's bar on a rail; `TextCardTopBar` on a text card) become historical: relabel them as "before" rows. The fixture keeps mounting `TextCardTopBar` only if the component still exists — after [P02] it does not, so the fixture's "today" text-card row is rebuilt from static markup or removed. Decide at implementation; the fixture must not resurrect the deleted component.

---

### Specification {#specification}

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone (appearance / local-data / structure) | Mechanism | Law |
|-------|--------------------------------------------|-----------|-----|
| Document masthead payloads (Text/File/Diff) | structure (pane↔card channel) | existing `cardTitleStore` + `useSyncExternalStore`, published from card `useLayoutEffect` | [L02], [L24], [L09]/[L10] |
| Sidebar role on the pane | structure → appearance | `sidebarSide` prop → `data-role="sidebar"` attribute; all styling in CSS | [L06], [L09] |
| Rail tier height | appearance | theme token `--tug-rail-chrome-height` + pane-scoped `--tugx-pane-chrome-height` | [L20], [L17] |
| Text card `…` items (Save/Move To…/Options) | structure (pane↔card channel) | existing `paneTitleBarMenuStore`, published from card `useLayoutEffect` | [L02], [L24], [L10]/[L25] |
| Editor Options sheet open/closed | local-data | the Text card's existing sheet state (`renderSheet()` family), `useState` in the card | [L24] |
| Save state on the third line | structure (travels in payload) | fact from `TextCardStore` snapshot, rides `DocumentMastheadPayload.detail` | [L02] |
| PDF page count | local-data → payload | `PdfView` callback → card state → payload republish | [L02] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tests/app-test/at####-card-chrome-tiers.test.ts` | App-test for the document masthead (Text card) and rail tier (numbered at implementation from the corpus tail) |
| `tugdeck/src/components/tugways/cards/text-card-options-sheet.tsx` (or folded into `text-card-save-sheets.tsx`'s family) | The Editor Options sheet hosting `TextCardControls` ([P02]) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TugPane` render | fn | `tugdeck/src/components/chrome/tug-pane.tsx` | pass `sidebar={sidebarSide !== undefined}` to `CardTitleBar`; stamp `data-role="sidebar"` on `.tug-pane` root |
| `.tug-pane[data-role="sidebar"]` | CSS rule | `tugdeck/src/components/tugways/tug-pane.css` | receives the `--tugx-pane-chrome-height` declaration moved off the bar selector; update the § comment that promised this move |
| `--tug-rail-chrome-height` | token | `tugdeck/styles/themes/*.css` (six files) | `32px`, beside `--tug-masthead-height` |
| `defaultMeta.icon` | field | lens/jots/gazette registration files | `"Telescope"` / `"NotebookPen"` / `"Newspaper"` ([P05]) |
| `PaneTitleBarMenuItem.disabled` | field | `tugdeck/src/lib/pane-title-bar-menu-store.ts` | optional; `CardTitleBar`'s item mapping passes it to `TugPopupMenu` |
| Text card masthead+menu effects | fn | `tugdeck/src/components/tugways/cards/text-card.tsx` | title effect grows the payload; new `paneTitleBarMenuStore` publish effect; `saveText` relocated here |
| `TextCardTopBar` | component | `text-card-top-bar.tsx` | **deleted** (file + CSS block + import) |
| `TextCardStatusBar` | component | `text-card-status-bar.tsx` | save cell + `saveText` removed; prop list trimmed |
| File viewer masthead effect | fn | `file-view-card.tsx` | title effect grows the payload per T01 |
| Diff masthead effect | fn | `diff-card.tsx` | publishes per T01 when `phase === "ready"` |

---

### Documentation Plan {#documentation-plan}

- [ ] `tuglaws/pane-model.md` § "Chrome has two heights" → three tiers; document the rail height's pane-scoped publication and which cards wear what.
- [ ] `tuglaws/design-decisions.md`: fix the stale "The width control does not render on a masthead-bearing pane" paragraph (reverted by `1693707dc`; the control renders on every pane that has a width, rails excepted because rails have no width preset); extend the [D132]-adjacent masthead prose to name the document tier and the rail tier.
- [ ] `gallery-card-chrome.tsx` docstring + "as shipped" rows updated per (#gallery-after).

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **App-test** | Drive the real Tug.app: seed a deck, measure real chrome geometry and computed style | the tiers' visible truth — heights, inks, line content |
| **Unit (bun test)** | Pure helpers | `saveText` relocation; payload construction if extracted as pure fns |
| **Drift prevention** | Existing at0375 masthead diagnostics | must stay byte-identical — the session masthead is untouched substrate |

#### What stays out of tests {#test-non-goals}

- No jsdom render tests of `CardMasthead` or `CardTitleBar` — banned pattern; the app-test measures the real thing.
- No mock-store assertion tests on `cardTitleStore` publishes — the app-test asserts the rendered masthead, which is the fact that matters.
- Rail *stripe pixel* assertions beyond presence/ink — 1px gradients under transitions are flaky to read; assert the un-animated custom-property values instead (transitions poison mid-flight style reads).

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** Every tugdeck step's checkpoint includes `cd tugdeck && bunx tsc --noEmit && bunx vite build` (from the worktree's absolute path — Bash cwd reverts between calls).

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Rail role plumbing + tokens + icons | pending | — |
| #step-2 | Text card `…` menu + Editor Options sheet | pending | — |
| #step-3 | Text card masthead; delete `TextCardTopBar`; relocate save state | pending | — |
| #step-4 | File viewer masthead | pending | — |
| #step-5 | Diff card masthead | pending | — |
| #step-6 | Doctrine + gallery fixture updates | pending | — |
| #step-7 | App-test coverage | pending | — |
| #step-8 | Integration checkpoint | pending | — |

#### Step 1: Rail role plumbing + tokens + icons {#step-1}

**Commit:** `tugdeck(chrome): pass the sidebar role to pane chrome, publish the rail tier height pane-wide, register rail icons`

**References:** [P01] Adoption is publication, [P04] Role on the pane, [P05] Rail icons, [P06] Rail height token, (#existing-wiring, #symbols)

**Artifacts:**
- `sidebar` prop pass + `data-role="sidebar"` pane stamp in `tug-pane.tsx`; height rule relocation in `tug-pane.css`; `--tug-rail-chrome-height: 32px` in six theme files; three registration icons.

**Tasks:**
- [ ] In `TugPane`'s render: `sidebar={sidebarSide !== undefined}` on `CardTitleBar`; `{...(sidebarSide !== undefined ? { "data-role": "sidebar" } : {})}` on the `.tug-pane` root beside the existing `data-masthead` spread.
- [ ] Move `--tugx-pane-chrome-height: var(--tug-rail-chrome-height, 32px)` from `.tug-pane-title-bar[data-role="sidebar"]` to a new `.tug-pane[data-role="sidebar"]` rule beside `.tug-pane[data-masthead="true"]`; rewrite the § comment that documented the bar-scoped workaround.
- [ ] Add `--tug-rail-chrome-height: 32px;` beside `--tug-masthead-height` in `brio/nocturne/bravura/harmony/aria/vivace.css`.
- [ ] Add `icon: "Telescope"` / `"NotebookPen"` / `"Newspaper"` to the three registrations ([P05] paths).

**Tests:**
- [ ] Deferred to #step-7 (geometry needs the live app); this step's checkpoint is build-clean + manual pin.

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bunx vite build`
- [ ] `bun run audit:theme-contrast` (from `tugdeck/`) — no theme exceeds the brio budget.
- [ ] In the running app: pin the Lens; its bar is 32px, flush, striped, labeled LENS with the Telescope glyph; `getComputedStyle(document.querySelector('.tug-pane[data-role="sidebar"]')).getPropertyValue('--tugx-pane-chrome-height')` → `32px`.

---

#### Step 2: Text card `…` menu + Editor Options sheet {#step-2}

**Depends on:** #step-1

**Commit:** `tugdeck(text-card): move Save, Move To… and editor options into the pane … menu`

**References:** [P02] Actions to the `…` menu, [Q01], Risk R03, (#text-card-facts, #symbols)

**Artifacts:**
- `PaneTitleBarMenuItem.disabled` + `CardTitleBar` pass-through; Text card menu publish effect; Editor Options sheet component; `TextCardTopBar` still mounted (removed in #step-3).

**Tasks:**
- [ ] Add optional `disabled?: boolean` to `PaneTitleBarMenuItem`; map it through `CardTitleBar`'s `TugPopupMenu` items.
- [ ] In `text-card.tsx`, a `useLayoutEffect` publishing to `paneTitleBarMenuStore.set(cardId, items)`: manual mode → `Save` (disabled per the existing `canSave` expression); automatic-mode drafts with `isPathPickerAvailable()` → `Move To…`; bound non-draft files → `Reveal in Finder` (the top bar's `revealable` gate); always → `Editor Options…`. Clear on unmount.
- [ ] Build the Editor Options sheet (`TugSheet` hosting `TextCardControls`, title "Text Card Settings"), opened by the menu item, joining the card's existing `renderSheet()` family; the controls write through the same `setSetting`.

**Tests:**
- [ ] Deferred to #step-7 (menu reachability asserted there).

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bunx vite build`
- [ ] In the running app: a Text card's pane shows the `…` button; Save is present and correctly gated; Editor Options opens the sheet and a setting change takes effect in that card only.

---

#### Step 3: Text card masthead; delete `TextCardTopBar`; relocate save state {#step-3}

**Depends on:** #step-2

**Commit:** `tugdeck(text-card): publish the document masthead, retire the top bar, seat the save state on the third line`

**References:** [P03] Save state third line, [P07] Content per card, Table T01, [Q02], Risk R01, (#text-card-facts, #existing-wiring)

**Artifacts:**
- Masthead payload in the Text card's title effect; `text-card-top-bar.tsx` deleted (+ its `text-card.css` block + import + mount); `saveText` relocated; status bar's save cell removed and props trimmed.

**Tasks:**
- [ ] Grow the existing title-sync `useLayoutEffect` in `text-card.tsx` to publish `{kind: "card-masthead", icon: "FileText", title, description, descriptionKind: "path", detail}` per Table T01 in the **same** `cardTitleStore.set` call as the string; untitled buffers publish `title: "Untitled"`, `description: null` instead of clearing.
- [ ] Move `saveText` out of `text-card-status-bar.tsx`; delete the save cell (`[data-testid="text-card-status-save"]`) and the now-unused props; keep the settable and number clusters byte-identical.
- [ ] Delete `text-card-top-bar.tsx`, its import/mount in `text-card.tsx`, and the `.text-card-top-bar*` rules in `text-card.css`. The masthead description is **inert** this phase (see the note under Table T01): reveal-in-Finder becomes a `Reveal in Finder` item in the card's `…` menu publish from #step-2 (present only for bound, non-draft files — the same `revealable` gate the top bar used).
- [ ] Verify the editor still fills the reclaimed row (`.text-card--editor` grid/flex accounts for the missing bar).

**Tests:**
- [ ] Unit: relocated `saveText` keeps its six wordings (port any existing unit coverage).

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bunx vite build`
- [ ] `grep -rn "text-card-top-bar\|TextCardTopBar" tugdeck/src` → only the gallery fixture (handled in #step-6) or nothing.
- [ ] In the running app: a bound Text card shows the 72px masthead with name/path/save-state; typing flips the third line to "Edited"; ⌘S saves and it reads "Saved: <time>"; the bottom status bar shows no save cell.

---

#### Step 4: File viewer masthead {#step-4}

**Depends on:** #step-1

**Commit:** `tugdeck(file-view-card): publish the document masthead`

**References:** [P07] Content per card, [P08] Kind-derived icon/detail, Table T01, [Q03], (#existing-wiring)

**Artifacts:**
- Masthead payload in `file-view-card.tsx`'s title effect; optional PDF page-count wiring from `PdfView`.

**Tasks:**
- [ ] Grow the title-sync effect: `{kind: "card-masthead", icon, title: basename(path), description: path, descriptionKind: "path", detail}` per T01/[P08]; `path === null` keeps the current `clear`.
- [ ] Kind label from `classifyFileKind` + extension; PDF page count if `PdfView` exposes it without contortion, else `"PDF"` and note [Q03].
- [ ] Publish a `Reveal in Finder` item via `paneTitleBarMenuStore` (the viewer's description line is inert this phase — see the note under Table T01).

**Tests:**
- [ ] Deferred to #step-7.

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bunx vite build`
- [ ] In the running app: open an image and a PDF in viewer cards; each wears the masthead per T01.

---

#### Step 5: Diff card masthead {#step-5}

**Depends on:** #step-1

**Commit:** `tugdeck(diff-card): publish the document masthead`

**References:** [P07] Content per card, Table T01 (Diff rows and notes), (#existing-wiring)

**Artifacts:**
- Masthead publish in `diff-card.tsx`'s title effect, gated on `phase === "ready" && !no_repo`.

**Tasks:**
- [ ] Extend the existing title effect: project guise publishes `"Project Diff"` + stat description + base detail; scoped guise publishes the file-scoped masthead while leaving the string channel's override-only-when-better rule intact ([P07]).
- [ ] Re-publish when the store snapshot's payload changes (subscribe is already in place for the body; the effect keys on the snapshot fields it reads).

**Tests:**
- [ ] Deferred to #step-7.

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bunx vite build`
- [ ] In the running app: the Project Diff card's masthead reads `N files · +A −R` under "Project Diff"; the bar is 36px until the payload lands, 72px after.

---

#### Step 6: Doctrine + gallery fixture updates {#step-6}

**Depends on:** #step-3, #step-4, #step-5

**Commit:** `tuglaws+tugdeck(gallery): record the three chrome tiers; retire the fixture's "nothing is wired" framing`

**References:** [P01]–[P08], (#documentation-plan, #gallery-after)

**Tasks:**
- [ ] `tuglaws/pane-model.md`: rewrite § "Chrome has two heights" as three tiers (36 / 72 / 32), naming the wearing cards, the pane-scoped height publication for all three, and that the rail's flush surface is a token-family change (`--tug7-element-global-*`).
- [ ] `tuglaws/design-decisions.md`: correct the stale width-control paragraph (it renders on every width-bearing pane; reverted by `1693707dc`); extend the masthead decision prose with the document tier and rail tier.
- [ ] `gallery-card-chrome.tsx`: docstring rewritten per (#gallery-after); the `TextCardTopBar` "today" row replaced (the component no longer exists); "as shipped" rows relabeled "before".

**Tests:**
- [ ] N/A (docs + fixture prose).

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bunx vite build` (the fixture edit compiles)
- [ ] `grep -n "does not render on a masthead-bearing" tuglaws/design-decisions.md` → nothing.

---

#### Step 7: App-test coverage {#step-7}

**Depends on:** #step-3, #step-4, #step-5

**Commit:** `tests(app-test): cover the document masthead and rail chrome tiers`

**References:** [P03], [P04], [P07], Table T01, (#test-plan-concepts, #success-criteria)

**Artifacts:**
- New `at####-card-chrome-tiers.test.ts` with `@covers` lines for `card-masthead.tsx`, `card-masthead.css`, `text-card.tsx`, `file-view-card.tsx`, `diff-card.tsx`, the `tug-pane.css` rail section, and the touched theme files' token.

**Tasks:**
- [ ] Text tier: seed a Text card bound to a real temp file; assert bar height 72, `card-masthead-title` = basename, `-description` ends with the basename (start-truncation), `-detail` = "Saved"-family text; type via the editor, assert `-detail` flips to "Edited"; assert `text-card-top-bar` absent and `text-card-status-save` absent; assert the `…` menu button exists.
- [ ] Rail tier: seed a deck with the Lens pinned; assert `.tug-pane[data-role="sidebar"]` exists, its `--tugx-pane-chrome-height` computes to 32px, the bar's `background-color` equals the pane's `--tugx-pane-bg` (compare computed values — WebKit reports `oklch()`), the title is the tracked uppercase form, and both stripe pseudo-bands render (assert the un-animated custom-property inks, not mid-transition colors).
- [ ] Regression: run `at0375-session-masthead` in the same selection and require its geometry diagnostics unchanged.
- [ ] `just app-test-covers-check` green with the new declarations.

**Tests:** (this step *is* the tests)

**Checkpoint:**
- [ ] `just app-test tests/app-test/at####-card-chrome-tiers.test.ts tests/app-test/at0375-session-masthead.test.ts` — VERDICT pass, at0375 diagnostics unchanged.
- [ ] `just app-test-covers-check`

---

#### Step 8: Integration checkpoint {#step-8}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all artifacts land together: rails, three document mastheads, no top bar, doctrine current.

**Tests:**
- [ ] The derived selection: `just app-test-changed` (answer a CORE TIER ADVISED advisory with `just app-test`, not the corpus).

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bunx vite build && bun run audit:theme-contrast`
- [ ] `just app-test-changed` — VERDICT pass.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Every shipping card wears its ratified chrome tier — document mastheads on Text/File viewer/Diff, racing-stripe rails on Lens/Jots/Gazette, the 36px bar everywhere else — with the Text card's chrome consolidated into the masthead + `…` menu and the doctrine telling the truth about all of it.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] All #success-criteria bullets verified (each names its own measurement).
- [ ] `at0375` diagnostics byte-identical to pre-plan (session masthead untouched).
- [ ] No references to `TextCardTopBar` outside git history.

**Acceptance tests:**
- [ ] `at####-card-chrome-tiers.test.ts` green.
- [ ] `just app-test-covers-check` green.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] [Q03] image dimensions + byte size on the File viewer's third line (an `ImageBlock` intrinsic-size callback).
- [ ] Actionable masthead descriptions: a per-card masthead-action channel (mirroring `paneTitleBarMenuStore`) wiring `CardMasthead`'s existing `onActivateDescription` prop, so a path click reveals in the Finder; this phase ships the description inert with Reveal in Finder in the `…` menu.
- [ ] Retiring `SHIPPED_THEME_NAMES`-adjacent unused session-tone tokens (noted in design-decisions; separate question).
- [ ] Any further document card (e.g. a future viewer kind) adopts by publishing a T01-shaped payload — no chrome work.

| Checkpoint | Verification |
|------------|--------------|
| Chrome substrate untouched | `git diff` shows no edits to `card-masthead.tsx`, `masthead-frame.css`, `session-masthead.*` beyond the one CSS relocation in [P04] |
| Themes complete | `grep -l "tug-rail-chrome-height" tugdeck/styles/themes/*.css` lists all six |
