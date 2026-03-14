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

// happy-dom's SelectorParser uses `this.window.SyntaxError` to construct
// parse errors during querySelectorAll / getComputedStyle CSS sheet processing.
// The happy-dom Window instance does not expose SyntaxError as an own property,
// so `this.window.SyntaxError` resolves to undefined and crashes with:
//   "TypeError: undefined is not a constructor (evaluating 'new this.window.SyntaxError')"
// Patching it to the global SyntaxError restores the expected behavior so that
// querySelector/querySelectorAll work, and Radix UI's getComputedStyle calls
// (via react-remove-scroll-bar's getStyleSheets path) no longer crash.
if (!(happyWindow as any).SyntaxError) {
  (happyWindow as any).SyntaxError = SyntaxError;
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
