import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { AssetBundle, AssetFile, LedgerEntry, BackupResult } from '../../src/types/index.js';
import { executeBackup, isPathInsideRoot } from '../../src/server/backup.js';
import { computeFileHash, loadLedger, saveLedger, LEDGER_FILENAME } from '../../src/server/ledger.js';

describe('Backup Execution & Byte/Hash Verification', () => {
  let tempDir: string;
  let hardDriveDir: string;
  let stagingDir: string;
  let fakeHomeDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photo-backup-test-'));
    hardDriveDir = path.join(tempDir, 'external-hd');
    stagingDir = path.join(tempDir, 'staging');
    fakeHomeDir = path.join(tempDir, 'fake-home');

    await fs.mkdir(hardDriveDir, { recursive: true });
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.mkdir(fakeHomeDir, { recursive: true });

    process.env.PHOTO_TRIAGE_HOME = fakeHomeDir;
  });

  afterEach(async () => {
    delete process.env.PHOTO_TRIAGE_HOME;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Helper to create test file in staging
  async function createStagingFile(relativePath: string, content: string | Buffer): Promise<{ path: string; size: number }> {
    const fullPath = path.join(stagingDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
    const stats = await fs.stat(fullPath);
    return { path: fullPath, size: stats.size };
  }

  // Helper to check if file exists
  async function fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  describe('executeBackup: basic copy and verification', () => {
    it('should copy companion files for backup_only and backup_keep to <hardDriveRoot>/<YYYY>/<MONTH>/', async () => {
      // Create backup_only bundle with HEIC, MOV, AAE
      const f1 = await createStagingFile('IMG_1001.HEIC', 'Photo 1001 bytes');
      const f2 = await createStagingFile('IMG_1001.MOV', 'Video 1001 bytes');
      const f3 = await createStagingFile('IMG_1001.AAE', 'Sidecar 1001 xml');

      // Create backup_keep bundle with HEIC
      const f4 = await createStagingFile('IMG_1002.HEIC', 'Photo 1002 bytes');

      const bundle1: AssetBundle = {
        id: 'IMG_1001',
        canonicalName: 'IMG_1001',
        files: [
          { path: f1.path, filename: 'IMG_1001.HEIC', ext: '.heic', size: f1.size, role: 'primary' },
          { path: f2.path, filename: 'IMG_1001.MOV', ext: '.mov', size: f2.size, role: 'live_video' },
          { path: f3.path, filename: 'IMG_1001.AAE', ext: '.aae', size: f3.size, role: 'edit_sidecar' },
        ],
        previewPath: f1.path,
        capturedAt: '2024-05-15T10:30:00.000Z',
        targetYear: '2024',
        targetMonth: 'MAY',
        dateReliable: true,
        decision: 'backup_only',
        alreadyBackedUp: false,
      };

      const bundle2: AssetBundle = {
        id: 'IMG_1002',
        canonicalName: 'IMG_1002',
        files: [
          { path: f4.path, filename: 'IMG_1002.HEIC', ext: '.heic', size: f4.size, role: 'primary' },
        ],
        previewPath: f4.path,
        capturedAt: '2024-06-20T14:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'JUNE',
        dateReliable: true,
        decision: 'backup_keep',
        alreadyBackedUp: false,
      };

      const result = await executeBackup([bundle1, bundle2], hardDriveDir, stagingDir);

      expect(result.success).toBe(true);
      expect(result.copiedCount).toBe(4);
      expect(result.verifiedCount).toBe(4);

      // Verify files exist on destination
      const dest1Heic = path.join(hardDriveDir, '2024/MAY/IMG_1001.HEIC');
      const dest1Mov = path.join(hardDriveDir, '2024/MAY/IMG_1001.MOV');
      const dest1Aae = path.join(hardDriveDir, '2024/MAY/IMG_1001.AAE');
      const dest2Heic = path.join(hardDriveDir, '2024/JUNE/IMG_1002.HEIC');

      expect(await fileExists(dest1Heic)).toBe(true);
      expect(await fileExists(dest1Mov)).toBe(true);
      expect(await fileExists(dest1Aae)).toBe(true);
      expect(await fileExists(dest2Heic)).toBe(true);

      // Verify destination SHA-256 and byte sizes match source
      expect(await computeFileHash(dest1Heic)).toBe(crypto.createHash('sha256').update('Photo 1001 bytes').digest('hex'));
      expect(await computeFileHash(dest1Mov)).toBe(crypto.createHash('sha256').update('Video 1001 bytes').digest('hex'));
      expect(await computeFileHash(dest1Aae)).toBe(crypto.createHash('sha256').update('Sidecar 1001 xml').digest('hex'));
      expect(await computeFileHash(dest2Heic)).toBe(crypto.createHash('sha256').update('Photo 1002 bytes').digest('hex'));

      // Verify capturedAt timestamps are preserved on destination files
      const stat1Heic = await fs.stat(dest1Heic);
      const stat1Mov = await fs.stat(dest1Mov);
      const stat1Aae = await fs.stat(dest1Aae);
      const stat2Heic = await fs.stat(dest2Heic);
      const expectedTime1Sec = Math.floor(new Date('2024-05-15T10:30:00.000Z').getTime() / 1000);
      const expectedTime2Sec = Math.floor(new Date('2024-06-20T14:00:00.000Z').getTime() / 1000);
      expect(Math.floor(stat1Heic.mtimeMs / 1000)).toBe(expectedTime1Sec);
      expect(Math.floor(stat1Mov.mtimeMs / 1000)).toBe(expectedTime1Sec);
      expect(Math.floor(stat1Aae.mtimeMs / 1000)).toBe(expectedTime1Sec);
      expect(Math.floor(stat2Heic.mtimeMs / 1000)).toBe(expectedTime2Sec);

      // Verify source files were deleted from staging upon successful 100% verification
      expect(await fileExists(f1.path)).toBe(false);
      expect(await fileExists(f2.path)).toBe(false);
      expect(await fileExists(f3.path)).toBe(false);
      expect(await fileExists(f4.path)).toBe(false);

      // Verify ledger was written to hard drive
      const ledger = await loadLedger(hardDriveDir);
      expect(ledger.size).toBe(2);

      const entry1 = ledger.get(await computeFileHash(dest1Heic));
      expect(entry1).toBeDefined();
      expect(entry1?.canonicalName).toBe('IMG_1001');
      expect(entry1?.targetRelPath).toBe('2024/MAY/IMG_1001.HEIC');
      expect(entry1?.decision).toBe('backup_only');

      const entry2 = ledger.get(await computeFileHash(dest2Heic));
      expect(entry2).toBeDefined();
      expect(entry2?.canonicalName).toBe('IMG_1002');
      expect(entry2?.targetRelPath).toBe('2024/JUNE/IMG_1002.HEIC');
      expect(entry2?.decision).toBe('backup_keep');
    });

    it('should purge trash bundles and keep unsorted bundles intact in staging', async () => {
      // 1. backup_only bundle
      const f1 = await createStagingFile('IMG_2001.HEIC', 'Backup Photo');
      // 2. trash bundle
      const f2 = await createStagingFile('IMG_2002.HEIC', 'Trash Photo');
      // 3. unsorted bundle
      const f3 = await createStagingFile('IMG_2003.HEIC', 'Unsorted Photo');

      const backupBundle: AssetBundle = {
        id: 'IMG_2001',
        canonicalName: 'IMG_2001',
        files: [{ path: f1.path, filename: 'IMG_2001.HEIC', ext: '.heic', size: f1.size, role: 'primary' }],
        previewPath: f1.path,
        capturedAt: '2024-07-01T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'JULY',
        dateReliable: true,
        decision: 'backup_only',
        alreadyBackedUp: false,
      };

      const trashBundle: AssetBundle = {
        id: 'IMG_2002',
        canonicalName: 'IMG_2002',
        files: [{ path: f2.path, filename: 'IMG_2002.HEIC', ext: '.heic', size: f2.size, role: 'primary' }],
        previewPath: f2.path,
        capturedAt: '2024-07-02T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'JULY',
        dateReliable: true,
        decision: 'trash',
        alreadyBackedUp: false,
      };

      const unsortedBundle: AssetBundle = {
        id: 'IMG_2003',
        canonicalName: 'IMG_2003',
        files: [{ path: f3.path, filename: 'IMG_2003.HEIC', ext: '.heic', size: f3.size, role: 'primary' }],
        previewPath: f3.path,
        capturedAt: '2024-07-03T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'JULY',
        dateReliable: true,
        decision: 'unsorted',
        alreadyBackedUp: false,
      };

      const result = await executeBackup([backupBundle, trashBundle, unsortedBundle], hardDriveDir, stagingDir);

      expect(result.success).toBe(true);
      expect(result.copiedCount).toBe(1);
      expect(result.verifiedCount).toBe(1);

      // Backup bundle copied to HD and deleted from staging
      expect(await fileExists(path.join(hardDriveDir, '2024/JULY/IMG_2001.HEIC'))).toBe(true);
      expect(await fileExists(f1.path)).toBe(false);

      // Trash bundle NOT copied to HD, but DELETED from staging
      expect(await fileExists(path.join(hardDriveDir, '2024/JULY/IMG_2002.HEIC'))).toBe(false);
      expect(await fileExists(f2.path)).toBe(false);

      // Unsorted bundle NOT copied to HD, and KEPT in staging
      expect(await fileExists(path.join(hardDriveDir, '2024/JULY/IMG_2003.HEIC'))).toBe(false);
      expect(await fileExists(f3.path)).toBe(true);
    });

    it('should clean up empty subdirectories in stagingDir when files inside are purged', async () => {
      const f1 = await createStagingFile('subfolder/Item1/IMG_3001.HEIC', 'Subfolder Photo');
      const bundle: AssetBundle = {
        id: 'IMG_3001',
        canonicalName: 'IMG_3001',
        files: [{ path: f1.path, filename: 'IMG_3001.HEIC', ext: '.heic', size: f1.size, role: 'primary' }],
        previewPath: f1.path,
        capturedAt: '2024-08-01T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'AUGUST',
        dateReliable: true,
        decision: 'backup_only',
        alreadyBackedUp: false,
      };

      const result = await executeBackup([bundle], hardDriveDir, stagingDir);

      expect(result.success).toBe(true);
      expect(await fileExists(f1.path)).toBe(false);
      // Ensure the empty subdirectories were cleaned up
      expect(await fileExists(path.join(stagingDir, 'subfolder/Item1'))).toBe(false);
      expect(await fileExists(path.join(stagingDir, 'subfolder'))).toBe(false);
      // StagingDir itself should remain intact
      expect(await fileExists(stagingDir)).toBe(true);
    });
  });

  describe('executeBackup: collision handling', () => {
    it('should mark file verified without re-writing if destination file exists with the SAME hash', async () => {
      const content = 'Identical photo content already backed up';
      const f1 = await createStagingFile('IMG_4001.HEIC', content);

      // Pre-create identical file on hard drive
      const destPath = path.join(hardDriveDir, '2024/SEPTEMBER/IMG_4001.HEIC');
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, content);
      const preMtime = (await fs.stat(destPath)).mtimeMs;

      const bundle: AssetBundle = {
        id: 'IMG_4001',
        canonicalName: 'IMG_4001',
        files: [{ path: f1.path, filename: 'IMG_4001.HEIC', ext: '.heic', size: f1.size, role: 'primary' }],
        previewPath: f1.path,
        capturedAt: '2024-09-01T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'SEPTEMBER',
        dateReliable: true,
        decision: 'backup_only',
        alreadyBackedUp: false,
      };

      const result = await executeBackup([bundle], hardDriveDir, stagingDir);

      expect(result.success).toBe(true);
      // Not re-written, so copiedCount is 0, but verifiedCount is 1
      expect(result.copiedCount).toBe(0);
      expect(result.verifiedCount).toBe(1);

      // Destination mtime untouched
      const postMtime = (await fs.stat(destPath)).mtimeMs;
      expect(postMtime).toBe(preMtime);

      // Staging file deleted
      expect(await fileExists(f1.path)).toBe(false);

      // Ledger has entry
      const ledger = await loadLedger(hardDriveDir);
      expect(ledger.size).toBe(1);
    });

    it('should rename all companion files in bundle with suffix _2 if destination file exists with a DIFFERENT hash', async () => {
      const existingContent = 'Original photo on hard drive with different hash';
      const newPhotoContent = 'New photo from iPhone AirDrop';
      const newVideoContent = 'New companion live video';
      const newSidecarContent = 'New sidecar';

      // Pre-create existing file on hard drive
      const destPath = path.join(hardDriveDir, '2024/OCTOBER/IMG_5001.HEIC');
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, existingContent);

      // Staging bundle has same name but different content
      const f1 = await createStagingFile('IMG_5001.HEIC', newPhotoContent);
      const f2 = await createStagingFile('IMG_5001.MOV', newVideoContent);
      const f3 = await createStagingFile('IMG_5001.AAE', newSidecarContent);

      const bundle: AssetBundle = {
        id: 'IMG_5001',
        canonicalName: 'IMG_5001',
        files: [
          { path: f1.path, filename: 'IMG_5001.HEIC', ext: '.heic', size: f1.size, role: 'primary' },
          { path: f2.path, filename: 'IMG_5001.MOV', ext: '.mov', size: f2.size, role: 'live_video' },
          { path: f3.path, filename: 'IMG_5001.AAE', ext: '.aae', size: f3.size, role: 'edit_sidecar' },
        ],
        previewPath: f1.path,
        capturedAt: '2024-10-01T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'OCTOBER',
        dateReliable: true,
        decision: 'backup_only',
        alreadyBackedUp: false,
      };

      const result = await executeBackup([bundle], hardDriveDir, stagingDir);

      expect(result.success).toBe(true);
      expect(result.copiedCount).toBe(3);
      expect(result.verifiedCount).toBe(3);

      // Existing file remains untouched
      expect(await fs.readFile(destPath, 'utf8')).toBe(existingContent);

      // New companion files are saved with suffix _2
      const renamedHeic = path.join(hardDriveDir, '2024/OCTOBER/IMG_5001_2.HEIC');
      const renamedMov = path.join(hardDriveDir, '2024/OCTOBER/IMG_5001_2.MOV');
      const renamedAae = path.join(hardDriveDir, '2024/OCTOBER/IMG_5001_2.AAE');

      expect(await fileExists(renamedHeic)).toBe(true);
      expect(await fileExists(renamedMov)).toBe(true);
      expect(await fileExists(renamedAae)).toBe(true);

      expect(await fs.readFile(renamedHeic, 'utf8')).toBe(newPhotoContent);
      expect(await fs.readFile(renamedMov, 'utf8')).toBe(newVideoContent);
      expect(await fs.readFile(renamedAae, 'utf8')).toBe(newSidecarContent);

      // Ledger has new entry with targetRelPath and canonicalName reflecting _2
      const ledger = await loadLedger(hardDriveDir);
      const newHash = crypto.createHash('sha256').update(newPhotoContent).digest('hex');
      const entry = ledger.get(newHash);
      expect(entry).toBeDefined();
      expect(entry?.targetRelPath).toBe('2024/OCTOBER/IMG_5001_2.HEIC');
      expect(entry?.canonicalName).toBe('IMG_5001_2');
    });

    it('should rename with suffix _3 when both base and _2 exist with different hashes', async () => {
      const destDir = path.join(hardDriveDir, '2024/NOVEMBER');
      await fs.mkdir(destDir, { recursive: true });
      await fs.writeFile(path.join(destDir, 'IMG_6001.HEIC'), 'Version 1');
      await fs.writeFile(path.join(destDir, 'IMG_6001_2.HEIC'), 'Version 2');

      const f1 = await createStagingFile('IMG_6001.HEIC', 'Version 3 (iPhone)');
      const bundle: AssetBundle = {
        id: 'IMG_6001',
        canonicalName: 'IMG_6001',
        files: [{ path: f1.path, filename: 'IMG_6001.HEIC', ext: '.heic', size: f1.size, role: 'primary' }],
        previewPath: f1.path,
        capturedAt: '2024-11-01T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'NOVEMBER',
        dateReliable: true,
        decision: 'backup_only',
        alreadyBackedUp: false,
      };

      const result = await executeBackup([bundle], hardDriveDir, stagingDir);

      expect(result.success).toBe(true);
      const renamedHeic = path.join(destDir, 'IMG_6001_3.HEIC');
      expect(await fileExists(renamedHeic)).toBe(true);
      expect(await fs.readFile(renamedHeic, 'utf8')).toBe('Version 3 (iPhone)');
    });

    it('should correctly rename edited render companions with suffix _2 (e.g. IMG_E1001_2.HEIC)', async () => {
      const destDir = path.join(hardDriveDir, '2024/DECEMBER');
      await fs.mkdir(destDir, { recursive: true });
      await fs.writeFile(path.join(destDir, 'IMG_7001.HEIC'), 'Different original');

      const f1 = await createStagingFile('IMG_7001.HEIC', 'Original Photo');
      const f2 = await createStagingFile('IMG_E7001.HEIC', 'Edited Render');

      const bundle: AssetBundle = {
        id: 'IMG_7001',
        canonicalName: 'IMG_7001',
        files: [
          { path: f1.path, filename: 'IMG_7001.HEIC', ext: '.heic', size: f1.size, role: 'primary' },
          { path: f2.path, filename: 'IMG_E7001.HEIC', ext: '.heic', size: f2.size, role: 'edited_render' },
        ],
        previewPath: f2.path,
        capturedAt: '2024-12-01T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'DECEMBER',
        dateReliable: true,
        decision: 'backup_only',
        alreadyBackedUp: false,
      };

      const result = await executeBackup([bundle], hardDriveDir, stagingDir);

      expect(result.success).toBe(true);
      expect(await fileExists(path.join(destDir, 'IMG_7001_2.HEIC'))).toBe(true);
      expect(await fileExists(path.join(destDir, 'IMG_E7001_2.HEIC'))).toBe(true);
    });

    it('should resolve intra-batch collisions when files in different subdirectories share the same filename in the same candidate batch', async () => {
      const f1 = await createStagingFile('batchA/IMG_9999.HEIC', 'Photo Content A');
      const f2 = await createStagingFile('batchB/IMG_9999.HEIC', 'Photo Content B');
      const f3 = await createStagingFile('batchC/IMG_9999.HEIC', 'Photo Content C');

      const bundle1: AssetBundle = {
        id: 'IMG_9999_A',
        canonicalName: 'IMG_9999',
        files: [{ path: f1.path, filename: 'IMG_9999.HEIC', ext: '.heic', size: f1.size, role: 'primary' }],
        previewPath: f1.path,
        capturedAt: '2024-05-10T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'MAY',
        dateReliable: true,
        decision: 'backup_only',
        alreadyBackedUp: false,
      };

      const bundle2: AssetBundle = {
        id: 'IMG_9999_B',
        canonicalName: 'IMG_9999',
        files: [{ path: f2.path, filename: 'IMG_9999.HEIC', ext: '.heic', size: f2.size, role: 'primary' }],
        previewPath: f2.path,
        capturedAt: '2024-05-10T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'MAY',
        dateReliable: true,
        decision: 'backup_only',
        alreadyBackedUp: false,
      };

      const bundle3: AssetBundle = {
        id: 'IMG_9999_C',
        canonicalName: 'IMG_9999',
        files: [{ path: f3.path, filename: 'IMG_9999.HEIC', ext: '.heic', size: f3.size, role: 'primary' }],
        previewPath: f3.path,
        capturedAt: '2024-05-10T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'MAY',
        dateReliable: true,
        decision: 'backup_only',
        alreadyBackedUp: false,
      };

      const result = await executeBackup([bundle1, bundle2, bundle3], hardDriveDir, stagingDir);

      expect(result.success).toBe(true);
      expect(result.copiedCount).toBe(3);
      expect(result.verifiedCount).toBe(3);

      const destA = path.join(hardDriveDir, '2024/MAY/IMG_9999.HEIC');
      const destB = path.join(hardDriveDir, '2024/MAY/IMG_9999_2.HEIC');
      const destC = path.join(hardDriveDir, '2024/MAY/IMG_9999_3.HEIC');

      expect(await fileExists(destA)).toBe(true);
      expect(await fileExists(destB)).toBe(true);
      expect(await fileExists(destC)).toBe(true);

      expect(await fs.readFile(destA, 'utf8')).toBe('Photo Content A');
      expect(await fs.readFile(destB, 'utf8')).toBe('Photo Content B');
      expect(await fs.readFile(destC, 'utf8')).toBe('Photo Content C');
    });
  });

  describe('executeBackup: failure guards and error handling', () => {
    it('should fail safely if hardDriveRoot does not exist, preserving all staging files', async () => {
      const nonExistentDrive = path.join(tempDir, 'non-existent-drive');
      const f1 = await createStagingFile('IMG_8001.HEIC', 'Photo Content');
      const f2 = await createStagingFile('IMG_8002.HEIC', 'Trash Content');

      const bundle1: AssetBundle = {
        id: 'IMG_8001',
        canonicalName: 'IMG_8001',
        files: [{ path: f1.path, filename: 'IMG_8001.HEIC', ext: '.heic', size: f1.size, role: 'primary' }],
        previewPath: f1.path,
        capturedAt: '2024-01-01T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'JANUARY',
        dateReliable: true,
        decision: 'backup_only',
        alreadyBackedUp: false,
      };

      const bundle2: AssetBundle = {
        id: 'IMG_8002',
        canonicalName: 'IMG_8002',
        files: [{ path: f2.path, filename: 'IMG_8002.HEIC', ext: '.heic', size: f2.size, role: 'primary' }],
        previewPath: f2.path,
        capturedAt: '2024-01-01T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'JANUARY',
        dateReliable: true,
        decision: 'trash',
        alreadyBackedUp: false,
      };

      const result = await executeBackup([bundle1, bundle2], nonExistentDrive, stagingDir);

      expect(result.success).toBe(false);
      expect(result.errors && result.errors.length > 0).toBe(true);
      // Staging files must be preserved!
      expect(await fileExists(f1.path)).toBe(true);
      expect(await fileExists(f2.path)).toBe(true);
    });

    it('should fail safely if hardDriveRoot is not writable', async () => {
      const readOnlyDrive = path.join(tempDir, 'readonly-hd');
      await fs.mkdir(readOnlyDrive, { recursive: true });
      // Make it read-only
      await fs.chmod(readOnlyDrive, 0o444);

      const f1 = await createStagingFile('IMG_8003.HEIC', 'Photo Content');
      const bundle: AssetBundle = {
        id: 'IMG_8003',
        canonicalName: 'IMG_8003',
        files: [{ path: f1.path, filename: 'IMG_8003.HEIC', ext: '.heic', size: f1.size, role: 'primary' }],
        previewPath: f1.path,
        capturedAt: '2024-01-01T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'JANUARY',
        dateReliable: true,
        decision: 'backup_only',
        alreadyBackedUp: false,
      };

      try {
        const result = await executeBackup([bundle], readOnlyDrive, stagingDir);
        expect(result.success).toBe(false);
        expect(result.errors && result.errors.length > 0).toBe(true);
        // Staging file preserved
        expect(await fileExists(f1.path)).toBe(true);
      } finally {
        // Restore permissions for cleanup
        await fs.chmod(readOnlyDrive, 0o777);
      }
    });

    it('should fail if verification detects file size or hash mismatch, preserving staging files and not saving ledger', async () => {
      const f1 = await createStagingFile('IMG_9001.HEIC', 'Source photo content');
      const f2 = await createStagingFile('IMG_9002.HEIC', 'Trash photo content');

      const backupBundle: AssetBundle = {
        id: 'IMG_9001',
        canonicalName: 'IMG_9001',
        files: [{ path: f1.path, filename: 'IMG_9001.HEIC', ext: '.heic', size: f1.size, role: 'primary' }],
        previewPath: f1.path,
        capturedAt: '2024-02-01T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'FEBRUARY',
        dateReliable: true,
        decision: 'backup_only',
        alreadyBackedUp: false,
      };

      const trashBundle: AssetBundle = {
        id: 'IMG_9002',
        canonicalName: 'IMG_9002',
        files: [{ path: f2.path, filename: 'IMG_9002.HEIC', ext: '.heic', size: f2.size, role: 'primary' }],
        previewPath: f2.path,
        capturedAt: '2024-02-01T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'FEBRUARY',
        dateReliable: true,
        decision: 'trash',
        alreadyBackedUp: false,
      };

      // Use copyFile option to corrupt the file during copy to simulate transmission/write corruption
      const result = await executeBackup([backupBundle, trashBundle], hardDriveDir, stagingDir, {
        copyFile: async (_src, dest) => {
          await fs.writeFile(dest, 'Corrupted data that does not match source');
        },
      });

      expect(result.success).toBe(false);
      expect(result.failedFiles && result.failedFiles.length > 0).toBe(true);
      expect(result.errors && result.errors.length > 0).toBe(true);

      // Verification failed, so NO source files in staging are deleted!
      expect(await fileExists(f1.path)).toBe(true);
      expect(await fileExists(f2.path)).toBe(true);

      // Ledger must NOT be saved!
      const ledgerPath = path.join(hardDriveDir, LEDGER_FILENAME);
      expect(await fileExists(ledgerPath)).toBe(false);
    });

    it('should fail if drive fails mid-transfer (I/O error), preserving staging files and not updating ledger', async () => {
      const f1 = await createStagingFile('IMG_9003.HEIC', 'Photo Content');
      const bundle: AssetBundle = {
        id: 'IMG_9003',
        canonicalName: 'IMG_9003',
        files: [{ path: f1.path, filename: 'IMG_9003.HEIC', ext: '.heic', size: f1.size, role: 'primary' }],
        previewPath: f1.path,
        capturedAt: '2024-03-01T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'MARCH',
        dateReliable: true,
        decision: 'backup_only',
        alreadyBackedUp: false,
      };

      const result = await executeBackup([bundle], hardDriveDir, stagingDir, {
        copyFile: async () => {
          throw new Error('EIO: i/o error, disk disconnected');
        },
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('EIO: i/o error, disk disconnected');

      // Staging file preserved
      expect(await fileExists(f1.path)).toBe(true);

      // Ledger not created
      expect(await fileExists(path.join(hardDriveDir, LEDGER_FILENAME))).toBe(false);
    });
  });

  describe('executeBackup: ledger preservation', () => {
    it('should preserve and append to existing ledger entries on hard drive', async () => {
      // Pre-populate ledger with an earlier month's backup
      const existingEntry: LedgerEntry = {
        id: 'IMG_0001',
        canonicalName: 'IMG_0001',
        sha256: 'earlier_month_sha256',
        targetRelPath: '2024/JANUARY/IMG_0001.HEIC',
        capturedAt: '2024-01-05T10:00:00.000Z',
        backedUpAt: '2024-01-06T10:00:00.000Z',
        decision: 'backup_keep',
      };
      await saveLedger(hardDriveDir, [existingEntry]);

      // Now backup a new bundle
      const f1 = await createStagingFile('IMG_0002.HEIC', 'New Month Photo');
      const bundle: AssetBundle = {
        id: 'IMG_0002',
        canonicalName: 'IMG_0002',
        files: [{ path: f1.path, filename: 'IMG_0002.HEIC', ext: '.heic', size: f1.size, role: 'primary' }],
        previewPath: f1.path,
        capturedAt: '2024-02-10T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'FEBRUARY',
        dateReliable: true,
        decision: 'backup_only',
        alreadyBackedUp: false,
      };

      const result = await executeBackup([bundle], hardDriveDir, stagingDir);

      expect(result.success).toBe(true);

      const updatedLedger = await loadLedger(hardDriveDir);
      expect(updatedLedger.size).toBe(2);
      expect(updatedLedger.get('earlier_month_sha256')).toEqual(existingEntry);

      const newHash = crypto.createHash('sha256').update('New Month Photo').digest('hex');
      expect(updatedLedger.has(newHash)).toBe(true);
      expect(updatedLedger.get(newHash)?.targetRelPath).toBe('2024/FEBRUARY/IMG_0002.HEIC');
    });
  });

  describe('Security & Path Confinement Invariants', () => {
    it('isPathInsideRoot accurately detects path containment and rejects traversal', () => {
      expect(isPathInsideRoot('/staging/sub/photo.jpg', '/staging')).toBe(true);
      expect(isPathInsideRoot('/staging/photo.jpg', '/staging')).toBe(true);
      expect(isPathInsideRoot('/staging/../etc/passwd', '/staging')).toBe(false);
      expect(isPathInsideRoot('/staging-other/photo.jpg', '/staging')).toBe(false);
      expect(isPathInsideRoot('/staging', '/staging')).toBe(false); // file cannot be the directory itself
      expect(isPathInsideRoot('', '/staging')).toBe(false);
    });

    it('refuses to execute and never unlinks files outside stagingDir', async () => {
      // Create external file that should NEVER be touched
      const externalFile = path.join(tempDir, 'critical-external-file.txt');
      await fs.writeFile(externalFile, 'DO NOT DELETE OR COPY ME');

      const rogueBundle: AssetBundle = {
        id: 'ROGUE_001',
        canonicalName: 'ROGUE_001',
        files: [{ path: externalFile, filename: 'critical-external-file.txt', ext: '.txt', size: 24, role: 'primary' }],
        previewPath: externalFile,
        capturedAt: '2024-03-01T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'MARCH',
        dateReliable: true,
        decision: 'trash', // attempts to purge external file
        alreadyBackedUp: false,
      };

      const result = await executeBackup([rogueBundle], hardDriveDir, stagingDir);
      expect(result.success).toBe(false);
      expect(result.errors?.length).toBeGreaterThan(0);
      expect(result.errors?.[0]).toMatch(/escapes stagingDir/i);

      // Verify the external file is intact and untouched
      expect(await fileExists(externalFile)).toBe(true);
      const content = await fs.readFile(externalFile, 'utf8');
      expect(content).toBe('DO NOT DELETE OR COPY ME');
    });

    it('rejects path traversal in targetYear or targetMonth', async () => {
      const f1 = await createStagingFile('IMG_TRAVERSAL.HEIC', 'Photo bytes');
      const traversalBundle: AssetBundle = {
        id: 'TRAV_001',
        canonicalName: 'TRAV_001',
        files: [{ path: f1.path, filename: 'IMG_TRAVERSAL.HEIC', ext: '.heic', size: f1.size, role: 'primary' }],
        previewPath: f1.path,
        capturedAt: '2024-03-01T10:00:00.000Z',
        targetYear: '../../etc',
        targetMonth: 'MARCH',
        dateReliable: true,
        decision: 'backup_only',
        alreadyBackedUp: false,
      };

      const result = await executeBackup([traversalBundle], hardDriveDir, stagingDir);
      expect(result.success).toBe(false);
      expect(result.errors?.length).toBeGreaterThan(0);
      expect(result.errors?.[0]).toMatch(/Invalid targetYear/i);
    });
  });
});
