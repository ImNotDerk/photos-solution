// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AssetBundle, SessionState, CleanupBatchResponse } from '../../src/types/index.js';
import { SingleView } from '../../src/client/components/SingleView.js';
import { GridView } from '../../src/client/components/GridView.js';
import { CleanupView } from '../../src/client/components/CleanupView.js';
import { DesktopStatus } from '../../src/client/components/DesktopStatus.js';
import { App } from '../../src/client/App.js';

const mockBundles: AssetBundle[] = [
  {
    id: 'bundle-1',
    canonicalName: 'IMG_1001',
    files: [
      { path: '/staging/IMG_1001.HEIC', filename: 'IMG_1001.HEIC', ext: '.HEIC', size: 2500000, role: 'primary' },
      { path: '/staging/IMG_1001.MOV', filename: 'IMG_1001.MOV', ext: '.MOV', size: 5500000, role: 'live_video' },
      { path: '/staging/IMG_1001.AAE', filename: 'IMG_1001.AAE', ext: '.AAE', size: 1200, role: 'edit_sidecar' },
      { path: '/staging/IMG_E1001.HEIC', filename: 'IMG_E1001.HEIC', ext: '.HEIC', size: 2700000, role: 'edited_render' },
    ],
    previewPath: '/staging/IMG_E1001.HEIC',
    capturedAt: '2024-01-15T10:30:00.000Z',
    targetYear: '2024',
    targetMonth: 'JANUARY',
    dateReliable: true,
    decision: 'unsorted',
    alreadyBackedUp: false,
  },
  {
    id: 'bundle-2',
    canonicalName: 'IMG_1002',
    files: [
      { path: '/staging/IMG_1002.HEIC', filename: 'IMG_1002.HEIC', ext: '.HEIC', size: 1800000, role: 'primary' },
    ],
    previewPath: '/staging/IMG_1002.HEIC',
    capturedAt: '2024-01-16T14:20:00.000Z',
    targetYear: '2024',
    targetMonth: 'JANUARY',
    dateReliable: true,
    decision: 'backup_only',
    alreadyBackedUp: false,
  },
  {
    id: 'bundle-3',
    canonicalName: 'IMG_1003',
    files: [
      { path: '/staging/IMG_1003.MOV', filename: 'IMG_1003.MOV', ext: '.MOV', size: 15000000, role: 'primary' },
    ],
    previewPath: '/staging/IMG_1003.MOV',
    capturedAt: '2024-01-17T09:15:00.000Z',
    targetYear: '2024',
    targetMonth: 'JANUARY',
    dateReliable: false,
    decision: 'trash',
    alreadyBackedUp: false,
  },
];

describe('SingleView Component', () => {
  const onDecision = vi.fn();
  const onPrevious = vi.fn();
  const onNext = vi.fn();
  const onUndo = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders bundle metadata and companion tags', () => {
    const { container } = render(
      <SingleView
        bundle={mockBundles[0]}
        currentIndex={0}
        totalCount={3}
        unsortedCount={1}
        onDecision={onDecision}
        onPrevious={onPrevious}
        onNext={onNext}
        onUndo={onUndo}
        canUndo={false}
      />
    );

    // Metadata
    expect(screen.getByText('IMG_1001')).toBeDefined();
    expect(screen.getByText(/2024\/JANUARY/)).toBeDefined();
    // Live & Edit badges
    expect(screen.getByText(/LIVE/i)).toBeDefined();
    expect(screen.getByText(/EDIT/i)).toBeDefined();

    // Check utilitarian styling classes: high-contrast dark theme, crisp border, monospace
    expect(container.querySelector('.font-mono')).toBeDefined();
    expect(container.querySelector('.border-slate-700')).toBeDefined();
  });

  it('triggers onDecision with correct arguments when buttons are clicked', () => {
    render(
      <SingleView
        bundle={mockBundles[0]}
        currentIndex={0}
        totalCount={3}
        unsortedCount={1}
        onDecision={onDecision}
        onPrevious={onPrevious}
        onNext={onNext}
        onUndo={onUndo}
        canUndo={true}
      />
    );

    const trashBtn = screen.getByRole('button', { name: /trash/i });
    fireEvent.click(trashBtn);
    expect(onDecision).toHaveBeenCalledWith('bundle-1', 'trash');

    const hdOnlyBtn = screen.getByRole('button', { name: /hd only/i });
    fireEvent.click(hdOnlyBtn);
    expect(onDecision).toHaveBeenCalledWith('bundle-1', 'backup_only');

    const hdKeepBtn = screen.getByRole('button', { name: /hd \+ phone/i });
    fireEvent.click(hdKeepBtn);
    expect(onDecision).toHaveBeenCalledWith('bundle-1', 'backup_keep');

    const undoBtn = screen.getByRole('button', { name: /undo/i });
    fireEvent.click(undoBtn);
    expect(onUndo).toHaveBeenCalled();
  });

  it('triggers decisions and navigation via keyboard shortcuts', () => {
    render(
      <SingleView
        bundle={mockBundles[0]}
        currentIndex={0}
        totalCount={3}
        unsortedCount={1}
        onDecision={onDecision}
        onPrevious={onPrevious}
        onNext={onNext}
        onUndo={onUndo}
        canUndo={true}
      />
    );

    // Shortcut '1' or 't' -> trash
    fireEvent.keyDown(window, { key: '1' });
    expect(onDecision).toHaveBeenCalledWith('bundle-1', 'trash');

    fireEvent.keyDown(window, { key: 't' });
    expect(onDecision).toHaveBeenCalledWith('bundle-1', 'trash');

    // Shortcut '2' or 'o' -> backup_only
    fireEvent.keyDown(window, { key: '2' });
    expect(onDecision).toHaveBeenCalledWith('bundle-1', 'backup_only');

    fireEvent.keyDown(window, { key: 'o' });
    expect(onDecision).toHaveBeenCalledWith('bundle-1', 'backup_only');

    // Shortcut '3' or 'k' -> backup_keep
    fireEvent.keyDown(window, { key: '3' });
    expect(onDecision).toHaveBeenCalledWith('bundle-1', 'backup_keep');

    fireEvent.keyDown(window, { key: 'k' });
    expect(onDecision).toHaveBeenCalledWith('bundle-1', 'backup_keep');

    // Shortcut 'u' -> undo
    fireEvent.keyDown(window, { key: 'u' });
    expect(onUndo).toHaveBeenCalled();

    // Arrows for navigation
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNext).toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onPrevious).toHaveBeenCalled();
  });

  it('handles touch swipes for horizontal browsing and swipe-up details (Option B)', () => {
    const { container } = render(
      <SingleView
        bundle={mockBundles[0]}
        bundles={mockBundles}
        currentIndex={1}
        totalCount={3}
        unsortedCount={1}
        onDecision={onDecision}
        onPrevious={onPrevious}
        onNext={onNext}
        onUndo={onUndo}
        canUndo={false}
      />
    );

    const swipeTarget = container.querySelector('[data-testid="swipe-area"]') || container.firstChild as HTMLElement;
    expect(swipeTarget.getAttribute('style')).toContain('touch-action: pan-y');

    // Normal small vertical scroll does NOT trigger navigation or triage
    fireEvent.touchStart(swipeTarget, { touches: [{ clientX: 200, clientY: 200 }] });
    fireEvent.touchMove(swipeTarget, { touches: [{ clientX: 200, clientY: 180 }] });
    fireEvent.touchEnd(swipeTarget);
    expect(onDecision).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
    expect(onPrevious).not.toHaveBeenCalled();

    // Swipe left (negative deltaX < -50) -> next photo (browsing / comparing without triage)
    fireEvent.touchStart(swipeTarget, { touches: [{ clientX: 200, clientY: 200 }] });
    fireEvent.touchMove(swipeTarget, { touches: [{ clientX: 80, clientY: 200 }] });
    fireEvent.touchEnd(swipeTarget);
    expect(onNext).toHaveBeenCalled();
    expect(onDecision).not.toHaveBeenCalled();

    // Swipe right (positive deltaX > 50) -> previous photo (browsing / comparing without triage)
    fireEvent.touchStart(swipeTarget, { touches: [{ clientX: 100, clientY: 200 }] });
    fireEvent.touchMove(swipeTarget, { touches: [{ clientX: 220, clientY: 200 }] });
    fireEvent.touchEnd(swipeTarget);
    expect(onPrevious).toHaveBeenCalled();
    expect(onDecision).not.toHaveBeenCalled();

    // Swipe up (deltaY < -80) -> reveals Apple iOS 18 details sheet
    fireEvent.touchStart(swipeTarget, { touches: [{ clientX: 200, clientY: 250 }] });
    fireEvent.touchMove(swipeTarget, { touches: [{ clientX: 200, clientY: 130 }] });
    fireEvent.touchEnd(swipeTarget);
    expect(screen.getByTestId('photo-details-sheet')).toBeDefined();
  });

  it('renders FilmstripScrubber and allows jumping between photos', () => {
    const onSelectIndex = vi.fn();
    render(
      <SingleView
        bundle={mockBundles[0]}
        bundles={mockBundles}
        currentIndex={0}
        totalCount={3}
        unsortedCount={1}
        onDecision={onDecision}
        onSelectIndex={onSelectIndex}
      />
    );

    // Scrubber is present
    expect(screen.getByTestId('filmstrip-scrubber')).toBeDefined();
    // 3 thumbnails present
    expect(screen.getByTestId('filmstrip-thumb-0')).toBeDefined();
    expect(screen.getByTestId('filmstrip-thumb-1')).toBeDefined();
    expect(screen.getByTestId('filmstrip-thumb-2')).toBeDefined();

    // Clicking thumbnail 2 jumps to index 2
    fireEvent.click(screen.getByTestId('filmstrip-thumb-2'));
    expect(onSelectIndex).toHaveBeenCalledWith(2);
  });

  it('provides visual status badge and auto-advances on decision', () => {
    vi.useFakeTimers();
    render(
      <SingleView
        bundle={mockBundles[0]}
        currentIndex={0}
        totalCount={3}
        unsortedCount={1}
        onDecision={onDecision}
        onNext={onNext}
      />
    );

    const trashBtn = screen.getByRole('button', { name: /trash/i });
    fireEvent.click(trashBtn);
    expect(onDecision).toHaveBeenCalledWith('bundle-1', 'trash');

    // Status banner appears
    expect(screen.getByTestId('status-banner')).toBeDefined();

    // Auto-advance triggers after 250ms
    expect(onNext).not.toHaveBeenCalled();
    vi.advanceTimersByTime(260);
    expect(onNext).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('renders video element for video primary bundles (.mov, .mp4, .m4v) and handles invalid dates gracefully', () => {
    const mp4Bundle: AssetBundle = {
      ...mockBundles[2],
      previewPath: '/staging/IMG_1003.MP4',
      capturedAt: 'invalid-date-string',
      files: [{ path: '/staging/IMG_1003.MP4', filename: 'IMG_1003.MP4', ext: '.MP4', size: 12000000, role: 'primary' }],
    };

    const { container } = render(
      <SingleView
        bundle={mp4Bundle}
        currentIndex={2}
        totalCount={3}
        unsortedCount={1}
        onDecision={onDecision}
      />
    );

    const videoEl = container.querySelector('video');
    expect(videoEl).toBeDefined();
    expect(videoEl?.getAttribute('src')).toBe('/staging/IMG_1003.MP4');
    expect(screen.getByText('invalid-date-string')).toBeDefined();
  });
});

describe('GridView Component', () => {
  const onToggleSelect = vi.fn();
  const onSelectAll = vi.fn();
  const onDeselectAll = vi.fn();
  const onBatchDecision = vi.fn();
  const onSelectBundle = vi.fn();
  const onFilterChange = vi.fn();

  const counts = {
    total: 3,
    unsorted: 1,
    trash: 1,
    backup_only: 1,
    backup_keep: 0,
    alreadyBackedUp: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders filter tabs with counts and items', () => {
    render(
      <GridView
        bundles={mockBundles}
        selectedIds={new Set()}
        onToggleSelect={onToggleSelect}
        onSelectAll={onSelectAll}
        onDeselectAll={onDeselectAll}
        onBatchDecision={onBatchDecision}
        onSelectBundle={onSelectBundle}
        activeFilter="all"
        onFilterChange={onFilterChange}
        counts={counts}
      />
    );

    expect(screen.getByText(/All \(3\)/i)).toBeDefined();
    expect(screen.getByText(/Unsorted \(1\)/i)).toBeDefined();
    expect(screen.getByText(/Trash \(1\)/i)).toBeDefined();
    expect(screen.getByText(/HD Only \(1\)/i)).toBeDefined();

    // Cards
    expect(screen.getByText('IMG_1001')).toBeDefined();
    expect(screen.getByText('IMG_1002')).toBeDefined();
    expect(screen.getByText('IMG_1003')).toBeDefined();
  });

  it('filters items when filter tab is clicked', () => {
    render(
      <GridView
        bundles={mockBundles}
        selectedIds={new Set()}
        onToggleSelect={onToggleSelect}
        onSelectAll={onSelectAll}
        onDeselectAll={onDeselectAll}
        onBatchDecision={onBatchDecision}
        onSelectBundle={onSelectBundle}
        activeFilter="all"
        onFilterChange={onFilterChange}
        counts={counts}
      />
    );

    const trashTab = screen.getByText(/Trash \(1\)/i);
    fireEvent.click(trashTab);
    expect(onFilterChange).toHaveBeenCalledWith('trash');
  });

  it('handles multi-selection and batch triage actions', () => {
    const selectedIds = new Set(['bundle-1', 'bundle-2']);
    render(
      <GridView
        bundles={mockBundles}
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
        onSelectAll={onSelectAll}
        onDeselectAll={onDeselectAll}
        onBatchDecision={onBatchDecision}
        onSelectBundle={onSelectBundle}
        activeFilter="all"
        onFilterChange={onFilterChange}
        counts={counts}
      />
    );

    // Batch toolbar should appear with 2 selected
    expect(screen.getByText(/2 selected/i)).toBeDefined();

    const batchTrashBtn = screen.getByRole('button', { name: /set trash/i });
    fireEvent.click(batchTrashBtn);
    expect(onBatchDecision).toHaveBeenCalledWith(['bundle-1', 'bundle-2'], 'trash');

    const batchHdOnlyBtn = screen.getByRole('button', { name: /set hd only/i });
    fireEvent.click(batchHdOnlyBtn);
    expect(onBatchDecision).toHaveBeenCalledWith(['bundle-1', 'bundle-2'], 'backup_only');
  });

  it('calls onSelectBundle when thumbnail is clicked', () => {
    render(
      <GridView
        bundles={mockBundles}
        selectedIds={new Set()}
        onToggleSelect={onToggleSelect}
        onSelectAll={onSelectAll}
        onDeselectAll={onDeselectAll}
        onBatchDecision={onBatchDecision}
        onSelectBundle={onSelectBundle}
        activeFilter="all"
        onFilterChange={onFilterChange}
        counts={counts}
      />
    );

    const firstCard = screen.getByText('IMG_1001');
    fireEvent.click(firstCard);
    expect(onSelectBundle).toHaveBeenCalledWith(mockBundles[0], 0);
  });
});

describe('CleanupView Component', () => {
  const onTriggerShortcut = vi.fn();
  const onMarkComplete = vi.fn();

  const mockSessionState: SessionState = {
    stagingDir: '/staging',
    hardDriveRoot: '/Volumes/External',
    bundles: mockBundles,
    counts: {
      total: 3,
      unsorted: 0,
      trash: 1,
      backup_only: 1,
      backup_keep: 1,
      alreadyBackedUp: 0,
    },
    status: 'cleanup_ready',
    isBackupVerified: true,
    hardDriveMounted: true,
  };

  const mockCleanupBatch: CleanupBatchResponse = {
    minDate: '2024-01-14T00:00:00.000Z',
    maxDate: '2024-01-18T23:59:59.000Z',
    deleteNamesDelimited: '|IMG_1001|IMG_1002|',
    deleteCount: 2,
    manualDeleteItems: [
      {
        id: 'bundle-3',
        canonicalName: 'IMG_1003',
        previewPath: '/staging/IMG_1003.MOV',
        reason: 'unreliable_date',
        capturedAt: '2024-01-17T09:15:00.000Z',
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders verified state, delete counts, and manual delete items', () => {
    render(
      <CleanupView
        sessionState={mockSessionState}
        cleanupBatch={mockCleanupBatch}
        onTriggerShortcut={onTriggerShortcut}
        onMarkComplete={onMarkComplete}
      />
    );

    expect(screen.getByText(/100% Verified/i)).toBeDefined();
    expect(screen.getByText(/Delete from iPhone: 2/i)).toBeDefined();
    expect(screen.getByText('IMG_1003')).toBeDefined();
    expect(screen.getByText(/unreliable_date/i)).toBeDefined();
  });

  it('renders warning when backup is not verified', () => {
    render(
      <CleanupView
        sessionState={{ ...mockSessionState, isBackupVerified: false }}
        cleanupBatch={null}
        onTriggerShortcut={onTriggerShortcut}
        onMarkComplete={onMarkComplete}
      />
    );

    expect(screen.getByText(/Backup not yet verified/i)).toBeDefined();
  });

  it('triggers shortcut and mark complete actions', () => {
    render(
      <CleanupView
        sessionState={mockSessionState}
        cleanupBatch={mockCleanupBatch}
        onTriggerShortcut={onTriggerShortcut}
        onMarkComplete={onMarkComplete}
      />
    );

    const shortcutBtn = screen.getByRole('button', { name: /run ios cleanup shortcut/i });
    fireEvent.click(shortcutBtn);
    expect(onTriggerShortcut).toHaveBeenCalled();

    const completeBtn = screen.getByRole('button', { name: /mark cleanup completed/i });
    fireEvent.click(completeBtn);
    expect(onMarkComplete).toHaveBeenCalled();
  });
});

describe('DesktopStatus Component', () => {
  const onRefreshScan = vi.fn();
  const onRunBackup = vi.fn();

  const mockSessionState: SessionState = {
    stagingDir: '/staging',
    hardDriveRoot: '/Volumes/PhotosDrive',
    bundles: mockBundles,
    counts: {
      total: 3,
      unsorted: 0,
      trash: 1,
      backup_only: 1,
      backup_keep: 1,
      alreadyBackedUp: 0,
    },
    status: 'triaging',
    isBackupVerified: false,
    hardDriveMounted: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders mount status, directory paths, and action buttons', () => {
    render(
      <DesktopStatus
        sessionState={mockSessionState}
        onRefreshScan={onRefreshScan}
        onRunBackup={onRunBackup}
        serverUrl="http://192.168.1.100:3000"
      />
    );

    expect(screen.getAllByText(/MOUNTED/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('/Volumes/PhotosDrive')).toBeDefined();
    expect(screen.getByText('/staging')).toBeDefined();

    const scanBtn = screen.getByRole('button', { name: /import airdrop \/ scan/i });
    fireEvent.click(scanBtn);
    expect(onRefreshScan).toHaveBeenCalled();

    const backupBtn = screen.getByRole('button', { name: /run verified backup/i });
    fireEvent.click(backupBtn);
    expect(onRunBackup).toHaveBeenCalled();
  });

  it('shows DISCONNECTED when hard drive is not mounted', () => {
    render(
      <DesktopStatus
        sessionState={{ ...mockSessionState, hardDriveMounted: false }}
        onRefreshScan={onRefreshScan}
        onRunBackup={onRunBackup}
      />
    );

    expect(screen.getAllByText(/DISCONNECTED/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders live activity stream console with custom or default logs', () => {
    render(
      <DesktopStatus
        sessionState={mockSessionState}
        onRefreshScan={onRefreshScan}
        onRunBackup={onRunBackup}
        activityLogs={['[12:00:00] VERIFIED: [OK] Checksums verified for 42 files']}
      />
    );

    expect(screen.getByText(/Live Activity Stream \/\/ Verification Log/i)).toBeDefined();
    expect(screen.getByText(/\[12:00:00\] VERIFIED: \[OK\] Checksums verified for 42 files/i)).toBeDefined();
  });
});

describe('App Controller Component', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/session')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                stagingDir: '/mock/staging',
                hardDriveRoot: '/Volumes/PhotosDrive',
                hardDriveMounted: true,
                status: 'triaging',
                bundles: mockBundles,
                counts: {
                  total: 3,
                  unsorted: 1,
                  trash: 1,
                  backup_only: 1,
                  backup_keep: 0,
                  alreadyBackedUp: 0,
                },
                isBackupVerified: false,
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true }),
        });
      })
    );
  });

  it('renders application header and defaults to 1-by-1 single view', async () => {
    render(<App />);
    expect(await screen.findByText('PHOTO TRIAGE // BACKUP')).toBeDefined();
    expect(await screen.findByText('HD MOUNTED')).toBeDefined();
    expect(await screen.findByText('IMG_1001')).toBeDefined();
  });

  it('switches views between 1-by-1, Grid, Cleanup, and Desktop System tabs', async () => {
    render(<App />);
    await screen.findByText('PHOTO TRIAGE // BACKUP');

    // Switch to Grid
    const gridTab = screen.getByRole('button', { name: /grid/i });
    fireEvent.click(gridTab);
    expect(await screen.findByText(/All \(3\)/i)).toBeDefined();

    // Switch to Cleanup
    const cleanupTab = screen.getByRole('button', { name: /cleanup/i });
    fireEvent.click(cleanupTab);
    expect(await screen.findByText(/Verified iPhone Cleanup/i)).toBeDefined();

    // Switch to System
    const systemTab = screen.getByRole('button', { name: /system/i });
    fireEvent.click(systemTab);
    expect(await screen.findByText(/Mobile Safari Connection/i)).toBeDefined();

    // Open Settings Modal
    const settingsBtn = screen.getByRole('button', { name: /settings/i });
    fireEvent.click(settingsBtn);
    expect(await screen.findByText(/Backup Destination Settings/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Browse in Finder/i })).toBeDefined();
    expect(screen.getByText(/Folder Hierarchy Preset/i)).toBeDefined();
    expect(screen.getByText(/Destination Example Preview/i)).toBeDefined();

    // Close Settings Modal
    const escBtn = screen.getByRole('button', { name: /esc/i });
    fireEvent.click(escBtn);
  });
});
