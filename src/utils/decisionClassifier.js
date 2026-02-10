/**
 * Decision Classifier - CANONICAL DECISION MODEL
 *
 * Every SKU gets classified into EXACTLY one of 4 decision types:
 *
 * 1. SELL_NOW     - Dead/slow inventory with profit trapped → promote/feature/discount
 * 2. REORDER_NOW  - High velocity SKUs at risk of stockout → reorder immediately
 * 3. HOLD_LINE    - Strong margin SKUs that should NOT be discounted
 * 4. DEPRIORITIZE - Low velocity + low margin items (no action needed)
 *
 * This is THE single canonical model. No overlapping signals.
 * One SKU = One decision. No ambiguity.
 */

// ============================================================================
// DECISION TYPES - The ONLY 4 types that exist
// ============================================================================
export const DECISION_TYPES = {
  SELL_NOW: 'SELL_NOW',
  REORDER_NOW: 'REORDER_NOW',
  HOLD_LINE: 'HOLD_LINE',
  DEPRIORITIZE: 'DEPRIORITIZE'
};

// ============================================================================
// THRESHOLDS - Tunable parameters for classification
// ============================================================================
const THRESHOLDS = {
  // Velocity thresholds (units per day)
  HIGH_VELOCITY: 0.5,      // > 0.5/day = fast mover
  LOW_VELOCITY: 0.2,       // < 0.2/day = slow mover

  // Margin thresholds (percent)
  HIGH_MARGIN: 50,         // >= 50% = protect margin
  LOW_MARGIN: 35,          // < 35% = low margin

  // Stock thresholds
  LOW_STOCK_DAYS: 10,      // <= 10 days = stockout risk
  CRITICAL_STOCK_DAYS: 5,  // <= 5 days = urgent reorder

  // Minimum stock for action
  MIN_STOCK_FOR_SELL: 3,   // Need at least 3 units to recommend sell action
};

/**
 * Classify a single SKU into one of 4 decision types
 *
 * Priority order (first match wins):
 * 1. REORDER_NOW - High velocity + low stock (imminent stockout)
 * 2. SELL_NOW    - Slow velocity + has stock (trapped profit)
 * 3. HOLD_LINE   - High margin + good velocity (protect this)
 * 4. DEPRIORITIZE - Everything else (no urgent action)
 *
 * @param {object} item - Enriched inventory item
 * @param {object} velocityData - Velocity metrics for this SKU
 * @returns {object} Decision classification
 */
export function classifySKU(item, velocityData = null) {
  const sku = item.sku || item.strain || 'UNKNOWN';
  const name = item.name || `${item.strain} (${item.unit})`;
  const quantity = item.quantity || 0;
  const margin = item.pricing?.margin ?? null;
  const retail = item.pricing?.retail ?? null;
  const cost = item.pricing?.cost ?? null;

  // Get velocity data
  const dailyVelocity = velocityData?.dailyVelocity || 0;
  const daysUntilStockout = velocityData?.daysUntilStockout ?? null;

  // Skip out-of-stock items (no decision possible)
  if (quantity <= 0) {
    return {
      sku,
      name,
      decision: null,
      reason: 'Out of stock - no action possible',
      excluded: true
    };
  }

  // Calculate potential profit at stake
  const profitPerUnit = (retail && margin) ? retail * (margin / 100) : null;
  const totalProfitAtRisk = profitPerUnit ? quantity * profitPerUnit : null;

  // ========================================================================
  // RULE 1: REORDER_NOW - High velocity + stockout imminent
  // ========================================================================
  const isHighVelocity = dailyVelocity >= THRESHOLDS.HIGH_VELOCITY;
  const isStockoutRisk = daysUntilStockout !== null && daysUntilStockout <= THRESHOLDS.LOW_STOCK_DAYS;
  const isCriticalStock = daysUntilStockout !== null && daysUntilStockout <= THRESHOLDS.CRITICAL_STOCK_DAYS;

  if (isHighVelocity && isStockoutRisk) {
    const dailyProfit = profitPerUnit ? dailyVelocity * profitPerUnit : null;
    const weeklyRisk = dailyProfit ? dailyProfit * 7 : null;

    return {
      sku,
      name,
      decision: DECISION_TYPES.REORDER_NOW,
      reason: `Selling ${dailyVelocity.toFixed(1)}/day, only ${daysUntilStockout} days of stock left`,
      whatToDo: isCriticalStock
        ? `Reorder TODAY - you'll be out in ${daysUntilStockout} days`
        : `Place reorder this week to avoid stockout`,
      moneyImpact: weeklyRisk
        ? `$${Math.round(weeklyRisk).toLocaleString()}/week at risk if stocked out`
        : 'Revenue at risk - exact amount unknown',
      timeframe: isCriticalStock ? 'TODAY' : 'THIS_WEEK',
      urgency: isCriticalStock ? 3 : 2,
      metrics: {
        quantity,
        dailyVelocity,
        daysUntilStockout,
        margin,
        profitPerUnit,
        weeklyProfit: dailyProfit ? dailyProfit * 7 : null
      }
    };
  }

  // ========================================================================
  // RULE 2: SELL_NOW - Slow velocity + has stock = trapped profit
  // ========================================================================
  const isSlowVelocity = dailyVelocity < THRESHOLDS.LOW_VELOCITY;
  const hasStock = quantity >= THRESHOLDS.MIN_STOCK_FOR_SELL;
  const hasMargin = margin !== null && margin > 0;

  if (isSlowVelocity && hasStock && hasMargin) {
    // Calculate how long it would take to sell at current pace
    const daysToSellout = dailyVelocity > 0 ? Math.round(quantity / dailyVelocity) : 999;

    return {
      sku,
      name,
      decision: DECISION_TYPES.SELL_NOW,
      reason: daysToSellout > 30
        ? `Moving at ${dailyVelocity.toFixed(2)}/day - ${quantity} units will take ${daysToSellout}+ days to sell`
        : `Slow velocity (${dailyVelocity.toFixed(2)}/day) - profit sitting idle`,
      whatToDo: margin >= THRESHOLDS.HIGH_MARGIN
        ? 'Feature prominently - high margin covers promotion cost'
        : 'Consider 15-20% discount to move inventory',
      moneyImpact: totalProfitAtRisk
        ? `$${Math.round(totalProfitAtRisk).toLocaleString()} profit trapped in slow inventory`
        : 'Profit trapped - exact amount unknown',
      timeframe: 'THIS_WEEK',
      urgency: 1,
      metrics: {
        quantity,
        dailyVelocity,
        daysToSellout,
        margin,
        profitPerUnit,
        totalProfitAtRisk
      }
    };
  }

  // ========================================================================
  // RULE 3: HOLD_LINE - High margin + reasonable velocity = protect
  // ========================================================================
  const isHighMargin = margin !== null && margin >= THRESHOLDS.HIGH_MARGIN;
  const hasReasonableVelocity = dailyVelocity >= THRESHOLDS.LOW_VELOCITY;

  if (isHighMargin && hasReasonableVelocity) {
    const weeklyProfit = profitPerUnit ? dailyVelocity * profitPerUnit * 7 : null;

    return {
      sku,
      name,
      decision: DECISION_TYPES.HOLD_LINE,
      reason: `${Math.round(margin)}% margin with steady ${dailyVelocity.toFixed(1)}/day velocity`,
      whatToDo: 'Do NOT discount. Protect margin. Ensure stock levels.',
      moneyImpact: weeklyProfit
        ? `$${Math.round(weeklyProfit).toLocaleString()}/week profit at full margin`
        : 'Strong margin contributor',
      timeframe: 'ONGOING',
      urgency: 0,
      metrics: {
        quantity,
        dailyVelocity,
        daysUntilStockout,
        margin,
        profitPerUnit,
        weeklyProfit
      }
    };
  }

  // ========================================================================
  // RULE 4: DEPRIORITIZE - Low velocity + low margin = ignore for now
  // ========================================================================
  const isLowMargin = margin === null || margin < THRESHOLDS.LOW_MARGIN;

  if (isSlowVelocity && isLowMargin) {
    return {
      sku,
      name,
      decision: DECISION_TYPES.DEPRIORITIZE,
      reason: `Low velocity (${dailyVelocity.toFixed(2)}/day) + ${margin ? Math.round(margin) + '% margin' : 'unknown margin'}`,
      whatToDo: 'No action needed. Let it sell naturally.',
      moneyImpact: totalProfitAtRisk
        ? `$${Math.round(totalProfitAtRisk).toLocaleString()} - not worth active promotion`
        : 'Minimal profit impact',
      timeframe: 'NONE',
      urgency: -1,
      metrics: {
        quantity,
        dailyVelocity,
        margin,
        totalProfitAtRisk
      }
    };
  }

  // ========================================================================
  // FALLBACK: DEPRIORITIZE - Default when no clear signal
  // ========================================================================
  return {
    sku,
    name,
    decision: DECISION_TYPES.DEPRIORITIZE,
    reason: 'No urgent signals detected',
    whatToDo: 'Monitor. No immediate action required.',
    moneyImpact: totalProfitAtRisk
      ? `$${Math.round(totalProfitAtRisk).toLocaleString()} inventory value`
      : 'Standard inventory',
    timeframe: 'NONE',
    urgency: -1,
    metrics: {
      quantity,
      dailyVelocity,
      margin,
      totalProfitAtRisk
    }
  };
}

/**
 * Classify all SKUs in an inventory snapshot
 *
 * @param {Array} inventory - Enriched inventory items
 * @param {Array} velocityMetrics - Velocity data for SKUs
 * @returns {object} Classified SKUs grouped by decision type
 */
export function classifyAllSKUs(inventory, velocityMetrics = []) {
  // Build velocity lookup
  const velocityMap = new Map();
  for (const v of velocityMetrics) {
    velocityMap.set(v.sku, v);
  }

  // Classify each SKU
  const classified = [];
  for (const item of inventory) {
    const sku = item.sku || item.strain;
    const velocity = velocityMap.get(sku) || null;
    const classification = classifySKU(item, velocity);

    if (!classification.excluded) {
      classified.push(classification);
    }
  }

  // Group by decision type
  const grouped = {
    [DECISION_TYPES.REORDER_NOW]: [],
    [DECISION_TYPES.SELL_NOW]: [],
    [DECISION_TYPES.HOLD_LINE]: [],
    [DECISION_TYPES.DEPRIORITIZE]: []
  };

  for (const c of classified) {
    if (c.decision && grouped[c.decision]) {
      grouped[c.decision].push(c);
    }
  }

  // Sort each group by urgency (highest first)
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => (b.urgency || 0) - (a.urgency || 0));
  }

  return {
    byType: grouped,
    all: classified,
    summary: {
      reorderNow: grouped[DECISION_TYPES.REORDER_NOW].length,
      sellNow: grouped[DECISION_TYPES.SELL_NOW].length,
      holdLine: grouped[DECISION_TYPES.HOLD_LINE].length,
      deprioritize: grouped[DECISION_TYPES.DEPRIORITIZE].length,
      total: classified.length
    }
  };
}

/**
 * Generate Action Cards for the UI
 *
 * Each card has:
 * - ACTION: SELL NOW / REORDER NOW / HOLD LINE / DEPRIORITIZE
 * - SKU: name/unit
 * - WHY: one sentence
 * - WHAT TO DO: specific action
 * - MONEY IMPACT: $ at risk or opportunity
 * - TIMEFRAME: TODAY / THIS WEEK / SOON
 *
 * @param {Array} classified - Classified SKUs
 * @param {object} options - Options for card generation
 * @returns {Array} Action cards
 */
export function generateActionCards(classified, options = {}) {
  const {
    maxCards = 10,
    includeDeprioritize = false
  } = options;

  const cards = [];

  // REORDER_NOW cards first (most urgent)
  for (const item of classified.byType[DECISION_TYPES.REORDER_NOW].slice(0, 5)) {
    cards.push(formatActionCard(item, {
      actionLabel: 'REORDER NOW',
      actionColor: 'red',
      icon: '🔴'
    }));
  }

  // SELL_NOW cards next
  for (const item of classified.byType[DECISION_TYPES.SELL_NOW].slice(0, 3)) {
    cards.push(formatActionCard(item, {
      actionLabel: 'SELL NOW',
      actionColor: 'orange',
      icon: '🟠'
    }));
  }

  // HOLD_LINE cards (protection reminders)
  for (const item of classified.byType[DECISION_TYPES.HOLD_LINE].slice(0, 2)) {
    cards.push(formatActionCard(item, {
      actionLabel: 'HOLD LINE',
      actionColor: 'green',
      icon: '🟢'
    }));
  }

  // DEPRIORITIZE only if requested
  if (includeDeprioritize) {
    for (const item of classified.byType[DECISION_TYPES.DEPRIORITIZE].slice(0, 2)) {
      cards.push(formatActionCard(item, {
        actionLabel: 'DEPRIORITIZE',
        actionColor: 'gray',
        icon: '⚪'
      }));
    }
  }

  return cards.slice(0, maxCards);
}

/**
 * Format a single action card
 */
function formatActionCard(item, display) {
  return {
    // Display properties
    action: display.actionLabel,
    actionColor: display.actionColor,
    icon: display.icon,

    // Core content
    sku: item.sku,
    name: item.name,
    why: item.reason,
    whatToDo: item.whatToDo,
    moneyImpact: item.moneyImpact,
    timeframe: item.timeframe,

    // Raw data for UI logic
    decision: item.decision,
    urgency: item.urgency,
    metrics: item.metrics
  };
}

/**
 * Generate Executive Action Brief
 *
 * This is THE output for the snapshot page:
 * - Section 1: "WHAT TO DO THIS WEEK" (REORDER_NOW + SELL_NOW)
 * - Section 2: "PROTECT THESE" (HOLD_LINE)
 * - Section 3: "IGNORE FOR NOW" (DEPRIORITIZE count only)
 *
 * @param {object} snapshot - Full snapshot with intelligence
 * @returns {object} Executive action brief
 */
export function generateExecutiveActionBrief(snapshot) {
  const inventory = snapshot.enrichedInventory || [];
  const velocityMetrics = snapshot.velocity?.velocityMetrics || [];

  // Classify all SKUs
  const classified = classifyAllSKUs(inventory, velocityMetrics);

  // Generate action cards
  const actionCards = generateActionCards(classified, {
    maxCards: 10,
    includeDeprioritize: false
  });

  // Calculate total money at risk/opportunity
  const reorderRisk = classified.byType[DECISION_TYPES.REORDER_NOW].reduce((sum, item) => {
    return sum + (item.metrics?.weeklyProfit || 0);
  }, 0);

  const sellOpportunity = classified.byType[DECISION_TYPES.SELL_NOW].reduce((sum, item) => {
    return sum + (item.metrics?.totalProfitAtRisk || 0);
  }, 0);

  const holdValue = classified.byType[DECISION_TYPES.HOLD_LINE].reduce((sum, item) => {
    return sum + (item.metrics?.weeklyProfit || 0);
  }, 0);

  // Build the brief
  return {
    // THE HEADLINE
    headline: generateHeadline(classified, reorderRisk, sellOpportunity),

    // SECTION 1: What to do this week
    thisWeek: {
      title: 'WHAT TO DO THIS WEEK',
      cards: actionCards.filter(c =>
        c.decision === DECISION_TYPES.REORDER_NOW ||
        c.decision === DECISION_TYPES.SELL_NOW
      ),
      summary: {
        reorderCount: classified.summary.reorderNow,
        sellCount: classified.summary.sellNow,
        totalMoneyAtStake: reorderRisk + sellOpportunity
      }
    },

    // SECTION 2: Protect these
    protect: {
      title: 'PROTECT THESE',
      subtitle: 'Do not discount. Maintain margin.',
      cards: actionCards.filter(c => c.decision === DECISION_TYPES.HOLD_LINE),
      summary: {
        count: classified.summary.holdLine,
        weeklyValue: holdValue
      }
    },

    // SECTION 3: Ignore for now
    ignore: {
      title: 'IGNORE FOR NOW',
      subtitle: `${classified.summary.deprioritize} items with no urgent action`,
      count: classified.summary.deprioritize
      // No cards - just a count
    },

    // Raw classification data
    classified,

    // Summary stats
    summary: classified.summary,

    // Metadata
    generatedAt: new Date().toISOString()
  };
}

/**
 * Generate a compelling headline for the brief
 */
function generateHeadline(classified, reorderRisk, sellOpportunity) {
  const reorderCount = classified.summary.reorderNow;
  const sellCount = classified.summary.sellNow;
  const totalMoney = reorderRisk + sellOpportunity;

  if (reorderCount > 0 && totalMoney > 0) {
    return `${reorderCount} SKU${reorderCount > 1 ? 's' : ''} need reorder. $${Math.round(totalMoney).toLocaleString()} at stake this week.`;
  }

  if (sellCount > 0 && sellOpportunity > 0) {
    return `$${Math.round(sellOpportunity).toLocaleString()} in profit sitting idle. ${sellCount} items need promotion.`;
  }

  if (reorderCount > 0) {
    return `${reorderCount} SKU${reorderCount > 1 ? 's' : ''} need reorder to avoid stockout.`;
  }

  if (sellCount > 0) {
    return `${sellCount} slow-moving items need attention.`;
  }

  return 'Inventory is stable. Focus on optimization.';
}
