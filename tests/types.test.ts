import { describe, it, expect } from 'vitest';
import type {
  TriageDecision,
  AssetFileRole,
  AssetFile,
  AssetBundle,
  LedgerEntry,
  SessionState,
  CleanupBatchResponse,
  BackupResult,
  TriageUpdateRequest,
  BackupRequest,
  ManualDeleteItem,
} from '../src/types/index.js';

describe('Core Domain Types', () => {
  it('should validate TriageDecision union values', () => {
    const validDecisions: TriageDecision[] = [
      'unsorted',
      'trash',
      'backup_only',
      'backup_keep',
    ];
    expect(validDecisions).toHaveLength(4);
    expect(validDecisions).toContain('unsorted');
    expect(validDecisions).toContain('trash');
    expect(validDecisions).toContain('backup_only');
    expect(validDecisions).toContain('backup_keep');
  });

  it('should validate AssetFile and AssetFileRole', () => {
    const roles: AssetFileRole[] = [
      'primary',
      'live_video',
      'edit_sidecar',
      'edited_render',
    ];
    expect(roles).toHaveLength(4);

    const file: AssetFile = {
      path: '/staging/IMG_1234.HEIC',
      filename: 'IMG_1234.HEIC',
      ext: '.HEIC',
      size: 2048576,
      role: 'primary',
    };

    expect(file.path).toBe('/staging/IMG_1234.HEIC');
    expect(file.filename).toBe('IMG_1234.HEIC');
    expect(file.ext).toBe('.HEIC');
    expect(file.size).toBe(2048576);
    expect(file.role).toBe('primary');
  });

  it('should validate AssetBundle structure with companion files', () => {
    const primaryFile: AssetFile = {
      path: '/staging/IMG_1234.HEIC',
      filename: 'IMG_1234.HEIC',
      ext: '.HEIC',
      size: 2048576,
      role: 'primary',
    };
    const liveVideoFile: AssetFile = {
      path: '/staging/IMG_1234.MOV',
      filename: 'IMG_1234.MOV',
      ext: '.MOV',
      size: 4096000,
      role: 'live_video',
    };
    const sidecarFile: AssetFile = {
      path: '/staging/IMG_1234.AAE',
      filename: 'IMG_1234.AAE',
      ext: '.AAE',
      size: 1024,
      role: 'edit_sidecar',
    };

    const bundle: AssetBundle = {
      id: 'IMG_1234',
      canonicalName: 'IMG_1234',
      files: [primaryFile, liveVideoFile, sidecarFile],
      previewPath: '/previews/IMG_1234.jpg',
      capturedAt: '2024-05-15T14:32:00.000Z',
      targetYear: '2024',
      targetMonth: 'MAY',
      dateReliable: true,
      decision: 'unsorted',
      alreadyBackedUp: false,
    };

    expect(bundle.id).toBe('IMG_1234');
    expect(bundle.canonicalName).toBe('IMG_1234');
    expect(bundle.files).toHaveLength(3);
    expect(bundle.targetYear).toBe('2024');
    expect(bundle.targetMonth).toBe('MAY');
    expect(bundle.dateReliable).toBe(true);
    expect(bundle.decision).toBe('unsorted');
    expect(bundle.alreadyBackedUp).toBe(false);
  });

  it('should validate LedgerEntry structure', () => {
    const entry: LedgerEntry = {
      id: 'IMG_1234',
      canonicalName: 'IMG_1234',
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      targetRelPath: '2024/MAY/IMG_1234.HEIC',
      capturedAt: '2024-05-15T14:32:00.000Z',
      backedUpAt: '2024-05-16T10:00:00.000Z',
      decision: 'backup_only',
    };

    expect(entry.id).toBe('IMG_1234');
    expect(entry.sha256).toHaveLength(64);
    expect(entry.targetRelPath).toBe('2024/MAY/IMG_1234.HEIC');
    expect(entry.decision).toBe('backup_only');
  });

  it('should validate SessionState structure', () => {
    const session: SessionState = {
      sessionId: 'session-001',
      stagingDir: '/Volumes/Staging/AirDrop',
      hardDriveRoot: '/Volumes/ExternalHD/Photos',
      bundles: [],
      counts: {
        total: 0,
        unsorted: 0,
        trash: 0,
        backup_only: 0,
        backup_keep: 0,
        alreadyBackedUp: 0,
      },
      status: 'staging',
      isBackupVerified: false,
    };

    expect(session.sessionId).toBe('session-001');
    expect(session.counts.total).toBe(0);
    expect(session.status).toBe('staging');
    expect(session.isBackupVerified).toBe(false);
  });

  it('should validate CleanupBatchResponse and ManualDeleteItem', () => {
    const manualItem: ManualDeleteItem = {
      id: 'IMG_9999',
      canonicalName: 'IMG_9999',
      previewPath: '/previews/IMG_9999.jpg',
      reason: 'keep_collision',
    };

    const cleanupResponse: CleanupBatchResponse = {
      minDate: '2024-05-14T00:00:00.000Z',
      maxDate: '2024-05-16T23:59:59.000Z',
      deleteNamesDelimited: '|IMG_1001|IMG_1002|',
      deleteCount: 2,
      manualDeleteItems: [manualItem],
      totalCandidates: 3,
    };

    expect(cleanupResponse.deleteNamesDelimited).toBe('|IMG_1001|IMG_1002|');
    expect(cleanupResponse.deleteCount).toBe(2);
    expect(cleanupResponse.manualDeleteItems).toHaveLength(1);
  });

  it('should validate BackupResult', () => {
    const result: BackupResult = {
      success: true,
      copiedCount: 5,
      verifiedCount: 5,
      failedFiles: [],
      errors: [],
    };

    expect(result.success).toBe(true);
    expect(result.copiedCount).toBe(5);
    expect(result.verifiedCount).toBe(5);
  });

  it('should validate TriageUpdateRequest and BackupRequest', () => {
    const updateReq: TriageUpdateRequest = {
      bundleIds: ['IMG_1001', 'IMG_1002'],
      decision: 'backup_keep',
    };
    expect(updateReq.bundleIds).toHaveLength(2);
    expect(updateReq.decision).toBe('backup_keep');

    const backupReq: BackupRequest = {
      hardDriveRoot: '/Volumes/Backup',
      stagingDir: '/staging',
    };
    expect(backupReq.hardDriveRoot).toBe('/Volumes/Backup');
  });
});
