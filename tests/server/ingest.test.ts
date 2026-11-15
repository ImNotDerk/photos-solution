import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  scanStagingDirectory,
  extractCanonicalName,
  isEditedRender,
  getTargetYearMonth,
} from '../../src/server/ingest.js';

vi.mock('exifr', () => ({
  default: {
    parse: vi.fn(async (filePath: string) => {
      if (filePath.includes('IMG_1001.HEIC')) {
        return { DateTimeOriginal: new Date('2024-01-15T10:30:00.000Z') };
      }
      if (filePath.includes('IMG_1002.HEIC') || filePath.includes('IMG_E1002.HEIC')) {
        return { DateTimeOriginal: new Date('2024-02-20T14:45:00.000Z') };
      }
      if (filePath.includes('QuickTimeVideo.MOV')) {
        return { 'QuickTime:CreationDate': new Date('2024-03-10T08:00:00.000Z') };
      }
      if (filePath.includes('ColonDate.JPG')) {
        return { DateTimeOriginal: '2024:07:04 18:30:00' };
      }
      if (filePath.includes('Corrupt.JPG')) {
        throw new Error('Corrupted EXIF metadata');
      }
      // Screenshot.PNG or other files without EXIF return undefined
      return undefined;
    }),
  },
}));

describe('AirDrop Staging Scanner & Bundle Grouping', () => {
  let stagingDir: string;

  beforeEach(async () => {
    stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photo-triage-staging-'));
  });

  afterEach(async () => {
    await fs.rm(stagingDir, { recursive: true, force: true });
  });

  describe('Helper Functions', () => {
    it('extractCanonicalName should strip IMG_E prefix and keep base name', () => {
      expect(extractCanonicalName('IMG_1001.HEIC')).toBe('IMG_1001');
      expect(extractCanonicalName('IMG_E1002.HEIC')).toBe('IMG_1002');
      expect(extractCanonicalName('img_e1003.heic')).toBe('IMG_1003');
      expect(extractCanonicalName('Screenshot.PNG')).toBe('Screenshot');
      expect(extractCanonicalName('Custom_Photo_123.jpg')).toBe('Custom_Photo_123');
    });

    it('isEditedRender should identify edited renders but not sidecars', () => {
      expect(isEditedRender('IMG_E1002.HEIC')).toBe(true);
      expect(isEditedRender('img_e1002.jpg')).toBe(true);
      expect(isEditedRender('IMG_1002.HEIC')).toBe(false);
      expect(isEditedRender('IMG_E1002.AAE')).toBe(false);
      expect(isEditedRender('IMG_1002.AAE')).toBe(false);
    });

    it('getTargetYearMonth should extract 4-digit year and uppercase month', () => {
      expect(getTargetYearMonth('2024-01-15T10:00:00.000Z')).toEqual({
        targetYear: '2024',
        targetMonth: 'JANUARY',
      });
      expect(getTargetYearMonth('2025-12-31T23:59:59.000Z')).toEqual({
        targetYear: '2025',
        targetMonth: 'DECEMBER',
      });
      expect(getTargetYearMonth(new Date('2026-06-15T00:00:00.000Z'))).toEqual({
        targetYear: '2026',
        targetMonth: 'JUNE',
      });
    });
  });

  describe('scanStagingDirectory', () => {
    it('should scan staging directory and group files into AssetBundles', async () => {
      // 1. Bundle 1 (Live Photo + AAE sidecar): IMG_1001.HEIC + IMG_1001.MOV + IMG_1001.AAE
      await fs.writeFile(path.join(stagingDir, 'IMG_1001.HEIC'), 'dummy heic content 1001');
      await fs.writeFile(path.join(stagingDir, 'IMG_1001.MOV'), 'dummy mov content 1001');
      await fs.writeFile(path.join(stagingDir, 'IMG_1001.AAE'), 'dummy aae content 1001');

      // 2. Bundle 2 (Nested subfolder with edited render): Item2/IMG_E1002.HEIC + Item2/IMG_1002.HEIC + Item2/IMG_1002.MOV
      const subfolder = path.join(stagingDir, 'Item2');
      await fs.mkdir(subfolder, { recursive: true });
      await fs.writeFile(path.join(subfolder, 'IMG_E1002.HEIC'), 'dummy edited render 1002');
      await fs.writeFile(path.join(subfolder, 'IMG_1002.HEIC'), 'dummy original heic 1002');
      await fs.writeFile(path.join(subfolder, 'IMG_1002.MOV'), 'dummy live video 1002');

      // 3. Bundle 3 (Screenshot without EXIF): Screenshot.PNG
      await fs.writeFile(path.join(stagingDir, 'Screenshot.PNG'), 'dummy screenshot png');

      const bundles = await scanStagingDirectory(stagingDir);

      expect(bundles).toHaveLength(3);

      // Bundle 1 assertions
      const bundle1001 = bundles.find((b) => b.canonicalName === 'IMG_1001');
      expect(bundle1001).toBeDefined();
      expect(bundle1001!.id).toBe('IMG_1001');
      expect(bundle1001!.canonicalName).toBe('IMG_1001');
      expect(bundle1001!.files).toHaveLength(3);
      expect(bundle1001!.decision).toBe('unsorted');
      expect(bundle1001!.alreadyBackedUp).toBe(false);
      expect(bundle1001!.dateReliable).toBe(true);
      expect(bundle1001!.targetYear).toBe('2024');
      expect(bundle1001!.targetMonth).toBe('JANUARY');
      expect(bundle1001!.capturedAt).toBe('2024-01-15T10:30:00.000Z');
      expect(bundle1001!.previewPath).toBe(path.join(stagingDir, 'IMG_1001.HEIC'));

      const roles1001 = bundle1001!.files.map((f) => ({
        name: f.filename,
        role: f.role,
        ext: f.ext,
      }));
      expect(roles1001).toContainEqual({
        name: 'IMG_1001.HEIC',
        role: 'primary',
        ext: '.HEIC',
      });
      expect(roles1001).toContainEqual({
        name: 'IMG_1001.MOV',
        role: 'live_video',
        ext: '.MOV',
      });
      expect(roles1001).toContainEqual({
        name: 'IMG_1001.AAE',
        role: 'edit_sidecar',
        ext: '.AAE',
      });

      // Bundle 2 assertions (nested subfolder with edited render IMG_E1002.HEIC)
      const bundle1002 = bundles.find((b) => b.canonicalName === 'IMG_1002');
      expect(bundle1002).toBeDefined();
      expect(bundle1002!.id).toBe('IMG_1002');
      expect(bundle1002!.canonicalName).toBe('IMG_1002');
      expect(bundle1002!.files).toHaveLength(3);
      expect(bundle1002!.dateReliable).toBe(true);
      expect(bundle1002!.targetYear).toBe('2024');
      expect(bundle1002!.targetMonth).toBe('FEBRUARY');
      // Preview path should prefer edited render IMG_E1002.HEIC
      expect(bundle1002!.previewPath).toBe(path.join(subfolder, 'IMG_E1002.HEIC'));

      const roles1002 = bundle1002!.files.map((f) => ({
        name: f.filename,
        role: f.role,
      }));
      expect(roles1002).toContainEqual({
        name: 'IMG_1002.HEIC',
        role: 'primary',
      });
      expect(roles1002).toContainEqual({
        name: 'IMG_E1002.HEIC',
        role: 'edited_render',
      });
      expect(roles1002).toContainEqual({
        name: 'IMG_1002.MOV',
        role: 'live_video',
      });

      // Bundle 3 assertions (Screenshot without EXIF)
      const bundleScreenshot = bundles.find((b) => b.canonicalName === 'Screenshot');
      expect(bundleScreenshot).toBeDefined();
      expect(bundleScreenshot!.id).toBe('Screenshot');
      expect(bundleScreenshot!.canonicalName).toBe('Screenshot');
      expect(bundleScreenshot!.files).toHaveLength(1);
      expect(bundleScreenshot!.files[0].role).toBe('primary');
      expect(bundleScreenshot!.previewPath).toBe(path.join(stagingDir, 'Screenshot.PNG'));
      // Missing EXIF must fall back to file birthtime and set dateReliable: false
      expect(bundleScreenshot!.dateReliable).toBe(false);
      expect(bundleScreenshot!.capturedAt).toBeTruthy();
      expect(bundleScreenshot!.targetYear).toMatch(/^\d{4}$/);
      expect(bundleScreenshot!.targetMonth).toMatch(/^[A-Z]+$/);
    });

    it('should ignore hidden files like .DS_Store and hidden folders', async () => {
      await fs.writeFile(path.join(stagingDir, '.DS_Store'), 'junk');
      await fs.writeFile(path.join(stagingDir, '._IMG_9999.HEIC'), 'appledouble junk');

      const hiddenDir = path.join(stagingDir, '.hidden');
      await fs.mkdir(hiddenDir, { recursive: true });
      await fs.writeFile(path.join(hiddenDir, 'IMG_9998.HEIC'), 'hidden heic');

      await fs.writeFile(path.join(stagingDir, 'IMG_9999.HEIC'), 'valid heic');

      const bundles = await scanStagingDirectory(stagingDir);
      expect(bundles).toHaveLength(1);
      expect(bundles[0].canonicalName).toBe('IMG_9999');
    });

    it('should assign role primary to standalone video without photos', async () => {
      await fs.writeFile(path.join(stagingDir, 'QuickTimeVideo.MOV'), 'video bytes');

      const bundles = await scanStagingDirectory(stagingDir);
      expect(bundles).toHaveLength(1);
      expect(bundles[0].canonicalName).toBe('QuickTimeVideo');
      expect(bundles[0].files).toHaveLength(1);
      expect(bundles[0].files[0].role).toBe('primary');
      expect(bundles[0].dateReliable).toBe(true);
      expect(bundles[0].targetYear).toBe('2024');
      expect(bundles[0].targetMonth).toBe('MARCH');
    });

    it('should parse colon-delimited EXIF date string', async () => {
      await fs.writeFile(path.join(stagingDir, 'ColonDate.JPG'), 'colon date bytes');

      const bundles = await scanStagingDirectory(stagingDir);
      expect(bundles).toHaveLength(1);
      expect(bundles[0].canonicalName).toBe('ColonDate');
      expect(bundles[0].dateReliable).toBe(true);
      expect(bundles[0].targetYear).toBe('2024');
      expect(bundles[0].targetMonth).toBe('JULY');
    });

    it('should gracefully handle corrupt EXIF by falling back to birthtime', async () => {
      await fs.writeFile(path.join(stagingDir, 'Corrupt.JPG'), 'corrupt bytes');

      const bundles = await scanStagingDirectory(stagingDir);
      expect(bundles).toHaveLength(1);
      expect(bundles[0].canonicalName).toBe('Corrupt');
      expect(bundles[0].dateReliable).toBe(false);
      expect(bundles[0].capturedAt).toBeTruthy();
      expect(bundles[0].targetYear).toMatch(/^\d{4}$/);
      expect(bundles[0].targetMonth).toMatch(/^[A-Z]+$/);
    });

    it('should handle deeply nested subdirectories', async () => {
      const deepPath = path.join(stagingDir, 'level1', 'level2', 'level3');
      await fs.mkdir(deepPath, { recursive: true });
      await fs.writeFile(path.join(deepPath, 'DeepPhoto.JPG'), 'deep photo content');

      const bundles = await scanStagingDirectory(stagingDir);
      expect(bundles).toHaveLength(1);
      expect(bundles[0].canonicalName).toBe('DeepPhoto');
      expect(bundles[0].files[0].path).toBe(path.join(deepPath, 'DeepPhoto.JPG'));
    });

    it('should return an empty array for an empty staging directory', async () => {
      const bundles = await scanStagingDirectory(stagingDir);
      expect(bundles).toEqual([]);
    });
  });
});
