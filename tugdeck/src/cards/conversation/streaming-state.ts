/**
 * StreamingState - manages visual indicators during active streaming
 *
 * Provides:
 * - Thin blinking cursor at the end of streaming text
 * - Activity border animation on the message container
 * - Lifecycle management for streaming indicators
 */

export class StreamingState {
  private currentMessageEl: HTMLElement | null = null;
  private cursorEl: HTMLElement | null = null;

  /**
   * Start streaming on the given message element
   * Adds cursor element and activity border class
   */
  startStreaming(messageEl: HTMLElement): void {
    // Clean up any previous streaming state
    if (this.currentMessageEl && this.currentMessageEl !== messageEl) {
      this.stopStreaming();
    }

    this.currentMessageEl = messageEl;

    // Add activity border class to message element
    messageEl.classList.add("streaming-active");

    // Create and append cursor if it doesn't already exist
    if (!this.cursorEl) {
      this.cursorEl = document.createElement("span");
      this.cursorEl.className = "streaming-cursor";
    }

    // Append cursor to the message element
    // The cursor should go after the last content, inside the .conversation-prose container
    const proseContainer = messageEl.querySelector(".conversation-prose");
    if (proseContainer) {
      proseContainer.appendChild(this.cursorEl);
    } else {
      // Fallback: append directly to message element
      messageEl.appendChild(this.cursorEl);
    }
  }

  /**
   * Update the text content of the streaming message
   * Replaces innerHTML with new content and re-appends cursor
   */
  updateText(messageEl: HTMLElement, html: string): void {
    // Replace innerHTML with new content
    messageEl.innerHTML = html;

    // Re-append cursor to the prose container
    const proseContainer = messageEl.querySelector(".conversation-prose");
    if (proseContainer && this.cursorEl) {
      proseContainer.appendChild(this.cursorEl);
    } else if (this.cursorEl) {
      // Fallback: append directly to message element
      messageEl.appendChild(this.cursorEl);
    }
  }

  /**
   * Stop streaming - removes cursor and activity border
   * Can be called with or without a message element
   */
  stopStreaming(messageEl?: HTMLElement): void {
    const targetEl = messageEl || this.currentMessageEl;

    if (targetEl) {
      // Remove activity border class
      targetEl.classList.remove("streaming-active");

      // Remove cursor element if present
      if (this.cursorEl && this.cursorEl.parentElement) {
        this.cursorEl.remove();
      }
    }

    // Clear state
    this.currentMessageEl = null;
    this.cursorEl = null;
  }

  /**
   * Check if currently streaming
   */
  isStreaming(): boolean {
    return this.currentMessageEl !== null;
  }
}
