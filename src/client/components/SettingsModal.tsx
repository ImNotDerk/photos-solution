import React, { useState, useEffect } from 'react';
import type { FolderPreset } from '../../server/config.js';

export interface PhotoTriageConfigData {
  hardDriveRoot: string;
  folderFormat: string;
  deviceName?: string;
}

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (config: PhotoTriageConfigData) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const [hardDriveRoot, setHardDriveRoot] = useState<string>('');
  const [folderFormat, setFolderFormat] = useState<string>('{YYYY}/{MONTH}');
  const [deviceName, setDeviceName] = useState<string>('iPhone');
  const [presets, setPresets] = useState<FolderPreset[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isPickingFolder, setIsPickingFolder] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsLoading(true);

    fetch('/api/config')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data.config) {
          setHardDriveRoot(data.config.hardDriveRoot || '');
          setFolderFormat(data.config.folderFormat || '{YYYY}/{MONTH}');
          setDeviceName(data.config.deviceName || 'iPhone');
        }
        if (data.presets) {
          setPresets(data.presets);
        }
      })
      .catch((err) => {
        setErrorMsg('Failed to load server configuration: ' + err.message);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePickFinder = async () => {
    setIsPickingFolder(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/choose-folder', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Finder dialog failed');
      }
      if (data.cancelled) {
        return;
      }
      if (data.path) {
        setHardDriveRoot(data.path);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsPickingFolder(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hardDriveRoot,
          folderFormat,
          deviceName,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save configuration');
      }

      setSuccessMsg('Settings saved successfully.');
      onSaved(data.config);
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Preview path resolution
  const now = new Date();
  const year = String(now.getFullYear());
  const monthNames = [
    'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'
  ];
  const monthName = monthNames[now.getMonth()];
  const monthNum = String(now.getMonth() + 1).padStart(2, '0');
  const cleanDevice = (deviceName || 'iPhone').replace(/[^a-zA-Z0-9_-]/g, '_');

  const previewSubdir = folderFormat
    .replace(/\{YYYY\}/g, year)
    .replace(/\{MONTH\}/g, monthName)
    .replace(/\{MM\}/g, monthNum)
    .replace(/\{DEVICE\}/g, cleanDevice);

  const previewFullPath = `${hardDriveRoot || '/Volumes/Media Drive'}/${previewSubdir}/IMG_0001.JPG`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono">
      <div className="w-full max-w-xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-950">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Backup Destination Settings
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-sm font-bold px-2 py-0.5 border border-slate-800 hover:border-slate-700"
          >
            Esc
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSave} className="p-4 flex flex-col gap-4 text-xs">
          {errorMsg && (
            <div className="p-2 border border-red-700 bg-red-950 text-red-200 text-[11px]">
              Error: {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="p-2 border border-emerald-700 bg-emerald-950 text-emerald-200 text-[11px]">
              {successMsg}
            </div>
          )}

          {/* Backup Folder Root */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-400 font-bold uppercase text-[10px]">
              Backup Destination Root
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={hardDriveRoot}
                onChange={(e) => setHardDriveRoot(e.target.value)}
                placeholder="/Volumes/Media Drive or ~/Pictures"
                className="flex-1 bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-sky-500 font-mono"
                required
              />
              <button
                type="button"
                onClick={handlePickFinder}
                disabled={isPickingFolder}
                className="px-3 py-1.5 border border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold uppercase tracking-wider text-[11px] whitespace-nowrap transition-colors"
              >
                {isPickingFolder ? 'Selecting...' : 'Browse in Finder...'}
              </button>
            </div>
            <span className="text-[10px] text-slate-500">
              Click &quot;Browse in Finder...&quot; to pick any external drive, internal folder, or NAS mount via native macOS Finder dialog.
            </span>
          </div>

          {/* Folder Hierarchy Preset */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-400 font-bold uppercase text-[10px]">
              Folder Hierarchy Preset
            </label>
            <select
              value={presets.some((p) => p.template === folderFormat) ? folderFormat : '{CUSTOM}'}
              onChange={(e) => {
                if (e.target.value === '{CUSTOM}') {
                  setFolderFormat('{DEVICE}/{YYYY}-{MM}');
                } else {
                  setFolderFormat(e.target.value);
                }
              }}
              className="bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-sky-500 font-mono"
            >
              {presets.map((preset) => (
                <option key={preset.id} value={preset.template}>
                  {preset.label} &mdash; ({preset.example})
                </option>
              ))}
              <option value="{CUSTOM}">Custom Template...</option>
            </select>
            {!presets.some((p) => p.template === folderFormat) && (
              <input
                type="text"
                value={folderFormat}
                placeholder="{DEVICE}/{YYYY}-{MM}"
                onChange={(e) => setFolderFormat(e.target.value)}
                className="mt-1 bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-sky-500 font-mono"
              />
            )}
            <span className="text-[10px] text-slate-500">
              Tokens available: &#123;YYYY&#125; (year), &#123;MONTH&#125; (name), &#123;MM&#125; (numeric), &#123;DEVICE&#125; (device label).
            </span>
          </div>

          {/* Device Label */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-400 font-bold uppercase text-[10px]">
              Device / Source Label
            </label>
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="iPhone"
              className="bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          {/* Live Preview Box */}
          <div className="p-3 border border-slate-800 bg-slate-950/60 flex flex-col gap-1">
            <span className="text-[10px] uppercase font-bold text-slate-400">
              Destination Example Preview
            </span>
            <div className="text-[11px] text-sky-400 break-all select-all font-mono">
              {previewFullPath}
            </div>
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold uppercase tracking-wider text-[11px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || isPickingFolder}
              className="px-4 py-1.5 border border-emerald-600 bg-emerald-950 hover:bg-emerald-900 active:bg-emerald-800 text-emerald-200 font-bold uppercase tracking-wider text-[11px] transition-colors"
            >
              {isLoading ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
