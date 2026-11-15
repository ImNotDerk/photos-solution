import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

function buildMultipartPayload(
  fields: Record<string, string>,
  files: Array<{ fieldname: string; filename: string; content: string | Buffer; contentType?: string }>
): { payload: Buffer; contentType: string } {
  const boundary = `----WebKitFormBoundary${Math.random().toString(36).slice(2)}`;
  const chunks: Buffer[] = [];

  for (const [name, val] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`)
    );
  }

  for (const file of files) {
    const ct = file.contentType || 'application/octet-stream';
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\nContent-Type: ${ct}\r\n\r\n`
      )
    );
    const contentBuf = typeof file.content === 'string' ? Buffer.from(file.content) : file.content;
    chunks.push(contentBuf);
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('POST /api/upload - Mac Server Streaming Upload Endpoint', () => {
  let tmpDir: string;
  let hardDriveRoot: string;
  let stagingDir: string;
  let fakeHomeDir: string;
  let app: FastifyInstance;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'photo-upload-test-'));
    hardDriveRoot = path.join(tmpDir, 'mock-external-drive');
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

  it('successfully uploads primary image and live video, writes to <HardDriveRoot>/<YYYY>/<MONTH>/, verifies SHA-256, and updates ledger', async () => {
    const primaryContent = 'Mock HEIC image data for IMG_1001';
    const videoContent = 'Mock MOV video data for IMG_1001 companion';

    const { payload, contentType } = buildMultipartPayload(
      {
        bundleId: 'IMG_1001',
        canonicalName: 'IMG_1001',
        capturedAt: '2024-05-20T14:30:00.000Z',
        targetYear: '2024',
        targetMonth: 'MAY',
        decision: 'backup_only',
      },
      [
        { fieldname: 'primary', filename: 'IMG_1001.HEIC', content: primaryContent },
        { fieldname: 'live_video', filename: 'IMG_1001.MOV', content: videoContent },
      ]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: {
        'content-type': contentType,
      },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      success: boolean;
      verifiedCount: number;
      entries: LedgerEntry[];
    }>();

    expect(body.success).toBe(true);
    expect(body.verifiedCount).toBe(2);
    expect(body.entries).toHaveLength(1);

    const entry = body.entries[0];
    expect(entry.id).toBe('IMG_1001');
    expect(entry.canonicalName).toBe('IMG_1001');
    expect(entry.decision).toBe('backup_only');
    expect(entry.targetRelPath).toBe('2024/MAY/IMG_1001.HEIC');

    const expectedHash = crypto.createHash('sha256').update(primaryContent).digest('hex');
    expect(entry.sha256).toBe(expectedHash);

    // Verify files on hard drive disk
    const destPhotoPath = path.join(hardDriveRoot, '2024', 'MAY', 'IMG_1001.HEIC');
    const destVideoPath = path.join(hardDriveRoot, '2024', 'MAY', 'IMG_1001.MOV');

    expect(fs.existsSync(destPhotoPath)).toBe(true);
    expect(fs.existsSync(destVideoPath)).toBe(true);

    const onDiskPhotoContent = await fsp.readFile(destPhotoPath, 'utf8');
    expect(onDiskPhotoContent).toBe(primaryContent);

    const onDiskPhotoHash = await computeFileHash(destPhotoPath);
    expect(onDiskPhotoHash).toBe(expectedHash);

    const onDiskVideoHash = await computeFileHash(destVideoPath);
    const expectedVideoHash = crypto.createHash('sha256').update(videoContent).digest('hex');
    expect(onDiskVideoHash).toBe(expectedVideoHash);

    // Verify ledger persistence on disk
    const ledger = await loadLedger(hardDriveRoot);
    expect(ledger.size).toBe(1);
    expect(ledger.get(expectedHash)).toBeDefined();
    expect(ledger.get(expectedHash)?.canonicalName).toBe('IMG_1001');
  });

  it('handles bundle with edit sidecar and edited render alongside primary and live video', async () => {
    const primaryContent = 'Original HEIC photo';
    const videoContent = 'Live photo video';
    const sidecarContent = '<plist>AAE edit sidecar</plist>';
    const editedRenderContent = 'Rendered edited photo';

    const { payload, contentType } = buildMultipartPayload(
      {
        bundleId: 'IMG_2001',
        canonicalName: 'IMG_2001',
        capturedAt: '2024-06-10T10:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'JUNE',
        decision: 'backup_keep',
      },
      [
        { fieldname: 'primary', filename: 'IMG_2001.HEIC', content: primaryContent },
        { fieldname: 'live_video', filename: 'IMG_2001.MOV', content: videoContent },
        { fieldname: 'edit_sidecar', filename: 'IMG_2001.AAE', content: sidecarContent },
        { fieldname: 'edited_render', filename: 'IMG_E2001.HEIC', content: editedRenderContent },
      ]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'content-type': contentType },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.verifiedCount).toBe(4);
    expect(body.entries[0].decision).toBe('backup_keep');

    const destDir = path.join(hardDriveRoot, '2024', 'JUNE');
    expect(fs.existsSync(path.join(destDir, 'IMG_2001.HEIC'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'IMG_2001.MOV'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'IMG_2001.AAE'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'IMG_E2001.HEIC'))).toBe(true);
  });

  it('automatically suffixes with _2 when destination exists with a different SHA-256 hash', async () => {
    // Pre-create existing file on hard drive with differing content
    const existingDir = path.join(hardDriveRoot, '2024', 'MAY');
    await fsp.mkdir(existingDir, { recursive: true });
    await fsp.writeFile(path.join(existingDir, 'IMG_1001.HEIC'), 'Old existing photo with hash A');

    const newPhotoContent = 'New photo from iPhone with hash B';
    const newVideoContent = 'New companion live video';

    const { payload, contentType } = buildMultipartPayload(
      {
        bundleId: 'IMG_1001',
        canonicalName: 'IMG_1001',
        capturedAt: '2024-05-20T14:30:00.000Z',
        targetYear: '2024',
        targetMonth: 'MAY',
        decision: 'backup_only',
      },
      [
        { fieldname: 'primary', filename: 'IMG_1001.HEIC', content: newPhotoContent },
        { fieldname: 'live_video', filename: 'IMG_1001.MOV', content: newVideoContent },
      ]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'content-type': contentType },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.verifiedCount).toBe(2);

    // Old file remains untouched
    const oldContent = await fsp.readFile(path.join(existingDir, 'IMG_1001.HEIC'), 'utf8');
    expect(oldContent).toBe('Old existing photo with hash A');

    // New file is saved with _2 suffix
    const suffixedPhoto = path.join(existingDir, 'IMG_1001_2.HEIC');
    const suffixedVideo = path.join(existingDir, 'IMG_1001_2.MOV');
    expect(fs.existsSync(suffixedPhoto)).toBe(true);
    expect(fs.existsSync(suffixedVideo)).toBe(true);

    const suffixedContent = await fsp.readFile(suffixedPhoto, 'utf8');
    expect(suffixedContent).toBe(newPhotoContent);

    // Ledger entry records suffixed name and targetRelPath
    expect(body.entries[0].canonicalName).toBe('IMG_1001_2');
    expect(body.entries[0].id).toBe('IMG_1001_2');
    expect(body.entries[0].targetRelPath).toBe('2024/MAY/IMG_1001_2.HEIC');
  });

  it('suffixes with _3 when both base and _2 exist with different hashes', async () => {
    const existingDir = path.join(hardDriveRoot, '2024', 'JULY');
    await fsp.mkdir(existingDir, { recursive: true });
    await fsp.writeFile(path.join(existingDir, 'IMG_3001.HEIC'), 'Version 1');
    await fsp.writeFile(path.join(existingDir, 'IMG_3001_2.HEIC'), 'Version 2');

    const newPhotoContent = 'Version 3';

    const { payload, contentType } = buildMultipartPayload(
      {
        bundleId: 'IMG_3001',
        canonicalName: 'IMG_3001',
        capturedAt: '2024-07-04T12:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'JULY',
        decision: 'backup_only',
      },
      [{ fieldname: 'primary', filename: 'IMG_3001.HEIC', content: newPhotoContent }]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'content-type': contentType },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.entries[0].canonicalName).toBe('IMG_3001_3');
    expect(fs.existsSync(path.join(existingDir, 'IMG_3001_3.HEIC'))).toBe(true);
  });

  it('does not suffix and avoids re-writing when destination exists with identical SHA-256 hash', async () => {
    const identicalContent = 'Exact duplicate content already backed up';
    const existingDir = path.join(hardDriveRoot, '2024', 'AUGUST');
    await fsp.mkdir(existingDir, { recursive: true });
    const existingFilePath = path.join(existingDir, 'IMG_4001.HEIC');
    await fsp.writeFile(existingFilePath, identicalContent);

    const { payload, contentType } = buildMultipartPayload(
      {
        bundleId: 'IMG_4001',
        canonicalName: 'IMG_4001',
        capturedAt: '2024-08-15T09:00:00.000Z',
        targetYear: '2024',
        targetMonth: 'AUGUST',
        decision: 'backup_keep',
      },
      [{ fieldname: 'primary', filename: 'IMG_4001.HEIC', content: identicalContent }]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'content-type': contentType },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.verifiedCount).toBe(1);
    expect(body.entries[0].canonicalName).toBe('IMG_4001');

    // No _2 should be created
    expect(fs.existsSync(path.join(existingDir, 'IMG_4001_2.HEIC'))).toBe(false);
  });

  it('rejects upload with 400 when missing required primary file part', async () => {
    const { payload, contentType } = buildMultipartPayload(
      {
        bundleId: 'IMG_5001',
        canonicalName: 'IMG_5001',
        targetYear: '2024',
        targetMonth: 'SEPTEMBER',
        decision: 'backup_only',
      },
      [{ fieldname: 'live_video', filename: 'IMG_5001.MOV', content: 'Video without photo' }]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'content-type': contentType },
      payload,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toMatch(/primary/i);
  });

  it('rejects upload with 400 when decision is invalid', async () => {
    const { payload, contentType } = buildMultipartPayload(
      {
        bundleId: 'IMG_6001',
        canonicalName: 'IMG_6001',
        targetYear: '2024',
        targetMonth: 'OCTOBER',
        decision: 'trash',
      },
      [{ fieldname: 'primary', filename: 'IMG_6001.HEIC', content: 'Some photo' }]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'content-type': contentType },
      payload,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toMatch(/decision/i);
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors[0]).toBe(body.error);
  });

  it('rejects path traversal attempts in targetYear and targetMonth (CWE-22)', async () => {
    // 1. Path traversal in targetYear
    const { payload: payloadYear, contentType: ctYear } = buildMultipartPayload(
      {
        bundleId: 'IMG_7001',
        canonicalName: 'IMG_7001',
        targetYear: '../../etc',
        targetMonth: 'JANUARY',
        decision: 'backup_only',
      },
      [{ fieldname: 'primary', filename: 'IMG_7001.HEIC', content: 'Traversal test' }]
    );

    const resYear = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'content-type': ctYear },
      payload: payloadYear,
    });

    expect(resYear.statusCode).toBe(400);
    const bodyYear = resYear.json();
    expect(bodyYear.error).toMatch(/targetYear/i);
    expect(bodyYear.errors).toBeDefined();

    // 2. Path traversal in targetMonth
    const { payload: payloadMonth, contentType: ctMonth } = buildMultipartPayload(
      {
        bundleId: 'IMG_7002',
        canonicalName: 'IMG_7002',
        targetYear: '2024',
        targetMonth: '../../etc',
        decision: 'backup_only',
      },
      [{ fieldname: 'primary', filename: 'IMG_7002.HEIC', content: 'Traversal test' }]
    );

    const resMonth = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'content-type': ctMonth },
      payload: payloadMonth,
    });

    expect(resMonth.statusCode).toBe(400);
    const bodyMonth = resMonth.json();
    expect(bodyMonth.error).toMatch(/targetMonth/i);
    expect(bodyMonth.errors).toBeDefined();
  });

  it('rejects upload with 400 when duplicate filenames exist within the same upload bundle', async () => {
    const { payload, contentType } = buildMultipartPayload(
      {
        bundleId: 'IMG_8001',
        canonicalName: 'IMG_8001',
        targetYear: '2024',
        targetMonth: 'NOVEMBER',
        decision: 'backup_only',
      },
      [
        { fieldname: 'primary', filename: 'IMG_8001.HEIC', content: 'Photo 1' },
        { fieldname: 'live_video', filename: 'IMG_8001.HEIC', content: 'Duplicate filename photo' },
      ]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'content-type': contentType },
      payload,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toMatch(/duplicate filename/i);
    expect(body.errors).toBeDefined();
  });

  it('cleans up destination files from hard drive if verification fails', async () => {
    const photoContent = 'Photo that will fail verification';
    const destPhotoPath = path.join(hardDriveRoot, '2024', 'DECEMBER', 'IMG_9001.HEIC');

    // Create a dedicated server with onBeforeVerification hook that corrupts the file mid-flight
    const corruptApp = await createServer({
      stagingDir,
      hardDriveRoot,
      sessionManager,
      onBeforeVerification: async (movedPaths) => {
        for (const p of movedPaths) {
          // Corrupt destination file on disk before verification runs
          await fsp.writeFile(p, 'CORRUPTED_BYTES_DIFFERING_FROM_UPLOAD');
        }
      },
    });

    try {
      const { payload, contentType } = buildMultipartPayload(
        {
          bundleId: 'IMG_9001',
          canonicalName: 'IMG_9001',
          targetYear: '2024',
          targetMonth: 'DECEMBER',
          decision: 'backup_only',
        },
        [{ fieldname: 'primary', filename: 'IMG_9001.HEIC', content: photoContent }]
      );

      const res = await corruptApp.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': contentType },
        payload,
      });

      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/mismatch/i);
      expect(body.errors).toBeDefined();

      // Verify destination file was cleaned up and NOT left on the hard drive
      expect(fs.existsSync(destPhotoPath)).toBe(false);

      // Verify ledger was NOT updated
      const ledger = await loadLedger(hardDriveRoot);
      expect(ledger.size).toBe(0);
    } finally {
      await corruptApp.close();
    }
  });
});
