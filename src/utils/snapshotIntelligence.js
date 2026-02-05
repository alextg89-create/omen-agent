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

  // Core metrics - NULL propagation for financial values (never fabricate)
  const revenue = metrics.totalRevenue ?? null;
  const profit = metrics.totalProfit ?? null;
  const margin = metrics.averageMargin ?? null;
  const orderCount = velocity.orderCount || 0;  // Count can be 0

  // Previous period metrics (if available) - use ?? to preserve 0 values
  const prevMetrics = previousSnapshot?.metrics || {};
  const prevRevenue = prevMetrics.totalRevenue ?? null;
  const prevProfit = prevMetrics.totalProfit ?? null;
  const prevMargin = prevMetrics.averageMargin ?? null;
  const prevOrderCount = previousSnapshot?.velocity?.orderCount ?? null;

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
  // NULL propagation: if either value is null, delta is null
  if (previous === null || previous === undefined) return null;
  if (current === null || current === undefined) return null;

  const absolute = current - previous;
  const percent = previous !== 0 ? (absolute / previous) * 100 : null;  // NULL if dividing by zero

  return {
    absolute: Math.round(absolute * 100) / 100,
    percent: percent !== null ? Math.round(percent * 10) / 10 : null,
    direction: absolute > 0 ? 'up' : absolute < 0 ? 'down' : 'flat'
  };
}

/**
 * Generate a compelling headline based on the most significant change
 */
function generateHeadline(revenueDelta, profitDelta, marginDelta, orderDelta, snapshot) {
  // No comparison available
  if (!revenueDelta && !profitDelta) {
    const revenue = snapshot.metrics?.totalRevenue;
    const orderCount = snapshot.velocity?.orderCount || 0;
    if (orderCount > 0 && revenue !== null && revenue !== undefined) {
      return `${orderCount} orders generated $${revenue.toLocaleString()} in revenue this period.`;
    } else if (orderCount > 0) {
      return `${orderCount} orders tracked this period. Revenue data unavailable.`;
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
        text: `Average margin compressed ${Math.abs(d.absolute).toFixed(1)} points to ${snapshot.metrics?.averageMargin?.toFixed(1) ?? 'N/A'}%.`,
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
      margin: m.margin ?? null  // NULL if missing - never fabricate
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
      const cost = item.pricing?.cost ?? null;
      slowMovers.push({
        sku: item.sku || item.strain,
        name: item.name || `${item.strain} (${item.unit})`,
        unit: item.unit,
        quantity,
        dailyVelocity,
        daysToSellout: dailyVelocity > 0 ? Math.round(quantity / dailyVelocity) : null,
        margin: item.pricing?.margin ?? null,  // NULL if missing
        capitalTiedUp: cost !== null ? quantity * cost : null  // NULL if cost unknown
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

  // Revenue anomaly - only compare if both values exist
  const currentRevenue = snapshot.metrics?.totalRevenue;
  const prevRevenue = previousSnapshot?.metrics?.totalRevenue;

  if (prevRevenue !== null && prevRevenue !== undefined && prevRevenue > 0 &&
      currentRevenue !== null && currentRevenue !== undefined) {
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

  // POLICY: Only analyze ACTIVE SKUs (quantity > 0 or IN_STOCK status)
  // Inactive SKUs are preserved but excluded from margin analysis
  const activeInventory = inventory.filter(i =>
    i.quantity > 0 || i.inventoryStatus === 'IN_STOCK'
  );

  // Find items with known margin (must be non-null and positive)
  const itemsWithMargin = activeInventory.filter(i =>
    i.pricing?.margin !== null && i.pricing?.margin !== undefined && i.pricing.margin > 0
  );

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

  // Sort by margin (all items have valid margin here)
  const sorted = [...itemsWithMargin].sort((a, b) =>
    b.pricing.margin - a.pricing.margin
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
 * Generate OMEN's Verdict - THE single most important action
 *
 * This is the "if you do ONE thing this week" answer.
 * Ranks all signals and returns the highest-consequence action.
 */
export function generateOMENVerdict(snapshot, previousSnapshot = null) {
  const velocity = snapshot.velocity || {};
  const velocityMetrics = velocity.velocityMetrics || [];
  const recommendations = snapshot.recommendations || {};
  const metrics = snapshot.metrics || {};
  const rawInventory = snapshot.enrichedInventory || [];

  // POLICY: Only consider ACTIVE SKUs for verdicts
  // Inactive/out-of-stock SKUs are preserved but don't generate alerts
  const inventory = rawInventory.filter(i =>
    i.quantity > 0 || i.inventoryStatus === 'IN_STOCK'
  );

  // Collect all actionable signals with consequence scores
  const signals = [];

  // SIGNAL 1: Imminent stockout on high-velocity item (CRITICAL)
  const stockoutRisks = velocityMetrics.filter(v =>
    v.daysUntilStockout !== null &&
    v.daysUntilStockout <= 7 &&
    v.dailyVelocity >= 0.5
  );

  for (const risk of stockoutRisks) {
    // Only calculate consequence if we have price data
    const pricePerUnit = risk.revenue ?? risk.pricePerUnit ?? null;
    const lostRevenuePerDay = pricePerUnit !== null ? risk.dailyVelocity * pricePerUnit : null;
    signals.push({
      priority: 1,
      consequence: lostRevenuePerDay !== null ? lostRevenuePerDay * risk.daysUntilStockout : null,
      type: 'STOCKOUT_IMMINENT',
      action: `REORDER NOW: ${risk.name || risk.sku}`,
      reason: `Will stock out in ${risk.daysUntilStockout} days at current velocity (${risk.dailyVelocity.toFixed(1)}/day)`,
      consequence_text: lostRevenuePerDay !== null
        ? `If you don't act: You'll lose ~$${Math.round(lostRevenuePerDay * 7).toLocaleString()} in the next week from missed sales.`
        : `If you don't act: You'll miss sales. Revenue impact unknown (pricing data unavailable).`,
      item: risk.name || risk.sku
    });
  }

  // SIGNAL 2: High-margin item with low velocity = under-promoted (HIGH)
  // Only include items where margin is KNOWN (not null)
  const highMarginLowVelocity = inventory.filter(item => {
    const margin = item.pricing?.margin;
    if (margin === null || margin === undefined) return false;  // Skip unknown margins
    const vel = velocityMetrics.find(v => v.sku === item.sku || v.sku === item.strain);
    const velocity = vel?.dailyVelocity || 0;
    return margin >= 50 && velocity < 0.5 && item.quantity >= 10;
  });

  for (const item of highMarginLowVelocity.slice(0, 2)) {
    const margin = item.pricing.margin;  // Known to be non-null from filter
    const retail = item.pricing?.retail;
    const potentialProfit = retail !== null && retail !== undefined
      ? item.quantity * retail * (margin / 100)
      : null;
    signals.push({
      priority: 2,
      consequence: potentialProfit,
      type: 'UNDER_PROMOTED',
      action: `PROMOTE: ${item.name || item.strain}`,
      reason: `${margin.toFixed(0)}% margin but barely moving. You're sitting on profit.`,
      consequence_text: potentialProfit !== null
        ? `If you don't act: $${Math.round(potentialProfit).toLocaleString()} potential profit sits on the shelf while cash-flow tightens.`
        : `If you don't act: Significant profit potential sits on the shelf.`,
      item: item.name || item.strain
    });
  }

  // SIGNAL 3: Revenue decline needs diagnosis (HIGH)
  // Only compare if BOTH revenue values are known (not null)
  if (previousSnapshot) {
    const currentRev = metrics.totalRevenue;
    const prevRev = previousSnapshot?.metrics?.totalRevenue;
    if (prevRev !== null && prevRev !== undefined && prevRev > 0 &&
        currentRev !== null && currentRev !== undefined && currentRev < prevRev * 0.85) {
      const decline = ((prevRev - currentRev) / prevRev) * 100;
      signals.push({
        priority: 2,
        consequence: prevRev - currentRev,
        type: 'REVENUE_DECLINE',
        action: 'INVESTIGATE: Revenue down significantly',
        reason: `Revenue dropped ${decline.toFixed(0)}% vs last period ($${currentRev.toLocaleString()} vs $${prevRev.toLocaleString()})`,
        consequence_text: `If this continues: You're on track to lose $${Math.round((prevRev - currentRev) * 4).toLocaleString()} this month vs last month.`,
        item: null
      });
    }
  }

  // SIGNAL 4: Dead stock tying up capital (MEDIUM)
  const slowMovers = getSlowMovers(snapshot, 5);
  const totalCapitalTiedUp = slowMovers.reduce((sum, s) => sum + (s.capitalTiedUp || 0), 0);

  if (totalCapitalTiedUp >= 500) {
    signals.push({
      priority: 3,
      consequence: totalCapitalTiedUp,
      type: 'DEAD_STOCK',
      action: 'CLEAR OUT: Slow inventory blocking cash flow',
      reason: `${slowMovers.length} items with $${Math.round(totalCapitalTiedUp).toLocaleString()} tied up, moving at <0.2 units/day`,
      consequence_text: `If you don't act: That capital stays frozen while you pay carrying costs. Discount 20% and free up cash.`,
      item: slowMovers[0]?.name || null
    });
  }

  // SIGNAL 5: Margin compression (MEDIUM)
  // Only compare if BOTH margin values are known (not null)
  if (previousSnapshot) {
    const currentMargin = metrics.averageMargin;
    const prevMargin = previousSnapshot?.metrics?.averageMargin;
    if (prevMargin !== null && prevMargin !== undefined && prevMargin > 0 &&
        currentMargin !== null && currentMargin !== undefined && currentMargin < prevMargin - 5) {
      signals.push({
        priority: 3,
        consequence: (prevMargin - currentMargin) * 100,
        type: 'MARGIN_COMPRESSION',
        action: 'REVIEW PRICING: Margins are shrinking',
        reason: `Average margin dropped from ${prevMargin.toFixed(1)}% to ${currentMargin.toFixed(1)}%`,
        consequence_text: `If this continues: Every $100 in sales now makes you $${(currentMargin).toFixed(0)} instead of $${prevMargin.toFixed(0)}. That adds up fast.`,
        item: null
      });
    }
  }

  // Sort by priority, then by consequence magnitude
  signals.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.consequence - a.consequence;
  });

  const topSignal = signals[0] || null;
  const runnerUp = signals[1] || null;

  return {
    verdict: topSignal ? topSignal.action : 'Business looks stable. Optimize incrementally.',
    verdictType: topSignal?.type || 'STABLE',
    reason: topSignal?.reason || 'No critical signals detected.',
    consequence: topSignal?.consequence_text || 'Continue monitoring velocity and margins.',
    focusItem: topSignal?.item || null,
    runnerUp: runnerUp ? {
      action: runnerUp.action,
      reason: runnerUp.reason
    } : null,
    signalCount: signals.length,
    allSignals: signals.slice(0, 5).map(s => ({
      type: s.type,
      action: s.action,
      item: s.item
    }))
  };
}

/**
 * Generate consequence forecasts - "If this continues for 2 weeks..."
 */
export function forecastConsequences(snapshot, previousSnapshot = null) {
  const forecasts = [];
  const velocity = snapshot.velocity || {};
  const velocityMetrics = velocity.velocityMetrics || [];
  const metrics = snapshot.metrics || {};

  // Forecast 1: Stock depletion timeline
  const riskItems = velocityMetrics.filter(v =>
    v.daysUntilStockout !== null &&
    v.daysUntilStockout <= 14 &&
    v.dailyVelocity > 0
  );

  if (riskItems.length > 0) {
    const soonest = riskItems.sort((a, b) => a.daysUntilStockout - b.daysUntilStockout)[0];
    forecasts.push({
      type: 'stockout_forecast',
      horizon: '2 weeks',
      prediction: `${soonest.name || soonest.sku} will be out of stock in ${soonest.daysUntilStockout} days`,
      impact: riskItems.length > 1
        ? `${riskItems.length - 1} other items also at risk of stockout within 2 weeks.`
        : 'No other immediate stockout risks.',
      action: 'Place orders now for lead time coverage.'
    });
  }

  // Forecast 2: Revenue trajectory - only if both values are known
  const currentRev = metrics.totalRevenue;
  const prevRev = previousSnapshot?.metrics?.totalRevenue;
  if (previousSnapshot && currentRev !== null && currentRev !== undefined &&
      prevRev !== null && prevRev !== undefined) {
    const weeklyChange = currentRev - prevRev;
    const monthlyProjection = currentRev + (weeklyChange * 3); // 3 more weeks

    if (Math.abs(weeklyChange) >= prevRev * 0.05) {
      forecasts.push({
        type: 'revenue_forecast',
        horizon: '1 month',
        prediction: weeklyChange > 0
          ? `At current trajectory, monthly revenue will be ~$${Math.round(monthlyProjection).toLocaleString()}`
          : `Revenue trending down. Projected monthly: ~$${Math.round(Math.max(0, monthlyProjection)).toLocaleString()}`,
        impact: weeklyChange > 0
          ? `That's ${((monthlyProjection / (prevRev * 4)) * 100 - 100).toFixed(0)}% above baseline.`
          : `That's ${((1 - monthlyProjection / (prevRev * 4)) * 100).toFixed(0)}% below baseline.`,
        action: weeklyChange > 0
          ? 'Keep momentum. Ensure top sellers stay stocked.'
          : 'Diagnose the drop. Check traffic, pricing, and product mix.'
      });
    }
  }

  // Forecast 3: Margin pressure - only if margin is known
  const avgMargin = metrics.averageMargin;
  if (avgMargin !== null && avgMargin !== undefined && avgMargin > 0 && avgMargin < 45) {
    forecasts.push({
      type: 'margin_forecast',
      horizon: 'ongoing',
      prediction: `Operating at ${avgMargin.toFixed(1)}% margin leaves little room for error`,
      impact: 'A 10% discount on any item could push you into loss territory.',
      action: 'Review supplier costs or raise prices on low-margin SKUs.'
    });
  }

  // Forecast 4: Velocity acceleration (good news)
  const accelerating = velocityMetrics.filter(v => {
    if (!previousSnapshot?.velocity?.velocityMetrics) return false;
    const prev = previousSnapshot.velocity.velocityMetrics.find(p => p.sku === v.sku);
    return prev && v.dailyVelocity > prev.dailyVelocity * 1.5;
  });

  if (accelerating.length > 0) {
    const top = accelerating[0];
    forecasts.push({
      type: 'momentum_forecast',
      horizon: '2 weeks',
      prediction: `${top.name || top.sku} is accelerating (+${((top.dailyVelocity / (previousSnapshot?.velocity?.velocityMetrics?.find(p => p.sku === top.sku)?.dailyVelocity || 1)) * 100 - 100).toFixed(0)}% velocity)`,
      impact: 'This could become a top performer if sustained.',
      action: 'Ensure stock depth and consider featuring prominently.'
    });
  }

  return forecasts;
}

/**
 * Get top SKUs by profit contribution (margin * quantity * retail)
 * EXCLUDES SKUs without cost data - they have no valid margin
 *
 * @param {object} snapshot - Current snapshot
 * @param {number} limit - Max items to return
 * @returns {Array} Top profit contributors
 */
export function getTopProfitContributors(snapshot, limit = 3) {
  const inventory = snapshot.enrichedInventory || [];

  // STRICT: Only include items with hasCost=true (valid cost/margin data)
  const withProfit = inventory
    .filter(i => i.hasCost === true && i.pricing?.margin !== null && i.pricing?.retail !== null && i.quantity > 0)
    .map(i => {
      const potentialProfit = i.quantity * i.pricing.retail * (i.pricing.margin / 100);
      return {
        sku: i.sku,
        name: i.name || `${i.strain} (${i.unit})`,
        quantity: i.quantity,
        retail: i.pricing.retail,
        margin: i.pricing.margin,
        potentialProfit: Math.round(potentialProfit),
        profitPerUnit: Math.round(i.pricing.retail * (i.pricing.margin / 100) * 100) / 100
      };
    })
    .sort((a, b) => b.potentialProfit - a.potentialProfit);

  return withProfit.slice(0, limit);
}

/**
 * Find hidden opportunities - high margin + good stock + low velocity
 * These are "money left on the table"
 *
 * @param {object} snapshot - Current snapshot
 * @param {number} limit - Max items
 * @returns {Array} Hidden opportunities
 */
export function findHiddenOpportunities(snapshot, limit = 3) {
  const inventory = snapshot.enrichedInventory || [];
  const velocityMetrics = snapshot.velocity?.velocityMetrics || [];

  const opportunities = [];

  for (const item of inventory) {
    const margin = item.pricing?.margin;
    const retail = item.pricing?.retail;
    const quantity = item.quantity || 0;

    // Skip if missing data
    if (margin === null || margin === undefined || retail === null || quantity < 5) continue;
    if (margin < 50) continue; // Only high-margin items

    // Check velocity
    const vel = velocityMetrics.find(v => v.sku === item.sku);
    const dailyVelocity = vel?.dailyVelocity || 0;

    // High margin (>=50%) + good stock (>=5) + low velocity (<0.5/day) = opportunity
    if (dailyVelocity < 0.5) {
      const potentialProfit = quantity * retail * (margin / 100);
      const daysToSellout = dailyVelocity > 0 ? Math.round(quantity / dailyVelocity) : 999;

      opportunities.push({
        sku: item.sku,
        name: item.name || `${item.strain} (${item.unit})`,
        margin: Math.round(margin),
        quantity,
        retail,
        dailyVelocity,
        potentialProfit: Math.round(potentialProfit),
        daysToSellout,
        insight: daysToSellout > 60
          ? `At current pace, this will sit for ${daysToSellout}+ days. That's ${Math.round(potentialProfit)} in profit waiting.`
          : `Moving slowly. Promote to capture ${Math.round(potentialProfit)} in profit.`
      });
    }
  }

  return opportunities
    .sort((a, b) => b.potentialProfit - a.potentialProfit)
    .slice(0, limit);
}

/**
 * Generate the WOW factor insight
 * Combines multiple signals to create a non-obvious recommendation
 *
 * @param {object} snapshot - Current snapshot
 * @param {object} previousSnapshot - Previous snapshot (optional)
 * @returns {object|null} WOW insight or null
 */
export function generateWowInsight(snapshot, previousSnapshot = null) {
  const inventory = snapshot.enrichedInventory || [];
  const velocityMetrics = snapshot.velocity?.velocityMetrics || [];
  const metrics = snapshot.metrics || {};

  // Collect data for multi-signal analysis
  const itemsWithFullData = inventory.filter(i =>
    i.pricing?.margin !== null &&
    i.pricing?.retail !== null &&
    i.pricing?.cost !== null &&
    i.quantity > 0
  );

  if (itemsWithFullData.length < 5) return null;

  // WOW INSIGHT 1: "You're promoting the wrong things"
  // Find if high-margin items are being outpaced by low-margin items
  const marginBuckets = {
    high: itemsWithFullData.filter(i => i.pricing.margin >= 60),
    low: itemsWithFullData.filter(i => i.pricing.margin < 40)
  };

  const highMarginVelocity = marginBuckets.high.reduce((sum, i) => {
    const vel = velocityMetrics.find(v => v.sku === i.sku);
    return sum + (vel?.dailyVelocity || 0);
  }, 0) / (marginBuckets.high.length || 1);

  const lowMarginVelocity = marginBuckets.low.reduce((sum, i) => {
    const vel = velocityMetrics.find(v => v.sku === i.sku);
    return sum + (vel?.dailyVelocity || 0);
  }, 0) / (marginBuckets.low.length || 1);

  if (lowMarginVelocity > highMarginVelocity * 1.5 && marginBuckets.high.length >= 3) {
    const topHighMargin = marginBuckets.high
      .sort((a, b) => b.pricing.margin - a.pricing.margin)
      .slice(0, 2);

    // Calculate the dollar impact of the misalignment
    const avgHighMarginProfit = marginBuckets.high.reduce((sum, i) => {
      const vel = velocityMetrics.find(v => v.sku === i.sku);
      const dailyProfit = (vel?.dailyVelocity || 0) * i.pricing.retail * (i.pricing.margin / 100);
      return sum + dailyProfit;
    }, 0);

    const avgLowMarginProfit = marginBuckets.low.reduce((sum, i) => {
      const vel = velocityMetrics.find(v => v.sku === i.sku);
      const dailyProfit = (vel?.dailyVelocity || 0) * i.pricing.retail * (i.pricing.margin / 100);
      return sum + dailyProfit;
    }, 0);

    // What would happen if we shifted 20% of low-margin sales to high-margin?
    const avgHighRetail = marginBuckets.high.reduce((sum, i) => sum + i.pricing.retail, 0) / marginBuckets.high.length;
    const avgHighMargin = marginBuckets.high.reduce((sum, i) => sum + i.pricing.margin, 0) / marginBuckets.high.length;
    const shiftedUnits = lowMarginVelocity * marginBuckets.low.length * 0.2 * 7; // 20% shifted over 7 days
    const potentialGain = Math.round(shiftedUnits * avgHighRetail * (avgHighMargin / 100));

    return {
      type: 'MISALIGNED_PROMOTION',
      headline: "You're promoting the wrong products",
      insight: `Your low-margin items are selling ${(lowMarginVelocity / highMarginVelocity).toFixed(1)}x faster than high-margin ones. Low-margin items generated ~$${Math.round(avgLowMarginProfit * 7).toLocaleString()} in profit this week vs $${Math.round(avgHighMarginProfit * 7).toLocaleString()} from high-margin.`,
      action: `Feature these instead: ${topHighMargin.map(i => i.name || i.sku).join(', ')}. They have 60%+ margins but are being overlooked.`,
      impact: `Shifting 20% of sales to high-margin items = +$${potentialGain.toLocaleString()} weekly profit.`,
      dollarImpact: potentialGain,
      confidence: 'high'
    };
  }

  // WOW INSIGHT 2: "Your best-seller is about to become a problem"
  // High velocity item with dwindling stock AND high margin
  const criticalItems = velocityMetrics
    .filter(v => v.daysUntilStockout !== null && v.daysUntilStockout <= 10 && v.dailyVelocity >= 1)
    .map(v => {
      const item = inventory.find(i => i.sku === v.sku);
      return { ...v, margin: item?.pricing?.margin, retail: item?.pricing?.retail };
    })
    .filter(v => v.margin !== null && v.margin >= 40);

  if (criticalItems.length > 0) {
    const mostCritical = criticalItems.sort((a, b) => a.daysUntilStockout - b.daysUntilStockout)[0];
    const dailyRevenue = mostCritical.dailyVelocity * (mostCritical.retail || 0);
    const dailyProfit = dailyRevenue * (mostCritical.margin / 100);

    return {
      type: 'CRITICAL_RESTOCK',
      headline: `${mostCritical.name || mostCritical.sku} needs attention NOW`,
      insight: `This item sells ${mostCritical.dailyVelocity.toFixed(1)} units/day at ${mostCritical.margin}% margin. At current pace, you'll be out in ${mostCritical.daysUntilStockout} days.`,
      action: `Order immediately. Every day without stock = $${Math.round(dailyProfit)} in lost profit.`,
      impact: `A 1-week stockout would cost you ~$${Math.round(dailyProfit * 7)} in pure profit.`,
      confidence: 'high'
    };
  }

  // WOW INSIGHT 3: "Your inventory mix is costing you"
  // Calculate what % of capital is tied up in low-margin vs high-margin items
  const capitalByMargin = {
    high: marginBuckets.high.reduce((sum, i) => sum + (i.quantity * (i.pricing.cost || 0)), 0),
    low: marginBuckets.low.reduce((sum, i) => sum + (i.quantity * (i.pricing.cost || 0)), 0)
  };

  const totalCapital = capitalByMargin.high + capitalByMargin.low;
  if (totalCapital > 0 && capitalByMargin.low > capitalByMargin.high * 1.5) {
    const lowCapitalPercent = Math.round((capitalByMargin.low / totalCapital) * 100);

    return {
      type: 'CAPITAL_MISALLOCATION',
      headline: "Your cash is stuck in the wrong products",
      insight: `${lowCapitalPercent}% of your inventory capital ($${Math.round(capitalByMargin.low).toLocaleString()}) is tied up in low-margin items (<40% margin).`,
      action: `Discount slow-moving low-margin items by 15-20% to free up cash. Reinvest in high-margin inventory.`,
      impact: `Rebalancing could improve overall margins by 5-10 points.`,
      confidence: 'medium'
    };
  }

  // WOW INSIGHT 4: IDLE PROFIT - High-margin items sitting on shelves
  // This is REAL quantified profit waiting to be captured
  const idleHighMargin = marginBuckets.high.filter(i => {
    const vel = velocityMetrics.find(v => v.sku === i.sku);
    return (vel?.dailyVelocity || 0) < 0.3 && i.quantity >= 5;
  });

  if (idleHighMargin.length >= 2) {
    const totalIdleProfit = idleHighMargin.reduce((sum, i) => {
      const potentialProfit = i.quantity * i.pricing.retail * (i.pricing.margin / 100);
      return sum + potentialProfit;
    }, 0);

    const totalIdleUnits = idleHighMargin.reduce((sum, i) => sum + i.quantity, 0);
    const topIdle = idleHighMargin
      .sort((a, b) => (b.quantity * b.pricing.retail * b.pricing.margin) - (a.quantity * a.pricing.retail * a.pricing.margin))
      .slice(0, 3);

    // Calculate if we could sell 30% of idle inventory at a 15% discount
    const discountedSales = totalIdleProfit * 0.3 * 0.85; // 30% of stock at 85% of margin

    return {
      type: 'IDLE_PROFIT',
      headline: `$${Math.round(totalIdleProfit).toLocaleString()} in profit is sitting idle`,
      insight: `${idleHighMargin.length} high-margin items (${totalIdleUnits} units total) are barely moving. This is real profit trapped in slow-moving inventory.`,
      action: `Promote: ${topIdle.map(i => i.name || i.sku).join(', ')}. Even a 15% discount captures most of the margin.`,
      impact: `Moving 30% of idle stock = ~$${Math.round(discountedSales).toLocaleString()} in profit recovered.`,
      dollarImpact: Math.round(discountedSales),
      items: topIdle.map(i => ({
        name: i.name || i.sku,
        margin: i.pricing.margin,
        quantity: i.quantity,
        potentialProfit: Math.round(i.quantity * i.pricing.retail * (i.pricing.margin / 100))
      })),
      confidence: 'high'
    };
  }

  // WOW INSIGHT 5: Week-over-week momentum shift
  if (previousSnapshot?.velocity?.velocityMetrics) {
    const prevVelocity = previousSnapshot.velocity.velocityMetrics;

    // Find items that flipped from slow to fast
    const accelerators = [];
    for (const current of velocityMetrics) {
      const prev = prevVelocity.find(p => p.sku === current.sku);
      if (prev && prev.dailyVelocity < 0.3 && current.dailyVelocity >= 0.8) {
        const item = inventory.find(i => i.sku === current.sku);
        if (item) {
          const weeklyProfit = current.dailyVelocity * 7 * (item.pricing?.retail || 0) * ((item.pricing?.margin || 0) / 100);
          accelerators.push({
            name: current.name || current.sku,
            prevVelocity: prev.dailyVelocity,
            currentVelocity: current.dailyVelocity,
            margin: item?.pricing?.margin,
            weeklyProfit: Math.round(weeklyProfit)
          });
        }
      }
    }

    if (accelerators.length > 0) {
      const top = accelerators.sort((a, b) => (b.weeklyProfit || 0) - (a.weeklyProfit || 0))[0];
      return {
        type: 'MOMENTUM_SHIFT',
        headline: `${top.name} just caught fire`,
        insight: `Velocity jumped from ${top.prevVelocity.toFixed(1)} to ${top.currentVelocity.toFixed(1)} units/day - a ${Math.round((top.currentVelocity / top.prevVelocity - 1) * 100)}% increase.`,
        action: top.margin && top.margin >= 50
          ? `This is a high-margin item. Double down - feature it prominently and ensure stock depth.`
          : `Monitor closely. If momentum holds, consider stocking up.`,
        impact: `At current velocity: ~$${top.weeklyProfit.toLocaleString()} weekly profit from this item alone.`,
        dollarImpact: top.weeklyProfit,
        confidence: 'medium'
      };
    }
  }

  // WOW INSIGHT 6: Single SKU dominance (one item driving majority of profit)
  const profitByItem = itemsWithFullData.map(i => {
    const vel = velocityMetrics.find(v => v.sku === i.sku);
    const weeklyProfit = (vel?.dailyVelocity || 0) * 7 * i.pricing.retail * (i.pricing.margin / 100);
    return {
      ...i,
      weeklyProfit: Math.round(weeklyProfit),
      dailyVelocity: vel?.dailyVelocity || 0
    };
  }).sort((a, b) => b.weeklyProfit - a.weeklyProfit);

  const totalWeeklyProfit = profitByItem.reduce((sum, i) => sum + i.weeklyProfit, 0);
  if (totalWeeklyProfit > 0 && profitByItem[0]?.weeklyProfit > totalWeeklyProfit * 0.25) {
    const top = profitByItem[0];
    const percentage = Math.round((top.weeklyProfit / totalWeeklyProfit) * 100);

    return {
      type: 'CONCENTRATION_RISK',
      headline: `${percentage}% of profit comes from one SKU`,
      insight: `${top.name || top.sku} generated $${top.weeklyProfit.toLocaleString()} this week - that's ${percentage}% of total profit. If this item stocks out, your revenue takes a serious hit.`,
      action: top.quantity < 15 ? `URGENT: Only ${top.quantity} units left. Reorder immediately.` : `Ensure deep stock and consider promoting a backup high-margin item.`,
      impact: `A 1-week stockout on this SKU = -$${top.weeklyProfit.toLocaleString()} in profit.`,
      dollarImpact: top.weeklyProfit,
      confidence: 'high'
    };
  }

  return null;
}

/**
 * Enrich snapshot with intelligence layer
 *
 * @param {object} snapshot - Current snapshot
 * @param {object} previousSnapshot - Previous snapshot (optional)
 * @returns {object} Enriched snapshot with intelligence
 */
export function enrichSnapshotWithIntelligence(snapshot, previousSnapshot = null) {
  const executiveSummary = generateExecutiveSummary(snapshot, previousSnapshot);
  const topSKUs = getTopSKUsByVelocity(snapshot, 5);
  const slowMovers = getSlowMovers(snapshot, 5);
  const anomalies = detectAnomalies(snapshot, previousSnapshot);
  const marginAnalysis = analyzeMargins(snapshot);
  const verdict = generateOMENVerdict(snapshot, previousSnapshot);
  const forecasts = forecastConsequences(snapshot, previousSnapshot);

  // NEW: Enhanced insights
  const topProfitContributors = getTopProfitContributors(snapshot, 3);
  const hiddenOpportunities = findHiddenOpportunities(snapshot, 3);
  const wowInsight = generateWowInsight(snapshot, previousSnapshot);

  return {
    ...snapshot,
    intelligence: {
      // THE BRIEFING - What to read first
      verdict,
      wowInsight,  // THE insight that makes them say "wow"
      forecasts,

      // ACTIONABLE INSIGHTS
      topProfitContributors,
      hiddenOpportunities,

      // DETAILED ANALYSIS
      executiveSummary,
      topSKUs,
      slowMovers,
      anomalies,
      marginAnalysis,

      // META
      generatedAt: new Date().toISOString(),
      hasComparison: previousSnapshot !== null
    }
  };
}
