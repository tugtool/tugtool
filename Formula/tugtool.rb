# Homebrew formula for tugtool
#
# To install:
#   brew tap tugtool/tugtool https://github.com/tugtool/tugtool
#   brew install tugtool
#
# This formula downloads prebuilt binaries from GitHub Releases.
# The version and checksums are automatically updated by CI on each release.

class Tugtool < Formula
  desc "From ideas to implementation via multi-agent orchestration"
  homepage "https://github.com/tugtool/tugtool"
  version "0.5.2"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/tugtool/tugtool/releases/download/v#{version}/tugtool-#{version}-macos-arm64.tar.gz"
      # SHA256 ARM64: 82ab6fed938b8ca9ffe1620ca13b2dbd112d85ecd508ef02538c73479d8641d6
      sha256 "82ab6fed938b8ca9ffe1620ca13b2dbd112d85ecd508ef02538c73479d8641d6"
    else
      url "https://github.com/tugtool/tugtool/releases/download/v#{version}/tugtool-#{version}-macos-x86_64.tar.gz"
      # SHA256 X86_64: 7f087bd769b77a2111f693dc01ba1b0ee07afa1137d9a16ddb6cef7abc1f701c
      sha256 "7f087bd769b77a2111f693dc01ba1b0ee07afa1137d9a16ddb6cef7abc1f701c"
    end
  end

  def install
    bin.install "bin/tugtool"

    # Install skills to share directory
    # Skills end up at #{HOMEBREW_PREFIX}/share/tugtool/skills/
    (share/"tugtool").install "share/tugtool/skills"

    # Install agents to share directory
    # Agents end up at #{HOMEBREW_PREFIX}/share/tugtool/agents/
    (share/"tugtool").install "share/tugtool/agents"
  end

  def caveats
    <<~EOS
      Tugtool agents have been installed to:
        #{HOMEBREW_PREFIX}/share/tugtool/agents/

      Claude Code skills have been installed to:
        #{HOMEBREW_PREFIX}/share/tugtool/skills/

      To use /tugtool:planner and /tugtool:implementer in your projects, run:
        tugtool setup claude

      This will copy the skills to your project's .claude/skills/ directory.
      You can also run this during `tugtool init` for new projects.
    EOS
  end

  test do
    system "#{bin}/tugtool", "--version"
    system "#{bin}/tugtool", "setup", "claude", "--check"
  end
end
