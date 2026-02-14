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
  version "0.5.7"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/tugtool/tugtool/releases/download/v#{version}/tugtool-#{version}-macos-arm64.tar.gz"
      # SHA256 ARM64: 9131d93bed3f7bfa7a3d1d242124b5fe9e9bcfccc289e0d25630fcc0c9a8f26b
      sha256 "9131d93bed3f7bfa7a3d1d242124b5fe9e9bcfccc289e0d25630fcc0c9a8f26b"
    else
      url "https://github.com/tugtool/tugtool/releases/download/v#{version}/tugtool-#{version}-macos-x86_64.tar.gz"
      # SHA256 X86_64: 3114b00f9415c32575c333ef7cf7a17d03a987934f96f6f2be8dc14d9cf5797c
      sha256 "3114b00f9415c32575c333ef7cf7a17d03a987934f96f6f2be8dc14d9cf5797c"
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
