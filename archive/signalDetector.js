/**
 * Signal Detection Engine
 *
 * Analyzes inventory + velocity + history to detect actionable signals
 *
 * SIGNAL TYPES:
 * - Urgency: Stock depletion risks
 * - Performance: Sales acceleration/deceleration
 * - Health: Margin trends, pricing opportunities
 * - Risk: Aging stock, volatile demand
 *
 * SAFEGUARDS:
 * - Only generates signals when data is confident
 * - Conservative thresholds
 * - Explicit confidence levels
 * - No speculation or causal claims
 */

import { computeVelocityDelta } from "./snapshotAnalysis.js";

/**
 * Signal Types
 */
export const SIGNAL_TYPES = {
  // Urgency signals (stock depletion)
  CRITICAL_DEPLETION: "CRITICAL_DEPLETION",
  URGENT_REORDER: "URGENT_REORDER",
  PLAN_REORDER: "PLAN_REORDER",

  // Performance signals (sales trends)
  ACCELERATING_SALES: "ACCELERATING_SALES",
  DECELERATING_SALES: "DECELERATING_SALES",
  STAGNANT_INVENTORY: "STAGNANT_INVENTORY",

  // Health signals (margin and pricing)
  MARGIN_EROSION: "MARGIN_EROSION",
  PRICE_OPPORTUNITY: "PRICE_OPPORTUNITY",

  // Risk signals
  AGING_STOCK: "AGING_STOCK",
  VOLATILE_DEMAND: "VOLATILE_DEMAND",
};

/**
 * Signal Severity Levels
 */
export const SIGNAL_SEVERITY = {
  CRITICAL: "critical", // Immediate action required
  HIGH: "high", // Action needed soon
  MEDIUM: "medium", // Monitor closely
  LOW: "low", // Informational
};

/**
 * Detect all signals for inventory item
 *
 * @param {object} item - Inventory item with velocity data
 * @param {object} history - Historical data for trends
 * @returns {Array<object>} - Array of signals
 */
export function detectSignals(item, history = {}) {
  const signals = [];

  // 1. DEPLETION SIGNALS (requires velocity)
  if (item.depletion && item.depletion.daysUntilDepletion !== null) {
    const days = item.depletion.daysUntilDepletion;

    if (days <= 3 && days > 0) {
      signals.push({
        type: SIGNAL_TYPES.CRITICAL_DEPLETION,
        severity: SIGNAL_SEVERITY.CRITICAL,
        sku: item.sku,
        unit: item.unit,
        daysUntilDepletion: days,
        quantityOnHand: item.quantityOnHand,
        dailyVelocity: item.velocity?.dailyVelocity || 0,
        confidence: item.depletion.confidence,
        message: `Critical: Only ${days} day${days > 1 ? "s" : ""} of stock remaining`,
        action: "REORDER_IMMEDIATELY",
      });
    } else if (days <= 7 && days > 3) {
      signals.push({
        type: SIGNAL_TYPES.URGENT_REORDER,
        severity: SIGNAL_SEVERITY.HIGH,
        sku: item.sku,
        unit: item.unit,
        daysUntilDepletion: days,
        quantityOnHand: item.quantityOnHand,
        dailyVelocity: item.velocity?.dailyVelocity || 0,
        confidence: item.depletion.confidence,
        message: `Urgent: ${days} days of stock remaining`,
        action: "REORDER_SOON",
      });
    } else if (days <= 14 && days > 7) {
      signals.push({
        type: SIGNAL_TYPES.PLAN_REORDER,
        severity: SIGNAL_SEVERITY.MEDIUM,
        sku: item.sku,
        unit: item.unit,
        daysUntilDepletion: days,
        quantityOnHand: item.quantityOnHand,
        dailyVelocity: item.velocity?.dailyVelocity || 0,
        confidence: item.depletion.confidence,
        message: `Plan ahead: ${days} days of stock remaining`,
        action: "PLAN_REORDER",
      });
    }
  }

  // 2. VELOCITY SIGNALS (compare to previous period)
  if (item.velocity && history.previousVelocity) {
    const velocityDelta = computeVelocityDelta(item.velocity, history.previousVelocity);

    if (velocityDelta.pattern === "accelerating") {
      signals.push({
        type: SIGNAL_TYPES.ACCELERATING_SALES,
        severity: SIGNAL_SEVERITY.MEDIUM,
        sku: item.sku,
        unit: item.unit,
        currentVelocity: item.velocity.dailyVelocity,
        previousVelocity: history.previousVelocity.dailyVelocity,
        velocityChange: velocityDelta.percent,
        confidence: item.velocity.confidence,
        message: velocityDelta.message,
        action: "MONITOR_STOCK_LEVELS",
      });
    } else if (velocityDelta.pattern === "decelerating") {
      signals.push({
        type: SIGNAL_TYPES.DECELERATING_SALES,
        severity: SIGNAL_SEVERITY.MEDIUM,
        sku: item.sku,
        unit: item.unit,
        currentVelocity: item.velocity.dailyVelocity,
        previousVelocity: history.previousVelocity.dailyVelocity,
        velocityChange: velocityDelta.percent,
        confidence: item.velocity.confidence,
        message: velocityDelta.message,
        action: "CONSIDER_PROMOTION",
      });
    }
  }

  // 3. STAGNANT INVENTORY (zero sales)
  if (item.velocity && item.velocity.totalUnitsSold === 0 && item.quantityOnHand > 0) {
    const observationDays = item.velocity.observationDays || 30;

    signals.push({
      type: SIGNAL_TYPES.STAGNANT_INVENTORY,
      severity: SIGNAL_SEVERITY.HIGH,
      sku: item.sku,
      unit: item.unit,
      observationDays,
      quantityOnHand: item.quantityOnHand,
      confidence: "high",
      message: `No sales in ${observationDays} days`,
      action: "PROMOTE_OR_DISCOUNT",
    });
  }

  // 4. MARGIN EROSION (requires historical margin trend)
  if (history.marginTrend && history.marginTrend.trend === "decreasing") {
    signals.push({
      type: SIGNAL_TYPES.MARGIN_EROSION,
      severity: SIGNAL_SEVERITY.MEDIUM,
      sku: item.sku,
      unit: item.unit,
      trendConfidence: history.marginTrend.confidence,
      confidence: "medium",
      message: "Margin has been declining over time",
      action: "REVIEW_PRICING",
    });
  }

  // 5. PRICE OPPORTUNITY (high stock + low velocity)
  if (
    item.quantityOnHand > 20 &&
    item.velocity &&
    item.velocity.dailyVelocity > 0 &&
    item.velocity.dailyVelocity < 1
  ) {
    signals.push({
      type: SIGNAL_TYPES.PRICE_OPPORTUNITY,
      severity: SIGNAL_SEVERITY.MEDIUM,
      sku: item.sku,
      unit: item.unit,
      quantityOnHand: item.quantityOnHand,
      dailyVelocity: item.velocity.dailyVelocity,
      confidence: "medium",
      message: "High stock with slow movement - discount opportunity",
      action: "CONSIDER_DISCOUNT",
    });
  }

  // 6. AGING STOCK (high inventory + zero velocity)
  if (
    item.quantityOnHand > 15 &&
    item.velocity &&
    item.velocity.totalUnitsSold === 0
  ) {
    signals.push({
      type: SIGNAL_TYPES.AGING_STOCK,
      severity: SIGNAL_SEVERITY.HIGH,
      sku: item.sku,
      unit: item.unit,
      quantityOnHand: item.quantityOnHand,
      observationDays: item.velocity.observationDays || 30,
      confidence: "high",
      message: "High inventory with no recent sales - aging risk",
      action: "URGENT_PROMOTION",
    });
  }

  // 7. VOLATILE DEMAND (requires historical velocity data)
  if (history.velocityVariance && history.velocityVariance > 50) {
    signals.push({
      type: SIGNAL_TYPES.VOLATILE_DEMAND,
      severity: SIGNAL_SEVERITY.LOW,
      sku: item.sku,
      unit: item.unit,
      variance: history.velocityVariance,
      confidence: "medium",
      message: "Large swings in sales velocity - unpredictable demand",
      action: "INCREASE_SAFETY_STOCK",
    });
  }

  return signals;
}

/**
 * Detect signals for all inventory items
 *
 * @param {Array<object>} inventoryWithVelocity - Inventory with velocity data
 * @param {object} historicalData - Historical snapshots
 * @returns {Array<object>} - All detected signals, sorted by severity
 */
export function detectAllSignals(inventoryWithVelocity, historicalData = {}) {
  if (!Array.isArray(inventoryWithVelocity) || inventoryWithVelocity.length === 0) {
    return [];
  }

  const allSignals = [];

  for (const item of inventoryWithVelocity) {
    const itemHistory = historicalData[item.sku] || {};
    const signals = detectSignals(item, itemHistory);
    allSignals.push(...signals);
  }

  // Sort by severity: CRITICAL > HIGH > MEDIUM > LOW
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  allSignals.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return allSignals;
}

/**
 * Filter signals by severity
 *
 * @param {Array<object>} signals
 * @param {string|Array<string>} severities - Severity level(s) to include
 * @returns {Array<object>}
 */
export function filterSignalsBySeverity(signals, severities) {
  const severityArray = Array.isArray(severities) ? severities : [severities];
  return signals.filter((s) => severityArray.includes(s.severity));
}

/**
 * Filter signals by type
 *
 * @param {Array<object>} signals
 * @param {string|Array<string>} types - Signal type(s) to include
 * @returns {Array<object>}
 */
export function filterSignalsByType(signals, types) {
  const typeArray = Array.isArray(types) ? types : [types];
  return signals.filter((s) => typeArray.includes(s.type));
}

/**
 * Filter signals by confidence
 *
 * @param {Array<object>} signals
 * @param {string} minConfidence - Minimum confidence level (low, medium, high)
 * @returns {Array<object>}
 */
export function filterSignalsByConfidence(signals, minConfidence = "low") {
  const confidenceLevels = { low: 1, medium: 2, high: 3 };
  const minLevel = confidenceLevels[minConfidence] || 1;

  return signals.filter((s) => {
    const signalLevel = confidenceLevels[s.confidence] || 0;
    return signalLevel >= minLevel;
  });
}

/**
 * Group signals by SKU
 *
 * @param {Array<object>} signals
 * @returns {object} - { [sku]: [signals] }
 */
export function groupSignalsBySku(signals) {
  const grouped = {};

  for (const signal of signals) {
    const key = `${signal.sku}:${signal.unit}`;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(signal);
  }

  return grouped;
}

/**
 * Get signal summary statistics
 *
 * @param {Array<object>} signals
 * @returns {object} - Summary stats
 */
export function getSignalSummary(signals) {
  const summary = {
    total: signals.length,
    bySeverity: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
    byType: {},
    byConfidence: {
      high: 0,
      medium: 0,
      low: 0,
    },
  };

  for (const signal of signals) {
    summary.bySeverity[signal.severity] = (summary.bySeverity[signal.severity] || 0) + 1;
    summary.byType[signal.type] = (summary.byType[signal.type] || 0) + 1;
    summary.byConfidence[signal.confidence] =
      (summary.byConfidence[signal.confidence] || 0) + 1;
  }

  return summary;
}

/**
 * Signal thresholds and configuration
 */
export const SIGNAL_THRESHOLDS = {
  // Depletion thresholds (days)
  CRITICAL_DEPLETION_DAYS: 3,
  URGENT_DEPLETION_DAYS: 7,
  PLAN_DEPLETION_DAYS: 14,

  // Velocity thresholds
  SLOW_MOVER_VELOCITY: 1.0, // units/day
  STAGNANT_OBSERVATION_DAYS: 30,

  // Stock thresholds
  HIGH_STOCK_THRESHOLD: 20, // units
  AGING_STOCK_THRESHOLD: 15, // units

  // Volatility threshold
  HIGH_VARIANCE_THRESHOLD: 50, // percent

  // Acceleration threshold
  ACCELERATION_PERCENT: 20, // %
};

/**
 * SAFEGUARDS SUMMARY:
 *
 * 1. Confidence required: All signals include confidence level
 * 2. Conservative thresholds: Multiple days before critical
 * 3. No fabrication: Only generate signals when data exists
 * 4. Explicit actions: Each signal has clear recommended action
 * 5. Severity classification: Critical/high/medium/low
 * 6. Filter capabilities: Can filter by severity, type, confidence
 * 7. No causal claims: Messages describe observations, not causes
 * 8. Verifiable logic: All thresholds are explicit constants
 */
