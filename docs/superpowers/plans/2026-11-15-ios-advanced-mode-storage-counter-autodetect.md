# iOS Advanced Telemetry Toggle, Live Storage Counter & Wired Auto-Detect Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide an Apple-style Advanced vs. Minimal telemetry toggle (via a 1-tap `(i)` header button and Settings switch), a live storage reclaimed calculator (*"Freed X.X GB on iPhone"*), and 1-tap wired USB/LAN server auto-detection.

**Architecture:**
- Use persistent `@AppStorage("isAdvancedModeEnabled")` to coordinate minimal vs. advanced telemetry across Single and Grid views.
- Add computed properties `estimatedBytesReclaimedOnPhone`, `formattedBytesReclaimedOnPhone`, `estimatedBytesToHardDrive`, and `formattedBytesToHardDrive` to `TriageState`.
- Add `autoDetectServer() async -> String?` to `NetworkManager` to probe candidate endpoints (including Apple's direct USB tethering IP `http://172.20.10.2:3000`).
- Update `SingleTriageView`, `GridTriageView`, and `SettingsView` with clean Apple UI styling, SF Symbols, and zero emojis.

**Tech Stack:** Swift 6, SwiftUI, Combine, Apple PhotoKit, Vitest TypeScript test suite, `xcodebuild`.

---

## Global Constraints
- **Apple SF Symbols Only:** Never introduce emojis into UI labels, buttons, or error descriptions.
- **Utilitarian / Apple Dark Design System:** Adhere to `Color.slate950`, `Color.slate900`, `Color.consoleCyan`, and monospaced accents. No `ultraThinMaterial`.
- **Zero Data Loss Invariant:** Never delete `backup_keep` photos; never delete `backup_only` without verified SHA-256 confirmation.
- **Strict Swift 6 & Test Compatibility:** All 13 test suites (`npm test`) must pass and `xcodebuild ... CODE_SIGNING_ALLOWED=NO` must succeed cleanly.

---

## Review Focus
1. **Toggle state persistence:** Toggling `(i)` in Single View must persist to Settings and Grid View via `@AppStorage`.
2. **Dynamic clean view:** Minimal mode must hide raw resolution, destination paths, and raw filenames while keeping photo, date, progress, and action buttons cleanly centered.
3. **Storage calculation accuracy:** Calculating freed storage must correctly sum `trash` and `backup_only` assets while excluding `backup_keep` and `unsorted`.
4. **Auto-detect timeout resilience:** When no server is plugged in or reachable, auto-detect must gracefully timeout without freezing the UI or crashing.
5. **No emoji regression:** All new UI elements must use Apple SF Symbols (`info.circle`, `bolt.fill`, `network`, `externaldrive`).

---

### Task 1: Storage Telemetry Calculation in TriageState
**Files:**
- Modify: `ios/PhotoTriage/Models/TriageState.swift`
- Test: `tests/ios/models.test.ts`

- [ ] Add `estimatedBytesReclaimedOnPhone`, `formattedBytesReclaimedOnPhone`, `estimatedBytesToHardDrive`, and `formattedBytesToHardDrive` in `TriageState.swift`.
- [ ] Add test cases in `tests/ios/models.test.ts` verifying storage calculation and formatted strings.
- [ ] Run `npm test` and verify passing.

---

### Task 2: Wired & Local Server Auto-Detection in NetworkManager
**Files:**
- Modify: `ios/PhotoTriage/Services/NetworkManager.swift`
- Test: `tests/ios/network.test.ts`

- [ ] Implement `autoDetectServer() async -> String?` in `NetworkManager.swift` probing `http://172.20.10.2:3000`, `http://172.20.10.1:3000`, `serverUrl`, and `defaultServerUrl` with a 1.5s timeout.
- [ ] Add unit test assertions in `tests/ios/network.test.ts`.
- [ ] Run `npm test` and verify passing.

---

### Task 3: Advanced vs. Minimal Toggle & Storage Header in SingleTriageView & GridTriageView
**Files:**
- Modify: `ios/PhotoTriage/Views/SingleTriageView.swift`
- Modify: `ios/PhotoTriage/Views/GridTriageView.swift`
- Test: `tests/ios/views.test.ts`

- [ ] Add `@AppStorage("isAdvancedModeEnabled") private var isAdvancedModeEnabled: Bool = false` to `SingleTriageView.swift`.
- [ ] Add 1-tap `info.circle` button in `SingleTriageView` header and live `FREED X.X GB` badge.
- [ ] Conditionally render technical metadata (`dimensions`, `DEST: /YYYY/MONTH/`, raw filename) only when `isAdvancedModeEnabled == true`.
- [ ] In `GridTriageView.swift`, add live `FREED X.X GB` counter and 1-tap `info.circle` toggle in the header.
- [ ] Update `tests/ios/views.test.ts` with assertions verifying the new controls.
- [ ] Run `npm test` and verify passing.

---

### Task 4: Auto-Detect Button & Telemetry Setting in SettingsView
**Files:**
- Modify: `ios/PhotoTriage/Views/SettingsView.swift`
- Test: `tests/ios/views.test.ts`

- [ ] In `SettingsView.swift`, add the "AUTO-DETECT" button in the Server Config card.
- [ ] Add "DISPLAY & INTERFACE" section with the "ADVANCED TELEMETRY" toggle bound to `@AppStorage("isAdvancedModeEnabled")`.
- [ ] Add test assertions in `tests/ios/views.test.ts`.
- [ ] Run `npm test` and verify passing.

---

### Task 5: End-to-End Build & Xcode Verification
- [ ] Run full test suite: `npm test`.
- [ ] Run production build: `npm run build`.
- [ ] Run native Xcode build: `xcodebuild -project ios/PhotoTriage.xcodeproj -scheme PhotoTriage -destination "generic/platform=iOS" build CODE_SIGNING_ALLOWED=NO`.
- [ ] Commit cleanly with conventional commit message.
