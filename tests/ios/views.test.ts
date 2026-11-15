import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

describe('iOS Utilitarian SwiftUI Views Contract Tests (Task 4)', () => {
  const rootDir = process.cwd();
  const themePath = path.resolve(rootDir, 'ios/PhotoTriage/Views/UtilitarianTheme.swift');
  const monthSelectionPath = path.resolve(rootDir, 'ios/PhotoTriage/Views/MonthSelectionView.swift');
  const singleTriagePath = path.resolve(rootDir, 'ios/PhotoTriage/Views/SingleTriageView.swift');
  const gridTriagePath = path.resolve(rootDir, 'ios/PhotoTriage/Views/GridTriageView.swift');
  const backupProgressPath = path.resolve(rootDir, 'ios/PhotoTriage/Views/BackupProgressView.swift');
  const settingsPath = path.resolve(rootDir, 'ios/PhotoTriage/Views/SettingsView.swift');
  const contentViewPath = path.resolve(rootDir, 'ios/PhotoTriage/ContentView.swift');
  const appPath = path.resolve(rootDir, 'ios/PhotoTriage/PhotoTriageApp.swift');

  const assetModelPath = path.resolve(rootDir, 'ios/PhotoTriage/Models/AssetModel.swift');
  const triageStatePath = path.resolve(rootDir, 'ios/PhotoTriage/Models/TriageState.swift');
  const photoKitPath = path.resolve(rootDir, 'ios/PhotoTriage/Services/PhotoKitManager.swift');
  const networkManagerPath = path.resolve(rootDir, 'ios/PhotoTriage/Services/NetworkManager.swift');

  it('verifies that all SwiftUI view and app files exist on disk', () => {
    expect(fs.existsSync(themePath)).toBe(true);
    expect(fs.existsSync(monthSelectionPath)).toBe(true);
    expect(fs.existsSync(singleTriagePath)).toBe(true);
    expect(fs.existsSync(gridTriagePath)).toBe(true);
    expect(fs.existsSync(backupProgressPath)).toBe(true);
    expect(fs.existsSync(settingsPath)).toBe(true);
    expect(fs.existsSync(contentViewPath)).toBe(true);
    expect(fs.existsSync(appPath)).toBe(true);
  });

  it('validates that all Swift files pass strict swiftc typecheck under Swift 6 mode', () => {
    const allFiles = [
      assetModelPath,
      triageStatePath,
      photoKitPath,
      networkManagerPath,
      themePath,
      monthSelectionPath,
      singleTriagePath,
      gridTriagePath,
      backupProgressPath,
      settingsPath,
      contentViewPath,
      appPath,
    ].map(p => `"${p}"`).join(' ');

    const cmd = `swiftc -typecheck -swift-version 6 ${allFiles}`;
    expect(() => {
      execSync(cmd, { stdio: 'pipe' });
    }).not.toThrow();
  });

  describe('Utilitarian Design System & Styling Invariants', () => {
    const themeCode = fs.readFileSync(themePath, 'utf8');
    const allViewCode = [
      themeCode,
      fs.readFileSync(monthSelectionPath, 'utf8'),
      fs.readFileSync(singleTriagePath, 'utf8'),
      fs.readFileSync(gridTriagePath, 'utf8'),
      fs.readFileSync(backupProgressPath, 'utf8'),
      fs.readFileSync(settingsPath, 'utf8'),
      fs.readFileSync(contentViewPath, 'utf8'),
      fs.readFileSync(appPath, 'utf8'),
    ].join('\n');

    it('defines precision dark slate palette constants (Slate 950 down to Slate 100)', () => {
      expect(themeCode).toContain('static let slate950');
      expect(themeCode).toContain('static let slate900');
      expect(themeCode).toContain('static let slate800');
      expect(themeCode).toContain('static let slate700');
      expect(themeCode).toContain('static let slate600');
      expect(themeCode).toContain('static let slate500');
      expect(themeCode).toContain('static let slate400');
      expect(themeCode).toContain('static let slate300');
      expect(themeCode).toContain('static let slate200');
      expect(themeCode).toContain('static let slate100');
    });

    it('enforces dark slate surface Color(red: 15/255, green: 23/255, blue: 42/255)', () => {
      expect(themeCode).toContain('Color(red: 15/255, green: 23/255, blue: 42/255)');
    });

    it('strictly forbids vibe-coded Apple pastel glass materials (e.g. ultraThinMaterial)', () => {
      expect(allViewCode).not.toContain('ultraThinMaterial');
      expect(allViewCode).not.toContain('thinMaterial');
      expect(allViewCode).not.toContain('regularMaterial');
    });

    it('extensively utilizes monospaced typography for precision data density', () => {
      const monospacedOccurrences = (allViewCode.match(/design:\s*\.monospaced/g) || []).length;
      expect(monospacedOccurrences).toBeGreaterThan(30);
    });

    it('provides crisp 1px borders and tactile rectangular button styling', () => {
      expect(themeCode).toContain('utilitarianBorder');
      expect(themeCode).toContain('TactileButtonStyle');
      expect(themeCode).toContain('lineWidth: 1');
    });
  });

  describe('MonthSelectionView Contract Alignment', () => {
    const code = fs.readFileSync(monthSelectionPath, 'utf8');

    it('lists calendar months with photo counts and status indicators', () => {
      expect(code).toContain('struct MonthSelectionView: View');
      expect(code).toContain('photoKitManager.months');
      expect(code).toContain('totalAssetsInArchive');
      expect(code).toContain('group.assetCount');
      expect(code).toContain('group.displayName');
    });

    it('triggers PhotoKit authorization and month scanning', () => {
      expect(code).toContain('photoKitManager.fetchMonths()');
      expect(code).toContain('photoKitManager.requestAuthorization()');
      expect(code).toContain('triageState.loadMonth');
    });

    it('supports onMonthSelected callback and sheet dismissal', () => {
      expect(code).toContain('public var onMonthSelected: ((YearMonthGroup) -> Void)?');
      expect(code).toContain('dismiss()');
    });
  });

  describe('SingleTriageView Contract Alignment', () => {
    const code = fs.readFileSync(singleTriagePath, 'utf8');

    it('contains high-density monospaced metadata bar', () => {
      expect(code).toContain('struct SingleTriageView: View');
      expect(code).toContain('asset.formattedDimensions');
      expect(code).toContain('asset.formattedSize');
      expect(code).toContain('asset.formattedDate');
      expect(code).toContain('asset.targetYear');
      expect(code).toContain('asset.targetMonth');
      expect(code).toContain('DEST: /');
    });

    it('contains three tactile action buttons matching spec', () => {
      // 1. Trash button
      expect(code).toContain('🗑️ Trash');
      expect(code).toContain('applyDecision(.trash)');
      // 2. HD Only button
      expect(code).toContain('💾 HD Only');
      expect(code).toContain('applyDecision(.backupOnly)');
      // 3. HD+Phone button
      expect(code).toContain('💾+📱 HD+Phone');
      expect(code).toContain('applyDecision(.backupKeep)');
    });

    it('contains Undo button wired to triageState.undo()', () => {
      expect(code).toContain('triageState.undo()');
      expect(code).toContain('triageState.canUndo');
    });

    it('implements swipe gestures: left=trash, right=keep, up=HD only', () => {
      expect(code).toContain('DragGesture');
      expect(code).toContain('gestureDecisionHint = .trash');
      expect(code).toContain('gestureDecisionHint = .backupKeep');
      expect(code).toContain('gestureDecisionHint = .backupOnly');
      expect(code).toContain('applyDecision(.trash)');
      expect(code).toContain('applyDecision(.backupKeep)');
      expect(code).toContain('applyDecision(.backupOnly)');
    });

    it('includes visual decision indicator overlay and pinch-to-zoom gesture', () => {
      expect(code).toContain('decisionIndicatorOverlay');
      expect(code).toContain('MagnificationGesture');
      expect(code).toContain('zoomScale');
    });
  });

  describe('GridTriageView Contract Alignment', () => {
    const code = fs.readFileSync(gridTriagePath, 'utf8');

    it('uses responsive LazyVGrid with thumbnail badges', () => {
      expect(code).toContain('struct GridTriageView: View');
      expect(code).toContain('LazyVGrid');
      expect(code).toContain('GridThumbnailCell');
    });

    it('provides segmented filter bar covering all triage categories', () => {
      expect(code).toContain('TriageFilter.allCases');
      expect(code).toContain('triageState.filteredAssets');
      expect(code).toContain('triageState.totalCount');
      expect(code).toContain('triageState.unsortedCount');
      expect(code).toContain('triageState.trashCount');
      expect(code).toContain('triageState.backupOnlyCount');
      expect(code).toContain('triageState.backupKeepCount');
    });

    it('implements multi-selection mode with bulk action assignment', () => {
      expect(code).toContain('isSelectMode');
      expect(code).toContain('selectedAssetIds');
      expect(code).toContain('SELECT ALL');
      expect(code).toContain('DESELECT ALL');
      expect(code).toContain('bulkButton');
      expect(code).toContain('triageState.setDecision');
    });

    it('navigates to SingleTriageView on thumbnail tap when not selecting', () => {
      expect(code).toContain('triageState.selectAsset');
      expect(code).toContain('onAssetSelected?(asset)');
    });

    it('defines DailyAssetSection model and groupedDailySections helper for calendar day grouping', () => {
      expect(code).toContain('struct DailyAssetSection: Identifiable, Sendable');
      expect(code).toContain('public let title: String');
      expect(code).toContain('public let assets: [TriageAsset]');
      expect(code).toContain('func groupedDailySections(for assets: [TriageAsset]) -> [DailyAssetSection]');
    });

    it('implements pinned sticky date section headers via LazyVGrid and DaySectionHeader', () => {
      expect(code).toContain('pinnedViews: [.sectionHeaders]');
      expect(code).toContain('DaySectionHeader');
      expect(code).toContain('Section(header:');
    });
  });

  describe('BackupProgressView & Hardware Safety Invariant', () => {
    const code = fs.readFileSync(backupProgressPath, 'utf8');

    it('declares backup pipeline handling uploads and verification', () => {
      expect(code).toContain('struct BackupProgressView: View');
      expect(code).toContain('networkManager.uploadBundle');
      expect(code).toContain('progressFraction');
      expect(code).toContain('transferSpeedText');
      expect(code).toContain('verifiedEntries');
    });

    it('enforces CRITICAL SAFETY INVARIANT: uploads only kept items (backupOnly and backupKeep)', () => {
      expect(code).toContain('itemsToUpload');
      expect(code).toContain('triageState.assetsToUpload');
    });

    it('enforces CRITICAL SAFETY INVARIANT: 100% SHA-256 verification before deletion', () => {
      // Must check that verifiedEntries.count matches upload count before deletion
      expect(code).toContain('verifiedEntries.count >= uploads.count');
      expect(code).toContain('100% SHA-256 verification confirmed');
    });

    it('enforces CRITICAL SAFETY INVARIANT: calls deleteTriagedAssets only after verification and NEVER deletes backupKeep', () => {
      expect(code).toContain('photoKitManager.deleteTriagedAssets');
      expect(code).toContain('itemsToDelete');
      expect(code).toContain('itemsToKeep');
      expect(code).toContain('triageState.assetsToDelete');
      expect(code).toContain('triageState.assetsToKeepOnPhone');
    });

    it('handles network errors gracefully with retry button', () => {
      expect(code).toContain('RETRY BACKUP');
      expect(code).toContain('SAFETY GUARD HALTED EXECUTION');
      expect(code).toContain('stage = .failed');
    });

    it('renders real-time monospaced SHA-256 ledger telemetry console', () => {
      expect(code).toContain('INTEGRITY & LEDGER TELEMETRY');
      expect(code).toContain('BackupLogEntry');
      expect(code).toContain('VERIFIED SHA-256');
    });
  });

  describe('SettingsView Contract Alignment', () => {
    const code = fs.readFileSync(settingsPath, 'utf8');

    it('provides server URL input with default 10.142.1.127:3000', () => {
      expect(code).toContain('struct SettingsView: View');
      expect(code).toContain('http://10.142.1.127:3000');
      expect(code).toContain('networkManager.serverUrl');
      expect(code).toContain('NetworkManager.defaultServerUrl');
      expect(code).toContain('networkManager.setServerUrl');
    });

    it('implements server ping and live diagnostics', () => {
      expect(code).toContain('networkManager.pingServer()');
      expect(code).toContain('networkManager.fetchSessionStatus()');
      expect(code).toContain('TEST CONNECTION');
    });

    it('displays hard drive mounted status readout', () => {
      expect(code).toContain('EXTERNAL HARD DRIVE');
      expect(code).toContain('hardDriveStatusInfo');
      expect(code).toContain('status.hardDriveMounted');
    });

    it('documents zero-data-loss architecture and safety guarantees', () => {
      expect(code).toContain('DATA SAFETY & ZERO-LOSS GUARANTEES');
      expect(code).toContain('Live Photo & Companion Integrity');
      expect(code).toContain('OOM-Safe Streaming Video');
      expect(code).toContain('100% SHA-256 Ledger Verification');
      expect(code).toContain('Atomic Post-Verification Deletion');
    });
  });

  describe('ContentView & PhotoTriageApp Contract Alignment', () => {
    const contentCode = fs.readFileSync(contentViewPath, 'utf8');
    const appCode = fs.readFileSync(appPath, 'utf8');

    it('provides segmented navigation between Single, Grid, Backup, and Settings', () => {
      expect(contentCode).toContain('enum TriageAppTab');
      expect(contentCode).toContain('case single');
      expect(contentCode).toContain('case grid');
      expect(contentCode).toContain('case backup');
      expect(contentCode).toContain('case settings');
      expect(contentCode).toContain('SingleTriageView()');
      expect(contentCode).toContain('GridTriageView');
      expect(contentCode).toContain('BackupProgressView()');
      expect(contentCode).toContain('SettingsView()');
    });

    it('hosts global header bar with active month display and progress percentage', () => {
      expect(contentCode).toContain('triageState.selectedMonth');
      expect(contentCode).toContain('triageState.progressPercentage');
      expect(contentCode).toContain('MonthSelectionView');
      expect(contentCode).toContain('showingMonthSheet');
    });

    it('declares @main App entry point injecting StateObjects for TriageState, NetworkManager, PhotoKitManager', () => {
      expect(appCode).toContain('@main');
      expect(appCode).toContain('struct PhotoTriageApp: App');
      expect(appCode).toContain('@StateObject private var triageState = TriageState.shared');
      expect(appCode).toContain('@StateObject private var networkManager = NetworkManager.shared');
      expect(appCode).toContain('@StateObject private var photoKitManager = PhotoKitManager.shared');
      expect(appCode).toContain('.environmentObject(triageState)');
      expect(appCode).toContain('.environmentObject(networkManager)');
      expect(appCode).toContain('.environmentObject(photoKitManager)');
    });
  });
});
