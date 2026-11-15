import * as os from 'os';
import * as path from 'path';
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { MONTH_NAMES } from './ingest.js';

const execFileAsync = promisify(execFile);

export function getConfigDir(): string {
  return path.join(process.env.PHOTO_TRIAGE_HOME || os.homedir(), '.photo-triage');
}

export function getConfigFile(): string {
  return path.join(getConfigDir(), 'config.json');
}

export const CONFIG_DIR = getConfigDir();
export const CONFIG_FILE = getConfigFile();
export const DEFAULT_FOLDER_FORMAT = '{YYYY}/{MONTH}';

export interface FolderPreset {
  id: string;
  label: string;
  template: string;
  example: string;
}

export const FOLDER_FORMAT_PRESETS: FolderPreset[] = [
  { id: 'year_month_name', label: 'Year / Month Name', template: '{YYYY}/{MONTH}', example: '2026/NOVEMBER' },
  { id: 'year_month_num', label: 'Year / Numeric Month', template: '{YYYY}/{MM}', example: '2026/11' },
  { id: 'year_month_dash', label: 'Year-Month Combined', template: '{YYYY}-{MM}', example: '2026-11' },
  { id: 'device_year_month', label: 'Device / Year / Month', template: '{DEVICE}/{YYYY}/{MONTH}', example: 'iPhone/2026/NOVEMBER' },
  { id: 'year_only', label: 'Year Only', template: '{YYYY}', example: '2026' },
];

export interface PhotoTriageConfig {
  hardDriveRoot: string;
  folderFormat: string;
  deviceName?: string;
}

/**
 * Converts uppercase month name (e.g. "NOVEMBER") to 2-digit month string ("11").
 */
export function monthNameToTwoDigit(monthName?: string): string {
  if (!monthName) return '01';
  const clean = monthName.trim().toUpperCase();
  const idx = MONTH_NAMES.indexOf(clean);
  if (idx === -1) {
    // Check if it's already a 1- or 2-digit number
    const num = parseInt(clean, 10);
    if (!isNaN(num) && num >= 1 && num <= 12) {
      return String(num).padStart(2, '0');
    }
    return '01';
  }
  return String(idx + 1).padStart(2, '0');
}

/**
 * Resolves a destination subpath based on the user's customizable folder format template.
 * Supported tokens:
 * - {YYYY}   : 4-digit year (e.g. 2026)
 * - {MONTH}  : Uppercase month name (e.g. NOVEMBER)
 * - {MM}     : 2-digit month number (e.g. 11)
 * - {DEVICE} : Sanitized device or user name (e.g. iPhone)
 */
export function resolveTargetSubdir(
  template: string = DEFAULT_FOLDER_FORMAT,
  bundle: { targetYear?: string; targetMonth?: string },
  deviceName?: string
): string {
  const year = bundle.targetYear && /^\d{4}$/.test(bundle.targetYear.trim())
    ? bundle.targetYear.trim()
    : String(new Date().getFullYear());

  const month = bundle.targetMonth && bundle.targetMonth.trim().length > 0
    ? bundle.targetMonth.trim().toUpperCase()
    : 'UNKNOWN';

  const mm = monthNameToTwoDigit(month);

  const cleanDevice = deviceName
    ? deviceName.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '')
    : 'iPhone';

  let resolved = template
    .replace(/\{YYYY\}/g, year)
    .replace(/\{MONTH\}/g, month)
    .replace(/\{MM\}/g, mm)
    .replace(/\{DEVICE\}/g, cleanDevice || 'iPhone');

  // Sanitize path: remove leading/trailing slashes, disallow traversal
  resolved = path.normalize(resolved).replace(/^(\.\.(\/|\\|$))+/, '');
  while (resolved.startsWith(path.sep) || resolved.startsWith('/')) {
    resolved = resolved.slice(1);
  }
  while (resolved.endsWith(path.sep) || resolved.endsWith('/')) {
    resolved = resolved.slice(0, -1);
  }

  return resolved || `${year}/${month}`;
}

/**
 * Loads the saved configuration from disk synchronously, falling back to defaults.
 */
export function loadConfigSync(fallbackDrive?: string): PhotoTriageConfig {
  const defaults: PhotoTriageConfig = {
    hardDriveRoot: fallbackDrive || '/Volumes/Media Drive',
    folderFormat: DEFAULT_FOLDER_FORMAT,
    deviceName: 'iPhone',
  };

  try {
    const configFile = getConfigFile();
    if (fs.existsSync(configFile)) {
      const raw = fs.readFileSync(configFile, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        ...defaults,
        ...parsed,
        hardDriveRoot: parsed.hardDriveRoot || defaults.hardDriveRoot,
        folderFormat: parsed.folderFormat || defaults.folderFormat,
      };
    }
  } catch (err) {
    console.warn('Could not read config file synchronously, using defaults:', err);
  }

  return defaults;
}

/**
 * Loads the saved configuration from disk, falling back to defaults.
 */
export async function loadConfig(fallbackDrive?: string): Promise<PhotoTriageConfig> {
  const defaults: PhotoTriageConfig = {
    hardDriveRoot: fallbackDrive || '/Volumes/Media Drive',
    folderFormat: DEFAULT_FOLDER_FORMAT,
    deviceName: 'iPhone',
  };

  try {
    const configFile = getConfigFile();
    if (fs.existsSync(configFile)) {
      const raw = await fsp.readFile(configFile, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        ...defaults,
        ...parsed,
        hardDriveRoot: parsed.hardDriveRoot || defaults.hardDriveRoot,
        folderFormat: parsed.folderFormat || defaults.folderFormat,
      };
    }
  } catch (err) {
    console.warn('Could not read config file, using defaults:', err);
  }

  return defaults;
}

/**
 * Saves updated configuration to ~/.photo-triage/config.json.
 */
export async function saveConfig(partial: Partial<PhotoTriageConfig>): Promise<PhotoTriageConfig> {
  const current = await loadConfig();
  const updated: PhotoTriageConfig = {
    ...current,
    ...partial,
  };

  try {
    const configDir = getConfigDir();
    const configFile = getConfigFile();
    await fsp.mkdir(configDir, { recursive: true });
    await fsp.writeFile(configFile, JSON.stringify(updated, null, 2), 'utf8');
  } catch (err) {
    console.warn('Failed to save config file:', err);
  }

  return updated;
}

/**
 * Expands leading tilde (~) in file paths to the user's home directory.
 */
export function expandHome(filePath: string): string {
  if (!filePath) return filePath;
  if (filePath === '~') {
    return os.homedir();
  }
  if (filePath.startsWith(`~${path.sep}`) || filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * Triggers native macOS Finder folder picker dialog via AppleScript.
 * Returns the selected absolute POSIX path, or null if cancelled by the user.
 */
export async function pickFolderWithFinder(): Promise<string | null> {
  if (os.platform() !== 'darwin') {
    throw new Error('Finder folder picker is only supported on macOS');
  }

  const script = 'POSIX path of (choose folder with prompt "Select Photo Triage Backup Destination Folder:")';
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 60000 });
    const selectedPath = stdout.trim().replace(/\/+$/, '');
    return selectedPath || null;
  } catch (err: any) {
    if (err?.message?.includes('-128') || err?.message?.includes('User canceled')) {
      return null;
    }
    throw err;
  }
}
