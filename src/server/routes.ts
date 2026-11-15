import * as os from 'os';
import * as path from 'path';
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import type {
  AssetBundle,
  BackupRequest,
  LedgerEntry,
  SessionState,
  SessionStatus,
  TriageCounts,
  TriageDecision,
  TriageUpdateRequest,
} from '../types/index.js';
import { generateCleanupPayload } from './cleanup.js';
import { scanStagingDirectory, importFromDownloads } from './ingest.js';
import {
  checkDuplicates,
  loadLedger,
  saveLedger,
  computeFileHash,
  LEDGER_BACKUP_DIR,
  LEDGER_BACKUP_FILENAME,
} from './ledger.js';
import { executeBackup, applySuffix } from './backup.js';

export function computeCounts(bundles: AssetBundle[]): TriageCounts {
  const counts: TriageCounts = {
    total: bundles.length,
    unsorted: 0,
    trash: 0,
    backup_only: 0,
    backup_keep: 0,
    alreadyBackedUp: 0,
  };

  for (const bundle of bundles) {
    if (bundle.alreadyBackedUp) {
      counts.alreadyBackedUp++;
    }
    if (bundle.decision === 'unsorted') counts.unsorted++;
    else if (bundle.decision === 'trash') counts.trash++;
    else if (bundle.decision === 'backup_only') counts.backup_only++;
    else if (bundle.decision === 'backup_keep') counts.backup_keep++;
  }

  return counts;
}

export async function isHardDriveMounted(hardDriveRoot?: string): Promise<boolean> {
  if (!hardDriveRoot || !hardDriveRoot.trim()) {
    return false;
  }
  try {
    await fsp.access(hardDriveRoot, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function loadMirrorLedger(): Promise<Map<string, LedgerEntry>> {
  const homeDir = process.env.PHOTO_TRIAGE_HOME || os.homedir();
  const backupPath = path.join(homeDir, LEDGER_BACKUP_DIR, LEDGER_BACKUP_FILENAME);
  const rawData = await fsp.readFile(backupPath, 'utf8');
  const parsed = JSON.parse(rawData);
  const map = new Map<string, LedgerEntry>();

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (entry && entry.sha256) {
        map.set(entry.sha256, entry);
      }
    }
  } else if (parsed && typeof parsed === 'object') {
    for (const [key, value] of Object.entries(parsed)) {
      const entry = value as LedgerEntry;
      const entryKey = entry?.sha256 || key;
      if (entryKey && entry) {
        map.set(entryKey, entry);
      }
    }
  }

  return map;
}

export interface SessionData extends SessionState {
  cleanupCompleted: boolean;
}

export class SessionManager {
  private state: SessionState;
  private cleanupCompleted: boolean = false;

  constructor(initial?: Partial<SessionState & { cleanupCompleted?: boolean }>) {
    const bundles = initial?.bundles || [];
    this.state = {
      sessionId: initial?.sessionId || 'session-1',
      stagingDir: initial?.stagingDir || '',
      hardDriveRoot: initial?.hardDriveRoot || '',
      bundles,
      counts: initial?.counts || computeCounts(bundles),
      status: initial?.status || 'staging',
      isBackupVerified: initial?.isBackupVerified || false,
      hardDriveMounted: initial?.hardDriveMounted ?? false,
    };
    if (initial?.cleanupCompleted !== undefined) {
      this.cleanupCompleted = initial.cleanupCompleted;
    }
  }

  getState(): SessionData {
    return {
      ...this.state,
      counts: computeCounts(this.state.bundles),
      cleanupCompleted: this.cleanupCompleted,
    };
  }

  setState(partial: Partial<SessionState & { cleanupCompleted?: boolean }>): SessionData {
    if (partial.cleanupCompleted !== undefined) {
      this.cleanupCompleted = partial.cleanupCompleted;
    }

    const nextBundles = partial.bundles ?? this.state.bundles;

    this.state = {
      ...this.state,
      ...partial,
      bundles: nextBundles,
      counts: computeCounts(nextBundles),
    };

    return this.getState();
  }

  reset(initial?: Partial<SessionState & { cleanupCompleted?: boolean }>): void {
    const bundles = initial?.bundles || [];
    this.cleanupCompleted = initial?.cleanupCompleted || false;
    this.state = {
      sessionId: initial?.sessionId || 'session-1',
      stagingDir: initial?.stagingDir || '',
      hardDriveRoot: initial?.hardDriveRoot || '',
      bundles,
      counts: initial?.counts || computeCounts(bundles),
      status: initial?.status || 'staging',
      isBackupVerified: initial?.isBackupVerified || false,
      hardDriveMounted: initial?.hardDriveMounted ?? false,
    };
  }
}

export const defaultSessionManager = new SessionManager();

export interface RoutesOptions {
  sessionManager?: SessionManager;
  onBeforeVerification?: (destPaths: string[]) => Promise<void>;
}

export const routes: FastifyPluginAsync<RoutesOptions> = async (
  fastify: FastifyInstance,
  options?: RoutesOptions
) => {
  const manager = options?.sessionManager || defaultSessionManager;

  if (!fastify.hasContentTypeParser('multipart/form-data')) {
    await fastify.register(fastifyMultipart, {
      limits: {
        fileSize: 200 * 1024 * 1024,
      },
    });
  }

  /**
   * GET /api/session
   * Returns current staging batch, triage counts, hardDriveMounted status, and session state.
   * Optional query params:
   * - stagingDir: set or update staging directory
   * - hardDriveRoot: set or update hard drive root
   * - scan: true to trigger scan of stagingDir
   */
  fastify.get<{
    Querystring: {
      stagingDir?: string;
      hardDriveRoot?: string;
      scan?: string | boolean;
    };
  }>('/api/session', async (request, reply) => {
    const { stagingDir, hardDriveRoot, scan } = request.query;

    if (stagingDir) {
      manager.setState({ stagingDir });
    }
    if (hardDriveRoot) {
      manager.setState({ hardDriveRoot });
    }

    const currentState = manager.getState();

    // Inspect hard drive mount status
    const hardDriveMounted = await isHardDriveMounted(currentState.hardDriveRoot);
    manager.setState({ hardDriveMounted });

    // Scan staging if explicitly requested or if stagingDir is set but bundles are empty
    if (((scan === 'true' || scan === true) || currentState.bundles.length === 0) && currentState.stagingDir) {
      try {
        let bundles = await scanStagingDirectory(currentState.stagingDir);

        // If staging directory is currently empty, try importing recent media from ~/Downloads
        if (bundles.length === 0) {
          try {
            await importFromDownloads(undefined, currentState.stagingDir);
            bundles = await scanStagingDirectory(currentState.stagingDir);
          } catch {
            // Ignore non-critical import failures
          }
        }

        if (currentState.hardDriveRoot && hardDriveMounted) {
          const ledger = await loadLedger(currentState.hardDriveRoot);
          bundles = await checkDuplicates(bundles, ledger, currentState.hardDriveRoot);
        }

        manager.setState({
          bundles,
          status: 'triaging',
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: `Failed to scan staging directory: ${err.message}`,
        });
      }
    }

    return reply.status(200).send({
      ...manager.getState(),
      hardDriveMounted,
    });
  });

  /**
   * POST /api/import-downloads
   * Imports recent media files from ~/Downloads into the staging directory and rescans.
   */
  fastify.post('/api/import-downloads', async (request, reply) => {
    const currentState = manager.getState();
    if (!currentState.stagingDir) {
      return reply.status(400).send({ error: 'No staging directory configured' });
    }

    try {
      const { importedCount, filenames } = await importFromDownloads(undefined, currentState.stagingDir);
      let bundles = await scanStagingDirectory(currentState.stagingDir);
      const hardDriveMounted = await isHardDriveMounted(currentState.hardDriveRoot);
      if (currentState.hardDriveRoot && hardDriveMounted) {
        const ledger = await loadLedger(currentState.hardDriveRoot);
        bundles = await checkDuplicates(bundles, ledger, currentState.hardDriveRoot);
      }
      const updated = manager.setState({
        bundles,
        status: 'triaging',
        hardDriveMounted,
      });

      return reply.status(200).send({
        importedCount,
        filenames,
        ...updated,
      });
    } catch (err: any) {
      return reply.status(500).send({
        error: `Failed to import from Downloads: ${err.message}`,
      });
    }
  });

  /**
   * POST /api/session
   * Update session state directly (useful for tests or configuration)
   */
  fastify.post<{
    Body: Partial<SessionState & { cleanupCompleted?: boolean }>;
  }>('/api/session', async (request, reply) => {
    const updated = manager.setState(request.body || {});
    return reply.status(200).send(updated);
  });

  /**
   * POST /api/triage
   * Updates decision for one or multiple bundles.
   */
  fastify.post<{
    Body: TriageUpdateRequest;
  }>('/api/triage', async (request, reply) => {
    const { bundleId, bundleIds, decision } = request.body || {};

    const validDecisions: TriageDecision[] = [
      'unsorted',
      'trash',
      'backup_only',
      'backup_keep',
    ];

    if (!decision || !validDecisions.includes(decision)) {
      return reply.status(400).send({
        error: `Invalid triage decision "${decision}". Must be one of: ${validDecisions.join(', ')}`,
      });
    }

    const targetIds: string[] = [];
    if (bundleIds && Array.isArray(bundleIds)) {
      targetIds.push(...bundleIds);
    } else if (bundleId && typeof bundleId === 'string') {
      targetIds.push(bundleId);
    }

    if (targetIds.length === 0) {
      return reply.status(400).send({
        error: 'Missing bundleId or bundleIds in request body.',
      });
    }

    const currentState = manager.getState();
    const idSet = new Set(targetIds);
    let updatedCount = 0;

    for (const bundle of currentState.bundles) {
      if (idSet.has(bundle.id)) {
        bundle.decision = decision;
        updatedCount++;
      }
    }

    const updatedState = manager.setState({ bundles: currentState.bundles });

    return reply.status(200).send({
      success: true,
      updatedCount,
      counts: updatedState.counts,
      bundles: updatedState.bundles,
    });
  });

  /**
   * POST /api/backup
   * Executes backup and verification for triaged bundles.
   * Only transitions to isBackupVerified: true and status: 'cleanup_ready'
   * if ALL backup_only and backup_keep bundles in the session have alreadyBackedUp === true.
   */
  fastify.post<{
    Body: BackupRequest;
  }>('/api/backup', async (request, reply) => {
    const body = request.body || {};
    const currentState = manager.getState();

    const hardDriveRoot = body.hardDriveRoot || currentState.hardDriveRoot;
    const stagingDir = body.stagingDir || currentState.stagingDir;

    if (!hardDriveRoot || !stagingDir) {
      return reply.status(400).send({
        error: 'Both hardDriveRoot and stagingDir must be specified before running backup.',
      });
    }

    manager.setState({
      hardDriveRoot,
      stagingDir,
      status: 'backing_up',
    });

    let bundlesToBackup = currentState.bundles;
    if (body.bundleIds && Array.isArray(body.bundleIds) && body.bundleIds.length > 0) {
      const allowed = new Set(body.bundleIds);
      bundlesToBackup = currentState.bundles.filter((b) => allowed.has(b.id));
    }

    try {
      const result = await executeBackup(bundlesToBackup, hardDriveRoot, stagingDir);

      if (result.success) {
        // Mark backed up bundles as alreadyBackedUp
        for (const b of bundlesToBackup) {
          if (b.decision === 'backup_only' || b.decision === 'backup_keep') {
            b.alreadyBackedUp = true;
          }
        }

        // Safety check: verify whether ALL backup_only and backup_keep bundles are backed up
        const backupBundles = currentState.bundles.filter(
          (b) => b.decision === 'backup_only' || b.decision === 'backup_keep'
        );
        const hasUnfinishedBackup = backupBundles.some((b) => !b.alreadyBackedUp);

        if (!hasUnfinishedBackup) {
          manager.setState({
            isBackupVerified: true,
            status: 'cleanup_ready',
            bundles: currentState.bundles,
          });
        } else {
          // Partial backup: remaining items still require backup before cleanup
          manager.setState({
            isBackupVerified: false,
            status: 'triaging',
            bundles: currentState.bundles,
          });
        }

        return reply.status(200).send(result);
      } else {
        manager.setState({
          isBackupVerified: false,
          status: 'triaging',
        });

        return reply.status(500).send(result);
      }
    } catch (err: any) {
      manager.setState({
        isBackupVerified: false,
        status: 'triaging',
      });

      return reply.status(500).send({
        success: false,
        copiedCount: 0,
        verifiedCount: 0,
        errors: [err.message || String(err)],
      });
    }
  });

  /**
   * GET /api/cleanup-batch
   * Returns the payload for iOS Shortcut and manual cleanup UI.
   * Locked until backup is verified, unless force=true is passed.
   * If loadLedger fails on hard drive, falls back to mirror backup;
   * if mirror also fails, returns 500 to prevent disabling keep-collision checks.
   */
  fastify.get<{
    Querystring: {
      force?: string | boolean;
    };
  }>('/api/cleanup-batch', async (request, reply) => {
    const { force } = request.query;
    const currentState = manager.getState();

    const isForced = force === 'true' || force === true;

    if (!currentState.isBackupVerified && !isForced) {
      return reply.status(400).send({
        error:
          'Backup has not been verified yet. Complete verified backup before requesting cleanup batch.',
      });
    }

    let ledger = new Map<string, LedgerEntry>();
    if (currentState.hardDriveRoot) {
      const mounted = await isHardDriveMounted(currentState.hardDriveRoot);
      if (!mounted) {
        // Hard drive is disconnected: fall back to mirror backup
        try {
          ledger = await loadMirrorLedger();
        } catch (mirrorErr: any) {
          return reply.status(500).send({
            error: `Cannot verify ledger for safety collision checks: Hard drive "${currentState.hardDriveRoot}" is not mounted or accessible, and mirror backup failed: ${mirrorErr.message || String(mirrorErr)}`,
          });
        }
      } else {
        try {
          ledger = await loadLedger(currentState.hardDriveRoot);
        } catch (hdErr: any) {
          try {
            ledger = await loadMirrorLedger();
          } catch (mirrorErr: any) {
            return reply.status(500).send({
              error: `Cannot verify ledger for safety collision checks: ${hdErr.message || String(hdErr)}`,
            });
          }
        }
      }
    } else {
      try {
        ledger = await loadMirrorLedger();
      } catch {
        ledger = new Map();
      }
    }

    const payload = generateCleanupPayload(currentState.bundles, ledger);
    return reply.status(200).send(payload);
  });

  /**
   * POST /api/cleanup-complete
   * Records cleanup completion from iOS Shortcut or UI.
   */
  fastify.post('/api/cleanup-complete', async (_request, reply) => {
    manager.setState({
      cleanupCompleted: true,
      status: 'completed',
    });

    return reply.status(200).send({
      success: true,
      message: 'Cleanup completed successfully',
      session: manager.getState(),
    });
  });

  /**
   * POST /api/upload
   * Dedicated streaming multipart upload endpoint to receive asset bundles
   * directly from native iOS app over local Wi-Fi.
   *
   * Form fields:
   * - bundleId: string
   * - canonicalName: string
   * - capturedAt: string (ISO timestamp)
   * - targetYear: string (e.g. "2024")
   * - targetMonth: string (e.g. "JANUARY")
   * - decision: 'backup_only' | 'backup_keep'
   *
   * File parts:
   * - primary: required (main image/video)
   * - live_video: optional (Live Photo companion video)
   * - edit_sidecar: optional (AAE sidecar)
   * - edited_render: optional (edited render image/video)
   */
  fastify.post('/api/upload', async (request, reply) => {
    const query = request.query as Record<string, string> | undefined;
    const currentState = manager.getState();
    let hardDriveRoot = query?.hardDriveRoot || currentState.hardDriveRoot;

    // Check hard drive access early if hardDriveRoot is already known
    if (hardDriveRoot && !(await isHardDriveMounted(hardDriveRoot))) {
      return reply.status(400).send({
        success: false,
        error: `Hard drive root "${hardDriveRoot}" is not mounted or accessible.`,
        errors: [`Hard drive root "${hardDriveRoot}" is not mounted or accessible.`],
      });
    }

    const tmpBase =
      hardDriveRoot && (await isHardDriveMounted(hardDriveRoot))
        ? path.join(hardDriveRoot, '.upload-tmp')
        : path.join(os.tmpdir(), 'photo-triage-upload-tmp');

    await fsp.mkdir(tmpBase, { recursive: true });

    interface UploadedFile {
      fieldname: string;
      filename: string;
      tmpPath: string;
      size: number;
      hash: string;
    }

    const fields: Record<string, string> = {};
    const uploadedFiles: UploadedFile[] = [];
    const newlyMovedPaths: string[] = [];

    const cleanupTmpFiles = async () => {
      for (const f of uploadedFiles) {
        try {
          await fsp.unlink(f.tmpPath);
        } catch {
          // ignore
        }
      }
    };

    const cleanupMovedFiles = async () => {
      for (const p of newlyMovedPaths) {
        try {
          await fsp.unlink(p);
        } catch {
          // ignore
        }
      }
    };

    try {
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'file') {
          const safeFilename = path.basename(part.filename || `${part.fieldname}.bin`);
          const randomSuffix = crypto.randomBytes(6).toString('hex');
          const tmpFilePath = path.join(
            tmpBase,
            `upload-${Date.now()}-${randomSuffix}-${safeFilename}`
          );

          let byteCount = 0;
          const hashStream = crypto.createHash('sha256');

          const meter = new Transform({
            transform(chunk, _encoding, callback) {
              byteCount += chunk.length;
              hashStream.update(chunk);
              callback(null, chunk);
            },
          });

          const writeStream = fs.createWriteStream(tmpFilePath);

          try {
            await pipeline(part.file, meter, writeStream);
          } catch (streamErr: any) {
            try {
              await fsp.unlink(tmpFilePath);
            } catch {}
            throw streamErr;
          }

          if (part.file.truncated) {
            try {
              await fsp.unlink(tmpFilePath);
            } catch {}
            await cleanupTmpFiles();
            return reply.status(413).send({
              success: false,
              error: `File "${safeFilename}" exceeded 200MB limit.`,
              errors: [`File "${safeFilename}" exceeded 200MB limit.`],
            });
          }

          uploadedFiles.push({
            fieldname: part.fieldname,
            filename: safeFilename,
            tmpPath: tmpFilePath,
            size: byteCount,
            hash: hashStream.digest('hex'),
          });
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }
    } catch (err: any) {
      await cleanupTmpFiles();
      const msg = `Failed to process multipart upload: ${err.message}`;
      return reply.status(400).send({
        success: false,
        error: msg,
        errors: [msg],
      });
    }

    try {
      if (fields.hardDriveRoot) {
        hardDriveRoot = fields.hardDriveRoot;
      }
      if (!hardDriveRoot || !(await isHardDriveMounted(hardDriveRoot))) {
        await cleanupTmpFiles();
        const msg = `Hard drive root "${hardDriveRoot || ''}" is missing, unwritable, or not mounted.`;
        return reply.status(400).send({
          success: false,
          error: msg,
          errors: [msg],
        });
      }

      // Write probe to catch read-only mounts
      try {
        const probeFile = path.join(
          hardDriveRoot,
          `.photo-triage-probe-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
        );
        await fsp.writeFile(probeFile, '');
        await fsp.unlink(probeFile);
      } catch (err: any) {
        await cleanupTmpFiles();
        const msg = `Hard drive root "${hardDriveRoot}" is unwritable: ${err.message}`;
        return reply.status(500).send({
          success: false,
          verifiedCount: 0,
          error: msg,
          errors: [msg],
        });
      }

      const bundleId = fields.bundleId;
      if (!bundleId) {
        await cleanupTmpFiles();
        const msg = 'Missing required form field "bundleId".';
        return reply.status(400).send({
          success: false,
          error: msg,
          errors: [msg],
        });
      }

      const decision = fields.decision;
      if (!decision || (decision !== 'backup_only' && decision !== 'backup_keep')) {
        await cleanupTmpFiles();
        const msg = `Invalid or missing triage decision "${decision}". Must be "backup_only" or "backup_keep".`;
        return reply.status(400).send({
          success: false,
          error: msg,
          errors: [msg],
        });
      }

      const primaryFile = uploadedFiles.find((f) => f.fieldname === 'primary');
      if (!primaryFile) {
        await cleanupTmpFiles();
        const msg = 'Missing required file part "primary".';
        return reply.status(400).send({
          success: false,
          error: msg,
          errors: [msg],
        });
      }

      // Guard against intra-bundle duplicate filenames
      const seenFilenames = new Set<string>();
      for (const file of uploadedFiles) {
        if (seenFilenames.has(file.filename)) {
          await cleanupTmpFiles();
          const msg = `Duplicate filename "${file.filename}" in upload bundle. All companion files must have distinct filenames.`;
          return reply.status(400).send({
            success: false,
            error: msg,
            errors: [msg],
          });
        }
        seenFilenames.add(file.filename);
      }

      const canonicalName = fields.canonicalName || bundleId;

      // Sanitize and validate targetYear and targetMonth against path traversal (CWE-22)
      if (
        fields.targetYear &&
        (fields.targetYear.includes('/') ||
          fields.targetYear.includes('\\') ||
          fields.targetYear.includes('..') ||
          !/^\d{4}$/.test(fields.targetYear.trim()))
      ) {
        await cleanupTmpFiles();
        const msg = `Invalid targetYear "${fields.targetYear}". Must be a 4-digit year (e.g. 2024).`;
        return reply.status(400).send({
          success: false,
          error: msg,
          errors: [msg],
        });
      }
      const rawYear = fields.targetYear ? fields.targetYear.trim() : String(new Date().getFullYear());
      const targetYear = path.basename(rawYear);

      if (
        fields.targetMonth &&
        (fields.targetMonth.includes('/') ||
          fields.targetMonth.includes('\\') ||
          fields.targetMonth.includes('..') ||
          !/^[A-Z0-9_-]+$/i.test(fields.targetMonth.trim()))
      ) {
        await cleanupTmpFiles();
        const msg = `Invalid targetMonth "${fields.targetMonth}". Must be alphanumeric (e.g. JANUARY).`;
        return reply.status(400).send({
          success: false,
          error: msg,
          errors: [msg],
        });
      }
      const rawMonth = fields.targetMonth ? fields.targetMonth.trim().toUpperCase() : 'UNKNOWN';
      const targetMonth = path.basename(rawMonth);

      const destDir = path.resolve(hardDriveRoot, targetYear, targetMonth);
      const resolvedRoot = path.resolve(hardDriveRoot);
      const rootPrefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
      if (!destDir.startsWith(rootPrefix)) {
        await cleanupTmpFiles();
        const msg = 'Path traversal detected in destination path.';
        return reply.status(400).send({
          success: false,
          error: msg,
          errors: [msg],
        });
      }

      const capturedAt = fields.capturedAt || new Date().toISOString();
      await fsp.mkdir(destDir, { recursive: true });

      // Collision Resolution
      let suffixIndex = 1;
      let safeSuffix = '';
      interface ResolvedFile extends UploadedFile {
        destPath: string;
        destFilename: string;
        alreadyMatches: boolean;
      }
      let resolvedFiles: ResolvedFile[] = [];

      while (true) {
        const candidateSuffix = suffixIndex === 1 ? '' : `_${suffixIndex}`;
        let collisionFound = false;
        const tempResolved: ResolvedFile[] = [];
        const candidateDestPaths = new Set<string>();

        for (const file of uploadedFiles) {
          const destFilename = applySuffix(file.filename, candidateSuffix);
          const destPath = path.join(destDir, destFilename);

          if (candidateDestPaths.has(destPath)) {
            collisionFound = true;
            break;
          }
          candidateDestPaths.add(destPath);

          let destExists = false;
          try {
            await fsp.access(destPath);
            destExists = true;
          } catch {
            destExists = false;
          }

          if (destExists) {
            const destHash = await computeFileHash(destPath);
            if (destHash !== file.hash) {
              collisionFound = true;
              break;
            } else {
              tempResolved.push({
                ...file,
                destPath,
                destFilename,
                alreadyMatches: true,
              });
            }
          } else {
            tempResolved.push({
              ...file,
              destPath,
              destFilename,
              alreadyMatches: false,
            });
          }
        }

        if (collisionFound) {
          suffixIndex++;
          if (suffixIndex > 1000) {
            throw new Error(`Exceeded maximum collision resolution attempts for bundle ${bundleId}`);
          }
          continue;
        }

        safeSuffix = candidateSuffix;
        resolvedFiles = tempResolved;
        break;
      }

      // Move files to destination
      for (const rf of resolvedFiles) {
        if (rf.alreadyMatches) {
          try {
            await fsp.unlink(rf.tmpPath);
          } catch {}
        } else {
          try {
            await fsp.rename(rf.tmpPath, rf.destPath);
            newlyMovedPaths.push(rf.destPath);
          } catch (renameErr: any) {
            if (renameErr.code === 'EXDEV') {
              await fsp.copyFile(rf.tmpPath, rf.destPath);
              await fsp.unlink(rf.tmpPath);
              newlyMovedPaths.push(rf.destPath);
            } else {
              throw renameErr;
            }
          }
        }
      }

      // Optional hook before verification (e.g. for testing corruption & cleanup recovery)
      if (options?.onBeforeVerification) {
        await options.onBeforeVerification(newlyMovedPaths);
      }

      // Verification Phase on Hard Drive
      let verifiedCount = 0;
      for (const rf of resolvedFiles) {
        const stat = await fsp.stat(rf.destPath);
        if (stat.size !== rf.size) {
          throw new Error(
            `Byte size mismatch for "${rf.destPath}": expected ${rf.size}, got ${stat.size}`
          );
        }
        const destHash = await computeFileHash(rf.destPath);
        if (destHash !== rf.hash) {
          throw new Error(
            `SHA-256 hash mismatch for "${rf.destPath}": expected ${rf.hash}, got ${destHash}`
          );
        }
        verifiedCount++;
      }

      // Atomic Commit to Ledger
      const primaryResolved = resolvedFiles.find((f) => f.fieldname === 'primary')!;
      const relPath = path
        .relative(hardDriveRoot, primaryResolved.destPath)
        .split(path.sep)
        .join('/');

      const canonicalNameWithSuffix = safeSuffix ? `${canonicalName}${safeSuffix}` : canonicalName;
      const entryIdWithSuffix = safeSuffix ? `${bundleId}${safeSuffix}` : bundleId;

      const entry: LedgerEntry = {
        id: entryIdWithSuffix,
        canonicalName: canonicalNameWithSuffix,
        sha256: primaryResolved.hash,
        targetRelPath: relPath,
        capturedAt,
        backedUpAt: new Date().toISOString(),
        decision: decision as 'backup_only' | 'backup_keep',
      };

      const ledger = await loadLedger(hardDriveRoot);
      ledger.set(entry.sha256, entry);
      await saveLedger(hardDriveRoot, ledger);

      // Clean up tmp directory if empty
      try {
        const remaining = await fsp.readdir(tmpBase);
        if (remaining.length === 0) {
          await fsp.rmdir(tmpBase);
        }
      } catch {}

      return reply.status(200).send({
        success: true,
        verifiedCount,
        entries: [entry],
      });
    } catch (err: any) {
      await cleanupTmpFiles();
      await cleanupMovedFiles();
      const msg = err.message || String(err);
      return reply.status(500).send({
        success: false,
        verifiedCount: 0,
        error: msg,
        errors: [msg],
      });
    }
  });
};

export default routes;
