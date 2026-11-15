#!/usr/bin/env bash
# ==============================================================================
# Build Script for macOS Menu Bar Companion App (PhotoTriageMenuBar.app)
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

APP_BUNDLE="dist/macos/PhotoTriageMenuBar.app"
CONTENTS_DIR="$APP_BUNDLE/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

echo "=================================================================="
echo "  Compiling Photo Triage macOS Menu Bar Companion App"
echo "=================================================================="

mkdir -p "$MACOS_DIR"
mkdir -p "$RESOURCES_DIR"

# Copy Info.plist
cp "$SCRIPT_DIR/PhotoTriageMenuBar/Info.plist" "$CONTENTS_DIR/Info.plist"

# Compile Swift binary
echo "[1/2] Compiling Swift source with swiftc..."
swiftc -O \
  -parse-as-library \
  -target arm64-apple-macos13.0 \
  -framework AppKit \
  -framework Foundation \
  "$SCRIPT_DIR/PhotoTriageMenuBar/main.swift" \
  -o "$MACOS_DIR/PhotoTriageMenuBar"

# Ad-hoc codesign for local execution
echo "[2/2] Applying local ad-hoc code signature..."
codesign --force --sign - "$APP_BUNDLE"

echo ""
echo "Successfully built: $APP_BUNDLE"
echo "You can launch it via: open '$APP_BUNDLE'"
