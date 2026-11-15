/**
 * Core domain types for iPhone Photo Triage & Verified Backup system
 */

export type TriageDecision = 'unsorted' | 'trash' | 'backup_only' | 'backup_keep';

export type AssetFileRole = 'primary' | 'live_video' | 'edit_sidecar' | 'edited_render';

export interface AssetFile {
  path: string;
  filename: string;
  ext: string;
  size: number;
  role: AssetFileRole;
}

export interface AssetBundle {
  id: string;
  canonicalName: string;
  files: AssetFile[];
  previewPath: string;
  capturedAt: string;
  targetYear: string;
  targetMonth: string;
  dateReliable: boolean;
  decision: TriageDecision;
  alreadyBackedUp: boolean;
}

export interface LedgerEntry {
  id: string;
  canonicalName: string;
  sha256: string;
  targetRelPath: string;
  capturedAt: string;
  backedUpAt: string;
  decision: 'backup_only' | 'backup_keep';
}

export type LedgerMap = Map<string, LedgerEntry>;

export interface TriageCounts {
  total: number;
  unsorted: number;
  trash: number;
  backup_only: number;
  backup_keep: number;
  alreadyBackedUp: number;
}

export type SessionStatus = 'staging' | 'triaging' | 'backing_up' | 'backed_up' | 'cleanup_ready' | 'completed';

export interface SessionState {
  sessionId?: string;
  stagingDir: string;
  hardDriveRoot: string;
  bundles: AssetBundle[];
  counts: TriageCounts;
  status?: SessionStatus;
  isBackupVerified?: boolean;
}

export interface ManualDeleteItem {
  id: string;
  canonicalName: string;
  previewPath: string;
  reason: 'keep_collision' | 'unreliable_date' | string;
  capturedAt?: string;
  bundle?: AssetBundle;
}

export interface CleanupBatchResponse {
  minDate: string;
  maxDate: string;
  deleteNamesDelimited: string;
  deleteCount: number;
  manualDeleteItems: Array<AssetBundle | ManualDeleteItem>;
  totalCandidates?: number;
}

export interface BackupResult {
  success: boolean;
  copiedCount: number;
  verifiedCount: number;
  failedFiles?: string[];
  errors?: string[];
}

export interface TriageUpdateRequest {
  bundleId?: string;
  bundleIds?: string[];
  decision: TriageDecision;
}

export interface BackupRequest {
  hardDriveRoot?: string;
  stagingDir?: string;
  bundleIds?: string[];
}

export type SortFilter = 'all' | 'unsorted' | 'trash' | 'backup_only' | 'backup_keep' | 'alreadyBackedUp';

export type ViewMode = 'single' | 'grid' | 'cleanup';
