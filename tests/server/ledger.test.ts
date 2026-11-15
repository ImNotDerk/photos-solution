import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { AssetBundle, AssetFile, LedgerEntry } from '../../src/types/index.js';
import {
  computeFileHash,
  loadLedger,
  saveLedger,
  checkDuplicates,
  LEDGER_FILENAME,
  LEDGER_BACKUP_DIR,
  LEDGER_BACKUP_FILENAME,
} from '../../src/server/ledger.js';

describe('Ledger & Duplicate Detection Engine', () => {
  let tempDir: string;
  let hardDriveDir: string;
  let stagingDir: string;
  let fakeHomeDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photo-triage-ledger-test-'));
    hardDriveDir = path.join(tempDir, 'external-hd');
    stagingDir = path.join(tempDir, 'staging');
    fakeHomeDir = path.join(tempDir, 'fake-home');

    await fs.mkdir(hardDriveDir, { recursive: true });
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.mkdir(fakeHomeDir, { recursive: true });

    // Set custom home directory for ledger backup testing
    process.env.PHOTO_TRIAGE_HOME = fakeHomeDir;
  });

  afterEach(async () => {
    delete process.env.PHOTO_TRIAGE_HOME;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('computeFileHash', () => {
    it('should compute the correct SHA-256 hash for a text file', async () => {
      const filePath = path.join(stagingDir, 'sample.txt');
      const content = 'Hello Photo Triage!';
      await fs.writeFile(filePath, content, 'utf8');

      const expectedHash = crypto.createHash('sha256').update(content).digest('hex');
      const hash = await computeFileHash(filePath);

      expect(hash).toBe(expectedHash);
    });

    it('should compute the correct SHA-256 hash for an empty file', async () => {
      const filePath = path.join(stagingDir, 'empty.txt');
      await fs.writeFile(filePath, '', 'utf8');

      const expectedHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const hash = await computeFileHash(filePath);

      expect(hash).toBe(expectedHash);
    });

    it('should compute the correct SHA-256 hash for binary data', async () => {
      const filePath = path.join(stagingDir, 'sample.bin');
      const buffer = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x42, 0xaa, 0x55]);
      await fs.writeFile(filePath, buffer);

      const expectedHash = crypto.createHash('sha256').update(buffer).digest('hex');
      const hash = await computeFileHash(filePath);

      expect(hash).toBe(expectedHash);
    });

    it('should reject if the file does not exist', async () => {
      const nonExistent = path.join(stagingDir, 'does-not-exist.jpg');
      await expect(computeFileHash(nonExistent)).rejects.toThrow();
    });
  });

  describe('loadLedger', () => {
    it('should return an empty Map if .photo-triage-ledger.json does not exist', async () => {
      const ledger = await loadLedger(hardDriveDir);
      expect(ledger).toBeInstanceOf(Map);
      expect(ledger.size).toBe(0);
    });

    it('should return an empty Map if hard drive root directory does not exist', async () => {
      const nonExistentDir = path.join(tempDir, 'non-existent-drive');
      const ledger = await loadLedger(nonExistentDir);
      expect(ledger).toBeInstanceOf(Map);
      expect(ledger.size).toBe(0);
    });

    it('should load entries from .photo-triage-ledger.json keyed by sha256', async () => {
      const entries: LedgerEntry[] = [
        {
          id: 'IMG_1001',
          canonicalName: 'IMG_1001',
          sha256: 'abc123hash',
          targetRelPath: '2024/JANUARY/IMG_1001.HEIC',
          capturedAt: '2024-01-15T10:30:00.000Z',
          backedUpAt: '2024-02-01T12:00:00.000Z',
          decision: 'backup_keep',
        },
        {
          id: 'IMG_1002',
          canonicalName: 'IMG_1002',
          sha256: 'def456hash',
          targetRelPath: '2024/FEBRUARY/IMG_1002.HEIC',
          capturedAt: '2024-02-14T14:20:00.000Z',
          backedUpAt: '2024-03-01T12:00:00.000Z',
          decision: 'backup_only',
        },
      ];

      const ledgerPath = path.join(hardDriveDir, LEDGER_FILENAME);
      await fs.writeFile(ledgerPath, JSON.stringify(entries, null, 2), 'utf8');

      const ledger = await loadLedger(hardDriveDir);
      expect(ledger.size).toBe(2);
      expect(ledger.get('abc123hash')).toEqual(entries[0]);
      expect(ledger.get('def456hash')).toEqual(entries[1]);
    });

    it('should handle object-keyed ledger format as well as array format', async () => {
      const entry: LedgerEntry = {
        id: 'IMG_1003',
        canonicalName: 'IMG_1003',
        sha256: '789xyzhash',
        targetRelPath: '2024/MARCH/IMG_1003.JPG',
        capturedAt: '2024-03-10T08:00:00.000Z',
        backedUpAt: '2024-04-01T12:00:00.000Z',
        decision: 'backup_keep',
      };

      const ledgerPath = path.join(hardDriveDir, LEDGER_FILENAME);
      await fs.writeFile(ledgerPath, JSON.stringify({ '789xyzhash': entry }, null, 2), 'utf8');

      const ledger = await loadLedger(hardDriveDir);
      expect(ledger.size).toBe(1);
      expect(ledger.get('789xyzhash')).toEqual(entry);
    });

    it('should return empty Map if ledger file is empty', async () => {
      const ledgerPath = path.join(hardDriveDir, LEDGER_FILENAME);
      await fs.writeFile(ledgerPath, '', 'utf8');

      const ledger = await loadLedger(hardDriveDir);
      expect(ledger.size).toBe(0);
    });
  });

  describe('saveLedger', () => {
    it('should perform an atomic write to <hardDriveRoot>/.photo-triage-ledger.json and mirror to backup dir', async () => {
      const entries: LedgerEntry[] = [
        {
          id: 'IMG_2001',
          canonicalName: 'IMG_2001',
          sha256: 'sha256_2001',
          targetRelPath: '2024/JULY/IMG_2001.HEIC',
          capturedAt: '2024-07-04T12:00:00.000Z',
          backedUpAt: '2024-07-05T08:00:00.000Z',
          decision: 'backup_keep',
        },
      ];

      await saveLedger(hardDriveDir, entries);

      // Verify primary ledger file exists and matches entries
      const primaryPath = path.join(hardDriveDir, LEDGER_FILENAME);
      const primaryData = await fs.readFile(primaryPath, 'utf8');
      expect(JSON.parse(primaryData)).toEqual(entries);

      // Verify no temporary files left in hard drive dir
      const hdFiles = await fs.readdir(hardDriveDir);
      expect(hdFiles).toEqual([LEDGER_FILENAME]);

      // Verify mirror backup copy exists in ~/.photo-triage/ledger-backup.json
      const backupDir = path.join(fakeHomeDir, LEDGER_BACKUP_DIR);
      const backupPath = path.join(backupDir, LEDGER_BACKUP_FILENAME);
      const backupData = await fs.readFile(backupPath, 'utf8');
      expect(JSON.parse(backupData)).toEqual(entries);
    });

    it('should accept a Map of entries as well as an array', async () => {
      const entry: LedgerEntry = {
        id: 'IMG_2002',
        canonicalName: 'IMG_2002',
        sha256: 'sha256_2002',
        targetRelPath: '2024/AUGUST/IMG_2002.HEIC',
        capturedAt: '2024-08-15T15:00:00.000Z',
        backedUpAt: '2024-08-16T09:00:00.000Z',
        decision: 'backup_only',
      };

      const ledgerMap = new Map<string, LedgerEntry>();
      ledgerMap.set(entry.sha256, entry);

      await saveLedger(hardDriveDir, ledgerMap);

      const loaded = await loadLedger(hardDriveDir);
      expect(loaded.size).toBe(1);
      expect(loaded.get('sha256_2002')).toEqual(entry);
    });

    it('should create hardDriveRoot if it does not already exist', async () => {
      const newDrive = path.join(tempDir, 'brand-new-volume', 'backup');
      const entry: LedgerEntry = {
        id: 'IMG_3001',
        canonicalName: 'IMG_3001',
        sha256: 'sha256_3001',
        targetRelPath: '2024/SEPTEMBER/IMG_3001.HEIC',
        capturedAt: '2024-09-01T10:00:00.000Z',
        backedUpAt: '2024-09-02T10:00:00.000Z',
        decision: 'backup_keep',
      };

      await saveLedger(newDrive, [entry]);

      const loaded = await loadLedger(newDrive);
      expect(loaded.size).toBe(1);
      expect(loaded.get('sha256_3001')).toEqual(entry);
    });
  });

  describe('checkDuplicates', () => {
    it('should mark duplicate bundle as alreadyBackedUp = true and decision = backup_keep when destination exists', async () => {
      // 1. Create file on staging
      const stagingFile = path.join(stagingDir, 'IMG_5001.HEIC');
      await fs.writeFile(stagingFile, 'Photo 5001 Content', 'utf8');
      const fileHash = await computeFileHash(stagingFile);

      // 2. Create destination file on hard drive
      const relPath = '2024/MAY/IMG_5001.HEIC';
      const destFile = path.join(hardDriveDir, relPath);
      await fs.mkdir(path.dirname(destFile), { recursive: true });
      await fs.writeFile(destFile, 'Photo 5001 Content', 'utf8');

      // 3. Prepare ledger with this entry
      const ledger = new Map<string, LedgerEntry>();
      ledger.set(fileHash, {
        id: 'IMG_5001',
        canonicalName: 'IMG_5001',
        sha256: fileHash,
        targetRelPath: relPath,
        capturedAt: '2024-05-10T12:00:00.000Z',
        backedUpAt: '2024-05-11T12:00:00.000Z',
        decision: 'backup_keep',
      });

      // 4. Create AssetBundle
      const bundle: AssetBundle = {
        id: 'IMG_5001',
        canonicalName: 'IMG_5001',
        files: [
          {
            path: stagingFile,
            filename: 'IMG_5001.HEIC',
            ext: '.heic',
            size: 18,
            role: 'primary',
          },
        ],
        previewPath: stagingFile,
        capturedAt: '2024-05-10T12:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'MAY',
        dateReliable: true,
        decision: 'unsorted',
        alreadyBackedUp: false,
      };

      const result = await checkDuplicates([bundle], ledger, hardDriveDir);

      expect(result).toHaveLength(1);
      expect(result[0].alreadyBackedUp).toBe(true);
      expect(result[0].decision).toBe('backup_keep');
    });

    it('should NOT mark bundle as alreadyBackedUp if destination file on hard drive does not exist', async () => {
      // Staging file exists
      const stagingFile = path.join(stagingDir, 'IMG_5002.HEIC');
      await fs.writeFile(stagingFile, 'Photo 5002 Content', 'utf8');
      const fileHash = await computeFileHash(stagingFile);

      // Destination file does NOT exist on hard drive
      const relPath = '2024/JUNE/IMG_5002.HEIC';

      const ledger = new Map<string, LedgerEntry>();
      ledger.set(fileHash, {
        id: 'IMG_5002',
        canonicalName: 'IMG_5002',
        sha256: fileHash,
        targetRelPath: relPath,
        capturedAt: '2024-06-10T12:00:00.000Z',
        backedUpAt: '2024-06-11T12:00:00.000Z',
        decision: 'backup_keep',
      });

      const bundle: AssetBundle = {
        id: 'IMG_5002',
        canonicalName: 'IMG_5002',
        files: [
          {
            path: stagingFile,
            filename: 'IMG_5002.HEIC',
            ext: '.heic',
            size: 18,
            role: 'primary',
          },
        ],
        previewPath: stagingFile,
        capturedAt: '2024-06-10T12:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'JUNE',
        dateReliable: true,
        decision: 'unsorted',
        alreadyBackedUp: false,
      };

      const result = await checkDuplicates([bundle], ledger, hardDriveDir);

      expect(result[0].alreadyBackedUp).toBe(false);
      expect(result[0].decision).toBe('unsorted');
    });

    it('should NOT mark bundle as alreadyBackedUp if file hash is not in ledger', async () => {
      const stagingFile = path.join(stagingDir, 'IMG_5003.HEIC');
      await fs.writeFile(stagingFile, 'Brand New Photo Content', 'utf8');

      const ledger = new Map<string, LedgerEntry>();

      const bundle: AssetBundle = {
        id: 'IMG_5003',
        canonicalName: 'IMG_5003',
        files: [
          {
            path: stagingFile,
            filename: 'IMG_5003.HEIC',
            ext: '.heic',
            size: 23,
            role: 'primary',
          },
        ],
        previewPath: stagingFile,
        capturedAt: '2024-06-15T12:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'JUNE',
        dateReliable: true,
        decision: 'unsorted',
        alreadyBackedUp: false,
      };

      const result = await checkDuplicates([bundle], ledger, hardDriveDir);

      expect(result[0].alreadyBackedUp).toBe(false);
      expect(result[0].decision).toBe('unsorted');
    });

    it('should correctly select the primary file to hash when bundle contains companion files', async () => {
      // Primary photo
      const primaryFile = path.join(stagingDir, 'IMG_5004.HEIC');
      await fs.writeFile(primaryFile, 'Primary Photo Content', 'utf8');
      const primaryHash = await computeFileHash(primaryFile);

      // Live video companion
      const liveVideoFile = path.join(stagingDir, 'IMG_5004.MOV');
      await fs.writeFile(liveVideoFile, 'Live Video Content', 'utf8');

      // Sidecar
      const sidecarFile = path.join(stagingDir, 'IMG_5004.AAE');
      await fs.writeFile(sidecarFile, 'Sidecar Content', 'utf8');

      // Create destination on hard drive
      const relPath = '2024/MAY/IMG_5004.HEIC';
      const destFile = path.join(hardDriveDir, relPath);
      await fs.mkdir(path.dirname(destFile), { recursive: true });
      await fs.writeFile(destFile, 'Primary Photo Content', 'utf8');

      const ledger = new Map<string, LedgerEntry>();
      ledger.set(primaryHash, {
        id: 'IMG_5004',
        canonicalName: 'IMG_5004',
        sha256: primaryHash,
        targetRelPath: relPath,
        capturedAt: '2024-05-20T12:00:00.000Z',
        backedUpAt: '2024-05-21T12:00:00.000Z',
        decision: 'backup_keep',
      });

      const bundle: AssetBundle = {
        id: 'IMG_5004',
        canonicalName: 'IMG_5004',
        files: [
          {
            path: sidecarFile,
            filename: 'IMG_5004.AAE',
            ext: '.aae',
            size: 15,
            role: 'edit_sidecar',
          },
          {
            path: liveVideoFile,
            filename: 'IMG_5004.MOV',
            ext: '.mov',
            size: 18,
            role: 'live_video',
          },
          {
            path: primaryFile,
            filename: 'IMG_5004.HEIC',
            ext: '.heic',
            size: 21,
            role: 'primary',
          },
        ],
        previewPath: primaryFile,
        capturedAt: '2024-05-20T12:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'MAY',
        dateReliable: true,
        decision: 'unsorted',
        alreadyBackedUp: false,
      };

      const result = await checkDuplicates([bundle], ledger, hardDriveDir);

      expect(result[0].alreadyBackedUp).toBe(true);
      expect(result[0].decision).toBe('backup_keep');
    });

    it('should support checkDuplicates without hardDriveRoot parameter', async () => {
      const stagingFile = path.join(stagingDir, 'IMG_5005.HEIC');
      await fs.writeFile(stagingFile, 'Photo 5005 Content', 'utf8');
      const fileHash = await computeFileHash(stagingFile);

      const ledger = new Map<string, LedgerEntry>();
      ledger.set(fileHash, {
        id: 'IMG_5005',
        canonicalName: 'IMG_5005',
        sha256: fileHash,
        targetRelPath: '2024/MAY/IMG_5005.HEIC',
        capturedAt: '2024-05-25T12:00:00.000Z',
        backedUpAt: '2024-05-26T12:00:00.000Z',
        decision: 'backup_keep',
      });

      const bundle: AssetBundle = {
        id: 'IMG_5005',
        canonicalName: 'IMG_5005',
        files: [
          {
            path: stagingFile,
            filename: 'IMG_5005.HEIC',
            ext: '.heic',
            size: 18,
            role: 'primary',
          },
        ],
        previewPath: stagingFile,
        capturedAt: '2024-05-25T12:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'MAY',
        dateReliable: true,
        decision: 'unsorted',
        alreadyBackedUp: false,
      };

      const result = await checkDuplicates([bundle], ledger);
      expect(result[0].alreadyBackedUp).toBe(true);
      expect(result[0].decision).toBe('backup_keep');
    });

    it('should handle batch with mixed duplicate and new bundles', async () => {
      // 1. Existing duplicate
      const file1 = path.join(stagingDir, 'IMG_6001.HEIC');
      await fs.writeFile(file1, 'Photo 6001', 'utf8');
      const hash1 = await computeFileHash(file1);

      const dest1 = path.join(hardDriveDir, '2024/JANUARY/IMG_6001.HEIC');
      await fs.mkdir(path.dirname(dest1), { recursive: true });
      await fs.writeFile(dest1, 'Photo 6001', 'utf8');

      // 2. New photo
      const file2 = path.join(stagingDir, 'IMG_6002.HEIC');
      await fs.writeFile(file2, 'Photo 6002', 'utf8');

      const ledger = new Map<string, LedgerEntry>();
      ledger.set(hash1, {
        id: 'IMG_6001',
        canonicalName: 'IMG_6001',
        sha256: hash1,
        targetRelPath: '2024/JANUARY/IMG_6001.HEIC',
        capturedAt: '2024-01-01T12:00:00.000Z',
        backedUpAt: '2024-01-02T12:00:00.000Z',
        decision: 'backup_keep',
      });

      const bundle1: AssetBundle = {
        id: 'IMG_6001',
        canonicalName: 'IMG_6001',
        files: [{ path: file1, filename: 'IMG_6001.HEIC', ext: '.heic', size: 10, role: 'primary' }],
        previewPath: file1,
        capturedAt: '2024-01-01T12:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'JANUARY',
        dateReliable: true,
        decision: 'unsorted',
        alreadyBackedUp: false,
      };

      const bundle2: AssetBundle = {
        id: 'IMG_6002',
        canonicalName: 'IMG_6002',
        files: [{ path: file2, filename: 'IMG_6002.HEIC', ext: '.heic', size: 10, role: 'primary' }],
        previewPath: file2,
        capturedAt: '2024-01-02T12:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'JANUARY',
        dateReliable: true,
        decision: 'unsorted',
        alreadyBackedUp: false,
      };

      const result = await checkDuplicates([bundle1, bundle2], ledger, hardDriveDir);

      expect(result[0].alreadyBackedUp).toBe(true);
      expect(result[0].decision).toBe('backup_keep');

      expect(result[1].alreadyBackedUp).toBe(false);
      expect(result[1].decision).toBe('unsorted');
    });
  });
});
