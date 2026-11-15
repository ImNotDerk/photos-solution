#!/usr/bin/env bash
# ==============================================================================
# Photo Triage - 1-Click Mac Desktop Launcher
# ==============================================================================

set -e

# Resolve real repository root directory (even if invoked via symlink from Desktop)
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
cd "$SCRIPT_DIR"

# Ensure standard macOS package manager paths are present
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Ensure symlink on Desktop exists for convenient 1-click launching
DESKTOP_SHORTCUT="$HOME/Desktop/Start Photo Triage.command"
if [ -d "$HOME/Desktop" ] && [ ! -e "$DESKTOP_SHORTCUT" ]; then
  ln -sf "$SCRIPT_DIR/Start Photo Triage.command" "$DESKTOP_SHORTCUT" 2>/dev/null || true
fi

echo "=================================================================="
echo "  Photo Triage - Mac Backup Server"
echo "=================================================================="
echo ""

# Verify Node.js and npm are available
if ! command -v node >/dev/null 2>&1; then
  echo "[Error] Node.js is not found in PATH."
  echo "Please install Node.js (https://nodejs.org) to run Photo Triage."
  read -p "Press Enter to exit..."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[Error] npm is not found in PATH."
  read -p "Press Enter to exit..."
  exit 1
fi

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
  echo "[Setup] Installing dependencies (first run)..."
  npm install
fi

# Ensure build artifacts exist
if [ ! -d "dist" ] || [ ! -d "dist/client" ]; then
  echo "[Build] Building web dashboard and server..."
  npm run build
fi

# Background task to open the browser dashboard once server is ready
(
  max_wait=30
  waited=0
  until curl -s http://localhost:3000/api/session >/dev/null 2>&1 || [ $waited -ge $max_wait ]; do
    sleep 0.5
    waited=$((waited + 1))
  done

  if [ $waited -lt $max_wait ]; then
    echo ""
    echo "[Ready] Server is online. Opening dashboard in browser..."
    open "http://localhost:3000"
  fi
) &

echo "[Launch] Starting Photo Triage server on port 3000..."
echo "Press Ctrl+C at any time to shut down the server."
echo ""

npm start
