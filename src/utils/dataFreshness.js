/**
 * Data Freshness Module
 *
 * Computes confidence level and warnings based on inventory sync state.
 * OMEN speaks truth, or refuses to speak.
 *
 * CONFIDENCE LEVELS:
 * - high: Inventory synced < 6 hours ago, data is fresh
 * - medium: Synced 6-24 hours ago, data is aging
 * - low: Synced > 24 hours ago OR unknown, advisory only
 *
 * WARNINGS are MANDATORY when data is stale.
 * REFUSAL is REQUIRED when data cannot be trusted.
 */

/**
 * Compute data freshness state
 *
 * @param {string|null} inventoryLastSyncedAt - ISO-8601 timestamp or null
 * @returns {{ confidence: string, warnings: string[], shouldRefuse: boolean, freshnessState: object }}
 */
export function computeDataFreshness(inventoryLastSyncedAt) {
  const warnings = [];
  let confidence = 'low';
  let shouldRefuse = false;

  // NULL = ABSENCE OF DATA
  if (!inventoryLastSyncedAt) {
    warnings.push('Inventory has never been synced. Data cannot be trusted.');
    return {
      confidence: 'low',
      warnings,
      shouldRefuse: true,
      freshnessState: {
        status: 'unknown',
        inventoryLastSyncedAt: null,
        ageMs: null,
        ageHours: null,
        ageDays: null
      }
    };
  }

  const syncTime = new Date(inventoryLastSyncedAt);
  if (isNaN(syncTime.getTime())) {
    warnings.push('Inventory sync timestamp is invalid. Data cannot be trusted.');
    return {
      confidence: 'low',
      warnings,
      shouldRefuse: true,
      freshnessState: {
        status: 'invalid',
        inventoryLastSyncedAt,
        ageMs: null,
        ageHours: null,
        ageDays: null
      }
    };
  }

  const now = new Date();
  const ageMs = now - syncTime;
  const ageHours = ageMs / (1000 * 60 * 60);
  const ageDays = ageHours / 24;

  let status;

  if (ageHours < 6) {
    // FRESH: < 6 hours
    confidence = 'high';
    status = 'fresh';
  } else if (ageHours < 24) {
    // AGING: 6-24 hours
    confidence = 'medium';
    status = 'aging';
    warnings.push(`Inventory synced ${Math.round(ageHours)} hours ago. Counts may have drifted.`);
  } else {
    // STALE: > 24 hours
    confidence = 'low';
    status = 'stale';
    const daysAgo = Math.floor(ageDays);
    warnings.push(`Inventory hasn't been synced in ${daysAgo} day${daysAgo > 1 ? 's' : ''}. Counts are unreliable.`);

    // Refuse if > 48 hours
    if (ageHours > 48) {
      shouldRefuse = true;
      warnings.push('Data is too stale to provide reliable intelligence. Sync inventory first.');
    }
  }

  return {
    confidence,
    warnings,
    shouldRefuse,
    freshnessState: {
      status,
      inventoryLastSyncedAt,
      ageMs: Math.round(ageMs),
      ageHours: Math.round(ageHours * 10) / 10,
      ageDays: Math.round(ageDays * 10) / 10
    }
  };
}

/**
 * Format relative time for display
 *
 * @param {string|null} timestamp - ISO-8601 timestamp
 * @returns {string} Human-readable relative time
 */
export function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Never';

  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return 'Invalid';

  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

/**
 * Build OMEN response envelope with data freshness
 *
 * @param {string} answer - The response content
 * @param {string|null} inventoryLastSyncedAt - Last sync timestamp
 * @param {string[]} additionalWarnings - Extra warnings to include
 * @returns {object} Complete OMEN response envelope
 */
export function buildOMENResponse(answer, inventoryLastSyncedAt, additionalWarnings = []) {
  const freshness = computeDataFreshness(inventoryLastSyncedAt);

  // Merge warnings
  const allWarnings = [...freshness.warnings, ...additionalWarnings];

  // If should refuse, override answer
  const finalAnswer = freshness.shouldRefuse
    ? `I can't answer that confidently.\n\n${freshness.warnings[0]}\n\nSync inventory and try again.`
    : answer;

  return {
    answer: finalAnswer,
    confidence: freshness.confidence,
    data_freshness: {
      inventory_last_synced_at: inventoryLastSyncedAt
    },
    warnings: allWarnings,
    _meta: {
      freshnessState: freshness.freshnessState,
      refused: freshness.shouldRefuse
    }
  };
}

/**
 * Check if snapshot was generated after inventory sync
 *
 * @param {object} snapshot - Snapshot object with generatedAt
 * @param {string|null} inventoryLastSyncedAt - Last inventory sync
 * @returns {{ isValid: boolean, reason: string|null }}
 */
export function validateSnapshotFreshness(snapshot, inventoryLastSyncedAt) {
  if (!inventoryLastSyncedAt) {
    return {
      isValid: false,
      reason: 'Inventory has not been synced. Snapshot cannot be validated.'
    };
  }

  if (!snapshot?.generatedAt) {
    return {
      isValid: false,
      reason: 'Snapshot has no generation timestamp.'
    };
  }

  const syncTime = new Date(inventoryLastSyncedAt);
  const snapshotTime = new Date(snapshot.generatedAt);

  if (isNaN(syncTime.getTime()) || isNaN(snapshotTime.getTime())) {
    return {
      isValid: false,
      reason: 'Invalid timestamps. Cannot validate snapshot.'
    };
  }

  // Snapshot must be generated AFTER inventory sync
  if (snapshotTime < syncTime) {
    const syncAge = Math.round((snapshotTime - syncTime) / (1000 * 60 * 60));
    return {
      isValid: false,
      reason: `Snapshot was generated ${Math.abs(syncAge)} hours BEFORE the last inventory sync. It shows outdated data.`
    };
  }

  return { isValid: true, reason: null };
}
