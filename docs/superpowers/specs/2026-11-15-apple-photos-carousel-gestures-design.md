# Apple Photos Interactive Carousel & Instagram-Style Triage Gestures Design

**Goal:** Transform the single-photo triage experience on both Native iOS (Swift 6) and React Web SPA into an authentic Apple Photos paging carousel with Instagram-style triage popups and a persistent top-right decision status badge.

## 1. Intent & Requirements
1. **Interactive Paging Carousel:**
   - When dragging left or right, adjacent photos must be rendered side-by-side (separated by a standard 16px/20px Apple margin) so the user literally sees the next/previous photo peeking in from the edge during the drag.
   - 1:1 finger tracking with rubber-banding resistance at the start/end of the library.
   - Threshold snapping (>25% drag distance or flick velocity transitions to adjacent photo; otherwise snaps back smoothly).
2. **Instagram-Style Spring Triage Pop-up Animations:**
   - **Double-Tap on photo:** Triggers a green **Keep on Phone** circular badge in center of photo with spring bounce (`scale(0.3) -> scale(1.25) -> scale(1.0) -> fade out`), marks `backup_keep`, and smoothly glides to the next photo.
   - **Swipe DOWN on photo:** Triggers a red **Trash (Delete)** circular badge in center with spring bounce, marks `trash`, and smoothly glides to the next photo.
   - **Swipe UP on photo:** Triggers a blue **HD Only (Offload)** circular badge in center with spring bounce, marks `backup_only`, and smoothly glides to the next photo.
3. **Top-Right Decision Status Badge:**
   - Located in the top navigation bar / header.
   - Persistently displays the current photo's decision state with color-coded dot and text:
     - 🔴 **Trash** (`bg-red-950/80 border-red-700/60 text-red-300`)
     - 🔵 **HD Only** (`bg-sky-950/80 border-sky-700/60 text-sky-300`)
     - 🟢 **Keep** (`bg-emerald-950/80 border-emerald-700/60 text-emerald-300`)
     - ⚪ **Unsorted** (`bg-white/10 border-white/15 text-white/50`)
4. **Bottom Toolbar & Scrubber Sync:**
   - Bottom buttons (Prev, Trash, HD Only, Keep, Next) also trigger the spring pop animation and smooth carousel slide.
   - Filmstrip scrubber stays in lockstep with the carousel index.

## 2. Approaches Considered

- **Approach A: Physical Directional Flicks + Double Tap (Selected)**
  - Horizontal drag = continuous carousel paging (next/prev photo visible during drag).
  - Swipe DOWN = Trash, Swipe UP = HD Only, Double-Tap = Keep.
  - Top-right decision badge, (i) button for details sheet.
  - *Trade-offs:* Vertical swipe-up is now dedicated to HD Only triage, so EXIF details sheet is accessed via the top-bar (i) button. Extremely fast 1-handed triage.

- **Approach B: Vertical Drag-to-Target Reveal**
  - Dragging down/up rubber-bands the image and reveals target drop zones.
  - *Trade-offs:* Slower interaction than quick flick/tap.

- **Approach C: Button-Only Triage with Carousel**
  - Carousel only; no gesture triage.
  - *Trade-offs:* Rejected because user explicitly requested bringing back gestures for Trash, HD Only, and Keep.

## 3. Platform Architecture

### iOS SwiftUI (Swift 6)
- Replace static single image viewport with a 3-window paging carousel in `SingleTriageView.swift`:
  - An `HStack(spacing: 16)` rendering `[previousAsset, currentAsset, nextAsset]` or `TabView(selection:)` with page style.
  - Drag gesture calculates real-time horizontal offset. If vertical velocity/distance dominates (`abs(dy) > 55`), triggers `applyTriageDecision(.trash)` on drag down or `applyTriageDecision(.backup_only)` on drag up.
  - Double-tap spatial tap gesture triggers `applyTriageDecision(.backup_keep)`.
  - Spring-animated `@State private var popDecision: TriageDecision?` overlays the center of the photo with `.spring(response: 0.35, dampingFraction: 0.6)`.
  - Top bar has `topRightDecisionBadge` showing active decision color.

### React Web SPA
- Update `SingleView.tsx`:
  - Sliding track with `transform: translateX(calc(-100% * currentIndex + dragOffset))` containing all or windowed photo slides.
  - Touch/mouse drag listeners update track position in real-time.
  - Double-tap and vertical gesture thresholds trigger `popDecision` state with CSS spring keyframe animation.
  - Top navigation bar renders `topRightDecisionBadge`.
