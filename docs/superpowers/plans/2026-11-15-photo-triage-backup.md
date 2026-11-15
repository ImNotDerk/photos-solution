# iPhone-to-Hard-Drive Photo Triage & Verified Backup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Mac web server and mobile web interface that ingests monthly iPhone AirDrop batches ("All Photos Data"), provides a high-density 1-by-1 and Grid triage UI on the iPhone, automatically copies and verifies kept media on an external hard drive in `<Year>/<UPPERCASE_MONTH>` folders via SHA-256 checksums, and unlocks a 1-tap iOS Shortcut to batch-delete offloaded and trash items from Apple Photos.

**Architecture:** A monolithic Node.js + TypeScript Fastify server serves both a REST API and a compiled Vite + React + Tailwind CSS single-page application from a single local LAN port. The backend orchestrates recursive staging ingestion, EXIF extraction, SHA-256 verification against the external hard drive, and ledger tracking. The frontend provides a utilitarian, keyboard/touch-driven UI (free of "vibe-coded" Apple fluff) allowing fast single-item or bulk triage. An iOS Shortcut bridge communicates with the cleanup endpoint to delete photos in Apple Photos in a single prompt.

**Tech Stack:** Node.js (v18+), TypeScript, Fastify, React 18, Vite, Tailwind CSS, `exifr` (EXIF/QuickTime metadata), Vitest (unit/integration testing).

**Spec:** [docs/superpowers/specs/2026-11-15-photo-triage-backup-design.md](file:///Users/derk/Documents/github-repositories/photos-solution/docs/superpowers/specs/2026-11-15-photo-triage-backup-design.md)

## Global Constraints

- Folder hierarchy on external hard drive must strictly follow `<HardDriveRoot>/<YYYY>/<UPPERCASE_MONTH>/` (e.g., `2024/JANUARY`, `2026/NOVEMBER`).
- "All Photos Data" bundles sharing a canonical asset ID (`IMG_1234.HEIC`, `IMG_1234.MOV`, `IMG_1234.AAE`, `IMG_E1234.HEIC`) must be treated as a single triage unit: all companion files are copied, verified, or trashed together.
- No deletion on the iPhone may occur for `backup_only` items until 100% of the destination files exist on the hard drive with matching byte size and SHA-256 checksum.
- `backup_keep` items must never be included in the deletion payload sent to the iOS Shortcut.
- Filename collisions with differing contents must never overwrite existing files on the hard drive; append `_2`, `_3`, etc.
- UI must follow a clean, utilitarian, high-density design (tactile buttons, mono metadata, high contrast, no frosted glass/candy gradients).

## Review Focus

1. **AirDrop Subfolder & Sidecar Parsing:** Incoming files with edited versions (`IMG_E1234.HEIC`) and Live Photo videos (`IMG_1234.MOV`) scattered in nested subfolders must correctly map to the canonical ID `IMG_1234`.
2. **Missing/Stripped EXIF Metadata:** Screenshots or saved graphics without EXIF `DateTimeOriginal` must fall back to file `birthtime` and be flagged as `dateReliable: false` so they are excluded from the date-bounded Shortcut cleanup.
3. **Hard Drive Disconnect/Read-Only During Backup:** If the external hard drive is disconnected or becomes unwritable mid-transfer, the backup transaction must abort and lock phone deletion.
4. **Collision with Previously Backed-Up "Keep" Items:** If a new photo to be deleted has the exact same filename as a photo stored as `backup_keep` in the ledger, the automated Shortcut delete must exclude it to prevent accidental loss on the iPhone.
5. **Shortcut Date Boundary Padding:** Timezone offsets between the Mac and iPhone could cause `Find Photos` to miss photos taken at midnight; the query window must be padded by ±24 hours.

---

### Task 1: Project Scaffolding & Core Types

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `src/types/index.ts`
- Test: `tests/types.test.ts`

**Interfaces:**
- Produces: `AssetBundle`, `TriageDecision`, `LedgerEntry`, `SessionState`, `CleanupBatchResponse`

- [ ] **Step 1: Initialize git repository and directory structure**
```bash
git init
mkdir -p src/types src/server src/client tests/fixtures
```

- [ ] **Step 2: Create package.json and configuration files**
Install dependencies: `fastify`, `@fastify/static`, `@fastify/cors`, `exifr`, `qrcode`, `react`, `react-dom`, `lucide-react`, and dev dependencies `typescript`, `vite`, `tailwindcss`, `vitest`, `@types/node`.

- [ ] **Step 3: Define domain types in `src/types/index.ts`**
Define:
- `TriageDecision = 'unsorted' | 'trash' | 'backup_only' | 'backup_keep'`
- `AssetFile = { path: string; filename: string; ext: string; size: number; role: 'primary' | 'live_video' | 'edit_sidecar' | 'edited_render' }`
- `AssetBundle = { id: string; canonicalName: string; files: AssetFile[]; previewPath: string; capturedAt: string; targetYear: string; targetMonth: string; dateReliable: boolean; decision: TriageDecision; alreadyBackedUp: boolean }`
- `LedgerEntry = { id: string; canonicalName: string; sha256: string; targetRelPath: string; capturedAt: string; backedUpAt: string; decision: 'backup_only' | 'backup_keep' }`

- [ ] **Step 4: Write test verifying type imports and package build**
Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add .
git commit -m "chore: scaffold project structure, configuration, and domain types"
```

---

### Task 2: AirDrop Staging Scanner & Bundle Grouping

**Files:**
- Create: `src/server/ingest.ts`
- Test: `tests/server/ingest.test.ts`

**Interfaces:**
- Consumes: `src/types/index.ts`
- Produces: `scanStagingDirectory(stagingDir: string): Promise<AssetBundle[]>`

- [ ] **Step 1: Write failing test for staging ingestion**
Create mock staging directory containing:
- `IMG_1001.HEIC` + `IMG_1001.MOV` + `IMG_1001.AAE`
- Subfolder `Item2/IMG_E1002.HEIC` + `Item2/IMG_1002.HEIC` + `Item2/IMG_1002.MOV`
- `Screenshot.PNG` (no EXIF)
Assert that `scanStagingDirectory` produces 3 bundles, correctly grouping Live Photos, edited renders, and extracting target `YYYY/MONTH`.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/server/ingest.test.ts`
Expected: FAIL with "scanStagingDirectory is not defined"

- [ ] **Step 3: Implement `scanStagingDirectory` in `src/server/ingest.ts`**
- Recursive filesystem walk with `fs.readdir(..., { withFileTypes: true })`.
- Canonical ID normalization: strip `IMG_E` → `IMG_`.
- Extract capture date via `exifr.parse()` for `DateTimeOriginal` or `QuickTime:CreationDate`. Fall back to `birthtime` with `dateReliable: false`.
- Compute target uppercase month name: `JANUARY`, `FEBRUARY`, etc.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/server/ingest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/server/ingest.ts tests/server/ingest.test.ts
git commit -m "feat: implement recursive staging ingest and All Photos Data bundle parser"
```

---

### Task 3: Ledger & Duplicate Detection Engine

**Files:**
- Create: `src/server/ledger.ts`
- Test: `tests/server/ledger.test.ts`

**Interfaces:**
- Consumes: `AssetBundle`, `LedgerEntry`
- Produces:
  - `loadLedger(hardDriveRoot: string): Promise<Map<string, LedgerEntry>>`
  - `saveLedger(hardDriveRoot: string, entries: LedgerEntry[]): Promise<void>`
  - `checkDuplicates(bundles: AssetBundle[], ledger: Map<string, LedgerEntry>): Promise<AssetBundle[]>`
  - `computeFileHash(filePath: string): Promise<string>`

- [ ] **Step 1: Write failing test for ledger loading, hashing, and duplicate detection**
Test ledger read/write to `<hardDriveRoot>/.photo-triage-ledger.json`, duplicate detection by SHA-256 hash, and automatic `Already Backed Up` marking.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/server/ledger.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement ledger operations in `src/server/ledger.ts`**
- Streaming SHA-256 hashing via `crypto.createHash('sha256')`.
- Safe atomic write for `.photo-triage-ledger.json` (write to `.tmp` then rename).
- Mirror copy saved in `~/.photo-triage/ledger-backup.json`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/server/ledger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/server/ledger.ts tests/server/ledger.test.ts
git commit -m "feat: implement SHA-256 ledger engine and duplicate detection"
```

---

### Task 4: Backup Execution & Byte/Hash Verification

**Files:**
- Create: `src/server/backup.ts`
- Test: `tests/server/backup.test.ts`

**Interfaces:**
- Consumes: `AssetBundle`, `LedgerEntry`
- Produces: `executeBackup(bundles: AssetBundle[], hardDriveRoot: string, stagingDir: string): Promise<BackupResult>`

- [ ] **Step 1: Write failing test for backup execution and verification**
Assert:
1. Files for `backup_only` and `backup_keep` are copied to `<hardDriveRoot>/<YYYY>/<MONTH>/`.
2. Existing destination files with different hashes are renamed with `_2`.
3. Destination file existence, size, and SHA-256 match source.
4. On 100% verification, source files in staging (and `trash` items) are deleted.
5. If verification fails on any file, staging files are preserved and `success: false` is returned.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/server/backup.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `executeBackup` in `src/server/backup.ts`**
- Check write permissions on `hardDriveRoot`.
- Copy each bundle's companion files (`HEIC`, `MOV`, `AAE`).
- Verification phase: check byte sizes and re-hash destination files.
- Staging purge: clean verified kept files and trash files.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/server/backup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/server/backup.ts tests/server/backup.test.ts
git commit -m "feat: implement verified hard drive backup executor with collision safety"
```

---

### Task 5: Cleanup API & iOS Shortcut Integration

**Files:**
- Create: `src/server/cleanup.ts`
- Create: `src/server/routes.ts`
- Test: `tests/server/cleanup.test.ts`

**Interfaces:**
- Consumes: `AssetBundle[]`, `SessionState`
- Produces: `generateCleanupPayload(bundles: AssetBundle[], ledger: Map<string, LedgerEntry>): CleanupBatchResponse`

- [ ] **Step 1: Write failing test for cleanup payload generation**
Assert:
- `minDate` and `maxDate` span candidate dates with ±24 hour padding.
- `deleteNamesDelimited` contains pipe-delimited canonical names (e.g. `|IMG_1001|IMG_1002|`).
- Candidates that collide with `backup_keep` photos in the ledger or have `dateReliable: false` are separated into `manualDeleteItems`.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/server/cleanup.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `generateCleanupPayload` and Fastify routes**
- Endpoints:
  - `GET /api/session`: current staging batch and triage counts.
  - `POST /api/triage`: update bundle decisions.
  - `POST /api/backup`: run backup & verification.
  - `GET /api/cleanup-batch`: returns the payload for iOS Shortcut.
  - `POST /api/cleanup-complete`: records cleanup completion.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/server/cleanup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/server/cleanup.ts src/server/routes.ts tests/server/cleanup.test.ts
git commit -m "feat: implement cleanup payload generator and REST API routes"
```

---

### Task 6: Utilitarian Mobile & Desktop Web UI

**Files:**
- Create: `src/client/index.html`
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/components/SingleView.tsx`
- Create: `src/client/components/GridView.tsx`
- Create: `src/client/components/CleanupView.tsx`
- Create: `src/client/components/DesktopStatus.tsx`
- Test: `tests/client/ui.test.tsx`

**Interfaces:**
- Communicates with `/api/*` endpoints.
- Provides tactile 1-by-1 triage, grid multi-select, and post-backup cleanup screen.

- [ ] **Step 1: Write failing component test for SingleView and GridView**
Verify button actions trigger state updates, keyboard shortcuts (`1`, `2`, `3`, `u`) change active item, and high-density styling classes are applied.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/client/ui.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement React components with utilitarian design**
- High-contrast, dense layout: dark slate background, monospaced metadata headers, crisp 1px borders, clear status badges.
- `SingleView`: Full-bleed preview, touch swipe gestures, Live Photo / Edit indicators, tactile buttons.
- `GridView`: Virtualized grid, multi-select box, filter tabs (`Unsorted`, `Trash`, `HD Only`, `HD+Phone`).
- `CleanupView`: Verification status badge, breakdown of files, and direct `shortcuts://run-shortcut?name=PhotoTriageCleanup` link.
- `DesktopStatus`: QR code for mobile connection, hard drive mount monitor, AirDrop import button.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/client/ui.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/client/ tests/client/
git commit -m "feat: implement utilitarian mobile web UI and desktop dashboard"
```

---

### Task 7: End-to-End Workflow & Documentation

**Files:**
- Create: `src/server/index.ts`
- Create: `docs/shortcut-guide.md`
- Create: `README.md`
- Test: `tests/e2e/workflow.test.ts`

**Interfaces:**
- Complete CLI entry point (`npm start`) launching server, scanning LAN IP, and printing terminal QR code.

- [ ] **Step 1: Write integration test covering complete flow**
Mock staging folder → ingest → triage → backup to mock external drive → verify checksums → request cleanup payload.

- [ ] **Step 2: Implement server runner in `src/server/index.ts`**
Integrate Fastify, static file serving, terminal QR code display (`qrcode-terminal`), and auto-detection of `~/Downloads/AirDrop*`.

- [ ] **Step 3: Create `docs/shortcut-guide.md`**
Document the exact 5-action iOS Shortcut setup with screenshots and copy-pasteable configuration.

- [ ] **Step 4: Run full test suite**
Run: `npm test`
Expected: All unit, integration, and E2E tests PASS.

- [ ] **Step 5: Commit**
```bash
git add src/server/index.ts docs/shortcut-guide.md README.md tests/e2e/
git commit -m "feat: complete end-to-end server integration and iOS Shortcut documentation"
```
