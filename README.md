# Tug

*An IDE for AI coding*

Tug is a new kind of development environment where AI and the command line meet in one graphical surface.

Today, developers split their attention between terminal windows, AI chat interfaces, and graphical editors. Tug brings these together. Type a shell command and see rich, interactive output — not a wall of monospace text. Ask Claude a question and see streamed markdown with syntax highlighting, tool use blocks, and permission dialogs. Both kinds of work flow through the same surface, side by side, informing each other.

When you run `git status`, Tug renders a clickable file list with status icons. When you run `cargo build`, errors link directly to source locations. When Claude edits a file, you see the same diff view as `git diff`. The AI and the shell are peers — they share context, share the working directory, and share the output stream.

Under the hood, Tug is a suite of tools: a WebSocket multiplexer, a Claude Code bridge, a shell adapter, a browser frontend, orchestration agents, and a native macOS app. It's built to be extensible — adding a new backend service is a new bridge process, not a rewrite.

The project is in active development. The AI conversation path works end-to-end. The shell integration is next.

Read more at the [website](https://tugtool.dev/) and [journal](https://tugtool.dev/journal/).
