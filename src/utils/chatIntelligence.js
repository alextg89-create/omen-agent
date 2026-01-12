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

    // Build headline based on signal strength - MORE EXCITING
    let headline;
    if (velocity && velocity > 10) {
      headline = `${top.name} — this one's HOT. Already moving fast and primed for promotion.`;
    } else if (margin > 65) {
      headline = `${top.name} — fat ${margin.toFixed(1)}% margin means you can push hard and still win.`;
    } else {
      headline = `${top.name} is your strongest play right now.`;
    }

    // Build why - SHOW THE URGENCY OR OPPORTUNITY
    let why = `${top.reason}.`;
    if (stock < 10) {
      why += ` CRITICAL: Only ${stock} unit${stock === 1 ? '' : 's'} left. This is a scarcity play — create urgency, sell out fast, bank profit.`;
    } else if (stock > 50) {
      why += ` You're stocked deep with ${stock} units — run a sustained campaign without fear of running dry.`;
    } else {
      why += ` ${stock} units on hand — enough for a solid push without overextending.`;
    }

    // Build action - CONCRETE AND TIME-BOUND
    let action;
    if (stock < 10) {
      action = `Feature it NOW with "Almost Gone" messaging. Don't wait — this is a 48-hour move.`;
    } else if (promoRecs.length > 2) {
      action = `Run it solo as hero product, or bundle with ${promoRecs[1].name} for margin stacking.`;
    } else {
      action = `Feature it this week and track daily depletion — if it moves fast, reorder and ride the wave.`;
    }

    // Confidence
    const confidence = top.confidence >= 0.8 ? 'High confidence'
      : top.confidence >= 0.6 ? 'Medium confidence'
      : 'Early signal';

    return `${headline} ${why} ${action} (${confidence} — ${margin.toFixed(1)}% margin, stock level ${stock}${velocity ? `, velocity tracked` : ''})`;
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

  // Headline: Context on margin health with emotion
  let headline;
  if (avgMargin > 65) {
    headline = `You're sitting pretty at ${avgMargin.toFixed(1)}% average margin — that's healthy breathing room.`;
  } else if (avgMargin > 55) {
    headline = `Margins are stable at ${avgMargin.toFixed(1)}% average — you're in the safe zone.`;
  } else {
    headline = `Margins are razor-thin at ${avgMargin.toFixed(1)}% average — you're one misstep from bleeding money.`;
  }

  // Why it matters - show the opportunity or risk
  let why = '';
  if (highestItem && lowestItem) {
    const spread = highestItem.margin - lowestItem.margin;
    if (spread > 20) {
      why = `Here's the play: ${highestItem.name} (${highestItem.margin.toFixed(1)}%) is crushing it while ${lowestItem.name} (${lowestItem.margin.toFixed(1)}%) is dragging you down. That ${spread.toFixed(1)}% gap is your roadmap — double down on winners, cut losers. `;
    } else {
      why = `Your margins are compressed across the board (${spread.toFixed(1)}% spread). No standout winners means you need velocity data to find your edge. `;
    }
  }

  // Action - concrete next step
  let action;
  if (avgMargin < 55) {
    action = `Urgent: raise prices on anything moving fast, or kill slow inventory before it kills you. Every point of margin matters here.`;
  } else if (highestItem && highestItem.margin > 70) {
    action = `Feature ${highestItem.name} (${highestItem.margin.toFixed(1)}%) HARD — you can discount 15% and still bank profit. That's your safety net.`;
  } else {
    action = `Stick to items above ${avgMargin.toFixed(0)}% margin for promotions. Anything below that is a gamble without sales data.`;
  }

  return `${headline} ${why}${action} (Medium confidence — pricing analysis only, no velocity tracking)`;
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

  // IMPORTANT: Check SPECIFIC patterns BEFORE generic ones
  // Order matters - most specific first!

  // 1. SPECIFIC: "what should i promote" - most common operator question
  if (lower.includes('what should i promote') || lower.includes('what to promote')) {
    return generateWhatToPromoteInsight(recommendations, metrics);
  }

  // 2. SPECIFIC: "highest margin" or "best margin" - must come BEFORE generic "margin"
  if (lower.includes('highest margin') || lower.includes('best margin')) {
    if (metrics?.highestMarginItem) {
      const item = metrics.highestMarginItem;
      const margin = item.margin || 0;

      // Check if promoting this is actually smart
      const invRecs = recommendations?.inventory || [];
      const isLowStock = invRecs.find(r => r.name === item.name);

      if (isLowStock && isLowStock.triggeringMetrics?.quantity <= 5) {
        const stock = isLowStock.triggeringMetrics.quantity;
        return `${item.name} — your biggest winner at ${margin.toFixed(1)}% margin. BUT here's the trap: only ${stock} unit${stock === 1 ? '' : 's'} left. Promoting this is a double-edged sword — you'll profit hard but sell out FAST. If you want sustained revenue, save this for emergency cash grabs and promote your second-best margin item instead. (High confidence — scarcity + margin analysis)`;
      }

      // Positive case - good margin AND enough stock
      const promoRecs = recommendations?.promotions || [];
      const isRecommended = promoRecs.find(r => r.name === item.name);

      if (isRecommended) {
        return `${item.name} at ${margin.toFixed(1)}% margin — this is your profit king. It's ALREADY on the promotion shortlist. Feature it NOW and watch margin stack. You have breathing room to discount 10-15% and still win. (High confidence — margin + recommendation alignment)`;
      }

      return `${item.name} at ${margin.toFixed(1)}% margin — your #1 profit maker across ${metrics.itemsWithPricing || 0} items. Without velocity data, margin is your north star. Promote this and track how fast it moves — that tells you if it's a keeper or shelf warmer. (Medium confidence — pricing only, no sales history)`;
    }
  }

  // 3. GENERIC: "promote" or "feature" - comes after specific promotion questions
  if (lower.includes('promote') || lower.includes('feature') || lower.includes('highlight')) {
    return generatePromotionInsight(message, recommendations, metrics);
  }

  // 4. SPECIFIC: "low stock" or "reorder"
  if (lower.includes('low stock') || lower.includes('reorder') || lower.includes('running out')) {
    return generateStockInsight(message, recommendations, metrics);
  }

  // 5. GENERIC: "margin" or "profit" - comes AFTER "highest margin"
  if (lower.includes('margin') || lower.includes('profit')) {
    return generateMarginInsight(message, metrics);
  }

  // Default: return null to use original LLM response
  return null;
}
