/**
 * About Card - displays app information
 */

import type { TugCard, TugCardMeta } from "./card";
import type { FeedIdValue } from "../protocol";

// Tug logo SVG (48x48 for About card)
const TUG_LOGO_SVG = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="2" y="2" width="20" height="20" rx="4" fill="currentColor" opacity="0.15" stroke="currentColor" stroke-width="1.5"/>
  <text x="12" y="16.5" text-anchor="middle" font-family="IBM Plex Sans, Inter, Segoe UI, system-ui, -apple-system, sans-serif" font-size="12" font-weight="700" fill="currentColor">T</text>
</svg>`;

const VERSION = "0.1.0";

export class AboutCard implements TugCard {
  readonly feedIds: readonly FeedIdValue[] = [];

  private container: HTMLElement | null = null;

  get meta(): TugCardMeta {
    return {
      title: "About",
      icon: "Info",
      closable: true,
      menuItems: [],
    };
  }

  mount(container: HTMLElement): void {
    this.container = container;
    container.classList.add("about-card");

    const content = document.createElement("div");

    // Logo
    const logo = document.createElement("div");
    logo.className = "about-logo";
    logo.innerHTML = TUG_LOGO_SVG;
    content.appendChild(logo);

    // App name
    const name = document.createElement("h2");
    name.className = "about-name";
    name.textContent = "Tug";
    content.appendChild(name);

    // Version
    const version = document.createElement("div");
    version.className = "about-version";
    version.textContent = `Version ${VERSION}`;
    content.appendChild(version);

    // Description
    const description = document.createElement("div");
    description.className = "about-description";
    description.textContent = "AI-assisted software construction. Hi!";
    content.appendChild(description);

    // Copyright
    const copyright = document.createElement("div");
    copyright.className = "about-copyright";
    copyright.textContent = "Copyright 2026 Ken Kocienda. All rights reserved.";
    content.appendChild(copyright);

    container.appendChild(content);
  }

  onFrame(_feedId: number, _payload: Uint8Array): void {
    // No-op: About card doesn't subscribe to any feeds
  }

  onResize(_w: number, _h: number): void {
    // No-op: static content
  }

  destroy(): void {
    if (this.container) {
      this.container.innerHTML = "";
      this.container = null;
    }
  }
}
