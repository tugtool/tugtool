# tugtool

Code refactoring for AI assistants

Ever see your AI use grep for code "analysis" or sed/awk to do a complex refactor? It sees your software as text and not as code! Ewww!

Tug aims to do better with language modules that understand code and how to change it. It fills the gap in your AI coding experience with an agent-callable refactor tool that delivers correct, deterministic, minimal-diff, verified, multi-file code rewrites. It makes it easier for you to change your software and focus on making great projects.

## Features

- **Semantic refactoring** - Understands code structure, not just text
- **Verification pipeline** - Catches syntax errors before changes are applied
- **Sandbox-first** - Changes are verified in isolation before touching your files
- **JSON output** - All output is structured JSON for easy parsing by AI agents

## Installation

```bash
cargo install tugtool
```

## Quick Start

```bash
# Preview a rename (shows unified diff)
tug analyze rename --at src/utils.py:42:5 --to transform_data

# Execute the rename (applies with syntax verification)
tug rename --at src/utils.py:42:5 --to transform_data
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

| Command | Description |
|---------|-------------|
| `snapshot` | Create workspace snapshot |
| `analyze rename` | Preview rename changes (unified diff) |
| `rename` | Execute rename operation |
| `verify` | Run verification on workspace |
| `session status` | Show session status |
| `clean` | Clean session resources |
| `fixture` | Manage test fixtures |

## License

MIT
