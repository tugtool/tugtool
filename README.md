# tugtool

Code refactoring for AI agents.

Tugtool is an AI-native code transformation engine that provides verified, deterministic, minimal-diff refactors across Python codebases. Unlike simple find-and-replace, tug understands code semantics: it parses your code, builds a symbol graph, and ensures that all references to a symbol are updated correctly.

## Features

- **Semantic refactoring** - Understands code structure, not just text
- **Verification pipeline** - Catches syntax errors before changes are applied
- **Sandbox-first** - Changes are verified in isolation before touching your files
- **JSON output** - All output is structured JSON for easy parsing by AI agents
- **MCP support** - Native Model Context Protocol server for direct agent integration

## Installation

```bash
cargo install tugtool
```

## Quick Start

```bash
# Analyze impact of a rename
tug analyze-impact rename-symbol --at src/utils.py:42:5 --to transform_data

# Execute the rename with verification
tug run --apply --verify syntax rename-symbol --at src/utils.py:42:5 --to transform_data
```

## For AI Agents

Tugtool is designed for AI coding agents. It provides:

- Stable JSON output contracts for programmatic parsing
- Atomic cross-file refactoring operations
- Pre-apply verification to prevent broken code
- MCP server for direct tool integration

### Documentation

- [Agent API Reference](docs/AGENT_API.md) - Full CLI and JSON schema documentation
- [Agent Playbook](docs/AGENT_PLAYBOOK.md) - Copy-paste snippets and integration guides

### MCP Configuration

To use tug as an MCP server with Claude Code:

```json
{
  "mcpServers": {
    "tug": {
      "command": "tug",
      "args": ["mcp"],
      "env": {}
    }
  }
}
```

## Supported Languages

- **Python** - Full support via LibCST
- **Rust** - Planned (via rust-analyzer)
- **TypeScript** - Planned

## Commands

| Command | Description |
|---------|-------------|
| `snapshot` | Create workspace snapshot |
| `analyze-impact` | Analyze refactoring impact |
| `run` | Execute refactoring operation |
| `verify` | Run verification on workspace |
| `session status` | Show session status |
| `clean` | Clean session resources |
| `toolchain` | Manage language toolchains |
| `mcp` | Start MCP server |

## License

MIT
