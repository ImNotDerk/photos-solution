import type {
  AssetBundle,
  CleanupBatchResponse,
  LedgerEntry,
  ManualDeleteItem,
} from '../types/index.js';

/**
 * Generates the cleanup payload for the iOS Shortcut and manual review UI.
 *
 * Requirements:
 * 1. minDate and maxDate: compute earliest and latest capturedAt among delete candidates
 *    ('trash' and 'backup_only'), padded by ±24 hours (ISO string).
 *    If no candidates exist, defaults to current timestamp.
 * 2. deleteNamesDelimited: pipe-delimited format (e.g. |IMG_1001|IMG_1002|).
 * 3. Safety filter for manualDeleteItems:
 *    - Candidates whose canonical name collides with a backup_keep photo in the ledger
 *      or current session must be flagged with reason: 'keep_collision'.
 *    - Candidates where dateReliable === false must be flagged with reason: 'unreliable_date'.
 *    - Flagged items MUST NOT be included in deleteNamesDelimited.
 *    - backup_keep items MUST NEVER be in deleteNamesDelimited or manualDeleteItems.
 */
export function generateCleanupPayload(
  bundles: AssetBundle[],
  ledger?: Map<string, LedgerEntry>
): CleanupBatchResponse {
  // 1. Identify delete candidates: bundles marked 'trash' or 'backup_only'
  const deleteCandidates = bundles.filter(
    (b) => b.decision === 'trash' || b.decision === 'backup_only'
  );

  // 2. Compute minDate and maxDate among delete candidates with ±24h padding
  let minDate: string;
  let maxDate: string;

  if (deleteCandidates.length === 0) {
    const now = new Date().toISOString();
    minDate = now;
    maxDate = now;
  } else {
    const timestamps = deleteCandidates
      .map((b) => (b.capturedAt ? new Date(b.capturedAt).getTime() : NaN))
      .filter((t) => !isNaN(t));

    if (timestamps.length === 0) {
      const now = new Date().toISOString();
      minDate = now;
      maxDate = now;
    } else {
      const minMs = Math.min(...timestamps);
      const maxMs = Math.max(...timestamps);
      const PADDING_MS = 24 * 60 * 60 * 1000;
      minDate = new Date(minMs - PADDING_MS).toISOString();
      maxDate = new Date(maxMs + PADDING_MS).toISOString();
    }
  }

  // 3. Build set of canonical names for photos designated backup_keep
  //    From both current session and the ledger
  const keepCanonicalNames = new Set<string>();

  // Check ledger entries
  if (ledger && typeof ledger.values === 'function') {
    for (const entry of ledger.values()) {
      if (entry.decision === 'backup_keep' && entry.canonicalName) {
        keepCanonicalNames.add(entry.canonicalName.toUpperCase());
        // Also strip any numeric collision suffix to protect base canonical name
        const stripped = entry.canonicalName.replace(/_\d+$/, '').toUpperCase();
        keepCanonicalNames.add(stripped);
      }
    }
  }

  // Check current session bundles
  for (const bundle of bundles) {
    if (bundle.decision === 'backup_keep' && bundle.canonicalName) {
      keepCanonicalNames.add(bundle.canonicalName.toUpperCase());
      const stripped = bundle.canonicalName.replace(/_\d+$/, '').toUpperCase();
      keepCanonicalNames.add(stripped);
    }
  }

  // 4. Filter delete candidates into approved vs manualDeleteItems
  const approvedCandidates: AssetBundle[] = [];
  const manualDeleteItems: ManualDeleteItem[] = [];

  for (const candidate of deleteCandidates) {
    const canonicalUpper = candidate.canonicalName.toUpperCase();
    const isKeepCollision = keepCanonicalNames.has(canonicalUpper);

    if (isKeepCollision) {
      manualDeleteItems.push({
        id: candidate.id,
        canonicalName: candidate.canonicalName,
        previewPath: candidate.previewPath,
        reason: 'keep_collision',
        capturedAt: candidate.capturedAt,
        bundle: candidate,
      });
    } else if (!candidate.dateReliable) {
      manualDeleteItems.push({
        id: candidate.id,
        canonicalName: candidate.canonicalName,
        previewPath: candidate.previewPath,
        reason: 'unreliable_date',
        capturedAt: candidate.capturedAt,
        bundle: candidate,
      });
    } else {
      approvedCandidates.push(candidate);
    }
  }

  // 5. Build pipe-delimited delete string (e.g. |IMG_1001|IMG_1002|)
  const deleteNamesDelimited =
    approvedCandidates.length > 0
      ? `|${approvedCandidates.map((c) => c.canonicalName).join('|')}|`
      : '';

  return {
    minDate,
    maxDate,
    deleteNamesDelimited,
    deleteCount: approvedCandidates.length,
    manualDeleteItems,
    totalCandidates: deleteCandidates.length,
  };
}
