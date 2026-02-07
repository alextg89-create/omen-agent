/**
 * Data Freshness Module - ORDER-DRIVEN MODEL
 *
 * Computes confidence level and warnings based on data quality.
 *
 * IMPORTANT: OMEN uses an ORDER-DRIVEN inventory model:
 * - available_quantity = snapshot_quantity - sold_quantity
 * - Availability updates in REAL-TIME as orders arrive
 * - The "snapshot date" is just the base inventory count date
 * - Staleness of snapshot is LESS critical because availability is derived
 *
 * CONFIDENCE LEVELS:
 * - high: Good data coverage, costs and margins available
 * - medium: Partial data, some insights available
 * - low: Missing critical data, advisory only
 *
 * WARNINGS reflect data quality, NOT sync status.
 */

/**
 * Compute data freshness state
 *
 * NOTE: With order-driven model, staleness is less critical.
 * Availability is computed as snapshot_quantity - sold_quantity,
 * so it updates in real-time as orders arrive.
 *
 * @param {string|null} inventoryLastSyncedAt - ISO-8601 timestamp or null
 * @returns {{ confidence: string, warnings: string[], shouldRefuse: boolean, freshnessState: object }}
 */
export function computeDataFreshness(inventoryLastSyncedAt) {
  const warnings = [];
  let confidence = 'medium';  // Default to medium with order-driven model
  let shouldRefuse = false;

  // NULL = NO BASE SNAPSHOT
  if (!inventoryLastSyncedAt) {
    warnings.push('No inventory snapshot loaded. Upload a Wix inventory export to begin.');
    return {
      confidence: 'low',
      warnings,
      shouldRefuse: true,
      freshnessState: {
        status: 'unknown',
        model: 'order-driven',
        inventoryLastSyncedAt: null,
        ageMs: null,
        ageHours: null,
        ageDays: null
      }
    };
  }

  const syncTime = new Date(inventoryLastSyncedAt);
  if (isNaN(syncTime.getTime())) {
    warnings.push('Inventory snapshot timestamp is invalid.');
    return {
      confidence: 'low',
      warnings,
      shouldRefuse: true,
      freshnessState: {
        status: 'invalid',
        model: 'order-driven',
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

  // ========================================================================
  // ORDER-DRIVEN MODEL: Snapshot age is INFORMATIONAL ONLY
  // ========================================================================
  // Availability = snapshot_quantity - sold_quantity
  // Orders update availability in real-time regardless of snapshot age
  // Confidence is determined by ORDER EXISTENCE, not snapshot age
  // ========================================================================

  if (ageHours < 24) {
    status = 'fresh';
  } else if (ageDays < 7) {
    status = 'recent';
  } else {
    status = 'older';
    // NO WARNING: Snapshot age is informational only for order-driven model
    // Availability is still accurate because it's computed from orders
  }

  // CONFIDENCE RULES (order-driven model):
  // - Actual confidence is determined by caller based on order existence
  // - This function returns 'high' as default because order-driven model is reliable
  // - Caller will downgrade to 'medium' if no orders exist
  confidence = 'high';

  return {
    confidence,
    warnings,
    shouldRefuse,
    freshnessState: {
      status,
      model: 'order-driven',  // Flag the model
      inventoryLastSyncedAt,
      ageMs: Math.round(ageMs),
      ageHours: Math.round(ageHours * 10) / 10,
      ageDays: Math.round(ageDays * 10) / 10,
      // Explain the model
      description: 'Availability updates in real-time from orders'
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

  // Only refuse if truly no data
  const finalAnswer = freshness.shouldRefuse
    ? `I can't answer that confidently.\n\n${freshness.warnings[0]}\n\nUpload a Wix inventory export to begin.`
    : answer;

  return {
    answer: finalAnswer,
    confidence: freshness.confidence,
    data_freshness: {
      inventory_last_synced_at: inventoryLastSyncedAt,
      model: 'order-driven',
      description: 'Availability updates in real-time from orders'
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
 * - Inventory data existence (not staleness - order-driven model handles that)
 * - Order data existence
 * - Cost/margin coverage (VISIBLE SKUs only per policy)
 * - Velocity data availability
 *
 * POLICY RULES:
 * - Coverage metrics use VISIBLE SKUs only (matches Wix dashboard)
 * - Hidden/archived SKUs do NOT degrade confidence
 * - If orders > 0 AND skusWithCost > 0 → confidence MUST be at least MEDIUM
 * - LOW confidence ONLY when data is genuinely missing
 *
 * @param {object} params - Parameters for confidence calculation
 * @returns {{ confidence: string, factors: object, explanation: string }}
 */
export function computeSnapshotConfidence({
  inventoryFreshness: _inventoryFreshness = null,  // Kept for API compatibility
  orderCount = 0,
  skusWithCost = 0,
  totalSkus = 0,
  velocityDataAvailable = false,
  previousSnapshotExists = false,
  // NEW: Visible SKU counts (Wix dashboard parity)
  visibleSkuCount = null,
  visibleWithCost = null,
  costCoveragePercent = null,  // Pre-computed from authority (visible only)
  // Profit intelligence
  totalProfitAtRisk = 0
}) {
  // Use visible counts if provided (policy-compliant), otherwise fall back to totals
  const effectiveTotalSkus = visibleSkuCount !== null ? visibleSkuCount : totalSkus;
  const effectiveSkusWithCost = visibleWithCost !== null ? visibleWithCost : skusWithCost;

  // Use pre-computed coverage if provided, otherwise calculate
  const effectiveCoverage = costCoveragePercent !== null
    ? costCoveragePercent / 100
    : (effectiveTotalSkus > 0 ? effectiveSkusWithCost / effectiveTotalSkus : 1);

  const factors = {
    inventoryExists: effectiveTotalSkus > 0,
    hasOrders: orderCount > 0,
    hasCostData: effectiveSkusWithCost > 0,
    costCoverage: effectiveCoverage,
    hasVelocity: velocityDataAvailable,
    hasComparison: previousSnapshotExists,
    hasProfitData: totalProfitAtRisk > 0,
    // Policy tracking
    usingVisibleCounts: visibleSkuCount !== null,
    visibleSkuCount: effectiveTotalSkus,
    visibleWithCost: effectiveSkusWithCost,
    model: 'order-driven'
  };

  // Calculate confidence score (0-100)
  let score = 0;
  const explanations = [];

  // Inventory exists: 20 points (binary - with order-driven model, existence matters more than freshness)
  if (factors.inventoryExists) {
    score += 20;
    explanations.push(`${effectiveTotalSkus} visible SKUs loaded`);
  } else {
    explanations.push('No inventory data');
  }

  // Order data: 30 points (critical for intelligence)
  if (factors.hasOrders) {
    score += 30;
    explanations.push(`${orderCount} orders driving availability`);
  } else {
    explanations.push('No order data');
  }

  // Cost/margin coverage: 30 points (VISIBLE SKUs only per policy)
  if (factors.hasCostData) {
    const coverageScore = Math.min(30, Math.round(factors.costCoverage * 30));
    score += coverageScore;
    explanations.push(`${Math.round(factors.costCoverage * 100)}% cost coverage`);
  } else {
    explanations.push('No cost data');
  }

  // Profit at risk data: 10 points
  if (factors.hasProfitData) {
    score += 10;
    explanations.push(`$${totalProfitAtRisk.toLocaleString()} profit at risk tracked`);
  }

  // Velocity data: 5 points
  if (factors.hasVelocity) {
    score += 5;
    explanations.push('Velocity metrics available');
  }

  // Previous snapshot for comparison: 5 points
  if (factors.hasComparison) {
    score += 5;
    explanations.push('Week-over-week comparison available');
  }

  // Determine confidence level
  let confidence;
  if (score >= 65) {
    confidence = 'high';
  } else if (score >= 35) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  // RULE: If orders > 0 AND skusWithCost > 0 → at least MEDIUM
  if (factors.hasOrders && factors.hasCostData && confidence === 'low') {
    confidence = 'medium';
    explanations.push('Elevated: has orders and cost data');
  }

  // POLICY BONUS: High coverage (>=80%) of visible SKUs → boost confidence
  if (factors.costCoverage >= 0.8 && confidence === 'medium') {
    confidence = 'high';
    explanations.push('Elevated: ≥80% cost coverage');
  }

  return {
    confidence,
    score,
    factors,
    explanation: explanations.join('. ') + '.'
  };
}

/**
 * Reconcile confidence level with warnings
 *
 * RULE: HIGH confidence + critical warning = contradiction
 * This function adjusts either confidence or warnings to be coherent
 *
 * ORDER-DRIVEN MODEL: Warnings should explain the model, not imply broken sync
 *
 * @param {string} confidence - Computed confidence level
 * @param {string[]} warnings - List of warnings
 * @param {object} factors - Confidence factors
 * @returns {{ confidence: string, warnings: string[], statusMessage: string }}
 */
export function reconcileConfidenceAndWarnings(confidence, warnings, factors = {}) {
  const adjustedWarnings = [...warnings];
  let statusMessage = '';

  // ORDER-DRIVEN MODEL: Replace any old "sync" warnings with model explanation
  const oldSyncWarningIndex = adjustedWarnings.findIndex(w =>
    w.toLowerCase().includes('stale') ||
    w.toLowerCase().includes('unreliable') ||
    w.toLowerCase().includes("hasn't been synced") ||
    w.toLowerCase().includes('out of sync')
  );

  if (oldSyncWarningIndex >= 0) {
    // Replace with order-driven model explanation
    adjustedWarnings[oldSyncWarningIndex] = 'Availability updates in real-time from orders.';
  }

  // Determine status message based on confidence and model
  if (confidence === 'high') {
    statusMessage = 'Order-driven • Real-time';
  } else if (confidence === 'medium') {
    statusMessage = factors.hasOrders ? 'Order data current' : 'Partial data';
  } else {
    statusMessage = 'Limited data';
    if (adjustedWarnings.length === 0) {
      adjustedWarnings.push('Limited data available for analysis.');
    }
  }

  return {
    confidence,
    warnings: adjustedWarnings,
    statusMessage
  };
}

/**
 * Generate snapshot freshness message for UI
 *
 * ORDER-DRIVEN MODEL: Explain that availability is derived, not synced
 *
 * @param {string|null} inventoryLastSyncedAt - Base snapshot date
 * @returns {string} Human-readable freshness message
 */
export function getSnapshotFreshnessMessage(inventoryLastSyncedAt) {
  if (!inventoryLastSyncedAt) {
    return 'No inventory snapshot. Upload a Wix export to begin.';
  }

  const date = new Date(inventoryLastSyncedAt);
  if (isNaN(date.getTime())) {
    return 'Invalid snapshot date.';
  }

  const formattedDate = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  return `Base snapshot: ${formattedDate}. Availability updates in real-time from orders.`;
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
      reason: 'No inventory snapshot loaded. Upload a Wix export first.'
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
    return {
      isValid: false,
      reason: 'Snapshot predates current inventory. Regenerate for accurate data.'
    };
  }

  return { isValid: true, reason: null };
}
