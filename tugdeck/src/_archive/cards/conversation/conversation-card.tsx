/**
 * ConversationCard — React component for the Code/Conversation card.
 *
 * Composes all conversation sub-components:
 *   MessageRenderer   — markdown messages
 *   ToolCard          — tool use/result pairs
 *   ApprovalPrompt    — tool approval requests
 *   QuestionCard      — clarifying question prompts
 *   AttachmentHandler — file attachments
 *   StreamingIndicator — turn-active spinner badge
 *
 * Incoming feed frames arrive via CardContext.feedData (set by ReactCardAdapter
 * on each onFrame call). This component reads the latest CODE_OUTPUT payload,
 * parses it, and feeds it into a MessageOrderingBuffer that delivers events
 * in seq order.
 *
 * Outgoing messages are sent via CardContext.dispatch.
 *
 * Live meta updates: useCardMeta pushes the current title to CardHeader.
 *
 * References: [D03] React content only, [D04] CustomEvents, [D08] React adapter,
 *             Spec S02, Table T03, Step 8.3
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { ArrowUp, Square, Octagon, User, Bot, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CardContext } from "../../../cards/card-context";
import { FeedId } from "../../../protocol";
import { useCardMeta } from "../../../hooks/use-card-meta";
import {
  parseConversationEvent,
  type ConversationEvent,
  type AssistantText,
  type ToolUse,
  type ToolResult,
  type ToolApprovalRequest,
  type Question,
  type TurnComplete,
  type TurnCancelled,
  type ErrorEvent,
  type ProjectInfo,
  type PermissionModeInput,
  type InterruptInput,
  type UserMessageInput,
  type QuestionAnswerInput,
} from "../../../cards/conversation/types";
import { MessageOrderingBuffer } from "../../../cards/conversation/ordering";
import { SessionCache, type StoredMessage } from "../../../cards/conversation/session-cache";
import { renderMarkdown } from "../../../lib/markdown";
import { MessageRenderer } from "./message-renderer";
import { ToolCard } from "./tool-card";
import { ApprovalPrompt } from "./approval-prompt";
import { QuestionCard } from "./question-card";
import { AttachmentHandler, type AttachmentHandlerHandle } from "./attachment-handler";
import { StreamingIndicator, useStreamingState } from "./streaming-state";
import type { ToolApprovalEvent } from "./approval-prompt";
import { CARD_TITLES } from "../../../card-titles";

// ---- Placeholder strings ----

const PLACEHOLDER_DEFAULT = "Type a message...";
const PLACEHOLDER_AWAITING_APPROVAL = "Waiting for tool approval...";
const PLACEHOLDER_AWAITING_ANSWER = "Waiting for answer...";

// ---- Internal state types ----

interface MessageItem {
  kind: "message";
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "partial" | "complete" | "cancelled";
  isPartial?: boolean;
}

interface ToolItem {
  kind: "tool";
  id: string;
  toolUseId: string;
}

interface ApprovalItem {
  kind: "approval";
  id: string;
  requestId: string;
}

interface QuestionItem {
  kind: "question";
  id: string;
  requestId: string;
}

interface DividerItem {
  kind: "divider";
  id: string;
  text: string;
}

type ListItem = MessageItem | ToolItem | ApprovalItem | QuestionItem | DividerItem;

interface ToolCardState {
  toolUse: ToolUse;
  result?: ToolResult;
  stale: boolean;
}

interface PendingApproval {
  requestId: string;
  request: ToolApprovalRequest;
  stale: boolean;
}

interface PendingQuestion {
  requestId: string;
  questions: Question["questions"];
}

// ---- Component ----

export function ConversationCard() {
  const ctx = useContext(CardContext);
  const { feedData, dragState, dispatch } = ctx;

  // ---- Meta ----

  const [projectDir, setProjectDir] = useState<string | null>(null);

  const meta = useMemo(
    () => ({
      title: projectDir ? `CODE: ${projectDir}` : CARD_TITLES.code,
      icon: "MessageSquare" as const,
      closable: true,
      menuItems: [
        {
          type: "select" as const,
          label: "Permission Mode",
          options: ["default", "acceptEdits", "bypassPermissions", "plan"],
          value: "acceptEdits",
          action: (mode: string) => {
            const msg: PermissionModeInput = {
              type: "permission_mode",
              mode: mode as PermissionModeInput["mode"],
            };
            dispatch(FeedId.CODE_INPUT, new TextEncoder().encode(JSON.stringify(msg)));
          },
        },
        {
          type: "action" as const,
          label: "New Session",
          action: () => {
            clearConversation();
          },
        },
        {
          type: "action" as const,
          label: "Export History",
          action: () => {
            exportHistoryRef.current?.();
          },
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectDir]
  );

  useCardMeta(meta);

  // ---- Core state ----

  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [toolCards, setToolCards] = useState<Map<string, ToolCardState>>(new Map());
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestion[]>([]);
  const [turnActive, setTurnActive] = useState(false);
  const [errorState, setErrorState] = useState<"none" | "recoverable" | "fatal">("none");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [showError, setShowError] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Command history state (uncontrolled textarea for test environment compatibility)
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const historyIndexRef = useRef(-1);
  const savedInputTextRef = useRef("");

  const { isStreaming, spinnerText, startStreaming, stopStreaming } = useStreamingState();

  // ---- Derived input state ----

  const hasActiveApprovals = pendingApprovals.some((a) => !a.stale);
  const hasActiveQuestions = pendingQuestions.length > 0;
  const inputDisabled = hasActiveApprovals || hasActiveQuestions;
  const inputPlaceholder = hasActiveApprovals
    ? PLACEHOLDER_AWAITING_APPROVAL
    : hasActiveQuestions
      ? PLACEHOLDER_AWAITING_ANSWER
      : PLACEHOLDER_DEFAULT;

  // ---- Refs ----

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentHandlerRef = useRef<AttachmentHandlerHandle>(null);
  const sessionCacheRef = useRef<SessionCache>(new SessionCache("default"));
  const streamingMsgIdRef = useRef<string | null>(null);
  const dragCounterRef = useRef(0);
  const exportHistoryRef = useRef<() => void>(() => {});

  // Stable refs for callbacks used inside ordering buffer (avoids stale closures)
  const listItemsRef = useRef<ListItem[]>([]);
  listItemsRef.current = listItems;

  const toolCardsRef = useRef<Map<string, ToolCardState>>(new Map());
  toolCardsRef.current = toolCards;

  const pendingApprovalsRef = useRef<PendingApproval[]>([]);
  pendingApprovalsRef.current = pendingApprovals;

  const pendingQuestionsRef = useRef<PendingQuestion[]>([]);
  pendingQuestionsRef.current = pendingQuestions;

  const currentSessionIdRef = useRef<string | null>(null);
  currentSessionIdRef.current = currentSessionId;

  const errorStateRef = useRef<"none" | "recoverable" | "fatal">("none");
  errorStateRef.current = errorState;

  const turnActiveRef = useRef(false);
  turnActiveRef.current = turnActive;

  // ---- Ordering buffer (created once) ----

  const orderingBufferRef = useRef<MessageOrderingBuffer | null>(null);
  if (!orderingBufferRef.current) {
    orderingBufferRef.current = new MessageOrderingBuffer(
      (event) => handleOrderedEvent(event),
      () => {
        console.warn("Conversation message gap detected — resync triggered");
      }
    );
  }

  // ---- Feed subscription ----

  const latestPayload = feedData.get(FeedId.CODE_OUTPUT) ?? null;
  const prevPayloadRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    if (!latestPayload || latestPayload === prevPayloadRef.current) return;
    prevPayloadRef.current = latestPayload;
    const event = parseConversationEvent(latestPayload);
    if (event) {
      orderingBufferRef.current?.push(event);
    }
  });

  // ---- Scroll helper ----

  const scrollToBottom = useCallback(() => {
    if (!dragState?.isDragging && scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (viewport) {
        (viewport as HTMLElement).scrollTop = (viewport as HTMLElement).scrollHeight;
      }
    }
  }, [dragState]);

  // ---- Utilities ----

  function computeProjectHash(dir: string): Promise<string> {
    const data = new TextEncoder().encode(dir);
    return crypto.subtle.digest("SHA-256", data).then((buf) => {
      const arr = Array.from(new Uint8Array(buf));
      return arr.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
    });
  }

  function clearConversation(): void {
    setListItems([]);
    setToolCards(new Map());
    setPendingApprovals([]);
    setPendingQuestions([]);
    setCurrentSessionId(null);
    setErrorState("none");
    setShowError(false);
    streamingMsgIdRef.current = null;
    stopStreaming();
  }

  // ---- Session cache ----

  function restoreFromCache(cached: StoredMessage[]): void {
    const items: ListItem[] = cached.map((msg) => ({
      kind: "message" as const,
      id: msg.msg_id,
      role: msg.role,
      text: msg.text,
      status: msg.status,
    }));
    setListItems(items);
  }

  const writeCacheDebounced = useCallback(() => {
    const storedMessages: StoredMessage[] = [];
    let seq = 0;
    for (const item of listItemsRef.current) {
      if (item.kind !== "message") continue;
      seq++;
      storedMessages.push({
        msg_id: item.id,
        seq,
        rev: 0,
        status: item.status,
        role: item.role,
        text: item.text,
      });
    }
    sessionCacheRef.current.writeMessages(storedMessages);
  }, []);

  // Load cache on mount
  useEffect(() => {
    sessionCacheRef.current
      .readMessages()
      .then((cached) => {
        if (cached.length > 0) restoreFromCache(cached);
      })
      .catch(console.error);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sessionCacheRef.current.close();
    };
  }, []);

  // ---- Keyboard shortcut (global Ctrl-C / Escape) ----

  useEffect(() => {
    function onKeydown(e: KeyboardEvent): void {
      if (turnActiveRef.current && ((e.ctrlKey && e.key === "c") || e.key === "Escape")) {
        sendInterruptFn();
      }
    }
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Event handlers ----

  function handleOrderedEvent(event: ConversationEvent): void {
    switch (event.type) {
      case "project_info":
        onProjectInfo(event);
        break;
      case "session_init":
        onSessionInit(event);
        break;
      case "assistant_text":
        onAssistantText(event);
        break;
      case "error":
        onError(event);
        break;
      case "tool_use":
        onToolUse(event);
        break;
      case "tool_result":
        onToolResult(event);
        break;
      case "tool_approval_request":
        onApprovalRequest(event);
        break;
      case "question":
        onQuestion(event);
        break;
      case "turn_complete":
        onTurnComplete(event);
        break;
      case "turn_cancelled":
        onTurnCancelled(event);
        break;
      default:
        break;
    }
  }

  function onProjectInfo(event: ProjectInfo): void {
    setProjectDir(event.project_dir);
    computeProjectHash(event.project_dir)
      .then((hash) => {
        sessionCacheRef.current.close();
        sessionCacheRef.current = new SessionCache(hash);
        return sessionCacheRef.current.readMessages();
      })
      .then((cached) => {
        if (cached.length > 0) restoreFromCache(cached);
      })
      .catch(console.error);
  }

  function onSessionInit(event: { type: "session_init"; session_id: string }): void {
    const prev = currentSessionIdRef.current;
    const curError = errorStateRef.current;

    if (curError === "recoverable") {
      if (prev && prev === event.session_id) {
        setErrorMessage("Session reconnected.");
        setShowError(true);
        setErrorState("none");
        setTimeout(() => setShowError(false), 3000);
      } else if (prev) {
        setErrorState("none");
        setShowError(false);
        const id = `divider-${Date.now()}`;
        setListItems((prev) => [
          ...prev,
          { kind: "divider", id, text: "Previous session ended. New session started." },
        ]);
      } else {
        setErrorMessage("Session reconnected.");
        setShowError(true);
        setErrorState("none");
        setTimeout(() => setShowError(false), 3000);
      }
    }

    setCurrentSessionId(event.session_id);
  }

  function onAssistantText(event: AssistantText): void {
    const item: MessageItem = {
      kind: "message",
      id: event.msg_id,
      role: "assistant",
      text: event.text,
      status: event.status,
      isPartial: event.is_partial,
    };

    setListItems((prev) => {
      const idx = prev.findIndex((i) => i.id === event.msg_id);
      if (idx !== -1) {
        const updated = [...prev];
        updated[idx] = item;
        return updated;
      }
      return [...prev, item];
    });

    if (event.is_partial) {
      if (!streamingMsgIdRef.current) {
        streamingMsgIdRef.current = event.msg_id;
        startStreaming();
      }
    } else {
      if (streamingMsgIdRef.current === event.msg_id) {
        streamingMsgIdRef.current = null;
        stopStreaming();
      }
    }

    scrollToBottom();
  }

  function onToolUse(event: ToolUse): void {
    const toolState: ToolCardState = { toolUse: event, stale: false };
    setToolCards((prev) => new Map([...prev, [event.tool_use_id, toolState]]));
    setListItems((prev) => [
      ...prev,
      { kind: "tool", id: `tool-${event.tool_use_id}`, toolUseId: event.tool_use_id },
    ]);
    scrollToBottom();
  }

  function onToolResult(event: ToolResult): void {
    setToolCards((prev) => {
      const existing = prev.get(event.tool_use_id);
      if (!existing) {
        console.warn("Received tool_result for unknown tool_use_id:", event.tool_use_id);
        return prev;
      }
      const updated = new Map(prev);
      updated.set(event.tool_use_id, { ...existing, result: event });
      return updated;
    });
    scrollToBottom();
  }

  function onApprovalRequest(event: ToolApprovalRequest): void {
    setPendingApprovals((prev) => [
      ...prev,
      { requestId: event.request_id, request: event, stale: false },
    ]);
    setListItems((prev) => [
      ...prev,
      { kind: "approval", id: `approval-${event.request_id}`, requestId: event.request_id },
    ]);
    scrollToBottom();
  }

  function onQuestion(event: Question): void {
    setPendingQuestions((prev) => [
      ...prev,
      { requestId: event.request_id, questions: event.questions },
    ]);
    setListItems((prev) => [
      ...prev,
      { kind: "question", id: `question-${event.request_id}`, requestId: event.request_id },
    ]);
    scrollToBottom();
  }

  function onTurnComplete(_event: TurnComplete): void {
    setTurnActive(false);
    stopStreaming();
    streamingMsgIdRef.current = null;
    writeCacheDebounced();
  }

  function onTurnCancelled(event: TurnCancelled): void {
    setTurnActive(false);
    stopStreaming();
    streamingMsgIdRef.current = null;

    // Mark assistant message as cancelled
    setListItems((prev) =>
      prev.map((item) =>
        item.id === event.msg_id && item.kind === "message"
          ? { ...(item as MessageItem), status: "cancelled" as const }
          : item
      )
    );

    // Mark running tool cards as interrupted
    setToolCards((prev) => {
      const updated = new Map(prev);
      for (const [id, card] of updated) {
        if (!card.result) {
          updated.set(id, {
            ...card,
            result: {
              type: "tool_result",
              tool_use_id: id,
              output: "",
              is_error: false,
            },
          });
        }
      }
      return updated;
    });

    writeCacheDebounced();
  }

  function onError(event: ErrorEvent): void {
    if (event.recoverable) {
      setErrorState("recoverable");
      setErrorMessage("Conversation engine crashed. Reconnecting...");
      setShowError(true);
      // Mark tool cards as stale
      setToolCards((prev) => {
        const updated = new Map(prev);
        for (const [id, card] of updated) {
          if (!card.result) {
            updated.set(id, { ...card, stale: true });
          }
        }
        return updated;
      });
      setPendingApprovals((prev) => prev.map((a) => ({ ...a, stale: true })));
      setTurnActive(false);
      stopStreaming();
    } else {
      setErrorState("fatal");
      setErrorMessage(
        "Conversation engine failed repeatedly. Please restart tugtool."
      );
      setShowError(true);
    }
  }

  // ---- Send / interrupt ----

  function sendInterruptFn(): void {
    const interrupt: InterruptInput = { type: "interrupt" };
    dispatch(FeedId.CODE_INPUT, new TextEncoder().encode(JSON.stringify(interrupt)));
  }

  function handleSend(): void {
    const text = (textareaRef.current?.value ?? "").trim();
    if (!text) return;

    const attachments = attachmentHandlerRef.current?.getAttachments() ?? [];

    setCommandHistory((prev) => [...prev, text]);
    historyIndexRef.current = -1;
    savedInputTextRef.current = "";

    // Add user message
    const tempId = `user-${Date.now()}`;
    const userItem: MessageItem = {
      kind: "message",
      id: tempId,
      role: "user",
      text,
      status: "complete",
    };
    setListItems((prev) => [...prev, userItem]);

    // Send over wire
    const msg: UserMessageInput = { type: "user_message", text, attachments };
    dispatch(FeedId.CODE_INPUT, new TextEncoder().encode(JSON.stringify(msg)));

    // Clear textarea directly (uncontrolled)
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
    }
    attachmentHandlerRef.current?.clear();
    setTurnActive(true);
    startStreaming();

    scrollToBottom();
    writeCacheDebounced();
  }

  function handleMainButtonClick(): void {
    if (turnActive) {
      sendInterruptFn();
    } else {
      handleSend();
    }
  }

  // ---- Export history ----

  const exportHistory = useCallback(() => {
    const lines: string[] = [];
    for (const item of listItemsRef.current) {
      if (item.kind !== "message") continue;
      const role = item.role === "user" ? "User" : "Assistant";
      const text = item.text.trim();
      if (text) {
        lines.push(`**${role}:** ${text}`);
        lines.push("");
      }
    }
    try {
      const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "conversation-history.md";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export history failed:", e);
    }
  }, []);

  exportHistoryRef.current = exportHistory;

  // ---- Command history navigation ----

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    const currentValue = textareaRef.current?.value ?? "";
    const hasNewlines = currentValue.includes("\n");
    if (!hasNewlines && e.key === "ArrowUp" && commandHistory.length > 0) {
      e.preventDefault();
      if (historyIndexRef.current === -1) {
        savedInputTextRef.current = currentValue;
      }
      const newIndex = Math.min(historyIndexRef.current + 1, commandHistory.length - 1);
      historyIndexRef.current = newIndex;
      if (textareaRef.current) {
        textareaRef.current.value = commandHistory[commandHistory.length - 1 - newIndex];
      }
      return;
    }
    if (!hasNewlines && e.key === "ArrowDown" && historyIndexRef.current >= 0) {
      e.preventDefault();
      if (historyIndexRef.current > 0) {
        const newIndex = historyIndexRef.current - 1;
        historyIndexRef.current = newIndex;
        if (textareaRef.current) {
          textareaRef.current.value = commandHistory[commandHistory.length - 1 - newIndex];
        }
      } else {
        historyIndexRef.current = -1;
        if (textareaRef.current) {
          textareaRef.current.value = savedInputTextRef.current;
        }
      }
    }
  }

  // ---- Paste handler (image from clipboard) ----

  async function handlePaste(
    e: React.ClipboardEvent<HTMLTextAreaElement>
  ): Promise<void> {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await attachmentHandlerRef.current?.addFile(file);
      }
    }
  }

  // ---- Drag-and-drop ----

  function handleDragOver(e: React.DragEvent): void {
    e.preventDefault();
  }
  function handleDragEnter(e: React.DragEvent): void {
    e.preventDefault();
    dragCounterRef.current++;
    setDragOver(true);
  }
  function handleDragLeave(): void {
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setDragOver(false);
  }
  async function handleDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (files) {
      for (const file of Array.from(files)) {
        await attachmentHandlerRef.current?.addFile(file);
      }
    }
  }

  // ---- Approval / Question event bubble handlers ----

  function handleApprovalBubble(e: Event): void {
    const customEvent = e as CustomEvent<ToolApprovalEvent>;
    const { decision, payload } = customEvent.detail;
    const requestId = payload.request_id;

    dispatch(FeedId.CODE_INPUT, new TextEncoder().encode(JSON.stringify(payload)));

    if (decision === "allow") {
      const approval = pendingApprovalsRef.current.find((a) => a.requestId === requestId);
      if (approval) {
        const toolUse: ToolUse = {
          type: "tool_use",
          msg_id: requestId,
          seq: 0,
          tool_name: approval.request.tool_name,
          tool_use_id: requestId,
          input: approval.request.input,
        };
        setToolCards((prev) => new Map([...prev, [requestId, { toolUse, stale: false }]]));
        setListItems((prev) =>
          prev.map((item) =>
            item.id === `approval-${requestId}`
              ? { kind: "tool" as const, id: `tool-${requestId}`, toolUseId: requestId }
              : item
          )
        );
      }
    }

    setPendingApprovals((prev) => prev.filter((a) => a.requestId !== requestId));
  }

  function handleQuestionAnswerBubble(e: Event): void {
    const customEvent = e as CustomEvent<QuestionAnswerInput>;
    const payload = customEvent.detail;
    dispatch(FeedId.CODE_INPUT, new TextEncoder().encode(JSON.stringify(payload)));

    const requestId = payload.request_id;
    setPendingQuestions((prev) => prev.filter((q) => q.requestId !== requestId));
  }

  // ---- Scroll on new messages ----

  useEffect(() => {
    scrollToBottom();
  }, [listItems.length, scrollToBottom]);

  // ---- Render ----

  function renderItem(item: ListItem): React.ReactNode {
    switch (item.kind) {
      case "divider":
        return (
          <div
            key={item.id}
            className="session-divider my-2 text-center text-xs text-muted-foreground"
          >
            {item.text}
          </div>
        );

      case "tool": {
        const toolState = toolCards.get(item.toolUseId);
        if (!toolState) return null;
        return (
          <ToolCard
            key={item.id}
            toolUse={toolState.toolUse}
            result={toolState.result}
            stale={toolState.stale}
          />
        );
      }

      case "approval": {
        const approval = pendingApprovals.find((a) => a.requestId === item.requestId);
        if (!approval) return null;
        return (
          <div
            key={item.id}
            ref={(el: HTMLDivElement | null) => {
              if (el) {
                el.removeEventListener("tool-approval", handleApprovalBubble);
                el.addEventListener("tool-approval", handleApprovalBubble);
              }
            }}
          >
            <ApprovalPrompt request={approval.request} stale={approval.stale} />
          </div>
        );
      }

      case "question": {
        const question = pendingQuestions.find((q) => q.requestId === item.requestId);
        if (!question) return null;
        return (
          <div
            key={item.id}
            ref={(el: HTMLDivElement | null) => {
              if (el) {
                el.removeEventListener("question-answer", handleQuestionAnswerBubble);
                el.addEventListener("question-answer", handleQuestionAnswerBubble);
              }
            }}
          >
            <QuestionCard requestId={item.requestId} questions={question.questions} />
          </div>
        );
      }

      case "message": {
        const isStreamingThis =
          isStreaming && streamingMsgIdRef.current === item.id;
        if (item.role === "user") {
          return (
            <div key={item.id} className="message-row flex items-start gap-2 py-1">
              <div className="message-avatar flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                <User className="h-3 w-3" aria-hidden="true" />
              </div>
              <div
                className="message message-user max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm"
                data-msg-id={item.id}
                data-testid="user-message"
              >
                {item.text}
              </div>
            </div>
          );
        }
        return (
          <div key={item.id} className="message-row flex items-start gap-2 py-1">
            <div className="message-avatar flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
              <Bot className="h-3 w-3" aria-hidden="true" />
            </div>
            <div
              className={[
                "message message-assistant flex-1 text-sm",
                item.status === "cancelled" ? "message-cancelled opacity-60" : "",
                isStreamingThis ? "streaming-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-msg-id={item.id}
              data-testid="assistant-message"
            >
              <MessageRenderer text={item.text} isStreaming={isStreamingThis} />
              {item.status === "cancelled" && (
                <div className="message-cancelled-label mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Octagon className="h-3 w-3" aria-hidden="true" />
                  <span>Interrupted</span>
                </div>
              )}
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  }

  // ---- JSX ----

  return (
    <div
      className={["conversation-card flex h-full flex-col", dragOver ? "drag-over" : ""]
        .filter(Boolean)
        .join(" ")}
      data-testid="conversation-card"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Error / reconnect banner */}
      {showError && (
        <div
          className={[
            "error-banner flex items-center gap-2 px-3 py-2 text-xs",
            errorState === "fatal"
              ? "bg-destructive/10 text-destructive"
              : "bg-yellow-500/10 text-yellow-700",
          ].join(" ")}
          role="alert"
          data-testid="error-banner"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Message list */}
      <ScrollArea ref={scrollAreaRef} className="message-list flex-1 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          {listItems.map((item) => renderItem(item))}
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="conversation-input-wrapper border-t">
        {isStreaming && (
          <div className="px-3 pt-2">
            <StreamingIndicator visible={isStreaming} text={spinnerText} />
          </div>
        )}

        <div className="flex items-end gap-1 px-2 pb-2 pt-1">
          <div className="flex-1">
            <Textarea
              ref={textareaRef}
              className="conversation-input min-h-[40px] resize-none border-0 bg-transparent p-2 text-sm shadow-none focus-visible:ring-0"
              placeholder={inputPlaceholder}
              rows={1}
              disabled={inputDisabled}
              defaultValue=""
              onChange={(e) => {
                e.target.style.height = "auto";
                e.target.style.height =
                  Math.min(e.target.scrollHeight, 200) + "px";
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              data-testid="message-input"
            />
          </div>

          <AttachmentHandler ref={attachmentHandlerRef} />

          <Button
            type="button"
            size="sm"
            variant={turnActive ? "destructive" : "default"}
            className={[
              "send-btn h-8 w-8 shrink-0 p-0",
              turnActive ? "stop-mode" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={handleMainButtonClick}
            disabled={inputDisabled && !turnActive}
            aria-label={turnActive ? "Stop generation" : "Send message"}
            data-testid="send-button"
          >
            {turnActive ? (
              <Square className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
