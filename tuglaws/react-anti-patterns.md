# React Anti-Patterns

*Why the Laws of Tug diverge from standard React advice, and why the "best practices" taught in tutorials become anti-patterns at scale.*

*Cross-references: `[L##]` -> [laws-of-tug.md](laws-of-tug.md). `[D##]` -> [design-decisions.md](design-decisions.md).*

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

---

## Why this isn't standard advice

Several reinforcing reasons:

**Historical accident.** `useSyncExternalStore` shipped in React 18 (2022), years after the hooks mental model was established. The tutorials, courses, blog posts, and Stack Overflow answers were already written. The community's muscle memory was already formed around `useState` + `useEffect`. Rewriting all that pedagogy for a "new" hook that solves problems most tutorials never encounter? Nobody has the incentive.

**Selection bias in tutorials.** Tutorials teach small, self-contained examples. A counter. A form. A fetch-and-display. At that scale, `useState` + `useEffect` works fine. The pathologies only emerge when you have 15 pieces of coordinated state across 8 components responding to pointer events at 60fps. Nobody writes a tutorial for that.

**React's own messaging.** The React team's docs emphasize the `useState`/`useEffect` model as primary. `useSyncExternalStore` is documented but framed as an escape hatch for library authors, not as a core pattern. The "you might not need an effect" page exists but reads as remedial advice, not as the starting point. The meta-message is: effects are the default; avoiding them is the optimization.

**The framework incentive.** React's value proposition is "we manage the DOM for you." Telling developers "actually, for appearance changes, bypass React and mutate the DOM directly" (L06) undermines that pitch. It's correct engineering, but it's bad marketing. So it doesn't get promoted.

**Complexity privilege.** Most React applications are forms and dashboards. They never hit the scaling wall. The developers who *do* hit it — game UIs, creative tools, collaborative editors, anything with continuous gesture input — often solve it ad hoc and move on. The solutions don't get generalized into laws because each team thinks their problem is special.

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
