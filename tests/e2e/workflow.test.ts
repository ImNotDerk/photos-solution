import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import type { FastifyInstance } from 'fastify';
import {
  createServer,
  getLanIpAddress,
  detectStagingDirectory,
  detectHardDriveRoot,
  generateQrCode,
  expandHome,
} from '../../src/server/index.js';
import { SessionManager, type SessionData } from '../../src/server/routes.js';
import { LEDGER_FILENAME, loadLedger } from '../../src/server/ledger.js';
import type { CleanupBatchResponse, AssetBundle } from '../../src/types/index.js';

describe('End-to-End Workflow & Server Runner (Task 7)', () => {
  let tmpDir: string;
  let stagingDir: string;
  let hardDriveRoot: string;
  let fakeHomeDir: string;
  let distDir: string;
  let app: FastifyInstance;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'photo-e2e-test-'));
    stagingDir = path.join(tmpDir, 'staging');
    hardDriveRoot = path.join(tmpDir, 'mock-external-drive');
    fakeHomeDir = path.join(tmpDir, 'fake-home');
    distDir = path.join(tmpDir, 'dist-client');

    await fsp.mkdir(stagingDir, { recursive: true });
    await fsp.mkdir(hardDriveRoot, { recursive: true });
    await fsp.mkdir(fakeHomeDir, { recursive: true });
    await fsp.mkdir(distDir, { recursive: true });

    // Mock client dist files
    await fsp.writeFile(path.join(distDir, 'index.html'), '<!DOCTYPE html><html><body>Photo Triage App</body></html>');

    process.env.PHOTO_TRIAGE_HOME = fakeHomeDir;

    sessionManager = new SessionManager({
      stagingDir,
      hardDriveRoot,
    });
  });

  afterEach(async () => {
    delete process.env.PHOTO_TRIAGE_HOME;
    if (app) {
      await app.close();
    }
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  describe('Server Helper Functions', () => {
    it('getLanIpAddress returns a valid IPv4 address or localhost', () => {
      const ip = getLanIpAddress();
      expect(typeof ip).toBe('string');
      // Should match IPv4 pattern
      expect(ip).toMatch(/^(\d{1,3}\.){3}\d{1,3}$/);
      expect(ip).not.toBe('0.0.0.0');
    });

    it('generateQrCode returns a non-empty terminal string', async () => {
      const qr = await generateQrCode('http://192.168.1.50:3000');
      expect(typeof qr).toBe('string');
      expect(qr.length).toBeGreaterThan(20);
    });

    it('expandHome correctly expands leading tildes', () => {
      expect(expandHome('~')).toBe(os.homedir());
      expect(expandHome('~/Downloads/AirDrop')).toBe(path.join(os.homedir(), 'Downloads/AirDrop'));
      expect(expandHome('/absolute/path')).toBe('/absolute/path');
      expect(expandHome('./relative/path')).toBe('./relative/path');
    });

    it('detectStagingDirectory respects custom path, env var, tilde expansion, or falls back to ./staging', async () => {
      // 1. Explicit path
      expect(detectStagingDirectory('/custom/path')).toBe('/custom/path');

      // 2. Tilde expansion
      expect(detectStagingDirectory('~/Downloads/AirDrop')).toBe(path.join(os.homedir(), 'Downloads/AirDrop'));

      // 3. Env var
      const prevEnv = process.env.STAGING_DIR;
      process.env.STAGING_DIR = '~/env/staging/path';
      expect(detectStagingDirectory()).toBe(path.join(os.homedir(), 'env/staging/path'));
      delete process.env.STAGING_DIR;
      if (prevEnv) process.env.STAGING_DIR = prevEnv;

      // 4. Fallback
      const detected = detectStagingDirectory();
      expect(typeof detected).toBe('string');
      expect(detected.length).toBeGreaterThan(0);
    });

    it('detectHardDriveRoot respects custom drive, env var, tilde expansion, or defaults to /Volumes', () => {
      expect(detectHardDriveRoot('/Volumes/MyPassport')).toBe('/Volumes/MyPassport');
      expect(detectHardDriveRoot('~/BackupDrive')).toBe(path.join(os.homedir(), 'BackupDrive'));

      const prevEnv = process.env.HARD_DRIVE_ROOT;
      process.env.HARD_DRIVE_ROOT = '~/CustomDrive';
      expect(detectHardDriveRoot()).toBe(path.join(os.homedir(), 'CustomDrive'));
      delete process.env.HARD_DRIVE_ROOT;
      if (prevEnv) process.env.HARD_DRIVE_ROOT = prevEnv;

      expect(detectHardDriveRoot()).toBe('/Volumes');
    });
  });

  describe('Complete End-to-End Workflow', () => {
    it('executes full cycle: AirDrop staging -> triage -> verified backup -> ledger verification -> cleanup batch -> cleanup completion', async () => {
      // 1. Seed staging directory with realistic AirDrop transfer files
      // Bundle 1: IMG_1001 (Live Photo with HEIC + MOV + AAE) -> will be marked 'backup_only'
      await fsp.writeFile(path.join(stagingDir, 'IMG_1001.HEIC'), 'Original Photo Content 1001');
      await fsp.writeFile(path.join(stagingDir, 'IMG_1001.MOV'), 'Live Video Content 1001');
      await fsp.writeFile(path.join(stagingDir, 'IMG_1001.AAE'), '<plist>Edit Sidecar 1001</plist>');

      // Bundle 2: IMG_1002 (Edited Live Photo with original + edited render + live video + AAE) -> will be marked 'backup_only'
      await fsp.writeFile(path.join(stagingDir, 'IMG_1002.HEIC'), 'Original Photo Content 1002');
      await fsp.writeFile(path.join(stagingDir, 'IMG_E1002.HEIC'), 'Edited Render Content 1002');
      await fsp.writeFile(path.join(stagingDir, 'IMG_1002.MOV'), 'Live Video Content 1002');
      await fsp.writeFile(path.join(stagingDir, 'IMG_1002.AAE'), '<plist>Edit Sidecar 1002</plist>');

      // Bundle 3: IMG_1003 (Blurry / screenshot) -> will be marked 'trash'
      await fsp.writeFile(path.join(stagingDir, 'IMG_1003.JPG'), 'Blurry Photo 1003');

      // Bundle 4: IMG_1004 (Keep on phone photo) -> will be marked 'backup_keep'
      await fsp.writeFile(path.join(stagingDir, 'IMG_1004.PNG'), 'Keep Forever Photo 1004');

      // 2. Initialize Fastify server via createServer
      app = await createServer({
        stagingDir,
        hardDriveRoot,
        sessionManager,
        clientDistDir: distDir,
      });

      // Step A: Initial session check and staging scan
      const sessionRes1 = await app.inject({
        method: 'GET',
        url: '/api/session?scan=true',
      });
      expect(sessionRes1.statusCode).toBe(200);
      const sessionData1 = sessionRes1.json() as SessionData;
      expect(sessionData1.hardDriveMounted).toBe(true);
      expect(sessionData1.bundles).toHaveLength(4);
      expect(sessionData1.counts.total).toBe(4);
      expect(sessionData1.counts.unsorted).toBe(4);
      expect(sessionData1.counts.trash).toBe(0);
      expect(sessionData1.counts.backup_only).toBe(0);
      expect(sessionData1.counts.backup_keep).toBe(0);

      // Verify static media preview endpoint serves bundle preview
      const previewBundle1 = sessionData1.bundles.find((b: AssetBundle) => b.canonicalName === 'IMG_1001');
      expect(previewBundle1).toBeDefined();
      expect(previewBundle1?.previewPath).toBeTruthy();

      // Test preview endpoint via /media/IMG_1001.HEIC
      const mediaRes = await app.inject({
        method: 'GET',
        url: '/media/IMG_1001.HEIC',
      });
      expect(mediaRes.statusCode).toBe(200);
      expect(mediaRes.body).toBe('Original Photo Content 1001');

      // Test preview via direct previewPath
      const directPreviewRes = await app.inject({
        method: 'GET',
        url: previewBundle1!.previewPath,
      });
      expect(directPreviewRes.statusCode).toBe(200);
      expect(directPreviewRes.body).toBe('Original Photo Content 1001');

      // Test static client SPA root
      const clientRes = await app.inject({
        method: 'GET',
        url: '/',
      });
      expect(clientRes.statusCode).toBe(200);
      expect(clientRes.body).toContain('Photo Triage App');

      // Security check: Strictly reject arbitrary file reads and directory traversal attacks
      const forbiddenPaths = [
        '/etc/hosts',
        '/etc/passwd',
        '/../../../etc/hosts',
        '/media/../../../etc/hosts',
        '/..%2F..%2F..%2Fetc%2Fhosts',
      ];
      for (const targetPath of forbiddenPaths) {
        const attackRes = await app.inject({
          method: 'GET',
          url: targetPath,
        });
        // Must reject with 404 or non-200 and never expose host system files
        expect(attackRes.statusCode).not.toBe(200);
        expect(attackRes.body).not.toContain('localhost');
        expect(attackRes.body).not.toContain('root:');
      }

      // Step B: User performs triage decisions
      // Triage IMG_1001 -> backup_only
      const triage1 = await app.inject({
        method: 'POST',
        url: '/api/triage',
        payload: { bundleId: 'IMG_1001', decision: 'backup_only' },
      });
      expect(triage1.statusCode).toBe(200);

      // Triage IMG_1002 -> backup_only
      const triage2 = await app.inject({
        method: 'POST',
        url: '/api/triage',
        payload: { bundleId: 'IMG_1002', decision: 'backup_only' },
      });
      expect(triage2.statusCode).toBe(200);

      // Triage IMG_1003 -> trash
      const triage3 = await app.inject({
        method: 'POST',
        url: '/api/triage',
        payload: { bundleId: 'IMG_1003', decision: 'trash' },
      });
      expect(triage3.statusCode).toBe(200);

      // Triage IMG_1004 -> backup_keep
      const triage4 = await app.inject({
        method: 'POST',
        url: '/api/triage',
        payload: { bundleId: 'IMG_1004', decision: 'backup_keep' },
      });
      expect(triage4.statusCode).toBe(200);

      // Check updated session counts
      const sessionRes2 = await app.inject({
        method: 'GET',
        url: '/api/session',
      });
      const sessionData2 = sessionRes2.json() as SessionData;
      expect(sessionData2.counts).toEqual({
        total: 4,
        unsorted: 0,
        trash: 1,
        backup_only: 2,
        backup_keep: 1,
        alreadyBackedUp: 0,
      });

      // Step C: Attempting cleanup batch BEFORE backup must fail with 400
      const earlyCleanupRes = await app.inject({
        method: 'GET',
        url: '/api/cleanup-batch',
      });
      expect(earlyCleanupRes.statusCode).toBe(400);

      // Step D: Execute verified backup
      const backupRes = await app.inject({
        method: 'POST',
        url: '/api/backup',
        payload: {
          hardDriveRoot,
          stagingDir,
        },
      });
      expect(backupRes.statusCode).toBe(200);
      const backupJson = backupRes.json();
      expect(backupJson.success).toBe(true);
      // IMG_1001 (3 files) + IMG_1002 (4 files) + IMG_1004 (1 file) = 8 files copied & verified
      expect(backupJson.copiedCount).toBe(8);
      expect(backupJson.verifiedCount).toBe(8);

      // Verify files in external hard drive directory structure: <hardDriveRoot>/<YYYY>/<MONTH>/
      const targetYear = previewBundle1?.targetYear || new Date().getFullYear().toString();
      const targetMonth = previewBundle1?.targetMonth || 'MAY';
      const destDir = path.join(hardDriveRoot, targetYear, targetMonth);

      expect(fs.existsSync(path.join(destDir, 'IMG_1001.HEIC'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'IMG_1001.MOV'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'IMG_1001.AAE'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'IMG_1002.HEIC'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'IMG_E1002.HEIC'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'IMG_1002.MOV'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'IMG_1002.AAE'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'IMG_1004.PNG'))).toBe(true);

      // Verify trash was purged from staging
      expect(fs.existsSync(path.join(stagingDir, 'IMG_1003.JPG'))).toBe(false);

      // Step E: Verify ledger on hard drive and mirror
      const ledgerFile = path.join(hardDriveRoot, LEDGER_FILENAME);
      expect(fs.existsSync(ledgerFile)).toBe(true);

      const ledgerMap = await loadLedger(hardDriveRoot);
      expect(ledgerMap.size).toBe(3); // 3 bundles backed up: IMG_1001, IMG_1002, IMG_1004

      // Step F: Query cleanup batch (now unlocked)
      const cleanupBatchRes = await app.inject({
        method: 'GET',
        url: '/api/cleanup-batch',
      });
      expect(cleanupBatchRes.statusCode).toBe(200);
      const cleanupPayload: CleanupBatchResponse = cleanupBatchRes.json();

      expect(cleanupPayload.totalCandidates).toBe(3); // IMG_1001, IMG_1002, IMG_1003
      expect(cleanupPayload.deleteCount).toBe(2); // IMG_1001, IMG_1002
      expect(cleanupPayload.deleteNamesDelimited).toContain('|IMG_1001|');
      expect(cleanupPayload.deleteNamesDelimited).toContain('|IMG_1002|');

      // Manual review items: IMG_1003 (unreliable date) is safely deferred
      expect(cleanupPayload.manualDeleteItems).toHaveLength(1);
      const manualItem = cleanupPayload.manualDeleteItems[0] as any;
      expect(manualItem.canonicalName).toBe('IMG_1003');
      expect(manualItem.reason).toBe('unreliable_date');

      // Crucial safety guarantee: backup_keep (IMG_1004) must NOT be deleted from phone!
      expect(cleanupPayload.deleteNamesDelimited).not.toContain('IMG_1004');
      const manualCanonicalNames = cleanupPayload.manualDeleteItems.map((m: any) => m.canonicalName);
      expect(manualCanonicalNames).not.toContain('IMG_1004');
      expect(cleanupPayload.minDate).toBeTruthy();
      expect(cleanupPayload.maxDate).toBeTruthy();

      // Step G: Complete cleanup via iOS Shortcut endpoint
      const completeRes = await app.inject({
        method: 'POST',
        url: '/api/cleanup-complete',
      });
      expect(completeRes.statusCode).toBe(200);
      const completeJson = completeRes.json();
      expect(completeJson.success).toBe(true);
      expect(completeJson.session.cleanupCompleted).toBe(true);
      expect(completeJson.session.status).toBe('completed');

      // Final session check
      const finalSessionRes = await app.inject({
        method: 'GET',
        url: '/api/session',
      });
      const finalSession = finalSessionRes.json() as SessionData;
      expect(finalSession.cleanupCompleted).toBe(true);
      expect(finalSession.status).toBe('completed');
    });
  });
});
