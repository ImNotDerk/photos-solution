import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { SessionState } from '../../types/index.js';

export interface DesktopStatusProps {
  sessionState: SessionState;
  onRefreshScan: () => void;
  onRunBackup: () => void;
  isBackingUp?: boolean;
  serverUrl?: string;
  activityLogs?: string[];
}

export const DesktopStatus: React.FC<DesktopStatusProps> = ({
  sessionState,
  onRefreshScan,
  onRunBackup,
  isBackingUp = false,
  serverUrl,
  activityLogs,
}) => {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  const displayUrl = serverUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173');

  useEffect(() => {
    if (displayUrl) {
      QRCode.toDataURL(displayUrl, {
        margin: 1,
        color: {
          dark: '#020617', // slate-950
          light: '#f8fafc', // slate-50
        },
      })
        .then((url) => setQrCodeDataUrl(url))
        .catch(() => setQrCodeDataUrl(''));
    }
  }, [displayUrl]);

  const handleCopyUrl = () => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(displayUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isMounted = !!sessionState.hardDriveMounted;
  const isReadyForBackup = isMounted && !isBackingUp && sessionState.counts.unsorted === 0;

  const defaultLogs = [
    `[${new Date().toISOString().slice(11, 19)}] STAGING: Found ${sessionState.bundles.length} asset bundle(s) in ${sessionState.stagingDir || 'staging directory'}`,
    `[${new Date().toISOString().slice(11, 19)}] STORAGE: Hard drive ${sessionState.hardDriveRoot || 'root'} is ${isMounted ? '[OK] MOUNTED & WRITABLE' : '[DISCONNECTED] AWAITING MOUNT'}`,
    `[${new Date().toISOString().slice(11, 19)}] LEDGER: Loaded ${sessionState.counts.alreadyBackedUp} duplicate records from .photo-triage-ledger.json`,
    `[${new Date().toISOString().slice(11, 19)}] TRIAGE: ${sessionState.counts.total - sessionState.counts.unsorted}/${sessionState.counts.total} items triaged (${sessionState.counts.backup_only} HD only, ${sessionState.counts.backup_keep} keep phone, ${sessionState.counts.trash} trash)`,
    `[${new Date().toISOString().slice(11, 19)}] NETWORK: Web UI serving on ${displayUrl}`,
    sessionState.isBackupVerified
      ? `[${new Date().toISOString().slice(11, 19)}] VERIFICATION: [OK] 100% Cryptographic verification completed. Ready for cleanup.`
      : `[${new Date().toISOString().slice(11, 19)}] STATUS: Session status "${sessionState.status || 'triaging'}"`,
  ];

  const displayedLogs = activityLogs && activityLogs.length > 0 ? activityLogs : defaultLogs;

  return (
    <div className="flex flex-col w-full max-w-4xl mx-auto border border-slate-700 bg-slate-900 text-slate-100 font-mono">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-950">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Desktop Control &amp; Storage Monitor
          </span>
          <span className="block text-[11px] text-slate-400">
            Session ID: {sessionState.sessionId || 'active'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400 uppercase">Hard Drive:</span>
          <span
            className={`px-2 py-0.5 border text-xs font-bold uppercase ${
              isMounted
                ? 'border-emerald-600 bg-emerald-950 text-emerald-300'
                : 'border-red-600 bg-red-950 text-red-300'
            }`}
          >
            {isMounted ? 'MOUNTED' : 'DISCONNECTED'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border-b border-slate-700">
        {/* Mobile Connection / QR Code */}
        <div className="p-3 border border-slate-700 bg-slate-950 flex flex-col items-center justify-center text-center">
          <span className="text-xs font-bold uppercase text-slate-300 mb-2">
            Mobile Safari Connection
          </span>
          {qrCodeDataUrl ? (
            <img
              src={qrCodeDataUrl}
              alt="QR Code for mobile connection"
              className="w-36 h-36 border border-slate-600 p-1 bg-white mb-2"
            />
          ) : (
            <div className="w-36 h-36 border border-slate-700 bg-slate-900 flex items-center justify-center text-[10px] text-slate-500 mb-2">
              QR Code
            </div>
          )}
          <div className="flex items-center gap-2 max-w-full">
            <span className="text-xs text-sky-400 truncate font-semibold">{displayUrl}</span>
            <button
              onClick={handleCopyUrl}
              className="px-2 py-0.5 border border-slate-700 bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 uppercase"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-[10px] text-slate-500 mt-2">
            Connect iPhone to same Wi-Fi and open URL in Mobile Safari for 1-by-1 tactile triage.
          </p>
        </div>

        {/* Storage Paths & Controls */}
        <div className="flex flex-col justify-between gap-3 p-3 border border-slate-700 bg-slate-950 text-xs">
          <div className="space-y-2">
            <div>
              <span className="text-slate-500 block text-[10px] uppercase">Staging Directory</span>
              <span className="text-slate-200 break-all select-all">{sessionState.stagingDir || 'Not specified'}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase">External Hard Drive Root</span>
              <span className="text-slate-200 break-all select-all">{sessionState.hardDriveRoot || 'Not specified'}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase">Status</span>
              <span className="text-slate-300 font-bold uppercase tracking-wider">{sessionState.status || 'triaging'}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-2 border-t border-slate-800">
            <button
              onClick={onRefreshScan}
              className="py-2 px-3 border border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold uppercase tracking-wider text-xs transition-colors"
            >
              Import AirDrop / Scan
            </button>

            <button
              onClick={onRunBackup}
              disabled={!isMounted || isBackingUp}
              className="py-2.5 px-3 border border-emerald-600 bg-emerald-950 hover:bg-emerald-900 active:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed text-emerald-200 font-bold uppercase tracking-wider text-xs transition-colors"
            >
              {isBackingUp ? 'Backing Up & Verifying...' : 'Run Verified Backup'}
            </button>
          </div>
        </div>
      </div>

      {/* Triage Summary Metrics */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 p-3 bg-slate-950 text-center text-xs">
        <div className="p-2 border border-slate-800">
          <span className="text-slate-500 block text-[9px] uppercase">Total</span>
          <span className="font-bold text-slate-100">{sessionState.counts.total}</span>
        </div>
        <div className="p-2 border border-slate-800">
          <span className="text-slate-500 block text-[9px] uppercase">Unsorted</span>
          <span className="font-bold text-amber-400">{sessionState.counts.unsorted}</span>
        </div>
        <div className="p-2 border border-slate-800">
          <span className="text-slate-500 block text-[9px] uppercase">Trash</span>
          <span className="font-bold text-red-400">{sessionState.counts.trash}</span>
        </div>
        <div className="p-2 border border-slate-800">
          <span className="text-slate-500 block text-[9px] uppercase">HD Only</span>
          <span className="font-bold text-sky-400">{sessionState.counts.backup_only}</span>
        </div>
        <div className="p-2 border border-slate-800">
          <span className="text-slate-500 block text-[9px] uppercase">HD+Phone</span>
          <span className="font-bold text-emerald-400">{sessionState.counts.backup_keep}</span>
        </div>
        <div className="p-2 border border-slate-800">
          <span className="text-slate-500 block text-[9px] uppercase">Backed Up</span>
          <span className="font-bold text-purple-400">{sessionState.counts.alreadyBackedUp}</span>
        </div>
      </div>

      {/* Live Activity Stream / Verification Log */}
      <div className="border-t border-slate-700 bg-slate-950 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Live Activity Stream // Verification Log
            </span>
          </div>
          <span className="text-[10px] text-slate-500 uppercase">stdout/audit</span>
        </div>

        <div className="border border-slate-800 bg-black/90 p-2.5 max-h-44 overflow-y-auto space-y-1 text-[11px] font-mono text-slate-300">
          {displayedLogs.map((log, idx) => {
            const isOk = log.includes('[OK]') || log.includes('VERIF') || log.includes('SUCCESS');
            const isWarn = log.includes('[DISCONNECTED]') || log.includes('FAIL') || log.includes('ERR');
            return (
              <div key={idx} className="flex items-start gap-2 leading-relaxed">
                <span className="text-slate-600 select-none text-[10px]">{`>`}</span>
                <span
                  className={
                    isOk
                      ? 'text-emerald-400'
                      : isWarn
                      ? 'text-amber-400'
                      : 'text-slate-300'
                  }
                >
                  {log}
                </span>
              </div>
            );
          })}
          <div className="flex items-center gap-1 text-slate-600 text-[10px]">
            <span>_</span>
          </div>
        </div>
      </div>
    </div>
  );
};
