import React from 'react';
import type { AssetBundle, SortFilter, TriageCounts, TriageDecision } from '../../types/index.js';
import { formatBytes } from './SingleView.js';

export interface GridViewProps {
  bundles: AssetBundle[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBatchDecision: (ids: string[], decision: TriageDecision) => void;
  onSelectBundle: (bundle: AssetBundle, index: number) => void;
  activeFilter: SortFilter;
  onFilterChange: (filter: SortFilter) => void;
  counts: TriageCounts;
}

export const GridView: React.FC<GridViewProps> = ({
  bundles,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onBatchDecision,
  onSelectBundle,
  activeFilter,
  onFilterChange,
  counts,
}) => {
  // Filter items
  const filteredBundles = bundles.filter((bundle) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'alreadyBackedUp') return bundle.alreadyBackedUp;
    return bundle.decision === activeFilter;
  });

  const selectedArray = Array.from(selectedIds);
  const isAllSelected = filteredBundles.length > 0 && filteredBundles.every((b) => selectedIds.has(b.id));

  return (
    <div className="flex flex-col w-full max-w-7xl mx-auto border border-slate-700 bg-slate-900 text-slate-100 font-mono">
      {/* Filter Tabs Bar */}
      <div className="flex flex-wrap items-center justify-between gap-1 p-2 border-b border-slate-700 bg-slate-950 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => onFilterChange('all')}
            className={`px-2.5 py-1 border transition-colors ${
              activeFilter === 'all'
                ? 'border-slate-400 bg-slate-800 text-slate-100 font-bold'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            All ({counts.total})
          </button>
          <button
            onClick={() => onFilterChange('unsorted')}
            className={`px-2.5 py-1 border transition-colors ${
              activeFilter === 'unsorted'
                ? 'border-amber-600 bg-amber-950/60 text-amber-200 font-bold'
                : 'border-slate-800 bg-slate-900 text-amber-400/80 hover:text-amber-300'
            }`}
          >
            Unsorted ({counts.unsorted})
          </button>
          <button
            onClick={() => onFilterChange('trash')}
            className={`px-2.5 py-1 border transition-colors ${
              activeFilter === 'trash'
                ? 'border-red-600 bg-red-950/60 text-red-200 font-bold'
                : 'border-slate-800 bg-slate-900 text-red-400/80 hover:text-red-300'
            }`}
          >
            Trash ({counts.trash})
          </button>
          <button
            onClick={() => onFilterChange('backup_only')}
            className={`px-2.5 py-1 border transition-colors ${
              activeFilter === 'backup_only'
                ? 'border-sky-600 bg-sky-950/60 text-sky-200 font-bold'
                : 'border-slate-800 bg-slate-900 text-sky-400/80 hover:text-sky-300'
            }`}
          >
            HD Only ({counts.backup_only})
          </button>
          <button
            onClick={() => onFilterChange('backup_keep')}
            className={`px-2.5 py-1 border transition-colors ${
              activeFilter === 'backup_keep'
                ? 'border-emerald-600 bg-emerald-950/60 text-emerald-200 font-bold'
                : 'border-slate-800 bg-slate-900 text-emerald-400/80 hover:text-emerald-300'
            }`}
          >
            HD + Phone ({counts.backup_keep})
          </button>
          <button
            onClick={() => onFilterChange('alreadyBackedUp')}
            className={`px-2.5 py-1 border transition-colors ${
              activeFilter === 'alreadyBackedUp'
                ? 'border-purple-600 bg-purple-950/60 text-purple-200 font-bold'
                : 'border-slate-800 bg-slate-900 text-purple-400/80 hover:text-purple-300'
            }`}
          >
            Backed Up ({counts.alreadyBackedUp})
          </button>
        </div>

        {/* Global Select Buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={isAllSelected ? onDeselectAll : onSelectAll}
            className="px-2.5 py-1 border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
          >
            {isAllSelected ? 'Deselect All' : 'Select All'}
          </button>
        </div>
      </div>

      {/* Batch Action Floating / Fixed Toolbar */}
      {selectedArray.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-sky-800 bg-sky-950/90 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sky-200">
              {selectedArray.length} selected
            </span>
            <button
              onClick={onDeselectAll}
              className="text-[11px] underline text-sky-400 hover:text-sky-200"
            >
              Clear
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onBatchDecision(selectedArray, 'trash')}
              className="px-2 py-1 border border-red-700 bg-red-950 text-red-200 hover:bg-red-900 active:bg-red-800 font-semibold uppercase text-[11px]"
            >
              Set Trash
            </button>
            <button
              onClick={() => onBatchDecision(selectedArray, 'backup_only')}
              className="px-2 py-1 border border-sky-700 bg-sky-950 text-sky-200 hover:bg-sky-900 active:bg-sky-800 font-semibold uppercase text-[11px]"
            >
              Set HD Only
            </button>
            <button
              onClick={() => onBatchDecision(selectedArray, 'backup_keep')}
              className="px-2 py-1 border border-emerald-700 bg-emerald-950 text-emerald-200 hover:bg-emerald-900 active:bg-emerald-800 font-semibold uppercase text-[11px]"
            >
              Set HD + Phone
            </button>
          </div>
        </div>
      )}

      {/* Grid Container */}
      <div className="p-3 min-h-[400px]">
        {filteredBundles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <span className="text-sm font-semibold uppercase">No items in this filter</span>
            <p className="text-xs text-slate-600 mt-1">Select another filter tab or import new photos.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {filteredBundles.map((bundle) => {
              const isSelected = selectedIds.has(bundle.id);
              const totalBytes = bundle.files.reduce((acc, f) => acc + (f.size || 0), 0);
              const originalIndex = bundles.findIndex((b) => b.id === bundle.id);

              const hasLive = bundle.files.some((f) => f.role === 'live_video');
              const hasEdit = bundle.files.some((f) => f.role === 'edited_render' || f.role === 'edit_sidecar');

              return (
                <div
                  key={bundle.id}
                  className={`relative flex flex-col border transition-all ${
                    isSelected
                      ? 'border-sky-500 ring-1 ring-sky-500 bg-sky-950/20'
                      : 'border-slate-700 bg-slate-950 hover:border-slate-500'
                  }`}
                >
                  {/* Thumbnail area */}
                  <div
                    onClick={() => onSelectBundle(bundle, originalIndex)}
                    className="relative w-full aspect-square bg-slate-900 flex items-center justify-center overflow-hidden cursor-pointer"
                  >
                    <img
                      src={bundle.previewPath}
                      alt={bundle.canonicalName}
                      className="w-full h-full object-cover pointer-events-none"
                      onError={(e) => {
                        (e.currentTarget as HTMLElement).style.display = 'none';
                      }}
                    />

                    {/* Companion tags */}
                    <div className="absolute top-1 left-1 flex flex-col gap-0.5">
                      {hasLive && (
                        <span className="px-1 py-0.2 border border-emerald-600 bg-emerald-950/90 text-emerald-300 text-[9px] font-bold">
                          LIVE
                        </span>
                      )}
                      {hasEdit && (
                        <span className="px-1 py-0.2 border border-amber-600 bg-amber-950/90 text-amber-300 text-[9px] font-bold">
                          EDIT
                        </span>
                      )}
                    </div>

                    {/* Decision Tag (top-right) */}
                    <div className="absolute top-1 right-1">
                      <span
                        className={`px-1 py-0.2 border text-[9px] font-bold uppercase ${
                          bundle.decision === 'trash'
                            ? 'border-red-600 bg-red-950/90 text-red-300'
                            : bundle.decision === 'backup_only'
                            ? 'border-sky-600 bg-sky-950/90 text-sky-300'
                            : bundle.decision === 'backup_keep'
                            ? 'border-emerald-600 bg-emerald-950/90 text-emerald-300'
                            : 'border-amber-600 bg-amber-950/90 text-amber-400'
                        }`}
                      >
                        {bundle.decision === 'backup_only'
                          ? 'HD'
                          : bundle.decision === 'backup_keep'
                          ? 'KEEP'
                          : bundle.decision}
                      </span>
                    </div>
                  </div>

                  {/* Metadata and Selection footer */}
                  <div className="flex items-center justify-between p-1.5 border-t border-slate-800 bg-slate-900 text-[11px]">
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(bundle.id)}
                        className="rounded-none border-slate-700 bg-slate-800 text-sky-500 focus:ring-0 cursor-pointer"
                        title="Toggle selection"
                      />
                      <span
                        onClick={() => onSelectBundle(bundle, originalIndex)}
                        className="font-bold text-slate-200 truncate cursor-pointer hover:underline"
                      >
                        {bundle.canonicalName}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 whitespace-nowrap">
                      {formatBytes(totalBytes)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
