/**
 * RTL test setup for bun test + happy-dom.
 *
 * This file must be the FIRST import in RTL test files so it sets up DOM
 * globals before @testing-library/react evaluates react-dom/client.
 *
 * Usage: add `import "./setup-rtl";` as the first line of each RTL test file.
 *
 * NOTE on bun worker isolation: bun 1.3.9's `preload = ["happy-dom"]` does not
 * fully isolate global state between test workers. Some test files (e.g.,
 * e2e-integration.test.ts) set global.navigator = { clipboard: ... } without
 * a userAgent property. This leaks to subsequent workers and causes react-dom's
 * DevTools detection IIFE (which calls navigator.userAgent.indexOf()) to throw.
 * setup-rtl.ts merges a valid userAgent into the existing navigator object to
 * ensure react-dom's initialization code never throws, regardless of run order.
 */
import { Window } from "happy-dom";
import "@testing-library/jest-dom";

const happyWindow = new Window({ url: "http://localhost/" });

// Ensure navigator.userAgent is always a valid string.
// Merge into the existing navigator (preserving properties like clipboard)
// rather than replacing it entirely, to avoid breaking state from other tests
// that may share the same worker's global scope.
const existingNav = (global as any).navigator;
if (!existingNav || typeof existingNav.userAgent !== "string") {
  (global as any).navigator = Object.assign(
    existingNav || {},
    { userAgent: happyWindow.navigator.userAgent,
      language: "en-US",
      languages: ["en-US"] }
  );
}

// Set core DOM globals required by @testing-library/react and react-dom.
(global as any).window = happyWindow;
(global as any).document = happyWindow.document;
(global as any).location = happyWindow.location;
(global as any).HTMLElement = happyWindow.HTMLElement;
(global as any).Element = happyWindow.Element;
(global as any).Node = happyWindow.Node;
(global as any).NodeList = happyWindow.NodeList;
(global as any).Event = happyWindow.Event;
(global as any).CustomEvent = happyWindow.CustomEvent;
(global as any).MouseEvent = happyWindow.MouseEvent;
(global as any).KeyboardEvent = happyWindow.KeyboardEvent;
(global as any).FocusEvent = happyWindow.FocusEvent;
(global as any).InputEvent = happyWindow.InputEvent;
(global as any).MutationObserver = happyWindow.MutationObserver;
(global as any).DocumentFragment = happyWindow.DocumentFragment;
(global as any).Range = happyWindow.Range;
(global as any).DOMParser = happyWindow.DOMParser;
(global as any).getComputedStyle = happyWindow.getComputedStyle.bind(happyWindow);

// ResizeObserver is not provided by happy-dom
(global as any).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// requestAnimationFrame / cancelAnimationFrame are not provided by happy-dom.
// Terminal card and other animation-based components use these APIs.
// Provide a synchronous fallback that calls the callback immediately so
// effects that debounce via RAF complete within act() boundaries.
if (typeof (global as any).requestAnimationFrame !== "function") {
  let rafId = 0;
  const pendingCallbacks = new Map<number, FrameRequestCallback>();
  (global as any).requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = ++rafId;
    pendingCallbacks.set(id, cb);
    // Schedule via setTimeout(0) so act() can flush it
    setTimeout(() => {
      const fn = pendingCallbacks.get(id);
      if (fn) {
        pendingCallbacks.delete(id);
        fn(performance.now());
      }
    }, 0);
    return id;
  };
  (global as any).cancelAnimationFrame = (id: number): void => {
    pendingCallbacks.delete(id);
  };
}

// Signal to React 19 that we are in an act() environment
(global as any).IS_REACT_ACT_ENVIRONMENT = true;

// Suppress React act() warnings from Radix UI internal animations.
// Radix Presence/Popper components schedule deferred state updates that
// cannot be wrapped in act() from test code. This is a known upstream
// issue (radix-ui/primitives#1822).
const _origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("was not wrapped in act(")) {
    return;
  }
  _origConsoleError.call(console, ...args);
};
