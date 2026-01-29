# tugtool

Code refactoring for AI assistants

Ever see your AI use grep for code "analysis" or sed/awk to do a complex refactor? It sees your software as text and not as code! Ewww!

Tug aims to do better with language modules that understand code and how to change it. It fills the gap in your AI coding experience with an agent-callable refactor tool that delivers correct, deterministic, minimal-diff, verified, multi-file code rewrites. It makes it easier for you to change your software and focus on making great projects.

## Features

- **Semantic refactoring** - Understands code structure, not just text
- **Verification pipeline** - Catches syntax errors before changes are applied
- **Sandbox-first** - Changes are verified in isolation before touching your files
- **JSON output** - Structured JSON for apply/analyze; `emit` outputs unified diff by default (with optional JSON envelope)

## Installation

```bash
cargo install tugtool
```

## Quick Start

```bash
# Preview a rename (shows unified diff)
tug emit python rename --at src/utils.py:42:5 --to transform_data

# Analyze operation metadata (JSON)
tug analyze python rename --at src/utils.py:42:5 --to transform_data

# Execute the rename (applies with syntax verification)
tug apply python rename --at src/utils.py:42:5 --to transform_data
```

## For AI Agents

Tugtool is designed for AI coding agents. It provides:

- Stable JSON output contracts for programmatic parsing
- Atomic cross-file refactoring operations
- Pre-apply verification to prevent broken code

### Documentation

- [Agent API Reference](docs/AGENT_API.md) - Full CLI and JSON schema documentation
- [Agent Playbook](docs/AGENT_PLAYBOOK.md) - Copy-paste snippets and integration guides

## Supported Languages

- **Python** - Full support via native Rust CST parser
- **Rust** - Planned (via rust-analyzer)
- **TypeScript** - Planned

## Commands

Commands follow the pattern: `tug <action> <language> <command> [options] [-- <filter>]`

| Command | Description |
|---------|-------------|
| `apply python rename` | Execute rename operation (modifies files) |
| `emit python rename` | Output unified diff without modifying files |
| `analyze python rename` | Output JSON metadata (symbol info, references) |
| `session status` | Show session status |
| `clean` | Clean session resources |
| `fixture` | Manage test fixtures |
| `doctor` | Run environment diagnostics |

## License

MIT
