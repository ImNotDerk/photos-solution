# Apple Photos Native UI Implementation Plan (Option B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the single-photo triage experience into an authentic, full-bleed Apple iOS Photos interface: removing all artificial floating pills, enabling natural horizontal swiping and a bottom thumbnail scrubber to compare photos back and forth freely, and providing standard Apple iOS translucent toolbars with 1-tap auto-advancing triage actions.

**Architecture:** Both the native Swift 6 iOS app (`SingleTriageView.swift`) and the React SPA (`SingleView.tsx`) will be upgraded to match Option B. The view is split into an edge-to-edge OLED black photo canvas, a top standard navigation bar, a horizontal thumbnail filmstrip scrubber, and a standard translucent bottom toolbar with dedicated Prev, Trash, HD Only, Keep, and Next controls.

**Tech Stack:** Swift 6 / SwiftUI (iOS Native), React 18 / Tailwind CSS / Lucide Icons (Web SPA), Vitest & swiftc (Verification).

**Spec:** Option B interactive prototype in `mockup-apple-photos-option-b.html`.

## Global Constraints
- Zero emojis in any UI string, label, or menu (pure Apple SF Symbols / SVGs only).
- Zero data loss: `backup_keep` photos are strictly preserved; `backup_only` requires 100% SHA-256 confirmation before staging cleanup.
- Strict Swift 6 concurrency and compilation safety (`CODE_SIGNING_ALLOWED=NO` on iOS CLI builds).
- All 15 existing test suites (247+ tests) must pass.

## Review Focus
1. Rapid horizontal swiping between photos must not trigger unintended triage decisions (swiping is for browsing/comparing; triage actions are triggered by toolbar buttons or dedicated vertical gestures).
2. Filmstrip scrubber must stay synchronized with active photo index and smoothly scroll to keep active thumbnail visible.
3. Tapping a triage decision (Trash, HD Only, Keep) must provide immediate visual feedback (status badge / dot) and smoothly auto-advance to the next photo after ~250ms without requiring the user to press "Next".
4. When reaching the last photo in a batch, auto-advancing must safely stop at the final photo or present the batch completion state rather than crashing with an out-of-bounds index.
5. Undo action must restore the previous photo index and previous triage decision seamlessly.

---

### Task 1: Native iOS Swift Filmstrip Scrubber & Apple Photos Layout (`SingleTriageView.swift`)

**Files:**
- Create: `ios/PhotoTriage/Views/FilmstripScrubberView.swift`
- Create: `ios/PhotoTriage/Views/PhotoDetailsSheetView.swift`
- Modify: `ios/PhotoTriage/Views/SingleTriageView.swift`
- Test: `tests/ios/views.test.ts`

**Steps:**
- [ ] Create `FilmstripScrubberView.swift`: A horizontal `ScrollView(.horizontal, showsIndicators: false)` displaying small rounded thumbnails (`w: 44, h: 44`) with decision status dots (red for trash, blue for backupOnly, green for backupKeep). Includes `ScrollViewReader` to automatically scroll the active photo into view when `triageState.currentIndex` changes.
- [ ] Create `PhotoDetailsSheetView.swift`: A native Apple iOS 18 style bottom sheet presenting camera model, lens aperture, resolution, file size, codec, hard drive backup destination, and status.
- [ ] Refactor `SingleTriageView.swift`:
  - Remove all `.utilitarianBorder`, terminal monospace boxes, and floating capsule pills.
  - Implement full-bleed edge-to-edge photo canvas on `Color.black`.
  - Implement natural horizontal swipe gesture on the canvas (`DragGesture` where `deltaX > 50` goes to previous photo and `deltaX < -50` goes to next photo).
  - Add standard top Apple navigation bar: `< Photos` (dismiss to Grid), centered Date & Time, `Undo`, and `(i)` button.
  - Integrate `FilmstripScrubberView` above the bottom toolbar.
  - Implement standard translucent bottom toolbar with hairline top divider:
    - `Prev` (`chevron.left`)
    - `Trash` (`trash.fill`, red tint, 1-tap auto-advance)
    - `HD Only` (`externaldrive.badge.arrow.down`, blue tint, 1-tap auto-advance)
    - `Keep` (`iphone.badge.checkmark`, green tint, 1-tap auto-advance)
    - `Next` (`chevron.right`)
  - Present `PhotoDetailsSheetView` when tapping `(i)` or swiping up.
- [ ] Update `tests/ios/views.test.ts` with assertions verifying the new components, horizontal swipe gesture contracts, and Swift 6 typecheck.
- [ ] Run `npx vitest run tests/ios/views.test.ts` and `xcodebuild -project ios/PhotoTriage.xcodeproj -scheme PhotoTriage -destination "generic/platform=iOS" build CODE_SIGNING_ALLOWED=NO`.
- [ ] Commit with `feat(ios): implement authentic full-bleed Apple Photos UI with filmstrip scrubber and horizontal paging`.

---

### Task 2: Web SPA Apple Photos Layout & Scrubber (`SingleView.tsx`)

**Files:**
- Create: `src/client/components/FilmstripScrubber.tsx`
- Create: `src/client/components/PhotoDetailsSheet.tsx`
- Modify: `src/client/components/SingleView.tsx`
- Modify: `src/client/App.tsx`
- Test: `tests/client/ui.test.tsx`

**Steps:**
- [ ] Create `FilmstripScrubber.tsx`: Horizontal thumbnail scrubber with active selection highlight, decision status indicators, and click-to-jump navigation.
- [ ] Create `PhotoDetailsSheet.tsx`: Slide-up modal sheet displaying EXIF metadata, dimensions, file size, and target backup folder.
- [ ] Refactor `SingleView.tsx`:
  - Replace blocky terminal styling with authentic Apple Photos edge-to-edge layout on black background.
  - Add horizontal touch swipe support for browsing between photos without triggering decisions.
  - Standard top translucent header with `< Photos` (switches to grid), centered date/time, undo, and `(i)` button.
  - Integrate `FilmstripScrubber` above bottom bar.
  - Standard bottom bar with Prev, Trash, HD Only, Keep, Next. Tapping any decision marks the bundle and automatically advances to the next photo after 250ms.
- [ ] Update `tests/client/ui.test.tsx` to verify new scrubber rendering, horizontal navigation, and auto-advancing decision flow.
- [ ] Run `npx vitest run tests/client/ui.test.tsx` and `npm run build`.
- [ ] Commit with `feat(client): implement authentic Apple Photos full-bleed UI and thumbnail scrubber in web app`.

---

### Task 3: Whole-Suite Verification & End-to-End Testing

**Files:**
- Verify: Full repository test suite (`npm test`)
- Verify: Web client and server build (`npm run build`)
- Verify: macOS Menu Bar Companion App (`npm run build:menubar`)
- Verify: iOS Xcode compilation (`xcodebuild ...`)

**Steps:**
- [ ] Run `npm test` and ensure all 15+ test suites pass with 0 failures.
- [ ] Run `npm run build` and ensure TypeScript and Vite compile with 0 errors.
- [ ] Run `npm run build:menubar` and verify Swift Menu Bar app bundle is valid.
- [ ] Run `xcodebuild` and verify iOS app builds cleanly on Swift 6.
- [ ] Final whole-branch review and clean git commit.
