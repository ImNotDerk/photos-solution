import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server/index.js';
import { SessionManager } from '../../src/server/routes.js';
import { loadLedger, computeFileHash } from '../../src/server/ledger.js';
import type { LedgerEntry } from '../../src/types/index.js';

/**
 * Helper to construct streaming multipart/form-data payload
 * matching the exact byte stream produced by iOS NetworkManager.swift.
 */
function buildIosMultipartPayload(
  fields: Record<string, string>,
  files: Array<{ role: string; filename: string; mimeType: string; data: Buffer | string }>
): { payload: Buffer; contentType: string } {
  const boundary = `Boundary-iOS-${crypto.randomBytes(8).toString('hex')}`;
  const parts: Buffer[] = [];

  // Form text fields (bundleId, canonicalName, capturedAt, targetYear, targetMonth, decision)
  for (const [name, val] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`));
  }

  // File parts (primary, live_video, edit_sidecar, edited_render)
  for (const file of files) {
    const dataBuf = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.role}"; filename="${file.filename}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`
      )
    );
    parts.push(dataBuf);
    parts.push(Buffer.from('\r\n'));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    payload: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('E2E Integration: iOS App Upload -> Mac Server -> Hard Drive & Ledger (Task 6)', () => {
  let tmpDir: string;
  let hardDriveRoot: string;
  let stagingDir: string;
  let fakeHomeDir: string;
  let app: FastifyInstance;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ios-e2e-upload-test-'));
    hardDriveRoot = path.join(tmpDir, 'mock-external-hard-drive');
    stagingDir = path.join(tmpDir, 'staging');
    fakeHomeDir = path.join(tmpDir, 'fake-home');

    await fsp.mkdir(hardDriveRoot, { recursive: true });
    await fsp.mkdir(stagingDir, { recursive: true });
    await fsp.mkdir(fakeHomeDir, { recursive: true });

    process.env.PHOTO_TRIAGE_HOME = fakeHomeDir;

    sessionManager = new SessionManager({
      stagingDir,
      hardDriveRoot,
    });

    app = await createServer({
      stagingDir,
      hardDriveRoot,
      sessionManager,
    });
  });

  afterEach(async () => {
    delete process.env.PHOTO_TRIAGE_HOME;
    if (app) {
      await app.close();
    }
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  describe('Live Photo Bundle with Edit Sidecar Upload Flow', () => {
    it('successfully uploads complete Live Photo bundle (primary + live_video + edit_sidecar), writes to <HardDriveRoot>/<YYYY>/<MONTH>/, computes exact SHA-256 hashes, and records in ledger', async () => {
      // 1. Prepare simulated binary content for photo, live companion video, and AAE sidecar
      const photoBytes = crypto.randomBytes(32 * 1024); // 32KB simulated HEIC
      const videoBytes = crypto.randomBytes(64 * 1024); // 64KB simulated MOV
      const sidecarXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>adjustmentData</key>
  <data>SimulatedAdjustmentDataAAE</data>
</dict>
</plist>`;
      const sidecarBytes = Buffer.from(sidecarXml);

      const expectedPhotoSha256 = crypto.createHash('sha256').update(photoBytes).digest('hex');
      const expectedVideoSha256 = crypto.createHash('sha256').update(videoBytes).digest('hex');
      const expectedSidecarSha256 = crypto.createHash('sha256').update(sidecarBytes).digest('hex');

      // 2. Build iOS multipart payload matching NetworkManager.swift
      const { payload, contentType } = buildIosMultipartPayload(
        {
          bundleId: 'IMG_2048',
          canonicalName: 'IMG_2048',
          capturedAt: '2024-07-14T15:30:00.000Z',
          targetYear: '2024',
          targetMonth: 'JULY',
          decision: 'backup_only',
        },
        [
          { role: 'primary', filename: 'IMG_2048.HEIC', mimeType: 'image/heic', data: photoBytes },
          { role: 'live_video', filename: 'IMG_2048.MOV', mimeType: 'video/quicktime', data: videoBytes },
          { role: 'edit_sidecar', filename: 'IMG_2048.AAE', mimeType: 'application/xml', data: sidecarBytes },
        ]
      );

      // 3. Post to Mac server /api/upload
      const res = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': contentType },
        payload,
      });

      // 4. Verify HTTP receipt
      expect(res.statusCode).toBe(200);
      const receipt = res.json<{
        success: boolean;
        verifiedCount: number;
        entries: LedgerEntry[];
      }>();

      expect(receipt.success).toBe(true);
      expect(receipt.verifiedCount).toBe(3);
      expect(receipt.entries).toHaveLength(1);

      const entry = receipt.entries[0];
      expect(entry.id).toBe('IMG_2048');
      expect(entry.canonicalName).toBe('IMG_2048');
      expect(entry.decision).toBe('backup_only');
      expect(entry.sha256).toBe(expectedPhotoSha256);
      expect(entry.targetRelPath).toBe('2024/JULY/IMG_2048.HEIC');
      expect(entry.capturedAt).toBe('2024-07-14T15:30:00.000Z');
      expect(entry.backedUpAt).toBeDefined();

      // 5. Verify physical files on mock external hard drive
      const targetDir = path.join(hardDriveRoot, '2024', 'JULY');
      const writtenPhotoPath = path.join(targetDir, 'IMG_2048.HEIC');
      const writtenVideoPath = path.join(targetDir, 'IMG_2048.MOV');
      const writtenSidecarPath = path.join(targetDir, 'IMG_2048.AAE');

      expect(fs.existsSync(writtenPhotoPath)).toBe(true);
      expect(fs.existsSync(writtenVideoPath)).toBe(true);
      expect(fs.existsSync(writtenSidecarPath)).toBe(true);

      // Verify exact byte equality
      const onDiskPhoto = await fsp.readFile(writtenPhotoPath);
      const onDiskVideo = await fsp.readFile(writtenVideoPath);
      const onDiskSidecar = await fsp.readFile(writtenSidecarPath);

      expect(Buffer.compare(onDiskPhoto, photoBytes)).toBe(0);
      expect(Buffer.compare(onDiskVideo, videoBytes)).toBe(0);
      expect(Buffer.compare(onDiskSidecar, sidecarBytes)).toBe(0);

      // Verify cryptographic SHA-256 integrity on hard drive
      expect(await computeFileHash(writtenPhotoPath)).toBe(expectedPhotoSha256);
      expect(await computeFileHash(writtenVideoPath)).toBe(expectedVideoSha256);
      expect(await computeFileHash(writtenSidecarPath)).toBe(expectedSidecarSha256);

      // Verify filesystem creation/modified timestamp preserves capturedAt metadata
      const expectedCapturedTime = new Date('2024-07-14T15:30:00.000Z').getTime();
      const photoStat = await fsp.stat(writtenPhotoPath);
      const videoStat = await fsp.stat(writtenVideoPath);
      const sidecarStat = await fsp.stat(writtenSidecarPath);
      expect(Math.floor(photoStat.mtimeMs / 1000)).toBe(Math.floor(expectedCapturedTime / 1000));
      expect(Math.floor(videoStat.mtimeMs / 1000)).toBe(Math.floor(expectedCapturedTime / 1000));
      expect(Math.floor(sidecarStat.mtimeMs / 1000)).toBe(Math.floor(expectedCapturedTime / 1000));

      // 6. Verify .photo-triage-ledger.json persistence on hard drive
      const ledger = await loadLedger(hardDriveRoot);
      expect(ledger.size).toBe(1);
      const savedEntry = ledger.get(expectedPhotoSha256);
      expect(savedEntry).toBeDefined();
      expect(savedEntry?.canonicalName).toBe('IMG_2048');
      expect(savedEntry?.targetRelPath).toBe('2024/JULY/IMG_2048.HEIC');
      expect(savedEntry?.decision).toBe('backup_only');
    });

    it('accepts adjustments.plist as edit_sidecar, normalizes to canonical stem AAE, and preserves capturedAt metadata', async () => {
      const photoBytes = Buffer.from('Edited primary photo bytes');
      const plistBytes = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>test</key><string>adjustments</string></dict></plist>');
      const capturedAtIso = '2023-11-05T09:15:30.000Z';

      const { payload, contentType } = buildIosMultipartPayload(
        {
          bundleId: 'IMG_5500',
          canonicalName: 'IMG_5500',
          capturedAt: capturedAtIso,
          targetYear: '2023',
          targetMonth: 'NOVEMBER',
          decision: 'backup_only',
        },
        [
          { role: 'primary', filename: 'IMG_5500.HEIC', mimeType: 'image/heic', data: photoBytes },
          { role: 'edit_sidecar', filename: 'adjustments.plist', mimeType: 'application/x-plist', data: plistBytes },
        ]
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': contentType },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const receipt = res.json();
      expect(receipt.success).toBe(true);

      const targetDir = path.join(hardDriveRoot, '2023', 'NOVEMBER');
      const writtenPhotoPath = path.join(targetDir, 'IMG_5500.HEIC');
      const writtenSidecarPath = path.join(targetDir, 'IMG_5500.AAE');

      expect(fs.existsSync(writtenPhotoPath)).toBe(true);
      expect(fs.existsSync(writtenSidecarPath)).toBe(true);

      const photoStat = await fsp.stat(writtenPhotoPath);
      const sidecarStat = await fsp.stat(writtenSidecarPath);
      const expectedTimeSec = Math.floor(new Date(capturedAtIso).getTime() / 1000);
      expect(Math.floor(photoStat.mtimeMs / 1000)).toBe(expectedTimeSec);
      expect(Math.floor(sidecarStat.mtimeMs / 1000)).toBe(expectedTimeSec);
    });

    it('correctly handles backup_keep decision with companion files', async () => {
      const photoBytes = Buffer.from('High-resolution JPEG photo keep candidate');
      const videoBytes = Buffer.from('Live companion MOV keep candidate');
      const expectedPhotoSha = crypto.createHash('sha256').update(photoBytes).digest('hex');

      const { payload, contentType } = buildIosMultipartPayload(
        {
          bundleId: 'IMG_3050',
          canonicalName: 'IMG_3050',
          capturedAt: '2024-08-20T11:00:00.000Z',
          targetYear: '2024',
          targetMonth: 'AUGUST',
          decision: 'backup_keep',
        },
        [
          { role: 'primary', filename: 'IMG_3050.JPG', mimeType: 'image/jpeg', data: photoBytes },
          { role: 'live_video', filename: 'IMG_3050.MOV', mimeType: 'video/quicktime', data: videoBytes },
        ]
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': contentType },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const receipt = res.json();
      expect(receipt.success).toBe(true);
      expect(receipt.verifiedCount).toBe(2);
      expect(receipt.entries[0].decision).toBe('backup_keep');

      const destPhoto = path.join(hardDriveRoot, '2024', 'AUGUST', 'IMG_3050.JPG');
      const destVideo = path.join(hardDriveRoot, '2024', 'AUGUST', 'IMG_3050.MOV');
      expect(fs.existsSync(destPhoto)).toBe(true);
      expect(fs.existsSync(destVideo)).toBe(true);

      const ledger = await loadLedger(hardDriveRoot);
      expect(ledger.get(expectedPhotoSha)?.decision).toBe('backup_keep');
    });
  });

  describe('Subsequent Upload Collision & Deduplication Verification', () => {
    it('applies suffix _2 when an asset with differing SHA-256 content exists, preserving the existing file and ledger', async () => {
      // 1. Establish initial backup on hard drive: IMG_4001 version A
      const initialPhoto = Buffer.from('Original version A from vacation');
      const initialPhotoSha = crypto.createHash('sha256').update(initialPhoto).digest('hex');

      const targetDir = path.join(hardDriveRoot, '2024', 'SEPTEMBER');
      await fsp.mkdir(targetDir, { recursive: true });
      await fsp.writeFile(path.join(targetDir, 'IMG_4001.HEIC'), initialPhoto);

      // Seed initial ledger
      const initialLedger = await loadLedger(hardDriveRoot);
      initialLedger.set(initialPhotoSha, {
        id: 'IMG_4001',
        canonicalName: 'IMG_4001',
        sha256: initialPhotoSha,
        targetRelPath: '2024/SEPTEMBER/IMG_4001.HEIC',
        capturedAt: '2024-09-01T09:00:00.000Z',
        backedUpAt: new Date().toISOString(),
        decision: 'backup_only',
      });
      const { saveLedger } = await import('../../src/server/ledger.js');
      await saveLedger(hardDriveRoot, initialLedger);

      // 2. Upload different file with same name IMG_4001 from iOS (collision)
      const collisionPhoto = Buffer.from('Completely different image with same name IMG_4001 version B');
      const collisionVideo = Buffer.from('Companion MOV for version B');
      const collisionPhotoSha = crypto.createHash('sha256').update(collisionPhoto).digest('hex');

      const { payload, contentType } = buildIosMultipartPayload(
        {
          bundleId: 'IMG_4001',
          canonicalName: 'IMG_4001',
          capturedAt: '2024-09-15T18:00:00.000Z',
          targetYear: '2024',
          targetMonth: 'SEPTEMBER',
          decision: 'backup_only',
        },
        [
          { role: 'primary', filename: 'IMG_4001.HEIC', mimeType: 'image/heic', data: collisionPhoto },
          { role: 'live_video', filename: 'IMG_4001.MOV', mimeType: 'video/quicktime', data: collisionVideo },
        ]
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': contentType },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const receipt = res.json();
      expect(receipt.success).toBe(true);
      expect(receipt.verifiedCount).toBe(2);

      // Verified entry reports suffixed canonicalName and id
      expect(receipt.entries[0].canonicalName).toBe('IMG_4001_2');
      expect(receipt.entries[0].id).toBe('IMG_4001_2');
      expect(receipt.entries[0].targetRelPath).toBe('2024/SEPTEMBER/IMG_4001_2.HEIC');
      expect(receipt.entries[0].sha256).toBe(collisionPhotoSha);

      // Original file remains unchanged
      const originalFileOnDisk = await fsp.readFile(path.join(targetDir, 'IMG_4001.HEIC'));
      expect(Buffer.compare(originalFileOnDisk, initialPhoto)).toBe(0);

      // Suffixed files exist on disk
      const suffixedPhotoPath = path.join(targetDir, 'IMG_4001_2.HEIC');
      const suffixedVideoPath = path.join(targetDir, 'IMG_4001_2.MOV');
      expect(fs.existsSync(suffixedPhotoPath)).toBe(true);
      expect(fs.existsSync(suffixedVideoPath)).toBe(true);

      const suffixedPhotoOnDisk = await fsp.readFile(suffixedPhotoPath);
      expect(Buffer.compare(suffixedPhotoOnDisk, collisionPhoto)).toBe(0);

      // Ledger contains both entries
      const updatedLedger = await loadLedger(hardDriveRoot);
      expect(updatedLedger.size).toBe(2);
      expect(updatedLedger.get(initialPhotoSha)?.canonicalName).toBe('IMG_4001');
      expect(updatedLedger.get(collisionPhotoSha)?.canonicalName).toBe('IMG_4001_2');
    });

    it('suffixes with _3 when both base and _2 exist with different hashes', async () => {
      const existingDir = path.join(hardDriveRoot, '2024', 'SEPTEMBER');
      await fsp.mkdir(existingDir, { recursive: true });
      await fsp.writeFile(path.join(existingDir, 'IMG_4002.HEIC'), 'Version 1 Content');
      await fsp.writeFile(path.join(existingDir, 'IMG_4002_2.HEIC'), 'Version 2 Content');

      const version3Content = 'Version 3 Content from iOS';
      const version3Sha = crypto.createHash('sha256').update(version3Content).digest('hex');

      const { payload, contentType } = buildIosMultipartPayload(
        {
          bundleId: 'IMG_4002',
          canonicalName: 'IMG_4002',
          capturedAt: '2024-09-20T12:00:00.000Z',
          targetYear: '2024',
          targetMonth: 'SEPTEMBER',
          decision: 'backup_only',
        },
        [{ role: 'primary', filename: 'IMG_4002.HEIC', mimeType: 'image/heic', data: version3Content }]
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': contentType },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const receipt = res.json();
      expect(receipt.success).toBe(true);
      expect(receipt.verifiedCount).toBe(1);
      expect(receipt.entries[0].canonicalName).toBe('IMG_4002_3');
      expect(receipt.entries[0].targetRelPath).toBe('2024/SEPTEMBER/IMG_4002_3.HEIC');

      expect(fs.existsSync(path.join(existingDir, 'IMG_4002_3.HEIC'))).toBe(true);
      const onDisk = await fsp.readFile(path.join(existingDir, 'IMG_4002_3.HEIC'), 'utf8');
      expect(onDisk).toBe(version3Content);
    });

    it('deduplicates seamlessly without duplicate file writing when uploaded asset has identical SHA-256', async () => {
      // 1. Upload initial bundle
      const photoContent = 'Exact duplicate test photo';
      const videoContent = 'Exact duplicate companion video';

      const bundleParams = {
        bundleId: 'IMG_5500',
        canonicalName: 'IMG_5500',
        capturedAt: '2024-10-10T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'OCTOBER',
        decision: 'backup_only' as const,
      };

      const files = [
        { role: 'primary', filename: 'IMG_5500.HEIC', mimeType: 'image/heic', data: photoContent },
        { role: 'live_video', filename: 'IMG_5500.MOV', mimeType: 'video/quicktime', data: videoContent },
      ];

      const firstReq = buildIosMultipartPayload(bundleParams, files);
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': firstReq.contentType },
        payload: firstReq.payload,
      });

      expect(res1.statusCode).toBe(200);
      expect(res1.json().success).toBe(true);

      const destPhotoPath = path.join(hardDriveRoot, '2024', 'OCTOBER', 'IMG_5500.HEIC');
      const destVideoPath = path.join(hardDriveRoot, '2024', 'OCTOBER', 'IMG_5500.MOV');
      expect(fs.existsSync(destPhotoPath)).toBe(true);
      expect(fs.existsSync(destVideoPath)).toBe(true);

      const statBefore = await fsp.stat(destPhotoPath);

      // 2. Re-upload identical bundle (e.g. repeated session or retried month)
      const secondReq = buildIosMultipartPayload(bundleParams, files);
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': secondReq.contentType },
        payload: secondReq.payload,
      });

      expect(res2.statusCode).toBe(200);
      const receipt2 = res2.json();
      expect(receipt2.success).toBe(true);
      expect(receipt2.verifiedCount).toBe(2);
      expect(receipt2.entries[0].canonicalName).toBe('IMG_5500');

      // No _2 suffixed duplicate created
      expect(fs.existsSync(path.join(hardDriveRoot, '2024', 'OCTOBER', 'IMG_5500_2.HEIC'))).toBe(false);

      // Ledger still has single entry
      const ledger = await loadLedger(hardDriveRoot);
      expect(ledger.size).toBe(1);
    });
  });

  describe('Validation & Protocol Failure Guards', () => {
    it('returns 400 when primary file role is missing from upload', async () => {
      const { payload, contentType } = buildIosMultipartPayload(
        {
          bundleId: 'IMG_6001',
          canonicalName: 'IMG_6001',
          targetYear: '2024',
          targetMonth: 'NOVEMBER',
          decision: 'backup_only',
        },
        [
          // Missing role: 'primary'
          { role: 'live_video', filename: 'IMG_6001.MOV', mimeType: 'video/quicktime', data: 'Live video only' },
        ]
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': contentType },
        payload,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/primary/i);
    });

    it('returns 400 when decision is not backup_only or backup_keep', async () => {
      const { payload, contentType } = buildIosMultipartPayload(
        {
          bundleId: 'IMG_6002',
          canonicalName: 'IMG_6002',
          targetYear: '2024',
          targetMonth: 'NOVEMBER',
          decision: 'trash', // Invalid for direct upload! Trash should be deleted locally on phone.
        },
        [{ role: 'primary', filename: 'IMG_6002.JPG', mimeType: 'image/jpeg', data: 'Trash photo data' }]
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': contentType },
        payload,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/decision/i);
    });

    it('returns 400 when targetYear contains path traversal characters', async () => {
      const { payload, contentType } = buildIosMultipartPayload(
        {
          bundleId: 'IMG_6003',
          canonicalName: 'IMG_6003',
          targetYear: '../../etc',
          targetMonth: 'DECEMBER',
          decision: 'backup_only',
        },
        [{ role: 'primary', filename: 'IMG_6003.JPG', mimeType: 'image/jpeg', data: 'Payload' }]
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': contentType },
        payload,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/targetYear/i);
    });

    it('returns 400 when hard drive root is unmounted or nonexistent', async () => {
      const { payload, contentType } = buildIosMultipartPayload(
        {
          bundleId: 'IMG_6004',
          canonicalName: 'IMG_6004',
          targetYear: '2024',
          targetMonth: 'DECEMBER',
          decision: 'backup_only',
          hardDriveRoot: path.join(tmpDir, 'non-existent-drive-mount'),
        },
        [{ role: 'primary', filename: 'IMG_6004.JPG', mimeType: 'image/jpeg', data: 'Payload' }]
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': contentType },
        payload,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/hard drive/i);
    });
  });

  describe('Session State Integration', () => {
    it('verifies GET /api/session exposes hardDriveMounted: true and matches storage state', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/session',
      });

      expect(res.statusCode).toBe(200);
      const session = res.json();
      expect(session.hardDriveMounted).toBe(true);
      expect(session.hardDriveRoot).toBe(hardDriveRoot);
    });
  });
});
