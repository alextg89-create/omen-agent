/**
 * Snapshot Intelligence Layer
 *
 * Transforms raw snapshot data into executive-level insights
 * All computations are IN-MEMORY from existing aggregated data
 *
 * NO new queries. NO external dependencies. Pure derivation.
 */

/**
 * Generate executive summary from snapshot data
 *
 * @param {object} snapshot - Current snapshot
 * @param {object} previousSnapshot - Previous snapshot (for comparison)
 * @returns {object} Executive summary
 */
export function generateExecutiveSummary(snapshot, previousSnapshot = null) {
  const metrics = snapshot.metrics || {};
  const velocity = snapshot.velocity || {};
  const recommendations = snapshot.recommendations || {};

  // Core metrics
  const revenue = metrics.totalRevenue || 0;
  const profit = metrics.totalProfit || 0;
  const margin = metrics.averageMargin || 0;
  const orderCount = velocity.orderCount || 0;

  // Previous period metrics (if available)
  const prevMetrics = previousSnapshot?.metrics || {};
  const prevRevenue = prevMetrics.totalRevenue || null;
  const prevProfit = prevMetrics.totalProfit || null;
  const prevMargin = prevMetrics.averageMargin || null;
  const prevOrderCount = previousSnapshot?.velocity?.orderCount || null;

  // Compute deltas
  const revenueDelta = prevRevenue !== null ? computeDelta(revenue, prevRevenue) : null;
  const profitDelta = prevProfit !== null ? computeDelta(profit, prevProfit) : null;
  const marginDelta = prevMargin !== null ? computeDelta(margin, prevMargin) : null;
  const orderDelta = prevOrderCount !== null ? computeDelta(orderCount, prevOrderCount) : null;

  // Generate headline
  const headline = generateHeadline(revenueDelta, profitDelta, marginDelta, orderDelta, snapshot);

  // Generate key insights
  const keyInsights = generateKeyInsights(snapshot, previousSnapshot, {
    revenueDelta, profitDelta, marginDelta, orderDelta
  });

  // Urgent actions (from recommendations)
  const urgentActions = extractUrgentActions(recommendations);

  return {
    headline,
    keyInsights,
    urgentActions,
    metrics: {
      revenue: { current: revenue, delta: revenueDelta },
      profit: { current: profit, delta: profitDelta },
      margin: { current: margin, delta: marginDelta },
      orders: { current: orderCount, delta: orderDelta }
    },
    hasComparison: previousSnapshot !== null,
    comparisonDate: previousSnapshot?.asOfDate || null,
    confidence: snapshot.confidence || 'medium'
  };
}

/**
 * Compute delta between current and previous value
 */
function computeDelta(current, previous) {
  if (previous === null || previous === undefined) return null;

  const absolute = current - previous;
  const percent = previous !== 0 ? (absolute / previous) * 100 : 0;

  return {
    absolute: Math.round(absolute * 100) / 100,
    percent: Math.round(percent * 10) / 10,
    direction: absolute > 0 ? 'up' : absolute < 0 ? 'down' : 'flat'
  };
}

/**
 * Generate a compelling headline based on the most significant change
 */
function generateHeadline(revenueDelta, profitDelta, marginDelta, orderDelta, snapshot) {
  // No comparison available
  if (!revenueDelta && !profitDelta) {
    const revenue = snapshot.metrics?.totalRevenue || 0;
    const orderCount = snapshot.velocity?.orderCount || 0;
    if (orderCount > 0) {
      return `${orderCount} orders generated $${revenue.toLocaleString()} in revenue this period.`;
    }
    return `Snapshot generated. No order data available for this period.`;
  }

  // Find the most significant signal
  const signals = [];

  if (revenueDelta) {
    const magnitude = Math.abs(revenueDelta.percent);
    if (magnitude >= 10) {
      signals.push({
        type: 'revenue',
        direction: revenueDelta.direction,
        magnitude,
        text: revenueDelta.direction === 'up'
          ? `Revenue surged ${revenueDelta.percent.toFixed(1)}% week-over-week`
          : `Revenue dropped ${Math.abs(revenueDelta.percent).toFixed(1)}% week-over-week`
      });
    }
  }

  if (profitDelta) {
    const magnitude = Math.abs(profitDelta.percent);
    if (magnitude >= 15) {
      signals.push({
        type: 'profit',
        direction: profitDelta.direction,
        magnitude,
        text: profitDelta.direction === 'up'
          ? `Profit jumped ${profitDelta.percent.toFixed(1)}%`
          : `Profit fell ${Math.abs(profitDelta.percent).toFixed(1)}%`
      });
    }
  }

  if (marginDelta && Math.abs(marginDelta.absolute) >= 2) {
    signals.push({
      type: 'margin',
      direction: marginDelta.direction,
      magnitude: Math.abs(marginDelta.absolute),
      text: marginDelta.direction === 'up'
        ? `Margins improved ${marginDelta.absolute.toFixed(1)} points`
        : `Margins compressed ${Math.abs(marginDelta.absolute).toFixed(1)} points`
    });
  }

  if (orderDelta && Math.abs(orderDelta.percent) >= 20) {
    signals.push({
      type: 'orders',
      direction: orderDelta.direction,
      magnitude: Math.abs(orderDelta.percent),
      text: orderDelta.direction === 'up'
        ? `Order volume up ${orderDelta.percent.toFixed(0)}%`
        : `Order volume down ${Math.abs(orderDelta.percent).toFixed(0)}%`
    });
  }

  // Sort by magnitude and return the most significant
  signals.sort((a, b) => b.magnitude - a.magnitude);

  if (signals.length > 0) {
    return signals[0].text + '.';
  }

  // Stable performance
  return `Performance stable week-over-week. Focus on optimization opportunities.`;
}

/**
 * Generate key insights from snapshot comparison
 */
function generateKeyInsights(snapshot, previousSnapshot, deltas) {
  const insights = [];
  const velocity = snapshot.velocity || {};
  const velocityMetrics = velocity.velocityMetrics || [];

  // Insight 1: Revenue story
  if (deltas.revenueDelta) {
    const d = deltas.revenueDelta;
    if (d.direction === 'down' && Math.abs(d.percent) >= 5) {
      // Dig into WHY revenue is down
      const orderDelta = deltas.orderDelta;
      if (orderDelta && orderDelta.direction === 'down') {
        insights.push({
          type: 'revenue_decline',
          severity: Math.abs(d.percent) >= 15 ? 'high' : 'medium',
          text: `Revenue declined ${Math.abs(d.percent).toFixed(1)}% driven by ${Math.abs(orderDelta.percent).toFixed(0)}% fewer orders.`,
          action: 'Review marketing and customer acquisition channels.'
        });
      } else {
        insights.push({
          type: 'revenue_decline',
          severity: 'medium',
          text: `Revenue declined ${Math.abs(d.percent).toFixed(1)}% despite stable order volume.`,
          action: 'Check average order value and product mix.'
        });
      }
    } else if (d.direction === 'up' && d.percent >= 10) {
      insights.push({
        type: 'revenue_growth',
        severity: 'positive',
        text: `Revenue grew ${d.percent.toFixed(1)}% week-over-week.`,
        action: 'Identify winning products and double down.'
      });
    }
  }

  // Insight 2: Margin pressure
  if (deltas.marginDelta) {
    const d = deltas.marginDelta;
    if (d.direction === 'down' && Math.abs(d.absolute) >= 2) {
      insights.push({
        type: 'margin_compression',
        severity: Math.abs(d.absolute) >= 5 ? 'high' : 'medium',
        text: `Average margin compressed ${Math.abs(d.absolute).toFixed(1)} points to ${snapshot.metrics?.averageMargin?.toFixed(1) || 0}%.`,
        action: 'Review pricing or supplier costs.'
      });
    }
  }

  // Insight 3: Top velocity SKUs
  if (velocityMetrics.length > 0) {
    const topMovers = velocityMetrics
      .filter(m => m.dailyVelocity > 0)
      .sort((a, b) => b.dailyVelocity - a.dailyVelocity)
      .slice(0, 3);

    if (topMovers.length > 0) {
      const names = topMovers.map(m => m.name || m.sku).join(', ');
      insights.push({
        type: 'top_velocity',
        severity: 'info',
        text: `Fastest movers: ${names}.`,
        action: 'Ensure stock levels and consider featuring in promotions.'
      });
    }
  }

  // Insight 4: Stock alerts from velocity
  const stockAlerts = (velocity.insights || []).filter(i =>
    i.type === 'URGENT_RESTOCK' || i.priority === 'HIGH'
  );

  if (stockAlerts.length > 0) {
    const names = stockAlerts.slice(0, 3).map(a => a.name).join(', ');
    insights.push({
      type: 'stock_alert',
      severity: 'high',
      text: `${stockAlerts.length} item(s) at risk of stockout: ${names}.`,
      action: 'Reorder immediately to avoid lost sales.'
    });
  }

  // Insight 5: Dead stock
  const recommendations = snapshot.recommendations || {};
  const deadStock = (recommendations.inventory || []).filter(r =>
    r.action === 'REVIEW' || r.reason?.toLowerCase().includes('no sales')
  );

  if (deadStock.length >= 3) {
    insights.push({
      type: 'dead_stock',
      severity: 'medium',
      text: `${deadStock.length} items show no movement this period.`,
      action: 'Consider discounting or bundling to clear inventory.'
    });
  }

  return insights;
}

/**
 * Extract urgent actions from recommendations
 */
function extractUrgentActions(recommendations) {
  const actions = [];

  // High-priority inventory actions
  const inventoryRecs = recommendations.inventory || [];
  const urgent = inventoryRecs.filter(r =>
    r.triggeringMetrics?.quantity <= 3 ||
    r.action === 'REORDER_NOW' ||
    r.priority === 'HIGH'
  );

  for (const rec of urgent.slice(0, 5)) {
    actions.push({
      type: 'reorder',
      item: rec.name || rec.sku,
      reason: rec.reason || `Only ${rec.triggeringMetrics?.quantity || 0} units left`,
      urgency: 'high'
    });
  }

  // High-margin promotion opportunities
  const promoRecs = recommendations.promotions || [];
  const topPromo = promoRecs[0];
  if (topPromo && topPromo.triggeringMetrics?.margin > 60) {
    actions.push({
      type: 'promote',
      item: topPromo.name || topPromo.sku,
      reason: `${topPromo.triggeringMetrics.margin.toFixed(0)}% margin - promote for quick profit`,
      urgency: 'medium'
    });
  }

  return actions;
}

/**
 * Identify top performing SKUs by velocity
 *
 * @param {object} snapshot - Current snapshot
 * @param {number} limit - Max items to return
 * @returns {Array} Top SKUs
 */
export function getTopSKUsByVelocity(snapshot, limit = 5) {
  const velocityMetrics = snapshot.velocity?.velocityMetrics || [];

  return velocityMetrics
    .filter(m => m.dailyVelocity > 0)
    .sort((a, b) => b.dailyVelocity - a.dailyVelocity)
    .slice(0, limit)
    .map(m => ({
      sku: m.sku,
      name: m.name || m.sku,
      unit: m.unit,
      dailyVelocity: m.dailyVelocity,
      totalSold: m.totalSold,
      currentStock: m.currentStock,
      daysUntilStockout: m.daysUntilStockout,
      margin: m.margin || 0
    }));
}

/**
 * Identify slow-moving inventory
 *
 * @param {object} snapshot - Current snapshot
 * @param {number} limit - Max items to return
 * @returns {Array} Slow movers
 */
export function getSlowMovers(snapshot, limit = 5) {
  const velocityMetrics = snapshot.velocity?.velocityMetrics || [];
  const inventory = snapshot.enrichedInventory || [];

  // Items with stock but low/no velocity
  const slowMovers = [];

  for (const item of inventory) {
    const velocity = velocityMetrics.find(v =>
      v.sku === item.sku || v.sku === item.strain
    );

    const dailyVelocity = velocity?.dailyVelocity || 0;
    const quantity = item.quantity || 0;

    if (quantity >= 5 && dailyVelocity < 0.2) {
      slowMovers.push({
        sku: item.sku || item.strain,
        name: item.name || `${item.strain} (${item.unit})`,
        unit: item.unit,
        quantity,
        dailyVelocity,
        daysToSellout: dailyVelocity > 0 ? Math.round(quantity / dailyVelocity) : null,
        margin: item.pricing?.margin || 0,
        capitalTiedUp: quantity * (item.pricing?.cost || 0)
      });
    }
  }

  return slowMovers
    .sort((a, b) => (b.capitalTiedUp || 0) - (a.capitalTiedUp || 0))
    .slice(0, limit);
}

/**
 * Detect anomalies in snapshot data
 *
 * @param {object} snapshot - Current snapshot
 * @param {object} previousSnapshot - Previous snapshot
 * @returns {Array} Anomalies detected
 */
export function detectAnomalies(snapshot, previousSnapshot) {
  const anomalies = [];

  if (!previousSnapshot) return anomalies;

  const currentVelocity = snapshot.velocity?.velocityMetrics || [];
  const prevVelocity = previousSnapshot?.velocity?.velocityMetrics || [];

  // Build lookup for previous period
  const prevMap = new Map();
  for (const v of prevVelocity) {
    prevMap.set(v.sku, v);
  }

  // Check for significant changes
  for (const current of currentVelocity) {
    const prev = prevMap.get(current.sku);

    if (!prev) continue;

    // Velocity spike (>100% increase)
    if (prev.dailyVelocity > 0 && current.dailyVelocity > 0) {
      const change = ((current.dailyVelocity - prev.dailyVelocity) / prev.dailyVelocity) * 100;

      if (change >= 100) {
        anomalies.push({
          type: 'velocity_spike',
          severity: 'info',
          sku: current.sku,
          name: current.name || current.sku,
          message: `${current.name || current.sku} velocity doubled (+${change.toFixed(0)}%)`,
          previousValue: prev.dailyVelocity,
          currentValue: current.dailyVelocity,
          changePercent: change
        });
      } else if (change <= -50) {
        anomalies.push({
          type: 'velocity_drop',
          severity: 'warning',
          sku: current.sku,
          name: current.name || current.sku,
          message: `${current.name || current.sku} velocity dropped ${Math.abs(change).toFixed(0)}%`,
          previousValue: prev.dailyVelocity,
          currentValue: current.dailyVelocity,
          changePercent: change
        });
      }
    }
  }

  // Revenue anomaly
  const currentRevenue = snapshot.metrics?.totalRevenue || 0;
  const prevRevenue = previousSnapshot?.metrics?.totalRevenue || 0;

  if (prevRevenue > 0) {
    const revenueChange = ((currentRevenue - prevRevenue) / prevRevenue) * 100;

    if (Math.abs(revenueChange) >= 30) {
      anomalies.push({
        type: revenueChange > 0 ? 'revenue_spike' : 'revenue_drop',
        severity: revenueChange > 0 ? 'info' : 'warning',
        message: revenueChange > 0
          ? `Revenue spiked ${revenueChange.toFixed(0)}% week-over-week`
          : `Revenue dropped ${Math.abs(revenueChange).toFixed(0)}% week-over-week`,
        previousValue: prevRevenue,
        currentValue: currentRevenue,
        changePercent: revenueChange
      });
    }
  }

  return anomalies;
}

/**
 * Generate margin intelligence
 *
 * @param {object} snapshot - Current snapshot
 * @returns {object} Margin analysis
 */
export function analyzeMargins(snapshot) {
  const metrics = snapshot.metrics || {};
  const inventory = snapshot.enrichedInventory || [];

  // Find items by margin
  const itemsWithMargin = inventory.filter(i => i.pricing?.margin > 0);

  if (itemsWithMargin.length === 0) {
    return {
      averageMargin: null,
      highestMargin: null,
      lowestMargin: null,
      marginDistribution: null,
      marginLeaders: [],
      marginLaggards: []
    };
  }

  // Sort by margin
  const sorted = [...itemsWithMargin].sort((a, b) =>
    (b.pricing?.margin || 0) - (a.pricing?.margin || 0)
  );

  const marginLeaders = sorted.slice(0, 3).map(i => ({
    sku: i.sku || i.strain,
    name: i.name || `${i.strain} (${i.unit})`,
    margin: i.pricing?.margin,
    quantity: i.quantity
  }));

  const marginLaggards = sorted.slice(-3).reverse().map(i => ({
    sku: i.sku || i.strain,
    name: i.name || `${i.strain} (${i.unit})`,
    margin: i.pricing?.margin,
    quantity: i.quantity
  }));

  // Margin distribution
  const high = itemsWithMargin.filter(i => i.pricing?.margin >= 60).length;
  const medium = itemsWithMargin.filter(i => i.pricing?.margin >= 40 && i.pricing?.margin < 60).length;
  const low = itemsWithMargin.filter(i => i.pricing?.margin < 40).length;

  return {
    averageMargin: metrics.averageMargin,
    highestMargin: metrics.highestMarginItem,
    lowestMargin: metrics.lowestMarginItem,
    marginDistribution: {
      high: { count: high, percent: Math.round((high / itemsWithMargin.length) * 100) },
      medium: { count: medium, percent: Math.round((medium / itemsWithMargin.length) * 100) },
      low: { count: low, percent: Math.round((low / itemsWithMargin.length) * 100) }
    },
    marginLeaders,
    marginLaggards
  };
}

/**
 * Enrich snapshot with intelligence layer
 *
 * @param {object} snapshot - Current snapshot
 * @param {object} previousSnapshot - Previous snapshot (optional)
 * @returns {object} Enriched snapshot with intelligence
 */
export function enrichSnapshotWithIntelligence(snapshot, previousSnapshot = null) {
  return {
    ...snapshot,
    intelligence: {
      executiveSummary: generateExecutiveSummary(snapshot, previousSnapshot),
      topSKUs: getTopSKUsByVelocity(snapshot, 5),
      slowMovers: getSlowMovers(snapshot, 5),
      anomalies: detectAnomalies(snapshot, previousSnapshot),
      marginAnalysis: analyzeMargins(snapshot),
      generatedAt: new Date().toISOString()
    }
  };
}
