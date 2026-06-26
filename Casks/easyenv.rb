# Homebrew Cask for Easyenv.
#
# To publish: create a tap repo named "homebrew-easyenv" (or "homebrew-tap")
# under your GitHub account and place this file at Casks/easyenv.rb there.
# Users then install with:
#
#   brew install --cask kei155/easyenv/easyenv
#
# Before each release, fill in `sha256` with the dmg checksum:
#
#   shasum -a 256 Easyenv_0.1.0_aarch64.dmg
#
cask "easyenv" do
  version "0.1.0"
  sha256 "9ba4801e25b9d7732952db71d2a06c2d38c3f6bb91548f7b91fc9db7ca25c851"

  url "https://github.com/kei155/easyenv/releases/download/v#{version}/Easyenv_#{version}_aarch64.dmg"
  name "Easyenv"
  desc "Local-first GUI to browse and edit .env files across your projects"
  homepage "https://github.com/kei155/easyenv"

  depends_on macos: ">= :big_sur"
  depends_on arch: :arm64

  app "Easyenv.app"

  zap trash: [
    "~/Library/Application Support/com.easyenv.app",
  ]
end
