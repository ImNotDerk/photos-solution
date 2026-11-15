import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type {
  AssetBundle,
  BackupRequest,
  SessionState,
  SessionStatus,
  TriageCounts,
  TriageDecision,
  TriageUpdateRequest,
} from '../types/index.js';
import { generateCleanupPayload } from './cleanup.js';
import { scanStagingDirectory } from './ingest.js';
import { checkDuplicates, loadLedger } from './ledger.js';
import { executeBackup } from './backup.js';

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
    };
  }
}

export const defaultSessionManager = new SessionManager();

export interface RoutesOptions {
  sessionManager?: SessionManager;
}

export const routes: FastifyPluginAsync<RoutesOptions> = async (
  fastify: FastifyInstance,
  options?: RoutesOptions
) => {
  const manager = options?.sessionManager || defaultSessionManager;

  /**
   * GET /api/session
   * Returns current staging batch, triage counts, and session state.
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

    // Scan staging if explicitly requested or if stagingDir is set but bundles are empty
    if ((scan === 'true' || scan === true) && currentState.stagingDir) {
      try {
        let bundles = await scanStagingDirectory(currentState.stagingDir);

        if (currentState.hardDriveRoot) {
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

    return reply.status(200).send(manager.getState());
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

        manager.setState({
          isBackupVerified: true,
          status: 'cleanup_ready',
          bundles: currentState.bundles,
        });

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

    let ledger = new Map();
    if (currentState.hardDriveRoot) {
      try {
        ledger = await loadLedger(currentState.hardDriveRoot);
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
};

export default routes;
