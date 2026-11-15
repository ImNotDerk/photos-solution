import React, { useEffect, useRef } from 'react';
import type { AssetBundle, TriageDecision } from '../../types/index.js';

export interface SingleViewProps {
  bundle: AssetBundle | null;
  currentIndex: number;
  totalCount: number;
  unsortedCount: number;
  onDecision: (bundleId: string, decision: TriageDecision) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatCapturedDate(dateStr?: string): string {
  if (!dateStr) return 'Unknown';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr || 'Unknown';
    return d.toISOString().replace('T', ' ').slice(0, 16);
  } catch {
    return dateStr || 'Unknown';
  }
}

export const SingleView: React.FC<SingleViewProps> = ({
  bundle,
  currentIndex,
  totalCount,
  unsortedCount,
  onDecision,
  onPrevious,
  onNext,
  onUndo,
  canUndo = false,
}) => {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchCurrentRef = useRef<{ x: number; y: number } | null>(null);

  // Keyboard shortcut listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if an input is active
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (!bundle) return;

      const key = e.key.toLowerCase();

      if (key === '1' || key === 't') {
        e.preventDefault();
        onDecision(bundle.id, 'trash');
      } else if (key === '2' || key === 'o') {
        e.preventDefault();
        onDecision(bundle.id, 'backup_only');
      } else if (key === '3' || key === 'k') {
        e.preventDefault();
        onDecision(bundle.id, 'backup_keep');
      } else if (key === 'u' || key === 'z') {
        e.preventDefault();
        if (onUndo) onUndo();
      } else if (e.key === 'ArrowLeft' || key === 'h') {
        e.preventDefault();
        if (onPrevious) onPrevious();
      } else if (e.key === 'ArrowRight' || key === 'l') {
        e.preventDefault();
        if (onNext) onNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bundle, onDecision, onPrevious, onNext, onUndo]);

  if (!bundle) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] border border-slate-700 bg-slate-900 text-slate-400 p-8">
        <span className="font-mono text-sm tracking-wider uppercase mb-2">No Active Asset</span>
        <p className="text-xs text-slate-500">Staging folder is empty or all items have been triaged.</p>
      </div>
    );
  }

  // Calculate total bundle size
  const totalBytes = bundle.files.reduce((acc, f) => acc + (f.size || 0), 0);

  // Detect companion roles
  const hasLiveVideo = bundle.files.some((f) => f.role === 'live_video');
  const hasEditedRender = bundle.files.some((f) => f.role === 'edited_render' || f.role === 'edit_sidecar');
  const isVideoPrimary = bundle.files.some((f) => f.role === 'primary' && ['.mov', '.mp4', '.m4v'].includes(f.ext.toLowerCase()));

  // Touch handlers for tactile mobile gestures
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches && e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
      touchCurrentRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches && e.touches.length === 1) {
      touchCurrentRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const endX = (e.changedTouches && e.changedTouches.length > 0)
      ? e.changedTouches[0].clientX
      : touchCurrentRef.current?.x;
    const endY = (e.changedTouches && e.changedTouches.length > 0)
      ? e.changedTouches[0].clientY
      : touchCurrentRef.current?.y;

    if (endX === undefined || endY === undefined) return;

    const deltaX = endX - touchStartRef.current.x;
    const deltaY = endY - touchStartRef.current.y;
    touchStartRef.current = null;
    touchCurrentRef.current = null;

    const threshold = 40;
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX < -threshold) {
        // Swipe left -> trash
        onDecision(bundle.id, 'trash');
      } else if (deltaX > threshold) {
        // Swipe right -> backup_keep
        onDecision(bundle.id, 'backup_keep');
      }
    } else {
      if (Math.abs(deltaY) > threshold) {
        // Swipe up or down -> backup_only
        onDecision(bundle.id, 'backup_only');
      }
    }
  };

  return (
    <div className="flex flex-col w-full max-w-4xl mx-auto border border-slate-700 bg-slate-900 text-slate-100">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 bg-slate-950 font-mono text-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-200">
            [{currentIndex + 1}/{totalCount}]
          </span>
          <span className="text-slate-400">UNSORTED: {unsortedCount}</span>
        </div>
        <div className="flex items-center gap-2">
          {bundle.alreadyBackedUp && (
            <span className="px-1.5 py-0.5 border border-purple-700 bg-purple-950 text-purple-300 text-[10px] uppercase tracking-wider font-semibold">
              Backed Up
            </span>
          )}
          <span
            className={`px-2 py-0.5 border text-[10px] font-bold uppercase tracking-wider ${
              bundle.decision === 'trash'
                ? 'border-red-700 bg-red-950 text-red-300'
                : bundle.decision === 'backup_only'
                ? 'border-sky-700 bg-sky-950 text-sky-300'
                : bundle.decision === 'backup_keep'
                ? 'border-emerald-700 bg-emerald-950 text-emerald-300'
                : 'border-slate-700 bg-slate-800 text-slate-400'
            }`}
          >
            {bundle.decision.replace('_', ' ')}
          </span>
          {onUndo && (
            <button
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo last triage (U)"
              className="px-2 py-0.5 border border-slate-700 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300"
            >
              [U] Undo
            </button>
          )}
        </div>
      </div>

      {/* Main Preview Container */}
      <div
        data-testid="swipe-area"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="relative flex items-center justify-center bg-slate-950 select-none min-h-[340px] max-h-[58vh] overflow-hidden"
      >
        {/* Companion Badges (top-left) */}
        <div className="absolute top-2 left-2 flex flex-wrap gap-1 z-10 font-mono text-[10px]">
          {hasLiveVideo && (
            <span className="px-1.5 py-0.5 border border-emerald-600 bg-emerald-950/90 text-emerald-300 font-bold">
              LIVE
            </span>
          )}
          {hasEditedRender && (
            <span className="px-1.5 py-0.5 border border-amber-600 bg-amber-950/90 text-amber-300 font-bold">
              EDIT
            </span>
          )}
          {isVideoPrimary && (
            <span className="px-1.5 py-0.5 border border-cyan-600 bg-cyan-950/90 text-cyan-300 font-bold">
              VIDEO
            </span>
          )}
          {!bundle.dateReliable && (
            <span className="px-1.5 py-0.5 border border-yellow-600 bg-yellow-950/90 text-yellow-300 font-bold">
              NO EXIF
            </span>
          )}
        </div>

        {/* Media Preview */}
        {isVideoPrimary && ['.mov', '.mp4', '.m4v'].some((ext) => bundle.previewPath.toLowerCase().endsWith(ext)) ? (
          <video
            src={bundle.previewPath}
            controls
            playsInline
            className="max-h-[55vh] max-w-full object-contain"
          />
        ) : (
          <img
            src={bundle.previewPath}
            alt={bundle.canonicalName}
            className="max-h-[55vh] max-w-full object-contain pointer-events-none"
            onError={(e) => {
              // Fallback placeholder if image load fails
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
        )}
      </div>

      {/* Metadata Panel */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-3 py-2 border-t border-b border-slate-700 bg-slate-950 font-mono text-xs text-slate-300">
        <div>
          <span className="text-slate-500 block text-[10px] uppercase">Asset</span>
          <span className="font-semibold text-slate-100">{bundle.canonicalName}</span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px] uppercase">Captured</span>
          <span title={bundle.capturedAt}>
            {formatCapturedDate(bundle.capturedAt)}
          </span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px] uppercase">Destination</span>
          <span className="text-slate-200">{bundle.targetYear}/{bundle.targetMonth}</span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px] uppercase">Bundle Size</span>
          <span className="text-slate-200">
            {formatBytes(totalBytes)} ({bundle.files.length} file{bundle.files.length === 1 ? '' : 's'})
          </span>
        </div>
      </div>

      {/* Tactile Triage Buttons */}
      <div className="grid grid-cols-3 gap-2 p-3 bg-slate-900 border-b border-slate-700 font-mono">
        <button
          onClick={() => onDecision(bundle.id, 'trash')}
          className="flex flex-col items-center justify-center py-3 px-2 border border-red-700 bg-red-950/40 hover:bg-red-900/60 active:bg-red-800 text-red-200 transition-colors"
        >
          <span className="text-xs font-bold uppercase tracking-wider text-red-300">[1] TRASH</span>
          <span className="text-[10px] text-red-400 opacity-80">Delete from iPhone</span>
        </button>

        <button
          onClick={() => onDecision(bundle.id, 'backup_only')}
          className="flex flex-col items-center justify-center py-3 px-2 border border-sky-700 bg-sky-950/40 hover:bg-sky-900/60 active:bg-sky-800 text-sky-200 transition-colors"
        >
          <span className="text-xs font-bold uppercase tracking-wider text-sky-300">[2] HD ONLY</span>
          <span className="text-[10px] text-sky-400 opacity-80">Save HD &amp; Delete Phone</span>
        </button>

        <button
          onClick={() => onDecision(bundle.id, 'backup_keep')}
          className="flex flex-col items-center justify-center py-3 px-2 border border-emerald-700 bg-emerald-950/40 hover:bg-emerald-900/60 active:bg-emerald-800 text-emerald-200 transition-colors"
        >
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">[3] HD + PHONE</span>
          <span className="text-[10px] text-emerald-400 opacity-80">Save HD &amp; Keep Phone</span>
        </button>
      </div>

      {/* Navigation Footer */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-950 font-mono text-xs text-slate-400">
        <button
          onClick={onPrevious}
          disabled={currentIndex <= 0}
          className="px-3 py-1 border border-slate-700 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300"
        >
          [←] Prev
        </button>
        <span className="text-[10px] text-slate-500 uppercase tracking-wider">
          Swipe Left: Trash | Right: HD+Phone | Vertical: HD Only
        </span>
        <button
          onClick={onNext}
          disabled={currentIndex >= totalCount - 1}
          className="px-3 py-1 border border-slate-700 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300"
        >
          Next [→]
        </button>
      </div>
    </div>
  );
};
