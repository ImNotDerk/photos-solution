import React, { useEffect } from 'react';
import type { AssetBundle } from '../../types/index.js';
import { formatBytes, formatCapturedDate } from './SingleView.js';

export interface PhotoDetailsSheetProps {
  bundle: AssetBundle;
  isOpen: boolean;
  onClose: () => void;
}

export const PhotoDetailsSheet: React.FC<PhotoDetailsSheetProps> = ({
  bundle,
  isOpen,
  onClose,
}) => {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const totalBytes = bundle.files.reduce((acc, f) => acc + (f.size || 0), 0);
  const primaryFile = bundle.files.find((f) => f.role === 'primary') || bundle.files[0];

  return (
    <div
      data-testid="photo-details-sheet-backdrop"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center animate-fade-in"
      onClick={onClose}
    >
      <div
        data-testid="photo-details-sheet"
        className="w-full max-w-lg bg-[#1c1c1e] text-[#f2f2f7] rounded-t-[32px] border-t border-white/15 p-6 shadow-2xl space-y-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab Handle */}
        <div className="w-10 h-1 bg-white/30 rounded-full mx-auto -mt-1 cursor-pointer" onClick={onClose} />

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-white">
              {bundle.canonicalName}
            </h2>
            <p className="text-xs text-white/60">
              Apple iPhone &bull; {primaryFile?.ext.toUpperCase() || 'Photo'}
            </p>
          </div>
          <button
            data-testid="close-sheet-btn"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 flex items-center justify-center text-white/80 hover:text-white transition-colors"
            title="Close Details"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Metadata Card: Camera & Capture */}
        <div className="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-2.5 text-xs">
          <div className="flex items-center justify-between text-white/70">
            <span>Captured Date</span>
            <span className="font-medium text-white">{formatCapturedDate(bundle.capturedAt)}</span>
          </div>
          <div className="flex items-center justify-between text-white/70">
            <span>Date Source</span>
            <span className={`font-medium ${bundle.dateReliable ? 'text-emerald-400' : 'text-amber-400'}`}>
              {bundle.dateReliable ? 'Verified EXIF' : 'Inferred / File Stamp'}
            </span>
          </div>
          <div className="flex items-center justify-between text-white/70">
            <span>Total Bundle Size</span>
            <span className="font-medium text-white">{formatBytes(totalBytes)}</span>
          </div>
        </div>

        {/* Metadata Card: Destination & Triage */}
        <div className="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-2.5 text-xs">
          <div className="flex items-center justify-between text-white/70">
            <span>Target HD Folder</span>
            <span className="font-medium text-white font-mono">
              {bundle.targetYear}/{bundle.targetMonth}
            </span>
          </div>
          <div className="flex items-center justify-between text-white/70">
            <span>Current Decision</span>
            <span
              className={`font-semibold uppercase tracking-wider ${
                bundle.decision === 'trash'
                  ? 'text-red-400'
                  : bundle.decision === 'backup_only'
                  ? 'text-sky-400'
                  : bundle.decision === 'backup_keep'
                  ? 'text-emerald-400'
                  : 'text-white/60'
              }`}
            >
              {bundle.decision.replace('_', ' ')}
            </span>
          </div>
          <div className="flex items-center justify-between text-white/70">
            <span>Hard Drive Status</span>
            <span className="font-medium text-white">
              {bundle.alreadyBackedUp ? 'Previously Archived' : 'Pending Triage / Backup'}
            </span>
          </div>
        </div>

        {/* Files in Bundle List */}
        <div className="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-2 text-xs">
          <span className="text-white/50 uppercase tracking-wider text-[10px] block font-medium">
            Files in Asset Bundle ({bundle.files.length})
          </span>
          <div className="space-y-1.5 divide-y divide-white/5">
            {bundle.files.map((f, i) => (
              <div key={i} className="pt-1.5 first:pt-0 flex items-center justify-between font-mono text-[11px]">
                <span className="text-white/90 truncate max-w-[200px]" title={f.filename}>
                  {f.filename}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-white/50 uppercase text-[9px] px-1.5 py-0.5 rounded bg-white/5">
                    {f.role.replace('_', ' ')}
                  </span>
                  <span className="text-white/70">{formatBytes(f.size || 0)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/15 active:scale-[0.99] text-white text-xs font-semibold tracking-wide transition-all"
        >
          Done
        </button>
      </div>
    </div>
  );
};
