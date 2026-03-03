/**
 * Hello card tests -- Step 7.
 *
 * Tests cover:
 * - T21: HelloCardContent renders title and message text
 * - T22: registerHelloCard makes "hello" available in the registry
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { HelloCardContent, registerHelloCard } from "@/components/tugways/cards/hello-card";
import { getRegistration, _resetForTest } from "@/card-registry";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";

// Clean up mounted React trees after each test.
afterEach(() => {
  cleanup();
});

// ============================================================================
// T21: HelloCardContent renders title and message text
// ============================================================================

describe("HelloCardContent – T21: renders title and message", () => {
  it("renders a title element containing 'Hello'", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<HelloCardContent />));
    });

    const title = container.querySelector("[data-testid='hello-card-title']");
    expect(title).not.toBeNull();
    expect(title!.textContent).toContain("Hello");
  });

  it("renders a message element containing 'This is a test card.'", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<HelloCardContent />));
    });

    const message = container.querySelector("[data-testid='hello-card-message']");
    expect(message).not.toBeNull();
    expect(message!.textContent).toContain("This is a test card.");
  });

  it("renders the outer content wrapper", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<HelloCardContent />));
    });

    const wrapper = container.querySelector("[data-testid='hello-card-content']");
    expect(wrapper).not.toBeNull();
  });
});

// ============================================================================
// T22: registerHelloCard makes "hello" available in the registry
// ============================================================================

describe("registerHelloCard – T22: registers 'hello' in the card registry", () => {
  // Reset registry before and after each test for isolation.
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); });

  it("getRegistration('hello') returns undefined before registration", () => {
    expect(getRegistration("hello")).toBeUndefined();
  });

  it("getRegistration('hello') returns a registration after registerHelloCard()", () => {
    registerHelloCard();
    const reg = getRegistration("hello");
    expect(reg).not.toBeUndefined();
    expect(reg!.componentId).toBe("hello");
  });

  it("registration has the correct defaultMeta", () => {
    registerHelloCard();
    const reg = getRegistration("hello");
    expect(reg!.defaultMeta.title).toBe("Hello");
    expect(reg!.defaultMeta.closable).toBe(true);
  });

  it("factory produces a React element (Tugcard) that renders HelloCardContent", () => {
    registerHelloCard();
    const reg = getRegistration("hello");
    expect(reg).not.toBeUndefined();

    // Call factory with stub injected props
    const injected = {
      onDragStart: () => {},
      onMinSizeChange: () => {},
    };

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          {reg!.factory("card-hello-test", injected)}
        </ResponderChainProvider>
      ));
    });

    // Tugcard should render the card header with "Hello" title
    const header = container.querySelector("[data-testid='tugcard-title']");
    expect(header).not.toBeNull();
    expect(header!.textContent).toContain("Hello");

    // HelloCardContent should be rendered inside the Tugcard
    const content = container.querySelector("[data-testid='hello-card-content']");
    expect(content).not.toBeNull();
  });
});
