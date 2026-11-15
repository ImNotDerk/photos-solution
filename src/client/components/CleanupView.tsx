import React from 'react';
import type { CleanupBatchResponse, SessionState } from '../../types/index.js';

export interface CleanupViewProps {
  sessionState: SessionState;
  cleanupBatch: CleanupBatchResponse | null;
  onTriggerShortcut: () => void;
  onMarkComplete: () => Promise<void> | void;
  isLoading?: boolean;
}

export const CleanupView: React.FC<CleanupViewProps> = ({
  sessionState,
  cleanupBatch,
  onTriggerShortcut,
  onMarkComplete,
  isLoading = false,
}) => {
  const isVerified = sessionState.isBackupVerified;
  const isCompleted = sessionState.status === 'completed';

  const deleteCount = cleanupBatch?.deleteCount ?? (sessionState.counts.trash + sessionState.counts.backup_only);
  const keepCount = sessionState.counts.backup_keep;
  const manualItems = cleanupBatch?.manualDeleteItems || [];

  return (
    <div className="flex flex-col w-full max-w-4xl mx-auto border border-slate-700 bg-slate-900 text-slate-100 font-mono">
      {/* Verification Status Header */}
      <div className="p-4 border-b border-slate-700 bg-slate-950">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-slate-500 uppercase tracking-widest">
            Step 3 // Verified iPhone Cleanup
          </span>
          <span className="text-xs text-slate-400">
            Hard Drive: {sessionState.hardDriveRoot || 'Not configured'}
          </span>
        </div>

        {isVerified ? (
          <div className="p-3 border border-emerald-600 bg-emerald-950/40 text-emerald-200">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 border border-emerald-500 bg-emerald-900 text-emerald-100 font-bold text-xs">
                100% VERIFIED
              </span>
              <span className="text-sm font-semibold">
                Verified on External Hard Drive
              </span>
            </div>
            <p className="text-xs text-emerald-400/90 mt-1">
              All files confirmed on external storage with exact byte sizes and SHA-256 cryptographic checksums.
            </p>
          </div>
        ) : (
          <div className="p-3 border border-amber-600 bg-amber-950/40 text-amber-200">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 border border-amber-500 bg-amber-900 text-amber-100 font-bold text-xs">
                LOCKED
              </span>
              <span className="text-sm font-semibold">
                Backup not yet verified on hard drive.
              </span>
            </div>
            <p className="text-xs text-amber-400/90 mt-1">
              To prevent accidental photo loss, iOS cleanup is locked until backup execution completes and all files are verified.
            </p>
          </div>
        )}
      </div>

      {/* Breakdown Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-4 border-b border-slate-700 bg-slate-900 text-xs">
        <div className="p-3 border border-slate-700 bg-slate-950">
          <span className="text-slate-500 block text-[10px] uppercase">Action Target</span>
          <span className="text-lg font-bold text-red-400">
            Delete from iPhone: {deleteCount}
          </span>
        </div>

        <div className="p-3 border border-slate-700 bg-slate-950">
          <span className="text-slate-500 block text-[10px] uppercase">Retained on Phone</span>
          <span className="text-lg font-bold text-emerald-400">
            Keep: {keepCount}
          </span>
        </div>

        <div className="p-3 border border-slate-700 bg-slate-950">
          <span className="text-slate-500 block text-[10px] uppercase">Automated Batch</span>
          <span className="text-lg font-bold text-sky-400">
            {cleanupBatch ? cleanupBatch.deleteNamesDelimited.split('|').filter(Boolean).length : 0} items
          </span>
        </div>

        <div className="p-3 border border-slate-700 bg-slate-950">
          <span className="text-slate-500 block text-[10px] uppercase">Manual Review</span>
          <span className="text-lg font-bold text-amber-400">
            {manualItems.length} items
          </span>
        </div>
      </div>

      {/* Date Window */}
      {cleanupBatch && (
        <div className="px-4 py-2 border-b border-slate-700 bg-slate-950 text-xs flex flex-wrap items-center justify-between gap-2 text-slate-400">
          <div>
            <span className="text-slate-500 uppercase mr-1">Date Window (±24h):</span>
            <span className="text-slate-200">
              {cleanupBatch.minDate.slice(0, 10)} → {cleanupBatch.maxDate.slice(0, 10)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 uppercase mr-1">Candidate Basenames:</span>
            <span className="text-slate-300 truncate max-w-xs inline-block align-bottom font-mono text-[11px]">
              {cleanupBatch.deleteNamesDelimited}
            </span>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="p-4 bg-slate-900 border-b border-slate-700 flex flex-col sm:flex-row gap-3">
        <button
          onClick={onTriggerShortcut}
          disabled={!isVerified || isLoading}
          className="flex-1 py-3 px-4 border border-sky-600 bg-sky-950 hover:bg-sky-900 active:bg-sky-800 disabled:opacity-40 disabled:cursor-not-allowed text-sky-200 text-xs font-bold uppercase tracking-wider text-center transition-colors"
        >
          Run iOS Cleanup Shortcut
        </button>

        <button
          onClick={onMarkComplete}
          disabled={!isVerified || isLoading || isCompleted}
          className="flex-1 py-3 px-4 border border-emerald-700 bg-emerald-950 hover:bg-emerald-900 active:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed text-emerald-200 text-xs font-bold uppercase tracking-wider text-center transition-colors"
        >
          {isCompleted ? 'Cleanup Completed' : 'Mark Cleanup Completed'}
        </button>
      </div>

      {/* Manual Delete Candidates (Safety Guard) */}
      {manualItems.length > 0 && (
        <div className="p-4 bg-slate-950">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 border border-amber-600 bg-amber-950 text-amber-300 text-[10px] font-bold uppercase">
              Manual Action Required
            </span>
            <span className="text-xs text-slate-300">
              Excluded from automated iOS Shortcut to prevent accidental data deletion
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mt-3">
            {manualItems.map((item) => {
              const reason = 'reason' in item ? item.reason : 'manual_review';
              return (
                <div
                  key={item.id}
                  className="p-2 border border-slate-700 bg-slate-900 flex flex-col gap-1 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-200">{item.canonicalName}</span>
                    <span className="px-1.5 py-0.2 border border-amber-700 bg-amber-950 text-amber-300 text-[9px] uppercase">
                      {reason}
                    </span>
                  </div>
                  {item.previewPath && (
                    <div className="w-full aspect-video bg-slate-950 flex items-center justify-center overflow-hidden border border-slate-800 mt-1">
                      <img
                        src={item.previewPath}
                        alt={item.canonicalName}
                        className="max-h-full object-contain pointer-events-none"
                      />
                    </div>
                  )}
                  <span className="text-[10px] text-slate-500 mt-1">
                    Reason: {reason === 'keep_collision' ? 'Name collides with Back Up + Keep item' : 'Unreliable EXIF timestamp'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
