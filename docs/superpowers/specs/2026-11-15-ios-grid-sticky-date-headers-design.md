# Design: Native iOS Sticky Date Headers in Photo Grid

## Intent & The Why
When scrolling through photos in the iOS `GridTriageView`, the user wants the capture date to remain visible as they scroll, mirroring the native Apple Photos Camera Roll / Library experience. This helps the user orient themselves chronologically while triaging large monthly batches (e.g., distinguishing photos taken on a weekend trip from the rest of the month).

## Goals & Non-Goals
- **Goals:**
  - Group currently displayed assets by calendar day (`Calendar.current.startOfDay(for: ...)`).
  - Use SwiftUI's native `LazyVGrid(columns: columns, spacing: 4, pinnedViews: [.sectionHeaders])` so day headers pin stickily to the top under the filter bar during scrolling.
  - Design headers to feel authentically Apple: sleek typography (SF Pro rounded), frosted translucent backdrop (`.ultraThinMaterial` / subtle dark blur), date label (e.g. `Monday, Jan 15, 2024`), and photo count.
  - Support all existing `TriageFilter` categories (Unsorted, Trash, HD Only, Keep) and batch multi-select mode seamlessly.
- **Non-Goals / Anti-Goals:**
  - Do not introduce complex geometry readers or coordinate space observers that cause scroll jank.
  - Do not alter underlying `TriageAsset` models or server API schemas.

## Approaches Considered
1. **Approach A (Selected): Pinned Sticky Day Headers via `LazyVGrid(pinnedViews: [.sectionHeaders])`.**
   - *Pros:* 100% native Apple Photos UX, 60fps hardware-accelerated scroll, robust section-based grouping, zero frame dropping.
   - *User Decision:* Selected by user.
2. **Approach B (Discarded): Floating Date Pill Overlay via Geometry Reader.**
   - *Pros:* Preserves single flat grid list.
   - *Cons:* Prone to scroll coordinate lag on high-refresh ProMotion screens; doesn't provide visual day grouping boundaries.

## Architecture & Implementation Spec
### 1. Daily Section Struct
In `GridTriageView.swift`:
```swift
public struct DailyAssetSection: Identifiable, Sendable {
    public let id: String
    public let date: Date
    public let title: String
    public let assets: [TriageAsset]
}
```

### 2. Grouping Logic
Compute `groupedDailyAssets: [DailyAssetSection]` from `displayAssets`:
- Group by calendar date (`startOfDay`).
- Format date using DateFormatter with template `EEEE, MMM d, yyyy` (e.g., "Monday, Jan 15, 2024" or "Today", "Yesterday" if within recent range).
- Preserve asset order within each day.

### 3. Sticky Section Header Component
```swift
private struct DaySectionHeader: View {
    let title: String
    let count: Int
    ...
}
```
With sticky styling:
- Background: Translucent slate background with border divider.
- Text: Bold SF Pro Rounded title + item count badge.

### 4. Grid Layout
```swift
LazyVGrid(columns: columns, spacing: 4, pinnedViews: [.sectionHeaders]) {
    ForEach(groupedDailyAssets) { section in
        Section(header: DaySectionHeader(title: section.title, count: section.assets.count)) {
            ForEach(section.assets) { asset in
                ...
            }
        }
    }
}
```
