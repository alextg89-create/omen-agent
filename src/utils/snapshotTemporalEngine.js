/**
 * Snapshot-Based Temporal Intelligence Engine
 *
 * Works ONLY with cached snapshot files - NO external dependencies
 * Computes deltas, velocity, and acceleration from snapshot history
 *
 * CONSTRAINTS:
 * - No Supabase required
 * - No fake sales data
 * - Uses only cached snapshot comparisons
 * - Conservative signal classification
 */

import { loadSnapshot, getLatestSnapshot } from './snapshotCache.js';
import { getLastSnapshots } from './snapshotHistory.js';

/**
 * Signal types based on snapshot delta analysis
 */
export const SIGNAL_TYPES = {
  ACCELERATING_DEPLETION: 'ACCELERATING_DEPLETION',  // Quantity dropping faster
  STABLE_LOW_STOCK: 'STABLE_LOW_STOCK',              // Consistent low quantity
  SUDDEN_DROP: 'SUDDEN_DROP',                         // Large quantity decrease
  RESTOCKED: 'RESTOCKED',                             // Quantity increased
  NORMAL_VARIANCE: 'NORMAL_VARIANCE'                  // Expected fluctuation
};

/**
 * Compute inventory deltas from snapshot history
 *
 * @param {string} timeframe - 'weekly' or 'daily'
 * @param {number} lookback - Number of snapshots to compare (default: 2)
 * @returns {object} Delta analysis per SKU
 */
export function computeInventoryDeltas(timeframe = 'weekly', lookback = 2) {
  const snapshots = getLastSnapshots(lookback, timeframe);

  if (snapshots.length < 2) {
    return {
      ok: false,
      error: 'Need at least 2 snapshots for delta analysis',
      deltas: []
    };
  }

  // Load actual snapshot data
  const currentEntry = snapshots[0];
  const previousEntry = snapshots[1];

  const currentData = loadSnapshot(currentEntry.timeframe, currentEntry.asOfDate);
  const previousData = loadSnapshot(previousEntry.timeframe, previousEntry.asOfDate);

  if (!currentData || !previousData) {
    return {
      ok: false,
      error: 'Failed to load snapshot files',
      deltas: []
    };
  }

  const currentItems = extractInventoryItems(currentData.snapshot);
  const previousItems = extractInventoryItems(previousData.snapshot);

  // Build delta map
  const deltaMap = new Map();
  const previousMap = new Map();

  for (const item of previousItems) {
    const key = `${item.sku}|${item.unit}`;
    previousMap.set(key, item);
  }

  for (const current of currentItems) {
    const key = `${current.sku}|${current.unit}`;
    const previous = previousMap.get(key);

    const currentQty = current.quantity || 0;
    const previousQty = previous?.quantity || currentQty; // If new item, use current as baseline

    const quantityDelta = currentQty - previousQty;
    const quantityDeltaPercent = previousQty > 0
      ? ((quantityDelta / previousQty) * 100)
      : null;

    // Compute time delta in days
    const currentDate = new Date(currentEntry.asOfDate);
    const previousDate = new Date(previousEntry.asOfDate);
    const timeDeltaDays = Math.max(1, Math.round((currentDate - previousDate) / (1000 * 60 * 60 * 24)));

    // Compute depletion rate (units per day)
    const depletionRate = timeDeltaDays > 0 && quantityDelta < 0
      ? Math.abs(quantityDelta) / timeDeltaDays
      : 0;

    // Detect acceleration (if we have 3+ snapshots)
    let acceleration = null;
    if (snapshots.length >= 3) {
      const olderEntry = snapshots[2];
      const olderData = loadSnapshot(olderEntry.timeframe, olderEntry.asOfDate);
      if (olderData) {
        const olderItems = extractInventoryItems(olderData.snapshot);
        const older = olderItems.find(i => `${i.sku}|${i.unit}` === key);
        if (older && previous) {
          const priorDelta = (previous.quantity || 0) - (older.quantity || 0);
          const priorTimeDays = Math.max(1, Math.round((previousDate - new Date(olderEntry.asOfDate)) / (1000 * 60 * 60 * 24)));
          const priorDepletionRate = priorDelta < 0 ? Math.abs(priorDelta) / priorTimeDays : 0;

          if (priorDepletionRate > 0 && depletionRate > 0) {
            const rateChange = ((depletionRate - priorDepletionRate) / priorDepletionRate) * 100;
            acceleration = {
              rateChange: parseFloat(rateChange.toFixed(2)),
              previousRate: parseFloat(priorDepletionRate.toFixed(2)),
              currentRate: parseFloat(depletionRate.toFixed(2)),
              isAccelerating: rateChange > 20,
              isDecelerating: rateChange < -20
            };
          }
        }
      }
    }

    deltaMap.set(key, {
      sku: current.sku,
      unit: current.unit,
      currentQuantity: currentQty,
      previousQuantity: previousQty,
      quantityDelta,
      quantityDeltaPercent: quantityDeltaPercent !== null ? parseFloat(quantityDeltaPercent.toFixed(2)) : null,
      timeDeltaDays,
      depletionRate: parseFloat(depletionRate.toFixed(2)),
      acceleration,
      pricing: current.pricing,
      margin: current.pricing?.margin ?? null  // NULL if missing - never fabricate
    });
  }

  return {
    ok: true,
    deltas: Array.from(deltaMap.values()),
    snapshotCount: snapshots.length,
    currentDate: currentEntry.asOfDate,
    previousDate: previousEntry.asOfDate
  };
}

/**
 * Extract inventory items from snapshot
 */
function extractInventoryItems(snapshot) {
  // Try enrichedInventory first (if temporal engine was used)
  if (snapshot.enrichedInventory && Array.isArray(snapshot.enrichedInventory)) {
    return snapshot.enrichedInventory.map(item => ({
      sku: item.strain || item.sku,
      unit: item.unit,
      quantity: item.quantity || 0,
      pricing: item.pricing
    }));
  }

  // Fallback: extract from recommendations
  const items = [];
  const seen = new Set();

  for (const rec of (snapshot.recommendations?.inventory || [])) {
    const key = `${rec.sku}|${rec.unit}`;
    if (!seen.has(key)) {
      seen.add(key);
      items.push({
        sku: rec.sku,
        unit: rec.unit,
        quantity: rec.triggeringMetrics?.quantity || 0,
        pricing: {
          margin: rec.triggeringMetrics?.margin ?? null,  // NULL if missing
          cost: rec.triggeringMetrics?.cost ?? null,
          retail: rec.triggeringMetrics?.retail ?? null
        }
      });
    }
  }

  for (const rec of (snapshot.recommendations?.promotions || [])) {
    const key = `${rec.sku}|${rec.unit}`;
    if (!seen.has(key)) {
      seen.add(key);
      items.push({
        sku: rec.sku,
        unit: rec.unit,
        quantity: rec.triggeringMetrics?.quantity || 0,
        pricing: {
          margin: rec.triggeringMetrics?.margin ?? null,  // NULL if missing
          cost: rec.triggeringMetrics?.cost ?? null,
          retail: rec.triggeringMetrics?.retail ?? null
        }
      });
    }
  }

  return items;
}

/**
 * Classify signal based on delta data
 *
 * @param {object} delta - Delta object from computeInventoryDeltas
 * @returns {object} Signal classification
 */
export function classifySignalFromDelta(delta) {
  const currentQty = delta.currentQuantity;
  const quantityDelta = delta.quantityDelta;
  const quantityDeltaPercent = delta.quantityDeltaPercent;
  const depletionRate = delta.depletionRate;
  const acceleration = delta.acceleration;

  // SIGNAL 1: Accelerating Depletion
  if (acceleration && acceleration.isAccelerating && currentQty < 15) {
    const daysUntilDepletion = depletionRate > 0 ? Math.ceil(currentQty / depletionRate) : null;
    return {
      type: SIGNAL_TYPES.ACCELERATING_DEPLETION,
      severity: daysUntilDepletion <= 7 ? 'critical' : daysUntilDepletion <= 14 ? 'high' : 'medium',
      reason: `Depletion rate increased by ${acceleration.rateChange.toFixed(1)}% - depleting faster than before`,
      confidence: 'high',
      citedData: {
        currentQuantity: currentQty,
        depletionRate: acceleration.currentRate,
        previousDepletionRate: acceleration.previousRate,
        rateChange: acceleration.rateChange,
        daysUntilDepletion,
        quantityDelta
      }
    };
  }

  // SIGNAL 2: Sudden Drop
  if (quantityDelta < -5 && quantityDeltaPercent !== null && Math.abs(quantityDeltaPercent) > 30) {
    const daysUntilDepletion = depletionRate > 0 ? Math.ceil(currentQty / depletionRate) : null;
    return {
      type: SIGNAL_TYPES.SUDDEN_DROP,
      severity: daysUntilDepletion <= 7 ? 'high' : 'medium',
      reason: `Quantity dropped by ${Math.abs(quantityDelta)} units (${Math.abs(quantityDeltaPercent).toFixed(1)}%) since last snapshot`,
      confidence: 'high',
      citedData: {
        currentQuantity: currentQty,
        previousQuantity: delta.previousQuantity,
        quantityDelta,
        quantityDeltaPercent,
        depletionRate,
        daysUntilDepletion
      }
    };
  }

  // SIGNAL 3: Restocked
  if (quantityDelta > 10) {
    return {
      type: SIGNAL_TYPES.RESTOCKED,
      severity: 'info',
      reason: `Inventory restocked (+${quantityDelta} units)`,
      confidence: 'high',
      citedData: {
        currentQuantity: currentQty,
        previousQuantity: delta.previousQuantity,
        quantityDelta
      }
    };
  }

  // SIGNAL 4: Stable Low Stock
  if (currentQty > 0 && currentQty <= 5 && depletionRate > 0) {
    const daysUntilDepletion = Math.ceil(currentQty / depletionRate);
    return {
      type: SIGNAL_TYPES.STABLE_LOW_STOCK,
      severity: daysUntilDepletion <= 3 ? 'critical' : daysUntilDepletion <= 7 ? 'high' : 'medium',
      reason: `Depleting at ${depletionRate.toFixed(1)} units/day with ${currentQty} remaining - ${daysUntilDepletion} days until out of stock`,
      confidence: 'medium',
      citedData: {
        currentQuantity: currentQty,
        depletionRate,
        daysUntilDepletion,
        timeDeltaDays: delta.timeDeltaDays
      }
    };
  }

  // SIGNAL 5: Normal Variance
  return {
    type: SIGNAL_TYPES.NORMAL_VARIANCE,
    severity: 'none',
    reason: 'Normal inventory movement',
    confidence: 'low',
    citedData: {
      currentQuantity: currentQty,
      quantityDelta
    }
  };
}

/**
 * Generate velocity-first recommendations from deltas
 *
 * Priority:
 * 1. Depletion rate (units/day)
 * 2. Acceleration (rate of change)
 * 3. Stock risk (days until depletion)
 * 4. Margin (tie-breaker only)
 *
 * @param {string} timeframe - 'weekly' or 'daily'
 * @returns {object} Recommendations grouped by category
 */
export function generateTemporalRecommendationsFromSnapshots(timeframe = 'weekly') {
  const deltaResult = computeInventoryDeltas(timeframe, 3); // Look back 3 snapshots

  if (!deltaResult.ok) {
    return {
      ok: false,
      error: deltaResult.error,
      recommendations: {
        urgent: [],
        reorder: [],
        promotional: [],
        monitoring: []
      }
    };
  }

  const recommendations = {
    urgent: [],
    reorder: [],
    promotional: [],
    monitoring: []
  };

  for (const delta of deltaResult.deltas) {
    const signal = classifySignalFromDelta(delta);

    if (signal.type === SIGNAL_TYPES.NORMAL_VARIANCE || signal.type === SIGNAL_TYPES.RESTOCKED) {
      continue; // Skip non-actionable signals
    }

    const rec = {
      sku: delta.sku,
      unit: delta.unit,
      name: `${delta.sku} (${delta.unit})`,
      signalType: signal.type,
      severity: signal.severity,
      reason: signal.reason,
      confidence: signal.confidence,
      citedData: signal.citedData,
      margin: delta.margin,
      priorityScore: calculatePriorityScore(delta, signal)
    };

    // Route to category
    if (signal.severity === 'critical' || signal.severity === 'high') {
      recommendations.urgent.push(rec);
    } else if (signal.type === SIGNAL_TYPES.STABLE_LOW_STOCK) {
      recommendations.reorder.push(rec);
    } else {
      recommendations.monitoring.push(rec);
    }
  }

  // Sort by priority score (highest first)
  recommendations.urgent.sort((a, b) => b.priorityScore - a.priorityScore);
  recommendations.reorder.sort((a, b) => b.priorityScore - a.priorityScore);
  recommendations.monitoring.sort((a, b) => b.priorityScore - a.priorityScore);

  return {
    ok: true,
    recommendations,
    summary: {
      urgent: recommendations.urgent.length,
      reorder: recommendations.reorder.length,
      promotional: recommendations.promotional.length,
      monitoring: recommendations.monitoring.length,
      total: recommendations.urgent.length + recommendations.reorder.length + recommendations.monitoring.length
    },
    snapshotCount: deltaResult.snapshotCount,
    dateRange: {
      current: deltaResult.currentDate,
      previous: deltaResult.previousDate
    }
  };
}

/**
 * Calculate priority score
 *
 * Weights:
 * - Depletion rate: 50%
 * - Acceleration: 25%
 * - Stock risk: 15%
 * - Margin: 10%
 */
function calculatePriorityScore(delta, signal) {
  let score = 0;

  // Factor 1: Depletion rate (0-50 points)
  const depletionRate = delta.depletionRate || 0;
  score += Math.min(depletionRate * 5, 50);

  // Factor 2: Acceleration (0-25 points)
  if (delta.acceleration && delta.acceleration.isAccelerating) {
    const accelMagnitude = Math.abs(delta.acceleration.rateChange) || 0;
    score += Math.min(accelMagnitude / 4, 25);
  }

  // Factor 3: Stock risk (0-15 points)
  const daysUntilDepletion = signal.citedData.daysUntilDepletion;
  if (daysUntilDepletion !== null && daysUntilDepletion > 0) {
    const risk = Math.max(0, 15 - daysUntilDepletion);
    score += risk;
  }

  // Factor 4: Margin (0-10 points) - tie-breaker only (skip if unknown)
  const margin = delta.margin;
  if (margin !== null && margin !== undefined) {
    score += Math.min(margin / 10, 10);
  }

  return Math.round(score);
}

/**
 * Compute confidence evolution
 *
 * Confidence increases when patterns persist across snapshots
 */
export function evolveConfidence(currentConfidence, snapshotCount) {
  if (snapshotCount >= 3) {
    if (currentConfidence === 'low') return 'medium';
    if (currentConfidence === 'medium') return 'high';
    return 'high';
  }

  if (snapshotCount === 1) {
    if (currentConfidence === 'high') return 'medium';
    if (currentConfidence === 'medium') return 'low';
    return 'low';
  }

  return currentConfidence;
}
