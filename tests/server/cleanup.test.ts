import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import Fastify, { FastifyInstance } from 'fastify';
import type { AssetBundle, LedgerEntry } from '../../src/types/index.js';
import { generateCleanupPayload } from '../../src/server/cleanup.js';
import { routes, SessionManager } from '../../src/server/routes.js';
import { LEDGER_BACKUP_DIR, LEDGER_BACKUP_FILENAME } from '../../src/server/ledger.js';

function createMockBundle(overrides: Partial<AssetBundle> = {}): AssetBundle {
  const canonicalName = overrides.canonicalName || 'IMG_1001';
  const decision = overrides.decision || 'unsorted';
  // Default alreadyBackedUp to true if decision is backup_only, unless explicitly overridden
  const defaultAlreadyBackedUp = decision === 'backup_only';

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
    decision,
    alreadyBackedUp: overrides.alreadyBackedUp !== undefined ? overrides.alreadyBackedUp : defaultAlreadyBackedUp,
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
        alreadyBackedUp: true,
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

    // Earliest approved candidate: 2024-06-15T12:00:00.000Z -> -24h = 2024-06-14T12:00:00.000Z
    expect(result.minDate).toBe('2024-06-14T12:00:00.000Z');
    // Latest approved candidate: 2024-06-20T12:00:00.000Z -> +24h = 2024-06-21T12:00:00.000Z
    expect(result.maxDate).toBe('2024-06-21T12:00:00.000Z');
  });

  it('computes minDate and maxDate ONLY from approvedCandidates, ignoring unreliable date candidates', () => {
    const bundles: AssetBundle[] = [
      createMockBundle({
        id: 'IMG_1001',
        canonicalName: 'IMG_1001',
        capturedAt: '2024-06-15T12:00:00.000Z',
        decision: 'trash',
        dateReliable: true,
      }),
      createMockBundle({
        id: 'IMG_1002',
        canonicalName: 'IMG_1002',
        capturedAt: '2024-06-20T12:00:00.000Z',
        decision: 'backup_only',
        alreadyBackedUp: true,
        dateReliable: true,
      }),
      createMockBundle({
        id: 'IMG_1003',
        canonicalName: 'IMG_1003',
        capturedAt: '2019-01-01T12:00:00.000Z', // Old date from 5 years ago!
        decision: 'trash',
        dateReliable: false, // Unreliable date -> moves to manualDeleteItems
      }),
    ];

    const result = generateCleanupPayload(bundles, new Map());

    // minDate and maxDate MUST be based on IMG_1001 and IMG_1002, NOT IMG_1003!
    expect(result.minDate).toBe('2024-06-14T12:00:00.000Z');
    expect(result.maxDate).toBe('2024-06-21T12:00:00.000Z');
    expect(result.deleteNamesDelimited).toBe('|IMG_1001|IMG_1002|');
    expect(result.manualDeleteItems).toHaveLength(1);
    expect(result.manualDeleteItems[0].canonicalName).toBe('IMG_1003');
  });

  it('requires alreadyBackedUp === true for backup_only candidates before inclusion in approvedCandidates', () => {
    const bundles: AssetBundle[] = [
      createMockBundle({
        id: 'B1',
        canonicalName: 'IMG_1001',
        decision: 'backup_only',
        alreadyBackedUp: false, // NOT yet verified on hard drive!
      }),
      createMockBundle({
        id: 'B2',
        canonicalName: 'IMG_1002',
        decision: 'backup_only',
        alreadyBackedUp: true, // Verified on hard drive
      }),
      createMockBundle({
        id: 'B3',
        canonicalName: 'IMG_1003',
        decision: 'trash', // Trash is always ready for phone deletion
      }),
    ];

    const result = generateCleanupPayload(bundles, new Map());

    // B1 must NOT be in deleteNamesDelimited!
    expect(result.deleteNamesDelimited).toBe('|IMG_1002|IMG_1003|');
    expect(result.deleteCount).toBe(2);
  });

  it('defaults minDate and maxDate to current timestamp when there are no approved candidates', () => {
    const bundles: AssetBundle[] = [
      createMockBundle({ decision: 'backup_keep' }),
      createMockBundle({ decision: 'unsorted' }),
      createMockBundle({ decision: 'backup_only', alreadyBackedUp: false }),
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
      createMockBundle({ canonicalName: 'IMG_1002', decision: 'backup_only', alreadyBackedUp: true }),
    ];

    const result = generateCleanupPayload(bundles, new Map());

    expect(result.deleteNamesDelimited).toBe('|IMG_1001|IMG_1002|');
    expect(result.deleteCount).toBe(2);
    expect(result.manualDeleteItems).toHaveLength(0);
  });

  it('deduplicates names in deleteNamesDelimited using Set to avoid redundant tokens', () => {
    const bundles: AssetBundle[] = [
      createMockBundle({ id: '1', canonicalName: 'IMG_1001', decision: 'trash' }),
      createMockBundle({ id: '2', canonicalName: 'IMG_1001', decision: 'trash' }),
      createMockBundle({ id: '3', canonicalName: 'IMG_1002', decision: 'trash' }),
    ];

    const result = generateCleanupPayload(bundles, new Map());

    expect(result.deleteNamesDelimited).toBe('|IMG_1001|IMG_1002|');
  });

  it('separates candidates that collide with backup_keep in the ledger into manualDeleteItems', () => {
    const bundles: AssetBundle[] = [
      createMockBundle({
        id: 'IMG_1001',
        canonicalName: 'IMG_1001',
        decision: 'backup_only',
        alreadyBackedUp: true,
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
        alreadyBackedUp: true,
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
        alreadyBackedUp: true,
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
  let fakeHomeDir: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleanup-routes-test-'));
    stagingDir = path.join(tmpDir, 'staging');
    hardDriveRoot = path.join(tmpDir, 'harddrive');
    fakeHomeDir = path.join(tmpDir, 'home');
    process.env.PHOTO_TRIAGE_HOME = fakeHomeDir;

    await fsp.mkdir(stagingDir, { recursive: true });
    await fsp.mkdir(hardDriveRoot, { recursive: true });
    await fsp.mkdir(fakeHomeDir, { recursive: true });

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
    delete process.env.PHOTO_TRIAGE_HOME;
    await app.close();
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  describe('GET /api/session', () => {
    it('returns current staging batch, triage counts, and hardDriveMounted status', async () => {
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
      expect(json.hardDriveMounted).toBe(true);
    });

    it('reports hardDriveMounted: false when hardDriveRoot is not mounted or missing', async () => {
      sessionManager.setState({ hardDriveRoot: '/nonexistent/missing/drive/path' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/session',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().hardDriveMounted).toBe(false);
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

    it('executes backup and marks session backup as verified when ALL backup bundles complete', async () => {
      // Create real dummy file in staging
      const file1 = path.join(stagingDir, 'IMG_0001.HEIC');
      await fsp.writeFile(file1, 'photo 1 data');

      sessionManager.setState({
        bundles: [
          createMockBundle({
            id: 'B1',
            canonicalName: 'IMG_0001',
            decision: 'backup_only',
            alreadyBackedUp: false,
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

    it('does NOT mark session as cleanup_ready when only a partial subset of bundles is backed up', async () => {
      const file1 = path.join(stagingDir, 'IMG_0001.HEIC');
      const file2 = path.join(stagingDir, 'IMG_0002.HEIC');
      await fsp.writeFile(file1, 'photo 1 data');
      await fsp.writeFile(file2, 'photo 2 data');

      sessionManager.setState({
        bundles: [
          createMockBundle({
            id: 'B1',
            canonicalName: 'IMG_0001',
            decision: 'backup_only',
            alreadyBackedUp: false,
            files: [
              { path: file1, filename: 'IMG_0001.HEIC', ext: '.heic', size: 12, role: 'primary' },
            ],
          }),
          createMockBundle({
            id: 'B2',
            canonicalName: 'IMG_0002',
            decision: 'backup_only',
            alreadyBackedUp: false,
            files: [
              { path: file2, filename: 'IMG_0002.HEIC', ext: '.heic', size: 12, role: 'primary' },
            ],
          }),
        ],
      });

      // Partial backup: only backup B1
      const response = await app.inject({
        method: 'POST',
        url: '/api/backup',
        payload: {
          bundleIds: ['B1'],
        },
      });

      expect(response.statusCode).toBe(200);
      const session = sessionManager.getState();
      // Partial backup safety: B2 is not backed up yet, so cleanup must remain locked!
      expect(session.isBackupVerified).toBe(false);
      expect(session.status).toBe('triaging');

      // Now backup B2
      const response2 = await app.inject({
        method: 'POST',
        url: '/api/backup',
        payload: {
          bundleIds: ['B2'],
        },
      });

      expect(response2.statusCode).toBe(200);
      const finalSession = sessionManager.getState();
      expect(finalSession.isBackupVerified).toBe(true);
      expect(finalSession.status).toBe('cleanup_ready');
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
            alreadyBackedUp: true,
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

    it('falls back to mirror ledger when hard drive ledger is unreadable', async () => {
      // Create mirror ledger in fakeHomeDir/.photo-triage/ledger-backup.json
      const mirrorDir = path.join(fakeHomeDir, LEDGER_BACKUP_DIR);
      await fsp.mkdir(mirrorDir, { recursive: true });
      const mirrorFile = path.join(mirrorDir, LEDGER_BACKUP_FILENAME);

      const mirrorEntries = [
        {
          id: 'IMG_0001',
          canonicalName: 'IMG_0001',
          sha256: 'hash1',
          targetRelPath: '2024/JUNE/IMG_0001.HEIC',
          capturedAt: '2024-06-01T10:00:00.000Z',
          backedUpAt: '2024-06-01T11:00:00.000Z',
          decision: 'backup_keep', // Collision with candidate!
        },
      ];
      await fsp.writeFile(mirrorFile, JSON.stringify(mirrorEntries));

      // Point hardDriveRoot to non-existent directory so loadLedger fails
      sessionManager.setState({
        isBackupVerified: true,
        hardDriveRoot: '/nonexistent/corrupt/hd/path',
        bundles: [
          createMockBundle({
            canonicalName: 'IMG_0001',
            decision: 'backup_only',
            alreadyBackedUp: true,
          }),
          createMockBundle({
            canonicalName: 'IMG_0002',
            decision: 'trash',
          }),
        ],
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/cleanup-batch',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      // Mirror ledger was loaded and flagged IMG_0001 as keep_collision!
      expect(json.deleteNamesDelimited).toBe('|IMG_0002|');
      expect(json.manualDeleteItems).toHaveLength(1);
      expect(json.manualDeleteItems[0].canonicalName).toBe('IMG_0001');
      expect(json.manualDeleteItems[0].reason).toBe('keep_collision');
    });

    it('returns HTTP 500 when hard drive ledger fails AND mirror ledger cannot be loaded', async () => {
      sessionManager.setState({
        isBackupVerified: true,
        hardDriveRoot: '/nonexistent/corrupt/hd/path',
        bundles: [
          createMockBundle({
            canonicalName: 'IMG_0001',
            decision: 'trash',
          }),
        ],
      });

      // fakeHomeDir has no mirror ledger file
      const response = await app.inject({
        method: 'GET',
        url: '/api/cleanup-batch',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toContain('Cannot verify ledger for safety collision checks');
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
