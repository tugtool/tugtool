/**
 * Conversation card - displays assistant/user messages and input area
 */

import { createElement, ArrowUp } from "lucide";
import { TugCard } from "./card";
import { TugConnection } from "../connection";
import { FeedId, encodeConversationInput } from "../protocol";
import {
  parseConversationEvent,
  type ConversationEvent,
  type AssistantText,
  type UserMessageInput,
} from "./conversation/types";
import { MessageOrderingBuffer } from "./conversation/ordering";
import type { DeckManager } from "../deck";

export class ConversationCard implements TugCard {
  readonly feedIds = [FeedId.CONVERSATION_OUTPUT];
  private connection: TugConnection;
  private container!: HTMLElement;
  private messageList!: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private orderingBuffer: MessageOrderingBuffer;
  private deckManager?: DeckManager;

  constructor(connection: TugConnection) {
    this.connection = connection;

    // Initialize message ordering buffer
    this.orderingBuffer = new MessageOrderingBuffer(
      (event) => this.handleOrderedEvent(event),
      () => this.handleResync()
    );
  }

  setDeckManager(deckManager: DeckManager): void {
    this.deckManager = deckManager;
  }

  mount(parent: HTMLElement): void {
    this.container = document.createElement("div");
    this.container.className = "conversation-card";

    // Card header
    const header = document.createElement("div");
    header.className = "card-header";
    const title = document.createElement("span");
    title.className = "card-title";
    title.textContent = "Conversation";
    header.appendChild(title);
    this.container.appendChild(header);

    // Message list (scrollable)
    this.messageList = document.createElement("div");
    this.messageList.className = "message-list";
    this.container.appendChild(this.messageList);

    // Input area
    const inputArea = document.createElement("div");
    inputArea.className = "conversation-input-area";

    this.textarea = document.createElement("textarea");
    this.textarea.className = "conversation-input";
    this.textarea.placeholder = "Type a message...";
    this.textarea.rows = 1;

    // Auto-expanding textarea
    this.textarea.addEventListener("input", () => {
      this.textarea.style.height = "auto";
      this.textarea.style.height = Math.min(this.textarea.scrollHeight, 200) + "px";
    });

    // Enter to send, Shift+Enter for newline
    this.textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    const sendBtn = document.createElement("button");
    sendBtn.className = "send-btn";
    const icon = createElement(ArrowUp, { width: 20, height: 20 });
    sendBtn.appendChild(icon);
    sendBtn.addEventListener("click", () => this.handleSend());

    inputArea.appendChild(this.textarea);
    inputArea.appendChild(sendBtn);
    this.container.appendChild(inputArea);

    parent.appendChild(this.container);
  }

  onFrame(_feedId: number, payload: Uint8Array): void {
    const event = parseConversationEvent(payload);
    if (event) {
      this.orderingBuffer.push(event);
    }
  }

  private handleOrderedEvent(event: ConversationEvent): void {
    if (event.type === "assistant_text") {
      this.renderAssistantMessage(event);
    } else if (event.type === "error") {
      this.renderError(event.message);
    }
    // Other event types handled in later steps
  }

  private handleResync(): void {
    console.warn("Conversation message gap detected - resync triggered");
  }

  private handleSend(): void {
    const text = this.textarea.value.trim();
    if (!text) return;

    // Render user bubble locally
    this.renderUserMessage(text);

    // Send via conversation input feed (0x41)
    const msg: UserMessageInput = {
      type: "user_message",
      text,
      attachments: [],
    };
    const encoded = encodeConversationInput(msg);
    this.connection.send(encoded);

    // Clear input
    this.textarea.value = "";
    this.textarea.style.height = "auto";
    this.textarea.focus();
  }

  private renderUserMessage(text: string): void {
    const msg = document.createElement("div");
    msg.className = "message message-user";
    msg.textContent = text;
    this.messageList.appendChild(msg);
    this.scrollToBottom();
  }

  private renderAssistantMessage(event: AssistantText): void {
    // Find existing message by msg_id or create new
    let msgEl = this.messageList.querySelector(`[data-msg-id="${event.msg_id}"]`) as HTMLElement;

    if (!msgEl) {
      msgEl = document.createElement("div");
      msgEl.className = "message message-assistant";
      msgEl.dataset.msgId = event.msg_id;
      this.messageList.appendChild(msgEl);
    }

    // Update text content
    msgEl.textContent = event.text;

    // Add status indicator for partial
    if (event.is_partial) {
      msgEl.classList.add("partial");
    } else {
      msgEl.classList.remove("partial");
    }

    this.scrollToBottom();
  }

  private renderError(message: string): void {
    const msgEl = document.createElement("div");
    msgEl.className = "message message-error";
    msgEl.textContent = `Error: ${message}`;
    this.messageList.appendChild(msgEl);
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    if (!this.deckManager?.isDragging) {
      this.messageList.scrollTop = this.messageList.scrollHeight;
    }
  }

  resize(): void {
    // No special resize handling needed
  }
}
