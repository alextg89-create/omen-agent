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
 *
 * VELOCITY TRUTH:
 * - metrics.hasVelocity = true when snapshot has real order data
 * - When hasVelocity is true, NEVER say "without velocity data" or similar
 * - Rank by velocity + margin when hasVelocity, margin-only when not
 *
 * TIMEFRAME TRANSPARENCY:
 * - Every response MUST state what timeframe the data covers
 * - Never mix metrics across scopes without explicit labels
 */

/**
 * Generate timeframe context prefix for chat responses
 * OMEN TRUTH: Always state what timeframe the data covers
 *
 * @param {object} context - Chat context with weekly/daily snapshots
 * @returns {string} Timeframe prefix for response
 */
export function getTimeframeContext(context) {
  if (!context) return '';

  const weekly = context.weekly;
  const daily = context.daily;

  // Determine which snapshot is being used
  const activeSnapshot = weekly || daily;
  if (!activeSnapshot) return '';

  const timeframe = activeSnapshot.timeframe || 'weekly';
  const dateRange = activeSnapshot.dateRange;
  const orderCount = activeSnapshot.velocity?.orderCount || 0;

  // Format date range
  let rangeStr = '';
  if (dateRange?.startDate && dateRange?.endDate) {
    const start = new Date(dateRange.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const end = new Date(dateRange.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    rangeStr = `${start}-${end}`;
  }

  // Build context string
  if (orderCount > 0) {
    return `[${timeframe.toUpperCase()} VIEW: ${rangeStr}, ${orderCount} orders]\n\n`;
  } else if (rangeStr) {
    return `[${timeframe.toUpperCase()} VIEW: ${rangeStr}]\n\n`;
  }

  return '';
}

/**
 * Generate strategic follow-up suggestions based on the topic discussed
 * OMEN should always offer 2-3 next steps to guide the operator
 *
 * @param {string} topic - The topic that was just discussed
 * @param {object} context - Chat context for additional insights
 * @returns {string} Follow-up suggestions block
 */
export function generateFollowUpSuggestions(topic, context = null) {
  const suggestions = {
    promotion: [
      "Want me to compare discount vs. bundle strategies for this SKU?",
      "Should I show which products pair well for a bundle deal?",
      "Want to see how a 10-15% discount would impact your margin?"
    ],
    margin: [
      "Want to see which high-margin items need more promotion?",
      "Should I identify margin opportunities you're missing?",
      "Want me to flag items where you could increase prices?"
    ],
    stock: [
      "Want me to prioritize which items to reorder first?",
      "Should I calculate optimal reorder quantities based on velocity?",
      "Want to see which stockouts would hurt your revenue most?"
    ],
    velocity: [
      "Want to see what's driving the acceleration?",
      "Should I compare this to your other top movers?",
      "Want me to project when you'll need to reorder?"
    ],
    general: [
      "What should I promote this week?",
      "Which items have the highest profit opportunity?",
      "Where is my capital sitting idle?"
    ]
  };

  const topicSuggestions = suggestions[topic] || suggestions.general;

  // Pick 2-3 relevant suggestions
  const selected = topicSuggestions.slice(0, 3);

  return `\n\n---\n**What would you like to explore next?**\n${selected.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}

/**
 * Detect if message is a follow-up question about a previous topic
 *
 * @param {string} message - User's message
 * @param {array} conversationHistory - Previous messages
 * @returns {{ isFollowUp: boolean, topic: string|null, originalContext: object|null }}
 */
export function detectFollowUpIntent(message, conversationHistory = []) {
  const lower = message.toLowerCase();

  // Follow-up indicators
  const followUpPatterns = [
    /^(what about|how about|and|also|another|different|other|more|else)/i,
    /^(that|this|it|those|these)\b/i,
    /^(can you|could you|show me|tell me more|explain|elaborate)/i,
    /\b(ways|options|alternatives|strategies|methods|approaches)\b/i,
    /^(why|how|what if|when)\b/i
  ];

  const isFollowUp = followUpPatterns.some(pattern => pattern.test(lower));

  // If follow-up detected, look at last assistant message for context
  let topic = null;
  let originalContext = null;

  if (isFollowUp && conversationHistory.length > 0) {
    const lastAssistant = conversationHistory
      .filter(m => m.role === 'assistant')
      .pop();

    if (lastAssistant?.content) {
      const lastContent = lastAssistant.content.toLowerCase();

      // Detect topic from last response
      if (lastContent.includes('promot') || lastContent.includes('feature') || lastContent.includes('highlight')) {
        topic = 'promotion';
      } else if (lastContent.includes('margin') || lastContent.includes('profit')) {
        topic = 'margin';
      } else if (lastContent.includes('stock') || lastContent.includes('reorder') || lastContent.includes('deplet')) {
        topic = 'stock';
      } else if (lastContent.includes('velocity') || lastContent.includes('moving') || lastContent.includes('selling')) {
        topic = 'velocity';
      }

      originalContext = { lastResponse: lastAssistant.content };
    }
  }

  return { isFollowUp, topic, originalContext };
}

/**
 * Generate response for follow-up questions
 *
 * @param {string} message - User's follow-up question
 * @param {string} topic - Detected topic from previous conversation
 * @param {object} recommendations - Available recommendations
 * @param {object} metrics - Available metrics
 * @param {object} context - Full context
 * @returns {string|null} Response or null if can't handle
 */
export function generateFollowUpResponse(message, topic, recommendations, metrics, context) {
  const lower = message.toLowerCase();

  // Handle "different ways to promote" type questions
  if ((lower.includes('different') || lower.includes('ways') || lower.includes('how') || lower.includes('strategies')) &&
      (lower.includes('promote') || topic === 'promotion')) {
    return generatePromotionStrategies(recommendations, metrics, context);
  }

  // Handle "why" questions about previous topic
  if (lower.includes('why') && topic) {
    return generateWhyExplanation(topic, recommendations, metrics, context);
  }

  // Handle "what else" or "more" questions
  if (lower.includes('else') || lower.includes('more') || lower.includes('other')) {
    return generateAdditionalInsights(topic, recommendations, metrics, context);
  }

  return null;
}

/**
 * Generate promotion strategy alternatives
 */
function generatePromotionStrategies(recommendations, metrics, context) {
  const promoRecs = recommendations?.promotions || [];
  const topItem = promoRecs[0] || metrics?.highestMarginItem;

  if (!topItem) {
    return "I need more data to suggest promotion strategies. Generate a snapshot first.";
  }

  const name = topItem.name || topItem.sku;
  const margin = topItem.triggeringMetrics?.margin || topItem.margin || 0;
  const stock = topItem.triggeringMetrics?.quantity || topItem.quantity || 0;

  let response = `**3 Promotion Strategies for ${name}:**\n\n`;

  // Strategy 1: Discount
  const discountHeadroom = Math.min(15, margin * 0.3);
  response += `**1. Flash Discount (${discountHeadroom.toFixed(0)}% off)**\n`;
  response += `   → Moves inventory fast, you still keep ${(margin - discountHeadroom).toFixed(1)}% margin\n`;
  response += `   → Best for: Quick cash flow, clearing stock before reorder\n\n`;

  // Strategy 2: Bundle
  response += `**2. Bundle Deal**\n`;
  response += `   → Pair with a slower-moving item to lift both\n`;
  response += `   → Best for: Moving dead stock while featuring your winner\n\n`;

  // Strategy 3: Featured/Premium
  response += `**3. Featured Product (No Discount)**\n`;
  response += `   → Highlight quality and availability, full margin\n`;
  response += `   → Best for: Premium positioning, limited supply situations\n\n`;

  // Recommendation
  if (stock < 10) {
    response += `💡 **My pick:** Strategy 3 — you only have ${stock} units, so create scarcity urgency without cutting margin.`;
  } else if (margin > 60) {
    response += `💡 **My pick:** Strategy 1 — with ${margin.toFixed(1)}% margin, you have room to discount and still win big.`;
  } else {
    response += `💡 **My pick:** Strategy 2 — bundle it with a slow mover to maximize overall profit.`;
  }

  response += generateFollowUpSuggestions('promotion');

  return response;
}

/**
 * Generate "why" explanations
 */
function generateWhyExplanation(topic, recommendations, metrics, context) {
  const intelligence = context?.weekly?.intelligence || context?.daily?.intelligence;

  if (topic === 'promotion') {
    const topPromo = recommendations?.promotions?.[0];
    if (topPromo) {
      let response = `**Why ${topPromo.name}?**\n\n`;
      response += `${topPromo.reason}\n\n`;

      if (topPromo.triggeringMetrics?.velocity) {
        response += `📈 It's moving ${topPromo.triggeringMetrics.velocity} units/day — momentum you can accelerate.\n`;
      }
      if (topPromo.triggeringMetrics?.margin) {
        response += `💰 ${topPromo.triggeringMetrics.margin.toFixed(1)}% margin gives you discount headroom.\n`;
      }

      response += generateFollowUpSuggestions('promotion');
      return response;
    }
  }

  if (topic === 'margin') {
    const highMargin = metrics?.highestMarginItem;
    if (highMargin) {
      return `**Why ${highMargin.name} has the highest margin:**\n\nYour cost is low relative to retail price, creating ${highMargin.margin.toFixed(1)}% profit on each sale. This is where your promotion dollars work hardest.` + generateFollowUpSuggestions('margin');
    }
  }

  return null;
}

/**
 * Generate additional insights for "more" questions
 */
function generateAdditionalInsights(topic, recommendations, metrics, context) {
  const intelligence = context?.weekly?.intelligence || context?.daily?.intelligence;

  if (topic === 'promotion' && recommendations?.promotions?.length > 1) {
    const others = recommendations.promotions.slice(1, 4);
    let response = `**Other promotion opportunities:**\n\n`;
    others.forEach((item, i) => {
      const margin = item.triggeringMetrics?.margin;
      response += `${i + 1}. **${item.name}** — ${margin ? margin.toFixed(1) + '% margin' : 'strong mover'}\n`;
      response += `   ${item.reason}\n\n`;
    });
    response += generateFollowUpSuggestions('promotion');
    return response;
  }

  // Surface WOW insights if available
  if (intelligence?.wowInsights?.length > 0) {
    const wow = intelligence.wowInsights[0];
    return `**Here's something else worth your attention:**\n\n🎯 ${wow.headline}\n${wow.insight}\n\n**Action:** ${wow.action}` + generateFollowUpSuggestions('general');
  }

  return null;
}

/**
 * Generate insight-driven response for promotion questions
 */
export function generatePromotionInsight(message, recommendations, metrics) {
  const promoRecs = recommendations?.promotions || [];
  const invRecs = recommendations?.inventory || [];

  // Case 1: Have promotion recommendations with velocity data
  if (promoRecs.length > 0) {
    const top = promoRecs[0];
    const margin = top.triggeringMetrics?.margin ?? null;
    const stock = top.triggeringMetrics?.quantity ?? 0;  // quantity can be 0
    const velocity = top.triggeringMetrics?.velocity ?? null;

    // Build headline based on signal strength - MORE EXCITING
    let headline;
    if (velocity && velocity > 10) {
      headline = `${top.name} — this one's HOT. Already moving fast and primed for promotion.`;
    } else if (margin !== null && margin > 65) {
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

    const marginStr = margin !== null ? `${margin.toFixed(1)}% margin` : 'margin unknown';
    return `${headline} ${why} ${action} (${confidence} — ${marginStr}, stock level ${stock}${velocity ? `, velocity tracked` : ''})`;
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

  // Case 3: Fallback to highest margin item from snapshot.metrics (realized margin only)
  if (metrics?.highestMarginItem && typeof metrics.highestMarginItem.margin === 'number') {
    const item = metrics.highestMarginItem;
    const margin = item.margin;

    // Use velocity context if available
    if (metrics.hasVelocity) {
      const orderCount = metrics.velocity?.orderCount ?? 0;
      return `${item.name} has your highest realized margin at ${margin.toFixed(1)}%. Based on ${orderCount} orders from the past week, this is backed by real sales data. Promote it this week. (Medium confidence — realized order profit + velocity)`;
    }

    return `${item.name} has your highest realized margin at ${margin.toFixed(1)}% based on actual order profit. Promote it this week and track how fast it moves. (Medium confidence — realized order profit)`;
  }

  // No snapshot metrics available - cannot provide margin-based recommendation
  return `Insufficient data for margin-based recommendations. Generate a weekly snapshot first to analyze realized order profit.`;
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
  if (!metrics || typeof metrics.averageMargin !== 'number') {
    return `Margin data unavailable. Generate a weekly snapshot first to analyze realized order profit.`;
  }

  const avgMargin = metrics.averageMargin;
  const highestItem = metrics.highestMarginItem;
  const lowestItem = metrics.lowestMarginItem;

  // Headline: Context on margin health with emotion
  let headline;
  if (avgMargin > 65) {
    headline = `You're sitting pretty at ${avgMargin.toFixed(1)}% average realized margin — that's healthy breathing room.`;
  } else if (avgMargin > 55) {
    headline = `Realized margins are stable at ${avgMargin.toFixed(1)}% average — you're in the safe zone.`;
  } else {
    headline = `Realized margins are razor-thin at ${avgMargin.toFixed(1)}% average — you're one misstep from bleeding money.`;
  }

  // Why it matters - show the opportunity or risk
  let why = '';
  if (highestItem && typeof highestItem.margin === 'number' && lowestItem && typeof lowestItem.margin === 'number') {
    const spread = highestItem.margin - lowestItem.margin;
    if (spread > 20) {
      why = `Here's the play: ${highestItem.name} (${highestItem.margin.toFixed(1)}%) is crushing it while ${lowestItem.name} (${lowestItem.margin.toFixed(1)}%) is dragging you down. That ${spread.toFixed(1)}% gap is your roadmap — double down on winners, cut losers. `;
    } else {
      why = `Your margins are compressed across the board (${spread.toFixed(1)}% spread). No standout margin winners — look at which items are moving fastest. `;
    }
  }

  // Action - concrete next step
  let action;
  if (avgMargin < 55) {
    action = `Urgent: raise prices on anything moving fast, or kill slow inventory before it kills you. Every point of margin matters here.`;
  } else if (highestItem && typeof highestItem.margin === 'number' && highestItem.margin > 70) {
    action = `Feature ${highestItem.name} (${highestItem.margin.toFixed(1)}%) HARD — you can discount 15% and still bank profit. That's your safety net.`;
  } else {
    action = `Stick to items above ${avgMargin.toFixed(0)}% margin for promotions. Anything below that is risky.`;
  }

  return `${headline} ${why}${action} (Medium confidence — realized order profit)`;
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

    const margin = top.triggeringMetrics?.margin ?? null;
    const stock = top.triggeringMetrics?.quantity ?? 0;

    let response = `${top.name}. `;

    // Why this one
    if (top.reason.toLowerCase().includes('velocity') || top.reason.toLowerCase().includes('moving')) {
      response += `It's already moving and has the momentum. `;
    } else if (margin !== null && margin > 65) {
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
    const marginStr = margin !== null ? `${margin.toFixed(1)}% margin` : 'margin unknown';
    response += `(${conf} — ${marginStr}, stock level ${stock})`;

    return response;
  }

  // Strategy 2: Margin from snapshot.metrics (realized order profit only)
  if (metrics?.highestMarginItem && typeof metrics.highestMarginItem.margin === 'number') {
    const item = metrics.highestMarginItem;
    const margin = item.margin;

    // Check if this item is also low stock (URGENCY)
    const isLowStock = invRecs.find(r => r.name === item.name);

    if (isLowStock) {
      const stock = isLowStock.triggeringMetrics?.quantity ?? 0;
      return `${item.name} — highest realized margin (${margin.toFixed(1)}%) AND low stock (${stock} units). Based on actual order profit. Create urgency now. (High confidence — realized profit + scarcity)`;
    }

    // Use velocity context if available
    if (metrics.hasVelocity) {
      const orderCount = metrics.velocity?.orderCount ?? 0;
      return `${item.name} — highest realized margin at ${margin.toFixed(1)}% from actual orders. With ${orderCount} orders tracked, this is your best pick. Promote it this week. (Medium confidence — realized order profit + velocity)`;
    }

    return `${item.name} — it has your highest realized margin at ${margin.toFixed(1)}% from actual order profit. Promote it and track depletion rate over 3 days — if it moves fast, you've found your winner. (Medium confidence — realized order profit)`;
  }

  return `Can't determine promotion priority without inventory data. Load inventory first.`;
}

/**
 * Generate insight for "why" questions about performance changes
 *
 * Analyzes snapshot deltas and velocity to explain changes
 */
export function generateWhyInsight(message, metrics, context) {
  const lower = message.toLowerCase();
  const intelligence = context?.weekly?.intelligence || context?.daily?.intelligence || null;
  const executiveSummary = intelligence?.executiveSummary || null;

  // Revenue decline questions
  if (lower.includes('revenue') && (lower.includes('down') || lower.includes('drop') || lower.includes('decline') || lower.includes('fell'))) {
    if (executiveSummary?.metrics?.revenue?.delta) {
      const revDelta = executiveSummary.metrics.revenue.delta;
      const orderDelta = executiveSummary.metrics.orders?.delta;

      if (revDelta.direction === 'down') {
        let explanation = `Revenue declined ${Math.abs(revDelta.percent).toFixed(1)}% ($${Math.abs(revDelta.absolute).toLocaleString()}) week-over-week. `;

        // Diagnose the cause
        if (orderDelta && orderDelta.direction === 'down') {
          explanation += `Primary driver: ${Math.abs(orderDelta.percent).toFixed(0)}% fewer orders. This suggests a demand or traffic issue. `;
          explanation += `Action: Review marketing channels, check for seasonal patterns, or investigate external factors.`;
        } else if (orderDelta && orderDelta.direction === 'up') {
          explanation += `Interestingly, order volume was UP ${orderDelta.percent.toFixed(0)}%. This means average order value dropped. `;
          explanation += `Action: Check if customers are buying cheaper items or if discounting was too aggressive.`;
        } else {
          explanation += `Order volume was stable, suggesting product mix shifted toward lower-priced items. `;
          explanation += `Action: Analyze which SKUs drove revenue last week vs this week.`;
        }

        return explanation + ` (High confidence — based on actual order data)`;
      } else if (revDelta.direction === 'up') {
        return `Actually, revenue is UP ${revDelta.percent.toFixed(1)}% week-over-week! Current period: $${executiveSummary.metrics.revenue.current.toLocaleString()}. (High confidence — based on order data)`;
      }
    }

    // No delta data available
    if (!executiveSummary) {
      return `I don't have comparison data to explain revenue changes. Generate snapshots for at least two periods to enable trend analysis.`;
    }

    const revenueStr = metrics?.totalRevenue !== null && metrics?.totalRevenue !== undefined
      ? `$${metrics.totalRevenue.toLocaleString()}`
      : 'unavailable';
    return `Revenue appears stable. I don't see a significant decline in the current data. Current revenue: ${revenueStr}.`;
  }

  // Margin decline questions
  if (lower.includes('margin') && (lower.includes('down') || lower.includes('drop') || lower.includes('decline') || lower.includes('hurt') || lower.includes('compress'))) {
    const marginAnalysis = intelligence?.marginAnalysis;

    if (marginAnalysis) {
      const laggards = marginAnalysis.marginLaggards || [];
      const avgMargin = marginAnalysis.averageMargin;

      if (laggards.length > 0) {
        const names = laggards.map(l => `${l.name} (${l.margin?.toFixed(1)}%)`).join(', ');
        let response = `Your lowest-margin items are: ${names}. `;

        if (avgMargin && avgMargin < 50) {
          response += `Overall average margin is ${avgMargin.toFixed(1)}% which is thin. `;
          response += `Action: Consider raising prices on low-margin items or discontinuing if they don't drive traffic.`;
        } else {
          response += `These are dragging down your average. Consider bundling them with high-margin items or adjusting pricing.`;
        }

        return response + ` (Medium confidence — based on realized order profit)`;
      }
    }

    return `I need snapshot data with margin analysis to identify margin issues. Generate a weekly snapshot first.`;
  }

  // General "why" about performance
  if (lower.includes('why') && (lower.includes('perform') || lower.includes('slow') || lower.includes('bad'))) {
    if (executiveSummary?.keyInsights?.length > 0) {
      const insights = executiveSummary.keyInsights
        .filter(i => i.severity === 'high' || i.severity === 'medium')
        .slice(0, 3);

      if (insights.length > 0) {
        let response = `Here's what I'm seeing: `;
        response += insights.map(i => i.text).join(' ');
        response += ` Recommended actions: ${insights.map(i => i.action).join(' ')}`;
        return response + ` (Medium confidence)`;
      }
    }

    return `I don't have enough data to diagnose performance issues. Generate snapshots over multiple periods for trend analysis.`;
  }

  return null; // Not a "why" question we can handle
}

/**
 * Generate insight for reorder questions
 *
 * Uses velocity data to prioritize what needs restocking
 */
export function generateReorderInsight(message, recommendations, metrics, context) {
  const velocity = context?.velocity || metrics?.velocity;
  const insights = velocity?.insights || [];
  const invRecs = recommendations?.inventory || [];

  // Combine urgent restocks from insights and recommendations
  const urgentItems = [];

  // From velocity insights (order-based)
  for (const insight of insights) {
    if (insight.type === 'URGENT_RESTOCK' || insight.priority === 'HIGH') {
      urgentItems.push({
        name: insight.name,
        reason: insight.message || insight.details,
        daysLeft: insight.data?.daysUntilStockout,
        stock: insight.data?.currentStock,
        velocity: insight.data?.dailyVelocity,
        source: 'velocity'
      });
    }
  }

  // From inventory recommendations (stock-based)
  for (const rec of invRecs) {
    const qty = rec.triggeringMetrics?.quantity || 0;
    if (qty <= 5 && !urgentItems.find(u => u.name === rec.name)) {
      urgentItems.push({
        name: rec.name,
        reason: rec.reason,
        stock: qty,
        source: 'stock_level'
      });
    }
  }

  if (urgentItems.length === 0) {
    return `Stock levels look healthy across your inventory. No urgent reorders needed right now. Continue monitoring high-velocity items.`;
  }

  // Sort by urgency (days left, then stock level)
  urgentItems.sort((a, b) => {
    if (a.daysLeft && b.daysLeft) return a.daysLeft - b.daysLeft;
    if (a.daysLeft) return -1;
    if (b.daysLeft) return 1;
    return (a.stock || 0) - (b.stock || 0);
  });

  // Build response
  const critical = urgentItems.filter(i => (i.daysLeft && i.daysLeft <= 3) || (i.stock || 0) <= 2);
  const soon = urgentItems.filter(i => !critical.includes(i)).slice(0, 3);

  let response = '';

  if (critical.length > 0) {
    const names = critical.slice(0, 3).map(i => i.name).join(', ');
    response = `URGENT REORDER NOW: ${names}. `;
    if (critical[0].daysLeft) {
      response += `${critical[0].name} will stock out in ${critical[0].daysLeft} days at current velocity. `;
    } else {
      response += `Only ${critical[0].stock} units left. `;
    }
  }

  if (soon.length > 0) {
    const names = soon.map(i => i.name).join(', ');
    if (critical.length > 0) {
      response += `Also add to next order: ${names}. `;
    } else {
      response = `Reorder soon: ${names}. `;
      response += `${soon[0].name} has ${soon[0].stock || 'low'} units remaining. `;
    }
  }

  const confidence = urgentItems[0].source === 'velocity' ? 'High confidence — based on sales velocity' : 'Medium confidence — based on current stock levels';
  return response + `(${confidence})`;
}

/**
 * Generate insight for "which SKUs" questions
 */
export function generateSKUAnalysisInsight(message, recommendations, metrics, context) {
  const lower = message.toLowerCase();
  const intelligence = context?.weekly?.intelligence || context?.daily?.intelligence;

  // SKUs hurting margins
  if (lower.includes('hurt') && lower.includes('margin')) {
    const marginAnalysis = intelligence?.marginAnalysis;

    if (marginAnalysis?.marginLaggards?.length > 0) {
      const laggards = marginAnalysis.marginLaggards;
      let response = `These SKUs are hurting your margins: `;
      response += laggards.map(l => `${l.name} at ${l.margin?.toFixed(1)}% margin`).join(', ');
      response += `. `;

      const worst = laggards[0];
      if (worst.quantity > 10) {
        response += `${worst.name} has ${worst.quantity} units tying up capital at low profit. Consider discounting to clear.`;
      } else {
        response += `Consider raising prices or discontinuing low performers.`;
      }

      return response + ` (Medium confidence — realized order profit)`;
    }
  }

  // Best performing SKUs
  if ((lower.includes('best') || lower.includes('top')) && (lower.includes('sku') || lower.includes('product') || lower.includes('item') || lower.includes('perform'))) {
    const topSKUs = intelligence?.topSKUs;

    if (topSKUs?.length > 0) {
      let response = `Your top performers by sales velocity: `;
      response += topSKUs.slice(0, 3).map(s =>
        `${s.name} (${s.dailyVelocity.toFixed(1)}/day, ${s.margin?.toFixed(0) || '?'}% margin)`
      ).join(', ');
      response += `. These are moving fast — keep them stocked and consider featuring in promotions.`;
      return response + ` (High confidence — based on order velocity)`;
    }
  }

  // Slow moving SKUs
  if (lower.includes('slow') || lower.includes('dead') || lower.includes('not moving') || lower.includes('sitting')) {
    const slowMovers = intelligence?.slowMovers;

    if (slowMovers?.length > 0) {
      let response = `Slow movers tying up capital: `;
      response += slowMovers.slice(0, 3).map(s =>
        `${s.name} (${s.quantity} units, ${s.daysToSellout ? s.daysToSellout + ' days to sell' : 'minimal movement'})`
      ).join(', ');

      const totalCapital = slowMovers.reduce((sum, s) => sum + (s.capitalTiedUp || 0), 0);
      if (totalCapital > 0) {
        response += `. Roughly $${totalCapital.toLocaleString()} tied up in slow inventory.`;
      }

      response += ` Action: Bundle with popular items or run clearance pricing.`;
      return response + ` (Medium confidence)`;
    }
  }

  return null; // Not a SKU analysis question we can handle
}

/**
 * Main router: Detect question type and generate appropriate insight
 *
 * @param {string} message - User question
 * @param {object} recommendations - Recommendations from snapshot
 * @param {object} metrics - Metrics context (includes snapshot data)
 * @param {object} context - Full context including weekly/daily snapshots (optional)
 */
export function generateInsightResponse(message, recommendations, metrics, context = null) {
  const lower = message.toLowerCase();

  // Generate response first, then prepend timeframe context
  const response = generateInsightResponseCore(message, lower, recommendations, metrics, context);

  // Prepend timeframe context for transparency
  if (response) {
    const timeframePrefix = getTimeframeContext(context);
    return timeframePrefix + response;
  }

  return null;
}

/**
 * Core insight response generation (without timeframe wrapper)
 */
function generateInsightResponseCore(message, lower, recommendations, metrics, context) {
  // IMPORTANT: Check SPECIFIC patterns BEFORE generic ones
  // Order matters - most specific first!

  // 0. "WHY" QUESTIONS - Explain performance changes (NEW)
  if (lower.includes('why')) {
    const whyResponse = generateWhyInsight(message, metrics, context);
    if (whyResponse) return whyResponse;
  }

  // 0.5 "WHICH SKUs" QUESTIONS - SKU-level analysis (NEW)
  if (lower.includes('which') && (lower.includes('sku') || lower.includes('product') || lower.includes('item'))) {
    const skuResponse = generateSKUAnalysisInsight(message, recommendations, metrics, context);
    if (skuResponse) return skuResponse;
  }

  // 0.6 REORDER QUESTIONS (NEW - enhanced)
  if (lower.includes('reorder') || lower.includes('order more') || lower.includes('need to buy') || lower.includes('running low')) {
    return generateReorderInsight(message, recommendations, metrics, context);
  }

  // 0.7 SLOW MOVERS / DEAD STOCK (NEW)
  if (lower.includes('slow') || lower.includes('dead stock') || lower.includes('not moving') || lower.includes('sitting')) {
    const skuResponse = generateSKUAnalysisInsight(message, recommendations, metrics, context);
    if (skuResponse) return skuResponse;
  }

  // 0.8 TOP / BEST PERFORMERS (NEW)
  if ((lower.includes('top') || lower.includes('best')) && (lower.includes('seller') || lower.includes('perform') || lower.includes('moving'))) {
    const skuResponse = generateSKUAnalysisInsight(message, recommendations, metrics, context);
    if (skuResponse) return skuResponse;
  }

  // 1. SPECIFIC: "what should i promote" - most common operator question
  if (lower.includes('what should i promote') || lower.includes('what to promote')) {
    return generateWhatToPromoteInsight(recommendations, metrics);
  }

  // 2. SPECIFIC: "highest margin" or "best margin" - must come BEFORE generic "margin"
  if (lower.includes('highest margin') || lower.includes('best margin')) {
    if (metrics?.highestMarginItem && typeof metrics.highestMarginItem.margin === 'number') {
      const item = metrics.highestMarginItem;
      const margin = item.margin;

      // Check if promoting this is actually smart
      const invRecs = recommendations?.inventory || [];
      const isLowStock = invRecs.find(r => r.name === item.name);

      if (isLowStock && isLowStock.triggeringMetrics?.quantity <= 5) {
        const stock = isLowStock.triggeringMetrics.quantity;
        return `${item.name} — your biggest winner at ${margin.toFixed(1)}% realized margin. BUT here's the trap: only ${stock} unit${stock === 1 ? '' : 's'} left. Promoting this is a double-edged sword — you'll profit hard but sell out FAST. If you want sustained revenue, save this for emergency cash grabs and promote your second-best margin item instead. (High confidence — realized order profit + scarcity)`;
      }

      // Positive case - good margin AND enough stock
      const promoRecs = recommendations?.promotions || [];
      const isRecommended = promoRecs.find(r => r.name === item.name);

      if (isRecommended) {
        return `${item.name} at ${margin.toFixed(1)}% realized margin — this is your profit king from actual orders. It's ALREADY on the promotion shortlist. Feature it NOW and watch margin stack. You have breathing room to discount 10-15% and still win. (High confidence — realized order profit + recommendation alignment)`;
      }

      // Use velocity context if available
      if (metrics.hasVelocity) {
        const orderCount = metrics.velocity?.orderCount ?? 0;
        return `${item.name} at ${margin.toFixed(1)}% realized margin — your #1 profit maker based on ${orderCount} orders tracked. Sales data backs this pick. Promote it this week. (Medium confidence — realized order profit + velocity)`;
      }

      return `${item.name} at ${margin.toFixed(1)}% realized margin — your #1 profit maker based on actual order profit. Promote this and track how fast it moves — that tells you if it's a keeper or shelf warmer. (Medium confidence — realized order profit)`;
    }

    // No realized margin data available
    return `Highest margin data unavailable. Generate a weekly snapshot first to analyze realized order profit.`;
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

/**
 * Generate proactive insight - "What you might not be seeing..."
 *
 * This adds unprompted intelligence to every response.
 * OMEN should feel like it's watching the business, not just answering questions.
 *
 * FRAMING ROTATION:
 * - Profit maximization: "You're leaving money on the table"
 * - Cash flow recovery: "Your capital is stuck"
 * - Inventory risk: "You're about to lose sales"
 * - Missed opportunity: "This is slipping away"
 */
export function generateProactiveInsight(context) {
  const intelligence = context?.weekly?.intelligence || context?.daily?.intelligence;
  if (!intelligence) return null;

  const proactiveInsights = [];

  // 0. WOW INSIGHT - The most impactful, non-obvious insight (NEW)
  const wowInsight = intelligence.wowInsight;
  if (wowInsight) {
    proactiveInsights.push({
      priority: 0,  // Highest priority
      text: `🎯 **${wowInsight.headline}** — ${wowInsight.insight} ${wowInsight.action}`
    });
  }

  // 1. Hidden opportunities - profit sitting on shelves (NEW)
  const hiddenOpportunities = intelligence.hiddenOpportunities || [];
  if (hiddenOpportunities.length > 0 && proactiveInsights.length < 2) {
    const top = hiddenOpportunities[0];
    proactiveInsights.push({
      priority: 1,
      text: `💰 **Money on the table:** ${top.name} has ${top.margin}% margin but barely moves. ${top.insight}`
    });
  }

  // 2. Top profit contributors not being promoted (NEW)
  const topProfitContributors = intelligence.topProfitContributors || [];
  const topSKUs = intelligence.topSKUs || [];
  if (topProfitContributors.length > 0 && topSKUs.length > 0) {
    // Check if top profit contributor is NOT in top velocity
    const topProfit = topProfitContributors[0];
    const isInTopVelocity = topSKUs.some(s => s.sku === topProfit.sku);
    if (!isInTopVelocity && proactiveInsights.length < 2) {
      proactiveInsights.push({
        priority: 1,
        text: `📊 **Profit mismatch:** ${topProfit.name} could contribute $${topProfit.potentialProfit.toLocaleString()} in profit but isn't in your top sellers. Push it harder.`
      });
    }
  }

  // 3. Surface the verdict if there's a critical signal
  const verdict = intelligence.verdict;
  if (verdict && verdict.verdictType !== 'STABLE') {
    if (verdict.verdictType === 'STOCKOUT_IMMINENT') {
      proactiveInsights.push({
        priority: 1,
        text: `🚨 **You're about to lose sales:** ${verdict.focusItem} will stock out soon. ${verdict.consequence}`
      });
    } else if (verdict.verdictType === 'UNDER_PROMOTED') {
      proactiveInsights.push({
        priority: 2,
        text: `💡 **Profit hiding in plain sight:** ${verdict.focusItem} — ${verdict.reason}`
      });
    } else if (verdict.verdictType === 'REVENUE_DECLINE') {
      proactiveInsights.push({
        priority: 1,
        text: `📉 **Cash flow alert:** ${verdict.reason} ${verdict.consequence}`
      });
    } else if (verdict.verdictType === 'DEAD_STOCK') {
      proactiveInsights.push({
        priority: 2,
        text: `🧊 **Your capital is frozen:** ${verdict.reason} ${verdict.consequence}`
      });
    } else if (verdict.verdictType === 'CAPITAL_MISALLOCATION') {
      proactiveInsights.push({
        priority: 2,
        text: `💸 **Cash stuck in the wrong place:** ${verdict.reason}`
      });
    }
  }

  // 4. Surface forecasts that matter
  const forecasts = intelligence.forecasts || [];
  for (const forecast of forecasts.slice(0, 2)) {
    if (forecast.type === 'stockout_forecast' && proactiveInsights.length < 3) {
      proactiveInsights.push({
        priority: 1,
        text: `🔮 **This is coming:** ${forecast.prediction}. ${forecast.action}`
      });
    } else if (forecast.type === 'momentum_forecast' && proactiveInsights.length < 3) {
      proactiveInsights.push({
        priority: 3,
        text: `📈 **Catch this wave:** ${forecast.prediction}. ${forecast.action}`
      });
    }
  }

  // 5. Surface anomalies the user didn't ask about
  const anomalies = intelligence.anomalies || [];
  const unusualChanges = anomalies.filter(a =>
    a.type === 'velocity_spike' || a.type === 'velocity_drop'
  );

  if (unusualChanges.length > 0 && proactiveInsights.length < 3) {
    const change = unusualChanges[0];
    const framing = change.type === 'velocity_spike'
      ? `🔥 **Something's catching fire:**`
      : `⚠️ **Momentum dying:**`;
    proactiveInsights.push({
      priority: 2,
      text: `${framing} ${change.message}. Worth investigating.`
    });
  }

  // 6. Surface margin risks
  const marginAnalysis = intelligence.marginAnalysis;
  if (marginAnalysis?.averageMargin && marginAnalysis.averageMargin < 40 && proactiveInsights.length < 3) {
    proactiveInsights.push({
      priority: 2,
      text: `💸 **Thin ice:** Average margin is ${marginAnalysis.averageMargin.toFixed(1)}%. Every discount cuts deep. Protect your winners.`
    });
  }

  // Sort by priority and return top insight
  proactiveInsights.sort((a, b) => a.priority - b.priority);

  return proactiveInsights[0]?.text || null;
}

/**
 * Wrap response with proactive intelligence
 *
 * Takes a direct answer and appends "what you might not be seeing"
 */
export function wrapWithProactiveInsight(response, context) {
  if (!response) return null;

  const proactive = generateProactiveInsight(context);

  if (proactive) {
    return `${response}\n\n---\n${proactive}`;
  }

  return response;
}

/**
 * Enhanced insight response with proactive layer
 *
 * Use this instead of generateInsightResponse for full OMEN behavior
 */
export function generateEnhancedInsightResponse(message, recommendations, metrics, context = null) {
  // Get the direct answer
  const directResponse = generateInsightResponse(message, recommendations, metrics, context);

  // If we have a direct answer, add proactive layer
  if (directResponse) {
    return wrapWithProactiveInsight(directResponse, context);
  }

  // If no direct answer, still try to surface something proactive
  const proactive = generateProactiveInsight(context);
  if (proactive) {
    // Return null for the direct answer, but the proactive insight will be added by the caller
    return null; // Let LLM handle, but proactive context exists
  }

  return null;
}
