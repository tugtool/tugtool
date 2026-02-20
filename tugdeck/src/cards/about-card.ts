/**
 * About Card - displays app information
 */

import type { TugCard, TugCardMeta } from "./card";
import type { FeedIdValue } from "../protocol";

// Tug logo SVG (48x48 for About card)
const TUG_LOGO_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z"/>
  <path d="m3 9 2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9"/>
  <path d="M12 3v6"/>
</svg>
`;

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
    description.textContent = "Canvas card system for tugtool.";
    content.appendChild(description);

    // Copyright
    const copyright = document.createElement("div");
    copyright.className = "about-copyright";
    copyright.textContent = "Copyright 2025 Ken Kocienda. All rights reserved.";
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
