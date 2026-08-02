# The snippet editor's caret reveal waits on a frame and reaches through the substrate

*Found 2026-08-01 while making `block-reorder`'s settle [L13]-compliant. Not caused by that work — this predates it, and it is small, self-contained, and worth doing properly rather than in passing.*

## What is there now

`snippets-section.tsx`, in `SnippetEditorRow`'s `onChange`:

```ts
const onChange = useCallback(
  (text: string): void => {
    store.updateSnippet(snippet.id, text);
    requestAnimationFrame(() => {
      wrapRef.current
        ?.querySelector<HTMLElement>(".tug-text-editor-caret")
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  },
  [store, snippet.id],
);
```

The intent is right and worth keeping: a snippet editor grows uncapped and the Lens list is the single scroller, so a snippet taller than the rail makes the LIST scroll and nothing follows the caret there. Without a reveal, you type off the bottom of your own snippet.

## Three problems, in increasing order of how much they matter

**1. The frame is a guess at another module's schedule.** The `requestAnimationFrame` is waiting for CM6 to repaint `tugCaretLayer` — the caret is a div a CM6 *layer* extension paints during CM6's measure phase, so at `onChange` time it is still at the old position. This is not literally [L05], which names React state commits, but it is that law's shape: waiting a frame for someone else's DOM write instead of using the completion signal that module offers. CM6 offers one — `view.requestMeasure({ read })` runs in CM6's own measure cycle, which is the phase that moves the caret layer. A frame is an outside guess at when that will have happened. It is also, per [L13], not what rAF is for.

**2. It reaches through the substrate's private DOM.** `.tug-text-editor-caret` is `tug-text-editor`'s internal class, painted by `tugCaretLayer` and documented in `theme.ts`. A section reading it is the same failure as a host drawing another component's focus marks against its internal attributes (see the authoring contract in `tuglaws/focus-language.md`): the host now owns a copy of the substrate's internals, and the copy is what goes stale when the substrate moves. `TugMessageEditorHandle` exposes `restoreState` / `clear` / `focus` and nothing about revealing, which is the actual gap.

**3. `scrollIntoView("nearest")` is the wrong reveal for this app.** The Lens list has sticky band headers, and `"nearest"` happily parks its target underneath a stuck one — the gotcha `focus-reveal.ts`'s own docstring names, and the one the sticky-header reveal note records. So even when the frame lands correctly, a caret revealed near the top of the list can end up behind the band header. It also writes scroll directly rather than through a registered `Scroller` façade, so SmartScroll's next pin can undo it.

## Suggested remedy

Two candidates. They are not exclusive — the first is the smaller, safer fix, the second is where this should end up.

**A. Reveal through the engine's own primitive (small).** `revealFocusTarget(el)` (`components/tugways/focus-reveal.ts`) already does exactly the job correctly: minimum-delta, innermost-scroller-outward, insets the port by stuck sticky chrome, leaves room for the ring's halo, and releases follow-bottom through the `Scroller` façade first. Swapping `scrollIntoView` for it fixes problem 3 outright and costs one import. Problems 1 and 2 remain.

**B. The substrate owns its own caret reveal (correct).** Add a `revealCaret()` to `TugMessageEditorHandle`, implemented inside `tug-text-editor` where the caret layer lives, scheduled on CM6's `requestMeasure` rather than a frame, and resolving the element internally so no consumer needs to know the class name. The snippet row then calls `editorRef.current?.revealCaret()` from `onChange` and all three problems go at once. Worth checking during implementation whether CM6's own `EditorView.scrollIntoView` effect can carry it — CM6 walks ancestor scrollers, so it may handle the Lens list directly; if it does, prefer dispatching that effect over a hand-rolled scroll, but verify it clears the sticky band header, since that is the specific thing our own reveal exists to handle and CM6 knows nothing about.

Recommendation: do **B**, using `revealFocusTarget` as the implementation inside the substrate if CM6's effect turns out not to clear sticky chrome. Any consumer with an uncapped editor inside an outer scroller needs this, so it belongs to the substrate rather than to the Snippets section.

## Verifying it

The behavior is "type past the bottom of a tall snippet and the caret stays visible," which is a real-DOM claim about the LIST's scroll position, so it belongs in an app-test rather than a unit test. There is no gate on it today — the current implementation is unpinned, which is part of why it drifted.

A test should: open a snippet editor in the Lens, type enough lines that the snippet exceeds the rail, and assert the caret's rect sits inside the list's scrollport **and below the stuck band header's bottom** — that last clause is the assertion that would have caught problem 3, and asserting mere visibility would not. `@covers` must name `tug-text-editor` as well as the Snippets section once the reveal moves there.

One harness note carried over from the `block-reorder` work: a backgrounded app-test window runs **no** `requestAnimationFrame` at all. If the reveal stays frame-scheduled it will simply never run under the harness, and a test asserting it would fail for a reason that has nothing to do with the code being wrong in the real app. Another reason to move off the frame before writing the gate.
