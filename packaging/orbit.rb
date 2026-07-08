# Homebrew formula for orbit. Publish to a tap (e.g. shalinda-j/homebrew-tap),
# then: brew install shalinda-j/tap/orbit
# Update `url` to a tagged release tarball and fill in its sha256 before shipping.
class Orbit < Formula
  desc "Multi-agent, multi-provider AI team CLI"
  homepage "https://github.com/shalinda-j/Orbit"
  url "https://github.com/shalinda-j/Orbit/archive/refs/tags/v1.0.0.tar.gz"
  sha256 "REPLACE_WITH_TARBALL_SHA256"
  license "ISC"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "orbit", shell_output("#{bin}/orbit help")
  end
end
