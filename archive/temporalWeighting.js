/**
 * Temporal Weighting System
 *
 * Applies time decay to signals and metrics
 *
 * KEY CONCEPT:
 * More recent data should have more influence than older data
 *
 * FORMULA:
 * weight = e^(-λ * age_in_days)
 *
 * where λ (lambda) = decay constant
 *
 * EXAMPLES with λ=0.1:
 * - 1 day old:  weight = 0.90
 * - 7 days old: weight = 0.50
 * - 14 days old: weight = 0.25
 * - 30 days old: weight = 0.05
 *
 * USE CASES:
 * - Weight recent snapshots more heavily in trend analysis
 * - Reduce confidence of stale signals
 * - Prioritize fresh recommendations
 */

/**
 * Compute exponential time decay weight
 *
 * More recent timestamps get higher weight (closer to 1)
 * Older timestamps get lower weight (closer to 0)
 *
 * @param {Date|string} timestamp - When signal occurred
 * @param {number} decayConstant - λ value (default 0.1)
 * @returns {number} - Weight between 0 and 1
 */
export function computeTimeWeight(timestamp, decayConstant = 0.1) {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  const ageInDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);

  // Exponential decay: e^(-λt)
  return Math.exp(-decayConstant * ageInDays);
}

/**
 * Apply time weighting to array of values
 *
 * More recent values have more influence on the average
 *
 * @param {Array<object>} items - Array of { value, timestamp }
 * @param {number} decayConstant - λ value (default 0.1)
 * @returns {number} - Weighted average
 */
export function computeWeightedAverage(items, decayConstant = 0.1) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  let weightedSum = 0;
  let totalWeight = 0;

  for (const item of items) {
    const weight = computeTimeWeight(item.timestamp, decayConstant);
    weightedSum += item.value * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : null;
}

/**
 * Compute confidence based on recency
 *
 * Recent data = high confidence
 * Old data = low confidence
 *
 * @param {Date|string} timestamp - When signal occurred
 * @returns {string} - 'high', 'medium', 'low', 'stale'
 */
export function computeRecencyConfidence(timestamp) {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  const ageInDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);

  if (ageInDays < 1) return "high"; // Less than 1 day old
  if (ageInDays < 7) return "medium"; // Less than 1 week old
  if (ageInDays < 14) return "low"; // Less than 2 weeks old
  return "stale"; // Older than 2 weeks
}

/**
 * Compute age-adjusted confidence
 *
 * Combines base confidence with recency penalty
 *
 * @param {string} baseConfidence - 'high', 'medium', 'low'
 * @param {Date|string} timestamp - When signal occurred
 * @returns {string} - Adjusted confidence level
 */
export function adjustConfidenceForAge(baseConfidence, timestamp) {
  const recencyConfidence = computeRecencyConfidence(timestamp);

  const levels = { stale: 0, low: 1, medium: 2, high: 3 };
  const baseLevel = levels[baseConfidence] || 1;
  const recencyLevel = levels[recencyConfidence] || 1;

  // Take minimum of base and recency (most conservative)
  const adjustedLevel = Math.min(baseLevel, recencyLevel);

  const levelNames = ["stale", "low", "medium", "high"];
  return levelNames[adjustedLevel];
}

/**
 * Apply time decay to snapshot deltas
 *
 * Weight recent snapshots more heavily when computing trends
 *
 * @param {Array<object>} snapshots - Array of snapshots with generatedAt
 * @param {string} metricPath - Metric to extract (e.g., 'metrics.totalRevenue')
 * @param {number} decayConstant - λ value
 * @returns {number} - Time-weighted average of metric
 */
export function computeWeightedTrend(snapshots, metricPath, decayConstant = 0.1) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return null;
  }

  const items = snapshots
    .map((snapshot) => ({
      value: getNestedValue(snapshot, metricPath),
      timestamp: snapshot.generatedAt,
    }))
    .filter((item) => item.value !== null && item.value !== undefined);

  return computeWeightedAverage(items, decayConstant);
}

/**
 * Get nested value from object using dot path
 *
 * @param {object} obj - Object to traverse
 * @param {string} path - Dot-notation path (e.g., 'metrics.totalRevenue')
 * @returns {any} - Value or null if not found
 */
function getNestedValue(obj, path) {
  return path.split(".").reduce((current, key) => {
    return current?.[key];
  }, obj);
}

/**
 * Calculate signal urgency score with time decay
 *
 * Combines severity level with recency
 * Recent critical signals score higher than old critical signals
 *
 * @param {string} severity - 'critical', 'high', 'medium', 'low'
 * @param {Date|string} timestamp - When signal was detected
 * @param {number} decayConstant - λ value (default 0.1)
 * @returns {number} - Urgency score (0-100)
 */
export function computeSignalUrgency(severity, timestamp, decayConstant = 0.1) {
  // Base severity scores
  const severityScores = {
    critical: 100,
    high: 75,
    medium: 50,
    low: 25,
  };

  const baseScore = severityScores[severity] || 0;

  // Apply time decay
  const timeWeight = computeTimeWeight(timestamp, decayConstant);

  // Urgency = base score * time weight
  return Math.round(baseScore * timeWeight);
}

/**
 * Sort items by time-weighted priority
 *
 * @param {Array<object>} items - Items with severity and timestamp
 * @param {number} decayConstant - λ value
 * @returns {Array<object>} - Sorted items (highest urgency first)
 */
export function sortByTimeWeightedPriority(items, decayConstant = 0.1) {
  return items
    .map((item) => ({
      ...item,
      urgencyScore: computeSignalUrgency(item.severity, item.timestamp, decayConstant),
    }))
    .sort((a, b) => b.urgencyScore - a.urgencyScore);
}

/**
 * Filter out stale items
 *
 * @param {Array<object>} items - Items with timestamp
 * @param {number} maxAgeInDays - Maximum age to keep (default 30)
 * @returns {Array<object>} - Filtered items
 */
export function filterStaleItems(items, maxAgeInDays = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeInDays);

  return items.filter((item) => {
    const itemDate =
      typeof item.timestamp === "string" ? new Date(item.timestamp) : item.timestamp;
    return itemDate >= cutoffDate;
  });
}

/**
 * Decay constants for different use cases
 */
export const DECAY_CONSTANTS = {
  FAST: 0.2, // Strong decay - halves in ~3.5 days
  MEDIUM: 0.1, // Moderate decay - halves in ~7 days
  SLOW: 0.05, // Gentle decay - halves in ~14 days
  VERY_SLOW: 0.02, // Minimal decay - halves in ~35 days
};

/**
 * Age thresholds for confidence adjustment
 */
export const AGE_THRESHOLDS = {
  FRESH: 1, // < 1 day = high confidence
  RECENT: 7, // < 7 days = medium confidence
  AGING: 14, // < 14 days = low confidence
  STALE: 30, // > 30 days = stale
};

/**
 * Example: Weight snapshot recommendations by age
 *
 * @param {object} snapshot - Snapshot with recommendations
 * @returns {object} - Snapshot with time-adjusted confidence
 */
export function applyTemporalWeightingToSnapshot(snapshot) {
  if (!snapshot.generatedAt) {
    return snapshot; // No timestamp - can't apply weighting
  }

  // Adjust overall confidence based on age
  const ageConfidence = computeRecencyConfidence(snapshot.generatedAt);
  const adjustedConfidence = adjustConfidenceForAge(snapshot.confidence || "medium", snapshot.generatedAt);

  // Apply time weighting to recommendations
  const weightedRecommendations = {
    promotions: snapshot.recommendations?.promotions?.map((rec) => ({
      ...rec,
      ageAdjustedConfidence: adjustConfidenceForAge(
        rec.confidence >= 0.8 ? "high" : rec.confidence >= 0.5 ? "medium" : "low",
        snapshot.generatedAt
      ),
    })) || [],
    pricing: snapshot.recommendations?.pricing?.map((rec) => ({
      ...rec,
      ageAdjustedConfidence: adjustConfidenceForAge(
        rec.confidence >= 0.8 ? "high" : rec.confidence >= 0.5 ? "medium" : "low",
        snapshot.generatedAt
      ),
    })) || [],
    inventory: snapshot.recommendations?.inventory?.map((rec) => ({
      ...rec,
      ageAdjustedConfidence: adjustConfidenceForAge(
        rec.confidence >= 0.8 ? "high" : rec.confidence >= 0.5 ? "medium" : "low",
        snapshot.generatedAt
      ),
    })) || [],
  };

  return {
    ...snapshot,
    ageConfidence,
    adjustedConfidence,
    recommendations: weightedRecommendations,
    temporalMetadata: {
      generatedAt: snapshot.generatedAt,
      ageInDays: Math.floor((Date.now() - new Date(snapshot.generatedAt)) / (1000 * 60 * 60 * 24)),
      timeWeight: computeTimeWeight(snapshot.generatedAt, DECAY_CONSTANTS.MEDIUM),
    },
  };
}

/**
 * USAGE EXAMPLES:
 *
 * 1. Weight snapshots for trend analysis:
 *    const trend = computeWeightedTrend(snapshots, 'metrics.totalRevenue', DECAY_CONSTANTS.MEDIUM);
 *
 * 2. Adjust signal confidence for age:
 *    const adjustedConf = adjustConfidenceForAge('high', signal.timestamp);
 *
 * 3. Sort signals by time-weighted urgency:
 *    const sorted = sortByTimeWeightedPriority(signals, DECAY_CONSTANTS.FAST);
 *
 * 4. Filter out stale recommendations:
 *    const fresh = filterStaleItems(recommendations, 14);
 */
