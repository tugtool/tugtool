# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-14

### Added

- Initial release of tugtool
- Python rename-symbol refactoring with semantic analysis
- Model Context Protocol (MCP) server for AI agent integration
- CLI with JSON output for programmatic parsing
- Verification pipeline (syntax, tests, typecheck)
- Sandbox mode for safe change verification
- Session management for workspace state
- Managed Python venv with libcst support

### Core Features

- `tug snapshot` - Create workspace snapshot
- `tug analyze-impact rename-symbol` - Analyze refactoring impact
- `tug run rename-symbol` - Execute rename with verification
- `tug verify` - Run verification on workspace
- `tug mcp` - Start MCP server

### Documentation

- AGENT_API.md - Full CLI and JSON schema documentation
- AGENT_PLAYBOOK.md - Integration guides for AI agents
