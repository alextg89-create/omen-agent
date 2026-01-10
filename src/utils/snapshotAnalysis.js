/**
 * Snapshot Analysis - Delta Computation & Trend Detection
 *
 * Provides lightweight, rule-based explanatory layer for snapshots.
 *
 * STRICT CONSTRAINTS:
 * - No causality inference
 * - No AI-generated explanations
 * - No data fabrication
 * - Conservative language only
 * - Simple, transparent logic
 *
 * Purpose: Help clients understand "what changed" and "is it a pattern"
 */

/**
 * Compute delta between two snapshots
 *
 * Returns absolute change, percentage change, and direction
 *
 * @param {number} current - Current value
 * @param {number} previous - Previous value
 * @returns {object} - { absolute, percent, direction, hasComparison }
 */
function computeDelta(current, previous) {
  // Handle missing data
  if (current === undefined || current === null) {
    return {
      absolute: null,
      percent: null,
      direction: 'unknown',
      hasComparison: false
    };
  }

  if (previous === undefined || previous === null) {
    return {
      absolute: null,
      percent: null,
      direction: 'no_prior',
      hasComparison: false,
      current
    };
  }

  // Compute changes
  const absolute = current - previous;
  const percent = previous !== 0 ? ((absolute / previous) * 100) : null;

  // Determine direction (threshold: 0.5% to avoid noise)
  let direction = 'flat';
  if (percent !== null) {
    if (percent > 0.5) {
      direction = 'up';
    } else if (percent < -0.5) {
      direction = 'down';
    }
  } else if (absolute > 0) {
    direction = 'up';
  } else if (absolute < 0) {
    direction = 'down';
  }

  return {
    absolute: Number(absolute.toFixed(2)),
    percent: percent !== null ? Number(percent.toFixed(2)) : null,
    direction,
    hasComparison: true,
    current,
    previous
  };
}

/**
 * Compute deltas for snapshot metrics
 *
 * Compares current snapshot with previous snapshot (same store, same timeframe)
 *
 * @param {object} currentSnapshot - Current snapshot data
 * @param {object} previousSnapshot - Previous snapshot data (can be null)
 * @returns {object} - Delta analysis
 */
export function computeSnapshotDeltas(currentSnapshot, previousSnapshot) {
  const current = currentSnapshot.metrics || {};
  const previous = previousSnapshot?.metrics || {};

  return {
    hasComparison: !!previousSnapshot,
    comparisonDate: previousSnapshot?.asOfDate || null,

    totalRevenue: computeDelta(current.totalRevenue, previous.totalRevenue),
    totalProfit: computeDelta(current.totalProfit, previous.totalProfit),
    averageMargin: computeDelta(current.averageMargin, previous.averageMargin),
    itemsWithPricing: computeDelta(current.itemsWithPricing, previous.itemsWithPricing),

    // Recommendation counts
    promotionCount: computeDelta(
      currentSnapshot.recommendations?.promotions?.length || 0,
      previousSnapshot?.recommendations?.promotions?.length || 0
    ),
    inventoryActionCount: computeDelta(
      currentSnapshot.recommendations?.inventory?.length || 0,
      previousSnapshot?.recommendations?.inventory?.length || 0
    )
  };
}

/**
 * Detect trend from historical snapshots
 *
 * RULE-BASED LOGIC:
 * - Requires at least 3 snapshots
 * - Checks if direction is consistent
 * - Returns conservative classification
 *
 * @param {Array} historicalSnapshots - Array of snapshots (newest first)
 * @param {string} metricPath - Path to metric (e.g., 'metrics.totalRevenue')
 * @returns {object} - { trend, confidence, snapshotCount }
 */
export function detectTrend(historicalSnapshots, metricPath) {
  // Require at least 3 snapshots for trend
  if (!historicalSnapshots || historicalSnapshots.length < 3) {
    return {
      trend: 'insufficient_data',
      confidence: null,
      snapshotCount: historicalSnapshots?.length || 0,
      message: 'Need at least 3 snapshots to detect trends'
    };
  }

  // Extract metric values
  const values = historicalSnapshots
    .slice(0, 5) // Use last 5 snapshots max
    .map(snapshot => getNestedValue(snapshot, metricPath))
    .filter(v => v !== null && v !== undefined);

  if (values.length < 3) {
    return {
      trend: 'insufficient_data',
      confidence: null,
      snapshotCount: values.length,
      message: 'Metric not available in enough snapshots'
    };
  }

  // Compute deltas between consecutive snapshots
  const deltas = [];
  for (let i = 0; i < values.length - 1; i++) {
    deltas.push(values[i] - values[i + 1]);
  }

  // Count directions
  const upCount = deltas.filter(d => d > 0).length;
  const downCount = deltas.filter(d => d < 0).length;
  const flatCount = deltas.filter(d => d === 0).length;

  // Classify trend (conservative)
  let trend = 'stable';
  let confidence = null;

  const total = deltas.length;

  if (upCount >= total * 0.75) {
    // 75%+ increases
    trend = 'increasing';
    confidence = upCount / total;
  } else if (downCount >= total * 0.75) {
    // 75%+ decreases
    trend = 'decreasing';
    confidence = downCount / total;
  } else if (flatCount >= total * 0.75) {
    // 75%+ unchanged
    trend = 'stable';
    confidence = flatCount / total;
  } else {
    // Mixed signals
    trend = 'no_clear_trend';
    confidence = Math.max(upCount, downCount, flatCount) / total;
  }

  return {
    trend,
    confidence: confidence !== null ? Number(confidence.toFixed(2)) : null,
    snapshotCount: values.length,
    values: values.slice(0, 3) // Include last 3 values for reference
  };
}

/**
 * Get nested value from object using path
 *
 * @param {object} obj - Object to traverse
 * @param {string} path - Dot-notation path (e.g., 'metrics.totalRevenue')
 * @returns {any} - Value or null if not found
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => {
    return current?.[key];
  }, obj);
}

/**
 * Generate explanatory text for delta
 *
 * CONSERVATIVE LANGUAGE ONLY:
 * - "Revenue increased compared to last week"
 * - "Margin declined by 2.3%"
 * - No speculation, no causality
 *
 * @param {string} metricName - Human-readable metric name
 * @param {object} delta - Delta object from computeDelta()
 * @param {string} timeframe - 'weekly' or 'daily'
 * @returns {string} - Explanatory sentence
 */
export function explainDelta(metricName, delta, timeframe = 'weekly') {
  if (!delta.hasComparison) {
    return `${metricName}: No prior comparison available.`;
  }

  const { direction, absolute, percent, current, previous } = delta;
  const period = timeframe === 'weekly' ? 'last week' : 'last period';

  // Format values
  const formatValue = (val) => {
    if (metricName.includes('Margin') || metricName.includes('%')) {
      return `${val.toFixed(2)}%`;
    } else if (metricName.includes('Revenue') || metricName.includes('Profit') || metricName.includes('$')) {
      return `$${val.toLocaleString()}`;
    } else {
      return val.toString();
    }
  };

  const currentFormatted = formatValue(current);
  const previousFormatted = formatValue(previous);

  if (direction === 'flat') {
    return `${metricName}: ${currentFormatted} (unchanged from ${period})`;
  }

  const verb = direction === 'up' ? 'increased' : 'declined';
  const percentText = percent !== null ? ` (${Math.abs(percent).toFixed(1)}%)` : '';

  return `${metricName}: ${currentFormatted}, ${verb} from ${previousFormatted}${percentText}`;
}

/**
 * Generate explanatory text for trend
 *
 * CONSERVATIVE LANGUAGE ONLY:
 * - "Revenue has been increasing over the past 3 weeks"
 * - "Margins show no clear trend"
 *
 * @param {string} metricName - Human-readable metric name
 * @param {object} trendData - Trend object from detectTrend()
 * @param {string} timeframe - 'weekly' or 'daily'
 * @returns {string|null} - Explanatory sentence or null if no trend
 */
export function explainTrend(metricName, trendData, timeframe = 'weekly') {
  const { trend, snapshotCount } = trendData;

  if (trend === 'insufficient_data') {
    return null; // Don't mention lack of data in email
  }

  if (trend === 'no_clear_trend') {
    return null; // Don't clutter email with non-trends
  }

  const period = timeframe === 'weekly' ? `${snapshotCount} weeks` : `${snapshotCount} periods`;

  if (trend === 'increasing') {
    return `${metricName} has been increasing over the past ${period}.`;
  } else if (trend === 'decreasing') {
    return `${metricName} has been declining over the past ${period}.`;
  } else if (trend === 'stable') {
    return `${metricName} has remained stable over the past ${period}.`;
  }

  return null;
}

/**
 * Compute full analysis for snapshot
 *
 * Combines deltas and trends into cohesive explanation
 *
 * @param {object} currentSnapshot - Current snapshot
 * @param {object} previousSnapshot - Previous snapshot (can be null)
 * @param {Array} historicalSnapshots - Array of historical snapshots (for trends)
 * @returns {object} - { deltas, trends, explanations }
 */
export function analyzeSnapshot(currentSnapshot, previousSnapshot, historicalSnapshots = []) {
  // Compute deltas
  const deltas = computeSnapshotDeltas(currentSnapshot, previousSnapshot);

  // Detect trends (only if we have history)
  const trends = {};
  if (historicalSnapshots.length >= 3) {
    trends.revenue = detectTrend(historicalSnapshots, 'metrics.totalRevenue');
    trends.profit = detectTrend(historicalSnapshots, 'metrics.totalProfit');
    trends.margin = detectTrend(historicalSnapshots, 'metrics.averageMargin');
  }

  // Generate explanations
  const timeframe = currentSnapshot.timeframe || 'weekly';
  const explanations = {
    deltas: [],
    trends: []
  };

  // Delta explanations
  if (deltas.hasComparison) {
    explanations.deltas.push(explainDelta('Revenue', deltas.totalRevenue, timeframe));
    explanations.deltas.push(explainDelta('Profit', deltas.totalProfit, timeframe));
    explanations.deltas.push(explainDelta('Average Margin', deltas.averageMargin, timeframe));
  } else {
    explanations.deltas.push('This is the first snapshot for this timeframe. No prior comparison available.');
  }

  // Trend explanations (only if meaningful)
  if (historicalSnapshots.length >= 3) {
    const revenueTrend = explainTrend('Revenue', trends.revenue, timeframe);
    const profitTrend = explainTrend('Profit', trends.profit, timeframe);
    const marginTrend = explainTrend('Average margin', trends.margin, timeframe);

    if (revenueTrend) explanations.trends.push(revenueTrend);
    if (profitTrend) explanations.trends.push(profitTrend);
    if (marginTrend) explanations.trends.push(marginTrend);
  }

  return {
    deltas,
    trends,
    explanations
  };
}

/**
 * Edge case safeguards
 *
 * SAFEGUARDS:
 * 1. Missing data: Return null/no_prior, never fabricate
 * 2. Division by zero: Return null percent change
 * 3. Insufficient history: Require 3+ snapshots for trends
 * 4. Mixed signals: Classify as 'no_clear_trend'
 * 5. Threshold for "flat": 0.5% to avoid noise
 * 6. Conservative trend detection: 75% consistency required
 * 7. No smoothing or normalization
 * 8. No causal inference
 */
export const SAFEGUARDS = {
  MIN_TREND_SNAPSHOTS: 3,
  TREND_CONSISTENCY_THRESHOLD: 0.75, // 75% of deltas must agree
  FLAT_THRESHOLD_PERCENT: 0.5, // +/- 0.5% considered flat
  MAX_TREND_WINDOW: 5 // Only use last 5 snapshots for trend
};
