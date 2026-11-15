import React, { useEffect, useRef, useState } from 'react';
import type { AssetBundle, TriageDecision } from '../../types/index.js';
import { FilmstripScrubber } from './FilmstripScrubber.js';
import { PhotoDetailsSheet } from './PhotoDetailsSheet.js';

export interface SingleViewProps {
  bundle: AssetBundle | null;
  bundles?: AssetBundle[];
  currentIndex: number;
  totalCount: number;
  unsortedCount: number;
  onDecision: (bundleId: string, decision: TriageDecision) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
  onImportDownloads?: () => void;
  isImporting?: boolean;
  onSelectIndex?: (index: number) => void;
  onBackToGrid?: () => void;
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
  bundles,
  currentIndex,
  totalCount,
  unsortedCount,
  onDecision,
  onPrevious,
  onNext,
  onUndo,
  canUndo = false,
  onImportDownloads,
  isImporting = false,
  onSelectIndex,
  onBackToGrid,
}) => {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<TriageDecision | null>(null);
  const [popDecision, setPopDecision] = useState<TriageDecision | null>(null);
  const [dragX, setDragX] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const touchCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const isMouseDownRef = useRef<boolean>(false);
  const mouseStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastTapTimeRef = useRef<number>(0);
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear transient feedback states when moving to another bundle
  useEffect(() => {
    setFeedbackStatus(null);
    setDragX(0);
    setIsDragging(false);
  }, [bundle?.id]);

  // Clean up auto-advance timer on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, []);

  // Handle triage action with Instagram spring pop animation and 350ms settle auto-advance
  const handleTriageAction = (decision: TriageDecision) => {
    if (!bundle) return;
    setFeedbackStatus(decision);
    setPopDecision(decision);
    onDecision(bundle.id, decision);

    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
    }

    if (onNext) {
      autoAdvanceTimerRef.current = setTimeout(() => {
        setPopDecision(null);
        onNext();
      }, 350);
    }
  };

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
        handleTriageAction('trash');
      } else if (key === '2' || key === 'o') {
        e.preventDefault();
        handleTriageAction('backup_only');
      } else if (key === '3' || key === 'k') {
        e.preventDefault();
        handleTriageAction('backup_keep');
      } else if (key === 'u' || key === 'z') {
        e.preventDefault();
        if (onUndo) onUndo();
      } else if (e.key === 'ArrowLeft' || key === 'h') {
        e.preventDefault();
        if (onPrevious) onPrevious();
      } else if (e.key === 'ArrowRight' || key === 'l') {
        e.preventDefault();
        if (onNext) onNext();
      } else if (key === 'i') {
        e.preventDefault();
        setIsDetailsOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bundle, onDecision, onPrevious, onNext, onUndo]);

  if (!bundle) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[460px] border border-slate-700 bg-slate-900 text-slate-400 p-6 text-center space-y-4 font-mono">
        <div className="w-12 h-12 border border-slate-700 bg-slate-950 flex items-center justify-center text-indigo-400 text-lg font-bold">
          [!]
        </div>
        <div className="space-y-1">
          <span className="text-sm tracking-wider uppercase font-bold text-slate-200 block">
            Staging Folder Is Empty
          </span>
          <p className="text-xs text-slate-400 max-w-xs mx-auto font-sans">
            Safari on your iPhone cannot read your Camera Roll directly. You need to AirDrop your photos to your Mac first.
          </p>
        </div>

        <div className="w-full max-w-xs p-3 border border-slate-800 bg-slate-950 text-left text-xs space-y-2">
          <span className="font-bold text-[11px] text-slate-300 uppercase tracking-wider block">How to Load Photos:</span>
          <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-slate-400 font-sans">
            <li>Open <strong>Apple Photos</strong> on your iPhone.</li>
            <li>Select your photos and tap <strong>Share → AirDrop → Your Mac</strong>.</li>
            <li>Tap the button below to import from your Mac:</li>
          </ol>
        </div>

        {onImportDownloads && (
          <button
            onClick={onImportDownloads}
            disabled={isImporting}
            className="w-full max-w-xs py-3 px-4 border border-indigo-500 bg-indigo-950 hover:bg-indigo-900 active:bg-indigo-800 disabled:opacity-50 text-indigo-200 text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2"
          >
            {isImporting ? 'Importing from Downloads...' : 'Import Latest AirDrop from Downloads'}
          </button>
        )}
      </div>
    );
  }

  // Virtualized Windowed Carousel:
  // Render ONLY 3 items in the DOM [Slot -1 (prev), Slot 0 (current), Slot 1 (next)] to prevent DOM node bloat
  const prevBundle = (currentIndex > 0 && bundles && bundles[currentIndex - 1]) ? bundles[currentIndex - 1] : null;
  const nextBundle = (bundles && currentIndex < totalCount - 1 && bundles[currentIndex + 1]) ? bundles[currentIndex + 1] : null;

  interface CarouselSlideItem {
    slot: -1 | 0 | 1;
    index: number;
    bundle: AssetBundle | null;
  }

  const slides: CarouselSlideItem[] = [
    { slot: -1, index: currentIndex - 1, bundle: prevBundle },
    { slot: 0, index: currentIndex, bundle },
    { slot: 1, index: currentIndex + 1, bundle: nextBundle },
  ];

  // Option A Touch Handlers:
  // - Horizontal drag with 1:1 finger tracking, rubber-banding, snapping
  // - Swipe DOWN (deltaY > 55) -> Trash
  // - Swipe UP (deltaY < -55) -> HD Only
  // - Double-tap -> Keep
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches && e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
      touchCurrentRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
      setIsDragging(true);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current || !e.touches || e.touches.length !== 1) return;
    const curX = e.touches[0].clientX;
    const curY = e.touches[0].clientY;
    touchCurrentRef.current = { x: curX, y: curY };

    const dx = curX - touchStartRef.current.x;
    const dy = curY - touchStartRef.current.y;

    if (Math.abs(dx) > Math.abs(dy)) {
      let offset = dx;
      if ((currentIndex === 0 && dx > 0) || (currentIndex === totalCount - 1 && dx < 0)) {
        offset = dx * 0.35;
      }
      setDragX(offset);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    setIsDragging(false);
    if (!touchStartRef.current) return;

    const endX = (e.changedTouches && e.changedTouches.length > 0)
      ? e.changedTouches[0].clientX
      : touchCurrentRef.current?.x;
    const endY = (e.changedTouches && e.changedTouches.length > 0)
      ? e.changedTouches[0].clientY
      : touchCurrentRef.current?.y;

    if (endX === undefined || endY === undefined) {
      setDragX(0);
      return;
    }

    const deltaX = endX - touchStartRef.current.x;
    const deltaY = endY - touchStartRef.current.y;
    const now = Date.now();
    touchStartRef.current = null;
    touchCurrentRef.current = null;

    // Check double tap (two taps within 300ms with minimal travel)
    if (Math.abs(deltaX) < 15 && Math.abs(deltaY) < 15) {
      if (now - lastTapTimeRef.current < 300) {
        lastTapTimeRef.current = 0;
        handleTriageAction('backup_keep');
        setDragX(0);
        return;
      }
      lastTapTimeRef.current = now;
    }

    // Vertical dominant flick gestures:
    // Swipe down (dy > 55) -> Trash
    // Swipe up (dy < -55) -> HD Only
    if (Math.abs(deltaY) > 55 && Math.abs(deltaY) > Math.abs(deltaX) * 1.3) {
      if (deltaY > 55) {
        handleTriageAction('trash');
      } else if (deltaY < -55) {
        handleTriageAction('backup_only');
      }
      setDragX(0);
      return;
    }

    // Horizontal dominant carousel swipe:
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
      if (deltaX < -50 && currentIndex < totalCount - 1) {
        if (onNext) onNext();
      } else if (deltaX > 50 && currentIndex > 0) {
        if (onPrevious) onPrevious();
      }
    }

    setDragX(0);
  };

  // Mouse Drag Handlers for Desktop Browsing
  const handleMouseDown = (e: React.MouseEvent) => {
    isMouseDownRef.current = true;
    mouseStartRef.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isMouseDownRef.current || !mouseStartRef.current) return;
    const dx = e.clientX - mouseStartRef.current.x;
    const dy = e.clientY - mouseStartRef.current.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      let offset = dx;
      if ((currentIndex === 0 && dx > 0) || (currentIndex === totalCount - 1 && dx < 0)) {
        offset = dx * 0.35;
      }
      setDragX(offset);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isMouseDownRef.current || !mouseStartRef.current) return;
    isMouseDownRef.current = false;
    setIsDragging(false);

    const dx = e.clientX - mouseStartRef.current.x;
    const dy = e.clientY - mouseStartRef.current.y;
    mouseStartRef.current = null;

    if (Math.abs(dy) > 55 && Math.abs(dy) > Math.abs(dx) * 1.3) {
      if (dy > 55) {
        handleTriageAction('trash');
      } else if (dy < -55) {
        handleTriageAction('backup_only');
      }
      setDragX(0);
      return;
    }

    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      if (dx < -50 && currentIndex < totalCount - 1) {
        if (onNext) onNext();
      } else if (dx > 50 && currentIndex > 0) {
        if (onPrevious) onPrevious();
      }
    }

    setDragX(0);
  };

  const displayDecision = feedbackStatus;

  return (
    <div
      className="relative flex flex-col w-full max-w-4xl mx-auto bg-black text-slate-100 rounded-2xl overflow-hidden shadow-2xl border border-slate-700 select-none"
      style={{ touchAction: 'pan-y' }}
    >
      <style>{`
        @keyframes igPop {
          0% { transform: scale(0.3); opacity: 0; }
          45% { transform: scale(1.22); opacity: 1; }
          75% { transform: scale(1.0); opacity: 1; }
          100% { transform: scale(0.96); opacity: 0; }
        }
      `}</style>

      {/* NATIVE APPLE TOP NAVIGATION BAR */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-black/60 backdrop-blur-md border-b border-slate-700/80 z-20 font-sans">
        {/* Left: Back to Photos / Grid */}
        <button
          onClick={onBackToGrid}
          className="flex items-center gap-1 text-sky-400 hover:text-sky-300 active:opacity-70 transition-opacity text-xs font-medium"
          title="Back to All Photos"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
          </svg>
          <span>Photos</span>
        </button>

        {/* Center: Captured Date, Counter, and Destination */}
        <div className="flex flex-col items-center text-center">
          <span className="text-xs font-semibold text-white tracking-tight">
            {formatCapturedDate(bundle.capturedAt)}
          </span>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
            <span>
              [{currentIndex + 1}/{totalCount}]
            </span>
            <span>&bull;</span>
            <span>{bundle.canonicalName}</span>
            <span>&bull;</span>
            <span>{bundle.targetYear}/{bundle.targetMonth}</span>
          </div>
        </div>

        {/* Right: Top-Right Decision Badge, Undo & Info */}
        <div className="flex items-center gap-2">
          {/* Persistent Top-Right Decision Badge */}
          <div
            data-testid="top-right-decision-badge"
            className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider font-mono shadow-sm backdrop-blur-md border transition-all ${
              bundle.decision === 'trash'
                ? 'bg-red-950/80 border-red-700/60 text-red-300'
                : bundle.decision === 'backup_only'
                ? 'bg-sky-950/80 border-sky-700/60 text-sky-300'
                : bundle.decision === 'backup_keep'
                ? 'bg-emerald-950/80 border-emerald-700/60 text-emerald-300'
                : 'bg-white/10 border-white/15 text-white/50'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                bundle.decision === 'trash'
                  ? 'bg-red-400'
                  : bundle.decision === 'backup_only'
                  ? 'bg-sky-400'
                  : bundle.decision === 'backup_keep'
                  ? 'bg-emerald-400'
                  : 'bg-white/40'
              }`}
            />
            <span>
              {bundle.decision === 'trash'
                ? 'TRASH'
                : bundle.decision === 'backup_only'
                ? 'HD ONLY'
                : bundle.decision === 'backup_keep'
                ? 'KEEP'
                : 'UNSORTED'}
            </span>
          </div>

          {onUndo && (
            <button
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo last triage (U)"
              className="flex items-center gap-1 px-2 py-1 rounded bg-white/10 hover:bg-white/20 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed text-xs text-white transition-all font-mono"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a5 5 0 015 5v2m-15-7l4-4m-4 4l4 4" />
              </svg>
              <span>Undo</span>
            </button>
          )}

          <button
            onClick={() => setIsDetailsOpen(true)}
            title="Photo Details & EXIF (I)"
            className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 flex items-center justify-center text-sky-400 hover:text-sky-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>
      </header>

      {/* FULL-BLEED PHOTO VIEWPORT WITH INTERACTIVE CAROUSEL TRACK */}
      <div
        data-testid="carousel-viewport"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={() => handleTriageAction('backup_keep')}
        className="relative flex-1 flex items-center justify-center bg-black min-h-[380px] max-h-[60vh] overflow-hidden cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: 'pan-y' }}
      >
        {/* Instagram-Style Spring Popover Overlay */}
        {popDecision && (
          <div
            data-testid="ig-pop-overlay"
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
          >
            <div
              style={{ animation: 'igPop 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards' }}
              className={`flex flex-col items-center justify-center w-28 h-28 rounded-full shadow-2xl backdrop-blur-md border ${
                popDecision === 'backup_keep'
                  ? 'bg-emerald-600/90 border-emerald-400 text-white shadow-emerald-900/50'
                  : popDecision === 'trash'
                  ? 'bg-red-600/90 border-red-400 text-white shadow-red-900/50'
                  : 'bg-sky-600/90 border-sky-400 text-white shadow-sky-900/50'
              }`}
            >
              {popDecision === 'backup_keep' && (
                <>
                  <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
                  </svg>
                  <span className="text-[10px] font-bold uppercase tracking-wider mt-1">Keep</span>
                </>
              )}
              {popDecision === 'trash' && (
                <>
                  <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <span className="text-[10px] font-bold uppercase tracking-wider mt-1">Trash</span>
                </>
              )}
              {popDecision === 'backup_only' && (
                <>
                  <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span className="text-[10px] font-bold uppercase tracking-wider mt-1">HD Only</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Transient Apple-style Status Banner (top-center) */}
        {displayDecision && (
          <div
            data-testid="status-banner"
            className={`absolute top-4 left-1/2 -translate-x-1/2 px-3.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider shadow-lg backdrop-blur-md transition-all duration-200 z-10 ${
              displayDecision === 'trash'
                ? 'bg-red-950/80 text-red-300 border border-red-700/60'
                : displayDecision === 'backup_only'
                ? 'bg-sky-950/80 text-sky-300 border border-sky-700/60'
                : 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/60'
            }`}
          >
            {displayDecision === 'trash'
              ? 'Trash (Delete from Phone)'
              : displayDecision === 'backup_only'
              ? 'HD Only (Offload)'
              : 'Keep on Phone & HD'}
          </div>
        )}

        {/* Continuous Sliding Carousel Track (3-Slot Balanced Window) */}
        <div
          data-testid="carousel-track"
          className="flex w-full h-full items-center"
          style={{
            transform: `translateX(calc(-100% + ${dragX}px))`,
            transition: isDragging ? 'none' : 'transform 280ms cubic-bezier(0.2, 0.9, 0.3, 1.0)',
          }}
        >
          {slides.map((slide) => {
            const item = slide.bundle;
            const isCenter = slide.slot === 0;

            return (
              <div
                key={slide.index >= 0 ? `slide-${slide.index}` : `empty-slot-${slide.slot}`}
                data-testid={slide.index >= 0 ? `carousel-slide-${slide.index}` : undefined}
                className="relative flex-shrink-0 w-full h-full flex items-center justify-center overflow-hidden px-2"
                style={{ width: '100%' }}
              >
                {item ? (
                  <>
                    {/* Companion Badges (top-left of active photo) */}
                    {isCenter && (
                      <div className="absolute top-3 left-3 flex flex-wrap gap-1.5 z-10 font-mono text-[10px] pointer-events-none">
                        {item.files.some((f) => f.role === 'live_video') && (
                          <span className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-600/70 text-emerald-300 font-bold tracking-wider">
                            LIVE
                          </span>
                        )}
                        {item.files.some((f) => f.role === 'edited_render' || f.role === 'edit_sidecar') && (
                          <span className="px-2 py-0.5 rounded bg-amber-950/80 border border-amber-600/70 text-amber-300 font-bold tracking-wider">
                            EDIT
                          </span>
                        )}
                        {item.files.some((f) => f.role === 'primary' && ['.mov', '.mp4', '.m4v'].includes(f.ext.toLowerCase())) && (
                          <span className="px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-600/70 text-cyan-300 font-bold tracking-wider">
                            VIDEO
                          </span>
                        )}
                        {!item.dateReliable && (
                          <span className="px-2 py-0.5 rounded bg-yellow-950/80 border border-yellow-600/70 text-yellow-300 font-bold tracking-wider">
                            NO EXIF
                          </span>
                        )}
                      </div>
                    )}

                    {/* Media Preview: video controls enabled on active slide */}
                    {item.files.some((f) => f.role === 'primary' && ['.mov', '.mp4', '.m4v'].includes(f.ext.toLowerCase())) &&
                    ['.mov', '.mp4', '.m4v'].some((ext) => item.previewPath.toLowerCase().endsWith(ext)) ? (
                      <video
                        src={item.previewPath}
                        controls={isCenter}
                        playsInline
                        className={`max-h-[58vh] max-w-full object-contain ${isCenter ? 'pointer-events-auto' : 'pointer-events-none'}`}
                        onDragStart={(e) => e.preventDefault()}
                      />
                    ) : (
                      <img
                        src={item.previewPath}
                        alt={item.canonicalName}
                        className="max-h-[58vh] max-w-full object-contain pointer-events-none"
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = 'none';
                        }}
                      />
                    )}
                  </>
                ) : (
                  <div className="w-full h-full" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* HORIZONTAL FILMSTRIP SCRUBBER */}
      <FilmstripScrubber
        bundles={bundles && bundles.length > 0 ? bundles : [bundle]}
        currentIndex={currentIndex}
        onSelectIndex={(idx) => {
          if (onSelectIndex) {
            onSelectIndex(idx);
          } else if (idx < currentIndex && onPrevious) {
            onPrevious();
          } else if (idx > currentIndex && onNext) {
            onNext();
          }
        }}
      />

      {/* NATIVE APPLE BOTTOM ACTION TOOLBAR */}
      <footer className="flex items-center justify-between px-6 py-3 bg-black/70 backdrop-blur-md border-t border-slate-700/80 z-20 font-sans">
        {/* Previous Photo */}
        <button
          onClick={onPrevious}
          disabled={currentIndex <= 0}
          className="flex flex-col items-center gap-0.5 text-white/80 hover:text-white active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          title="Previous Photo (←)"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
          <span className="text-[10px] font-medium tracking-tight">Prev</span>
        </button>

        {/* Action: Trash */}
        <button
          onClick={() => handleTriageAction('trash')}
          aria-label="Trash"
          className="flex flex-col items-center gap-1 text-red-400 hover:text-red-300 active:scale-90 transition-all group"
          title="Delete from iPhone [1]"
        >
          <div className="w-10 h-10 rounded-full bg-red-500/15 group-hover:bg-red-500/25 flex items-center justify-center transition-colors">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <span className="text-[10px] font-medium">Trash</span>
        </button>

        {/* Action: HD Only */}
        <button
          onClick={() => handleTriageAction('backup_only')}
          aria-label="HD Only"
          className="flex flex-col items-center gap-1 text-sky-400 hover:text-sky-300 active:scale-90 transition-all group"
          title="Save HD & Delete Phone [2]"
        >
          <div className="w-10 h-10 rounded-full bg-sky-500/15 group-hover:bg-sky-500/25 flex items-center justify-center transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
          <span className="text-[10px] font-medium">HD Only</span>
        </button>

        {/* Action: Keep on Phone & HD */}
        <button
          onClick={() => handleTriageAction('backup_keep')}
          aria-label="Keep (HD + Phone)"
          className="flex flex-col items-center gap-1 text-emerald-400 hover:text-emerald-300 active:scale-90 transition-all group"
          title="Save HD & Keep Phone [3]"
        >
          <div className="w-10 h-10 rounded-full bg-emerald-500/15 group-hover:bg-emerald-500/25 flex items-center justify-center transition-colors">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
            </svg>
          </div>
          <span className="text-[10px] font-medium">Keep</span>
        </button>

        {/* Next Photo */}
        <button
          onClick={onNext}
          disabled={currentIndex >= totalCount - 1}
          className="flex flex-col items-center gap-0.5 text-white/80 hover:text-white active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          title="Next Photo (→)"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-[10px] font-medium tracking-tight">Next</span>
        </button>
      </footer>

      {/* APPLE EXIF & BACKUP DETAILS SHEET */}
      <PhotoDetailsSheet
        bundle={bundle}
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
      />
    </div>
  );
};
