# React Anti-Patterns

*Why the Laws of Tug diverge from standard React advice, and why the "best practices" taught in tutorials become anti-patterns at scale.*

*Cross-references: `[L##]` -> [laws-of-tug.md](laws-of-tug.md). `[D##]` -> [design-decisions.md](design-decisions.md).*

---

## Laws referenced in this document

This document argues against standard React patterns by reference to specific Laws of Tug. For the full list and their design-decision rationale, see [laws-of-tug.md](laws-of-tug.md). The laws cited here:

| Law | Rule |
|-----|------|
| **L02** | External state enters React through `useSyncExternalStore` only. |
| **L04** | Never measure child DOM inline after triggering child `setState` from a parent effect. |
| **L05** | Never use `requestAnimationFrame` for operations that depend on React state commits. |
| **L06** | Appearance changes go through CSS and DOM, never React state. |
| **L07** | Every action handler must access current state through refs or stable singletons, never stale closures. |

---

## The standard advice and where it comes from

The canonical React tutorial teaches a specific worldview:

1. **All state lives in `useState`/`useReducer`**
2. **State flows down through props**
3. **"Lift state up" when siblings need to coordinate**
4. **`useEffect` synchronizes React with the outside world**
5. **Every visual change should trigger a re-render**

This model has a seductive elegance. It's a pure function: `UI = f(state)`. You put state in, you get DOM out, React diffs and patches. It's easy to teach, easy to reason about in isolation, and it works beautifully for a blog, a settings form, a todo list.

The problem is that this model is *designed for documents, not applications*.

---

## Where it breaks down

As you add complexity — a slider that coordinates with a value input, a card frame that manages drag/resize geometry while its children manage their own content, a responder chain that routes keyboard events — the "standard" approach develops three compounding pathologies:

### 1. The cascade of re-renders

When all state lives in React, every state change re-renders. A slider thumb moving at 60fps means 60 `setState` calls per second, each triggering reconciliation of the entire subtree. The standard fix is `React.memo`, `useMemo`, `useCallback` — a defensive tax you pay on every component to compensate for the fact that you put state in the wrong place.

L06 cuts this off at the root: **appearance changes go through CSS and DOM, never React state.** Moving a slider thumb is a CSS `left` change. Toggling a hover highlight is a class toggle. These are free — zero reconciliation, zero diffing, zero risk of cascading re-renders. React never even knows they happened.

### 2. The stale closure trap

This is where "rules of hooks" violations come from. The standard model creates closures over state at render time. If you register an event handler that reads `value`, it captures `value` as of that render. When `value` changes, you need a new handler, which means re-registering, which means dependency arrays, which means `useEffect` cleanup chains, which means — if you get any dependency wrong — stale data or infinite loops.

L07 eliminates this entirely: **access current state through refs or stable singletons.** Your `useResponder` registers once at mount. The handler reads `valueRef.current` when it fires, not a closed-over snapshot. There are no dependency arrays to get wrong because there are no dependencies. The handler is stable. The ref is always current.

This is why you haven't hit a rules-of-hooks violation. The Laws of Tug don't fight the closure model — they *sidestep* it by not putting mutable state inside closures in the first place.

### 3. The synchronization problem

The standard advice says: when you have external state (a store, a WebSocket, a media query), copy it into React state via `useEffect`. This creates two sources of truth — the real state and React's copy — and a `useEffect` that runs *after* render to synchronize them. During that gap, your UI shows stale data. Worse, the sync effect triggers another render, and if multiple effects sync different pieces of external state, you get render cascades.

L02 replaces all of this with `useSyncExternalStore`, which lets React subscribe to external state *synchronously*. No copy. No effect. No gap. One source of truth, and React reads it at render time. The reason this law exists is that `useSyncExternalStore` is the *only* mechanism that gives React a synchronous read of external state with proper concurrent-mode support — but almost no tutorial teaches it because it doesn't fit the "useState for everything" narrative.

The synchronization problem has two further consequences that the standard model ignores entirely:

**L04: Never measure child DOM inline after triggering child `setState` from a parent effect.** The standard pattern is: parent effect sets child state, then immediately reads child DOM dimensions. But the child hasn't committed yet — its DOM is stale. The parent reads ghost geometry. The standard "fix" is to add another effect, another render cycle, another gap. L04 says: use a child-driven ready callback via `useLayoutEffect`. The child reports its own dimensions when *it* knows they're real.

**L05: Never use `requestAnimationFrame` for operations that depend on React state commits.** This is the other common workaround — "just wait a frame." But RAF timing relative to React's commit cycle is a browser implementation detail. It works on Chrome 120, breaks on Safari 17, works again on Firefox, breaks under concurrent mode. It's not a contract, it's a coincidence. L05 exists because every `requestAnimationFrame` used to paper over a React timing gap is a latent bug waiting for a browser update or a React version bump to expose it.

---

## The same component, two ways

Consider a slider with a coordinated value input — the user drags the thumb and the number updates, or types a number and the thumb moves. This is a common control. Here's how the standard approach builds it, and how the Laws of Tug build it.

### The standard way

```tsx
function Slider({ store }) {
  // Anti-pattern: copy external state into React state via useEffect
  const [value, setValue] = useState(store.getValue());

  useEffect(() => {
    // Sync external store → React state. Runs AFTER render,
    // so there's one frame where the UI shows the old value.
    const unsub = store.subscribe(() => setValue(store.getValue()));
    return unsub;
  }, [store]);

  // Every drag frame: setValue → re-render entire subtree
  const handleChange = useCallback(
    (e) => {
      const v = Number(e.target.value);
      setValue(v);        // triggers re-render
      store.setValue(v);  // two sources of truth
    },
    [store],             // dependency array — get it wrong, get stale store
  );

  // Input needs its own state to handle typing intermediate values
  const [inputText, setInputText] = useState(String(value));

  // Sync slider value → input text (another useEffect, another render)
  useEffect(() => {
    setInputText(String(value));
  }, [value]);

  const handleInputBlur = useCallback(() => {
    const parsed = Number(inputText);
    if (!isNaN(parsed)) {
      setValue(parsed);       // re-render
      store.setValue(parsed); // sync back
    }
  }, [inputText, store]);   // two more deps to track

  return (
    <div>
      <input type="range" value={value} onChange={handleChange} />
      <input type="text" value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        onBlur={handleInputBlur} />
    </div>
  );
}
```

Count the problems: two `useState`, two `useEffect`, three `useCallback` dependency arrays, two sources of truth (React state and the store), and a one-frame stale-data gap on every external update. Every drag frame re-renders the entire component. Add a label, ticks, icons, and a formatter, and the dependency graph becomes a web.

### The Laws of Tug way

```tsx
function Slider({ store }) {
  // L02: one source of truth, synchronous read, no copy
  const value = useSyncExternalStore(store.subscribe, store.getValue);

  // L07: stable handler, no dependency array, no stale closure
  const onValueChange = useCallback(
    (v: number) => store.setValue(v),  // store is a stable singleton
    [store],
  );

  // L06: Radix slider moves the thumb via DOM internally —
  // React only re-renders when the committed value changes.
  // TugValueInput manages its own editing state (typing doesn't
  // re-render the slider) and calls onValueCommit on blur/enter.
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

Zero `useEffect`. One source of truth. One `useCallback` with a stable dependency. The value input manages its own editing text internally and only calls back on commit — no cross-component state sync, no render cascade during typing. Radix handles thumb positioning in the DOM. React re-renders only when the committed value actually changes.

The difference isn't cosmetic. The standard version has six hooks and a latent stale-data bug. The Laws of Tug version has two hooks and no bugs to write.

---

## Why this isn't standard advice

Several reinforcing reasons:

**Historical accident.** `useSyncExternalStore` shipped in React 18 (2022), years after the hooks mental model was established. The tutorials, courses, blog posts, and Stack Overflow answers were already written. The community's muscle memory was already formed around `useState` + `useEffect`. Rewriting all that pedagogy for a "new" hook that solves problems most tutorials never encounter? Nobody has the incentive.

**Selection bias in tutorials.** Tutorials teach small, self-contained examples. A counter. A form. A fetch-and-display. At that scale, `useState` + `useEffect` works fine. The pathologies only emerge when you have 15 pieces of coordinated state across 8 components responding to pointer events at 60fps. Nobody writes a tutorial for that.

**React's own messaging.** The React team's docs emphasize the `useState`/`useEffect` model as primary. `useSyncExternalStore` is documented but framed as an escape hatch for library authors, not as a core pattern. The "you might not need an effect" page exists but reads as remedial advice, not as the starting point. The meta-message is: effects are the default; avoiding them is the optimization.

**The framework incentive.** React's value proposition is "we manage the DOM for you." Telling developers "actually, for appearance changes, bypass React and mutate the DOM directly" (L06) undermines that pitch. It's correct engineering, but it's bad marketing. So it doesn't get promoted.

**Complexity privilege.** Most React applications are forms and dashboards. They never hit the scaling wall. The developers who *do* hit it — game UIs, creative tools, collaborative editors, anything with continuous gesture input — often solve it ad hoc and move on. The solutions don't get generalized into laws because each team thinks their problem is special.

---

## What a React expert might claim

The arguments above have obvious counterpoints. A developer steeped in the standard model might push back. Here are some suppositions about the strongest possible objections and why they don't hold.

### "You're just reimplementing jQuery"

The claim: bypassing React to mutate the DOM directly (L06) throws away React's value proposition. You're back to manual DOM wrangling, imperative spaghetti, and the jQuery-era bugs React was invented to solve.

The counter: React was invented to solve the problem of *keeping the DOM in sync with data when the document structure changes* — adding rows to a table, swapping views, conditionally rendering components. That's tree reconciliation, and React is genuinely good at it. But a hover highlight doesn't change the tree. A slider thumb moving doesn't change the tree. A drag preview doesn't change the tree. These are *appearance* mutations — the same DOM node, different visual state. Routing them through React's reconciler is like using a database transaction to change a CSS color. The tool is real; the application is wrong.

The jQuery era was bad not because people touched the DOM, but because they had no model for *when* to touch it. The Laws of Tug provide that model: the zone architecture. Structure changes go through React. Appearance changes go through CSS/DOM. The boundary is explicit and enforced. That's not jQuery — it's a division of labor.

### "useSyncExternalStore is for library authors, not application code"

The claim: React's docs position `useSyncExternalStore` as a low-level primitive for state management libraries (Redux, Zustand, etc.). Application code should use `useState` and let the library handle the subscription plumbing.

The counter: this is a packaging decision, not a technical one. `useSyncExternalStore` does exactly one thing: it gives React a synchronous, tear-free read of external state. Whether you call it from a library or from your component, the mechanism is identical. The reason the React docs frame it as "for library authors" is that their pedagogical model assumes all state lives in React. If you accept that assumption, then yes, you'd only need `useSyncExternalStore` when wrapping a third-party store. But the assumption is the thing being challenged. When your architecture places state *outside* React by design, `useSyncExternalStore` is the primary state hook, not an escape hatch.

### "This doesn't scale to teams — you need conventions, not escape hatches"

The claim: the standard `useState`/`useEffect` model is predictable and teachable. Every React developer knows it. Introducing refs, DOM mutations, and external stores creates a higher learning curve and more ways for junior developers to make mistakes.

The counter: the standard model is easy to *start* with and hard to *scale* with. The Laws of Tug are the opposite. The zone architecture is a stricter convention than "put everything in useState" — it tells you exactly which mechanism to use for which kind of state change, and violations are visible in code review (an effect that syncs appearance state, a `useState` that tracks a value from an external store). The standard model's "predictability" is an illusion: it's predictable at the tutorial scale, but the moment you have 15 coordinated state variables and six effects syncing them, nobody can predict the render cascade. The Laws of Tug trade a shallow learning curve for a flat complexity curve. The standard model trades a flat learning curve for an exponential complexity curve.

### "React Server Components and the compiler will fix this"

The claim: the React team knows about these problems. React Server Components move data fetching out of effects. The React compiler (React Forget) will auto-memoize everything. The future of React solves these issues without abandoning the standard model.

The counter: Server Components address data *fetching*, not interactive state. A slider dragging at 60fps is not a server concern. The React compiler eliminates unnecessary re-renders from missing `useMemo`/`useCallback` — which is a real improvement, but it optimizes the *symptom* (wasted renders) rather than the *cause* (putting high-frequency appearance state in React). A compiler that perfectly memoizes a component that re-renders 60 times per second to move a slider thumb is still re-rendering 60 times per second. L06 makes it re-render zero times. No compiler closes that gap because the gap is architectural, not computational.

### "You're over-engineering for a problem most apps don't have"

The claim: most React applications are dashboards, forms, and CRUD interfaces. They don't have 60fps gesture interactions or cross-component coordination. The standard model is fine for 95% of apps.

The counter: this is true, and it's the most honest objection. If your app is a form, use `useState`. The Laws of Tug are not universal React advice — they're an architecture for applications that have *continuous interactive state*: creative tools, spatial interfaces, anything with drag, resize, real-time preview, or gesture-driven interaction. The problem isn't that the standard model is wrong for simple apps. The problem is that it's taught as *the only model*, so when developers do hit the complexity wall, they have no vocabulary for what's happening and no framework for solving it. They just add more effects, more memoization, more dependency arrays, and wonder why everything is getting worse.

---

## What the Laws of Tug actually represent

The Laws of Tug are a **zone architecture** for React. They draw explicit boundaries:

| Zone | Mechanism | React involvement |
|------|-----------|-------------------|
| Appearance (hover, drag preview, thumb position) | CSS / DOM mutation | None |
| Subscription (external stores, layout state) | `useSyncExternalStore` | Read-only at render |
| Registration (responders, selection boundaries) | `useLayoutEffect` at mount | One-time setup |
| Structure (what components exist, their props) | `useState` / props | Full React |

Standard React advice puts *everything* in the fourth row. The Laws of Tug say: only structural changes — adding/removing components, changing which card is open, switching modes — belong in React state. Everything else has a better home.

The reason this feels like a "secret" is that it requires understanding *what React is actually good at* (tree reconciliation) and deliberately *not using it* for things it's bad at (high-frequency mutations, cross-component coordination, synchronous event handling). That's a subtraction, not an addition — and programming culture overwhelmingly teaches by addition. "Here's a new hook to learn." "Here's a state management library." "Here's a pattern to add." The Laws of Tug say: **stop adding. Remove the state. Remove the effect. Remove the re-render. What's left is the actual UI.**

That's hard to teach in a tutorial. It's easy to experience after a few weeks of building with it.
