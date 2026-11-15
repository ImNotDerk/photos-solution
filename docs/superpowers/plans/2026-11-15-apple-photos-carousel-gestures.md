# Apple Photos Carousel & Instagram-Style Triage Gestures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement true Apple Photos continuous horizontal paging carousel with adjacent photo peeking, Instagram-style center spring popups for triage decisions, and a persistent top-right decision status badge across both iOS Swift 6 and React Web SPA.

**Architecture:** 
- iOS (`SingleTriageView.swift`): Replace single-image container with an interactive 3-panel horizontal carousel that tracks finger drag in real time. Implement double-tap (Keep), swipe down (Trash), and swipe up (HD Only) with spring-scale popover overlay and top-right decision badge.
- React Web (`SingleView.tsx`): Implement sliding track with 1:1 finger tracking, Instagram-style CSS spring keyframe popover for decisions, and persistent top-right status badge.
- Testing: Update `tests/ios/views.test.ts` and `tests/client/ui.test.tsx` to assert carousel rendering, Instagram-style popover presence, and gesture contracts.

**Tech Stack:** Swift 6 / SwiftUI (iOS Native), React 18 / Tailwind CSS / Lucide SVGs (Web SPA), Vitest & swiftc (Verification).

**Spec:** `docs/superpowers/specs/2026-11-15-apple-photos-carousel-gestures-design.md` and verified prototype `mockup-apple-photos-carousel-gestures.html`.

## Global Constraints
- Zero emojis in any UI string, label, or popup (pure SF Symbols / SVGs).
- Zero data loss: `backup_keep` photos strictly preserved; `backup_only` requires 100% SHA-256 receipt before cleanup.
- Strict Swift 6 concurrency and compilation safety (`CODE_SIGNING_ALLOWED=NO` on iOS CLI builds).
- All 15 existing test suites (250 tests) must pass.

## Review Focus
1. Rapid horizontal dragging must smoothly reveal the adjacent photo peeking in from the side without glitching or snapping backwards.
2. Double-tap gesture must trigger the Keep pop-up and not conflict with pinch-to-zoom or drag gestures.
3. Vertical swipe down (Trash) and vertical swipe up (HD Only) must trigger only when vertical distance exceeds 50px and dominates horizontal movement (`abs(dy) > abs(dx) * 1.3`).
4. Top-right decision badge must update immediately upon decision and remain consistent when paging back to that photo.
5. Auto-advance must smoothly transition the carousel to the next photo after the pop-up animation settles (~350ms) without skipping photos.

---

### Task 1: Native iOS Swift Paging Carousel, IG Popups & Top-Right Badge (`SingleTriageView.swift`)

**Files:**
- Modify: `ios/PhotoTriage/Views/SingleTriageView.swift`
- Test: `tests/ios/views.test.ts`

**Interfaces:**
- Produces: `SingleTriageView` with carousel paging, `topRightDecisionBadge`, `popOverlayView(for:)`, and gestures for double-tap (Keep), swipe down (Trash), swipe up (HD Only).

**Steps:**
- [ ] In `SingleTriageView.swift`:
  - Add `@State private var popDecision: TriageDecision? = nil` and `@State private var popScale: CGFloat = 0.3` for Instagram-style spring animation.
  - Implement `topRightDecisionBadge`: A rounded pill in `nativeTopBar` showing color-coded dot and text (Red for Trash, Blue for HD Only, Green for Keep, Subtle for Unsorted) for `currentDecision`.
  - Replace static single image viewport with an interactive horizontal paging carousel:
    - Render current asset along with previous asset (if `currentIndex > 0`) and next asset (if `currentIndex < totalCount - 1`) side-by-side with a 16px gap.
    - Drag gesture updates horizontal offset in real time so the user literally sees the adjacent photo peeking in.
    - On release, if `abs(dx) > 60` or flick velocity, slides and snaps to adjacent photo via `triageState.goToNext()` / `goToPrevious()`.
  - Implement vertical gestures & double-tap:
    - Swipe down (`dy > 55` and `abs(dy) > abs(dx) * 1.3`) triggers `applyTriageDecision(.trash)`.
    - Swipe up (`dy < -55` and `abs(dy) > abs(dx) * 1.3`) triggers `applyTriageDecision(.backup_only)`.
    - Double-tap spatial tap gesture triggers `applyTriageDecision(.backup_keep)`.
  - In `applyTriageDecision`:
    - Show `popDecision` with spring animation: `scale 0.3 -> 1.25 -> 1.0`, then fade after 350ms.
    - Cancel any previous auto-advance task, then glide carousel to next photo after 350ms.
- [ ] Update `tests/ios/views.test.ts` to assert carousel contracts, double-tap Keep gesture, vertical swipe gestures, and top-right decision badge.
- [ ] Run `npx vitest run tests/ios/views.test.ts` and `xcodebuild -project ios/PhotoTriage.xcodeproj -scheme PhotoTriage -destination "generic/platform=iOS" build CODE_SIGNING_ALLOWED=NO`.
- [ ] Commit with `feat(ios): implement Apple Photos continuous paging carousel with Instagram-style triage popups`.

---

### Task 2: Web SPA Paging Carousel, IG Popups & Top-Right Badge (`SingleView.tsx`)

**Files:**
- Modify: `src/client/components/SingleView.tsx`
- Test: `tests/client/ui.test.tsx`

**Interfaces:**
- Produces: `SingleView.tsx` with sliding carousel track, `topRightDecisionBadge`, `popOverlay` with CSS spring keyframe, double-tap Keep, and swipe down/up triage gestures.

**Steps:**
- [ ] In `SingleView.tsx`:
  - Implement `topRightDecisionBadge` in `header`: color-coded dot and label displaying `bundle.decision` (Red for Trash, Blue for HD Only, Green for Keep, Subtle for Unsorted).
  - Implement interactive sliding carousel track:
    - Container with `overflow-hidden` containing sliding track with `translateX(calc(-100% * currentIndex + dragOffset))`.
    - Adjacent photos are rendered side-by-side with 1:1 mouse and touch drag tracking.
    - Releasing past threshold (>20% width) glides and snaps smoothly to next/prev photo.
  - Implement Instagram-style popover overlay:
    - Center circular badge with spring bounce keyframe (`scale 0.3 -> 1.25 -> 1.0 -> fade`).
    - Green checkmark for Keep, Red trash for Trash, Blue HD for HD Only.
  - Wire gestures:
    - Double-tap / double-click $\rightarrow$ Keep (`backup_keep`).
    - Swipe down $\rightarrow$ Trash (`trash`).
    - Swipe up $\rightarrow$ HD Only (`backup_only`).
    - Releasing after triage triggers pop animation and smoothly advances carousel after 350ms.
- [ ] Update `tests/client/ui.test.tsx` to verify carousel track rendering, double-tap Keep, vertical triage gestures, and top-right badge updates.
- [ ] Run `npx vitest run tests/client/ui.test.tsx` and `npm run build`.
- [ ] Commit with `feat(client): implement Apple Photos continuous paging carousel with Instagram-style triage popups`.

---

### Task 3: Whole-Suite Verification & Build Check

**Files:**
- Verify: Full repository test suite (`npm test`)
- Verify: Web client and server build (`npm run build`)
- Verify: macOS Menu Bar Companion App (`npm run build:menubar`)
- Verify: iOS Xcode compilation (`xcodebuild ...`)

**Steps:**
- [ ] Run `npm test` and ensure all 15 test suites (250+ tests) pass with 0 failures.
- [ ] Run `npm run build` and ensure TypeScript and Vite compile with 0 errors.
- [ ] Run `npm run build:menubar` and verify Swift Menu Bar app bundle is valid.
- [ ] Run `xcodebuild` and verify iOS app builds cleanly on Swift 6.
- [ ] Final whole-branch review and clean git commit.
