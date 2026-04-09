/**
 * useResponder hook tests -- Step 2.
 *
 * Tests cover:
 * - Mount: register is called
 * - Unmount: unregister is called
 * - Two-level nesting: child parentId is parent's ID
 * - Three-level nesting: grandparent > parent > child chain links
 * - No sibling re-renders on mount/unmount
 * - ResponderScope has stable identity across re-renders
 * - Throws descriptive error outside a ResponderChainProvider
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React, { useState } from "react";
import { describe, it, expect, mock } from "bun:test";
import { render, act } from "@testing-library/react";

import { ResponderChainContext, ResponderChainManager, ResponderNode } from "@/components/tugways/responder-chain";
import type { ActionEvent, ActionHandler } from "@/components/tugways/responder-chain";
import type { TugAction } from "@/components/tugways/action-vocabulary";
import { useResponder } from "@/components/tugways/use-responder";

// Test helpers: synthetic action names for chain-mechanics tests.
const asActions = (a: Record<string, ActionHandler>) =>
  a as unknown as Partial<Record<TugAction, ActionHandler>>;
const asAction = (name: string) => name as unknown as TugAction;

// ---- Helpers ----

/**
 * Create a manager and a context wrapper for it.
 */
function makeManagerAndWrapper() {
  const manager = new ResponderChainManager();
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ResponderChainContext.Provider value={manager}>
        {children}
      </ResponderChainContext.Provider>
    );
  }
  return { manager, Wrapper };
}

/**
 * A simple component that registers as a responder and optionally renders children.
 */
function ResponderComponent({
  id,
  actions,
  children,
}: {
  id: string;
  actions?: Record<string, () => void>;
  children?: React.ReactNode;
}) {
  const { ResponderScope } = useResponder({ id, actions });
  return <ResponderScope>{children ?? <div data-testid={id} />}</ResponderScope>;
}

// ---- Tests ----

// ============================================================================
// register on mount
// ============================================================================

describe("useResponder – register on mount", () => {
  it("calls manager.register when component mounts", () => {
    const { manager, Wrapper } = makeManagerAndWrapper();
    const registerSpy = mock(manager.register.bind(manager));
    manager.register = registerSpy;

    act(() => {
      render(
        <Wrapper>
          <ResponderComponent id="root" />
        </Wrapper>
      );
    });

    expect(registerSpy).toHaveBeenCalledTimes(1);
    const node = registerSpy.mock.calls[0][0] as ResponderNode;
    expect(node.id).toBe("root");
    expect(node.parentId).toBe(null);
  });

  it("registered node becomes first responder (root node)", () => {
    const { manager, Wrapper } = makeManagerAndWrapper();

    act(() => {
      render(
        <Wrapper>
          <ResponderComponent id="root" />
        </Wrapper>
      );
    });

    expect(manager.getFirstResponder()).toBe("root");
  });
});

// ============================================================================
// unregister on unmount
// ============================================================================

describe("useResponder – unregister on unmount", () => {
  it("calls manager.unregister when component unmounts", () => {
    const { manager, Wrapper } = makeManagerAndWrapper();

    // Attach the spy before rendering so the useEffect closure captures it.
    const unregisterSpy = mock(manager.unregister.bind(manager));
    manager.unregister = unregisterSpy;

    let unmount!: () => void;
    act(() => {
      ({ unmount } = render(
        <Wrapper>
          <ResponderComponent id="root" />
        </Wrapper>
      ));
    });

    act(() => {
      unmount();
    });

    expect(unregisterSpy).toHaveBeenCalledTimes(1);
    expect(unregisterSpy.mock.calls[0][0]).toBe("root");
  });

  it("node is removed from manager after unmount", () => {
    const { manager, Wrapper } = makeManagerAndWrapper();

    let unmount!: () => void;
    act(() => {
      ({ unmount } = render(
        <Wrapper>
          <ResponderComponent id="root" />
        </Wrapper>
      ));
    });

    expect(manager.getFirstResponder()).toBe("root");

    act(() => {
      unmount();
    });

    // Dispatch should return false -- node no longer in chain
    expect(manager.dispatch({ action: asAction("anything"), phase: "discrete" })).toBe(false);
    expect(manager.getFirstResponder()).toBe(null);
  });
});

// ============================================================================
// Two-level nesting: child parentId is parent's ID
// ============================================================================

describe("useResponder – two-level nesting", () => {
  it("child's parentId is the parent responder's ID", () => {
    const { manager, Wrapper } = makeManagerAndWrapper();
    const registeredNodes: ResponderNode[] = [];
    const origRegister = manager.register.bind(manager);
    manager.register = (node: ResponderNode) => {
      registeredNodes.push(node);
      origRegister(node);
    };

    act(() => {
      render(
        <Wrapper>
          <ResponderComponent id="parent">
            <ResponderComponent id="child" />
          </ResponderComponent>
        </Wrapper>
      );
    });

    expect(registeredNodes.length).toBe(2);
    const parent = registeredNodes.find((n) => n.id === "parent");
    const child = registeredNodes.find((n) => n.id === "child");
    expect(parent?.parentId).toBe(null);
    expect(child?.parentId).toBe("parent");
  });

  it("dispatch walks up from child to parent", () => {
    const { manager, Wrapper } = makeManagerAndWrapper();
    let parentHandled = false;

    function ParentComponent({ children }: { children: React.ReactNode }) {
      const { ResponderScope } = useResponder({
        id: "parent",
        actions: asActions({ bubbled: (_event: ActionEvent) => { parentHandled = true; } }),
      });
      return <ResponderScope>{children}</ResponderScope>;
    }

    function ChildComponent() {
      const { ResponderScope } = useResponder({ id: "child", actions: {} });
      return <ResponderScope><div /></ResponderScope>;
    }

    act(() => {
      render(
        <Wrapper>
          <ParentComponent>
            <ChildComponent />
          </ParentComponent>
        </Wrapper>
      );
    });

    manager.makeFirstResponder("child");
    const handled = manager.dispatch({ action: asAction("bubbled"), phase: "discrete" });
    expect(handled).toBe(true);
    expect(parentHandled).toBe(true);
  });
});

// ============================================================================
// Three-level nesting
// ============================================================================

describe("useResponder – three-level nesting", () => {
  it("grandparent > parent > child chain links are correct", () => {
    const { manager, Wrapper } = makeManagerAndWrapper();
    const registeredNodes: ResponderNode[] = [];
    const origRegister = manager.register.bind(manager);
    manager.register = (node: ResponderNode) => {
      registeredNodes.push(node);
      origRegister(node);
    };

    function GrandparentComp({ children }: { children: React.ReactNode }) {
      const { ResponderScope } = useResponder({ id: "grandparent" });
      return <ResponderScope>{children}</ResponderScope>;
    }
    function ParentComp({ children }: { children: React.ReactNode }) {
      const { ResponderScope } = useResponder({ id: "parent" });
      return <ResponderScope>{children}</ResponderScope>;
    }
    function ChildComp() {
      const { ResponderScope } = useResponder({ id: "child" });
      return <ResponderScope><div /></ResponderScope>;
    }

    act(() => {
      render(
        <Wrapper>
          <GrandparentComp>
            <ParentComp>
              <ChildComp />
            </ParentComp>
          </GrandparentComp>
        </Wrapper>
      );
    });

    const gp = registeredNodes.find((n) => n.id === "grandparent");
    const p = registeredNodes.find((n) => n.id === "parent");
    const c = registeredNodes.find((n) => n.id === "child");

    expect(gp?.parentId).toBe(null);
    expect(p?.parentId).toBe("grandparent");
    expect(c?.parentId).toBe("parent");
  });
});

// ============================================================================
// No sibling unmount/remount
// ============================================================================

describe("useResponder – no sibling unmount/remount on peer mount/unmount", () => {
  it("sibling is not unmounted/remounted when a peer component mounts or unmounts", () => {
    const { manager, Wrapper } = makeManagerAndWrapper();
    let siblingMountCount = 0;
    let siblingUnmountCount = 0;

    // A stable sibling that tracks its own mount lifecycle
    function SiblingComp() {
      const { ResponderScope } = useResponder({ id: "sibling" });
      React.useEffect(() => {
        siblingMountCount++;
        return () => { siblingUnmountCount++; };
      }, []);
      return <ResponderScope><div data-testid="sibling" /></ResponderScope>;
    }

    function DynamicComp() {
      const { ResponderScope } = useResponder({ id: "dynamic" });
      return <ResponderScope><div data-testid="dynamic" /></ResponderScope>;
    }

    function Container({ showDynamic }: { showDynamic: boolean }) {
      const { ResponderScope } = useResponder({ id: "root" });
      return (
        <ResponderScope>
          <SiblingComp />
          {showDynamic && <DynamicComp />}
        </ResponderScope>
      );
    }

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(
        <Wrapper><Container showDynamic={false} /></Wrapper>
      ));
    });

    expect(siblingMountCount).toBe(1);
    expect(siblingUnmountCount).toBe(0);

    // Mount the dynamic component
    act(() => {
      rerender(<Wrapper><Container showDynamic={true} /></Wrapper>);
    });

    // Sibling should NOT have been unmounted/remounted
    expect(siblingMountCount).toBe(1);
    expect(siblingUnmountCount).toBe(0);

    // Unmount the dynamic component
    act(() => {
      rerender(<Wrapper><Container showDynamic={false} /></Wrapper>);
    });

    // Still no extra lifecycle events for sibling
    expect(siblingMountCount).toBe(1);
    expect(siblingUnmountCount).toBe(0);

    void manager;
  });
});

// ============================================================================
// Stable ResponderScope identity
// ============================================================================

describe("useResponder – stable ResponderScope identity", () => {
  it("children of ResponderScope are not unmounted/remounted on parent re-render", () => {
    const { manager, Wrapper } = makeManagerAndWrapper();
    let childMountCount = 0;
    let childUnmountCount = 0;

    function TrackedChild() {
      React.useEffect(() => {
        childMountCount++;
        return () => { childUnmountCount++; };
      }, []);
      return <div data-testid="tracked-child" />;
    }

    function ParentComp({ label }: { label: string }) {
      const { ResponderScope } = useResponder({ id: "parent" });
      return (
        <ResponderScope>
          <span>{label}</span>
          <TrackedChild />
        </ResponderScope>
      );
    }

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(
        <Wrapper>
          <ParentComp label="first" />
        </Wrapper>
      ));
    });

    expect(childMountCount).toBe(1);
    expect(childUnmountCount).toBe(0);

    // Force a re-render of the parent with different props
    act(() => {
      rerender(
        <Wrapper>
          <ParentComp label="second" />
        </Wrapper>
      );
    });

    // Child should not have been unmounted and remounted
    expect(childMountCount).toBe(1);
    expect(childUnmountCount).toBe(0);

    void manager;
  });
});

// ============================================================================
// Error: outside provider
// ============================================================================

describe("useResponder – outside provider", () => {
  it("throws descriptive error when no ResponderChainProvider is in the tree", () => {
    function BareComponent() {
      useResponder({ id: "orphan" });
      return <div />;
    }

    let caughtError: unknown = null;
    class ErrorBoundary extends React.Component<
      { children: React.ReactNode },
      { hasError: boolean }
    > {
      state = { hasError: false };
      static getDerivedStateFromError() { return { hasError: true }; }
      componentDidCatch(err: unknown) { caughtError = err; }
      render() {
        return this.state.hasError ? <div>error</div> : this.props.children;
      }
    }

    act(() => {
      render(
        <ErrorBoundary>
          <BareComponent />
        </ErrorBoundary>
      );
    });

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toContain("useResponder must be used inside a <ResponderChainProvider>");
  });
});
