# Persistence Reliability

Live investigation captured 2026-04-22. Tracks the full story of a persistence regression discovered that morning, the instrument-first diagnosis that located it, a rejected paper-over fix (Path A), an architectural fix (Path B, shipped), a follow-up selection-ownership fix, and the outstanding issues that remain open.

This document is the working memory for everything persistence-related until the final threads close. The companion formal plan lives in `tugplan-tide-card-polish.md` under Step 5.5.c Commit 1A; that section is now out of date relative to this document and should be updated once the outstanding issues converge.

## Status dashboard (as of 2026-04-22, after `8de575c4`)

| Surface | Reload / relaunch | Hide → unhide | Resign → become active (once) | Resign → become active (twice) |
|---|---|---|---|---|
| Scroll position | ✓ | ✓ | ✓ | ✓ |
| `TugPromptEntry` text content | ✓ | ✓ | ✓ | ✓ |
| `TugInput` / `TugTextarea` text content | ✓ | ✓ | ✓ | ✓ |
| `TugPromptEntry` selection | ✓ | ✗ | ✓ | ✗ (first cycle works, second fails) |
| `TugInput` / `TugTextarea` selection | ✗ (text restored, selection not) | ✗ | ✗ | ✗ |
| Focus restoration | ✗ (not handled at all) | ✗ | ✗ | ✗ |

**Summary:** data payloads (scroll, content, input values) are preserved across every transition we've tested. **Selection is not, in broad and specific ways, across most transitions.** Focus is not handled anywhere. The selection gap is not a single bug but a **concept gap** — see Part 7.

## Commits shipped so far

- `dae7ca51` — Initial Commit 1A plan (since superseded by the instrument-first rewrite).
- `819357aa` — Instrument save/restore pipeline (nine `[probe:*]` log points) + instrument-first plan rewrite.
- `d70ee0d8` — **Path B.** Drive card restore from triggers, not effect deps. Deletes `useCardContentRestore`; moves content restore into `registerPersistenceCallbacks` and scroll/selection restore into a `hostContentEl`-keyed `useLayoutEffect`. Removes all `[probe:*]` instrumentation. Net −351 lines.
- `07ec7df9` — Narrow selection-ownership (content-case cards restore selection only via `onContentReady`; no-content cards via `hostContentEl` effect). Add this reliability doc.
- `8de575c4` — DOM-authority input persistence (`data-tug-persist-value` on `TugInput` / `TugTextarea`, `CardHost` save/restore scoped to card subtree) + become-active / unhide selection re-apply wire in `action-dispatch.ts`. Gallery inputs wired as worked examples.

**Next commit wave will follow the `tugplan-selection.md` plan** — a full selection-and-focus subsystem that replaces the patchwork described in Part 7 below.

---

## Part 1 — How we got here

### The regression report (2026-04-22)

User observed that text content in text inputs, text areas, `TugPromptInput`, `TugPromptEntry`, text selections in those widgets, and card scroll positions were no longer preserved across app reload / relaunch. Introduction window was unknown — could have been any time over the preceding weeks.

An earlier draft of the investigation anchored suspicion on Commits 0 / 1 / 1b (the pane-activation-listener work, `df004681` / `5c178f46` / `f2de80c6`). That was a guess, not a finding, and was explicitly withdrawn once the logs proved the save/restore pipeline is architecturally decoupled from those commits.

### Instrument-first diagnosis

Rather than bisect (expensive — each trial costs a full app quit + relaunch), nine `[probe:*]` log points were added spanning every stage of the save/restore pipeline:

1. `[probe:register]` / `[probe:unregister]` — `card-host.tsx:157` at save-callback registration / unregistration.
2. `[probe:save]` — `card-host.tsx:142` on `saveCurrentCardStateRef.current()` fire.
3. `[probe:visibilitychange]` — `deck-manager.ts:158`.
4. `[probe:beforeunload]` — `deck-manager.ts:170`.
5. `[probe:saveAndFlushSync]` — `deck-manager.ts:926` (Swift quit path).
6. `[probe:flush]` — `deck-manager.ts:900`.
7. `[probe:put]` — `settings-api.ts:121` tugbank XHR.
8. `[probe:boot]` — `main.tsx` after `readCardStates`.
9. `[probe:restore]` — `use-card-content-restore.ts:72`.

A single repro at HEAD (type `PROBE_MARKER_17`, scroll, quit, relaunch) produced pre-quit and post-launch logs that isolated the failing stage in one run.

### Root cause

The save path worked end-to-end. The failing stage was restore:

```
[probe:restore] cardId=b34f613e hasBag=true bagKeys=content,scroll,selection
                hasContentEl=false hasPersistenceCallbacks=false
```

On cold mount:
1. `CardHost` renders with `hostContentEl = null` (the pane-content-registry has not yet registered the element — `TugPane`'s `useLayoutEffect` runs in a later commit).
2. `CardHost` renders with `persistenceCallbacksRef.current === null` because the child content component (e.g., `TugPromptEntry`) has not yet mounted. The child does not mount until either (a) the content factory runs, which is gated on `feedsReady`, and (b) the `CardPortal` has a host to portal into.
3. `useCardContentRestore`'s `useLayoutEffect` fires once with deps `[cardId, hostStackId]`, both prerequisites absent, takes the no-persistence branch (which has no content-restore path), and is never re-fired.

Restoration had been gated on React's reconciler happening to fire the right effect at the right time. The prerequisites arrive in an order React's dep arrays don't see, so the effect fires exactly once in the wrong state and gives up.

This was latent for some time — likely since `b536a5f8` (the extraction of `useCardContentRestore` on 2026-04-21). Dormant during HMR-heavy development because HMR keeps the child mounted across code edits and the "first cold launch" timing doesn't reset.

---

## Part 2 — The fixes

### Path A (rejected, reverted)

First attempt added a `persistenceVersion` state counter to `CardHost` bumped on non-null registration, expanded `useCardContentRestore`'s deps to `[cardId, hostStackId, hostContentEl, persistenceVersion]`, and guarded with a `restoredForRef` to prevent double-restore. Also changed the `useCardPersistence` cleanup to pass `null` instead of a no-op pair so CardHost could distinguish cleanup from real registration.

**Why rejected.** Still fundamentally "restore happens because React eventually re-runs an effect." It works because the dep array happens to re-evaluate after the right sequence of renders, but that is the same class of solution that failed originally — just more layered. Failure modes that remain:

- If `CardPortal` changes timing, or `useSyncExternalStore` batches differently, it breaks again.
- HMR may leave `restoredForRef` stale across module reloads.
- Cross-pane move re-application semantics are implicit in dep-change cascades rather than explicit in code.
- Violates L22 spirit (store observers drive DOM directly, not through dep-array round-trips) and L10 (restore spread across `useLayoutEffect`, dep comparisons, and a ref gate).

User's reaction: "This sounds like the *worst kind* of React crap, the exact type of behavior that tuglaws have been defined to combat and avoid." Agreed. Reverted.

### Path B (shipped — `d70ee0d8`)

Restore is trigger-driven, not React-dep-gated. Each slice is owned by the layer that owns the target state, and fires at the layer's own deterministic moment:

**Content restore** — fires imperatively inside `registerPersistenceCallbacks(callbacks)`. The child's own `useLayoutEffect` is the trigger; the child's mount moment *is* the "ready to restore" signal. No effect, no deps, no ref gate. For bags with content, the harness installs `callbacks.onContentReady` (applies scroll/selection once the child re-renders with restored state) and calls `onRestore(bag.content)`.

**Scroll / selection restore** — fires in a `useLayoutEffect` keyed on `[cardId, hostStackId, hostContentEl, store]`. Re-fires when the host element appears or changes (cross-pane move, pane re-registration). Idempotent. For content-less bags, this is the only restore path. For bags with content, this provides a best-effort pre-commit scroll apply; `onContentReady` re-applies the correct clamp after the child commits (scroll-after-content ordering matters because pre-commit content height may clamp scroll low).

**Deletions from Path B.** `useCardContentRestore` hook — removed entirely. `tugdeck/src/__tests__/use-card-content-restore.test.tsx` — removed (5 tests that covered the hook directly, superseded by the new imperative path and the existing `card-host-composition.test.tsx`). Barrel export removed. All `[probe:*]` instrumentation removed.

### Selection-ownership follow-up (uncommitted)

After Path B landed, the tide-card repro showed scroll ✓ and content ✓ but selection ✗. Diagnosis: both the `hostContentEl` `useLayoutEffect` *and* `onContentReady` were attempting `selectionGuard.restoreSelection`. The early attempt fires against a DOM where the prompt-input's text nodes don't yet exist (`pathToNode` fails silently); then the child's `onRestore → setState` re-renders and may invalidate any partial state; then `onContentReady` re-applies.

The conflict is the two paths fighting for ownership of the same operation. The fix narrows ownership:

- **Content-case** (`bag.content !== undefined`): selection restore happens *only* via `onContentReady`. The `hostContentEl` `useLayoutEffect` skips selection in this case.
- **No-content case**: selection restore happens in the `hostContentEl` `useLayoutEffect`.

Scroll still applies in both paths for content-case cards (pre-commit best effort + post-commit clamp), which is idempotent.

Awaiting user verification on the tide-card repro before commit.

---

## Part 3 — Outstanding issues

### Issue A — `TugPromptInput` selection lost on hide / unhide and on resign-active → become-active

*New observation from the user (2026-04-22).* After the selection-ownership fix:

- App reload: selection restored ✓
- App relaunch (quit + relaunch): selection restored ✓
- App hide → unhide: selection NOT restored ✗
- Click away to another app → click back (resign-active → become-active): selection NOT restored ✗

**What's different about these paths.** The hide/unhide and resign-active/become-active paths do NOT tear down the React tree or re-mount `CardHost`. The prompt-input stays mounted. `registerPersistenceCallbacks` does not re-fire. `onContentReady` does not re-fire. `useLayoutEffect` on `[hostContentEl]` does not re-fire. None of the existing restore triggers fire for these transitions.

**Why selection disappears at all.** Likely a browser-level behavior: WKWebView / browsers may clear the DOM selection when the window loses key status or when the webview is hidden. macOS behavior: native text selection tints gray when a window is inactive and may be cleared entirely on hide.

**Possible approaches:**

1. **Observer on `applicationDidBecomeActive` / `applicationDidUnhide`** that re-applies the last-saved selection to the currently-active card. Already have `appLifecycle.observeApplicationDidBecomeActive` and related events. Add a subscriber that calls `selectionGuard.restoreSelection(activeHostStackId, lastSavedSelectionForActiveCard)`. The save already fires on resign (via the existing save-on-resign wire in `action-dispatch.ts:486`), so the saved selection should be current at become-active time.
2. **Selection-watch ref in memory**, independent of the tugbank-persisted `bag.selection`. On visibilitychange or resign, capture the current DOM selection into a ref. On visibilitychange-visible or become-active, re-apply from the ref.
3. **Don't save/restore; prevent the loss.** If we can identify which browser-level event is clearing the selection, we might block it (similar to the `selectstart` gate in `selectionGuard`).

Option 1 is the most aligned with the existing architecture. It reuses the save-on-resign path and adds a symmetric restore-on-activate. This also generalizes — any other state that should survive hide/unhide cycles could subscribe to the same event.

Note: the content state (text) does not appear to be affected by hide/unhide. The user confirmed text content is preserved. So this is narrowly a selection-preservation issue tied to how the browser treats text-selection state when the window loses focus.

### Issue B — `TugInput` and `TugTextarea` content / selection not preserved

`TugInput` (`tug-input.tsx`) and `TugTextarea` (`tug-textarea.tsx`) are plain wrappers around native `<input>` and `<textarea>` elements. Neither calls `useCardPersistence`. Neither is a controlled component by default — the value lives only in the DOM. Cards that use them (gallery-input, gallery-textarea, etc.) also do not register persistence.

This is a gap — text was never saved in the first place, so no amount of restore-path fixing helps. Needs an opt-in persistence mechanism.

**Approaches on the table (discussed with user):**

1. **`persistKey` prop.** `<TugInput persistKey="..." />` causes the component to register a small `useCardPersistence`-mediated slice keyed by `persistKey` within the card's bag. Clean, explicit, but every call site must add the prop.
2. **DOM-authority capture via `data-tug-persist-value`** *(user's chosen path)*. At save time, `CardHost` walks `hostContentEl.querySelectorAll('[data-tug-persist-value]')` and snapshots each element's `.value`, `.selectionStart`, `.selectionEnd`, `.scrollTop` by its key. At restore time, reapplies. Opt-in via attribute. Works for any native `<input>` / `<textarea>` in any tree. Aligns with L22 (DOM is authority for native input state) and matches the existing `data-no-activate` / `data-responder-id` convention.
3. **Automatic for all native inputs.** Brittle — identity by DOM index breaks on any restructure. Rejected.

**User has chosen approach 2.** Implementation sketch:

- Each `TugInput` / `TugTextarea` exposes a `persistKey` prop. When set, the rendered element carries `data-tug-persist-value={persistKey}`.
- `CardHost`'s `saveCurrentCardStateRef` gains a new slice: walk `hostContentEl.querySelectorAll('[data-tug-persist-value]')`; for each, capture `{ value, selectionStart, selectionEnd, selectionDirection, scrollTop, scrollLeft }` keyed by the attribute value. Merge into the bag under a new field (e.g., `bag.domInputs`).
- Restore: in the `hostContentEl` `useLayoutEffect`, re-apply to any matching elements. Opt-in, so no bag impact for cards that don't use it.

Open questions:
- Does this coexist with `useCardPersistence`'s content field, or replace it for simple inputs? (Coexist — they're for different kinds of persistence targets.)
- Where does the `persistKey` identifier get scoped? (Per-card; uniqueness within one card content tree.)
- How does it interact with cross-pane moves? (Should Just Work — CardHost is the stable identity; the slice travels with it.)

### Issue C — `selectionGuard.pathToNode` shape-fragility (latent)

`selectionGuard.restoreSelection(cardId, saved)` resolves `saved.anchorPath` via `pathToNode(boundary, saved.anchorPath)`. The path is a sequence of child indices into the DOM tree. If the DOM tree shape differs between save and restore, `pathToNode` returns null and restoration silently no-ops.

This is load-bearing for the tide-card case because tide messages are session-restored via `restoreTideSessions` on boot, and the order / timing of frame arrivals can change the DOM shape relative to save time. For selections in static content, this is fine; for selections inside dynamic content, it's fragile.

No immediate action; documenting as a known shape-sensitivity. A more robust design would use semantic anchors (e.g., data attributes on message containers) rather than positional paths, but that is a selectionGuard-internal refactor with its own scope.

### Issue D — `tugplan-tide-card-polish.md` Step 5.5.c Commit 1A is out of date

The Commit 1A section of the main plan still reflects the instrument-first hypothesis framing from `819357aa`. It needs to be updated to reflect:

- Path A rejected and reverted.
- Path B shipped as `d70ee0d8`.
- Selection-ownership fix (pending commit).
- Outstanding issues A–C.

Action: revise once Issues A and B are resolved so the plan captures the final architecture.

---

## Part 4 — Approaches on the table

Ordered roughly by priority:

1. **Issue A fix — selection restore on activate/unhide.** Lowest-lift path is Option 1 (subscriber on `observeApplicationDidBecomeActive` / `observeApplicationDidUnhide` that re-applies last-saved selection for the active card). Reuses save-on-resign. Small diff.

2. **Issue B fix — `data-tug-persist-value`.** Implement approach 2 above. Touches `card-host.tsx` (save + restore slices), `tug-input.tsx`, `tug-textarea.tsx`, layout-tree types, gallery cards (add `persistKey` where desired), tests. Moderate-size commit.

3. **Commit the selection-ownership follow-up** once user confirms tide-card selection restore is working. Small commit.

4. **Update `tugplan-tide-card-polish.md` Commit 1A section** to reflect final architecture. Doc-only.

5. **Defer Issue C.** Document-only; no code action now.

---

## Part 5 — Hook audit

The user asked: "Why was `useCardContentRestore` the only hook that was bad? How do we know the others aren't similarly fragile?" Honest per-hook assessment below, using the same critical lens that located the original regression.

### `useCardPropertyStore`

**Safe.** Returns `{ register, ref }` where `register` is a stable `useCallback([])` that writes to a ref. No effects, no deps, no timing-dependent behavior. The only failure mode is "no one calls `register`," which is a feature-presence question (no property store installed for this card), not a data-loss bug.

### `useCardFeedStore`

**Safe.** Uses `useSyncExternalStore` to subscribe to a live `FeedStore`. This is L02's canonical shape ("external state enters React through `useSyncExternalStore` only"). The data it surfaces *is* the live external store — there is no saved-state-to-re-apply step. After reload: the feed re-subscribes and the store's current snapshot becomes the value. No restore step, no race.

### `useCardDirtyState`

**Weak but not data-losing.** Installs `scroll` + `selectionchange` listeners in a `useEffect` (post-paint) keyed on `[hostContentEl, markDirty]`. Events between mount and post-paint are missed — but that only costs the "you're dirty" signal, which drives the *auto-save debounce*. The reliability-critical save path (`beforeunload`, `visibilitychange`, `saveAndFlushSync`, `saveAndFlush`) iterates `saveCallbacks` and calls each directly; it does not depend on the dirty bit. A missed early event costs at most "the last few seconds of scroll weren't auto-saved before a crash," not "your text is gone." The reliability-critical path doesn't touch this hook.

### The save path itself (not a hook, worth naming)

**Tuglaw-aligned.** `saveCurrentCardStateRef.current = () => {...}` is rewritten every render (L07: read at fire time, no stale closure). `registerSaveCallback(cardId, () => saveCurrentCardStateRef.current())` runs in `useLayoutEffect([cardId, store])`, fires on mount, unregisters on unmount. Save triggers iterate `saveCallbacks` and invoke them. Each invocation reads the latest ref. No dep-array timing, no race.

### Why `useCardContentRestore` was the fragile one

The general shape that fails is **critical, one-shot data application gated on React's reconciler firing an effect at the right time**. Each surviving hook has a different shape:

- `useCardPropertyStore` — no effect, no timing.
- `useCardFeedStore` — live subscription, no restore step.
- `useCardDirtyState` — non-critical signal (missed events don't lose data).
- Save path — fires on explicit triggers (quit, hide, etc.), not on reconciler behavior.

`useCardContentRestore` was the only hook that moved critical, one-shot, user-data across a reload boundary via a dep-array fire. That pattern is the one to flag. None of the other hooks fit it.

### General principle this surfaces

Any hook that moves *critical, one-shot, user-data* across a reload boundary must be **trigger-driven (imperative at the hand-off moment), not React-dep-driven**. Path B applies this to content restore. The principle should be propagated in tuglaws if it isn't already — it's arguably a corollary of L22.

---

## Part 6 — Log of sessions

- **2026-04-22 AM** — user reports regression. Initial scoping pass pre-anchored on Commits 0/1/1b; subsequently withdrawn.
- **2026-04-22 midday** — `dae7ca51` commits the initial plan. Subsequently revised to instrument-first.
- **2026-04-22 early afternoon** — `819357aa` commits instrumentation + revised plan. User runs repro; logs pinpoint `useCardContentRestore` as the failing stage.
- **2026-04-22 mid afternoon** — Path A implemented, tested, and user push-back ("paper-over"). Path A reverted.
- **2026-04-22 late afternoon** — `d70ee0d8` commits Path B. User verifies: scroll ✓, text ✓, selection ✗.
- **2026-04-22 evening** — `07ec7df9` selection-ownership; `8de575c4` DOM-authority input persistence + become-active / unhide selection wire; gallery cards wired as worked examples.
- **2026-04-22 late evening** — user reports four new selection failure modes (enumerated in Part 7). Conceptual gap diagnosed. User calls for a complete, top-to-bottom selection system plan and authorizes stopping all other work to build it. This part of the doc + `tugplan-selection.md` produced.

---

## Part 7 — The selection-and-focus concept gap

This part captures the user-reported failure modes that surfaced immediately after `8de575c4`, the correct diagnosis of each, and the conceptual model we have been missing. The implementation plan lives in its own document: **`tugplan-selection.md`**.

### The four new failure cases (all observed on `8de575c4`)

**Case α — `TugPromptEntry` / `TugInput` / `TugTextarea`, hide then unhide: selection gone.** User types and selects; `Cmd-H`; unhide; selection is not visible.

**Case β — `TugInput` / `TugTextarea`, Cmd-Tab away and back: selection gone.** Single cycle. Native form-control selection does not come back.

**Case γ — `TugPromptEntry`, Cmd-Tab away and back, *twice*: first cycle restores, second cycle loses.** The asymmetry is the tell: the first on-screen selection is user-made, the second is programmatic, and WebKit handles the two differently on resign.

**Case δ — `TugInput` / `TugTextarea`, reload: text restored, selection lost.** `setSelectionRange` on an unfocused element stores the range internally but does not paint the highlight. We never restore focus.

### The concept gap

Our code has been conflating **three distinct things** under the single word "selection":

1. **DOM selection** — `window.getSelection()`, a singleton range anchored at nodes in the document tree. Handled by `selectionGuard` via `pathToNode`.
2. **Form-control selection** — `<input>`/`<textarea>` own `selectionStart`/`selectionEnd`. Invisible to `window.getSelection()`, irrelevant to `selectionGuard`. **Visibility on screen requires focus on that element.**
3. **Focus** — which element is active. Selection in a form control is invisible without focus. Selection in the DOM is grayed (but still exists) when the window lacks key status. Not tracked anywhere in our code today.

### Why each failure mode happens, precisely

**Case δ (reload, `TugInput`/`TugTextarea`).** The `domInputs` restore calls `setSelectionRange(start, end)` correctly. But on an unfocused element this stores the range internally without painting the highlight. We never restore focus, so selection is invisible. The state *is* there; the browser doesn't render it.

**Cases α and β (hide/unhide or Cmd-Tab, any form control).** On `didResignActive` the save calls `selectionGuard.saveSelection(hostStackId)`, which inspects `window.getSelection()`. A selection inside an `<input>` / `<textarea>` is **not** in `window.getSelection()` — it lives in `el.selectionStart/End`. So `bag.selection` is `null`. `domInputs` does capture start/end at save time, but on `didBecomeActive` our `restoreActiveCardSelection` only reads `bag.selection` (null) and early-returns. Form-control selection is never restored. Even if it were restored, without focus (Case δ's mechanism) it would still be invisible.

**Case γ (repeated Cmd-Tab, `TugPromptEntry`).** First cycle: the user's hand-made DOM selection is preserved by WebKit on resign, our save captures it, `selectionGuard.restoreSelection` on become-active calls `setBaseAndExtent` — selection re-appears. The on-screen selection is now **programmatic**. Second cycle away: resign-active fires, save reads `window.getSelection()`, but WebKit's handling of programmatic selections on resign differs from user-made ones — the range may already be torn down before the save reads it, or the DOM tree may have shifted under the stored paths. Save writes null-or-wrong; become-active restores nothing-or-broken.

**Case α for `TugPromptEntry`.** Hybrid of Case γ and an ordering question: `didHide` may not trigger a save at all (we save on `didResignActive`, and the order of resign-active vs. did-hide on Cmd-H is unreliable); and even if it does, the `didUnhide` restore hits the programmatic-selection degradation of Case γ.

### What a coherent concept looks like

One module — call it a **`SelectionKeeper`** — owns the entire concept:

- **A snapshot is a tagged union**: `{ kind: "dom", ... }` or `{ kind: "form-control", persistKey, start, end, direction }` or `{ kind: "none" }`.
- **Focus is part of the saved state**: `{ focusKey } | null`.
- **One capture method** — called at any save trigger — walks the active card's subtree, identifies what kind of selection exists and where focus lives, returns one snapshot.
- **One apply method** — called at any restore trigger — reads the snapshot, re-focuses the element if needed, applies the appropriate selection kind.
- **Skip-if-already-correct before programmatic apply** — avoids Case γ's programmatic-overwrite degradation by not replacing a correct selection.
- **Save on `willResignActive` and `willHide`**, not `did*` — captures before WebKit starts tearing down selection visibility.
- **Textual-anchor fallback** when positional paths fail to resolve — addresses Issue C's shape-fragility.

### Where this plan lives

The full design and implementation plan is in **`tugplan-selection.md`**. That document replaces Issue A (hide/unhide restore) and Issue C (pathToNode fragility) in this doc — they are absorbed into the unified plan — and subsumes the `8de575c4` partial wire (the become-active subscriber will be re-routed through the new `SelectionKeeper.apply`, and `domInputs` will stop carrying selection fields).

Issue B (`TugInput`/`TugTextarea` content persistence via `data-tug-persist-value`) has already shipped as a non-selection concern and stays as-is. The new plan extends it with a parallel `data-tug-focus-key` attribute.
