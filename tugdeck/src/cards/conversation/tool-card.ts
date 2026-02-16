/**
 * Tool use card - renders tool execution with status, input, and results
 */

import {
  createElement,
  FileText,
  Pencil,
  FilePlus2,
  Terminal,
  FolderSearch,
  Search,
  Wrench,
  Loader,
  Check,
  X,
  Octagon,
  ChevronRight,
  ChevronDown,
} from "lucide";
import { renderCodeBlock } from "./code-block";

export type ToolCardStatus = "running" | "success" | "failure" | "interrupted";

/**
 * Map tool name to Lucide icon per Table T01
 */
export function getToolIcon(toolName: string): any {
  const iconMap: Record<string, any> = {
    Read: FileText,
    Edit: Pencil,
    Write: FilePlus2,
    Bash: Terminal,
    Glob: FolderSearch,
    Grep: Search,
  };
  return iconMap[toolName] || Wrench;
}

/**
 * ToolCard renders a collapsible tool use card with status, input, and results
 */
export class ToolCard {
  private container: HTMLElement;
  private header: HTMLElement;
  private content: HTMLElement;
  private statusElement: HTMLElement;
  private chevronElement: HTMLElement;
  private resultElement: HTMLElement;
  private isCollapsed = true;
  private status: ToolCardStatus = "running";

  constructor(
    private toolName: string,
    private toolUseId: string,
    private input: Record<string, unknown>
  ) {
    this.container = this.createContainer();
    this.header = this.createHeader();
    this.content = this.createContent();
    this.statusElement = this.header.querySelector(".tool-card-status")!;
    this.chevronElement = this.header.querySelector(".tool-card-chevron")!;
    this.resultElement = this.content.querySelector(".tool-card-result")!;

    this.container.appendChild(this.header);
    this.container.appendChild(this.content);

    // Header click handler for collapse/expand
    this.header.addEventListener("click", () => this.toggleCollapse());
  }

  private createContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "tool-card";
    container.dataset.toolUseId = this.toolUseId;
    return container;
  }

  private createHeader(): HTMLElement {
    const header = document.createElement("div");
    header.className = "tool-card-header";

    // Icon
    const iconSpan = document.createElement("span");
    iconSpan.className = "tool-card-icon";
    const Icon = getToolIcon(this.toolName);
    const icon = createElement(Icon, { width: 16, height: 16 });
    iconSpan.appendChild(icon);

    // Name
    const nameSpan = document.createElement("span");
    nameSpan.className = "tool-card-name";
    nameSpan.textContent = this.toolName;

    // Summary (first input value, truncated)
    const summarySpan = document.createElement("span");
    summarySpan.className = "tool-card-summary";
    const firstValue = Object.values(this.input)[0];
    if (firstValue !== undefined) {
      const valueStr = String(firstValue);
      summarySpan.textContent = valueStr.length > 80 ? valueStr.slice(0, 80) + "..." : valueStr;
    }

    // Status (Loader initially)
    const statusSpan = document.createElement("span");
    statusSpan.className = "tool-card-status running";
    const loaderIcon = createElement(Loader, { width: 16, height: 16 });
    statusSpan.appendChild(loaderIcon);

    // Chevron (ChevronRight initially)
    const chevronSpan = document.createElement("span");
    chevronSpan.className = "tool-card-chevron";
    const chevronIcon = createElement(ChevronRight, { width: 16, height: 16 });
    chevronSpan.appendChild(chevronIcon);

    header.appendChild(iconSpan);
    header.appendChild(nameSpan);
    header.appendChild(summarySpan);
    header.appendChild(statusSpan);
    header.appendChild(chevronSpan);

    return header;
  }

  private createContent(): HTMLElement {
    const content = document.createElement("div");
    content.className = "tool-card-content collapsed";

    // Input section
    const inputSection = document.createElement("div");
    inputSection.className = "tool-card-input";

    for (const [key, value] of Object.entries(this.input)) {
      const row = document.createElement("div");
      row.className = "tool-card-input-row";

      const keyEl = document.createElement("span");
      keyEl.className = "tool-card-input-key";
      keyEl.textContent = key + ":";

      const valueEl = document.createElement("span");
      valueEl.className = "tool-card-input-value";
      valueEl.textContent = String(value);

      row.appendChild(keyEl);
      row.appendChild(valueEl);
      inputSection.appendChild(row);
    }

    // Result section (empty initially)
    const resultSection = document.createElement("div");
    resultSection.className = "tool-card-result";

    content.appendChild(inputSection);
    content.appendChild(resultSection);

    return content;
  }

  private toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;

    if (this.isCollapsed) {
      this.content.classList.add("collapsed");
      this.chevronElement.innerHTML = "";
      const chevronIcon = createElement(ChevronRight, { width: 16, height: 16 });
      this.chevronElement.appendChild(chevronIcon);
    } else {
      this.content.classList.remove("collapsed");
      this.chevronElement.innerHTML = "";
      const chevronIcon = createElement(ChevronDown, { width: 16, height: 16 });
      this.chevronElement.appendChild(chevronIcon);
    }
  }

  /**
   * Get the current status
   */
  getStatus(): ToolCardStatus {
    return this.status;
  }

  /**
   * Update the tool status
   */
  updateStatus(status: ToolCardStatus): void {
    this.status = status;

    // Remove old status class
    this.statusElement.className = `tool-card-status ${status}`;

    // Update icon based on status
    this.statusElement.innerHTML = "";
    let icon: any;
    switch (status) {
      case "running":
        icon = createElement(Loader, { width: 16, height: 16 });
        break;
      case "success":
        icon = createElement(Check, { width: 16, height: 16 });
        break;
      case "failure":
        icon = createElement(X, { width: 16, height: 16 });
        break;
      case "interrupted":
        icon = createElement(Octagon, { width: 16, height: 16 });
        break;
    }
    this.statusElement.appendChild(icon);
  }

  /**
   * Update the result section with output
   */
  async updateResult(output: string, isError: boolean): Promise<void> {
    this.resultElement.innerHTML = "";

    if (isError) {
      this.resultElement.classList.add("error");
    } else {
      this.resultElement.classList.remove("error");
    }

    // Check if output needs truncation (>10 lines)
    const lines = output.split("\n");
    const needsTruncation = lines.length > 10;

    if (needsTruncation) {
      // Show first 10 lines
      const truncated = lines.slice(0, 10).join("\n");
      await this.renderOutput(truncated, isError);

      // Add "Show all" link
      const showAllBtn = document.createElement("button");
      showAllBtn.className = "tool-card-show-all";
      showAllBtn.textContent = `Show all (${lines.length} lines)`;
      showAllBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // Don't trigger card collapse
        this.resultElement.innerHTML = "";
        this.renderOutput(output, isError);
      });
      this.resultElement.appendChild(showAllBtn);
    } else {
      await this.renderOutput(output, isError);
    }
  }

  private async renderOutput(output: string, isError: boolean): Promise<void> {
    // For Read tool, attempt syntax highlighting if we can detect file extension
    if (this.toolName === "Read" && !isError) {
      const filePath = this.input.file_path as string | undefined;
      if (filePath) {
        const ext = filePath.split(".").pop()?.toLowerCase();
        const langMap: Record<string, string> = {
          ts: "typescript",
          js: "javascript",
          py: "python",
          rs: "rust",
          sh: "shellscript",
          bash: "shellscript",
          json: "json",
          css: "css",
          html: "html",
          md: "markdown",
          go: "go",
          java: "java",
          c: "c",
          cpp: "cpp",
          sql: "sql",
          yaml: "yaml",
          yml: "yaml",
          toml: "toml",
        };
        const language = ext && langMap[ext] ? langMap[ext] : undefined;

        if (language) {
          try {
            const codeBlock = await renderCodeBlock(output, language);
            this.resultElement.appendChild(codeBlock);
            return;
          } catch (error) {
            console.warn("Failed to render code block, falling back to plain text:", error);
          }
        }
      }
    }

    // For Bash tool or fallback: render as terminal output
    const terminal = document.createElement("pre");
    terminal.className = "tool-card-result-terminal";
    terminal.textContent = output;
    this.resultElement.appendChild(terminal);
  }

  /**
   * Get the DOM element for this tool card
   */
  render(): HTMLElement {
    return this.container;
  }
}
