/**
 * ════════════════════════════════════════════════════════════════════════════
 * SKU FACT LAYER + DECISION CLASSIFIER
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ARCHITECTURE:
 * 1. SKU Fact Layer builds VALIDATED per-SKU facts BEFORE any decision logic
 * 2. Decision logic ONLY consumes fact objects - NO direct raw data reads
 * 3. SKUs without complete facts are EXCLUDED entirely - no partial cards
 *
 * FACT OBJECT SCHEMA:
 * {
 *   sku: string,
 *   product_name: string,
 *   variant_name: string,
 *   units_sold_in_period: number,
 *   revenue_in_period: number,
 *   unit_cost: number,
 *   unit_margin: number,
 *   available_quantity: number,
 *   days_of_coverage: number | null,
 *   velocity: number
 * }
 *
 * OUTPUT RULES:
 * - Max 3 actions
 * - Each action references specific SKU
 * - Each action includes numeric upside/downside
 * - Zero valid actions → "No high-confidence actions this period."
 */

// ============================================================================
// DECISION TYPES
// ============================================================================
export const DECISION_TYPES = {
  SELL_NOW: 'SELL_NOW',
  REORDER_NOW: 'REORDER_NOW',
  HOLD_LINE: 'HOLD_LINE',
  DEPRIORITIZE: 'DEPRIORITIZE'
};

// ============================================================================
// THRESHOLDS
// ============================================================================
const THRESHOLDS = {
  HIGH_VELOCITY: 0.5,
  LOW_VELOCITY: 0.2,
  HIGH_MARGIN: 50,
  LOW_MARGIN: 35,
  LOW_STOCK_DAYS: 10,
  CRITICAL_STOCK_DAYS: 5,
  MIN_STOCK_FOR_SELL: 3
};

// ============================================================================
// SKU FACT LAYER
// ============================================================================

/**
 * Build a validated SKU fact object.
 * Returns null if ANY required field cannot be validated.
 *
 * @param {object} item - Raw inventory item
 * @param {object} velocityData - Velocity metrics for this SKU
 * @param {object} periodSales - Sales data for the selected period
 * @returns {object|null} Validated fact object or null if incomplete
 */
export function buildSKUFact(item, velocityData = null, periodSales = null) {
  // ════════════════════════════════════════════════════════════════════════
  // REQUIRED: SKU identifier
  // ════════════════════════════════════════════════════════════════════════
  const sku = item.sku;
  if (!sku || typeof sku !== 'string' || sku.trim() === '' || sku === 'UNKNOWN') {
    return null; // EXCLUDE: No valid SKU
  }

  // ════════════════════════════════════════════════════════════════════════
  // REQUIRED: Product name (non-empty, non-Unknown)
  // ════════════════════════════════════════════════════════════════════════
  const rawProductName = item.product_name || item.strain || item.name;
  if (!rawProductName || typeof rawProductName !== 'string') {
    return null; // EXCLUDE: No product name
  }
  const product_name = rawProductName.trim();
  if (product_name === '' || product_name.toLowerCase() === 'unknown') {
    return null; // EXCLUDE: Invalid product name
  }

  // ════════════════════════════════════════════════════════════════════════
  // REQUIRED: Variant name (non-empty, non-Unknown)
  // ════════════════════════════════════════════════════════════════════════
  const rawVariantName = item.variant_name || item.unit;
  if (!rawVariantName || typeof rawVariantName !== 'string') {
    return null; // EXCLUDE: No variant name
  }
  const variant_name = rawVariantName.trim();
  if (variant_name === '' || variant_name.toLowerCase() === 'unknown') {
    return null; // EXCLUDE: Invalid variant name
  }

  // ════════════════════════════════════════════════════════════════════════
  // REQUIRED: Available quantity (finite number >= 0)
  // ════════════════════════════════════════════════════════════════════════
  const rawQuantity = item.availableQuantity ?? item.quantity ?? item.quantity_on_hand;
  if (typeof rawQuantity !== 'number' || !isFinite(rawQuantity) || rawQuantity < 0) {
    return null; // EXCLUDE: Invalid quantity
  }
  const available_quantity = rawQuantity;

  // ════════════════════════════════════════════════════════════════════════
  // REQUIRED: Unit cost (finite number > 0)
  // ════════════════════════════════════════════════════════════════════════
  const rawCost = item.pricing?.cost ?? item.unit_cost ?? item.cost;
  if (typeof rawCost !== 'number' || !isFinite(rawCost) || rawCost <= 0) {
    return null; // EXCLUDE: Invalid unit cost
  }
  const unit_cost = rawCost;

  // ════════════════════════════════════════════════════════════════════════
  // REQUIRED: Retail price (finite number > cost)
  // ════════════════════════════════════════════════════════════════════════
  const rawRetail = item.pricing?.retail ?? item.retail ?? item.price;
  if (typeof rawRetail !== 'number' || !isFinite(rawRetail) || rawRetail <= unit_cost) {
    return null; // EXCLUDE: Invalid retail price
  }
  const retail = rawRetail;

  // ════════════════════════════════════════════════════════════════════════
  // DERIVED: Unit margin (retail - cost, must be > 0)
  // ════════════════════════════════════════════════════════════════════════
  const unit_margin = parseFloat((retail - unit_cost).toFixed(2));
  if (!isFinite(unit_margin) || unit_margin <= 0) {
    return null; // EXCLUDE: Invalid margin
  }

  // ════════════════════════════════════════════════════════════════════════
  // DERIVED: Margin percent
  // ════════════════════════════════════════════════════════════════════════
  const margin_percent = parseFloat(((unit_margin / retail) * 100).toFixed(2));

  // ════════════════════════════════════════════════════════════════════════
  // VELOCITY: Daily velocity (default 0 if no data, must be finite)
  // ════════════════════════════════════════════════════════════════════════
  const rawVelocity = velocityData?.dailyVelocity ?? velocityData?.avgDaily ?? velocityData?.avg_daily ?? 0;
  if (typeof rawVelocity !== 'number' || !isFinite(rawVelocity)) {
    return null; // EXCLUDE: Invalid velocity
  }
  const velocity = Math.max(0, rawVelocity);

  // ════════════════════════════════════════════════════════════════════════
  // DERIVED: Days of coverage (quantity / velocity, null if velocity = 0)
  // ════════════════════════════════════════════════════════════════════════
  let days_of_coverage = null;
  if (velocity > 0 && available_quantity > 0) {
    days_of_coverage = Math.round(available_quantity / velocity);
    if (!isFinite(days_of_coverage)) {
      days_of_coverage = null;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // PERIOD SALES: Units sold and revenue in period (default 0)
  // ════════════════════════════════════════════════════════════════════════
  const units_sold_in_period = periodSales?.units_sold ?? periodSales?.total_sold ?? velocityData?.total_sold ?? 0;
  const revenue_in_period = periodSales?.revenue ?? periodSales?.total_revenue ?? velocityData?.total_revenue ?? 0;

  // ════════════════════════════════════════════════════════════════════════
  // FACT OBJECT: All fields validated
  // ════════════════════════════════════════════════════════════════════════
  return {
    sku,
    product_name,
    variant_name,
    display_name: `${product_name} (${variant_name})`,
    available_quantity,
    unit_cost,
    retail,
    unit_margin,
    margin_percent,
    velocity,
    days_of_coverage,
    units_sold_in_period: isFinite(units_sold_in_period) ? units_sold_in_period : 0,
    revenue_in_period: isFinite(revenue_in_period) ? revenue_in_period : 0
  };
}

/**
 * Build SKU Fact Table for entire inventory.
 * EXCLUDES any SKU that cannot produce a complete fact object.
 *
 * @param {Array} inventory - Raw inventory items
 * @param {Array} velocityMetrics - Velocity data array
 * @param {object} periodSalesMap - Map of SKU → period sales
 * @returns {object} { facts: Map<sku, fact>, excluded: number, reasons: object }
 */
export function buildSKUFactTable(inventory, velocityMetrics = [], periodSalesMap = {}) {
  const facts = new Map();
  let excluded = 0;
  const reasons = {
    no_sku: 0,
    no_product_name: 0,
    no_variant_name: 0,
    invalid_quantity: 0,
    invalid_cost: 0,
    invalid_retail: 0,
    invalid_margin: 0,
    invalid_velocity: 0
  };

  // Build velocity lookup
  const velocityMap = new Map();
  for (const v of velocityMetrics) {
    if (v.sku) {
      velocityMap.set(v.sku, v);
    }
  }

  // Process each inventory item
  for (const item of inventory) {
    const sku = item.sku;
    const velocityData = velocityMap.get(sku) || null;
    const periodSales = periodSalesMap[sku] || null;

    const fact = buildSKUFact(item, velocityData, periodSales);

    if (fact) {
      facts.set(sku, fact);
    } else {
      excluded++;
      // Track reason (simplified)
      if (!item.sku) reasons.no_sku++;
      else if (!item.product_name && !item.strain && !item.name) reasons.no_product_name++;
      else if (!item.variant_name && !item.unit) reasons.no_variant_name++;
    }
  }

  console.log(`[FactLayer] Built ${facts.size} validated facts, excluded ${excluded} SKUs`);

  return { facts, excluded, reasons };
}

// ============================================================================
// DECISION LOGIC - CONSUMES ONLY FACT OBJECTS
// ============================================================================

/**
 * Classify a SKU based on its fact object.
 * ONLY reads from the validated fact - NO raw data access.
 *
 * @param {object} fact - Validated SKU fact object
 * @returns {object} Decision classification
 */
export function classifyFromFact(fact) {
  const {
    sku,
    display_name,
    available_quantity,
    unit_margin,
    margin_percent,
    velocity,
    days_of_coverage
  } = fact;

  // Skip out-of-stock items
  if (available_quantity <= 0) {
    return { sku, decision: null, excluded: true };
  }

  // Calculate profit values from FACT data only
  const profit_at_risk = parseFloat((available_quantity * unit_margin).toFixed(2));
  const daily_profit = parseFloat((velocity * unit_margin).toFixed(2));
  const weekly_profit = parseFloat((daily_profit * 7).toFixed(2));

  // ════════════════════════════════════════════════════════════════════════
  // RULE 1: REORDER_NOW - High velocity + low stock coverage
  // ════════════════════════════════════════════════════════════════════════
  const isHighVelocity = velocity >= THRESHOLDS.HIGH_VELOCITY;
  const isLowCoverage = days_of_coverage !== null && days_of_coverage <= THRESHOLDS.LOW_STOCK_DAYS;
  const isCriticalCoverage = days_of_coverage !== null && days_of_coverage <= THRESHOLDS.CRITICAL_STOCK_DAYS;

  if (isHighVelocity && isLowCoverage) {
    return {
      sku,
      name: display_name,
      decision: DECISION_TYPES.REORDER_NOW,
      reason: `Selling ${velocity.toFixed(1)}/day with only ${days_of_coverage} days of stock`,
      whatToDo: isCriticalCoverage
        ? `Reorder immediately - stockout in ${days_of_coverage} days`
        : `Place reorder this week`,
      dollarImpact: weekly_profit,
      impactLabel: `$${weekly_profit.toLocaleString()}/week at risk`,
      timeframe: isCriticalCoverage ? 'TODAY' : 'THIS_WEEK',
      urgency: isCriticalCoverage ? 3 : 2,
      fact // Include fact for transparency
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // RULE 2: SELL_NOW - Slow velocity + has stock = trapped profit
  // ════════════════════════════════════════════════════════════════════════
  const isSlowVelocity = velocity < THRESHOLDS.LOW_VELOCITY;
  const hasStock = available_quantity >= THRESHOLDS.MIN_STOCK_FOR_SELL;
  const hasMargin = margin_percent > 0;

  if (isSlowVelocity && hasStock && hasMargin) {
    const daysToSellout = velocity > 0 ? Math.round(available_quantity / velocity) : 999;

    return {
      sku,
      name: display_name,
      decision: DECISION_TYPES.SELL_NOW,
      reason: `${available_quantity} units moving at ${velocity.toFixed(2)}/day (${daysToSellout}+ days to sell)`,
      whatToDo: margin_percent >= THRESHOLDS.HIGH_MARGIN
        ? 'Feature prominently - high margin covers promotion cost'
        : 'Consider 15-20% discount to accelerate',
      dollarImpact: profit_at_risk,
      impactLabel: `$${profit_at_risk.toLocaleString()} trapped`,
      timeframe: 'THIS_WEEK',
      urgency: 1,
      fact
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // RULE 3: HOLD_LINE - High margin + reasonable velocity
  // ════════════════════════════════════════════════════════════════════════
  const isHighMargin = margin_percent >= THRESHOLDS.HIGH_MARGIN;
  const hasReasonableVelocity = velocity >= THRESHOLDS.LOW_VELOCITY;

  if (isHighMargin && hasReasonableVelocity) {
    return {
      sku,
      name: display_name,
      decision: DECISION_TYPES.HOLD_LINE,
      reason: `${margin_percent.toFixed(0)}% margin with ${velocity.toFixed(1)}/day velocity`,
      whatToDo: 'Do NOT discount - protect margin',
      dollarImpact: weekly_profit,
      impactLabel: `$${weekly_profit.toLocaleString()}/week at full margin`,
      timeframe: 'ONGOING',
      urgency: 0,
      fact
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // RULE 4: DEPRIORITIZE - Default (no urgent action)
  // ════════════════════════════════════════════════════════════════════════
  return {
    sku,
    name: display_name,
    decision: DECISION_TYPES.DEPRIORITIZE,
    reason: 'No urgent signals',
    whatToDo: 'Monitor - no action needed',
    dollarImpact: 0,
    impactLabel: null,
    timeframe: 'NONE',
    urgency: -1,
    fact
  };
}

/**
 * Classify all SKUs from fact table.
 *
 * @param {Map} factTable - Map of SKU → validated fact
 * @returns {object} Classified decisions grouped by type
 */
export function classifyAllFromFacts(factTable) {
  const grouped = {
    [DECISION_TYPES.REORDER_NOW]: [],
    [DECISION_TYPES.SELL_NOW]: [],
    [DECISION_TYPES.HOLD_LINE]: [],
    [DECISION_TYPES.DEPRIORITIZE]: []
  };

  for (const [sku, fact] of factTable) {
    const decision = classifyFromFact(fact);

    if (!decision.excluded && decision.decision && grouped[decision.decision]) {
      grouped[decision.decision].push(decision);
    }
  }

  // Sort by urgency (highest first), then by dollar impact
  for (const type of Object.keys(grouped)) {
    grouped[type].sort((a, b) => {
      if (b.urgency !== a.urgency) return b.urgency - a.urgency;
      return (b.dollarImpact || 0) - (a.dollarImpact || 0);
    });
  }

  return {
    byType: grouped,
    summary: {
      reorderNow: grouped[DECISION_TYPES.REORDER_NOW].length,
      sellNow: grouped[DECISION_TYPES.SELL_NOW].length,
      holdLine: grouped[DECISION_TYPES.HOLD_LINE].length,
      deprioritize: grouped[DECISION_TYPES.DEPRIORITIZE].length,
      total: factTable.size
    }
  };
}

// ============================================================================
// EXECUTIVE ACTION BRIEF - MAX 3 ACTIONS
// ============================================================================

/**
 * Generate Executive Action Brief.
 *
 * OUTPUT RULES:
 * - Max 3 actions total
 * - Each action references specific SKU with numeric impact
 * - Zero valid actions → "No high-confidence actions this period."
 *
 * @param {object} snapshot - Snapshot with enrichedInventory and velocity
 * @returns {object} Action brief for UI
 */
export function generateExecutiveActionBrief(snapshot) {
  const inventory = snapshot.enrichedInventory || [];
  const velocityMetrics = snapshot.velocity?.velocityMetrics || [];

  // ════════════════════════════════════════════════════════════════════════
  // STEP 1: BUILD SKU FACT TABLE
  // ════════════════════════════════════════════════════════════════════════
  const { facts, excluded, reasons } = buildSKUFactTable(inventory, velocityMetrics, {});

  console.log(`[ActionBrief] Fact table: ${facts.size} valid, ${excluded} excluded`);

  // ════════════════════════════════════════════════════════════════════════
  // STEP 2: CLASSIFY FROM FACTS ONLY
  // ════════════════════════════════════════════════════════════════════════
  const classified = classifyAllFromFacts(facts);

  // ════════════════════════════════════════════════════════════════════════
  // STEP 3: SELECT TOP 3 ACTIONS (priority: REORDER > SELL > HOLD)
  // ════════════════════════════════════════════════════════════════════════
  const MAX_ACTIONS = 3;
  const actions = [];

  // Priority 1: REORDER_NOW (most urgent)
  for (const d of classified.byType[DECISION_TYPES.REORDER_NOW]) {
    if (actions.length >= MAX_ACTIONS) break;
    if (d.dollarImpact > 0) {
      actions.push(formatAction(d));
    }
  }

  // Priority 2: SELL_NOW
  for (const d of classified.byType[DECISION_TYPES.SELL_NOW]) {
    if (actions.length >= MAX_ACTIONS) break;
    if (d.dollarImpact > 0) {
      actions.push(formatAction(d));
    }
  }

  // Priority 3: HOLD_LINE (only if space remains)
  for (const d of classified.byType[DECISION_TYPES.HOLD_LINE]) {
    if (actions.length >= MAX_ACTIONS) break;
    if (d.dollarImpact > 0) {
      actions.push(formatAction(d));
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // STEP 4: GENERATE HEADLINE
  // ════════════════════════════════════════════════════════════════════════
  let headline;
  if (actions.length === 0) {
    headline = 'No high-confidence actions this period.';
  } else if (actions.length === 1) {
    const top = actions[0];
    headline = `${top.name}: ${top.impactLabel}`;
  } else {
    const totalImpact = actions.reduce((sum, a) => sum + (a.dollarImpact || 0), 0);
    headline = `${actions.length} actions identified. $${totalImpact.toLocaleString()} at stake.`;
  }

  // ════════════════════════════════════════════════════════════════════════
  // STEP 5: BUILD OUTPUT
  // ════════════════════════════════════════════════════════════════════════
  return {
    headline,
    actions, // Max 3, each grounded in fact
    thisWeek: {
      title: 'ACTIONS',
      cards: actions
    },
    protect: {
      title: 'PROTECT',
      cards: [] // Removed - only show in actions if space
    },
    ignore: {
      count: classified.summary.deprioritize
    },
    summary: classified.summary,
    factLayerStats: {
      validFacts: facts.size,
      excluded,
      reasons
    },
    generatedAt: new Date().toISOString()
  };
}

/**
 * Format a decision into an action card.
 */
function formatAction(decision) {
  return {
    sku: decision.sku,
    name: decision.name,
    decision: decision.decision,
    why: decision.reason,
    whatToDo: decision.whatToDo,
    dollarImpact: decision.dollarImpact,
    impactLabel: decision.impactLabel,
    moneyImpact: decision.impactLabel, // Alias for UI compatibility
    timeframe: decision.timeframe,
    urgency: decision.urgency,
    // Fact data for transparency
    metrics: decision.fact ? {
      quantity: decision.fact.available_quantity,
      velocity: decision.fact.velocity,
      margin: decision.fact.margin_percent,
      profitPerUnit: decision.fact.unit_margin,
      daysOfCoverage: decision.fact.days_of_coverage
    } : null
  };
}

// ============================================================================
// LEGACY EXPORTS (for backwards compatibility)
// ============================================================================

export function classifySKU(item, velocityData = null) {
  const fact = buildSKUFact(item, velocityData, null);
  if (!fact) {
    return {
      sku: item.sku || 'UNKNOWN',
      name: 'Unknown',
      decision: null,
      excluded: true,
      reason: 'Incomplete fact data'
    };
  }
  return classifyFromFact(fact);
}

export function classifyAllSKUs(inventory, velocityMetrics = []) {
  const { facts } = buildSKUFactTable(inventory, velocityMetrics, {});
  return classifyAllFromFacts(facts);
}
