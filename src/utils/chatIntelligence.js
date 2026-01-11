/**
 * Chat Intelligence Layer
 *
 * Transforms flat data responses into insight-driven, actionable operator guidance
 * WITHOUT changing data sources or queries
 *
 * Design Philosophy:
 * - Headline insight (1 sentence)
 * - Why it matters (1-2 sentences)
 * - Concrete action (what to do)
 * - Confidence signal (based on real data)
 */

/**
 * Generate insight-driven response for promotion questions
 */
export function generatePromotionInsight(message, recommendations, metrics) {
  const promoRecs = recommendations?.promotions || [];
  const invRecs = recommendations?.inventory || [];

  // Case 1: Have promotion recommendations with velocity data
  if (promoRecs.length > 0) {
    const top = promoRecs[0];
    const margin = top.triggeringMetrics?.margin || 0;
    const stock = top.triggeringMetrics?.quantity || 0;
    const velocity = top.triggeringMetrics?.velocity || null;

    // Build headline based on signal strength
    let headline;
    if (velocity && velocity > 10) {
      headline = `${top.name} is your best move — it's already moving fast.`;
    } else if (margin > 65) {
      headline = `${top.name} gives you the most breathing room on margin.`;
    } else {
      headline = `${top.name} is your strongest promotion candidate.`;
    }

    // Build why
    let why = `${top.reason}`;
    if (stock < 10) {
      why += ` Stock is low (${stock} units) — promote NOW before you run out.`;
    } else if (stock > 50) {
      why += ` You have ${stock} units to work with.`;
    }

    // Build action
    let action;
    if (stock < 10) {
      action = `Feature it immediately in limited-time messaging.`;
    } else if (promoRecs.length > 2) {
      action = `Run it solo or bundle with ${promoRecs[1].name}.`;
    } else {
      action = `Promote this week and monitor depletion rate.`;
    }

    // Confidence
    const confidence = top.confidence >= 0.8 ? 'High confidence'
      : top.confidence >= 0.6 ? 'Medium confidence'
      : 'Early signal';

    return `${headline} ${why} ${action} (${confidence} — based on margin ${margin.toFixed(1)}%, stock level, and current velocity)`;
  }

  // Case 2: No promo recs, but have high-margin + low-stock items (OPPORTUNITY)
  const lowStockHighMargin = invRecs.filter(r =>
    r.action === 'REORDER_SOON' &&
    r.triggeringMetrics?.margin > 60
  );

  if (lowStockHighMargin.length > 0) {
    const item = lowStockHighMargin[0];
    const margin = item.triggeringMetrics.margin;
    const stock = item.triggeringMetrics.quantity;

    return `Your biggest profit leak isn't low margin — it's slow movers. ${item.name} (${margin.toFixed(1)}% margin, ${stock} units left) is burning shelf space. Discount or bundle within 72 hours to free capital. (Medium confidence — based on stock velocity and margin)`;
  }

  // Case 3: Fallback to highest margin item (always decisive)
  if (metrics?.highestMarginItem) {
    const item = metrics.highestMarginItem;
    const margin = item.margin || 0;

    return `${item.name} has your highest margin at ${margin.toFixed(1)}%. Without velocity data, margin is your safest bet. Promote it this week and watch how fast it moves — that'll tell you if it's a keeper. (Early signal — baseline ranking only)`;
  }

  return `Promotion opportunity unclear without velocity data. Focus on your highest-margin items and track which ones deplete fastest — that's your answer.`;
}

/**
 * Generate insight for low stock / reorder questions
 */
export function generateStockInsight(message, recommendations, metrics) {
  const invRecs = recommendations?.inventory || [];

  if (invRecs.length === 0) {
    return `Stock levels look healthy across the board. No critical reorders needed right now.`;
  }

  // Group by urgency
  const critical = invRecs.filter(r => r.triggeringMetrics?.quantity <= 2);
  const soon = invRecs.filter(r => r.triggeringMetrics?.quantity > 2 && r.triggeringMetrics?.quantity <= 5);
  const watch = invRecs.filter(r => r.triggeringMetrics?.quantity > 5 && r.triggeringMetrics?.quantity <= 10);

  let response = '';

  // Headline: Most urgent issue
  if (critical.length > 0) {
    response = `${critical.length} item${critical.length > 1 ? 's' : ''} at CRITICAL levels. `;
    const top = critical[0];
    const stock = top.triggeringMetrics.quantity;
    response += `${top.name} has only ${stock} unit${stock > 1 ? 's' : ''} left — you'll be out in days. `;
  } else if (soon.length > 0) {
    response = `${soon.length} item${soon.length > 1 ? 's' : ''} need reordering soon. `;
    const top = soon[0];
    response += `${top.name} (${top.triggeringMetrics.quantity} units) should be on your next order. `;
  } else {
    response = `${watch.length} item${watch.length > 1 ? 's' : ''} to watch. `;
    response += `${watch[0].name} is getting low. `;
  }

  // Action
  if (critical.length > 0) {
    const names = critical.slice(0, 3).map(r => r.name).join(', ');
    response += `Reorder NOW: ${names}. `;
  } else if (soon.length > 0) {
    response += `Add to next week's order. `;
  } else {
    response += `Monitor for next 2 weeks. `;
  }

  // Confidence
  response += `(High confidence — based on current stock counts)`;

  return response;
}

/**
 * Generate insight for margin questions
 */
export function generateMarginInsight(message, metrics) {
  if (!metrics) {
    return `Margin data unavailable. Check inventory and pricing configuration.`;
  }

  const avgMargin = metrics.averageMargin || 0;
  const highestItem = metrics.highestMarginItem;
  const lowestItem = metrics.lowestMarginItem;

  // Headline: Context on margin health
  let headline;
  if (avgMargin > 65) {
    headline = `Your margins are healthy at ${avgMargin.toFixed(1)}% average.`;
  } else if (avgMargin > 55) {
    headline = `Your margins are stable at ${avgMargin.toFixed(1)}% average.`;
  } else {
    headline = `Your margins are thin at ${avgMargin.toFixed(1)}% average.`;
  }

  // Why it matters
  let why = '';
  if (highestItem && lowestItem) {
    const spread = highestItem.margin - lowestItem.margin;
    if (spread > 20) {
      why = `Big spread: ${highestItem.name} (${highestItem.margin.toFixed(1)}%) vs ${lowestItem.name} (${lowestItem.margin.toFixed(1)}%). `;
    } else {
      why = `Margins are tight across products (${spread.toFixed(1)}% spread). `;
    }
  }

  // Action
  let action;
  if (avgMargin < 55) {
    action = `Consider raising prices on fast movers or cutting slow inventory.`;
  } else if (highestItem && highestItem.margin > 70) {
    action = `Push ${highestItem.name} (${highestItem.margin.toFixed(1)}%) — you have room to discount and still profit.`;
  } else {
    action = `Focus promotions on items above ${avgMargin.toFixed(0)}% margin to protect profitability.`;
  }

  return `${headline} ${why}${action} (Based on current inventory pricing only, not sales performance)`;
}

/**
 * Generate insight for "what should I promote" - THE CRITICAL QUESTION
 */
export function generateWhatToPromoteInsight(recommendations, metrics) {
  // This is the most important question operators ask
  // Must be DECISIVE even with limited data

  const promoRecs = recommendations?.promotions || [];
  const invRecs = recommendations?.inventory || [];

  // Strategy 1: Have velocity-based recommendations
  if (promoRecs.length > 0) {
    const top = promoRecs[0];
    const second = promoRecs[1];

    const margin = top.triggeringMetrics?.margin || 0;
    const stock = top.triggeringMetrics?.quantity || 0;

    let response = `${top.name}. `;

    // Why this one
    if (top.reason.toLowerCase().includes('velocity') || top.reason.toLowerCase().includes('moving')) {
      response += `It's already moving and has the momentum. `;
    } else if (margin > 65) {
      response += `You have the most margin cushion here. `;
    } else {
      response += `${top.reason} `;
    }

    // Risk/opportunity context
    if (stock < 10) {
      response += `Only ${stock} units left — promote hard but expect to sell out fast. `;
    } else if (stock > 50) {
      response += `${stock} units gives you room to run a sustained campaign. `;
    }

    // Alternative if they have it
    if (second) {
      response += `Backup option: ${second.name}. `;
    }

    // Confidence
    const conf = top.confidence >= 0.7 ? 'Medium confidence' : 'Early signal';
    response += `(${conf} — ${margin.toFixed(1)}% margin, stock level ${stock})`;

    return response;
  }

  // Strategy 2: No velocity data - use margin + stock intelligence
  if (metrics?.highestMarginItem) {
    const item = metrics.highestMarginItem;
    const margin = item.margin || 0;

    // Check if this item is also low stock (URGENCY)
    const isLowStock = invRecs.find(r => r.name === item.name);

    if (isLowStock) {
      const stock = isLowStock.triggeringMetrics?.quantity || 0;
      return `${item.name} — highest margin (${margin.toFixed(1)}%) AND low stock (${stock} units). Create urgency: "Almost gone, last chance." This is a double win. (High confidence — margin + scarcity)`;
    }

    return `${item.name} — it has your highest margin at ${margin.toFixed(1)}%. Without velocity data, I'm ranking by margin alone. Promote it and track depletion rate over 3 days — if it moves fast, you've found your winner. (Early signal)`;
  }

  return `Can't determine promotion priority without inventory data. Load inventory first.`;
}

/**
 * Main router: Detect question type and generate appropriate insight
 */
export function generateInsightResponse(message, recommendations, metrics) {
  const lower = message.toLowerCase();

  // Route to appropriate insight generator
  if (lower.includes('what should i promote') || lower.includes('what to promote')) {
    return generateWhatToPromoteInsight(recommendations, metrics);
  }

  if (lower.includes('promote') || lower.includes('feature') || lower.includes('highlight')) {
    return generatePromotionInsight(message, recommendations, metrics);
  }

  if (lower.includes('low stock') || lower.includes('reorder') || lower.includes('running out')) {
    return generateStockInsight(message, recommendations, metrics);
  }

  if (lower.includes('margin') || lower.includes('profit')) {
    return generateMarginInsight(message, metrics);
  }

  if (lower.includes('highest margin') || lower.includes('best margin')) {
    if (metrics?.highestMarginItem) {
      const item = metrics.highestMarginItem;
      const margin = item.margin || 0;

      // Check if promoting this is actually smart
      const invRecs = recommendations?.inventory || [];
      const isLowStock = invRecs.find(r => r.name === item.name);

      if (isLowStock && isLowStock.triggeringMetrics?.quantity <= 5) {
        return `${item.name} at ${margin.toFixed(1)}% margin. BUT: only ${isLowStock.triggeringMetrics.quantity} units left. Promoting this is risky unless you want to sell out fast. Consider your second-best margin item for sustained promotion. (High confidence)`;
      }

      return `${item.name} at ${margin.toFixed(1)}% margin. ${metrics.itemsWithPricing || 0} items analyzed. (Based on current pricing, not sales velocity)`;
    }
  }

  // Default: return null to use original LLM response
  return null;
}
