# iOS Photo Grid Sticky Date Headers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group photo grid assets by capture date and add native pinned sticky date headers in `GridTriageView`, replicating the Apple Photos Camera Roll experience.

**Architecture:** Add a `DailyAssetSection` grouping model that partitions filtered `TriageAsset` instances by calendar day. Render `LazyVGrid` with `pinnedViews: [.sectionHeaders]` and translucent styled day headers (`DaySectionHeader`) that stick to the top during scrolling.

**Tech Stack:** Swift 6, SwiftUI (`LazyVGrid`, `Section(header:)`), PhotoKit, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-15-ios-grid-sticky-date-headers-design.md`

## Global Constraints
- Target iOS 16.0+, strict Swift 6 mode typechecking with 0 errors/warnings (`swiftc -typecheck -swift-version 6`).
- Native Apple dark theme styling (`Color.slate900`, `.ultraThinMaterial` / translucent backdrop, SF Pro rounded typography).
- Preserve existing filter category selection (`TriageFilter`) and multi-select batch actions (`selectedAssetIds`).
- No external 3rd party dependencies.

## Review Focus
1. Photos missing `creationDate` (fallback to current date or deterministic grouping without crashing).
2. Filter modes (`Trash`, `HD Only`, etc.) resulting in sparse days or empty days (ensure empty sections do not render empty headers).
3. Select mode toggle and checkmark tapping works identically across section boundaries.
4. Correct chronological ordering of sections (newest or consistent with month sorting).
5. Swift 6 Sendable and concurrency compliance on `DailyAssetSection`.

---

### Task 1: Daily Section Grouping Model & Helper

**Files:**
- Modify: `ios/PhotoTriage/Views/GridTriageView.swift:1-40`
- Test: `tests/ios/views.test.ts`

**Interfaces:**
- Produces:
  ```swift
  public struct DailyAssetSection: Identifiable, Sendable {
      public let id: String
      public let date: Date
      public let title: String
      public let assets: [TriageAsset]
  }
  ```
  and helper method in `GridTriageView`:
  ```swift
  public func groupedDailySections(for assets: [TriageAsset]) -> [DailyAssetSection]
  ```

- [ ] **Step 1: Write the failing tests in `tests/ios/views.test.ts`**
  Add unit assertions verifying `DailyAssetSection` struct definition and `groupedDailySections` contract in `GridTriageView.swift`.
- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run tests/ios/views.test.ts`
  Expected: FAIL with missing `DailyAssetSection` or `groupedDailySections`.
- [ ] **Step 3: Implement `DailyAssetSection` and grouping logic in `ios/PhotoTriage/Views/GridTriageView.swift`**
  Group assets by `Calendar.current.startOfDay(for: asset.creationDate ?? Date())`, format title as `EEEE, MMM d, yyyy` (or `MMM d, yyyy`), and return non-empty sections sorted chronologically.
- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/ios/views.test.ts`
  Expected: PASS
- [ ] **Step 5: Verify Swift 6 typecheck**
  Run: `npm run build:ios`
  Expected: PASS with 0 errors.
- [ ] **Step 6: Commit**
  ```bash
  git add ios/PhotoTriage/Views/GridTriageView.swift tests/ios/views.test.ts
  git commit -m "feat(ios): add DailyAssetSection grouping model and helper to GridTriageView"
  ```

---

### Task 2: Pinned Sticky Date Headers in `GridTriageView` & End-to-End Build

**Files:**
- Modify: `ios/PhotoTriage/Views/GridTriageView.swift:165-210`
- Test: `tests/ios/views.test.ts`

**Interfaces:**
- Consumes: `DailyAssetSection`, `groupedDailySections` from Task 1.
- Produces: `DaySectionHeader: View` and `LazyVGrid(columns: columns, spacing: 4, pinnedViews: [.sectionHeaders])`.

- [ ] **Step 1: Write failing tests in `tests/ios/views.test.ts`**
  Add assertions checking `pinnedViews: [.sectionHeaders]` and `Section(header:` usage in `GridTriageView.swift`.
- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run tests/ios/views.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement `DaySectionHeader` and pinned sections in `ios/PhotoTriage/Views/GridTriageView.swift`**
  - Create `DaySectionHeader` view with translucent slate background (`Color.slate900.opacity(0.88)`), subtle bottom divider, SF Pro rounded bold date, and asset count badge.
  - In `assetGridScrollView`, iterate over `groupedDailySections(for: displayAssets)`, rendering each in a `Section(header: DaySectionHeader(...))`.
- [ ] **Step 4: Run test suite**
  Run: `npm test`
  Expected: PASS (all 13 test files passing).
- [ ] **Step 5: Verify Xcode build for iPhone destination**
  Run: `xcodebuild -project ios/PhotoTriage.xcodeproj -scheme PhotoTriage -destination "id=00008120-000C59D634EB401E" build`
  Expected: `** BUILD SUCCEEDED **`.
- [ ] **Step 6: Commit**
  ```bash
  git add ios/PhotoTriage/Views/GridTriageView.swift tests/ios/views.test.ts
  git commit -m "feat(ios): implement native sticky date headers in photo triage grid"
  ```
