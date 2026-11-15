import * as fs from 'fs/promises';
import * as path from 'path';
import exifr from 'exifr';
import type { AssetBundle, AssetFile, AssetFileRole } from '../types/index.js';

const MONTH_NAMES = [
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

const VIDEO_EXTENSIONS = new Set(['.mov', '.mp4', '.m4v']);
const IMAGE_EXTENSIONS = new Set([
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
 * Normalizes a filename to its canonical asset key.
 * Strips 'IMG_E' -> 'IMG_' so edited renders and originals share one bundle key.
 */
export function extractCanonicalName(filename: string): string {
  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext);
  return baseName.replace(/^IMG_E/i, 'IMG_');
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
 * Parses capture date from file EXIF/QuickTime metadata using exifr.
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
 * Extracts targetYear and targetMonth from an ISO date string or Date object.
 */
export function getTargetYearMonth(dateInput: Date | string): { targetYear: string; targetMonth: string } {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const targetYear = d.getUTCFullYear().toString();
  const targetMonth = MONTH_NAMES[d.getUTCMonth()];
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

    // Assign roles to each file in the group
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
          // Associated with an image in the bundle -> live video
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

    // If no primary was assigned yet (e.g. only edited render or sidecar was transferred)
    if (!primaryAssigned) {
      const candidate = assetFiles.find((f) => f.role === 'edited_render') ?? assetFiles[0];
      if (candidate && candidate.role !== 'edited_render') {
        candidate.role = 'primary';
      }
    }

    // Select preview path: prefer edited render, then primary, then first file
    const editedRender = assetFiles.find((f) => f.role === 'edited_render');
    const primaryFile = assetFiles.find((f) => f.role === 'primary');
    const previewPath = (editedRender ?? primaryFile ?? assetFiles[0]).path;

    // Extract capture date: check primary, then edited render, then live video
    let capturedDate: Date | null = null;
    let dateReliable = false;

    const filesToProbe = [
      primaryFile,
      editedRender,
      assetFiles.find((f) => f.role === 'live_video'),
    ].filter((f): f is AssetFile => Boolean(f));

    for (const file of filesToProbe) {
      const exifDate = await extractExifDate(file.path);
      if (exifDate) {
        capturedDate = exifDate;
        dateReliable = true;
        break;
      }
    }

    // Fall back to birthtime/mtime if no EXIF date found
    if (!capturedDate) {
      const fallbackFile = groupFiles.find((f) => f.fullPath === (primaryFile?.path ?? previewPath)) ?? groupFiles[0];
      const validBirthtime = fallbackFile.birthtime && fallbackFile.birthtime.getTime() > 0;
      capturedDate = validBirthtime ? fallbackFile.birthtime : fallbackFile.mtime;
      dateReliable = false;
    }

    const capturedAt = capturedDate.toISOString();
    const { targetYear, targetMonth } = getTargetYearMonth(capturedAt);

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
