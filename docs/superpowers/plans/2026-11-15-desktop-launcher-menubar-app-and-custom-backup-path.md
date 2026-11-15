# Desktop Launcher, Menu Bar App & Custom Backup Path Implementation Plan

## Goal
Provide a seamless, user-friendly macOS desktop experience for Photo Triage:
1. **Configurable Backup Destination & Folder Hierarchy:** Allow users to choose their hard drive root (via native macOS Finder picker or text) and select from folder hierarchy presets (`/{YYYY}/{MONTH}/`, `/{YYYY}/{MM}/`, `/{YYYY}-{MM}/`, `/{DEVICE}/{YYYY}/{MONTH}/`, `/{YYYY}/`).
2. **1-Click Desktop Launcher Script:** A double-clickable `Start Photo Triage.command` script on the Mac desktop / repo root that launches the server, waits for readiness, and opens the browser dashboard.
3. **Web Dashboard Settings Modal:** An elegant Settings modal in the web app allowing users to inspect/change backup directory (with a "Browse in Finder" button calling macOS AppleScript) and pick folder structure presets.
4. **Native macOS Menu Bar Companion App:** A lightweight Swift macOS menu bar app (`PhotoTriageMenuBar.app`) residing in the Mac menu bar (like Tailscale) showing server status, port, current backup directory, quick Finder picker, dashboard launcher, and start/stop controls.

---

## Tasks

### Task 1: Backend Config & Custom Folder Hierarchy Resolution
- File: `src/server/config.ts` (created)
  - `loadConfig()`: reads `~/.photo-triage/config.json`
  - `saveConfig()`: updates `~/.photo-triage/config.json`
  - `resolveTargetSubdir()`: expands `{YYYY}`, `{MONTH}`, `{MM}`, `{DEVICE}` safely
  - `pickFolderWithFinder()`: executes `osascript` to open Finder dialog
- File: `src/server/backup.ts`:
  - Integrate `resolveTargetSubdir` into `performBackup`
- File: `src/server/routes.ts`:
  - `GET /api/config`: returns current config + presets
  - `POST /api/config`: validates and saves config; updates state
  - `POST /api/choose-folder`: invokes Finder folder picker and returns selected path
- Tests: `tests/server/config.test.ts` verifying path resolution, presets, and load/save.

### Task 2: 1-Click Desktop Launcher Script
- File: `Start Photo Triage.command`
  - Portable bash script with `chmod +x`
  - Detects repo root, checks node/npm, launches `npm start`
  - Polls `http://localhost:3000/api/session` until ready, then opens default browser
  - Also symlinks or copies to `~/Desktop/Start Photo Triage.command` if Desktop exists.

### Task 3: Web Dashboard Settings Modal
- File: `src/client/components/SettingsModal.tsx`
  - Backup Destination: display current path + "Browse in Finder..." button (calls `/api/choose-folder`)
  - Folder Structure Presets: dropdown with preview
  - Device Name input
  - Save button (calls `POST /api/config`)
- File: `src/client/App.tsx`:
  - Header settings gear icon to toggle `SettingsModal`
  - Refreshes session/config on save

### Task 4: Native macOS Menu Bar Companion App
- Directory: `macos/PhotoTriageMenuBar/`
  - `main.swift`: AppKit `NSStatusBar` item with icon
  - Menu:
    - Status indicator (Online/Offline)
    - Current Backup Drive path
    - "Choose Backup Folder in Finder..."
    - "Folder Structure Presets"
    - "Open Web Dashboard"
    - "Copy iPhone URL"
    - "Restart / Stop Server"
    - "Quit"
  - `build.sh`: compiles with `swiftc -target arm64-apple-macos13.0` into `dist/macos/PhotoTriageMenuBar.app`

### Task 5: Verification & Full Suite Run
- Run unit test suite: `npm test`
- Run client/server build: `npm run build`
- Run iOS build: `xcodebuild -project ios/PhotoTriage.xcodeproj -scheme PhotoTriage -destination "generic/platform=iOS" build CODE_SIGNING_ALLOWED=NO`
- Test menubar compilation: `./macos/PhotoTriageMenuBar/build.sh`
