import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import Fastify, { FastifyInstance } from 'fastify';
import type { AssetBundle, LedgerEntry } from '../../src/types/index.js';
import { generateCleanupPayload } from '../../src/server/cleanup.js';
import { routes, SessionManager } from '../../src/server/routes.js';

function createMockBundle(overrides: Partial<AssetBundle> = {}): AssetBundle {
  const canonicalName = overrides.canonicalName || 'IMG_1001';
  return {
    id: overrides.id || canonicalName,
    canonicalName,
    files: [
      {
        path: `/mock/staging/${canonicalName}.HEIC`,
        filename: `${canonicalName}.HEIC`,
        ext: '.heic',
        size: 1024,
        role: 'primary',
      },
    ],
    previewPath: `/mock/staging/${canonicalName}.HEIC`,
    capturedAt: overrides.capturedAt || '2024-06-15T12:00:00.000Z',
    targetYear: '2024',
    targetMonth: 'JUNE',
    dateReliable: overrides.dateReliable !== undefined ? overrides.dateReliable : true,
    decision: overrides.decision || 'unsorted',
    alreadyBackedUp: overrides.alreadyBackedUp || false,
    ...overrides,
  };
}

describe('Cleanup Payload Generation (generateCleanupPayload)', () => {
  it('computes minDate and maxDate spanning candidate dates with ±24 hour padding', () => {
    const bundles: AssetBundle[] = [
      createMockBundle({
        id: 'IMG_1001',
        canonicalName: 'IMG_1001',
        capturedAt: '2024-06-15T12:00:00.000Z',
        decision: 'trash',
      }),
      createMockBundle({
        id: 'IMG_1002',
        canonicalName: 'IMG_1002',
        capturedAt: '2024-06-20T12:00:00.000Z',
        decision: 'backup_only',
      }),
      createMockBundle({
        id: 'IMG_1000',
        canonicalName: 'IMG_1000',
        capturedAt: '2024-05-01T12:00:00.000Z',
        decision: 'backup_keep', // Not a delete candidate! Must not affect min/max
      }),
    ];

    const ledger = new Map<string, LedgerEntry>();
    const result = generateCleanupPayload(bundles, ledger);

    // Earliest candidate: 2024-06-15T12:00:00.000Z -> -24h = 2024-06-14T12:00:00.000Z
    expect(result.minDate).toBe('2024-06-14T12:00:00.000Z');
    // Latest candidate: 2024-06-20T12:00:00.000Z -> +24h = 2024-06-21T12:00:00.000Z
    expect(result.maxDate).toBe('2024-06-21T12:00:00.000Z');
  });

  it('defaults minDate and maxDate to current timestamp when there are no delete candidates', () => {
    const bundles: AssetBundle[] = [
      createMockBundle({ decision: 'backup_keep' }),
      createMockBundle({ decision: 'unsorted' }),
    ];

    const before = Date.now();
    const result = generateCleanupPayload(bundles, new Map());
    const after = Date.now();

    const minMs = new Date(result.minDate).getTime();
    const maxMs = new Date(result.maxDate).getTime();

    expect(minMs).toBeGreaterThanOrEqual(before - 1000);
    expect(minMs).toBeLessThanOrEqual(after + 1000);
    expect(maxMs).toBe(minMs);
    expect(result.deleteCount).toBe(0);
    expect(result.deleteNamesDelimited).toBe('');
  });

  it('formats deleteNamesDelimited with pipe delimiters (e.g. |IMG_1001|IMG_1002|)', () => {
    const bundles: AssetBundle[] = [
      createMockBundle({ canonicalName: 'IMG_1001', decision: 'trash' }),
      createMockBundle({ canonicalName: 'IMG_1002', decision: 'backup_only' }),
    ];

    const result = generateCleanupPayload(bundles, new Map());

    expect(result.deleteNamesDelimited).toBe('|IMG_1001|IMG_1002|');
    expect(result.deleteCount).toBe(2);
    expect(result.manualDeleteItems).toHaveLength(0);
  });

  it('separates candidates that collide with backup_keep in the ledger into manualDeleteItems', () => {
    const bundles: AssetBundle[] = [
      createMockBundle({
        id: 'IMG_1001',
        canonicalName: 'IMG_1001',
        decision: 'backup_only',
      }),
      createMockBundle({
        id: 'IMG_1002',
        canonicalName: 'IMG_1002',
        decision: 'trash',
      }),
    ];

    const ledger = new Map<string, LedgerEntry>();
    ledger.set('dummyhash1', {
      id: 'IMG_1001',
      canonicalName: 'IMG_1001',
      sha256: 'dummyhash1',
      targetRelPath: '2024/JUNE/IMG_1001.HEIC',
      capturedAt: '2024-06-01T10:00:00.000Z',
      backedUpAt: '2024-06-01T11:00:00.000Z',
      decision: 'backup_keep', // Collision with candidate IMG_1001!
    });

    const result = generateCleanupPayload(bundles, ledger);

    // IMG_1001 collided with a backup_keep photo in the ledger
    expect(result.deleteNamesDelimited).toBe('|IMG_1002|');
    expect(result.deleteCount).toBe(1);
    expect(result.manualDeleteItems).toHaveLength(1);
    expect(result.manualDeleteItems[0].canonicalName).toBe('IMG_1001');
    expect((result.manualDeleteItems[0] as any).reason).toBe('keep_collision');
  });

  it('separates candidates that collide with backup_keep in current session into manualDeleteItems', () => {
    const bundles: AssetBundle[] = [
      createMockBundle({
        id: 'IMG_2001_A',
        canonicalName: 'IMG_2001',
        decision: 'backup_keep', // marked keep in current session
      }),
      createMockBundle({
        id: 'IMG_2001_B',
        canonicalName: 'IMG_2001',
        decision: 'trash', // same canonical name, marked trash
      }),
      createMockBundle({
        id: 'IMG_2002',
        canonicalName: 'IMG_2002',
        decision: 'backup_only',
      }),
    ];

    const result = generateCleanupPayload(bundles, new Map());

    expect(result.deleteNamesDelimited).toBe('|IMG_2002|');
    expect(result.deleteCount).toBe(1);
    expect(result.manualDeleteItems).toHaveLength(1);
    expect(result.manualDeleteItems[0].canonicalName).toBe('IMG_2001');
    expect((result.manualDeleteItems[0] as any).reason).toBe('keep_collision');
  });

  it('separates candidates with dateReliable: false into manualDeleteItems with reason: unreliable_date', () => {
    const bundles: AssetBundle[] = [
      createMockBundle({
        canonicalName: 'IMG_3001',
        decision: 'backup_only',
        dateReliable: false, // Unreliable date!
      }),
      createMockBundle({
        canonicalName: 'IMG_3002',
        decision: 'trash',
        dateReliable: true,
      }),
    ];

    const result = generateCleanupPayload(bundles, new Map());

    expect(result.deleteNamesDelimited).toBe('|IMG_3002|');
    expect(result.deleteCount).toBe(1);
    expect(result.manualDeleteItems).toHaveLength(1);
    expect(result.manualDeleteItems[0].canonicalName).toBe('IMG_3001');
    expect((result.manualDeleteItems[0] as any).reason).toBe('unreliable_date');
  });

  it('ensures backup_keep items are NEVER in deleteNamesDelimited or manualDeleteItems', () => {
    const bundles: AssetBundle[] = [
      createMockBundle({ canonicalName: 'IMG_4001', decision: 'backup_keep' }),
      createMockBundle({ canonicalName: 'IMG_4002', decision: 'unsorted' }),
    ];

    const result = generateCleanupPayload(bundles, new Map());

    expect(result.deleteNamesDelimited).toBe('');
    expect(result.deleteCount).toBe(0);
    expect(result.manualDeleteItems).toHaveLength(0);
  });
});

describe('Fastify REST API Routes', () => {
  let app: FastifyInstance;
  let sessionManager: SessionManager;
  let tmpDir: string;
  let stagingDir: string;
  let hardDriveRoot: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleanup-routes-test-'));
    stagingDir = path.join(tmpDir, 'staging');
    hardDriveRoot = path.join(tmpDir, 'harddrive');
    await fsp.mkdir(stagingDir, { recursive: true });
    await fsp.mkdir(hardDriveRoot, { recursive: true });

    sessionManager = new SessionManager({
      stagingDir,
      hardDriveRoot,
      bundles: [
        createMockBundle({ id: 'B1', canonicalName: 'IMG_0001', decision: 'unsorted' }),
        createMockBundle({ id: 'B2', canonicalName: 'IMG_0002', decision: 'unsorted' }),
        createMockBundle({ id: 'B3', canonicalName: 'IMG_0003', decision: 'unsorted' }),
      ],
    });

    app = Fastify();
    await app.register(routes, { sessionManager });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  describe('GET /api/session', () => {
    it('returns current staging batch and triage counts', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/session',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.bundles).toHaveLength(3);
      expect(json.counts).toEqual({
        total: 3,
        unsorted: 3,
        trash: 0,
        backup_only: 0,
        backup_keep: 0,
        alreadyBackedUp: 0,
      });
      expect(json.stagingDir).toBe(stagingDir);
      expect(json.hardDriveRoot).toBe(hardDriveRoot);
    });
  });

  describe('POST /api/triage', () => {
    it('updates single bundle decision and recomputes counts', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/triage',
        payload: {
          bundleId: 'B1',
          decision: 'trash',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.updatedCount).toBe(1);
      expect(json.counts.trash).toBe(1);
      expect(json.counts.unsorted).toBe(2);

      // Verify session updated
      const sessionRes = await app.inject({ method: 'GET', url: '/api/session' });
      expect(sessionRes.json().counts.trash).toBe(1);
    });

    it('updates multiple bundle decisions with bundleIds array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/triage',
        payload: {
          bundleIds: ['B2', 'B3'],
          decision: 'backup_only',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.updatedCount).toBe(2);
      expect(json.counts.backup_only).toBe(2);
      expect(json.counts.unsorted).toBe(1);
    });

    it('returns 400 for invalid decision', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/triage',
        payload: {
          bundleId: 'B1',
          decision: 'invalid_decision',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when bundleId or bundleIds is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/triage',
        payload: {
          decision: 'trash',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/backup', () => {
    it('returns 400 when hardDriveRoot or stagingDir is missing', async () => {
      sessionManager.setState({ hardDriveRoot: '', stagingDir: '' });

      const response = await app.inject({
        method: 'POST',
        url: '/api/backup',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('executes backup and marks session backup as verified', async () => {
      // Create real dummy files in staging
      const file1 = path.join(stagingDir, 'IMG_0001.HEIC');
      await fsp.writeFile(file1, 'photo 1 data');

      sessionManager.setState({
        bundles: [
          createMockBundle({
            id: 'B1',
            canonicalName: 'IMG_0001',
            decision: 'backup_only',
            files: [
              {
                path: file1,
                filename: 'IMG_0001.HEIC',
                ext: '.heic',
                size: 12,
                role: 'primary',
              },
            ],
          }),
        ],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/backup',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.verifiedCount).toBe(1);

      const session = sessionManager.getState();
      expect(session.isBackupVerified).toBe(true);
      expect(session.status).toBe('cleanup_ready');
    });
  });

  describe('GET /api/cleanup-batch', () => {
    it('returns 400 when backup has not been verified yet (locks cleanup)', async () => {
      sessionManager.setState({ isBackupVerified: false });

      const response = await app.inject({
        method: 'GET',
        url: '/api/cleanup-batch',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Backup has not been verified');
    });

    it('returns cleanup payload when backup is verified', async () => {
      sessionManager.setState({
        isBackupVerified: true,
        bundles: [
          createMockBundle({
            canonicalName: 'IMG_0001',
            decision: 'backup_only',
            capturedAt: '2024-06-15T10:00:00.000Z',
          }),
          createMockBundle({
            canonicalName: 'IMG_0002',
            decision: 'trash',
            capturedAt: '2024-06-16T10:00:00.000Z',
          }),
        ],
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/cleanup-batch',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.deleteNamesDelimited).toBe('|IMG_0001|IMG_0002|');
      expect(json.deleteCount).toBe(2);
      expect(json.minDate).toBe('2024-06-14T10:00:00.000Z');
      expect(json.maxDate).toBe('2024-06-17T10:00:00.000Z');
    });

    it('allows bypassing unverified lock when force=true query param is set', async () => {
      sessionManager.setState({
        isBackupVerified: false,
        bundles: [
          createMockBundle({
            canonicalName: 'IMG_0001',
            decision: 'trash',
          }),
        ],
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/cleanup-batch?force=true',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().deleteCount).toBe(1);
    });
  });

  describe('POST /api/cleanup-complete', () => {
    it('records cleanup completion and updates session status to completed', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cleanup-complete',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);

      const session = sessionManager.getState();
      expect(session.cleanupCompleted).toBe(true);
      expect(session.status).toBe('completed');
    });
  });
});
