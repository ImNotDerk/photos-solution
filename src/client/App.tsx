import React, { useState, useEffect, useCallback } from 'react';
import type {
  AssetBundle,
  CleanupBatchResponse,
  SessionState,
  SortFilter,
  TriageDecision,
  ViewMode,
} from '../types/index.js';
import { SingleView } from './components/SingleView.js';
import { GridView } from './components/GridView.js';
import { CleanupView } from './components/CleanupView.js';
import { DesktopStatus } from './components/DesktopStatus.js';

interface UndoItem {
  bundleId: string;
  prevDecision: TriageDecision;
  prevIndex: number;
}

export type ExtendedViewMode = ViewMode | 'desktop';

export const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<ExtendedViewMode>('single');
  const [sessionState, setSessionState] = useState<SessionState>({
    stagingDir: '',
    hardDriveRoot: '',
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
    hardDriveMounted: false,
  });

  const [cleanupBatch, setCleanupBatch] = useState<CleanupBatchResponse | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<SortFilter>('all');
  const [undoStack, setUndoStack] = useState<UndoItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [activityLogs, setActivityLogs] = useState<string[]>([
    `[${new Date().toISOString().slice(11, 19)}] SYSTEM: UI initialized, connecting to Fastify API`,
  ]);

  const addLog = (msg: string) => {
    const time = new Date().toISOString().slice(11, 19);
    setActivityLogs((prev) => [...prev, `[${time}] ${msg}`]);
  };

  // Fetch session data from backend
  const fetchSession = useCallback(async (scan = false) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const url = scan ? '/api/session?scan=true' : '/api/session';
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch session: HTTP ${res.status}`);
      }
      const data: SessionState = await res.json();
      setSessionState(data);
      addLog(`SESSION: Sync completed with ${data.bundles.length} bundle(s) (${data.counts.unsorted} unsorted)`);

      // If backup is already verified or cleanup_ready, also load cleanup batch
      if (data.isBackupVerified || data.status === 'cleanup_ready' || data.status === 'completed') {
        try {
          const cleanupRes = await fetch('/api/cleanup-batch');
          if (cleanupRes.ok) {
            const batch: CleanupBatchResponse = await cleanupRes.json();
            setCleanupBatch(batch);
          }
        } catch {
          // Non-fatal if cleanup-batch is not ready yet
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error connecting to photo triage server.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Handle single decision
  const handleDecision = async (bundleId: string, decision: TriageDecision) => {
    const currentBundle = sessionState.bundles.find((b) => b.id === bundleId);
    if (!currentBundle) return;

    const prevDecision = currentBundle.decision;
    const prevIdx = currentIndex;

    // Record undo
    setUndoStack((prev) => [...prev, { bundleId, prevDecision, prevIndex: prevIdx }]);

    // Optimistic local update
    const updatedBundles = sessionState.bundles.map((b) =>
      b.id === bundleId ? { ...b, decision } : b
    );

    // Recompute counts locally
    const newCounts = { ...sessionState.counts };
    if (prevDecision !== decision) {
      newCounts[prevDecision] = Math.max(0, newCounts[prevDecision] - 1);
      newCounts[decision] = (newCounts[decision] || 0) + 1;
    }

    setSessionState((prev) => ({
      ...prev,
      bundles: updatedBundles,
      counts: newCounts,
    }));

    // Auto-advance in single view
    if (currentIndex < sessionState.bundles.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }

    try {
      const res = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundleId, decision }),
      });
      if (!res.ok) {
        throw new Error(`Failed to record triage decision: HTTP ${res.status}`);
      }
      const data = await res.json();
      addLog(`TRIAGE: Bundle ${bundleId} marked ${decision}`);
      if (data.counts) {
        setSessionState((prev) => ({
          ...prev,
          counts: data.counts,
          bundles: data.bundles || prev.bundles,
        }));
      }
    } catch (err: any) {
      setErrorMsg(err.message);
      // Revert on error
      fetchSession();
    }
  };

  // Handle batch triage
  const handleBatchDecision = async (bundleIds: string[], decision: TriageDecision) => {
    if (bundleIds.length === 0) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundleIds, decision }),
      });
      if (!res.ok) {
        throw new Error(`Failed to apply batch decision: HTTP ${res.status}`);
      }
      const data = await res.json();
      addLog(`BATCH: ${bundleIds.length} items assigned to ${decision}`);
      if (data.counts) {
        setSessionState((prev) => ({
          ...prev,
          counts: data.counts,
          bundles: data.bundles || prev.bundles,
        }));
      }
      setSelectedIds(new Set());
      setInfoMsg(`Assigned ${bundleIds.length} items to ${decision}.`);
      setTimeout(() => setInfoMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Undo
  const handleUndo = async () => {
    if (undoStack.length === 0) return;
    const lastItem = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, prev.length - 1));

    try {
      const res = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundleId: lastItem.bundleId, decision: lastItem.prevDecision }),
      });
      if (!res.ok) {
        throw new Error(`Failed to undo triage decision: HTTP ${res.status}`);
      }
      const data = await res.json();
      addLog(`UNDO: Reverted bundle ${lastItem.bundleId} to ${lastItem.prevDecision}`);
      if (data.counts) {
        setSessionState((prev) => ({
          ...prev,
          counts: data.counts,
          bundles: data.bundles || prev.bundles,
        }));
      }
      setCurrentIndex(lastItem.prevIndex);
    } catch (err: any) {
      setErrorMsg(err.message);
      fetchSession();
    }
  };

  // Run Verified Backup
  const handleRunBackup = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hardDriveRoot: sessionState.hardDriveRoot,
          stagingDir: sessionState.stagingDir,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.errors?.join('; ') || 'Backup and verification failed.');
      }

      setInfoMsg(`Backup verified! Copied & verified ${data.verifiedCount} files.`);
      addLog(`VERIFIED: [OK] Backup verified: ${data.verifiedCount} files confirmed with SHA-256`);
      await fetchSession();

      // Automatically switch to cleanup view
      setViewMode('cleanup');
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Trigger iOS Cleanup Shortcut
  const handleTriggerShortcut = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const cleanupUrl = `${origin}/api/cleanup-batch`;
    const shortcutDeepLink = `shortcuts://run-shortcut?name=PhotoTriageCleanup&input=text&text=${encodeURIComponent(cleanupUrl)}`;
    window.location.href = shortcutDeepLink;
  };

  // Mark cleanup completed
  const handleMarkComplete = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/cleanup-complete', { method: 'POST' });
      if (!res.ok) {
        throw new Error('Failed to record cleanup completion');
      }
      const data = await res.json();
      if (data.session) {
        setSessionState(data.session);
      }
      addLog('CLEANUP: [OK] Photo batch cleanup completed');
      setInfoMsg('Photo batch cleanup marked as completed!');
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Selection helpers
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(sessionState.bundles.map((b) => b.id)));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const currentBundle = sessionState.bundles[currentIndex] || null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-mono text-sm antialiased selection:bg-slate-700">
      {/* Top Application Header */}
      <header className="border-b border-slate-700 bg-slate-950 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <span className="font-extrabold tracking-widest text-slate-100 text-sm">
            PHOTO TRIAGE // BACKUP
          </span>
          <span
            className={`hidden sm:inline-block px-2 py-0.5 border text-[10px] font-bold uppercase ${
              sessionState.hardDriveMounted
                ? 'border-emerald-600 bg-emerald-950 text-emerald-300'
                : 'border-red-600 bg-red-950 text-red-300'
            }`}
          >
            {sessionState.hardDriveMounted ? 'HD MOUNTED' : 'HD UNMOUNTED'}
          </span>
        </div>

        {/* View switcher tabs */}
        <nav className="flex items-center gap-1 text-xs">
          <button
            onClick={() => setViewMode('single')}
            className={`px-3 py-1 border transition-colors ${
              viewMode === 'single'
                ? 'border-sky-500 bg-sky-950 text-sky-200 font-bold'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            1-by-1
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1 border transition-colors ${
              viewMode === 'grid'
                ? 'border-sky-500 bg-sky-950 text-sky-200 font-bold'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            Grid ({sessionState.counts.total})
          </button>
          <button
            onClick={() => setViewMode('cleanup')}
            className={`px-3 py-1 border transition-colors ${
              viewMode === 'cleanup'
                ? 'border-sky-500 bg-sky-950 text-sky-200 font-bold'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            Cleanup
            {sessionState.isBackupVerified && (
              <span className="ml-1 text-[9px] text-emerald-400">●</span>
            )}
          </button>
          <button
            onClick={() => setViewMode('desktop')}
            className={`px-3 py-1 border transition-colors ${
              viewMode === 'desktop'
                ? 'border-sky-500 bg-sky-950 text-sky-200 font-bold'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            System
          </button>
        </nav>
      </header>

      {/* Notifications / Alerts banner */}
      {errorMsg && (
        <div className="bg-red-950 border-b border-red-700 text-red-200 px-4 py-2 text-xs flex items-center justify-between">
          <span>Error: {errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-red-400 underline font-bold">
            Dismiss
          </button>
        </div>
      )}

      {infoMsg && (
        <div className="bg-emerald-950 border-b border-emerald-700 text-emerald-200 px-4 py-2 text-xs flex items-center justify-between">
          <span>{infoMsg}</span>
          <button onClick={() => setInfoMsg(null)} className="text-emerald-400 underline font-bold">
            Dismiss
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 p-2 sm:p-4 flex flex-col justify-start">
        {viewMode === 'single' && (
          <SingleView
            bundle={currentBundle}
            currentIndex={currentIndex}
            totalCount={sessionState.bundles.length}
            unsortedCount={sessionState.counts.unsorted}
            onDecision={handleDecision}
            onPrevious={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
            onNext={() => setCurrentIndex((prev) => Math.min(sessionState.bundles.length - 1, prev + 1))}
            onUndo={handleUndo}
            canUndo={undoStack.length > 0}
          />
        )}

        {viewMode === 'grid' && (
          <GridView
            bundles={sessionState.bundles}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onSelectAll={handleSelectAll}
            onDeselectAll={handleDeselectAll}
            onBatchDecision={handleBatchDecision}
            onSelectBundle={(bundle, idx) => {
              setCurrentIndex(idx);
              setViewMode('single');
            }}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            counts={sessionState.counts}
          />
        )}

        {viewMode === 'cleanup' && (
          <CleanupView
            sessionState={sessionState}
            cleanupBatch={cleanupBatch}
            onTriggerShortcut={handleTriggerShortcut}
            onMarkComplete={handleMarkComplete}
            isLoading={isLoading}
          />
        )}

        {viewMode === 'desktop' && (
          <DesktopStatus
            sessionState={sessionState}
            onRefreshScan={() => fetchSession(true)}
            onRunBackup={handleRunBackup}
            isBackingUp={isLoading}
            activityLogs={activityLogs}
          />
        )}
      </main>
    </div>
  );
};
