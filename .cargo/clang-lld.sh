#!/usr/bin/env bash
set -euo pipefail

# Cargo/rustc treats "linker" as the C compiler driver. On macOS, `clang` is the
# right driver to use, and it can be instructed to use lld when available.
#
# We prefer `ld64.lld` (from Homebrew LLVM) because it can drastically reduce
# link time for debug/test builds. If it's not installed, we fall back to the
# system linker via plain `clang`.

if command -v ld64.lld >/dev/null 2>&1; then
  exec clang -fuse-ld=lld "$@"
else
  exec clang "$@"
fi


