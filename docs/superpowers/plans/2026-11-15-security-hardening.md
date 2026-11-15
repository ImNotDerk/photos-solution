# Security Hardening Implementation Plan

**Goal:** Harden the Fastify Mac server (`src/server/`) and native iOS client (`ios/PhotoTriage/`) against arbitrary path rebinding/file deletion, symlink traversal, cross-origin browser drive-by attacks (CSRF/CORS), unbounded multipart uploads, and unverified upload digests.

---

## Task 1: Symlink Protection in Staging Scanner (`src/server/ingest.ts`)
- In `walkDirectory` (`src/server/ingest.ts`), skip entries where `entry.isSymbolicLink()`.
- Prevents symlink attacks where a planted symlink points to sensitive files outside stagingDir.

## Task 2: Path Confinement & Safe Staging Unlink in Backup Engine (`src/server/backup.ts`)
- Export `isPathInsideRoot(childPath: string, rootPath: string): boolean`.
- In `executeBackup`, validate `targetYear` (`/^\d{4}$/`) and `targetMonth` (`/^[A-Z0-9_-]+$/i`).
- Verify `destDir` resolves strictly inside `hardDriveRoot` and every source `file.path` resolves strictly inside `stagingDir`.
- Guard all `safeUnlink(file.path)` calls (both during backup cleanup and trash purging) with `if (isPathInsideRoot(file.path, stagingDir))` to prevent arbitrary file deletion.

## Task 3: Route Input Validation, Bundle Sanitization & Upload Hardening (`src/server/routes.ts`)
- Implement `validateSafeDirectoryInput(inputPath: string): string | null` to reject null bytes, relative traversal (`..`), non-absolute paths, and protected system directories (`/`, `/etc`, `/System`, `/Library`, `/usr`, `/bin`, `/sbin`, `/var/root`, `/private/etc`, `~/.ssh`, `~/.gnupg`).
- Validate incoming `stagingDir` and `hardDriveRoot` across `GET /api/session`, `POST /api/session`, `POST /api/backup`, and `POST /api/upload`.
- In `POST /api/session`, verify all `bundle.previewPath` and `bundle.files[].path` reside inside `stagingDir`.
- In `POST /api/upload`, enforce allowed file part names (`primary`, `live_video`, `edit_sidecar`, `edited_render`), reject dotfiles and unapproved file extensions.
- Support optional `expectedPrimarySha256` in `POST /api/upload`: if provided by client, verify against calculated primary hash and reject with 400 if mismatched.

## Task 4: CORS Lockdown & Multipart Resource Limits (`src/server/index.ts`)
- Replace `origin: true` in `fastifyCors` with a restricted origin handler: allow requests with no Origin, localhost, 127.0.0.1, [::1], and private LAN IPs (`10.*`, `192.168.*`, `172.16-31.*`, `*.local`), rejecting external web origins.
- Set `fastifyMultipart` limits (`fileSize: 200MB`, `files: 4`, `fields: 15`, `fieldSize: 64KB`).

## Task 5: iOS End-to-End SHA-256 Verification & ATS Hardening
- In `ios/PhotoTriage/Services/NetworkManager.swift`:
  - `import CryptoKit`.
  - Add `computeSHA256(for: ExtractedResource) throws -> String`.
  - Include `expectedPrimarySha256` in `POST /api/upload` fields.
  - Verify server response receipt matches `expectedPrimarySha256`.
- In `ios/PhotoTriage/Info.plist`:
  - Set `NSAllowsArbitraryLoads` to `false` (keep `NSAllowsLocalNetworking: true`).
- In `tests/ios/xcode.test.ts`:
  - Update assertion to expect `NSAllowsArbitraryLoads` to be `false`.

## Task 6: Security Regression Tests & Verification
- Add regression tests in `tests/server/upload.test.ts` for:
  - `expectedPrimarySha256` mismatch rejection and matching acceptance.
  - Extension and dotfile filtering.
  - CORS origin rejection of external sites and acceptance of LAN origins.
- Add regression tests in `tests/server/backup.test.ts` for:
  - Path confinement blocking deletion/copying of external files.
- Update `tests/ios/network.test.ts` to verify `NetworkManager.computeSHA256`.
- Run full verification:
  - `npm test`
  - `npm run build`
  - `xcodebuild -project ios/PhotoTriage.xcodeproj -scheme PhotoTriage -destination "generic/platform=iOS" build CODE_SIGNING_ALLOWED=NO`
