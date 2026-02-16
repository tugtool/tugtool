/**
 * Conversation card - displays assistant/user messages and input area
 */

import { createElement, ArrowUp, Square, Octagon, Paperclip } from "lucide";
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
  type Question,
  type QuestionAnswerInput,
  type TurnCancelled,
  type TurnComplete,
  type InterruptInput,
} from "./conversation/types";
import { MessageOrderingBuffer } from "./conversation/ordering";
import type { DeckManager } from "../deck";
import { renderMarkdown, enhanceCodeBlocks } from "./conversation/message-renderer";
import { ToolCard } from "./conversation/tool-card";
import { ApprovalPrompt } from "./conversation/approval-prompt";
import { QuestionCard } from "./conversation/question-card";
import {
  AttachmentHandler,
  renderAttachmentChips,
  renderAttachButton,
} from "./conversation/attachment-handler";

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
  private pendingQuestions: Map<string, QuestionCard> = new Map();
  private turnActive = false;
  private keydownHandler?: (e: KeyboardEvent) => void;
  private attachmentHandler = new AttachmentHandler();
  private attachChipsContainer!: HTMLElement;
  private attachBtn!: HTMLButtonElement;
  private dragCounter = 0;

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

    // Attachment chips container (between message list and input)
    this.attachChipsContainer = document.createElement("div");
    this.attachChipsContainer.className = "attachment-chips-container";
    this.container.appendChild(this.attachChipsContainer);

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

    // Clipboard paste for images
    this.textarea.addEventListener("paste", async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            try {
              await this.attachmentHandler.addFile(file);
            } catch (error) {
              console.error("Failed to attach pasted image:", error);
            }
          }
        }
      }
    });

    // Attach button
    this.attachBtn = renderAttachButton(async (files) => {
      for (const file of Array.from(files)) {
        try {
          await this.attachmentHandler.addFile(file);
        } catch (error) {
          console.error(`Failed to attach ${file.name}:`, error);
        }
      }
    });

    this.sendBtn = document.createElement("button");
    this.sendBtn.className = "send-btn";
    const icon = createElement(ArrowUp, { width: 20, height: 20 });
    this.sendBtn.appendChild(icon);
    this.sendBtn.addEventListener("click", () => {
      if (this.turnActive) {
        this.sendInterrupt();
      } else {
        this.handleSend();
      }
    });

    inputArea.appendChild(this.textarea);
    inputArea.appendChild(this.attachBtn);
    inputArea.appendChild(this.sendBtn);
    this.container.appendChild(inputArea);

    parent.appendChild(this.container);

    // Drag-and-drop listeners
    this.container.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.dragCounter++;
      this.container.classList.add("drag-over");
    });

    this.container.addEventListener("dragenter", (e) => {
      e.preventDefault();
      this.dragCounter++;
      this.container.classList.add("drag-over");
    });

    this.container.addEventListener("dragleave", () => {
      this.dragCounter--;
      if (this.dragCounter === 0) {
        this.container.classList.remove("drag-over");
      }
    });

    this.container.addEventListener("drop", async (e) => {
      e.preventDefault();
      this.dragCounter = 0;
      this.container.classList.remove("drag-over");

      const files = e.dataTransfer?.files;
      if (files) {
        for (const file of Array.from(files)) {
          try {
            await this.attachmentHandler.addFile(file);
          } catch (error) {
            console.error(`Failed to attach ${file.name}:`, error);
          }
        }
      }
    });

    // Attachment handler update callback
    this.attachmentHandler.onUpdate = () => {
      this.renderAttachmentChips();
    };

    // Add keyboard listener for Ctrl-C and Escape
    this.keydownHandler = (e: KeyboardEvent) => {
      if (this.turnActive && ((e.ctrlKey && e.key === "c") || e.key === "Escape")) {
        this.sendInterrupt();
      }
    };
    document.addEventListener("keydown", this.keydownHandler);
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
    } else if (event.type === "question") {
      this.renderQuestion(event);
    } else if (event.type === "turn_complete") {
      this.handleTurnComplete(event);
    } else if (event.type === "turn_cancelled") {
      this.handleTurnCancelled(event);
    }
    // Other event types handled in later steps
  }

  private handleResync(): void {
    console.warn("Conversation message gap detected - resync triggered");
  }

  private handleSend(): void {
    const text = this.textarea.value.trim();
    if (!text) return;

    // Get attachments
    const attachments = this.attachmentHandler.getAttachments();

    // Render user bubble locally with attachments
    this.renderUserMessage(text, attachments);

    // Send via conversation input feed (0x41)
    const msg: UserMessageInput = {
      type: "user_message",
      text,
      attachments,
    };
    const encoded = encodeConversationInput(msg);
    this.connection.send(encoded);

    // Clear input and attachments
    this.textarea.value = "";
    this.textarea.style.height = "auto";
    this.textarea.focus();
    this.attachmentHandler.clear();

    // Mark turn as active
    this.turnActive = true;
    this.updateButtonState();
  }

  private renderUserMessage(text: string, attachments: any[] = []): void {
    const msg = document.createElement("div");
    msg.className = "message message-user";
    msg.textContent = text;

    // Add read-only attachment chips if present
    if (attachments.length > 0) {
      const chips = renderAttachmentChips(attachments, { removable: false });
      msg.appendChild(chips);
    }

    this.messageList.appendChild(msg);
    this.scrollToBottom();
  }

  private renderAttachmentChips(): void {
    const attachments = this.attachmentHandler.getAttachments();
    this.attachChipsContainer.innerHTML = "";

    if (attachments.length > 0) {
      const chips = renderAttachmentChips(attachments, {
        removable: true,
        onRemove: (index) => this.attachmentHandler.removeAttachment(index),
      });
      this.attachChipsContainer.appendChild(chips);
    }
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

  private renderQuestion(event: Question): void {
    // Create question card
    const questionCard = new QuestionCard(event.request_id, event.questions);

    // Set callback
    questionCard.setCallbacks((answers) => {
      // Send question_answer
      const response: QuestionAnswerInput = {
        type: "question_answer",
        request_id: event.request_id,
        answers,
      };
      const encoded = encodeConversationInput(response);
      this.connection.send(encoded);

      // Re-enable input
      this.setInputEnabled(true);

      // Remove from pending map
      this.pendingQuestions.delete(event.request_id);
    });

    // Append to message list
    this.messageList.appendChild(questionCard.render());
    this.pendingQuestions.set(event.request_id, questionCard);

    // Disable input while waiting for answer
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
      // Check if we're waiting for approval or answer
      const placeholder = this.pendingApprovals.size > 0
        ? "Waiting for tool approval..."
        : "Waiting for answer...";
      this.textarea.placeholder = placeholder;
      this.sendBtn.disabled = true;
    }
  }

  private sendInterrupt(): void {
    const interrupt: InterruptInput = {
      type: "interrupt",
    };
    const encoded = encodeConversationInput(interrupt);
    this.connection.send(encoded);
  }

  private updateButtonState(): void {
    // Update button icon based on turnActive state
    this.sendBtn.innerHTML = "";
    if (this.turnActive) {
      // Show stop button (Square icon)
      const stopIcon = createElement(Square, { width: 20, height: 20 });
      this.sendBtn.appendChild(stopIcon);
      this.sendBtn.classList.add("stop-mode");
    } else {
      // Show send button (ArrowUp icon)
      const sendIcon = createElement(ArrowUp, { width: 20, height: 20 });
      this.sendBtn.appendChild(sendIcon);
      this.sendBtn.classList.remove("stop-mode");
    }
  }

  private handleTurnComplete(event: TurnComplete): void {
    this.turnActive = false;
    this.updateButtonState();
  }

  private handleTurnCancelled(event: TurnCancelled): void {
    this.turnActive = false;
    this.updateButtonState();

    // Find assistant message by msg_id
    const msgEl = this.messageList.querySelector(`[data-msg-id="${event.msg_id}"]`) as HTMLElement;
    if (msgEl) {
      // Add cancelled styling
      msgEl.classList.add("message-cancelled");

      // Add interrupted label
      const label = document.createElement("div");
      label.className = "message-cancelled-label";

      const icon = createElement(Octagon, { width: 16, height: 16 });
      label.appendChild(icon);

      const text = document.createElement("span");
      text.textContent = "Interrupted";
      label.appendChild(text);

      msgEl.appendChild(label);
    }

    // Update any running tool cards to interrupted state
    for (const toolCard of this.toolCards.values()) {
      if (toolCard.getStatus() === "running") {
        toolCard.updateStatus("interrupted");
      }
    }

    // Re-enable input
    this.setInputEnabled(true);
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
