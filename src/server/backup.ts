import * as fs from 'fs/promises';
import * as nodeFs from 'fs';
import * as path from 'path';
import type { AssetBundle, AssetFile, BackupResult, LedgerEntry } from '../types/index.js';
import { computeFileHash, loadLedger, saveLedger } from './ledger.js';

/**
 * Finds the primary asset file in a bundle using standard precedence:
 * 1. role === 'primary'
 * 2. role === 'edited_render'
 * 3. first file in bundle
 */
export function findPrimaryFile(bundle: AssetBundle): AssetFile | undefined {
  if (!bundle.files || bundle.files.length === 0) {
    return undefined;
  }
  return (
    bundle.files.find((f) => f.role === 'primary') ||
    bundle.files.find((f) => f.role === 'edited_render') ||
    bundle.files[0]
  );
}

/**
 * Confirms that childPath resolves strictly inside rootPath (preventing directory traversal).
 */
export function isPathInsideRoot(childPath: string, rootPath: string): boolean {
  if (!childPath || !rootPath) return false;
  const resolvedRoot = path.resolve(rootPath);
  const resolvedChild = path.resolve(childPath);
  return resolvedChild.startsWith(resolvedRoot + path.sep);
}

/**
 * Applies a collision suffix to a filename (e.g. IMG_1001.HEIC + "_2" -> IMG_1001_2.HEIC).
 */
export function applySuffix(filename: string, suffix: string): string {
  if (!suffix) return filename;
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  return `${base}${suffix}${ext}`;
}

/**
 * Removes empty child directories recursively inside a directory without removing the root directory.
 */
async function removeEmptySubdirs(dir: string, isRoot: boolean = true): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let isEmpty = true;

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        isEmpty = false;
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subIsEmpty = await removeEmptySubdirs(fullPath, false);
        if (!subIsEmpty) {
          isEmpty = false;
        }
      } else {
        isEmpty = false;
      }
    }

    if (isEmpty && !isRoot) {
      await fs.rmdir(dir);
      return true;
    }
    return isEmpty;
  } catch {
    return false;
  }
}

/**
 * Safely unlinks a file, ignoring ENOENT if already gone.
 */
async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

interface PlannedFile {
  file: AssetFile;
  srcPath: string;
  destPath: string;
  alreadyMatches: boolean;
  srcHash: string;
}

interface PlannedBundle {
  bundle: AssetBundle;
  suffix: string;
  destDir: string;
  plannedFiles: PlannedFile[];
  primaryPlannedFile?: PlannedFile;
}

export interface BackupOptions {
  copyFile?: (src: string, dest: string) => Promise<void>;
}

/**
 * Executes hard drive backup and cryptographic verification for a batch of AssetBundles.
 *
 * 1. Checks write permissions / availability of hardDriveRoot first. Fails safely if missing or unwritable.
 * 2. Copies companion files for backup_only and backup_keep into <hardDriveRoot>/<YYYY>/<MONTH>/.
 * 3. Collision handling:
 *    - If destination exists with matching SHA-256 hash, it is already safely backed up (no re-write).
 *    - If destination exists with different SHA-256 hash, bundle is renamed with suffix _2, _3, etc.
 * 4. Verification:
 *    - Destination file exists.
 *    - Destination byte size matches source byte size.
 *    - Destination SHA-256 hash matches source SHA-256 hash.
 * 5. Atomic commit:
 *    - Only after 100% of backup files pass verification, append new ledger entries and save ledger.
 * 6. Cleanup:
 *    - Delete verified source files from staging.
 *    - Purge trash bundles from staging.
 *    - Preserve unsorted bundles in staging.
 *    - Clean empty subdirectories in staging.
 * 7. Failure guard:
 *    - If ANY file fails verification or drive fails mid-transfer, DO NOT delete any source files
 *      from staging, and return success: false with detailed error info.
 */
export async function executeBackup(
  bundles: AssetBundle[],
  hardDriveRoot: string,
  stagingDir: string,
  options?: BackupOptions
): Promise<BackupResult> {
  // 1. Check availability and write permissions on hardDriveRoot first
  try {
    await fs.access(hardDriveRoot, nodeFs.constants.W_OK);
    // Write probe to catch read-only mounts that may pass W_OK check
    const probeFile = path.join(
      hardDriveRoot,
      `.photo-triage-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.writeFile(probeFile, '');
    await fs.unlink(probeFile);
  } catch (err: any) {
    return {
      success: false,
      copiedCount: 0,
      verifiedCount: 0,
      failedFiles: [],
      errors: [`Hard drive root "${hardDriveRoot}" is missing or unwritable: ${err.message}`],
    };
  }

  // 2. Classify bundles by decision
  const backupBundles = bundles.filter(
    (b) => b.decision === 'backup_only' || b.decision === 'backup_keep'
  );
  const trashBundles = bundles.filter((b) => b.decision === 'trash');

  const claimedDestPaths = new Set<string>();
  const plannedBundles: PlannedBundle[] = [];
  const errors: string[] = [];
  const failedFiles: string[] = [];

  // 3. Resolve destination paths and collision suffixes
  try {
    // Validate that all trash bundles are strictly confined to stagingDir
    for (const tb of trashBundles) {
      if (tb.files) {
        for (const file of tb.files) {
          if (!isPathInsideRoot(file.path, stagingDir)) {
            errors.push(`Trash file escapes stagingDir for bundle ${tb.id}: "${file.path}"`);
          }
        }
      }
      if (tb.previewPath && !isPathInsideRoot(tb.previewPath, stagingDir)) {
        errors.push(`Trash previewPath escapes stagingDir for bundle ${tb.id}: "${tb.previewPath}"`);
      }
    }

    for (const bundle of backupBundles) {
      if (!bundle.files || bundle.files.length === 0) {
        continue;
      }

      const targetYear = bundle.targetYear || String(new Date().getFullYear());
      const targetMonth = bundle.targetMonth ? bundle.targetMonth.trim().toUpperCase() : 'UNKNOWN';

      if (!/^\d{4}$/.test(targetYear)) {
        errors.push(`Invalid targetYear "${targetYear}" for bundle ${bundle.id}`);
        continue;
      }
      if (!/^[A-Z0-9_-]+$/i.test(targetMonth)) {
        errors.push(`Invalid targetMonth "${targetMonth}" for bundle ${bundle.id}`);
        continue;
      }

      const destDir = path.join(hardDriveRoot, targetYear, targetMonth);
      if (!isPathInsideRoot(destDir, hardDriveRoot)) {
        errors.push(`Resolved destDir escapes hardDriveRoot for bundle ${bundle.id}: "${destDir}"`);
        continue;
      }

      let bundleEscapes = false;
      for (const file of bundle.files) {
        if (!isPathInsideRoot(file.path, stagingDir)) {
          errors.push(`Source file escapes stagingDir for bundle ${bundle.id}: "${file.path}"`);
          bundleEscapes = true;
          break;
        }
      }
      if (bundleEscapes) {
        continue;
      }

      await fs.mkdir(destDir, { recursive: true });

      // Determine safe collision suffix for this bundle
      let suffixIndex = 1;
      let safeSuffix = '';
      let bundlePlannedFiles: PlannedFile[] = [];

      while (true) {
        const candidateSuffix = suffixIndex === 1 ? '' : `_${suffixIndex}`;
        let collisionFound = false;
        const tempPlannedFiles: PlannedFile[] = [];
        const bundleDestPaths = new Set<string>();

        for (const file of bundle.files) {
          const destFilename = applySuffix(file.filename, candidateSuffix);
          const destPath = path.join(destDir, destFilename);

          // Check if already claimed within current batch or within current candidate bundle
          if (claimedDestPaths.has(destPath) || bundleDestPaths.has(destPath)) {
            collisionFound = true;
            break;
          }
          bundleDestPaths.add(destPath);

          // Precompute source hash
          const srcHash = await computeFileHash(file.path);

          // Check if destination file exists on disk
          let destExists = false;
          try {
            await fs.access(destPath);
            destExists = true;
          } catch {
            destExists = false;
          }

          if (destExists) {
            const destHash = await computeFileHash(destPath);
            if (destHash !== srcHash) {
              // Collision with DIFFERENT content: must bump suffix
              collisionFound = true;
              break;
            } else {
              // Existing file with SAME content: safely already backed up
              tempPlannedFiles.push({
                file,
                srcPath: file.path,
                destPath,
                alreadyMatches: true,
                srcHash,
              });
            }
          } else {
            // Destination does not exist: ready to copy
            tempPlannedFiles.push({
              file,
              srcPath: file.path,
              destPath,
              alreadyMatches: false,
              srcHash,
            });
          }
        }

        if (collisionFound) {
          suffixIndex++;
          if (suffixIndex > 1000) {
            throw new Error(`Exceeded maximum collision resolution attempts for bundle ${bundle.id}`);
          }
          continue;
        }

        // Safe suffix found
        safeSuffix = candidateSuffix;
        bundlePlannedFiles = tempPlannedFiles;
        for (const pf of bundlePlannedFiles) {
          claimedDestPaths.add(pf.destPath);
        }
        break;
      }

      const primaryFile = findPrimaryFile(bundle);
      const primaryPlanned = bundlePlannedFiles.find(
        (pf) => pf.file === primaryFile || pf.file.filename === primaryFile?.filename
      );

      plannedBundles.push({
        bundle,
        suffix: safeSuffix,
        destDir,
        plannedFiles: bundlePlannedFiles,
        primaryPlannedFile: primaryPlanned,
      });
    }
  } catch (err: any) {
    return {
      success: false,
      copiedCount: 0,
      verifiedCount: 0,
      failedFiles: [],
      errors: [err.message || String(err)],
    };
  }

  if (errors.length > 0) {
    return {
      success: false,
      copiedCount: 0,
      verifiedCount: 0,
      failedFiles: [],
      errors,
    };
  }

  // 4. Copy Phase
  let copiedCount = 0;
  const allPlannedFiles: PlannedFile[] = [];
  for (const pb of plannedBundles) {
    allPlannedFiles.push(...pb.plannedFiles);
  }

  const copyFileFn = options?.copyFile || fs.copyFile;

  try {
    for (const pf of allPlannedFiles) {
      if (!pf.alreadyMatches) {
        await copyFileFn(pf.srcPath, pf.destPath);
        copiedCount++;
      }
    }
  } catch (err: any) {
    // If I/O error mid-transfer, fail safely without deleting anything from staging
    return {
      success: false,
      copiedCount,
      verifiedCount: 0,
      failedFiles: [],
      errors: [err.message || String(err)],
    };
  }

  // 5. Verification Phase: check existence, size, and SHA-256 for all planned files
  let verifiedCount = 0;
  for (const pf of allPlannedFiles) {
    try {
      // 1. File exists on destination
      const destStat = await fs.stat(pf.destPath);

      // 2. Exact byte size match
      let srcSize = pf.file.size;
      try {
        const srcStat = await fs.stat(pf.srcPath);
        srcSize = srcStat.size;
      } catch {
        // use pf.file.size
      }

      if (destStat.size !== srcSize) {
        failedFiles.push(pf.destPath);
        errors.push(
          `Byte size mismatch for "${pf.destPath}": expected ${srcSize}, got ${destStat.size}`
        );
        continue;
      }

      // 3. Exact SHA-256 hash match
      const destHash = await computeFileHash(pf.destPath);
      const srcHash = pf.srcHash || (await computeFileHash(pf.srcPath));

      if (destHash !== srcHash) {
        failedFiles.push(pf.destPath);
        errors.push(
          `SHA-256 hash mismatch for "${pf.destPath}": expected ${srcHash}, got ${destHash}`
        );
        continue;
      }

      verifiedCount++;
    } catch (err: any) {
      failedFiles.push(pf.destPath);
      errors.push(`Verification error for "${pf.destPath}": ${err.message}`);
    }
  }

  // 6. Verification Guard: if any file failed verification, abort and preserve staging files
  if (failedFiles.length > 0) {
    return {
      success: false,
      copiedCount,
      verifiedCount,
      failedFiles,
      errors,
    };
  }

  // 7. Atomic Commit: Update Ledger
  try {
    const ledger = await loadLedger(hardDriveRoot);

    for (const pb of plannedBundles) {
      const primaryPlanned = pb.primaryPlannedFile || pb.plannedFiles[0];
      if (!primaryPlanned) continue;

      const relPath = path
        .relative(hardDriveRoot, primaryPlanned.destPath)
        .split(path.sep)
        .join('/');

      const canonicalName = pb.suffix
        ? `${pb.bundle.canonicalName}${pb.suffix}`
        : pb.bundle.canonicalName;

      const entryId = pb.suffix ? `${pb.bundle.id}${pb.suffix}` : pb.bundle.id;

      const entry: LedgerEntry = {
        id: entryId,
        canonicalName,
        sha256: primaryPlanned.srcHash,
        targetRelPath: relPath,
        capturedAt: pb.bundle.capturedAt || new Date().toISOString(),
        backedUpAt: new Date().toISOString(),
        decision: pb.bundle.decision as 'backup_only' | 'backup_keep',
      };

      ledger.set(entry.sha256, entry);
    }

    await saveLedger(hardDriveRoot, ledger);
  } catch (err: any) {
    return {
      success: false,
      copiedCount,
      verifiedCount,
      failedFiles: [],
      errors: [`Failed to save ledger: ${err.message}`],
    };
  }

  // 8. Staging Purge: remove verified backup files and trash files
  try {
    // Delete verified backup files from staging (only unlinking paths strictly confined to stagingDir)
    for (const pb of plannedBundles) {
      for (const file of pb.bundle.files) {
        if (isPathInsideRoot(file.path, stagingDir)) {
          await safeUnlink(file.path);
        }
      }
      if (
        pb.bundle.previewPath &&
        isPathInsideRoot(pb.bundle.previewPath, stagingDir) &&
        !pb.bundle.files.some((f) => f.path === pb.bundle.previewPath)
      ) {
        await safeUnlink(pb.bundle.previewPath);
      }
    }

    // Delete trash files from staging (only unlinking paths strictly confined to stagingDir)
    for (const tb of trashBundles) {
      for (const file of tb.files) {
        if (isPathInsideRoot(file.path, stagingDir)) {
          await safeUnlink(file.path);
        }
      }
      if (
        tb.previewPath &&
        isPathInsideRoot(tb.previewPath, stagingDir) &&
        !tb.files.some((f) => f.path === tb.previewPath)
      ) {
        await safeUnlink(tb.previewPath);
      }
    }

    // Clean up empty subdirectories in stagingDir
    await removeEmptySubdirs(stagingDir);
  } catch (err: any) {
    // Non-fatal warning if cleanup has minor issue, but backup is verified
    console.warn('Warning during staging purge:', err);
  }

  return {
    success: true,
    copiedCount,
    verifiedCount,
  };
}
