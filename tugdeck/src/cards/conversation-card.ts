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
  type ToolUse,
  type ToolResult,
  type ToolApprovalRequest,
  type ToolApprovalInput,
} from "./conversation/types";
import { MessageOrderingBuffer } from "./conversation/ordering";
import type { DeckManager } from "../deck";
import { renderMarkdown, enhanceCodeBlocks } from "./conversation/message-renderer";
import { ToolCard } from "./conversation/tool-card";
import { ApprovalPrompt } from "./conversation/approval-prompt";

export class ConversationCard implements TugCard {
  readonly feedIds = [FeedId.CONVERSATION_OUTPUT];
  private connection: TugConnection;
  private container!: HTMLElement;
  private messageList!: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private orderingBuffer: MessageOrderingBuffer;
  private deckManager?: DeckManager;
  private toolCards: Map<string, ToolCard> = new Map();
  private pendingApprovals: Map<string, ApprovalPrompt> = new Map();

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

    this.sendBtn = document.createElement("button");
    this.sendBtn.className = "send-btn";
    const icon = createElement(ArrowUp, { width: 20, height: 20 });
    this.sendBtn.appendChild(icon);
    this.sendBtn.addEventListener("click", () => this.handleSend());

    inputArea.appendChild(this.textarea);
    inputArea.appendChild(this.sendBtn);
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
    } else if (event.type === "tool_use") {
      this.renderToolUse(event);
    } else if (event.type === "tool_result") {
      this.renderToolResult(event);
    } else if (event.type === "tool_approval_request") {
      this.renderApprovalRequest(event);
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

    // Update text content with Markdown rendering
    msgEl.innerHTML = renderMarkdown(event.text);

    // Enhance code blocks with syntax highlighting (async, fire-and-forget)
    enhanceCodeBlocks(msgEl).catch(error => {
      console.error("Failed to enhance code blocks:", error);
    });

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

  private renderToolUse(event: ToolUse): void {
    // Create a new tool card
    const toolCard = new ToolCard(event.tool_name, event.tool_use_id, event.input);
    this.toolCards.set(event.tool_use_id, toolCard);

    // Append to message list
    this.messageList.appendChild(toolCard.render());
    this.scrollToBottom();
  }

  private renderToolResult(event: ToolResult): void {
    // Find the corresponding tool card
    const toolCard = this.toolCards.get(event.tool_use_id);
    if (!toolCard) {
      console.warn("Received tool_result for unknown tool_use_id:", event.tool_use_id);
      return;
    }

    // Update status and result
    const status = event.is_error ? "failure" : "success";
    toolCard.updateStatus(status);
    toolCard.updateResult(event.output, event.is_error);

    this.scrollToBottom();
  }

  private renderApprovalRequest(event: ToolApprovalRequest): void {
    // Create approval prompt
    const prompt = new ApprovalPrompt(event.tool_name, event.request_id, event.input);

    // Set callbacks
    prompt.setCallbacks(
      // On Allow
      () => {
        // Send approval with "allow" decision
        const approval: ToolApprovalInput = {
          type: "tool_approval",
          request_id: event.request_id,
          decision: "allow",
        };
        const encoded = encodeConversationInput(approval);
        this.connection.send(encoded);

        // Remove approval prompt from DOM
        const promptEl = prompt.render();
        promptEl.remove();

        // Create a ToolCard to show the tool execution
        const toolCard = new ToolCard(event.tool_name, event.request_id, event.input);
        this.messageList.appendChild(toolCard.render());
        this.toolCards.set(event.request_id, toolCard);

        // Re-enable input
        this.setInputEnabled(true);

        // Remove from pending map
        this.pendingApprovals.delete(event.request_id);

        this.scrollToBottom();
      },
      // On Deny
      () => {
        // Send approval with "deny" decision
        const approval: ToolApprovalInput = {
          type: "tool_approval",
          request_id: event.request_id,
          decision: "deny",
        };
        const encoded = encodeConversationInput(approval);
        this.connection.send(encoded);

        // Re-enable input
        this.setInputEnabled(true);

        // Remove from pending map
        this.pendingApprovals.delete(event.request_id);

        // Note: prompt.showDenied() is already called by the Deny button handler
      }
    );

    // Append to message list
    this.messageList.appendChild(prompt.render());
    this.pendingApprovals.set(event.request_id, prompt);

    // Disable input while waiting for approval
    this.setInputEnabled(false);

    this.scrollToBottom();
  }

  private setInputEnabled(enabled: boolean): void {
    if (enabled) {
      this.textarea.disabled = false;
      this.textarea.placeholder = "Type a message...";
      this.sendBtn.disabled = false;
    } else {
      this.textarea.disabled = true;
      this.textarea.placeholder = "Waiting for tool approval...";
      this.sendBtn.disabled = true;
    }
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
