#!/usr/bin/env bash
# orbit installer — curl -fsSL https://raw.githubusercontent.com/shalinda-j/Orbit/main/install.sh | bash
# Clones (or updates) orbit, installs deps, and puts an `orbit` command on your PATH. No sudo.
set -euo pipefail

REPO="${ORBIT_REPO:-https://github.com/shalinda-j/Orbit.git}"
DIR="${ORBIT_HOME:-$HOME/.orbit-cli}"
BINDIR="${ORBIT_BIN:-$HOME/.local/bin}"

info() { printf '\033[38;5;141m▸\033[0m %s\n' "$1"; }
err()  { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || err "Node.js 18+ is required — https://nodejs.org"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || err "Node.js 18+ required (found $(node -v))"
command -v git  >/dev/null 2>&1 || err "git is required"
command -v npm  >/dev/null 2>&1 || err "npm is required"

if [ -d "$DIR/.git" ]; then
  info "Updating orbit in $DIR"
  git -C "$DIR" pull --ff-only --quiet
else
  info "Cloning orbit into $DIR"
  git clone --depth 1 "$REPO" "$DIR" --quiet
fi

info "Installing dependencies"
( cd "$DIR" && npm install --omit=dev --silent )

mkdir -p "$BINDIR"
for name in orbit 360cli; do
  cat > "$BINDIR/$name" <<EOF
#!/usr/bin/env sh
exec node "$DIR/bin/orbit.js" "\$@"
EOF
  chmod +x "$BINDIR/$name"
done
info "Installed orbit → $BINDIR/orbit"

case ":$PATH:" in
  *":$BINDIR:"*) ;;
  *) printf '\n  \033[33mAdd %s to your PATH:\033[0m\n    export PATH="%s:$PATH"\n' "$BINDIR" "$BINDIR" ;;
esac

printf '\n  Done. Run \033[1morbit\033[0m to start (or \033[1morbit connect\033[0m to add a provider).\n'
