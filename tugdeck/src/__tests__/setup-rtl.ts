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

// FileReader is provided by happy-dom but not exported to global by default.
if (typeof (global as any).FileReader === "undefined") {
  (global as any).FileReader = (happyWindow as any).FileReader ?? happyWindow.FileReader;
}

// File is provided by bun/happy-dom; ensure it's available.
if (typeof (global as any).File === "undefined" && (happyWindow as any).File) {
  (global as any).File = (happyWindow as any).File;
}

// Blob is provided by bun; ensure it's available.
if (typeof (global as any).Blob === "undefined" && (happyWindow as any).Blob) {
  (global as any).Blob = (happyWindow as any).Blob;
}

// URL.createObjectURL / revokeObjectURL are not provided by happy-dom.
// Provide minimal stubs so components using Blob download don't crash.
if (typeof (global as any).URL === "undefined") {
  (global as any).URL = {};
}
if (typeof (global as any).URL.createObjectURL !== "function") {
  (global as any).URL.createObjectURL = () => "blob:mock-url";
}
if (typeof (global as any).URL.revokeObjectURL !== "function") {
  (global as any).URL.revokeObjectURL = () => {};
}

// NodeFilter is required by Radix UI's Popover (and other primitives that use TreeWalker).
if (typeof (global as any).NodeFilter === "undefined" && (happyWindow as any).NodeFilter) {
  (global as any).NodeFilter = (happyWindow as any).NodeFilter;
}

// HTML element subtypes required by Radix UI focus management (aria-hidden, focus trapping).
const HTML_ELEMENT_SUBTYPES = [
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "HTMLAreaElement",
  "HTMLAudioElement",
  "HTMLVideoElement",
  "HTMLDetailsElement",
  "HTMLIFrameElement",
] as const;
for (const name of HTML_ELEMENT_SUBTYPES) {
  if (typeof (global as any)[name] === "undefined" && (happyWindow as any)[name]) {
    (global as any)[name] = (happyWindow as any)[name];
  }
}

// ResizeObserver is not provided by happy-dom
(global as any).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// DOMRect is not provided by happy-dom. Radix ContextMenu anchors its
// floating content at the click point via a virtual ref whose
// getBoundingClientRect() returns `DOMRect.fromRect(...)`, so without
// this polyfill any test that opens a TugContextMenu throws
// "ReferenceError: DOMRect is not defined". The polyfill is a minimal
// structural match — getters for left/top/right/bottom plus the
// fromRect() static — which is everything Radix + floating-ui actually
// read on the returned object.
if (typeof (global as any).DOMRect === "undefined") {
  class DOMRectPolyfill {
    x: number;
    y: number;
    width: number;
    height: number;
    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
    }
    get left(): number { return this.x; }
    get top(): number { return this.y; }
    get right(): number { return this.x + this.width; }
    get bottom(): number { return this.y + this.height; }
    static fromRect(other?: { x?: number; y?: number; width?: number; height?: number }): DOMRectPolyfill {
      return new DOMRectPolyfill(
        other?.x ?? 0,
        other?.y ?? 0,
        other?.width ?? 0,
        other?.height ?? 0,
      );
    }
    toJSON(): object {
      return {
        x: this.x, y: this.y, width: this.width, height: this.height,
        left: this.left, top: this.top, right: this.right, bottom: this.bottom,
      };
    }
  }
  (global as any).DOMRect = DOMRectPolyfill;
}

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

// happy-dom's internal DOM classes (HTMLElement, SelectorParser, etc.) use
// `this[PropertySymbol.window].SyntaxError` to construct parse errors during
// querySelectorAll / getComputedStyle / contentEditable processing.
//
// The VMGlobalPropertyScript that initialises window globals runs in a Node vm
// context where globalThis.SyntaxError is undefined under bun, so window.SyntaxError
// ends up undefined. The result is a crash:
//   "TypeError: undefined is not a constructor (evaluating 'new this.window.SyntaxError')"
//
// Fix: patch Window.prototype so every Window instance — including those created
// internally by happy-dom for portals, iframes, and cloned documents — inherits
// the real SyntaxError. We use Object.defineProperty to avoid accidentally
// overwriting a writable own property on the prototype with a simple assignment.
const WindowProto = Object.getPrototypeOf(happyWindow) as Record<string, unknown>;
if (!WindowProto["SyntaxError"]) {
  Object.defineProperty(WindowProto, "SyntaxError", {
    value: globalThis.SyntaxError,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}
// Also patch the instance's own undefined property so the value is visible
// immediately without traversing the prototype chain (the VM script sets it
// as an own enumerable property with value undefined).
if (!(happyWindow as any).SyntaxError) {
  (happyWindow as any).SyntaxError = globalThis.SyntaxError;
}

// Signal to React 19 that we are in an act() environment
(global as any).IS_REACT_ACT_ENVIRONMENT = true;

// Console output is globally suppressed by setup-silence.ts preload.
// React act() warnings from Radix UI (radix-ui/primitives#1822) are
// silenced as part of that blanket suppression.

// ---------------------------------------------------------------------------
// WAAPI mock -- happy-dom does not implement Element.prototype.animate.
// ---------------------------------------------------------------------------
//
// The mock captures all calls to el.animate(keyframes, options) and returns
// a fake Animation object with controllable .finished promise, .cancel(),
// .finish(), .commitStyles(), .persist(), .playState, and .effect.
//
// Access call records and helpers via `(global as any).__waapi_mock__`.
//
// Tests that need to control promise resolution should call:
//   const mock = (global as any).__waapi_mock__;
//   const [call] = mock.calls;
//   call.resolve();   // resolves .finished
//   call.reject();    // rejects .finished
//
// Tests should call mock.reset() in afterEach to clear call history.

export interface WaapiMockCall {
  el: Element;
  keyframes: Keyframe[] | PropertyIndexedKeyframes | null;
  options: KeyframeAnimationOptions | undefined;
  animation: MockAnimation;
  resolve: () => void;
  reject: (reason?: unknown) => void;
}

export interface MockAnimation {
  finished: Promise<void>;
  cancel: () => void;
  finish: () => void;
  commitStyles: () => void;
  persist: () => void;
  playState: AnimationPlayState;
  effect: { getComputedTiming: () => { duration: number } };
}

export interface WaapiMock {
  calls: WaapiMockCall[];
  reset: () => void;
}

const waapiMock: WaapiMock = {
  calls: [],
  reset() {
    this.calls = [];
  },
};

(global as any).__waapi_mock__ = waapiMock;

// Install mock on Element.prototype so all DOM elements use it.
// We set it on the happy-dom Element class that is already on global.
const ElementClass = (global as any).Element as typeof Element;
(ElementClass.prototype as any).animate = function (
  keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
  options?: number | KeyframeAnimationOptions
): MockAnimation {
  let resolveFinished!: () => void;
  let rejectFinished!: (reason?: unknown) => void;
  const finishedPromise = new Promise<void>((res, rej) => {
    resolveFinished = res;
    rejectFinished = rej;
  });

  const normalizedOptions: KeyframeAnimationOptions | undefined =
    typeof options === "number" ? { duration: options } : options;

  const animation: MockAnimation = {
    finished: finishedPromise,
    playState: "running" as AnimationPlayState,
    effect: {
      getComputedTiming() {
        return { duration: (normalizedOptions?.duration as number) ?? 0 };
      },
    },
    cancel() {
      (this as MockAnimation).playState = "idle" as AnimationPlayState;
      rejectFinished(new DOMException("Animation cancelled", "AbortError"));
    },
    finish() {
      (this as MockAnimation).playState = "finished" as AnimationPlayState;
      resolveFinished();
    },
    commitStyles() {
      // no-op in mock
    },
    persist() {
      // no-op in mock
    },
  };

  const call: WaapiMockCall = {
    el: this as Element,
    keyframes,
    options: normalizedOptions,
    animation,
    resolve: resolveFinished,
    reject: rejectFinished,
  };

  waapiMock.calls.push(call);
  return animation;
};
