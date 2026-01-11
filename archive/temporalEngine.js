/**
 * Temporal Intelligence Engine
 *
 * Replaces generic recommendations with velocity-first prioritization
 *
 * SIGNAL CLASSIFICATION:
 * - ACCELERATING_DEPLETION: Velocity increasing, stock dropping fast
 * - STABLE_LOW_STOCK: Consistent velocity, low quantity
 * - SUDDEN_DROP: Large quantity decrease between snapshots
 * - NORMAL_VARIANCE: Expected fluctuation
 * - STAGNANT: Zero velocity over observation period
 *
 * PRIORITIZATION RULES:
 * 1. Depletion velocity (units/day)
 * 2. Acceleration (velocity trend)
 * 3. Stock risk (days until depletion)
 * 4. Margin (tie-breaker only)
 */

/**
 * Signal types (deterministic classification)
 */
export const SIGNAL_TYPES = {
  ACCELERATING_DEPLETION: 'ACCELERATING_DEPLETION',
  STABLE_LOW_STOCK: 'STABLE_LOW_STOCK',
  SUDDEN_DROP: 'SUDDEN_DROP',
  STAGNANT: 'STAGNANT',
  NORMAL_VARIANCE: 'NORMAL_VARIANCE',
  RESTOCKED: 'RESTOCKED'
};

/**
 * Classify item based on velocity and delta data
 *
 * @param {object} item - Inventory item with velocity data
 * @param {object} delta - Delta between current and previous snapshot
 * @returns {object} Signal classification
 */
export function classifySignal(item, delta = null) {
  const currentQty = item.quantity || 0;
  const velocity = item.velocity;
  const dailyVelocity = velocity?.dailyVelocity || 0;
  const daysUntilDepletion = velocity?.daysUntilDepletion;

  // No velocity data
  if (!velocity || velocity.unitsSold === 0) {
    return {
      type: SIGNAL_TYPES.STAGNANT,
      severity: currentQty > 0 ? 'low' : 'none',
      reason: 'No sales activity in observation period',
      confidence: 'high',
      citedData: {
        observationDays: velocity?.observationDays || 30,
        unitsSold: 0
      }
    };
  }

  // Check for acceleration using delta
  if (delta && delta.hasAccelerated) {
    return {
      type: SIGNAL_TYPES.ACCELERATING_DEPLETION,
      severity: daysUntilDepletion <= 7 ? 'critical' : daysUntilDepletion <= 14 ? 'high' : 'medium',
      reason: `Sales velocity increased by ${Math.abs(delta.velocityDeltaPercent).toFixed(1)}% - depleting faster than before`,
      confidence: velocity.confidence,
      citedData: {
        currentVelocity: velocity.dailyVelocity,
        previousVelocity: delta.previousVelocity,
        velocityDelta: delta.velocityDelta,
        daysUntilDepletion,
        currentQuantity: currentQty
      }
    };
  }

  // Check for sudden quantity drop
  if (delta && delta.quantityDelta < -5 && Math.abs(delta.quantityDeltaPercent) > 30) {
    return {
      type: SIGNAL_TYPES.SUDDEN_DROP,
      severity: daysUntilDepletion <= 7 ? 'high' : 'medium',
      reason: `Quantity dropped by ${Math.abs(delta.quantityDelta)} units (${Math.abs(delta.quantityDeltaPercent).toFixed(1)}%) since last snapshot`,
      confidence: 'high',
      citedData: {
        quantityDelta: delta.quantityDelta,
        previousQuantity: delta.previousQuantity,
        currentQuantity: delta.currentQuantity,
        daysUntilDepletion
      }
    };
  }

  // Check for restock
  if (delta && delta.quantityDelta > 10) {
    return {
      type: SIGNAL_TYPES.RESTOCKED,
      severity: 'info',
      reason: `Inventory restocked (+${delta.quantityDelta} units)`,
      confidence: 'high',
      citedData: {
        quantityDelta: delta.quantityDelta,
        previousQuantity: delta.previousQuantity,
        currentQuantity: delta.currentQuantity
      }
    };
  }

  // Stable velocity with low stock
  if (currentQty > 0 && currentQty < 10 && dailyVelocity > 0) {
    return {
      type: SIGNAL_TYPES.STABLE_LOW_STOCK,
      severity: daysUntilDepletion <= 3 ? 'critical' : daysUntilDepletion <= 7 ? 'high' : 'medium',
      reason: `Selling at ${dailyVelocity.toFixed(1)} units/day with ${currentQty} remaining - ${daysUntilDepletion} days until depletion`,
      confidence: velocity.confidence,
      citedData: {
        dailyVelocity,
        currentQuantity: currentQty,
        daysUntilDepletion,
        orderCount: velocity.orderCount
      }
    };
  }

  // Normal variance - no signal
  return {
    type: SIGNAL_TYPES.NORMAL_VARIANCE,
    severity: 'none',
    reason: 'Normal inventory movement',
    confidence: velocity.confidence,
    citedData: {
      dailyVelocity,
      currentQuantity: currentQty,
      daysUntilDepletion
    }
  };
}

/**
 * Generate velocity-first recommendations
 *
 * Prioritization:
 * 1. Depletion velocity
 * 2. Acceleration
 * 3. Stock risk
 * 4. Margin (tie-breaker)
 *
 * @param {array} inventoryWithVelocity - Enriched inventory items
 * @param {array} deltas - Delta analysis from previous snapshot
 * @returns {object} Recommendations grouped by category
 */
export function generateTemporalRecommendations(inventoryWithVelocity, deltas = null) {
  const recommendations = {
    urgent: [],      // Critical/high severity
    reorder: [],     // Medium severity
    promotional: [], // Opportunities
    monitoring: []   // Low priority
  };

  // Create delta map for quick lookup
  const deltaMap = new Map();
  if (deltas && deltas.deltas) {
    for (const delta of deltas.deltas) {
      const key = `${delta.sku}|${delta.unit}`;
      deltaMap.set(key, delta);
    }
  }

  // Classify each item
  for (const item of inventoryWithVelocity) {
    const sku = item.strain || item.sku;
    const unit = item.unit;
    const key = `${sku}|${unit}`;
    const delta = deltaMap.get(key);

    const signal = classifySignal(item, delta);

    // Skip items with no actionable signal
    if (signal.type === SIGNAL_TYPES.NORMAL_VARIANCE || signal.type === SIGNAL_TYPES.RESTOCKED) {
      continue;
    }

    const margin = item.pricing?.margin || 0;
    const itemName = `${sku} (${unit})`;

    const recommendation = {
      sku,
      unit,
      name: itemName,
      signalType: signal.type,
      severity: signal.severity,
      reason: signal.reason,
      confidence: signal.confidence,
      citedData: signal.citedData,
      margin,
      // Priority score for sorting
      priorityScore: calculatePriorityScore(item, signal, delta)
    };

    // Route to appropriate category
    if (signal.severity === 'critical' || signal.severity === 'high') {
      recommendations.urgent.push(recommendation);
    } else if (signal.type === SIGNAL_TYPES.STABLE_LOW_STOCK) {
      recommendations.reorder.push(recommendation);
    } else if (signal.type === SIGNAL_TYPES.STAGNANT && item.quantity > 10) {
      recommendations.promotional.push({
        ...recommendation,
        reason: `${signal.reason} - consider promotion to move inventory`,
        action: 'PROMOTE_OR_DISCOUNT'
      });
    } else {
      recommendations.monitoring.push(recommendation);
    }
  }

  // Sort each category by priority score (highest first)
  recommendations.urgent.sort((a, b) => b.priorityScore - a.priorityScore);
  recommendations.reorder.sort((a, b) => b.priorityScore - a.priorityScore);
  recommendations.promotional.sort((a, b) => b.priorityScore - a.priorityScore);
  recommendations.monitoring.sort((a, b) => b.priorityScore - a.priorityScore);

  return {
    recommendations,
    summary: {
      urgent: recommendations.urgent.length,
      reorder: recommendations.reorder.length,
      promotional: recommendations.promotional.length,
      monitoring: recommendations.monitoring.length,
      total: recommendations.urgent.length +
             recommendations.reorder.length +
             recommendations.promotional.length +
             recommendations.monitoring.length
    }
  };
}

/**
 * Calculate priority score
 *
 * Higher score = higher priority
 *
 * Factors (in order of weight):
 * 1. Depletion velocity (50%)
 * 2. Acceleration (25%)
 * 3. Stock risk (15%)
 * 4. Margin (10%)
 *
 * @param {object} item - Inventory item
 * @param {object} signal - Signal classification
 * @param {object} delta - Delta data
 * @returns {number} Priority score (0-100)
 */
function calculatePriorityScore(item, signal, delta) {
  let score = 0;

  // Factor 1: Depletion velocity (0-50 points)
  const dailyVelocity = item.velocity?.dailyVelocity || 0;
  score += Math.min(dailyVelocity * 5, 50);

  // Factor 2: Acceleration (0-25 points)
  if (delta && delta.hasAccelerated) {
    const accelMagnitude = Math.abs(delta.velocityDeltaPercent) || 0;
    score += Math.min(accelMagnitude / 4, 25);
  }

  // Factor 3: Stock risk (0-15 points)
  const daysUntilDepletion = item.velocity?.daysUntilDepletion;
  if (daysUntilDepletion !== null && daysUntilDepletion > 0) {
    const risk = Math.max(0, 15 - daysUntilDepletion);
    score += risk;
  }

  // Factor 4: Margin (0-10 points) - tie-breaker only
  const margin = item.pricing?.margin || 0;
  const marginPercent = item.pricing?.retail > 0
    ? ((margin / item.pricing.retail) * 100)
    : 0;
  score += Math.min(marginPercent / 10, 10);

  return Math.round(score);
}

/**
 * Compute confidence evolution
 *
 * Increases confidence when trends persist across snapshots
 * Decreases confidence for single-snapshot anomalies
 *
 * @param {string} currentConfidence - Current confidence level
 * @param {number} snapshotCount - Number of snapshots showing this pattern
 * @returns {string} Evolved confidence level
 */
export function evolveConfidence(currentConfidence, snapshotCount) {
  if (snapshotCount >= 3) {
    // Pattern persists - upgrade confidence
    if (currentConfidence === 'low') return 'medium';
    if (currentConfidence === 'medium') return 'high';
    return 'high';
  }

  if (snapshotCount === 1) {
    // Single snapshot - may be anomaly
    if (currentConfidence === 'high') return 'medium';
    if (currentConfidence === 'medium') return 'low';
    return 'low';
  }

  // 2 snapshots - maintain current
  return currentConfidence;
}
