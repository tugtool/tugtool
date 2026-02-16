/**
 * Conversation card - displays assistant/user messages and input area
 */

import { createElement, ArrowUp, Square, Octagon, Paperclip, AlertTriangle } from "lucide";
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
  type PermissionModeInput,
  type ErrorEvent,
  type ProjectInfo,
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
import { StreamingState } from "./conversation/streaming-state";
import { SessionCache, type StoredMessage } from "./conversation/session-cache";

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
  private streamingState = new StreamingState();
  private sessionCache: SessionCache;
  private projectDir: string | null = null;
  private projectHash: string | null = null;
  private currentSessionId: string | null = null;
  private errorState: "none" | "recoverable" | "fatal" = "none";
  private errorBanner!: HTMLElement;
  private permissionModeSelect!: HTMLSelectElement;

  constructor(connection: TugConnection) {
    this.connection = connection;

    // Initialize message ordering buffer
    this.orderingBuffer = new MessageOrderingBuffer(
      (event) => this.handleOrderedEvent(event),
      () => this.handleResync()
    );

    // Initialize session cache (step 14.1 will pass real project hash)
    this.sessionCache = new SessionCache("default");
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

    // Permission mode selector (right-aligned)
    this.permissionModeSelect = document.createElement("select");
    this.permissionModeSelect.className = "permission-mode-select";
    this.permissionModeSelect.innerHTML = `
      <option value="default">Default</option>
      <option value="acceptEdits" selected>Accept Edits</option>
      <option value="bypassPermissions">Bypass Permissions</option>
      <option value="plan">Plan</option>
    `;
    this.permissionModeSelect.addEventListener("change", () => {
      const mode = this.permissionModeSelect.value as "default" | "acceptEdits" | "bypassPermissions" | "plan";
      const msg: PermissionModeInput = {
        type: "permission_mode",
        mode,
      };
      const encoded = encodeConversationInput(msg);
      this.connection.send(encoded);
    });
    header.appendChild(this.permissionModeSelect);

    this.container.appendChild(header);

    // Error banner (initially hidden)
    this.errorBanner = document.createElement("div");
    this.errorBanner.className = "error-banner";
    this.errorBanner.style.display = "none";
    this.container.appendChild(this.errorBanner);

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

    // Load cached messages for instant rendering
    this.loadCachedMessages();
  }

  private async loadCachedMessages(): Promise<void> {
    try {
      const cached = await this.sessionCache.readMessages();
      if (cached.length > 0) {
        this.renderCachedMessages(cached);
      }
    } catch (error) {
      console.error("Failed to load cached messages:", error);
    }
  }

  private renderCachedMessages(messages: StoredMessage[]): void {
    for (const msg of messages) {
      if (msg.role === "user") {
        const msgEl = document.createElement("div");
        msgEl.className = "message message-user";
        msgEl.dataset.msgId = msg.msg_id;
        msgEl.textContent = msg.text;
        this.messageList.appendChild(msgEl);
      } else if (msg.role === "assistant") {
        const msgEl = document.createElement("div");
        msgEl.className = "message message-assistant";
        msgEl.dataset.msgId = msg.msg_id;
        msgEl.innerHTML = msg.text; // Cached messages already have rendered HTML

        if (msg.status === "cancelled") {
          msgEl.classList.add("message-cancelled");
        }

        this.messageList.appendChild(msgEl);
      }
    }

    this.scrollToBottom();
  }

  onFrame(_feedId: number, payload: Uint8Array): void {
    const event = parseConversationEvent(payload);
    if (event) {
      this.orderingBuffer.push(event);
    }
  }

  private handleOrderedEvent(event: ConversationEvent): void {
    if (event.type === "project_info") {
      this.handleProjectInfo(event);
    } else if (event.type === "session_init") {
      this.handleSessionInit(event);
    } else if (event.type === "assistant_text") {
      this.renderAssistantMessage(event);
    } else if (event.type === "error") {
      this.handleError(event);
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
  }

  private handleResync(): void {
    console.warn("Conversation message gap detected - resync triggered");
    // When resync happens, re-read cache and reconcile with live state
    this.loadCachedMessages();
  }

  private async handleProjectInfo(event: ProjectInfo): Promise<void> {
    this.projectDir = event.project_dir;
    this.projectHash = await this.computeProjectHash(event.project_dir);

    // Create new SessionCache with project hash
    if (this.sessionCache) {
      this.sessionCache.close();
    }
    this.sessionCache = new SessionCache(this.projectHash);

    // Load cached messages for this project
    await this.loadCachedMessages();
  }

  private async computeProjectHash(dir: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(dir);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    return hashHex.slice(0, 16);
  }

  private handleSessionInit(event: { type: "session_init"; session_id: string }): void {
    const prevSessionId = this.currentSessionId;

    if (this.errorState === "recoverable") {
      if (prevSessionId && prevSessionId === event.session_id) {
        // Same session reconnected
        this.showReconnectedNote();
      } else if (prevSessionId) {
        // Different session - add divider
        this.showSessionDivider("Previous session ended. New session started.");
      } else {
        // First session after error
        this.showReconnectedNote();
      }
      this.errorState = "none";
    }

    this.currentSessionId = event.session_id;
  }

  private handleError(event: ErrorEvent): void {
    if (event.recoverable) {
      this.errorState = "recoverable";
      this.showErrorBanner("Conversation engine crashed. Reconnecting...", "recoverable");
      this.markAllStale();
    } else {
      this.errorState = "fatal";
      this.showErrorBanner("Conversation engine failed repeatedly. Please restart tugcode.", "fatal");
    }
  }

  private showErrorBanner(message: string, type: "recoverable" | "fatal"): void {
    this.errorBanner.innerHTML = "";
    this.errorBanner.className = `error-banner error-banner-${type}`;

    const icon = createElement(AlertTriangle, { width: 16, height: 16 });
    this.errorBanner.appendChild(icon);

    const text = document.createElement("span");
    text.textContent = message;
    this.errorBanner.appendChild(text);

    this.errorBanner.style.display = "flex";
  }

  private hideErrorBanner(): void {
    this.errorBanner.style.display = "none";
  }

  private showReconnectedNote(): void {
    this.errorBanner.innerHTML = "";
    this.errorBanner.className = "error-banner error-banner-reconnected";

    const text = document.createElement("span");
    text.textContent = "Session reconnected.";
    this.errorBanner.appendChild(text);

    this.errorBanner.style.display = "flex";

    // Auto-hide after 3 seconds
    setTimeout(() => {
      this.hideErrorBanner();
    }, 3000);
  }

  private showSessionDivider(message: string): void {
    const divider = document.createElement("div");
    divider.className = "session-divider";
    divider.textContent = message;
    this.messageList.appendChild(divider);
    this.scrollToBottom();
  }

  private markAllStale(): void {
    // Mark all running tool cards as stale
    for (const toolCard of this.toolCards.values()) {
      if (toolCard.getStatus() === "running") {
        toolCard.markStale();
      }
    }

    // Mark all pending approvals as stale
    for (const approval of this.pendingApprovals.values()) {
      approval.markStale();
    }

    // Clear turn active state and reset button
    this.turnActive = false;
    this.updateButtonState();

    // Re-enable input
    this.setInputEnabled(true);
  }

  private collectCurrentMessages(): StoredMessage[] {
    const messages: StoredMessage[] = [];
    const messageElements = this.messageList.querySelectorAll(".message");

    let seq = 0;
    for (const msgEl of messageElements) {
      const htmlEl = msgEl as HTMLElement;
      const msgId = htmlEl.dataset.msgId;

      if (!msgId) {
        // User messages don't have msg_id yet - assign a temporary one
        seq++;
        const role = htmlEl.classList.contains("message-user") ? "user" : "assistant";
        messages.push({
          msg_id: `temp-${seq}`,
          seq,
          rev: 0,
          status: "complete",
          role,
          text: htmlEl.textContent || "",
        });
      } else {
        seq++;
        const role = htmlEl.classList.contains("message-user") ? "user" : "assistant";
        const status = htmlEl.classList.contains("message-cancelled")
          ? "cancelled"
          : "complete";

        messages.push({
          msg_id: msgId,
          seq,
          rev: 0, // Rev tracking is done server-side
          status,
          role,
          text: role === "assistant" ? htmlEl.innerHTML : htmlEl.textContent || "",
        });
      }
    }

    return messages;
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

    // Write to cache after adding user message
    const messages = this.collectCurrentMessages();
    this.sessionCache.writeMessages(messages);
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

    const renderedHtml = renderMarkdown(event.text);

    if (event.is_partial) {
      // Start streaming if not already streaming
      if (!this.streamingState.isStreaming()) {
        this.streamingState.startStreaming(msgEl);
      }
      // Update text and re-append cursor
      this.streamingState.updateText(msgEl, renderedHtml);
    } else {
      // Complete message - stop streaming
      this.streamingState.stopStreaming(msgEl);
      // Update text content normally
      msgEl.innerHTML = renderedHtml;
    }

    // Enhance code blocks with syntax highlighting (async, fire-and-forget)
    enhanceCodeBlocks(msgEl).catch(error => {
      console.error("Failed to enhance code blocks:", error);
    });

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
    // Stop any active streaming indicators
    this.streamingState.stopStreaming();

    // Write current state to cache
    const messages = this.collectCurrentMessages();
    this.sessionCache.writeMessages(messages);
  }

  private handleTurnCancelled(event: TurnCancelled): void {
    this.turnActive = false;
    this.updateButtonState();

    // Stop any active streaming indicators before adding cancelled styling
    this.streamingState.stopStreaming();

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

    // Write current state to cache
    const messages = this.collectCurrentMessages();
    this.sessionCache.writeMessages(messages);
  }

  async clearHistory(): Promise<void> {
    await this.sessionCache.clearHistory();
    this.messageList.innerHTML = "";
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
