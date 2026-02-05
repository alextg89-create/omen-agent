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
 * Compute holistic snapshot confidence based on ALL available data
 *
 * This is the UPGRADED confidence logic that considers:
 * - Inventory freshness
 * - Order data existence
 * - Cost/margin coverage (ACTIVE SKUs only per policy)
 * - Velocity data availability
 *
 * POLICY RULES:
 * - Coverage metrics use ACTIVE SKUs only (quantity > 0 or IN_STOCK)
 * - Inactive/out-of-stock SKUs do NOT degrade confidence
 * - If orders > 0 AND skusWithCost > 0 → confidence MUST be at least MEDIUM
 * - LOW confidence ONLY when data is genuinely missing
 *
 * @param {object} params - Parameters for confidence calculation
 * @returns {{ confidence: string, factors: object, explanation: string }}
 */
export function computeSnapshotConfidence({
  inventoryFreshness = null,
  orderCount = 0,
  skusWithCost = 0,
  totalSkus = 0,
  velocityDataAvailable = false,
  previousSnapshotExists = false,
  // NEW: Active SKU counts (policy-compliant)
  activeSkuCount = null,
  activeWithCost = null,
  costCoveragePercent = null  // Pre-computed from authority (active only)
}) {
  // Use active counts if provided (policy-compliant), otherwise fall back to totals
  const effectiveTotalSkus = activeSkuCount !== null ? activeSkuCount : totalSkus;
  const effectiveSkusWithCost = activeWithCost !== null ? activeWithCost : skusWithCost;

  // Use pre-computed coverage if provided, otherwise calculate
  const effectiveCoverage = costCoveragePercent !== null
    ? costCoveragePercent / 100
    : (effectiveTotalSkus > 0 ? effectiveSkusWithCost / effectiveTotalSkus : 1);

  const factors = {
    inventoryFresh: false,
    hasOrders: orderCount > 0,
    hasCostData: effectiveSkusWithCost > 0,
    costCoverage: effectiveCoverage,
    hasVelocity: velocityDataAvailable,
    hasComparison: previousSnapshotExists,
    // Policy tracking
    usingActiveCounts: activeSkuCount !== null,
    activeSkuCount: effectiveTotalSkus,
    activeWithCost: effectiveSkusWithCost
  };

  // Check inventory freshness
  if (inventoryFreshness) {
    factors.inventoryFresh = inventoryFreshness.confidence !== 'low';
  }

  // Calculate confidence score (0-100)
  let score = 0;
  const explanations = [];

  // Inventory freshness: 25 points
  if (factors.inventoryFresh) {
    score += 25;
    explanations.push('Inventory is fresh');
  } else {
    explanations.push('Inventory sync is stale');
  }

  // Order data: 30 points (critical for intelligence)
  if (factors.hasOrders) {
    score += 30;
    explanations.push(`${orderCount} orders available`);
  } else {
    explanations.push('No order data');
  }

  // Cost/margin coverage: 25 points (ACTIVE SKUs only per policy)
  if (factors.hasCostData) {
    const coverageScore = Math.min(25, Math.round(factors.costCoverage * 25));
    score += coverageScore;
    const coverageLabel = factors.usingActiveCounts ? 'active cost coverage' : 'cost coverage';
    explanations.push(`${Math.round(factors.costCoverage * 100)}% ${coverageLabel}`);
  } else {
    explanations.push('No cost data');
  }

  // Velocity data: 10 points
  if (factors.hasVelocity) {
    score += 10;
    explanations.push('Velocity metrics available');
  }

  // Previous snapshot for comparison: 10 points
  if (factors.hasComparison) {
    score += 10;
    explanations.push('Week-over-week comparison available');
  }

  // Determine confidence level
  let confidence;
  if (score >= 70) {
    confidence = 'high';
  } else if (score >= 40) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  // RULE: If orders > 0 AND skusWithCost > 0 → at least MEDIUM
  if (factors.hasOrders && factors.hasCostData && confidence === 'low') {
    confidence = 'medium';
    explanations.push('Elevated to medium: has orders and cost data');
  }

  // POLICY BONUS: High coverage (>=80%) of active SKUs → boost confidence
  if (factors.costCoverage >= 0.8 && confidence === 'medium') {
    confidence = 'high';
    explanations.push('Elevated to high: ≥80% active SKU cost coverage');
  }

  return {
    confidence,
    score,
    factors,
    explanation: explanations.join('. ') + '.'
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
