import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fsp from 'fs/promises';
import {
  monthNameToTwoDigit,
  resolveTargetSubdir,
  FOLDER_FORMAT_PRESETS,
  DEFAULT_FOLDER_FORMAT,
  loadConfig,
  saveConfig,
  CONFIG_FILE,
  expandHome,
} from '../../src/server/config.js';
import { executeBackup } from '../../src/server/backup.js';
import { createServer } from '../../src/server/index.js';
import { SessionManager } from '../../src/server/routes.js';
import type { AssetBundle } from '../../src/types/index.js';
import type { FastifyInstance } from 'fastify';

describe('Config & Folder Hierarchy Resolution', () => {
  let tempConfigDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    tempConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'photo-triage-config-test-'));
    originalEnv = process.env.PHOTO_TRIAGE_HOME;
    process.env.PHOTO_TRIAGE_HOME = tempConfigDir;
  });

  afterEach(async () => {
    process.env.PHOTO_TRIAGE_HOME = originalEnv;
    await fsp.rm(tempConfigDir, { recursive: true, force: true });
  });

  describe('expandHome', () => {
    it('expands tilde prefix to home directory', () => {
      expect(expandHome('~/Pictures')).toBe(path.join(os.homedir(), 'Pictures'));
      expect(expandHome('~')).toBe(os.homedir());
      expect(expandHome('/Volumes/Media Drive')).toBe('/Volumes/Media Drive');
    });
  });

  describe('monthNameToTwoDigit', () => {
    it('converts month names to 2-digit strings', () => {
      expect(monthNameToTwoDigit('JANUARY')).toBe('01');
      expect(monthNameToTwoDigit('FEBRUARY')).toBe('02');
      expect(monthNameToTwoDigit('NOVEMBER')).toBe('11');
      expect(monthNameToTwoDigit('DECEMBER')).toBe('12');
      expect(monthNameToTwoDigit('november')).toBe('11');
    });

    it('handles numeric months or invalid values gracefully', () => {
      expect(monthNameToTwoDigit('05')).toBe('05');
      expect(monthNameToTwoDigit('5')).toBe('05');
      expect(monthNameToTwoDigit('')).toBe('01');
      expect(monthNameToTwoDigit(undefined)).toBe('01');
      expect(monthNameToTwoDigit('INVALID')).toBe('01');
    });
  });

  describe('resolveTargetSubdir', () => {
    it('formats using default {YYYY}/{MONTH}', () => {
      const res = resolveTargetSubdir('{YYYY}/{MONTH}', { targetYear: '2026', targetMonth: 'NOVEMBER' });
      expect(res).toBe(path.join('2026', 'NOVEMBER'));
    });

    it('formats using {YYYY}/{MM}', () => {
      const res = resolveTargetSubdir('{YYYY}/{MM}', { targetYear: '2026', targetMonth: 'NOVEMBER' });
      expect(res).toBe(path.join('2026', '11'));
    });

    it('formats using {YYYY}-{MM}', () => {
      const res = resolveTargetSubdir('{YYYY}-{MM}', { targetYear: '2026', targetMonth: 'NOVEMBER' });
      expect(res).toBe('2026-11');
    });

    it('formats using {DEVICE}/{YYYY}/{MONTH}', () => {
      const res = resolveTargetSubdir('{DEVICE}/{YYYY}/{MONTH}', { targetYear: '2026', targetMonth: 'NOVEMBER' }, "Derk's iPhone");
      expect(res).toBe(path.join("Derk_s_iPhone", '2026', 'NOVEMBER'));
    });

    it('formats using {YYYY} only', () => {
      const res = resolveTargetSubdir('{YYYY}', { targetYear: '2026', targetMonth: 'NOVEMBER' });
      expect(res).toBe('2026');
    });

    it('sanitizes directory traversal attempts', () => {
      const res = resolveTargetSubdir('../../../{YYYY}/{MONTH}', { targetYear: '2026', targetMonth: 'NOVEMBER' });
      expect(res).not.toContain('..');
      expect(res.startsWith('/')).toBe(false);
    });
  });

  describe('loadConfig and saveConfig', () => {
    it('returns defaults when no config file exists', async () => {
      const config = await loadConfig();
      expect(config.hardDriveRoot).toBe('/Volumes/Media Drive');
      expect(config.folderFormat).toBe(DEFAULT_FOLDER_FORMAT);
      expect(config.deviceName).toBe('iPhone');
    });

    it('saves and reloads custom configuration', async () => {
      await saveConfig({
        hardDriveRoot: '/Volumes/CustomPhotos',
        folderFormat: '{YYYY}/{MM}',
        deviceName: 'MyPhone',
      });

      const loaded = await loadConfig();
      expect(loaded.hardDriveRoot).toBe('/Volumes/CustomPhotos');
      expect(loaded.folderFormat).toBe('{YYYY}/{MM}');
      expect(loaded.deviceName).toBe('MyPhone');
    });
  });

  describe('executeBackup with custom folderFormat', () => {
    it('places backed up files in the configured folder format structure', async () => {
      const testRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'pt-backup-custom-format-'));
      const stagingDir = path.join(testRoot, 'staging');
      const hardDriveRoot = path.join(testRoot, 'drive');

      await fsp.mkdir(stagingDir, { recursive: true });
      await fsp.mkdir(hardDriveRoot, { recursive: true });

      const testFilePath = path.join(stagingDir, 'IMG_9999.JPG');
      await fsp.writeFile(testFilePath, 'dummy image content for custom format');

      const bundle: AssetBundle = {
        id: 'bundle-custom-fmt-1',
        canonicalName: 'IMG_9999',
        previewPath: testFilePath,
        capturedAt: new Date().toISOString(),
        dateReliable: true,
        decision: 'backup_only',
        alreadyBackedUp: false,
        targetYear: '2026',
        targetMonth: 'NOVEMBER',
        files: [
          {
            path: testFilePath,
            filename: 'IMG_9999.JPG',
            ext: '.JPG',
            role: 'primary',
            size: 38,
          },
        ],
      };

      const result = await executeBackup([bundle], hardDriveRoot, stagingDir, {
        folderFormat: '{YYYY}-{MM}',
      });

      expect(result.success).toBe(true);
      const expectedDest = path.join(hardDriveRoot, '2026-11', 'IMG_9999.JPG');
      const exists = await fsp.stat(expectedDest).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      await fsp.rm(testRoot, { recursive: true, force: true });
    });
  });

  describe('Config API Endpoints', () => {
    let app: FastifyInstance;
    let sessionManager: SessionManager;
    let driveDir: string;
    let stagingDir: string;

    beforeEach(async () => {
      driveDir = path.join(tempConfigDir, 'drive');
      stagingDir = path.join(tempConfigDir, 'staging');
      await fsp.mkdir(driveDir, { recursive: true });
      await fsp.mkdir(stagingDir, { recursive: true });

      sessionManager = new SessionManager({
        stagingDir,
        hardDriveRoot: driveDir,
      });

      app = await createServer({
        sessionManager,
        stagingDir,
        hardDriveRoot: driveDir,
      });
    });

    afterEach(async () => {
      await app.close();
    });

    it('GET /api/config returns current config and presets', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/config',
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.config).toBeDefined();
      expect(json.presets).toBeInstanceOf(Array);
      expect(json.presets.length).toBeGreaterThanOrEqual(4);
    });

    it('POST /api/config updates configuration and sessionManager state', async () => {
      const newDrive = path.join(tempConfigDir, 'new-drive');
      await fsp.mkdir(newDrive, { recursive: true });

      const res = await app.inject({
        method: 'POST',
        url: '/api/config',
        payload: {
          hardDriveRoot: newDrive,
          folderFormat: '{YYYY}/{MM}',
          deviceName: 'StudioPhone',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.config.hardDriveRoot).toBe(newDrive);
      expect(json.config.folderFormat).toBe('{YYYY}/{MM}');
      expect(json.config.deviceName).toBe('StudioPhone');

      expect(sessionManager.getState().hardDriveRoot).toBe(newDrive);
    });

    it('POST /api/config expands leading tilde (~) in hardDriveRoot', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/config',
        payload: {
          hardDriveRoot: '~/Pictures/CustomPhotos',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.config.hardDriveRoot).toBe(path.join(os.homedir(), 'Pictures/CustomPhotos'));
    });

    it('POST /api/config rejects unsafe directory traversal or system paths', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/config',
        payload: {
          hardDriveRoot: '/etc',
        },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error).toContain('Access to system directory');
    });
  });
});
