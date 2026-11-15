# iPhone-to-Hard-Drive Photo Triage & Verified Backup — Design Spec

**Date:** 2026-11-15  
**Status:** Ready for User Approval  
**Project Size:** Project (Local Mac Web Server + Mobile Web UI + iOS Shortcut Bridge)

---

## 1. Intent & Why

The user has an iPhone with a Lightning port (not USB-C) and backs up photos a month at a time (hundreds of items per batch) to an external hard drive via a Mac laptop using AirDrop with **"All Photos Data"** enabled. Today, managing photos across the phone, laptop, and external hard drive is painful because every batch of photos has **three distinct outcomes**:

1. **Trash (`trash`):** Unwanted photo/video — do not back up to the hard drive, and delete from the iPhone.
2. **Back Up Only (`backup_only`):** Keep in long-term storage on the external hard drive, then delete from the iPhone to free up space once the backup is confirmed.
3. **Back Up + Keep on Phone (`backup_keep`):** Keep in long-term storage on the external hard drive *and* leave on the iPhone.

Previously, because there was no easy way to track which photos on the phone were already backed up, the user could only delete whatever was already backed up and had to manually select subsets multiple times.

This project provides a dedicated **mobile UI on the iPhone** (used while sitting at the laptop) to sort a monthly batch once (switching freely between 1-by-1 and Grid views), automatically organize and verify all kept files (including `"All Photos Data"` sidecars/Live Photos) on the external hard drive in `<Year>/<UPPERCASE_MONTH>` folders (e.g., `2024/JANUARY`), and—only after backup verification succeeds—trigger a fast one-tap batch deletion on the iPhone for the `Trash` and `Back Up Only` photos.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Single-pass sorting on the iPhone (1-by-1 & Grid Views):** Let the user switch seamlessly between a **1-by-1 card/swipe view** and a **Grid view** (with multi-select) to assign each item in a monthly batch (hundreds of items) to `Trash`, `Back Up Only`, or `Back Up + Keep`.
- **Utilitarian, high-density UI (no "vibe-coded" Apple design fluff):** Clean, crisp, high-contrast interface optimized for fast triaging. No excessive frosted glass, decorative gradients, or oversized bouncy cards. Compact typography, monospaced metadata (dates, checksums, file sizes), and tactile responsive action buttons.
- **Full support for AirDrop "All Photos Data" bundles:** Recursively scan the staging directory (including AirDrop subfolders) and group related files sharing an asset ID (`IMG_1234.HEIC`, Live Photo `IMG_1234.MOV`, edit sidecar `IMG_1234.AAE`, and rendered edit `IMG_E1234.HEIC`) into a **single logical item** for sorting, backup, and verification.
- **Automatic `YYYY/MONTH` hard drive organization:** Copy all companion files of `Back Up Only` and `Back Up + Keep` items into `<HardDriveRoot>/<YYYY>/<UPPERCASE_MONTH_NAME>/` (e.g., `2024/JANUARY`, `2026/NOVEMBER`) based on each item's original capture date.
- **Cryptographic/byte-level backup verification before deletion:** Never unlock the phone cleanup step for backed-up items until every companion file of every `Back Up Only` and `Back Up + Keep` item is confirmed to exist on the external hard drive with a matching byte size and SHA-256 checksum.
- **Fast one-tap iPhone cleanup at monthly batch scale (100s of items):** Provide a companion **iOS Shortcut** triggered from the phone web UI that fetches the verified delete payload from the Mac, queries Apple Photos once using the batch's date range (`Date Taken is between minDate and maxDate`), filters in memory by canonical base asset name (`IMG_1234`), and invokes a single native iOS `Delete Photos` confirmation prompt.
- **Forward-looking backup ledger:** Maintain `<HardDriveRoot>/.photo-triage-ledger.json` (mirrored locally on the Mac) tracking all items backed up by this tool going forward so that `Back Up + Keep` photos still on the phone are automatically recognized as `Already Backed Up` if included in a future AirDrop batch.
- **Future-ready API:** Expose a clean local REST API on the Mac so a native SwiftUI iOS app (Approach 3) can plug into the same backend later.

### Non-Goals
- **Offline sorting away from the laptop:** Sorting happens only while sitting at the laptop on local Wi-Fi.
- **Retroactive full-hard-drive indexing:** Existing photos on the phone are not yet on the hard drive (previously, backed-up photos were deleted from the phone), so no slow legacy hard-drive indexer is needed—the ledger tracks backups from this tool going forward.
- **Cloud storage sync or photo editing:** 100% local triage, verified archiving, and phone cleanup only.

### Anti-Goals (Failure Conditions Even If It Technically Works)
- **Allowing phone deletion of `Back Up Only` photos before hard drive verification succeeds:** If the external drive is unplugged, full, or any companion file fails SHA-256 verification, deletion of those items on the phone must remain locked.
- **Accidentally deleting `Back Up + Keep` photos from the iPhone:** `Back Up + Keep` items (and any delete candidate whose canonical filename collides with a `Back Up + Keep` item in the same date window) must never be included in the automatic Shortcut delete payload.
- **Silent file overwrites on filename collisions:** If a file with the same name already exists in `<HardDriveRoot>/<YYYY>/<MONTH>/` with a *different* SHA-256 hash, save the whole asset bundle with a collision-safe suffix (`IMG_1234_2.*`) rather than overwriting.
- **Per-item `Find Photos` database loops in iOS Shortcuts:** Never run `Find Photos` inside a loop of hundreds of items (which times out in iOS Shortcuts); always use a single date-bounded `Find Photos` query followed by fast in-memory name matching.

---

## 3. Constraints

1. **iOS Safari Sandbox:** Mobile Safari cannot read the iOS Camera Roll directly or delete photos from Apple Photos. Batches enter via bulk AirDrop (`All Photos Data` ON) into a staging folder, and iPhone deletion runs via a companion iOS Shortcut calling the native `Delete Photos` action.
2. **AirDrop "All Photos Data" Structure:** When `All Photos Data` is enabled on iOS, macOS places incoming batches inside subfolders in `~/Downloads` (e.g., `AirDrop Photos` or per-item folders) containing the original file (`IMG_1234.HEIC`), Live Photo video (`IMG_1234.MOV`), edit sidecar (`IMG_1234.AAE`), and rendered edit (`IMG_E1234.HEIC`). However, Apple Photos on iOS still indexes the asset under its canonical original basename (`IMG_1234`).
3. **Monthly Batch Scale (Hundreds of Items):** Both the mobile web Grid/1-by-1 UI and the iOS Shortcut cleanup must handle 200–1,000+ items per session smoothly without browser memory bloat or Shortcut execution timeouts.

---

## 4. Approaches Considered

### Approach 1: Bulk AirDrop to Staging + Mac Web App + 1-Tap Cleanup Shortcut *(Selected)*
- **How it works:** The user bulk-selects a month of photos in Apple Photos and AirDrops them (with `All Photos Data` ON) to the Mac staging folder (or imports from `~/Downloads`). The Mac groups companion files into logical items and serves a mobile web UI over local Wi-Fi. After sorting in 1-by-1 or Grid mode, the Mac copies kept asset bundles to `<HardDrive>/<YYYY>/<MONTH>`, verifies every file by byte size and SHA-256 hash, cleans up staging, and unlocks a button that triggers the iOS Shortcut to batch-delete `Trash` + `Back Up Only` photos from the iPhone.
- **Pros:** Instant browsing/video playback while sorting hundreds of photos, full preservation of `All Photos Data` sidecars and Live Photos, and no 7-day app expiration.
- **Trade-offs:** Briefly transfers `Trash` items into staging before deleting them after sorting.

### Approach 2: iOS Shortcut Streams Thumbnails First + Mac Web App
- **How it works:** A Shortcut scans the Camera Roll, uploads thumbnails first, then uploads kept originals after sorting.
- **Pros:** Skips AirDropping `Trash` items.
- **Trade-offs:** Times out on monthly batches of hundreds of photos/videos and loses `All Photos Data` sidecar structure.

### Approach 3: Native iPhone App (SwiftUI via Xcode) + Mac Receiver *(Kept in Back Pocket for Future)*
- **How it works:** A sideloaded SwiftUI app reads `PhotoKit` directly on the iPhone, uploads kept files to the Mac receiver, and calls `PHAssetChangeRequest.deleteAssets`.
- **Pros:** All-in-one native app without AirDrop or Shortcuts.
- **Trade-offs:** Free Apple ID signatures expire every 7 days in Xcode. Kept as a future drop-in client for the same Mac backend API.

---

## 5. System Architecture & Workflow Design

### 5.1 End-to-End Session Flow (User Decisions)
1. **Stage Monthly Batch:** The user selects a month of photos on their iPhone and AirDrops them (with `All Photos Data` ON) to the Mac, then either drops the folder into the configured Staging Folder or clicks **"Import Latest AirDrop from Downloads"**.
2. **Open Mobile UI:** The Mac dashboard displays a scannable **QR Code** for `http://<mac-lan-ip>:<port>`.
3. **Triage (Switching Between 1-by-1 & Grid Views):**
   - **1-by-1 View:** Full-bleed preview (showing the edited render `IMG_E*` when present, with badges for `Live`, `Edited`, `Video`), capture date, total bundle size, `Undo Last`, and three bucket buttons/swipes:
     - **Trash (`🗑️`)** — Do not back up; delete from iPhone.
     - **Back Up Only (`💾 Only`)** — Back up to Hard Drive; delete from iPhone once verified.
     - **Back Up + Keep (`💾 + 📱`)** — Back up to Hard Drive; keep on iPhone.
   - **Grid View:** Virtualized/paginated thumbnail grid supporting hundreds of items with filter tabs (`Unsorted`, `All`, `Trash`, `Back Up Only`, `Back Up + Keep`, `Already Backed Up`), drag/multi-select batch assignment, and tap-to-open in 1-by-1 View.
4. **Execute & Verify Hard Drive Backup:**
   - Tapping **Run Backup** copies all files belonging to `Back Up Only` and `Back Up + Keep` bundles into `<HardDriveRoot>/<YYYY>/<UPPERCASE_MONTH>/` (e.g., `2024/JANUARY`).
   - Every companion file in every bundle is verified on the hard drive by:
     1. File existence on `<HardDriveRoot>/<YYYY>/<UPPERCASE_MONTH>/`.
     2. Exact byte size match.
     3. Exact SHA-256 checksum match.
   - Verified bundles are appended to `<HardDriveRoot>/.photo-triage-ledger.json` (mirrored on the Mac) and removed from staging alongside `Trash` bundles.
5. **Confirmed iPhone Cleanup:**
   - Once 100% of the session's backup files pass verification, the **Verified & Cleanup Screen** unlocks the **Delete X Photos from iPhone** button.
   - Tapping it launches `shortcuts://run-shortcut?name=PhotoTriageCleanup&input=text&text=<encoded-cleanup-url>`, which matches the verified delete list in Apple Photos and triggers a single iOS system delete confirmation dialog.

### 5.2 Technical Decisions (Builder Calls)
- **Tech Stack:** Node.js + TypeScript backend (Fastify/Express) + React, Vite, and Tailwind CSS frontend served on one port.
- **"All Photos Data" Bundle Grouping & Canonical Naming:**
  - Recursively scan the staging directory and group files by canonical asset ID: normalize `IMG_E1234.<ext>` → canonical key `IMG_1234` so `IMG_1234.HEIC`, `IMG_1234.MOV`, `IMG_1234.AAE`, and `IMG_E1234.HEIC` form a single triage item.
  - Display `IMG_E1234` (if present) as the primary preview in the UI; copy and verify **all** files in the bundle when backing up to `<HardDriveRoot>/<YYYY>/<UPPERCASE_MONTH>/`.
  - Send the canonical original basename (`IMG_1234`, without extension and without the `E` edit prefix) to the iOS Shortcut so it matches Apple Photos' `Name` field accurately.
- **Capture Date Extraction (`YYYY/MONTH`):**
  - Extract capture timestamp from EXIF `DateTimeOriginal` / QuickTime `CreationDate` (using `exifr` / macOS `mdls`) from the primary/original asset in the bundle.
  - If EXIF/QuickTime metadata is missing (e.g., screenshots or downloaded images), fall back to file creation time (`birthtime`) for folder placement, and mark `dateReliable: false` on the item.
- **High-Speed, Collision-Safe iOS Shortcut Architecture (Hundreds of Items):**
  - The cleanup endpoint `GET /api/cleanup-batch` returns:
    - `minDate` and `maxDate` (ISO timestamps spanning the delete candidates, padded by ±24 hours for timezone safety).
    - `deleteNamesDelimited`: a pipe-delimited string `|IMG_1001|IMG_1002|...|` of canonical basenames to delete automatically.
    - `manualDeleteItems`: any delete candidate excluded from automatic Shortcut deletion because (a) its canonical basename collides with a `Back Up + Keep` item in the ledger/session, or (b) `dateReliable` is `false` (no EXIF capture date). These are shown on the Cleanup screen with thumbnails so the user can delete those few edge-case items manually in Apple Photos.
  - The **PhotoTriageCleanup** iOS Shortcut uses only 5 actions and zero per-item database queries:
    1. `Get Contents of URL` (fetches JSON from the Mac cleanup endpoint).
    2. `Find Photos` where `Date Taken is between [minDate] and [maxDate]`.
    3. `Repeat with Each` item in `Photos`:
       - `If [deleteNamesDelimited] contains "|[Repeat Item's Name]|"` → `Add [Repeat Item] to Variable [ToDelete]`.
    4. `Delete Photos` (`ToDelete`) — triggers one native iOS confirmation dialog for the entire batch.
    5. `Get Contents of URL` (`POST /api/cleanup-complete`) — marks the session complete in the web UI.
- **Duplicate & Collision Handling:**
  - On staging ingest, hash the primary original file of each bundle and check `.photo-triage-ledger.json`. If already backed up (e.g., a `Back Up + Keep` photo from an earlier month accidentally re-selected), pre-label it `Already Backed Up` so the user doesn't re-sort or re-copy it.
  - On backup copy, if `<HardDriveRoot>/<YYYY>/<MONTH>/<filename>` already exists with a matching SHA-256 hash, mark it verified without re-writing; if the hash differs, suffix all files in the new bundle (`IMG_1234_2.HEIC`, `IMG_1234_2.MOV`, `IMG_1234_2.AAE`, `IMG_E1234_2.HEIC`).

---

## 6. Left to the Builder
- Visual styling, keyboard shortcuts (for testing on laptop), and touch gesture thresholds in 1-by-1 and Grid views.
- Browser-compatible thumbnail/preview generation (using macOS built-in `sips` or `sharp` to cache fast `.jpg` thumbnails for `.HEIC` files so scrolling hundreds of items in Grid view on Mobile Safari is instant).
- Local JSON/SQLite state file for active sorting sessions so refreshing Mobile Safari never loses progress.
