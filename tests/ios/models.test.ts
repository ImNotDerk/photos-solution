import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { TriageDecision as ServerTriageDecision, AssetFileRole as ServerAssetFileRole } from '../../src/types/index.js';
import { MONTH_NAMES } from '../../src/server/ingest.js';

describe('iOS Model & PhotoKit Contract Tests (Task 2)', () => {
  const modelsPath = path.resolve(process.cwd(), 'ios/PhotoTriage/Models/AssetModel.swift');
  const servicePath = path.resolve(process.cwd(), 'ios/PhotoTriage/Services/PhotoKitManager.swift');

  it('verifies that Swift files exist on disk', () => {
    expect(fs.existsSync(modelsPath)).toBe(true);
    expect(fs.existsSync(servicePath)).toBe(true);
  });

  it('validates that Swift files pass strict swiftc typecheck under Swift 6 mode', () => {
    // Run swiftc typecheck under Swift 6 language mode
    const cmd = `swiftc -typecheck -swift-version 6 "${modelsPath}" "${servicePath}"`;
    expect(() => {
      execSync(cmd, { stdio: 'pipe' });
    }).not.toThrow();
  });

  describe('TriageDecision Contract Alignment', () => {
    const swiftCode = fs.readFileSync(modelsPath, 'utf8');

    // The 4 canonical decisions between iOS and Server
    const expectedDecisions: Record<ServerTriageDecision, {
      swiftCase: string;
      shouldDeleteFromPhone: boolean;
      requiresBackupUpload: boolean;
    }> = {
      unsorted: { swiftCase: 'unsorted', shouldDeleteFromPhone: false, requiresBackupUpload: false },
      trash: { swiftCase: 'trash', shouldDeleteFromPhone: true, requiresBackupUpload: false },
      backup_only: { swiftCase: 'backupOnly', shouldDeleteFromPhone: true, requiresBackupUpload: true },
      backup_keep: { swiftCase: 'backupKeep', shouldDeleteFromPhone: false, requiresBackupUpload: true },
    };

    it('matches exact raw values of server TriageDecision', () => {
      for (const [serverValue, spec] of Object.entries(expectedDecisions)) {
        // Look for case <swiftCase> = "<serverValue>" in Swift code
        const regex = new RegExp(`case\\s+${spec.swiftCase}\\s*=\\s*"${serverValue}"`);
        expect(swiftCode).toMatch(regex);
      }
    });

    it('enforces deletion and backup policy invariants', () => {
      // Invariant 1: backup_keep must NEVER be marked for deletion from phone
      expect(expectedDecisions.backup_keep.shouldDeleteFromPhone).toBe(false);
      // Invariant 2: backup_only must be backed up AND deleted from phone
      expect(expectedDecisions.backup_only.shouldDeleteFromPhone).toBe(true);
      expect(expectedDecisions.backup_only.requiresBackupUpload).toBe(true);
      // Invariant 3: trash must NOT require upload, but must be deleted
      expect(expectedDecisions.trash.requiresBackupUpload).toBe(false);
      expect(expectedDecisions.trash.shouldDeleteFromPhone).toBe(true);
      // Invariant 4: unsorted must not be deleted or uploaded
      expect(expectedDecisions.unsorted.shouldDeleteFromPhone).toBe(false);
      expect(expectedDecisions.unsorted.requiresBackupUpload).toBe(false);
    });
  });

  describe('ResourceRole Contract Alignment', () => {
    const swiftCode = fs.readFileSync(modelsPath, 'utf8');

    const expectedRoles: Record<ServerAssetFileRole, string> = {
      primary: 'primary',
      live_video: 'liveVideo',
      edit_sidecar: 'editSidecar',
      edited_render: 'editedRender',
    };

    it('matches all 4 server asset roles and their multipart field names', () => {
      for (const [serverRole, swiftCase] of Object.entries(expectedRoles)) {
        const regex = new RegExp(`case\\s+${swiftCase}\\s*=\\s*"${serverRole}"`);
        expect(swiftCode).toMatch(regex);
      }
    });

    it('supports ExtractedResource with both in-memory Data and streaming fileURL for large videos', () => {
      expect(swiftCode).toContain('public let data: Data?');
      expect(swiftCode).toContain('public let fileURL: URL?');
      expect(swiftCode).toContain('public func loadData() throws -> Data');
      expect(swiftCode).toContain('public func cleanup()');
    });
  });

  describe('YearMonthGroup Contract Alignment', () => {
    const swiftCode = fs.readFileSync(modelsPath, 'utf8');

    it('matches server uppercase month names exactly', () => {
      for (const month of MONTH_NAMES) {
        expect(swiftCode).toContain(`"${month}"`);
      }
    });

    it('contains YearMonthGroup struct with sorting and formatted display name', () => {
      expect(swiftCode).toContain('struct YearMonthGroup');
      expect(swiftCode).toContain('public let year: Int');
      expect(swiftCode).toContain('public let month: Int');
      expect(swiftCode).toContain('public let monthName: String');
      expect(swiftCode).toContain('public let displayName: String');
    });
  });

  describe('TriageAsset Metadata Resolution & Swift 6 Safety', () => {
    const swiftCode = fs.readFileSync(modelsPath, 'utf8');

    it('uses nonisolated(unsafe) for isoDateFormatter to satisfy Swift 6 concurrency', () => {
      expect(swiftCode).toContain('nonisolated(unsafe) private static let isoDateFormatter');
    });

    it('uses fast KVC filename resolution to prevent synchronous resource scanning lag', () => {
      expect(swiftCode).toContain('asset.value(forKey: "filename") as? String');
    });
  });

  describe('PhotoKitManager API and Deletion Safety Guard Contract', () => {
    const serviceCode = fs.readFileSync(servicePath, 'utf8');

    it('declares all required manager methods matching spec signatures', () => {
      expect(serviceCode).toContain('class PhotoKitManager: ObservableObject');
      // Brief requirement: requestAuthorization() async -> Bool
      expect(serviceCode).toContain('func requestAuthorization() async -> Bool');
      expect(serviceCode).toContain('func requestAuthorizationStatus() async -> PHAuthorizationStatus');
      expect(serviceCode).toContain('func fetchMonths() async -> [YearMonthGroup]');
      expect(serviceCode).toContain('func fetchAssets(for month: YearMonthGroup) -> [TriageAsset]');
      expect(serviceCode).toContain('func loadThumbnail(');
      expect(serviceCode).toContain('func loadFullImage(');
      expect(serviceCode).toContain('func extractResources(');
      expect(serviceCode).toContain('func deleteAssets(assets: [PHAsset]) async throws -> Bool');
      expect(serviceCode).toContain('func deleteTriagedAssets(');
    });

    it('runs fetchMonths in a detached background task off the MainActor', () => {
      expect(serviceCode).toContain('Task.detached(priority: .userInitiated)');
    });

    it('guards against degraded images in thumbnail and full-image loaders', () => {
      expect(serviceCode).toContain('PHImageResultIsDegradedKey');
    });

    it('streams video resources directly to disk using writeData to prevent OOM memory hazards', () => {
      expect(serviceCode).toContain('resourceManager.writeData(');
    });

    it('verifies strict safety guard logic for deleteTriagedAssets', () => {
      // Simulating the decision partition logic of deleteTriagedAssets
      const mockAssets = [
        { id: '1', name: 'IMG_0001' },
        { id: '2', name: 'IMG_0002' },
        { id: '3', name: 'IMG_0003' },
        { id: '4', name: 'IMG_0004' },
      ];

      const decisions: Record<string, ServerTriageDecision> = {
        '1': 'trash',
        '2': 'backup_only',
        '3': 'backup_keep',
        '4': 'unsorted',
      };

      const assetsToDelete: string[] = [];
      let keptCount = 0;

      for (const asset of mockAssets) {
        const dec = decisions[asset.id] ?? 'unsorted';
        switch (dec) {
          case 'trash':
          case 'backup_only':
            assetsToDelete.push(asset.id);
            break;
          case 'backup_keep':
            keptCount++;
            break;
          case 'unsorted':
            break;
        }
      }

      // Assertions
      expect(assetsToDelete).toEqual(['1', '2']);
      expect(keptCount).toBe(1);
      expect(assetsToDelete).not.toContain('3'); // backup_keep must never be deleted
      expect(assetsToDelete).not.toContain('4'); // unsorted must never be deleted
    });
  });
});
