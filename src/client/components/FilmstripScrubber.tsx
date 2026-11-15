import React, { useEffect, useRef } from 'react';
import type { AssetBundle } from '../../types/index.js';

export interface FilmstripScrubberProps {
  bundles: AssetBundle[];
  currentIndex: number;
  onSelectIndex: (index: number) => void;
}

export const FilmstripScrubber: React.FC<FilmstripScrubberProps> = ({
  bundles,
  currentIndex,
  onSelectIndex,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeThumbRef = useRef<HTMLButtonElement>(null);

  // Automatically scroll active thumbnail into view
  useEffect(() => {
    if (activeThumbRef.current && containerRef.current) {
      activeThumbRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [currentIndex]);

  if (!bundles || bundles.length === 0) return null;

  return (
    <div
      data-testid="filmstrip-scrubber"
      className="w-full px-3 py-2 bg-black/40 backdrop-blur-md border-t border-white/10 select-none"
    >
      <div className="flex items-center justify-between text-[10px] text-white/50 mb-1.5 px-1 font-medium">
        <span>SWIPE OR TAP TO COMPARE</span>
        <span>
          {currentIndex + 1} of {bundles.length}
        </span>
      </div>

      <div
        ref={containerRef}
        className="flex gap-1.5 overflow-x-auto no-scrollbar py-0.5 scroll-smooth"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {bundles.map((b, idx) => {
          const isActive = idx === currentIndex;
          const isTrash = b.decision === 'trash';
          const isBackupOnly = b.decision === 'backup_only';
          const isBackupKeep = b.decision === 'backup_keep';

          return (
            <button
              key={b.id || idx}
              ref={isActive ? activeThumbRef : null}
              data-testid={`filmstrip-thumb-${idx}`}
              onClick={() => onSelectIndex(idx)}
              className={`relative flex-shrink-0 w-11 h-11 rounded-md overflow-hidden transition-all duration-150 focus:outline-none ${
                isActive
                  ? 'ring-2 ring-white scale-105 z-10'
                  : 'opacity-60 hover:opacity-100 ring-1 ring-white/20'
              }`}
              title={`${b.canonicalName} (${idx + 1}/${bundles.length})`}
            >
              <img
                src={b.previewPath}
                alt={b.canonicalName}
                className="w-full h-full object-cover pointer-events-none"
                loading="lazy"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = 'none';
                }}
              />

              {/* Status Decision Dot */}
              {isTrash && (
                <div
                  data-testid="status-dot-trash"
                  className="absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-1 ring-black"
                  title="Marked for Trash"
                />
              )}
              {isBackupOnly && (
                <div
                  data-testid="status-dot-backup-only"
                  className="absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full bg-sky-500 ring-1 ring-black"
                  title="Marked for HD Only"
                />
              )}
              {isBackupKeep && (
                <div
                  data-testid="status-dot-backup-keep"
                  className="absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-1 ring-black"
                  title="Marked to Keep on Phone"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
