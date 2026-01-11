/**
 * Velocity Computation Engine
 *
 * Computes rate-of-sale metrics from sales event data
 *
 * KEY CONCEPTS:
 * - Velocity = units sold per time period (day, week)
 * - Depletion = estimated days until stock runs out
 * - Confidence = reliability of forecast based on data quality
 *
 * SAFEGUARDS:
 * - Never extrapolate beyond observed data
 * - Require minimum observation window (7 days)
 * - Mark low-confidence results explicitly
 * - Return zero (not null) when no sales observed
 * - Flag insufficient data scenarios
 */

import { querySalesEvents, getDailySalesAggregate } from "./salesVolumeStore.js";

/**
 * Compute velocity for a SKU
 *
 * SAFEGUARDS:
 * - Requires at least 7 days of data
 * - Returns velocity=0 (not null) if no sales
 * - Includes confidence scoring
 *
 * @param {string} storeId
 * @param {string} sku
 * @param {number} observationDays - Days to look back (default 30)
 * @returns {Promise<object>} - Velocity metrics
 */
export async function computeVelocity(storeId, sku, observationDays = 30) {
  // SAFEGUARD: Require minimum observation window
  if (observationDays < 7) {
    return {
      sku,
      velocity: null,
      dailyVelocity: null,
      weeklyVelocity: null,
      confidence: "insufficient_data",
      reason: "Observation window too short (minimum 7 days required)",
      observationDays,
    };
  }

  // Get sales events for observation period
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - observationDays);

  try {
    const salesEvents = await querySalesEvents(storeId, startDate, endDate);
    const skuEvents = salesEvents.filter((e) => e.sku === sku);

    const totalUnitsSold = skuEvents.reduce((sum, e) => sum + e.quantity, 0);

    // SAFEGUARD: No sales = zero velocity (high confidence that there are no sales)
    if (totalUnitsSold === 0) {
      return {
        sku,
        dailyVelocity: 0,
        weeklyVelocity: 0,
        totalUnitsSold: 0,
        observationDays,
        daysWithSales: 0,
        confidence: "high", // High confidence that there are NO sales
        message: `No sales observed in ${observationDays} days`,
      };
    }

    // Compute velocity
    const dailyVelocity = totalUnitsSold / observationDays;
    const weeklyVelocity = dailyVelocity * 7;

    // CONFIDENCE SCORING: More days + more sales = higher confidence
    // Count unique days with sales
    const daysWithSales = new Set(
      skuEvents.map((e) => new Date(e.soldAt).toISOString().split("T")[0])
    ).size;

    let confidence = "low";
    if (daysWithSales >= 20 && totalUnitsSold >= 10) {
      confidence = "high"; // Lots of data points
    } else if (daysWithSales >= 10 && totalUnitsSold >= 5) {
      confidence = "medium"; // Moderate data
    }
    // else: low confidence (sparse sales)

    return {
      sku,
      dailyVelocity: Number(dailyVelocity.toFixed(2)),
      weeklyVelocity: Number(weeklyVelocity.toFixed(2)),
      totalUnitsSold,
      observationDays,
      daysWithSales,
      confidence,
      message: `${totalUnitsSold} units sold over ${observationDays} days (${daysWithSales} days with sales)`,
    };
  } catch (error) {
    console.error(`Error computing velocity for ${sku}:`, error);
    return {
      sku,
      dailyVelocity: null,
      weeklyVelocity: null,
      confidence: "error",
      reason: error.message,
      observationDays,
    };
  }
}

/**
 * Compute days until depletion
 *
 * SAFEGUARDS:
 * - Returns null if velocity is zero (infinite time)
 * - Returns 0 if already out of stock
 * - Flags low-confidence forecasts
 * - Never extrapolates beyond reasonable bounds
 *
 * @param {number} quantityOnHand - Current inventory quantity
 * @param {number} dailyVelocity - Daily sales velocity
 * @param {string} velocityConfidence - Confidence of velocity measurement
 * @returns {object} - { daysUntilDepletion, confidence, message }
 */
export function computeDaysUntilDepletion(quantityOnHand, dailyVelocity, velocityConfidence = "medium") {
  // SAFEGUARD: No velocity = can't forecast
  if (dailyVelocity === 0 || dailyVelocity === null || dailyVelocity === undefined) {
    return {
      daysUntilDepletion: null,
      confidence: "no_data",
      message: "No sales velocity - cannot forecast depletion",
    };
  }

  // SAFEGUARD: Already out of stock
  if (quantityOnHand === 0 || quantityOnHand === null || quantityOnHand === undefined) {
    return {
      daysUntilDepletion: 0,
      confidence: "high",
      message: "Item already out of stock",
    };
  }

  // SAFEGUARD: Negative quantity (data error)
  if (quantityOnHand < 0) {
    return {
      daysUntilDepletion: 0,
      confidence: "error",
      message: "Invalid quantity (negative value)",
    };
  }

  const daysUntilDepletion = quantityOnHand / dailyVelocity;

  // Confidence based on:
  // 1. Velocity confidence (from sales data)
  // 2. Reasonableness of forecast timeframe
  let confidence = velocityConfidence;

  // Adjust confidence based on forecast horizon
  if (daysUntilDepletion < 3) {
    // Near-term forecast - maintain or boost confidence
    if (confidence === "medium") confidence = "high";
  } else if (daysUntilDepletion > 90) {
    // Far future - reduce confidence
    if (confidence === "high") confidence = "medium";
    if (confidence === "medium") confidence = "low";
  }

  return {
    daysUntilDepletion: Math.ceil(daysUntilDepletion),
    confidence,
    message: `Estimated ${Math.ceil(daysUntilDepletion)} days until depletion at current rate`,
  };
}

/**
 * Compute velocity for all inventory items
 *
 * @param {string} storeId
 * @param {Array<object>} inventory - Current inventory snapshot
 * @param {number} observationDays - Days to look back (default 30)
 * @returns {Promise<Array<object>>} - Velocity metrics for each SKU
 */
export async function computeInventoryVelocities(storeId, inventory, observationDays = 30) {
  if (!Array.isArray(inventory) || inventory.length === 0) {
    return [];
  }

  const results = [];

  for (const item of inventory) {
    // Use 'strain' field as SKU (matches current inventory schema)
    const sku = item.strain || item.sku;
    if (!sku) {
      console.warn("Inventory item missing SKU:", item);
      continue;
    }

    // Compute velocity
    const velocity = await computeVelocity(storeId, sku, observationDays);

    // Compute depletion forecast
    const depletion = computeDaysUntilDepletion(
      item.quantity || 0,
      velocity.dailyVelocity,
      velocity.confidence
    );

    results.push({
      sku,
      unit: item.unit,
      quantityOnHand: item.quantity || 0,
      velocity,
      depletion,
    });
  }

  return results;
}

/**
 * Get velocity trends (compare current vs previous period)
 *
 * @param {string} storeId
 * @param {string} sku
 * @param {number} currentPeriodDays - Current observation window
 * @param {number} previousPeriodDays - Previous observation window
 * @returns {Promise<object>} - { current, previous, delta, trend }
 */
export async function getVelocityTrend(
  storeId,
  sku,
  currentPeriodDays = 30,
  previousPeriodDays = 30
) {
  // Compute current period velocity
  const current = await computeVelocity(storeId, sku, currentPeriodDays);

  // Compute previous period velocity
  // Offset by current period length to avoid overlap
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - currentPeriodDays);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - previousPeriodDays);

  const salesEvents = await querySalesEvents(storeId, startDate, endDate);
  const skuEvents = salesEvents.filter((e) => e.sku === sku);
  const totalUnitsSold = skuEvents.reduce((sum, e) => sum + e.quantity, 0);
  const previousVelocity = totalUnitsSold / previousPeriodDays;

  // Compute delta
  let delta = null;
  let percentChange = null;
  let trend = "unknown";

  if (current.dailyVelocity !== null && previousVelocity !== null) {
    delta = current.dailyVelocity - previousVelocity;
    percentChange = previousVelocity > 0 ? (delta / previousVelocity) * 100 : null;

    // Classify trend (threshold: 20% change)
    if (percentChange !== null) {
      if (percentChange > 20) {
        trend = "accelerating";
      } else if (percentChange < -20) {
        trend = "decelerating";
      } else {
        trend = "stable";
      }
    }
  }

  return {
    sku,
    current: {
      dailyVelocity: current.dailyVelocity,
      periodDays: currentPeriodDays,
      confidence: current.confidence,
    },
    previous: {
      dailyVelocity: Number(previousVelocity.toFixed(2)),
      periodDays: previousPeriodDays,
      totalUnitsSold,
    },
    delta: delta !== null ? Number(delta.toFixed(2)) : null,
    percentChange: percentChange !== null ? Number(percentChange.toFixed(1)) : null,
    trend,
  };
}

/**
 * Get top movers (highest velocity items)
 *
 * @param {Array<object>} velocityResults - Results from computeInventoryVelocities
 * @param {number} limit - Number of items to return
 * @returns {Array<object>} - Top velocity items
 */
export function getTopMovers(velocityResults, limit = 10) {
  return velocityResults
    .filter((item) => item.velocity.dailyVelocity > 0)
    .sort((a, b) => b.velocity.dailyVelocity - a.velocity.dailyVelocity)
    .slice(0, limit);
}

/**
 * Get slow movers (zero or very low velocity)
 *
 * @param {Array<object>} velocityResults
 * @param {number} maxVelocity - Maximum velocity threshold (default 0.5 units/day)
 * @returns {Array<object>} - Slow moving items
 */
export function getSlowMovers(velocityResults, maxVelocity = 0.5) {
  return velocityResults
    .filter(
      (item) =>
        item.velocity.dailyVelocity <= maxVelocity && item.quantityOnHand > 0
    )
    .sort((a, b) => b.quantityOnHand - a.quantityOnHand);
}

/**
 * Get items at risk of depletion
 *
 * @param {Array<object>} velocityResults
 * @param {number} maxDays - Maximum days threshold (default 14)
 * @param {string} minConfidence - Minimum confidence level (default 'low')
 * @returns {Array<object>} - Items at risk
 */
export function getDepletionRisks(velocityResults, maxDays = 14, minConfidence = "low") {
  const confidenceLevels = { low: 1, medium: 2, high: 3 };
  const minLevel = confidenceLevels[minConfidence] || 1;

  return velocityResults
    .filter((item) => {
      const days = item.depletion.daysUntilDepletion;
      const conf = confidenceLevels[item.depletion.confidence] || 0;
      return days !== null && days <= maxDays && conf >= minLevel;
    })
    .sort((a, b) => a.depletion.daysUntilDepletion - b.depletion.daysUntilDepletion);
}

/**
 * Constants and thresholds
 */
export const VELOCITY_THRESHOLDS = {
  MIN_OBSERVATION_DAYS: 7,
  DEFAULT_OBSERVATION_DAYS: 30,
  SLOW_MOVER_THRESHOLD: 0.5, // units/day
  CRITICAL_DEPLETION_DAYS: 3,
  URGENT_DEPLETION_DAYS: 7,
  PLAN_DEPLETION_DAYS: 14,
  ACCELERATION_THRESHOLD_PERCENT: 20, // %
};

/**
 * SAFEGUARDS SUMMARY:
 *
 * 1. Minimum observation window: 7 days
 * 2. Zero sales = velocity 0 (not null)
 * 3. No velocity = no depletion forecast
 * 4. Confidence scoring based on data density
 * 5. Near-term forecasts have higher confidence
 * 6. Far-future forecasts have lower confidence
 * 7. Never extrapolate beyond observed patterns
 * 8. All null values explicitly marked with reason
 */
