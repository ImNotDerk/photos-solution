import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { AssetBundle, LedgerEntry } from '../types/index.js';

export const LEDGER_FILENAME = '.photo-triage-ledger.json';
export const LEDGER_BACKUP_DIR = '.photo-triage';
export const LEDGER_BACKUP_FILENAME = 'ledger-backup.json';

/**
 * Computes the SHA-256 hash of a file using Node.js streaming crypto.
 */
export function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => {
      hash.update(chunk);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });

    stream.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Loads the ledger from <hardDriveRoot>/.photo-triage-ledger.json.
 * Returns a Map keyed by SHA-256 hash. If the ledger does not exist or
 * the hard drive root does not exist, returns an empty Map.
 */
export async function loadLedger(hardDriveRoot: string): Promise<Map<string, LedgerEntry>> {
  const ledgerMap = new Map<string, LedgerEntry>();
  const ledgerPath = path.join(hardDriveRoot, LEDGER_FILENAME);

  try {
    const rawData = await fsp.readFile(ledgerPath, 'utf8');
    if (!rawData.trim()) {
      return ledgerMap;
    }

    const parsed = JSON.parse(rawData);

    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (entry && entry.sha256) {
          ledgerMap.set(entry.sha256, entry);
        }
      }
    } else if (parsed && typeof parsed === 'object') {
      for (const [key, value] of Object.entries(parsed)) {
        const entry = value as LedgerEntry;
        const entryKey = entry?.sha256 || key;
        if (entryKey && entry) {
          ledgerMap.set(entryKey, entry);
        }
      }
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return ledgerMap;
    }
    throw err;
  }

  return ledgerMap;
}

/**
 * Atomically writes the ledger to <hardDriveRoot>/.photo-triage-ledger.json
 * by writing to a temporary file first and renaming. Also writes a mirror
 * backup copy to ~/.photo-triage/ledger-backup.json.
 */
export async function saveLedger(
  hardDriveRoot: string,
  entries: LedgerEntry[] | Map<string, LedgerEntry>
): Promise<void> {
  const entryArray: LedgerEntry[] =
    entries instanceof Map ? Array.from(entries.values()) : entries;

  const content = JSON.stringify(entryArray, null, 2);

  // 1. Ensure hardDriveRoot directory exists
  await fsp.mkdir(hardDriveRoot, { recursive: true });

  // 2. Safe atomic write to hardDriveRoot/.photo-triage-ledger.json
  const targetPath = path.join(hardDriveRoot, LEDGER_FILENAME);
  const randomSuffix = crypto.randomBytes(6).toString('hex');
  const tmpPath = path.join(hardDriveRoot, `${LEDGER_FILENAME}.tmp.${Date.now()}.${randomSuffix}`);

  await fsp.writeFile(tmpPath, content, 'utf8');
  await fsp.rename(tmpPath, targetPath);

  // 3. Mirror copy saved in ~/.photo-triage/ledger-backup.json
  try {
    const homeDir = process.env.PHOTO_TRIAGE_HOME || os.homedir();
    const backupDir = path.join(homeDir, LEDGER_BACKUP_DIR);
    await fsp.mkdir(backupDir, { recursive: true });

    const backupTargetPath = path.join(backupDir, LEDGER_BACKUP_FILENAME);
    const backupTmpPath = path.join(
      backupDir,
      `${LEDGER_BACKUP_FILENAME}.tmp.${Date.now()}.${randomSuffix}`
    );

    await fsp.writeFile(backupTmpPath, content, 'utf8');
    await fsp.rename(backupTmpPath, backupTargetPath);
  } catch (err) {
    // Non-fatal warning if mirror write fails (e.g. read-only home in sandboxed environments)
    console.warn('Warning: Failed to write ledger mirror backup:', err);
  }
}

/**
 * Checks a list of AssetBundles against the ledger for existing backups.
 * Computes the SHA-256 hash of the primary file for each bundle.
 * If found in the ledger and the destination file exists on the hard drive,
 * marks bundle.alreadyBackedUp = true and bundle.decision = 'backup_keep'.
 */
export async function checkDuplicates(
  bundles: AssetBundle[],
  ledger: Map<string, LedgerEntry>,
  hardDriveRoot?: string
): Promise<AssetBundle[]> {
  for (const bundle of bundles) {
    if (!bundle.files || bundle.files.length === 0) {
      bundle.alreadyBackedUp = false;
      continue;
    }

    // Identify primary asset file in the bundle
    const primaryFile =
      bundle.files.find((f) => f.role === 'primary') ||
      bundle.files.find((f) => f.role === 'edited_render') ||
      bundle.files[0];

    if (!primaryFile || !primaryFile.path) {
      bundle.alreadyBackedUp = false;
      continue;
    }

    try {
      const hash = await computeFileHash(primaryFile.path);
      const ledgerEntry = ledger.get(hash);

      if (ledgerEntry) {
        let destExists = true;

        if (hardDriveRoot) {
          const destPath = path.resolve(hardDriveRoot, ledgerEntry.targetRelPath);
          destExists = fs.existsSync(destPath);
        } else if (path.isAbsolute(ledgerEntry.targetRelPath)) {
          destExists = fs.existsSync(ledgerEntry.targetRelPath);
        }

        if (destExists) {
          bundle.alreadyBackedUp = true;
          bundle.decision = 'backup_keep';
        } else {
          bundle.alreadyBackedUp = false;
        }
      } else {
        bundle.alreadyBackedUp = false;
      }
    } catch {
      bundle.alreadyBackedUp = false;
    }
  }

  return bundles;
}
