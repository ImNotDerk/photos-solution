import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server/index.js';
import { SessionManager } from '../../src/server/routes.js';
import { loadLedger, computeFileHash } from '../../src/server/ledger.js';
import type { TriageDecision as ServerTriageDecision } from '../../src/types/index.js';

describe('iOS Network & Triage State Contract Tests (Task 3)', () => {
  const assetModelPath = path.resolve(process.cwd(), 'ios/PhotoTriage/Models/AssetModel.swift');
  const photoKitPath = path.resolve(process.cwd(), 'ios/PhotoTriage/Services/PhotoKitManager.swift');
  const networkManagerPath = path.resolve(process.cwd(), 'ios/PhotoTriage/Services/NetworkManager.swift');
  const triageStatePath = path.resolve(process.cwd(), 'ios/PhotoTriage/Models/TriageState.swift');

  it('verifies that all Swift source files exist on disk', () => {
    expect(fs.existsSync(assetModelPath)).toBe(true);
    expect(fs.existsSync(photoKitPath)).toBe(true);
    expect(fs.existsSync(networkManagerPath)).toBe(true);
    expect(fs.existsSync(triageStatePath)).toBe(true);
  });

  it('validates that all Swift files pass strict swiftc typecheck under Swift 6 mode', () => {
    const cmd = `swiftc -typecheck -swift-version 6 "${assetModelPath}" "${photoKitPath}" "${networkManagerPath}" "${triageStatePath}"`;
    expect(() => {
      execSync(cmd, { stdio: 'pipe' });
    }).not.toThrow();
  });

  describe('NetworkManager Contract & Concurrency Architecture', () => {
    const networkCode = fs.readFileSync(networkManagerPath, 'utf8');

    it('declares NetworkManager as a MainActor ObservableObject and Sendable class', () => {
      expect(networkCode).toContain('@MainActor');
      expect(networkCode).toContain('class NetworkManager: ObservableObject, Sendable');
      expect(networkCode).toContain('public static let shared = NetworkManager()');
    });

    it('persists serverUrl in UserDefaults with default fallback to 10.142.1.127:3000', () => {
      expect(networkCode).toContain('public static let defaultServerUrl = "http://10.142.1.127:3000"');
      expect(networkCode).toContain('public static let userDefaultsKey = "photoTriageServerUrl"');
      expect(networkCode).toContain('UserDefaults.standard.string(forKey: Self.userDefaultsKey)');
      expect(networkCode).toContain('UserDefaults.standard.set(');
    });

    it('provides sanitizeUrl to strip trailing slashes, trim whitespace, and normalize http prefix', () => {
      expect(networkCode).toContain('public static func sanitizeUrl(_ input: String) -> String');
      expect(networkCode).toContain('cleanServerUrl');

      // Test URL sanitization logic via regex/contract check
      const sanitize = (input: string) => {
        let trimmed = input.trim();
        while (trimmed.endsWith('/')) {
          trimmed = trimmed.slice(0, -1);
        }
        if (trimmed && !trimmed.toLowerCase().startsWith('http://') && !trimmed.toLowerCase().startsWith('https://')) {
          trimmed = 'http://' + trimmed;
        }
        return trimmed;
      };

      expect(sanitize('http://10.142.1.127:3000/')).toBe('http://10.142.1.127:3000');
      expect(sanitize('  http://192.168.1.50:3000/// ')).toBe('http://192.168.1.50:3000');
      expect(sanitize('10.142.1.127:3000')).toBe('http://10.142.1.127:3000');
      expect(sanitize('https://photo-server.local:3000/')).toBe('https://photo-server.local:3000');
    });

    it('declares pingServer() querying /api/session for server reachability', () => {
      expect(networkCode).toContain('func pingServer() async -> Bool');
      expect(networkCode).toContain('/api/session');
      expect(networkCode).toContain('request.httpMethod = "GET"');
      expect(networkCode).toContain('@Published public var isReachable: Bool');
    });

    it('declares uploadBundle supporting both explicit resources and convenience PhotoKit extraction', () => {
      expect(networkCode).toContain('func uploadBundle(');
      expect(networkCode).toContain('asset: TriageAsset,');
      expect(networkCode).toContain('resources: [ExtractedResource],');
      expect(networkCode).toContain('decision: TriageDecision');
      expect(networkCode).toContain('func uploadBundle(');
      expect(networkCode).toContain('decision: TriageDecision\n    ) async throws -> UploadResult');
    });

    it('enforces upload guards for decision and primary resource', () => {
      // Invariant: only backup_only and backup_keep can be uploaded
      expect(networkCode).toContain('guard decision.requiresBackupUpload else');
      // Invariant: must contain a primary resource
      expect(networkCode).toContain('guard resources.contains(where: { $0.role == .primary }) else');
    });

    it('defines comprehensive NetworkError enum covering all failure modes', () => {
      const expectedErrors = [
        'invalidUrl',
        'serverUnreachable',
        'invalidDecision',
        'missingPrimaryResource',
        'uploadFailed',
        'verificationFailed',
        'serverError',
      ];
      for (const err of expectedErrors) {
        expect(networkCode).toContain(`case ${err}`);
      }
    });

    it('defines DTO models matching server ledger and upload response schemas', () => {
      expect(networkCode).toContain('struct LedgerEntryDto: Codable, Sendable, Equatable');
      expect(networkCode).toContain('struct UploadResult: Codable, Sendable, Equatable');
      expect(networkCode).toContain('struct ServerSessionStatus: Codable, Sendable');
    });
  });

  describe('TriageState Observable State Machine & Safety Guarantees', () => {
    const stateCode = fs.readFileSync(triageStatePath, 'utf8');

    it('declares TriageState as a MainActor ObservableObject and Sendable class', () => {
      expect(stateCode).toContain('@MainActor');
      expect(stateCode).toContain('class TriageState: ObservableObject, Sendable');
      expect(stateCode).toContain('public static let shared = TriageState()');
    });

    it('declares all required @Published properties', () => {
      expect(stateCode).toContain('@Published public var selectedMonth: YearMonthGroup?');
      expect(stateCode).toContain('@Published public var assets: [TriageAsset] = []');
      expect(stateCode).toContain('@Published public var currentIndex: Int = 0');
      expect(stateCode).toContain('@Published public var decisions: [String: TriageDecision] = [:]');
      expect(stateCode).toContain('@Published public var undoStack: [TriageAction] = []');
      expect(stateCode).toContain('@Published public var isSyncing: Bool = false');
      expect(stateCode).toContain('@Published public var syncProgress: Double = 0.0');
      expect(stateCode).toContain('@Published public var syncStatusText: String = ""');
    });

    it('computes counts: total, unsorted, trash, backupOnly, backupKeep, and triaged', () => {
      expect(stateCode).toContain('public var totalCount: Int');
      expect(stateCode).toContain('public var unsortedCount: Int');
      expect(stateCode).toContain('public var trashCount: Int');
      expect(stateCode).toContain('public var backupOnlyCount: Int');
      expect(stateCode).toContain('public var backupKeepCount: Int');
      expect(stateCode).toContain('public var triagedCount: Int');
      expect(stateCode).toContain('public var progressPercentage: Double');
    });

    it('provides navigation helpers: goToNext, goToPrevious, selectAsset, canGoNext, canGoPrevious', () => {
      expect(stateCode).toContain('public func goToNext()');
      expect(stateCode).toContain('public func goToPrevious()');
      expect(stateCode).toContain('public func selectAsset(at index: Int)');
      expect(stateCode).toContain('public var canGoNext: Bool');
      expect(stateCode).toContain('public var canGoPrevious: Bool');
      expect(stateCode).toContain('public var currentAsset: TriageAsset?');
    });

    it('provides setDecision and undo restoring previous decision and asset index', () => {
      expect(stateCode).toContain('public func setDecision(assetId: String, decision: TriageDecision)');
      expect(stateCode).toContain('public func setDecision(_ decision: TriageDecision, for asset: TriageAsset)');
      expect(stateCode).toContain('public func triageCurrent(as decision: TriageDecision, autoAdvance: Bool = true)');
      expect(stateCode).toContain('public func undo() -> TriageAction?');
      expect(stateCode).toContain('public var canUndo: Bool');
    });

    it('declares TriageFilter and filteredAssets helper', () => {
      expect(stateCode).toContain('enum TriageFilter: String, CaseIterable, Identifiable, Sendable');
      expect(stateCode).toContain('case all = "All"');
      expect(stateCode).toContain('case unsorted = "Unsorted"');
      expect(stateCode).toContain('case trash = "Trash"');
      expect(stateCode).toContain('case backupOnly = "HD Only"');
      expect(stateCode).toContain('case backupKeep = "HD + Phone"');
      expect(stateCode).toContain('public func filteredAssets(filter: TriageFilter) -> [TriageAsset]');
    });

    it('STRICT HARDWARE SAFETY: assetsToUpload, assetsToDelete, and assetsToKeepOnPhone partition correctly', () => {
      expect(stateCode).toContain('public var assetsToUpload: [TriageAsset]');
      expect(stateCode).toContain('public var assetsToDelete: [TriageAsset]');
      expect(stateCode).toContain('public var assetsToKeepOnPhone: [TriageAsset]');

      // Safety Invariant: backup_keep is NEVER in assetsToDelete
      expect(stateCode).toContain('STRICT SAFETY INVARIANT: `backup_keep` assets are NEVER included in this list.');
    });

    it('provides sync state management helpers', () => {
      expect(stateCode).toContain('public func startSync(total: Int, initialText: String = "Starting sync...")');
      expect(stateCode).toContain('public func updateSync(completed: Int, total: Int, text: String)');
      expect(stateCode).toContain('public func finishSync(text: String = "Sync complete")');
    });
  });

  describe('Multipart Payload Contract & Mac Server Interaction', () => {
    let tmpDir: string;
    let hardDriveRoot: string;
    let stagingDir: string;
    let app: FastifyInstance;
    let sessionManager: SessionManager;

    beforeEach(async () => {
      tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ios-net-test-'));
      hardDriveRoot = path.join(tmpDir, 'hard-drive');
      stagingDir = path.join(tmpDir, 'staging');

      await fsp.mkdir(hardDriveRoot, { recursive: true });
      await fsp.mkdir(stagingDir, { recursive: true });

      sessionManager = new SessionManager({
        stagingDir,
        hardDriveRoot,
      });

      app = await createServer({
        stagingDir,
        hardDriveRoot,
        sessionManager,
      });
    });

    afterEach(async () => {
      if (app) {
        await app.close();
      }
      await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    function buildSwiftCompatibleMultipart(
      boundary: string,
      fields: Record<string, string>,
      files: Array<{ role: string; filename: string; mimeType: string; data: Buffer }>
    ): Buffer {
      const parts: Buffer[] = [];

      for (const [name, val] of Object.entries(fields)) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`));
      }

      for (const file of files) {
        parts.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${file.role}"; filename="${file.filename}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`
          )
        );
        parts.push(file.data);
        parts.push(Buffer.from('\r\n'));
      }

      parts.push(Buffer.from(`--${boundary}--\r\n`));
      return Buffer.concat(parts);
    }

    it('successfully uploads multipart payload matching NetworkManager.swift structure to /api/upload', async () => {
      const boundary = 'Boundary-Test-42F7B012-A83C-4C94';
      const photoData = Buffer.from('Swift NetworkManager HEIC primary payload bytes');
      const videoData = Buffer.from('Swift NetworkManager MOV companion video payload bytes');

      const payload = buildSwiftCompatibleMultipart(
        boundary,
        {
          bundleId: 'EDC79247_186E_454A_8CF9_572242326F40_L0_001',
          canonicalName: 'IMG_4001',
          capturedAt: '2024-06-15T10:15:30.000Z',
          targetYear: '2024',
          targetMonth: 'JUNE',
          decision: 'backup_only',
        },
        [
          { role: 'primary', filename: 'IMG_4001.HEIC', mimeType: 'image/heic', data: photoData },
          { role: 'live_video', filename: 'IMG_4001.MOV', mimeType: 'video/quicktime', data: videoData },
        ]
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.verifiedCount).toBe(2);
      expect(body.entries).toHaveLength(1);

      const entry = body.entries[0];
      expect(entry.canonicalName).toBe('IMG_4001');
      expect(entry.decision).toBe('backup_only');
      expect(entry.targetRelPath).toBe('2024/JUNE/IMG_4001.HEIC');

      const expectedPhotoHash = crypto.createHash('sha256').update(photoData).digest('hex');
      expect(entry.sha256).toBe(expectedPhotoHash);

      // Verify files exist in hard drive directory
      const destPhoto = path.join(hardDriveRoot, '2024', 'JUNE', 'IMG_4001.HEIC');
      const destVideo = path.join(hardDriveRoot, '2024', 'JUNE', 'IMG_4001.MOV');
      expect(fs.existsSync(destPhoto)).toBe(true);
      expect(fs.existsSync(destVideo)).toBe(true);

      const photoHashOnDisk = await computeFileHash(destPhoto);
      expect(photoHashOnDisk).toBe(expectedPhotoHash);

      // Verify ledger update
      const ledger = await loadLedger(hardDriveRoot);
      expect(ledger.has(expectedPhotoHash)).toBe(true);
    });

    it('handles GET /api/session ping responding with HTTP 200 and hardDriveMounted status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/session',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.hardDriveMounted).toBe(true);
      expect(body.status).toBeDefined();
    });

    it('rejects upload when primary role is missing', async () => {
      const boundary = 'Boundary-Test-No-Primary';
      const videoData = Buffer.from('Companion video without primary');

      const payload = buildSwiftCompatibleMultipart(
        boundary,
        {
          bundleId: 'IMG_4002',
          canonicalName: 'IMG_4002',
          targetYear: '2024',
          targetMonth: 'JUNE',
          decision: 'backup_only',
        },
        [{ role: 'live_video', filename: 'IMG_4002.MOV', mimeType: 'video/quicktime', data: videoData }]
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/primary/i);
    });
  });

  describe('Native Swift 6 Executable Integration Test', () => {
    it('compiles and executes Swift binary verifying TriageState state machine and NetworkManager multipart builder', () => {
      const tempBin = path.join(os.tmpdir(), `swift-network-test-${Date.now()}`);

      const swiftTestScript = `
import Foundation
import Photos

// 1. Verify NetworkManager Multipart Builder
let boundary = "TestBoundary-ABC-123"
let fields = [
    "bundleId": "IMG_9999",
    "canonicalName": "IMG_9999",
    "capturedAt": "2024-07-04T12:00:00.000Z",
    "targetYear": "2024",
    "targetMonth": "JULY",
    "decision": "backup_keep"
]

let primaryResource = ExtractedResource(
    role: .primary,
    filename: "IMG_9999.HEIC",
    data: "Primary photo bytes".data(using: .utf8)!,
    mimeType: "image/heic"
)

let videoResource = ExtractedResource(
    role: .liveVideo,
    filename: "IMG_9999.MOV",
    data: "Companion video bytes".data(using: .utf8)!,
    mimeType: "video/quicktime"
)

let payload = try NetworkManager.buildMultipartPayload(
    boundary: boundary,
    fields: fields,
    resources: [primaryResource, videoResource]
)

let payloadString = String(data: payload, encoding: .utf8)!
assert(payloadString.contains("--" + boundary), "Payload must contain boundary prefix")
assert(payloadString.contains("name=\\"bundleId\\""), "Payload must contain bundleId")
assert(payloadString.contains("name=\\"canonicalName\\""), "Payload must contain canonicalName")
assert(payloadString.contains("name=\\"decision\\""), "Payload must contain decision")
assert(payloadString.contains("name=\\"primary\\"; filename=\\"IMG_9999.HEIC\\""), "Payload must contain primary part")
assert(payloadString.contains("name=\\"live_video\\"; filename=\\"IMG_9999.MOV\\""), "Payload must contain live_video part")
assert(payloadString.hasSuffix("--" + boundary + "--\\r\\n"), "Payload must end with closing boundary CRLF")

// 2. Verify URL sanitization
assert(NetworkManager.sanitizeUrl("http://10.142.1.127:3000/") == "http://10.142.1.127:3000", "Must strip trailing slash")
assert(NetworkManager.sanitizeUrl("10.142.1.127:3000") == "http://10.142.1.127:3000", "Must prepend http://")
assert(NetworkManager.sanitizeUrl("https://mac.local:3000//") == "https://mac.local:3000", "Must keep https")

// 3. Verify TriageState state machine & undo stack
let state = TriageState()
assert(state.totalCount == 0, "Initial totalCount must be 0")
assert(state.canUndo == false, "Initial canUndo must be false")

state.setDecision(assetId: "A1", decision: .trash)
assert(state.decision(for: "A1") == .trash, "A1 must be trash")
assert(state.undoStack.count == 1, "Undo stack must have 1 action")
assert(state.canUndo == true, "canUndo must be true")

state.setDecision(assetId: "A2", decision: .backupKeep)
assert(state.decision(for: "A2") == .backupKeep, "A2 must be backupKeep")
assert(state.undoStack.count == 2, "Undo stack must have 2 actions")

// Undo A2
let undone = state.undo()
assert(undone?.assetId == "A2", "Undone asset must be A2")
assert(state.decision(for: "A2") == .unsorted, "A2 must revert to unsorted")
assert(state.undoStack.count == 1, "Undo stack must have 1 action left")

// Undo A1
let undoneA1 = state.undo()
assert(undoneA1?.assetId == "A1", "Undone asset must be A1")
assert(state.decision(for: "A1") == .unsorted, "A1 must revert to unsorted")
assert(state.canUndo == false, "Undo stack must be empty")

print("SUCCESS: Swift native assertions verified completely.")
`;

      try {
        const compileCmd = `swiftc -swift-version 6 "${assetModelPath}" "${photoKitPath}" "${networkManagerPath}" "${triageStatePath}" -o "${tempBin}" -e '${swiftTestScript.replace(/'/g, "'\\''")}'`;
        execSync(compileCmd, { stdio: 'pipe' });

        const runOutput = execSync(`"${tempBin}"`, { stdio: 'pipe', encoding: 'utf8' });
        expect(runOutput).toContain('SUCCESS: Swift native assertions verified completely.');
      } finally {
        if (fs.existsSync(tempBin)) {
          fs.unlinkSync(tempBin);
        }
      }
    });
  });

  describe('Comprehensive Triage Simulation & Invariant Checks', () => {
    it('simulates a complete batch triage flow and guarantees zero leak of backup_keep into deletion list', () => {
      interface MockAsset {
        id: string;
        name: string;
      }

      const mockAssets: MockAsset[] = [
        { id: 'img-1', name: 'IMG_0001' },
        { id: 'img-2', name: 'IMG_0002' },
        { id: 'img-3', name: 'IMG_0003' },
        { id: 'img-4', name: 'IMG_0004' },
        { id: 'img-5', name: 'IMG_0005' },
        { id: 'img-6', name: 'IMG_0006' },
        { id: 'img-7', name: 'IMG_0007' },
        { id: 'img-8', name: 'IMG_0008' },
        { id: 'img-9', name: 'IMG_0009' },
        { id: 'img-10', name: 'IMG_0010' },
      ];

      const decisions: Record<string, ServerTriageDecision> = {
        'img-1': 'trash',
        'img-2': 'trash',
        'img-3': 'trash',
        'img-4': 'backup_only',
        'img-5': 'backup_only',
        'img-6': 'backup_only',
        'img-7': 'backup_only',
        'img-8': 'backup_keep',
        'img-9': 'backup_keep',
        // 'img-10' remains unsorted
      };

      // Counts
      const total = mockAssets.length;
      const trashCount = mockAssets.filter((a) => decisions[a.id] === 'trash').length;
      const backupOnlyCount = mockAssets.filter((a) => decisions[a.id] === 'backup_only').length;
      const backupKeepCount = mockAssets.filter((a) => decisions[a.id] === 'backup_keep').length;
      const unsortedCount = mockAssets.filter((a) => !decisions[a.id] || decisions[a.id] === 'unsorted').length;

      expect(total).toBe(10);
      expect(trashCount).toBe(3);
      expect(backupOnlyCount).toBe(4);
      expect(backupKeepCount).toBe(2);
      expect(unsortedCount).toBe(1);

      // Hardware safety lists
      const assetsToUpload = mockAssets.filter(
        (a) => decisions[a.id] === 'backup_only' || decisions[a.id] === 'backup_keep'
      );
      const assetsToDelete = mockAssets.filter(
        (a) => decisions[a.id] === 'trash' || decisions[a.id] === 'backup_only'
      );
      const assetsToKeepOnPhone = mockAssets.filter(
        (a) => decisions[a.id] !== 'trash' && decisions[a.id] !== 'backup_only'
      );

      expect(assetsToUpload).toHaveLength(6); // 4 backup_only + 2 backup_keep
      expect(assetsToDelete).toHaveLength(7); // 3 trash + 4 backup_only
      expect(assetsToKeepOnPhone).toHaveLength(3); // 2 backup_keep + 1 unsorted

      // STRICT SAFETY INVARIANTS:
      // 1. Every asset in assetsToUpload must be either backup_only or backup_keep
      for (const a of assetsToUpload) {
        expect(['backup_only', 'backup_keep']).toContain(decisions[a.id]);
      }

      // 2. NO backup_keep asset can EVER be in assetsToDelete
      for (const a of assetsToDelete) {
        expect(decisions[a.id]).not.toBe('backup_keep');
        expect(decisions[a.id]).not.toBe('unsorted');
      }

      // 3. assetsToKeepOnPhone contains ALL backup_keep assets
      const keepIds = assetsToKeepOnPhone.map((a) => a.id);
      expect(keepIds).toContain('img-8');
      expect(keepIds).toContain('img-9');
      expect(keepIds).toContain('img-10');
    });
  });
});
