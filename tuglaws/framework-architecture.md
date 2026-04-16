# The Tug Framework Architecture

The tug framework is built for applications with *continuous interactive state*: developer IDEs, code editors, diff viewers, layout inspectors, debuggers, drag-and-resize canvases, property inspectors, and anything where the user drives the interface at input-event rate rather than waiting for it to respond between clicks. In apps like these the interface is alive *between* the user's discrete actions — cursors blink, selections extend, panels resize, minimaps track the viewport, autocomplete updates as the user types, inline diagnostics appear under code still being written, previews redraw in real time. The unit of interaction is the gesture, not the form submission; the interaction rate is set by input events, not by React's commit cycle.

This design target shapes every decision below. A framework tuned for forms and dashboards and a framework tuned for complex apps are not the same framework, and the choices documented here make the best sense when thought about against this complex-app target.

The framework doesn't rest on a single foundation. React handles tree reconciliation and composition; CSS and the DOM handle appearance; a responder chain routes typed actions through the components that own state. The goal is not to minimize React's involvement but to place each kind of work in the system designed for it.

---

## Contents

1. [**The zone architecture**](#1-the-zone-architecture-l24) — Three zones (appearance, local data, structure), each with one mechanism. The core model the rest of the document elaborates.
2. [**State: how data enters React**](#2-state-how-data-enters-react) — External state lives in stores, enters React through `useSyncExternalStore`, and is read from handlers through refs.
3. [**Events: how actions route**](#3-events-how-actions-route) — User input becomes typed actions that walk through a responder chain — a tree of state-owning components — until one of them handles the action.
4. [**Appearance: how visual changes happen**](#4-appearance-how-visual-changes-happen) — Visual changes go through CSS and DOM, not React state. Gesture previews snapshot state at gesture start and either commit or revert at gesture end.
5. [**Components: how they are built**](#5-components-how-they-are-built) — Every public component follows a uniform authoring guide. Consistency is the product.
6. [**Worked example: a slider**](#6-worked-example-a-slider) — A single component that exercises every zone: external state, stable handlers, DOM-moved thumb, independent value input.
7. [**What React handles for the framework**](#7-what-react-handles-for-the-framework) — Tree reconciliation, component composition, the React ecosystem, and concurrent rendering — the parts the framework relies on React for.
8. [**Working in the framework**](#8-working-in-the-framework) — Daily experience: features without complexity, no rules-of-hooks tangles, no event-handler tangles, fluid live preview, components that read top to bottom.
9. [**Design alternatives considered**](#9-design-alternatives-considered) — Common approaches that were considered and not used, each grounded in the section that established the chosen approach.
10. [**Acknowledgments and precedents**](#10-acknowledgments-and-precedents) — The prior art the framework was built from: Excalidraw, Cocoa / NeXTSTEP, and the web platform itself.

---

## Cross-References
- `[L##]` 🢂 [tuglaws.md](tuglaws.md) — the laws referenced throughout this document
- `[D##]` 🢂 [design-decisions.md](design-decisions.md) — the decisions those laws implement
- [responder-chain.md](responder-chain.md) — the event routing model introduced in §3
- [component-authoring.md](component-authoring.md) — the component conventions referenced in §5

---

## 1. The zone architecture [L24]

Every piece of state in an application built on the tug framework belongs to one of three zones. The zone determines the mechanism used to read, write, and observe that state.

| Zone | What belongs here | Mechanism |
|------|-------------------|-----------|
| **Appearance** | Hover highlights, drag previews, thumb position, gesture feedback, class toggles, transient visual state | CSS / DOM mutation — React is not involved |
| **Local data** | Component-scoped UI state that does not coordinate with anything outside the component: toggle flags, form-input edit buffers, collapsed/expanded state | `useState`, `useRef` |
| **Structure** | What components exist, subscriptions to external stores, responder registration, event routing | `useSyncExternalStore`, `useLayoutEffect` at mount, props and composition |

The zones are the architecture. Every law cited below exists to keep a specific kind of state in the right zone and to define the mechanism that zone uses.

The first important property of the zones is that appearance changes are invisible to React. Moving a slider thumb is a CSS custom property update. Toggling a hover state is a class toggle. These operations do not trigger reconciliation, do not run `useEffect`, and do not affect React's render cycle at all. That is by design: it means the cost of a visual change is the cost of the DOM mutation itself, with nothing added on top, and the render cycle is reserved for the changes React was built to handle.

The second property is that the structure zone has a single entry point for each kind of state. There is one mechanism for getting data from an external store into React, one mechanism for registering an event responder, and one mechanism for each other piece of the structure zone. No component has to decide between alternatives. The uniformity is what makes the framework teachable: the question "where does this state live?" has exactly one answer per kind of state, and the answer is determined by the zone, not by the component's preferences.

---

## 2. State: how data enters React

External state — anything that outlives a single component, coordinates across components, or comes from outside React — lives in a store and enters React through `useSyncExternalStore` [L02]. The store is a plain object with three members: a `subscribe(listener)` that returns an unsubscribe function, a `getSnapshot()` that returns the current value, and whatever methods mutate the state (`setValue`, `insert`, `move`). Snapshots are immutable — each mutation produces a new snapshot and notifies subscribers.

Components read from the store by calling `useSyncExternalStore(store.subscribe, store.getSnapshot)` during render. React subscribes on the component's behalf, reads the snapshot synchronously when it needs to render, and tears down the subscription when the component unmounts. There is no copy of the store's state inside the component, no `useEffect` to keep them in sync, and no gap between the store mutating and React seeing the change. React reads from the store directly, at render time, and the store is the one source of truth.

For current-value access outside the render path — inside an event handler, a responder action, a `requestAnimationFrame` callback — components read through a ref [L07]. The ref is populated by a layout effect that mirrors the current snapshot, or by a setter the handler owns. The rule is that refs hold values that are *always current*, written by a single well-known source. A handler reading `valueRef.current` is reading the value that exists *now*, not a snapshot captured at some previous render. Because the ref is always current, the handler itself is stable — it does not need to be re-created when state changes, does not need a dependency array, and does not close over stale data.

The combination — `useSyncExternalStore` for the render path, refs for the event path — gives every piece of external state a synchronous read with no sync gap and no stale closures. The component body becomes a linear function from state to DOM: subscribe, read, render. Event handlers become stable references that read current state on demand. Neither depends on dependency arrays, and neither has an opportunity to fall out of sync.

---

## 3. Events: how actions route

User input enters the framework as *typed actions*, not raw DOM events. A button emits `TUG_ACTIONS.CLOSE`. A slider emits `TUG_ACTIONS.SET_VALUE` with a numeric payload and a gesture phase. A keyboard shortcut binding emits `TUG_ACTIONS.SELECT_ALL` when ⌘A is pressed. The action is the semantic intent; the DOM event is the mechanism that produced it.

Actions route through the *responder chain* [L11], an event-routing model the framework borrows from Apple's Cocoa and UIKit, where it has been the standard for handling user input since NeXTSTEP in 1988. Readers whose background is web development are likely to be unfamiliar with the pattern by name: the DOM has its own event model — capture and bubble through the physical DOM tree — that plays an adjacent role at the level of raw events, but the responder chain operates one level higher. It routes *typed semantic actions* (`CUT`, `CLOSE`, `SET_VALUE`) rather than raw DOM events (`keydown`, `click`, `input`), and it walks through a tree of components that *own state* rather than the physical DOM tree. Components emit actions without knowing who will handle them; the chain finds the handler by walking upward from the point of interaction until it reaches a component that has registered a handler for the action. The starting point of the walk — usually the component the user is currently interacting with — is called the *first responder*.

In the tug framework, the chain is a tree of components linked by `parentId` references, walked from innermost to outermost when an action is dispatched. The walk stops at the first node that has registered a handler. A text editor handles `CUT` because its selection is what gets cut. A card handles `CLOSE` because it owns the close state. A canvas handles `CYCLE_CARD` because it owns the layout. The action finds its handler by walking up through the components that might own the relevant state, not by being wired through props, and a component participates in routing without its prop interface having to mention the actions it handles.

Responders register once at mount, in a `useLayoutEffect` [L03], with handlers that read current state through refs [L07]. Registration happens before any event can fire, which is why it must be a layout effect rather than a regular effect — regular effects run *after* paint, and the first pointer-down after mount can arrive before them. The layout-effect registration closes the gap: by the time the user can interact with the component, its handlers are in the chain.

Because handlers read through refs, the responder chain has no dependency arrays anywhere in it. A handler registered at mount continues to work for the component's entire lifetime, reading current state on every dispatch, and no re-registration is ever required. The chain is invisible to React's render cycle: dispatches do not cause re-renders, handlers do not capture state, and the only React involvement is the initial registration.

The mechanics — phase lifecycles, first-responder promotion, two-phase continuations, the `ActionEvent` shape — are documented in depth in [responder-chain.md](responder-chain.md). This section establishes the principle; that document establishes the contract.

---

## 4. Appearance: how visual changes happen

Every change that affects only how a component *looks* — not what components exist or what data they display — goes through CSS and DOM, never React state [L06]. Moving a slider thumb is a CSS custom property update. Highlighting a card under the pointer is a class toggle. Showing a drag preview is a `transform` on the ghost element. None of these operations call `setState`, and none of them enter React's render cycle.

The mechanism has two properties worth naming. First, the operations are free: the cost of a CSS mutation is the cost of the mutation itself, with nothing added for reconciliation or diffing. A component tree of any size can have pointer-rate appearance changes with zero render cost. Second, the operations are invisible to React: they do not appear in DevTools' component tree, do not fire in profiler flamegraphs, and do not compete with React's concurrent features for the main thread. When debugging appearance behavior, the browser inspector is the right tool; React DevTools is for the structure zone.

### Gesture previews [L08]

During a gesture — drag-to-resize a card, scrub a color, nudge an element with the mouse — appearance changes happen frame by frame at pointer rate. The framework handles this with `MutationTransaction`: at gesture start the transaction snapshots the affected CSS properties; during the gesture it applies pure appearance-zone mutations directly to the DOM; at gesture end it either commits (writing the final value to the store, which triggers React to update the structure zone) or reverts (restoring the snapshot).

The property of this model is that the entire gesture lifecycle lives in the appearance zone. React is not involved while the pointer is moving. The store receives exactly one update — the commit — at the end of the gesture, regardless of how many frames the gesture lasted. React renders once, when the committed value changes. The gesture itself runs at the browser's pointer-event rate with no React overhead and no render-cycle contention.

### Timing against React's render cycle [L04, L05]

Two rules exist to keep the appearance zone and the structure zone from colliding at the commit boundary.

[L04] prohibits measuring child DOM inline after triggering a child `setState` from a parent effect. The child's new state has not committed yet — the DOM reflects the previous render — and a parent effect that reads child dimensions immediately after setting child state will read ghost geometry. The correct mechanism is a child-driven ready callback: the child reports its own dimensions in a layout effect, when *it* knows they are real, and the parent reads from the report.

[L05] prohibits using `requestAnimationFrame` to paper over commit timing. RAF's relationship to React's commit cycle is a browser implementation detail — it works in one browser version, breaks in the next, works again in the version after, breaks under concurrent mode. It is not a contract. Any code that depends on "wait one frame and React will have committed by then" is a latent bug waiting for a browser or React update to expose it. When commit timing matters, the mechanism is a layout effect in the component whose commit you are waiting for, not a RAF callback in some parent that is guessing.

Both rules are about respecting the direction of React's render cycle: state flows down through commits, and anything that needs to react to a commit has to be *inside* the component that commits, not above it reading the DOM.

---

## 5. Components: how they are built

Every public component in the framework follows the conventions documented in [component-authoring.md](component-authoring.md). The short version:

- Two files per component: `tug-{name}.tsx` and `tug-{name}.css`, in `components/tugways/`.
- A module docstring that cites every law the component obeys.
- Props interface that extends the native HTML element props when wrapping a native element, with `@selector` annotations mapping props to CSS hooks.
- `React.forwardRef`, `data-slot="tug-{name}"` on the root, `className` via the `cn()` helper, `...rest` spread last.
- No React state for appearance. Visual changes go through CSS custom properties, classes, and data attributes.
- A `@tug-pairings` table in the CSS file declaring every foreground-on-background relationship the component creates.

The reason every component looks the same is that consistency is the product: an app built out of tug components has predictable keyboard behavior, predictable focus behavior, predictable theming hooks, and a uniform action vocabulary, and that predictability comes from the authoring guide being followed exactly. The component is the unit at which all the zones, laws, and conventions meet in code.

[component-authoring.md](component-authoring.md) is the canonical reference. When writing a component, use it as a checklist.

---

## 6. Worked example: a slider

A slider demonstrates every zone of the framework in one component. The slider reads its value from an external store, emits an action when the value changes, moves its thumb through DOM mutation, and coordinates with a numeric input that lets the user type values directly.

```tsx
function TugScaleSlider({ store }: { store: ScaleStore }) {
  // Structure zone: external state enters through useSyncExternalStore. [L02]
  const value = useSyncExternalStore(store.subscribe, store.getValue);

  // Structure zone: stable action handler. [L07]
  // store is a stable singleton, so onValueChange is stable for the
  // component's entire lifetime — no re-creation, no dependency churn.
  const onValueChange = useCallback(
    (v: number) => store.setValue(v),
    [store],
  );

  // Appearance zone: Radix moves the thumb through DOM internally. [L06]
  // React re-renders only when the committed value changes, which happens
  // once per gesture regardless of frame count. [L08]
  //
  // Local data zone: TugValueInput manages its own edit buffer internally
  // and only calls onValueCommit on blur/Enter — typing does not re-render
  // the slider.
  return (
    <div>
      <SliderPrimitive.Root value={[value]} onValueChange={onValueChange}>
        <SliderPrimitive.Track>
          <SliderPrimitive.Range />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb />
      </SliderPrimitive.Root>
      <TugValueInput value={value} onValueCommit={onValueChange} />
    </div>
  );
}
```

Two hooks. One source of truth. One stable callback. The slider's thumb moves through DOM mutation inside Radix; React never re-renders while the user is dragging. When the gesture commits, Radix calls `onValueChange`, the store mutates, subscribers are notified, and React reads the new value through `useSyncExternalStore` on the next render. The numeric input manages its own edit buffer (appearance plus local data) and only reports committed values back, so typing in the input does not re-render the slider and dragging the slider does not disturb the input's edit buffer.

Adding features to this slider adds markup and CSS, not state. Tick marks are positioned `div`s. A label is a `<span>`. A formatter is a function applied when the value input renders the display string. Each addition is inert to the render cycle — none of them add hooks, dependencies, effects, or sync logic. The slider's behavior scales with its surface area, not with its feature count.

---

## 7. What React handles for the framework

The framework uses React for what React is excellent at, and leans on that work heavily.

**Tree reconciliation.** React's core algorithm — diffing a virtual tree against the previous tree and patching the DOM with minimal structural mutations — is genuinely hard to do well and genuinely valuable. When a modal appears, a card gets added to a deck, a panel switches between views, or a list reorders, React handles the DOM insertions, removals, and reordering correctly, efficiently, and without the framework having to think about it. Every structural change in the interface flows through React for exactly this reason.

**Component composition.** JSX is a good model for describing UI structure. Components as functions from props to markup compose cleanly, and the ability to build compound components from primitives — `TugSlider` containing a `SliderPrimitive.Root` containing a `Track` and a `Thumb` — produces readable hierarchies. The framework embraces this: every tug component is a React component, and composition is the primary mechanism for building complex surfaces out of simple ones.

**The ecosystem.** Radix UI provides the accessible, unstyled primitives that tug components wrap. React DevTools, hot module replacement, error boundaries, and the broader React tooling ecosystem are mature and battle-tested. Choosing React means choosing an ecosystem, and that ecosystem is the deepest available for component-driven web UI.

**Concurrent rendering.** React 18+ introduced `useTransition`, `useDeferredValue`, and concurrent rendering — the ability to interrupt low-priority renders to keep the UI responsive. The tug framework runs React 19, which refines these features. They only work when React controls the render cycle, which is exactly the structure zone. By keeping appearance changes out of the render cycle entirely, the framework makes concurrent features more effective: there is less work competing for React's attention, so transitions and deferred values have room to breathe.

The framework's architecture places React's work where React is strongest and routes other kinds of work through mechanisms better suited to them. The result is that React does *less* work in a tug framework application than in a standard one, and the work it does is exactly what it was designed for.

---

## 8. Working in the framework

The zone architecture changes the daily experience of building components in specific ways.

**Components gain features without gaining complexity.** Adding tick marks to a slider is markup and CSS. Adding a label is a `<span>` and a `@selector` annotation. Adding a formatter is a function. None of these additions touch the render cycle, the store, or the responder chain. Each feature is local to its own CSS rule or its own piece of JSX, and the component's state graph does not grow with its feature count.

**Rules-of-hooks violations stop happening.** The rules of hooks exist because React needs hooks to be called in the same order on every render. In a tug component most state is not in hooks — it is in external stores, refs, and DOM attributes — so the conditional-logic patterns that trigger rules-of-hooks violations have very little hook state to interact with. The rules are still there; they stop being a factor in daily work.

**Event routing is a level of indirection components do not pay for.** A button does not know which component handles its action. A card does not need a prop for every possible keyboard shortcut. A canvas-level responder can catch anything the cards do not claim. Because the responder chain is registered at mount and reads through refs, no component pays a re-render cost for participating in event routing, and no component has to wire action plumbing through its prop interface.

**Live preview stays fluid regardless of tree complexity.** During a gesture, the `MutationTransaction` layer applies CSS mutations to the affected elements at pointer rate, with React uninvolved. The gesture's fluidity is determined by the cost of the CSS mutation, not by the size of the component tree above the element being manipulated. A drag inside a deeply-nested canvas runs as fast as a drag inside a flat page.

**Components read linearly.** A tug component reads top to bottom: subscribe to external state, define stable handlers, render markup. There are no inter-hook dependency graphs to trace. The component is a function from state to DOM, not a state machine entangled with its own side effects. A new contributor can open a component file and understand its behavior by reading it once.

---

## 9. Design alternatives considered

The framework arrived at its current shape after considering alternatives. Each of the choices below is a place where a more common approach exists, was considered, and was not used — in every case, for a technical reason that ties back to the design target and the mechanisms established in the preceding sections.

### 9.1 `useEffect` for external state synchronization

§2 places external state behind `useSyncExternalStore` [L02], which gives React a synchronous, tear-free read of the store during render. The alternative is the more common pattern: declare a `useState` for the external value, subscribe in a `useEffect`, and call `setState` when the store changes.

That pattern produces two sources of truth (the store and the React state copy) and a one-frame gap between the store mutating and React's copy catching up, because the sync `useEffect` runs *after* React has rendered. For a settings form, the gap is invisible. For a slider being dragged at 60fps, every frame is the gap: the user is always seeing a value that is one frame older than the store's actual state. `useSyncExternalStore` closes the gap by letting React read the store synchronously during render, and it does so with proper concurrent-mode tearing guarantees that the effect-based pattern does not provide.

### 9.2 Lifting state up and drilling callbacks down

§3 routes actions through the responder chain, with components registering handlers for the actions whose state they own. The alternative is lifting shared state to a common ancestor and drilling callback props down to the components that trigger state changes.

For a shallow tree with a few shared values, lifting is a reasonable pattern. For an interface with nested surfaces — a text editor inside a card inside a canvas — lifting collapses: every keyboard shortcut that might be handled by any of the three surfaces has to be wired through all three, and every component that might participate has to accept props for every action it might emit. The handler closures also capture state at render time, so the callbacks must be re-created whenever the lifted state changes, which cascades down through `useCallback` dependency arrays at every level. The responder chain inverts this: a component emits an action without knowing who handles it, and the chain finds the handler by walking through the components that own the relevant state. Zero prop drilling, zero dependency arrays, zero re-registration on state change.

### 9.3 `React.memo` / `useMemo` / `useCallback` as cascade control

§4 keeps appearance changes out of the render cycle entirely [L06], so there are no cascading re-renders to memoize around. The alternative is to put appearance state in React (slider value, hover state, drag position) and then apply memoization to prevent the resulting re-renders from cascading through the tree.

Memoization is a real optimization when it is needed. But in the tug framework's model it is not needed for appearance changes, because appearance changes do not enter the render cycle in the first place. A component that drags a slider thumb 60 times per second through CSS mutation re-renders zero times; a fully-memoized equivalent that put the thumb position in `useState` would still re-render 60 times per second, just with less work per render. The difference between "render faster" and "do not render" is the difference between an optimized hot path and no hot path at all. Memoization still applies where it belongs — expensive derived values in the structure zone — but it is not a defensive tax paid on every component.

### 9.4 `requestAnimationFrame` for commit timing

§4 prohibits using RAF to wait for a React commit [L05]. The alternative is the common workaround for "the DOM I just asked React to update is not updated yet" — schedule a RAF callback, hope React has committed by the time it fires, and read the DOM then.

RAF's timing relative to React's commit cycle is a browser implementation detail. It works on one Chrome version, breaks on the next, works in Firefox, breaks under concurrent mode, works again after a React minor release. Code that depends on RAF-after-setState is a latent bug waiting for any of those to change. When commit timing matters, the correct mechanism is a layout effect *inside* the component whose commit is being waited for — a layout effect runs synchronously after the component commits, with contract guarantees from React, and no assumptions about how the browser schedules frames. The layout-effect model is documented, tested, and stable; the RAF model is a coincidence that happens to work most of the time.

### 9.5 Inline event handlers over closure-captured state

§2 and §3 register handlers once and read current state through refs [L07]. The alternative is the tutorial-standard pattern: write `onClick={handleClick}` inline, where `handleClick` is a `useCallback` with a dependency array containing every piece of state it reads.

The inline pattern has two failure modes that compound as the component grows. The first is the dependency array: a missing dependency gives stale reads, an extra dependency causes handler re-creation on unrelated state changes, and a wrong dependency shape causes either. The second is the re-creation cascade: every time the handler is re-created, any child that received it as a prop re-renders, which requires `React.memo` on the child to prevent the cascade, which requires the handler to be stable, which requires the dependency array to be exactly right. The ref-based model eliminates both: the handler is registered once, reads current state on dispatch, and is never re-created. There is no dependency array to get wrong because there are no closure-captured dependencies.

### 9.6 Copying external values into React state as a general practice

§2 reads external state directly through `useSyncExternalStore` and does not copy it anywhere. The alternative is the common pattern of having each component hold a `useState` copy of any external value it displays, kept in sync via subscribing effects.

The copy-everywhere pattern creates a rendering invariant problem: each copy has its own update timing, and components that display the same external value can render at different times with different cached copies, producing tearing. React 18's concurrent rendering makes this worse by interleaving renders across components. `useSyncExternalStore` exists specifically because React's internal rendering model needs a tearing-free mechanism to read external state, and application code that bypasses it with the copy pattern inherits all of the tearing problems the hook was designed to solve. When the framework is built on external stores as a primary state model, using the hook designed for external stores is simpler than working around its absence.

### 9.7 `useSyncExternalStore` as a library-author primitive

A common framing in React's documentation is that `useSyncExternalStore` is a low-level primitive meant for state-management library authors (Redux, Zustand, MobX adapters), and application code should use `useState` and `useEffect` and let the library handle subscriptions.

That framing is a packaging decision, not a technical one. The hook does exactly one thing regardless of who calls it: it gives React a synchronous, tearing-free read of an external store. The framework's decision to place state outside React by design (§2) makes `useSyncExternalStore` the primary state hook rather than an escape hatch. The library-author framing assumes the standard model where all state lives in React and only occasionally reaches outside; the tug framework's model inverts that assumption, and the hook's role inverts with it.

### 9.8 Relying on the React compiler to optimize re-renders

A forthcoming mitigation for the re-render-cascade problem is the React compiler (formerly React Forget), which auto-memoizes component subtrees and reduces the need for manual `useMemo` and `useCallback`. One possible approach would be to wait for the compiler, write components in the standard style, and let optimization happen automatically.

The compiler addresses the cost of wasted renders, not the existence of renders. A component that re-renders 60 times per second to move a slider thumb, optimized by the compiler, still re-renders 60 times per second — each render is cheaper, but the render itself still happens. §4's approach is to not render at all during the gesture: the thumb moves through DOM, and React's render cycle is not involved. A compiler, however good, cannot optimize a render that does not happen into a render that happens faster. The gap between the two approaches is architectural, not computational, and it does not close with better memoization.

### 9.9 Direct DOM mutation as a return to jQuery

A fair question about §4 is whether routing appearance changes through CSS and DOM undoes the value proposition React was invented for: managing the DOM so application code does not have to.

The answer is a division of labor. React was invented to solve the specific problem of *keeping the DOM in sync with data when the document structure changes* — inserting rows into a list, swapping views, conditionally rendering components. That is tree reconciliation, and §7 describes why the framework relies on React for it. A hover highlight does not change the tree. A slider thumb moving does not change the tree. A drag preview does not change the tree. These are same-node appearance mutations, and the framework routes them through CSS/DOM for that reason, not because DOM manipulation is preferable in general. The difficulty of the jQuery era was not that developers touched the DOM but that there was no architectural model for *when* to touch it. The zone architecture provides that model: structure changes go through React, appearance changes go through CSS/DOM, and the boundary is explicit and enforced.

---

## 10. Acknowledgments and precedents

The tug framework was shaped by studying specific prior art, and several of the core mechanisms are named or patterned after systems that solved the same problems in other contexts. The debts that matter most to this document are listed below. For the full list of adopted code and the copyright notices each one requires, see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

### Excalidraw — zones, subscribable stores, gesture bypass

The zone architecture described in §1, the external-store pattern in §2, and the gesture-bypass model in §4 were all informed by a deep study of [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT licensed). The specific debts:

- **Subscribable store pattern.** Excalidraw's `Scene` class is a plain mutable object that React components subscribe to and read during render, with manual subscription wiring. It is the closest open-source precedent for the tug framework's store pattern. Excalidraw predates widespread `useSyncExternalStore` adoption; the tug framework formalizes the same principle through React's dedicated API.
- **Bypass React during the gesture, sync on commit.** Excalidraw handles canvas drag interaction imperatively during the gesture and only updates React state on completion. That principle is the architectural ancestor of the `MutationTransaction` snapshot/commit model described in §4 — the tug framework formalizes it as L08 with explicit snapshot, commit, and revert semantics, but the idea of routing the gesture entirely around React originated with Excalidraw's architectural study.
- **Separate contexts by domain.** Excalidraw uses multiple narrow React contexts (`useApp`, `useAppProps`, `useExcalidrawElements`, etc.) rather than one monolithic context. The tug framework achieves the same separation through per-store `useSyncExternalStore` subscriptions, but the validation that narrow-context separation works at scale came from reading Excalidraw's source.
- **Typed-action dispatch.** Excalidraw's action system unifies keyboard shortcuts, toolbar buttons, and context menus into a single `Action` interface with `perform`, `keyTest`, and `predicate` fields. The tug framework's action vocabulary borrows the typed-action idea from that precedent, though it routes actions through a responder chain rather than Excalidraw's central registry.

The three-zone model (§1) was not derived from Excalidraw alone, but the separation of appearance-zone gesture work from structure-zone commits was, and the rest of the architecture is built on top of that separation. The debt is deep enough that the zone architecture should not be understood as having been invented for the tug framework; it should be understood as having been *adapted* from Excalidraw's precedent into a form that fits the tug framework's broader design target.

### The Cocoa / NeXTSTEP responder chain

The responder chain described in §3 is an adaptation of a pattern that has been standard in Apple's application frameworks since NeXTSTEP shipped it in AppKit in 1988, carried through Cocoa, UIKit, and — in adapted form — SwiftUI's focus system. The concept has earlier prior art: Smalltalk-80's MVC framework (1980) had a notion of events walking through a view hierarchy, and X11 (1984) had event propagation at the window-system level. But NeXT made the chain a first-class architectural pattern with explicit rules: events enter at the first responder, walk the chain, and either get handled or fall off the end. The tug framework adopts that model wholesale, with the adjustment that its dispatch currency is typed actions rather than AppKit's `NSEvent` objects or Cocoa selector calls. The gesture phase model documented in [responder-chain.md](responder-chain.md) is patterned on Apple's `UIGestureRecognizer.State`.

No code is adopted from Cocoa or AppKit — the debt is architectural. The framework's responder chain is an original React implementation of a pattern the web platform does not otherwise provide.

### The web platform

The framework also depends on patterns the web platform itself provides and that this document treats as given. React's tree reconciliation (§7) is the foundation the structure zone is built on. React's concurrent rendering primitives (§7) are what the structure zone's lightness is supposed to enable. The DOM's native capture/bubble event model is the substrate the responder chain sits on top of rather than replaces. [Radix UI](https://www.radix-ui.com/) supplies the accessible, unstyled primitives that tug components wrap — every interactive component in the framework leans on Radix for keyboard handling, ARIA semantics, and focus management, and those behaviors would be prohibitively expensive to reimplement correctly. These dependencies are runtime rather than adopted code, but they shape the framework's design as much as the historical precedents do.

---

## Appendix: Laws referenced

*Full text of every Tuglaw cited in this document. Quoted from [tuglaws.md](tuglaws.md) — consult that file for the authoritative version if the two differ.*

<a id="l02"></a>
### L02. External state enters React through `useSyncExternalStore` only.

No `useState` + manual sync. No `useEffect` copying external values into React state. [D40, D68]

<a id="l03"></a>
### L03. Use `useLayoutEffect` for registrations that events depend on.

Responder nodes, selection boundaries, and any setup that keyboard/pointer handlers require must be complete before events fire. [D41]

<a id="l04"></a>
### L04. Never measure child DOM inline after triggering child `setState` from a parent effect.

The child's DOM is stale until its own commit. Use a child-driven ready callback via `useLayoutEffect`. [D78]

<a id="l05"></a>
### L05. Never use `requestAnimationFrame` for operations that depend on React state commits.

RAF timing relative to React's commit cycle is a browser implementation detail, not a contract. Use the ready-callback pattern (L04). [D79]

<a id="l06"></a>
### L06. Ephemeral appearance state goes through CSS and DOM, never React state.

State whose only consumer is rendering and whose only purpose is to look a certain way — hover highlights, focus rings, active-press feedback, `data-state` toggles — belongs in the DOM. Class toggles, attribute changes, and style mutations that don't affect React's subtree are free. Use them.

This law does not apply to semantic data that happens to have a visual representation. Data is state that non-rendering code reads and acts on; rendering is a downstream consequence of the data, not the reason it exists. Examples: a form field's current value, the selected item in a list, a card's title, a user's zoom level. Data flows through React's render cycle because that is how controlled components and derived UI work — that is the contract, not an L06 violation.

The test: *does any non-rendering consumer depend on this state?* If yes, it is data and may live in React. If no — if the only thing that reads it is the renderer itself — it is appearance and belongs in the DOM. Get this test wrong in either direction and things break: data pushed into DOM refs becomes invisible to the code that cares about it; ephemeral visual state pushed through React triggers unnecessary re-renders and subtree invalidations. [D01, D03, D84, D13]

<a id="l07"></a>
### L07. Every action handler must access current state through refs or stable singletons, never stale closures.

`useResponder` registers actions once at mount. If a handler reads a value that changes over time, it must go through a ref. [D09, D11]

<a id="l08"></a>
### L08. Live preview in mutation transactions is appearance-zone only; commit crosses zone boundaries.

A *mutation transaction* is the specific UX pattern where the user begins an interaction that *drafts* a change, sees the draft rendered live against the target, and then either commits the draft (persisting it) or cancels it (rolling back). The defining feature is that the draft value is not yet a committed value — it exists only long enough to be previewed, and the user may discard it. Examples: scrubbing a hue onto a mock card, dragging to reposition a draggable element, dragging an opacity slider in a style inspector.

During the draft phase, all preview mutations are CSS/DOM — the draft is not React state because it may never be committed. The commit handler may write to stores or React state; cancel rolls back via DOM. Never mix preview with state changes.

This law does not apply to continuous controls whose every intermediate value *is* a committed value. Such interactions are not mutation transactions: there is no draft-vs-commit distinction, only a stream of atomic commits. Their values flow through React state normally, the same as any other data. Examples: a volume slider, a font-size stepper, a choice group, a color picker used as a setting editor rather than as a preview tool. The phase system (`begin` / `change` / `commit` / `discrete` / `cancel`) enables mutation-tx usage where needed — it does not require it, and the presence of phased dispatches does not by itself turn a value picker into a mutation transaction.

The test: *can the user end the interaction with a result that was never committed?* If yes, it is a mutation transaction and L08 applies — preview belongs in the DOM. If no — if releasing, committing, or disconnecting always leaves the last seen value as the committed value — it is not a mutation transaction and L08 does not apply. [D64, D65]

<a id="l11"></a>
### L11. Controls emit actions; responders own state that actions operate on.

A *control* translates a user gesture into a typed intent and dispatches it into the chain — the state that handlers will modify lives elsewhere (a parent, a store, a separate component). A *responder* owns persistent semantic state that actions mutate over time and registers handlers for the actions that mutate it. Responders have a stable identity in the chain so the first-responder promotion mechanism can address them.

The distinction is conceptual, not categorical: it is about *who owns the state an action changes*, not about what kind of widget the component happens to be. The test is, "does this component own the state that this action is going to mutate?" If no, the component is an emitter — it can dispatch the action but another node owns the state, so another node is the responder. If yes, the component must register as a responder because it is the only code that knows how to perform the action on its own state.

Most interactive widgets are controls: their state lives in a parent that passes it back in via props. When such a widget interacts with the user, it dispatches an action whose handler — somewhere up the chain — updates the parent's state, which flows back down. The widget itself holds no authoritative state. Push buttons, sliders, checkboxes, switches, radio groups, choice groups, tab bars, accordions, and popup menus are all examples of this shape.

A component that owns its own state is a responder for the actions that mutate that state. A component that owns a caret, a selection, an undo stack, and a content document is a responder for `cut` / `copy` / `paste` / `selectAll` / `undo` / `redo` — those actions operate directly on state that lives inside the component and nowhere else. A component that owns a window and its contained document is a responder for `close` / `find` / `toggleMenu`. A component that owns a layout tree is a responder for `cycleCard` / `resetLayout`. Text editors, cards, and canvases are examples of this shape.

A single component may be both an emitter and a responder for the same action. A text editor with a context menu dispatches `cut` when the user clicks the menu item; the chain's innermost-first walk routes that dispatch right back to the editor, which handles it on its own selection. Components that own state close the loop on themselves. [D08, D61, D62, D63]

The full chain mechanism — `ActionEvent`, the dispatch walk, first-responder promotion, the four dispatch shapes, `observeDispatch`, the keyboard pipeline, and the registration hooks — is documented in [responder-chain.md](responder-chain.md). Read that document before writing a component that participates in the chain.

<a id="l24"></a>
### L24. State is partitioned into three zones: appearance, local data, and structure.

Every piece of state belongs to exactly one zone, and the zone determines its mechanism. *Appearance* (visible-only state with no non-rendering consumer): CSS and DOM mutation, never React. *Local data* (component-scoped state that does not coordinate outside the component): `useState` and `useRef`. *Structure* (what components exist, subscriptions to external stores, responder registration, event routing): `useSyncExternalStore`, `useLayoutEffect` at mount, props and composition. L06 enforces the appearance zone; L02 and L07 govern the structure zone's entry points; L08 and L22 govern the boundaries between zones. This law names the architecture those laws collectively produce.

