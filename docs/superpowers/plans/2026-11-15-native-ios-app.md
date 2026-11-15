# Native iOS SwiftUI App & Mac Backup Receiver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native SwiftUI iOS app (`PhotoTriage`) that reads the iPhone Camera Roll directly via PhotoKit, provides a utilitarian 1-by-1 and Grid triage UI on the phone, streams kept photos over local Wi-Fi to a dedicated upload endpoint on the Mac server, verifies SHA-256 hashes on the external hard drive, and invokes Apple's native single-dialog deletion prompt for offloaded and trash items.

**Architecture:** 
1. **Mac Server Backend (Node.js/Fastify):** Extends the existing server with a multipart upload endpoint (`POST /api/upload`) that receives raw asset resources (primary photo, Live Photo video, `.AAE` edit sidecar), stores them directly into `<HardDriveRoot>/<YYYY>/<UPPERCASE_MONTH>/`, enforces collision suffixing (`_2`, `_3`), verifies byte size and SHA-256 checksums, and updates `.photo-triage-ledger.json`.
2. **Native iOS App (SwiftUI + PhotoKit):** A native Xcode project targeting iOS 16+. Reads Camera Roll assets directly, presents a month-by-month triage view, provides tactile 1-by-1 swipe triage and grid multi-selection, streams kept bundles to the Mac over Wi-Fi, and calls `PHAssetChangeRequest.deleteAssets` to trigger Apple's native system confirmation dialog for deletion.

**Tech Stack:** Swift 5.9 / 6.0, SwiftUI, PhotoKit (`Photos`, `PhotosUI`), Node.js, Fastify, `@fastify/multipart`, Vitest.

**Spec:** [docs/superpowers/specs/2026-11-15-photo-triage-backup-design.md](file:///Users/derk/Documents/github-repositories/photos-solution/docs/superpowers/specs/2026-11-15-photo-triage-backup-design.md) (Approach 3)

## Global Constraints

- Native app must read Apple Photos Camera Roll directly using `PhotoKit` with no AirDrop requirement.
- Mac upload endpoint must save files directly to `<HardDriveRoot>/<YYYY>/<UPPERCASE_MONTH>/` (e.g. `2024/JANUARY`).
- Companion files (Live Photo `.mov`, edit `.aae`, edited render) must be uploaded and verified together as a bundle.
- Deletion of `backup_only` items on the iPhone must be blocked until the Mac server confirms 100% SHA-256 verification on the hard drive.
- `backup_keep` items must NEVER be passed to `deleteAssets`.
- iOS UI must follow a clean, utilitarian, high-density design (no vibe-coded frosted glass, bouncy pastel cards, or candy gradients).
- Xcode project must be configured with iOS local networking permissions (`NSLocalNetworkUsageDescription`, `NSAllowsLocalNetworking`).

## Review Focus

1. **Live Photo & Sidecar Multi-Resource Extraction:** A single `PHAsset` may contain multiple `PHAssetResource` items (`photo`, `pairedVideo`, `adjustmentData`). All must be extracted and sent to the Mac upload endpoint.
2. **Upload Streaming on Large Videos:** Sending 100MB+ video files over Wi-Fi must use streaming / chunked upload so memory on the iPhone does not spike.
3. **Partial Transfer Failure Recovery:** If Wi-Fi drops mid-upload, the app must report the failure, keep the phone assets intact, and never trigger deletion.
4. **Collision Handling on Hard Drive:** If a photo with the same filename exists with a different SHA-256 hash, the server must automatically suffix with `_2`, `_3`.
5. **Local Network Permission & ATS:** iOS requires `NSLocalNetworkUsageDescription` and `NSAllowsLocalNetworking: true` in `Info.plist` to communicate with `http://<mac-ip>:3000`.

---

### Task 1: Mac Server Streaming Upload Endpoint (`POST /api/upload`)

**Files:**
- Modify: `package.json` (add `@fastify/multipart`)
- Modify: `src/server/routes.ts`
- Modify: `src/server/index.ts`
- Test: `tests/server/upload.test.ts`

**Interfaces:**
- Produces: `POST /api/upload` endpoint accepting multipart form data:
  - Form fields: `bundleId`, `canonicalName`, `capturedAt`, `targetYear`, `targetMonth`, `decision` (`backup_only` | `backup_keep`)
  - File parts: `primary` (required), `live_video` (optional), `edit_sidecar` (optional), `edited_render` (optional)
  - Returns: `{ success: true, verifiedCount: number, entries: LedgerEntry[] }`

- [ ] **Step 1: Install `@fastify/multipart` dependency**
Install `@fastify/multipart` and verify build.

- [ ] **Step 2: Write failing test in `tests/server/upload.test.ts`**
Test `POST /api/upload` with mock multipart form data containing a primary image and live video. Verify it writes to `<HardDriveRoot>/<YYYY>/<MONTH>/`, verifies SHA-256, appends to `.photo-triage-ledger.json`, and returns 200 with verification receipt. Test collision renaming with differing hashes.

- [ ] **Step 3: Implement `POST /api/upload` in `src/server/routes.ts`**
- Register `@fastify/multipart` with 200MB file limit.
- Parse multipart fields and file streams.
- Write files directly to `<HardDriveRoot>/<targetYear>/<targetMonth>/`.
- Apply collision suffixing (`_2`, `_3`) using existing `applySuffix` logic.
- Verify byte size and SHA-256 hash against source stream.
- Append verified entries to `.photo-triage-ledger.json` via `saveLedger`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/server/upload.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add package.json package-lock.json src/server/ tests/server/upload.test.ts
git commit -m "feat: implement streaming multipart upload and hard drive verification endpoint"
```

---

### Task 2: iOS PhotoKit & Data Layer (`AssetModel.swift` & `PhotoKitManager.swift`)

**Files:**
- Create: `ios/PhotoTriage/Models/AssetModel.swift`
- Create: `ios/PhotoTriage/Services/PhotoKitManager.swift`
- Test: `tests/ios/models.test.ts` (or mock Swift execution)

**Interfaces:**
- Produces:
  - `TriageDecision` enum (`unsorted`, `trash`, `backupOnly`, `backupKeep`)
  - `TriageAsset` struct wrapping `PHAsset` with metadata (month, year, date, file size, live photo status)
  - `PhotoKitManager`:
    - `requestAuthorization() async -> Bool`
    - `fetchMonths() -> [YearMonthGroup]`
    - `fetchAssets(for month: YearMonthGroup) -> [TriageAsset]`
    - `loadThumbnail(for asset: TriageAsset, size: CGSize) async -> UIImage?`
    - `loadFullImage(for asset: TriageAsset) async -> UIImage?`
    - `extractResources(for asset: TriageAsset) async throws -> [ExtractedResource]`
    - `deleteAssets(assets: [PHAsset]) async throws -> Bool`

- [ ] **Step 1: Define `AssetModel.swift`**
Create domain models for assets, companion files, month groupings, and triage decisions.

- [ ] **Step 2: Implement `PhotoKitManager.swift`**
- Use `PHPhotoLibrary` and `PHFetchOptions` sorted by `creationDate`.
- Group by Year and Month name (`2024 > JANUARY`).
- Extract file URLs for all resources using `PHAssetResourceManager.default().requestData(for: ...)`.
- Delete assets using `PHAssetChangeRequest.deleteAssets()`.

- [ ] **Step 3: Commit**
```bash
git add ios/PhotoTriage/Models/ ios/PhotoTriage/Services/PhotoKitManager.swift
git commit -m "feat: implement PhotoKit asset manager and resource extractor"
```

---

### Task 3: iOS Network & Upload Engine (`NetworkManager.swift`)

**Files:**
- Create: `ios/PhotoTriage/Services/NetworkManager.swift`
- Create: `ios/PhotoTriage/Models/TriageState.swift`

**Interfaces:**
- Produces:
  - `NetworkManager`:
    - `serverUrl: String` (persisted in `UserDefaults`, defaulting to `http://<MacIP>:3000`)
    - `pingServer() async -> Bool`
    - `uploadBundle(asset: TriageAsset, decision: TriageDecision) async throws -> UploadResult`
  - `TriageState`: ObservableObject managing current batch decisions, undo stack, and sync state.

- [ ] **Step 1: Implement `NetworkManager.swift`**
- URLSession multipart upload implementation streaming data directly.
- Handles response parsing and SHA-256 confirmation check.
- Network connectivity error handling with retry guidance.

- [ ] **Step 2: Implement `TriageState.swift`**
- ObservableObject holding current month, active index, decision dictionary, and undo stack.
- Compute counts: `total`, `unsorted`, `trash`, `backupOnly`, `backupKeep`.

- [ ] **Step 3: Commit**
```bash
git add ios/PhotoTriage/Services/NetworkManager.swift ios/PhotoTriage/Models/TriageState.swift
git commit -m "feat: implement iOS network manager and observable triage state"
```

---

### Task 4: Utilitarian SwiftUI Triage Views

**Files:**
- Create: `ios/PhotoTriage/Views/MonthSelectionView.swift`
- Create: `ios/PhotoTriage/Views/SingleTriageView.swift`
- Create: `ios/PhotoTriage/Views/GridTriageView.swift`
- Create: `ios/PhotoTriage/Views/BackupProgressView.swift`
- Create: `ios/PhotoTriage/Views/SettingsView.swift`
- Create: `ios/PhotoTriage/ContentView.swift`
- Create: `ios/PhotoTriage/PhotoTriageApp.swift`

**Interfaces:**
- Produces complete, runnable SwiftUI interface adhering strictly to utilitarian aesthetic (dark slate backgrounds, crisp 1px borders, high contrast, monospaced metadata, tactile controls).

- [ ] **Step 1: Implement `MonthSelectionView.swift`**
List of months with photo counts and status indicators (`2024 > JANUARY (342 photos)`).

- [ ] **Step 2: Implement `SingleTriageView.swift`**
- Full-screen photo view with pinch-to-zoom and Live Photo badge.
- Monospaced metadata bar: capture date, filename, size, target path (`/2024/JANUARY/`).
- Three tactile action buttons:
  - `🗑️ Trash` (Delete from phone)
  - `💾 HD Only` (Offload to hard drive)
  - `💾+📱 HD+Phone` (Back up and keep)
- Swipe gesture bindings: swipe left for Trash, swipe right for Keep, upward drag for HD Only, Undo button.

- [ ] **Step 3: Implement `GridTriageView.swift`**
- Responsive `LazyVGrid` thumbnail grid.
- Filter tabs (`Unsorted`, `Trash`, `HD Only`, `HD+Phone`, `All`).
- Multi-selection and bulk assignment bar.

- [ ] **Step 4: Implement `BackupProgressView.swift`**
- Uploads kept bundles to Mac over Wi-Fi with progress bar and SHA-256 verification readout.
- Upon 100% verification, calls `PhotoKitManager.deleteAssets` to trigger Apple's single native deletion prompt for Trash and HD Only photos.

- [ ] **Step 5: Implement `ContentView.swift` and `PhotoTriageApp.swift`**
Tab navigation or segmented control switching between Single View, Grid View, and Settings.

- [ ] **Step 6: Commit**
```bash
git add ios/PhotoTriage/Views/ ios/PhotoTriage/ContentView.swift ios/PhotoTriage/PhotoTriageApp.swift
git commit -m "feat: implement utilitarian SwiftUI mobile interface and backup workflow"
```

---

### Task 5: Xcode Project Configuration (`PhotoTriage.xcodeproj` & `Info.plist`)

**Files:**
- Create: `ios/PhotoTriage/Info.plist`
- Create: `ios/PhotoTriage.xcodeproj/project.pbxproj`

**Interfaces:**
- Produces a valid, double-clickable Xcode project ready to open with `open ios/PhotoTriage.xcodeproj`.
- Configures `NSPhotoLibraryUsageDescription`, `NSLocalNetworkUsageDescription`, `NSAllowsLocalNetworking: true`, and automatic code signing settings for personal Apple IDs.

- [ ] **Step 1: Create `Info.plist`**
Configure required permissions and App Transport Security local networking allowances.

- [ ] **Step 2: Generate `project.pbxproj`**
Configure standard iOS App target with Swift 5.9+, UIKit/SwiftUI frameworks, asset catalog references, and bundle identifier.

- [ ] **Step 3: Commit**
```bash
git add ios/PhotoTriage/Info.plist ios/PhotoTriage.xcodeproj/
git commit -m "chore: configure Xcode project, Info.plist permissions, and build settings"
```

---

### Task 6: End-to-End Integration & Setup Guide

**Files:**
- Create: `docs/ios-setup-guide.md`
- Test: `tests/e2e/ios-upload.test.ts`
- Modify: `README.md`

**Interfaces:**
- Validates the entire flow: mock iOS client -> Mac `POST /api/upload` -> hard drive storage in `<YYYY>/<MONTH>/` -> SHA-256 verification -> ledger update.
- Complete 3-step setup guide for running the app on iPhone via Xcode.

- [ ] **Step 1: Write integration test for iOS upload endpoint**
Verify multipart upload of Live Photo bundle, collision handling, SHA-256 hash match on disk, and ledger commit.

- [ ] **Step 2: Create `docs/ios-setup-guide.md`**
Step-by-step instructions:
1. Connect iPhone to Mac with Lightning cable.
2. Run `open ios/PhotoTriage.xcodeproj`.
3. Select your iPhone in Xcode and click "Play / Run".

- [ ] **Step 3: Run full test suite**
Run: `npm test && npm run build`
Expected: 100% PASS.

- [ ] **Step 4: Commit**
```bash
git add docs/ios-setup-guide.md tests/e2e/ios-upload.test.ts README.md
git commit -m "docs: add native iOS app setup guide and complete E2E upload verification"
```
