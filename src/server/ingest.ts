import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import exifr from 'exifr';
import type { AssetBundle, AssetFile, AssetFileRole } from '../types/index.js';

const execFileAsync = promisify(execFile);

export const MONTH_NAMES = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
];

export const VIDEO_EXTENSIONS = new Set(['.mov', '.mp4', '.m4v']);
export const IMAGE_EXTENSIONS = new Set([
  '.heic',
  '.heif',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.tiff',
  '.tif',
  '.webp',
  '.dng',
  '.raw',
  '.cr2',
  '.nef',
]);

interface DiscoveredFile {
  fullPath: string;
  filename: string;
  ext: string;
  size: number;
  birthtime: Date;
  mtime: Date;
}

/**
 * Normalizes a filename to its canonical asset key consistently in uppercase.
 * Strips 'IMG_E' -> 'IMG_' so edited renders and originals share one bundle key,
 * regardless of file system or AirDrop casing mismatches (e.g. img_e1002.heic and IMG_1002.MOV).
 */
export function extractCanonicalName(filename: string): string {
  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext);
  return baseName.toUpperCase().replace(/^IMG_E/, 'IMG_');
}

/**
 * Determines whether a filename represents an Apple edited render (e.g. IMG_E1002.HEIC).
 */
export function isEditedRender(filename: string): boolean {
  const ext = path.extname(filename);
  if (ext.toLowerCase() === '.aae') {
    return false;
  }
  const baseName = path.basename(filename, ext);
  return /^IMG_E/i.test(baseName);
}

/**
 * Recursively walks a directory and gathers all non-hidden files.
 */
async function walkDirectory(dir: string): Promise<DiscoveredFile[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: DiscoveredFile[] = [];

  for (const entry of entries) {
    // Ignore hidden files and directories (e.g. .DS_Store, .photo-triage, .git)
    if (entry.name.startsWith('.')) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const nestedFiles = await walkDirectory(fullPath);
      files.push(...nestedFiles);
    } else if (entry.isFile()) {
      const stats = await fs.stat(fullPath);
      files.push({
        fullPath,
        filename: entry.name,
        ext: path.extname(entry.name),
        size: stats.size,
        birthtime: stats.birthtime,
        mtime: stats.mtime,
      });
    }
  }

  return files;
}

/**
 * Parses capture date from file EXIF metadata using exifr.
 * Falls back to null if no valid metadata exists.
 */
export async function extractExifDate(filePath: string): Promise<Date | null> {
  try {
    const exif = await exifr.parse(filePath, {
      tiff: true,
      xmp: true,
      reviveValues: true,
    });

    if (!exif) {
      return null;
    }

    const rawDate =
      exif.DateTimeOriginal ??
      exif.CreationDate ??
      exif['QuickTime:CreationDate'] ??
      exif.CreateDate ??
      exif.ModifyDate;

    if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
      return rawDate;
    }

    if (typeof rawDate === 'string') {
      // Normalize colon-delimited dates like "2024:01:15 10:30:00"
      const normalized = rawDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
      const parsed = new Date(normalized);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extracts creation date from QuickTime/video metadata via macOS `mdls`.
 * Returns null if mdls is unavailable or file has no indexed creation date.
 */
export async function extractQuickTimeDate(filePath: string): Promise<Date | null> {
  try {
    const { stdout } = await execFileAsync('mdls', [
      '-name',
      'kMDItemContentCreationDate',
      '-raw',
      filePath,
    ]);
    if (stdout && stdout.trim() !== '(null)') {
      const parsed = new Date(stdout.trim());
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extracts targetYear and targetMonth from a local Date or ISO date string
 * using local wall-clock components to prevent boundary date shifting near midnight.
 */
export function getTargetYearMonth(dateInput: Date | string): { targetYear: string; targetMonth: string } {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const targetYear = d.getFullYear().toString();
  const targetMonth = MONTH_NAMES[d.getMonth()];
  return { targetYear, targetMonth };
}

/**
 * Recursively scans a staging directory and groups files into logical AssetBundles.
 */
export async function scanStagingDirectory(stagingDir: string): Promise<AssetBundle[]> {
  const discoveredFiles = await walkDirectory(stagingDir);

  if (discoveredFiles.length === 0) {
    return [];
  }

  // Group discovered files by canonical name
  const groups = new Map<string, DiscoveredFile[]>();
  for (const file of discoveredFiles) {
    const canonical = extractCanonicalName(file.filename);
    const existing = groups.get(canonical);
    if (existing) {
      existing.push(file);
    } else {
      groups.set(canonical, [file]);
    }
  }

  const bundles: AssetBundle[] = [];

  for (const [canonicalName, groupFiles] of groups) {
    // Check if there are any still image files in this bundle
    const hasImageFile = groupFiles.some((f) => {
      const extLower = f.ext.toLowerCase();
      return IMAGE_EXTENSIONS.has(extLower);
    });

    let primaryAssigned = false;
    const assetFiles: AssetFile[] = [];

    // First pass: identify edit_sidecars and edited_renders
    const pendingFiles: DiscoveredFile[] = [];
    for (const f of groupFiles) {
      const extLower = f.ext.toLowerCase();
      if (extLower === '.aae') {
        assetFiles.push({
          path: f.fullPath,
          filename: f.filename,
          ext: f.ext,
          size: f.size,
          role: 'edit_sidecar',
        });
      } else if (isEditedRender(f.filename)) {
        assetFiles.push({
          path: f.fullPath,
          filename: f.filename,
          ext: f.ext,
          size: f.size,
          role: 'edited_render',
        });
      } else {
        pendingFiles.push(f);
      }
    }

    // Second pass: assign primary and live_video among pending files
    for (const f of pendingFiles) {
      const extLower = f.ext.toLowerCase();
      let role: AssetFileRole;

      if (VIDEO_EXTENSIONS.has(extLower)) {
        if (hasImageFile) {
          // Companion video in a photo bundle -> live video
          role = 'live_video';
        } else if (!primaryAssigned) {
          // Standalone video bundle -> primary
          role = 'primary';
          primaryAssigned = true;
        } else {
          role = 'live_video';
        }
      } else if (!primaryAssigned) {
        role = 'primary';
        primaryAssigned = true;
      } else {
        role = 'primary';
      }

      assetFiles.push({
        path: f.fullPath,
        filename: f.filename,
        ext: f.ext,
        size: f.size,
        role,
      });
    }

    // If no primary was assigned yet (e.g. only edited render was transferred):
    // Promote edited_render (or first non-sidecar file) to primary.
    // An .AAE sidecar must NEVER be assigned role: 'primary'.
    if (!primaryAssigned) {
      const candidate =
        assetFiles.find((f) => f.role === 'edited_render') ??
        assetFiles.find((f) => f.role !== 'edit_sidecar');
      if (candidate) {
        candidate.role = 'primary';
        primaryAssigned = true;
      }
    }

    // Select preview path prioritizing still image files over video files:
    // 1. Edited render image (e.g. IMG_E1002.HEIC)
    // 2. Primary image (e.g. IMG_1001.HEIC)
    // 3. Any image file in the bundle
    // 4. Edited render video or primary video or first file
    const isImage = (f: AssetFile) => IMAGE_EXTENSIONS.has(f.ext.toLowerCase());
    const previewFile =
      assetFiles.find((f) => f.role === 'edited_render' && isImage(f)) ??
      assetFiles.find((f) => f.role === 'primary' && isImage(f)) ??
      assetFiles.find((f) => isImage(f)) ??
      assetFiles.find((f) => f.role === 'edited_render') ??
      assetFiles.find((f) => f.role === 'primary') ??
      assetFiles[0];
    const previewPath = previewFile ? previewFile.path : '';

    // Extract capture date: check primary, then edited render, then live video
    let capturedDate: Date | null = null;
    let dateReliable = false;

    const filesToProbe = [
      assetFiles.find((f) => f.role === 'primary'),
      assetFiles.find((f) => f.role === 'edited_render'),
      assetFiles.find((f) => f.role === 'live_video'),
    ].filter((f): f is AssetFile => Boolean(f));

    for (const file of filesToProbe) {
      const exifDate = await extractExifDate(file.path);
      if (exifDate) {
        capturedDate = exifDate;
        dateReliable = true;
        break;
      }

      // If video file, try mdls QuickTime metadata fallback on macOS
      if (VIDEO_EXTENSIONS.has(file.ext.toLowerCase())) {
        const qtDate = await extractQuickTimeDate(file.path);
        if (qtDate) {
          capturedDate = qtDate;
          dateReliable = true;
          break;
        }
      }
    }

    // Fall back to birthtime/mtime if no EXIF or QuickTime date found
    if (!capturedDate) {
      const fallbackFile = groupFiles.find((f) => f.fullPath === previewPath) ?? groupFiles[0];
      const validBirthtime = fallbackFile.birthtime && fallbackFile.birthtime.getTime() > 0;
      capturedDate = validBirthtime ? fallbackFile.birthtime : fallbackFile.mtime;
      dateReliable = false;
    }

    const capturedAt = capturedDate.toISOString();
    const { targetYear, targetMonth } = getTargetYearMonth(capturedDate);

    // Order files predictably: primary -> edited_render -> live_video -> edit_sidecar
    const rolePriority: Record<AssetFileRole, number> = {
      primary: 1,
      edited_render: 2,
      live_video: 3,
      edit_sidecar: 4,
    };
    assetFiles.sort((a, b) => rolePriority[a.role] - rolePriority[b.role] || a.filename.localeCompare(b.filename));

    bundles.push({
      id: canonicalName,
      canonicalName,
      files: assetFiles,
      previewPath,
      capturedAt,
      targetYear,
      targetMonth,
      dateReliable,
      decision: 'unsorted',
      alreadyBackedUp: false,
    });
  }

  // Sort bundles chronologically by capture date, then by canonical name
  bundles.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.canonicalName.localeCompare(b.canonicalName));

  return bundles;
}

/**
 * Scans ~/Downloads for media files modified in the past maxAgeHours (defaults to 72 hours),
 * or within AirDrop subfolders, and copies them into the staging directory.
 */
export async function importFromDownloads(
  downloadsDir = path.join(os.homedir(), 'Downloads'),
  targetStagingDir: string,
  maxAgeHours = 72
): Promise<{ importedCount: number; filenames: string[] }> {
  await fs.mkdir(targetStagingDir, { recursive: true });
  let entries: import('fs').Dirent[] = [];
  try {
    entries = await fs.readdir(downloadsDir, { withFileTypes: true });
  } catch {
    return { importedCount: 0, filenames: [] };
  }

  const now = Date.now();
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const imported: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(downloadsDir, entry.name);

    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext) || ext === '.aae') {
        try {
          const stat = await fs.stat(fullPath);
          if (now - stat.mtimeMs <= maxAgeMs) {
            const dest = path.join(targetStagingDir, entry.name);
            await fs.copyFile(fullPath, dest);
            imported.push(entry.name);
          }
        } catch {
          // Ignore individual copy failures
        }
      }
    } else if (entry.isDirectory() && (/^airdrop/i.test(entry.name) || /^item/i.test(entry.name))) {
      try {
        const subEntries = await fs.readdir(fullPath, { withFileTypes: true });
        for (const sub of subEntries) {
          if (sub.isFile()) {
            const ext = path.extname(sub.name).toLowerCase();
            if (IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext) || ext === '.aae') {
              const destDir = path.join(targetStagingDir, entry.name);
              await fs.mkdir(destDir, { recursive: true });
              const dest = path.join(destDir, sub.name);
              await fs.copyFile(path.join(fullPath, sub.name), dest);
              imported.push(`${entry.name}/${sub.name}`);
            }
          }
        }
      } catch {
        // Ignore subfolder errors
      }
    }
  }

  return { importedCount: imported.length, filenames: imported };
}
