/**
 * ════════════════════════════════════════════════════════════════════════════
 * SPLIT FACT LAYER + DECISION CLASSIFIER
 * ════════════════════════════════════════════════════════════════════════════
 *
 * TWO FACT TYPES:
 *
 * 1. SALES_FACTS (historical) - SKUs that SOLD in the timeframe
 *    - sku, product_name, variant_name
 *    - units_sold, revenue
 *    - unit_cost, unit_margin
 *
 * 2. INVENTORY_FACTS (forward-looking) - ALL sellable SKUs
 *    - sku, product_name, variant_name
 *    - available_quantity
 *    - unit_cost
 *    - days_since_last_sale
 *    - velocity (0 allowed)
 *
 * DECISION LOGIC:
 * - SELL/FEATURE → SALES_FACTS (has performance data)
 * - DISCOUNT SLOW MOVERS → INVENTORY_FACTS only (no sales = slow)
 * - REORDER → requires both facts (selling well + low stock)
 *
 * AVG MARGIN:
 * - Computed ONLY from SALES_FACTS
 * - Weighted by revenue
 * - Never blocked by inventory-only SKUs
 */

// ============================================================================
// DECISION TYPES
// ============================================================================
export const DECISION_TYPES = {
  SELL_NOW: 'SELL_NOW',
  REORDER_NOW: 'REORDER_NOW',
  HOLD_LINE: 'HOLD_LINE',
  DISCOUNT_SLOW: 'DISCOUNT_SLOW',
  DEPRIORITIZE: 'DEPRIORITIZE'
};

// ============================================================================
// THRESHOLDS
// ============================================================================
const THRESHOLDS = {
  HIGH_VELOCITY: 0.5,
  LOW_VELOCITY: 0.1,
  HIGH_MARGIN: 50,
  LOW_STOCK_DAYS: 10,
  CRITICAL_STOCK_DAYS: 5,
  MIN_STOCK_FOR_DISCOUNT: 5,
  SLOW_MOVER_DAYS: 14  // No sale in 14+ days = slow mover
};

// ============================================================================
// SALES FACT BUILDER
// ============================================================================

/**
 * Build a SALES_FACT for a SKU that sold in the period.
 * Returns null if missing required sales data.
 *
 * HARD GATE: Items without valid identity are BLOCKED.
 */
function buildSalesFact(item, salesData) {
  // ════════════════════════════════════════════════════════════════════════
  // IDENTITY GATE: Block items with invalid identity
  // ════════════════════════════════════════════════════════════════════════
  if (item.hasValidIdentity === false) {
    return null;
  }

  // Must have sales in period
  const units_sold = salesData?.units_sold ?? salesData?.total_sold ?? salesData?.quantity_sold ?? 0;
  if (units_sold <= 0) {
    return null; // No sales = no sales fact
  }

  // Required: SKU
  const sku = item.sku;
  if (!sku || typeof sku !== 'string' || sku.trim() === '') {
    return null;
  }

  // Required: Names (allow flexible sources)
  const product_name = item.product_name || item.strain || item.name || null;
  const variant_name = item.variant_name || item.unit || null;
  if (!product_name || !variant_name) {
    return null;
  }

  // REJECT: Names containing 'MISSING' or 'Unknown' (case-insensitive)
  const nameLower = (product_name + variant_name).toLowerCase();
  if (nameLower.includes('missing') || nameLower.includes('unknown')) {
    return null;
  }

  // Revenue
  const revenue = salesData?.revenue ?? salesData?.total_revenue ?? 0;

  // Cost (optional but preferred)
  const unit_cost = item.pricing?.cost ?? item.unit_cost ?? item.cost ?? null;

  // Margin (compute if we have cost and revenue)
  let unit_margin = null;
  if (unit_cost !== null && unit_cost > 0 && units_sold > 0 && revenue > 0) {
    const avg_price = revenue / units_sold;
    unit_margin = parseFloat((avg_price - unit_cost).toFixed(2));
  }

  return {
    sku,
    product_name,
    variant_name,
    display_name: `${product_name} (${variant_name})`,
    units_sold,
    revenue,
    unit_cost,
    unit_margin,
    margin_percent: (unit_margin !== null && revenue > 0 && units_sold > 0)
      ? parseFloat(((unit_margin / (revenue / units_sold)) * 100).toFixed(2))
      : null
  };
}

// ============================================================================
// INVENTORY FACT BUILDER
// ============================================================================

/**
 * Build an INVENTORY_FACT for any sellable SKU.
 *
 * HARD GATE: Items without valid identity are BLOCKED.
 */
function buildInventoryFact(item, velocityData) {
  // ════════════════════════════════════════════════════════════════════════
  // IDENTITY GATE: Block items with invalid identity
  // ════════════════════════════════════════════════════════════════════════
  if (item.hasValidIdentity === false) {
    return null;
  }

  // Required: SKU
  const sku = item.sku;
  if (!sku || typeof sku !== 'string' || sku.trim() === '') {
    return null;
  }

  // Required: Names
  const product_name = item.product_name || item.strain || item.name || null;
  const variant_name = item.variant_name || item.unit || null;
  if (!product_name || !variant_name) {
    return null;
  }

  // REJECT: Names containing 'MISSING' or 'Unknown' (case-insensitive)
  const nameLower = (product_name + variant_name).toLowerCase();
  if (nameLower.includes('missing') || nameLower.includes('unknown')) {
    return null;
  }

  // Required: Quantity (must be >= 0)
  const available_quantity = item.availableQuantity ?? item.quantity ?? item.quantity_on_hand ?? null;
  if (available_quantity === null || available_quantity < 0) {
    return null;
  }

  // Cost (optional)
  const unit_cost = item.pricing?.cost ?? item.unit_cost ?? item.cost ?? null;

  // Retail (optional)
  const retail = item.pricing?.retail ?? item.retail ?? item.price ?? null;

  // Velocity (0 is valid - means slow mover)
  const velocity = velocityData?.dailyVelocity ?? velocityData?.avgDaily ?? velocityData?.avg_daily ?? 0;

  // Days since last sale
  const last_sold_at = velocityData?.last_sold_at ?? velocityData?.lastSoldAt ?? null;
  let days_since_last_sale = null;
  if (last_sold_at) {
    const lastSaleDate = new Date(last_sold_at);
    const now = new Date();
    days_since_last_sale = Math.floor((now - lastSaleDate) / (1000 * 60 * 60 * 24));
  }

  // Days of coverage
  let days_of_coverage = null;
  if (velocity > 0 && available_quantity > 0) {
    days_of_coverage = Math.round(available_quantity / velocity);
  }

  // Unit margin (if we have both cost and retail)
  let unit_margin = null;
  if (unit_cost !== null && retail !== null && retail > unit_cost) {
    unit_margin = parseFloat((retail - unit_cost).toFixed(2));
  }

  return {
    sku,
    product_name,
    variant_name,
    display_name: `${product_name} (${variant_name})`,
    available_quantity,
    unit_cost,
    retail,
    unit_margin,
    velocity,
    days_of_coverage,
    days_since_last_sale,
    is_slow_mover: velocity < THRESHOLDS.LOW_VELOCITY || (days_since_last_sale !== null && days_since_last_sale >= THRESHOLDS.SLOW_MOVER_DAYS)
  };
}

// ============================================================================
// FACT TABLE BUILDERS
// ============================================================================

/**
 * Build both fact tables from inventory and sales data.
 */
export function buildFactTables(inventory, velocityMetrics = [], periodSalesMap = {}) {
  const salesFacts = new Map();
  const inventoryFacts = new Map();

  // Build velocity lookup
  const velocityMap = new Map();
  for (const v of velocityMetrics) {
    if (v.sku) velocityMap.set(v.sku, v);
  }

  // Build sales lookup from velocity metrics (which include sales data)
  const salesMap = new Map();
  for (const v of velocityMetrics) {
    if (v.sku && (v.total_sold > 0 || v.units_sold > 0)) {
      salesMap.set(v.sku, {
        units_sold: v.total_sold || v.units_sold || 0,
        revenue: v.total_revenue || v.revenue || 0
      });
    }
  }
  // Merge with explicit period sales
  for (const [sku, sales] of Object.entries(periodSalesMap)) {
    if (sales.units_sold > 0 || sales.total_sold > 0) {
      salesMap.set(sku, {
        units_sold: sales.units_sold || sales.total_sold || 0,
        revenue: sales.revenue || sales.total_revenue || 0
      });
    }
  }

  // Process each inventory item
  for (const item of inventory) {
    const sku = item.sku;
    if (!sku) continue;

    const velocityData = velocityMap.get(sku);
    const salesData = salesMap.get(sku);

    // Try to build INVENTORY_FACT (for all sellable SKUs)
    const invFact = buildInventoryFact(item, velocityData);
    if (invFact) {
      inventoryFacts.set(sku, invFact);
    }

    // Try to build SALES_FACT (only for SKUs with sales)
    if (salesData) {
      const salesFact = buildSalesFact(item, salesData);
      if (salesFact) {
        salesFacts.set(sku, salesFact);
      }
    }
  }

  console.log(`[FactLayer] Built ${salesFacts.size} SALES_FACTS, ${inventoryFacts.size} INVENTORY_FACTS`);

  return { salesFacts, inventoryFacts };
}

// ============================================================================
// WEIGHTED AVERAGE MARGIN (from SALES_FACTS only)
// ============================================================================

/**
 * Compute weighted average margin from SALES_FACTS only.
 * Weighted by revenue (more accurate than unit count).
 *
 * STRICT: All values must be finite. NaN propagation is blocked.
 */
export function computeWeightedMargin(salesFacts) {
  let totalRevenue = 0;
  let totalMarginDollars = 0;
  let skusWithValidMargin = 0;

  for (const [sku, fact] of salesFacts) {
    // STRICT: All values must be finite
    if (fact.unit_margin === null || !isFinite(fact.unit_margin)) continue;
    if (fact.revenue === null || !isFinite(fact.revenue) || fact.revenue <= 0) continue;
    if (fact.units_sold === null || !isFinite(fact.units_sold) || fact.units_sold <= 0) continue;

    const marginContribution = fact.unit_margin * fact.units_sold;
    if (!isFinite(marginContribution)) continue;

    totalRevenue += fact.revenue;
    totalMarginDollars += marginContribution;
    skusWithValidMargin++;
  }

  // STRICT: Require minimum threshold for valid margin computation
  const MIN_SKUS_FOR_MARGIN = 5;
  if (totalRevenue <= 0 || skusWithValidMargin < MIN_SKUS_FOR_MARGIN) {
    return {
      averageMargin: null,
      totalRevenue: totalRevenue || 0,
      totalMarginDollars: totalMarginDollars || 0,
      skusWithMargin: skusWithValidMargin,
      reason: skusWithValidMargin < MIN_SKUS_FOR_MARGIN
        ? `Insufficient data (${skusWithValidMargin} SKUs with valid margin, need ${MIN_SKUS_FOR_MARGIN})`
        : 'No sales with margin data in period'
    };
  }

  const avgMarginPercent = (totalMarginDollars / totalRevenue) * 100;

  // STRICT: Final NaN guard
  if (!isFinite(avgMarginPercent)) {
    return {
      averageMargin: null,
      totalRevenue,
      totalMarginDollars,
      skusWithMargin: skusWithValidMargin,
      reason: 'Margin calculation resulted in invalid value'
    };
  }

  return {
    averageMargin: parseFloat(avgMarginPercent.toFixed(2)),
    totalRevenue,
    totalMarginDollars: parseFloat(totalMarginDollars.toFixed(2)),
    skusWithMargin: skusWithValidMargin,
    reason: null
  };
}

// ============================================================================
// DECISION LOGIC
// ============================================================================

/**
 * Generate decisions from split fact tables.
 */
export function generateDecisions(salesFacts, inventoryFacts) {
  const decisions = [];

  // ════════════════════════════════════════════════════════════════════════
  // DECISION 1: REORDER_NOW - High velocity + low stock (needs both facts)
  // REQUIRES: revenue, velocity, days_of_coverage (all must be finite)
  // ════════════════════════════════════════════════════════════════════════
  for (const [sku, invFact] of inventoryFacts) {
    const salesFact = salesFacts.get(sku);

    // VALIDATION: Must have sales AND velocity AND coverage (all finite)
    if (!salesFact) continue;
    if (!isFinite(invFact.velocity) || invFact.velocity < THRESHOLDS.HIGH_VELOCITY) continue;
    if (invFact.days_of_coverage === null || !isFinite(invFact.days_of_coverage)) continue;
    if (invFact.days_of_coverage > THRESHOLDS.LOW_STOCK_DAYS) continue;

    const isCritical = invFact.days_of_coverage <= THRESHOLDS.CRITICAL_STOCK_DAYS;

    // Calculate weekly revenue at risk
    const hasValidRevenue = salesFact.revenue > 0 && salesFact.units_sold > 0;
    const avgPrice = hasValidRevenue ? salesFact.revenue / salesFact.units_sold : 0;
    const weeklyRevenue = avgPrice * invFact.velocity * 7;

    // Only include if we can compute a valid revenue number
    if (!isFinite(weeklyRevenue)) continue;

    decisions.push({
      type: DECISION_TYPES.REORDER_NOW,
      sku,
      name: invFact.display_name,
      reason: `Selling ${invFact.velocity.toFixed(1)}/day, only ${invFact.days_of_coverage} days of stock`,
      action: isCritical ? `Reorder immediately` : `Place reorder this week`,
      dollarImpact: Math.round(weeklyRevenue),
      impactLabel: weeklyRevenue > 0 ? `$${Math.round(weeklyRevenue).toLocaleString()}/week at risk` : null,
      timeframe: isCritical ? 'TODAY' : 'THIS_WEEK',
      urgency: isCritical ? 3 : 2,
      hasFinancialData: weeklyRevenue > 0,
      metrics: {
        quantity: invFact.available_quantity,
        velocity: invFact.velocity,
        daysOfCoverage: invFact.days_of_coverage,
        unitsSold: salesFact.units_sold
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // DECISION 2: HOLD_LINE - High margin sellers (from SALES_FACTS)
  // REQUIRES: margin_percent, unit_margin (both must be finite)
  // ════════════════════════════════════════════════════════════════════════
  for (const [sku, salesFact] of salesFacts) {
    // VALIDATION: Both margin metrics must be finite numbers
    if (salesFact.margin_percent !== null &&
        isFinite(salesFact.margin_percent) &&
        salesFact.margin_percent >= THRESHOLDS.HIGH_MARGIN &&
        salesFact.unit_margin !== null &&
        isFinite(salesFact.unit_margin)) {

      const invFact = inventoryFacts.get(sku);
      const velocity = invFact?.velocity || 0;
      const weeklyProfit = salesFact.unit_margin * velocity * 7;

      // Only include if we can compute a valid profit number
      if (!isFinite(weeklyProfit)) continue;

      decisions.push({
        type: DECISION_TYPES.HOLD_LINE,
        sku,
        name: salesFact.display_name,
        reason: `${salesFact.margin_percent.toFixed(0)}% margin, sold ${salesFact.units_sold} units`,
        action: 'Do NOT discount - protect margin',
        dollarImpact: Math.round(weeklyProfit),
        impactLabel: weeklyProfit > 0 ? `$${Math.round(weeklyProfit).toLocaleString()}/week at full margin` : null,
        timeframe: 'ONGOING',
        urgency: 0,
        metrics: {
          margin: salesFact.margin_percent,
          unitsSold: salesFact.units_sold,
          revenue: salesFact.revenue
        }
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // DECISION 3: DISCOUNT_SLOW - Slow movers with stock (INVENTORY_FACTS only)
  // REQUIRES: unit_cost for financial impact calculation
  // If no cost data, still show action but with explicit messaging
  // ════════════════════════════════════════════════════════════════════════
  for (const [sku, invFact] of inventoryFacts) {
    // Skip if already has a decision
    if (decisions.some(d => d.sku === sku)) continue;

    // Slow mover with stock = discount candidate
    if (invFact.is_slow_mover && invFact.available_quantity >= THRESHOLDS.MIN_STOCK_FOR_DISCOUNT) {
      // Calculate capital at risk (cost basis)
      // NOTE: Per requirements, "Unsold Inventory at Risk" = units * cost, NOT profit
      const hasValidCost = invFact.unit_cost !== null && isFinite(invFact.unit_cost) && invFact.unit_cost > 0;
      const capitalAtRisk = hasValidCost
        ? invFact.unit_cost * invFact.available_quantity
        : null;

      // Only render if we have valid financial data OR explicit messaging
      const hasFinancialData = capitalAtRisk !== null && isFinite(capitalAtRisk);

      decisions.push({
        type: DECISION_TYPES.DISCOUNT_SLOW,
        sku,
        name: invFact.display_name,
        reason: invFact.days_since_last_sale !== null
          ? `No sale in ${invFact.days_since_last_sale} days, ${invFact.available_quantity} units sitting`
          : `${invFact.available_quantity} units, velocity ${invFact.velocity.toFixed(2)}/day`,
        action: 'Consider 15-20% discount to move inventory',
        // Dollar impact is COST BASIS (capital at risk), not profit
        dollarImpact: hasFinancialData ? Math.round(capitalAtRisk) : 0,
        impactLabel: hasFinancialData
          ? `$${Math.round(capitalAtRisk).toLocaleString()} capital at risk`
          : `${invFact.available_quantity} units (cost unknown)`,
        timeframe: 'THIS_WEEK',
        urgency: 1,
        hasFinancialData,
        metrics: {
          quantity: invFact.available_quantity,
          velocity: invFact.velocity,
          daysSinceLastSale: invFact.days_since_last_sale,
          unitCost: invFact.unit_cost
        }
      });
    }
  }

  // Sort by urgency, then dollar impact
  decisions.sort((a, b) => {
    if (b.urgency !== a.urgency) return b.urgency - a.urgency;
    return (b.dollarImpact || 0) - (a.dollarImpact || 0);
  });

  return decisions;
}

// ============================================================================
// EXECUTIVE ACTION BRIEF
// ============================================================================

/**
 * Generate Executive Action Brief from split fact tables.
 * Tracks suppressed items for diagnostic output.
 */
export function generateExecutiveActionBrief(snapshot) {
  const inventory = snapshot.enrichedInventory || [];
  const velocityMetrics = snapshot.velocity?.velocityMetrics || [];
  const suppressedItems = [];

  // ════════════════════════════════════════════════════════════════════════
  // STEP 0: TRACK EXCLUDED ITEMS
  // ════════════════════════════════════════════════════════════════════════
  for (const item of inventory) {
    if (item.hasValidIdentity === false) {
      suppressedItems.push({
        sku: item.sku,
        reason: 'Missing product_name or variant_name'
      });
    } else if (!item.hasCost && !item.hasMargin) {
      // Track items without financial data (informational, not blocking)
      // These can still have inventory-based decisions
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // STEP 1: BUILD SPLIT FACT TABLES
  // ════════════════════════════════════════════════════════════════════════
  const { salesFacts, inventoryFacts } = buildFactTables(inventory, velocityMetrics, {});

  // ════════════════════════════════════════════════════════════════════════
  // STEP 2: COMPUTE WEIGHTED MARGIN (from SALES_FACTS only)
  // ════════════════════════════════════════════════════════════════════════
  const marginResult = computeWeightedMargin(salesFacts);

  // ════════════════════════════════════════════════════════════════════════
  // STEP 3: GENERATE DECISIONS
  // ════════════════════════════════════════════════════════════════════════
  const allDecisions = generateDecisions(salesFacts, inventoryFacts);

  // ════════════════════════════════════════════════════════════════════════
  // STEP 4: SELECT TOP 3 ACTIONS
  // ════════════════════════════════════════════════════════════════════════
  const MAX_ACTIONS = 3;
  const actions = allDecisions
    .filter(d => d.type !== DECISION_TYPES.DEPRIORITIZE)
    .slice(0, MAX_ACTIONS)
    .map(d => ({
      sku: d.sku,
      name: d.name,
      decision: d.type,
      why: d.reason,
      whatToDo: d.action,
      dollarImpact: d.dollarImpact,
      impactLabel: d.impactLabel,
      moneyImpact: d.impactLabel,
      timeframe: d.timeframe,
      urgency: d.urgency,
      metrics: d.metrics
    }));

  // ════════════════════════════════════════════════════════════════════════
  // STEP 5: GENERATE HEADLINE
  // ════════════════════════════════════════════════════════════════════════
  let headline;
  if (actions.length === 0) {
    headline = 'No high-confidence actions this period.';
  } else if (actions.length === 1) {
    headline = `${actions[0].name}: ${actions[0].impactLabel || actions[0].why}`;
  } else {
    const totalImpact = actions.reduce((sum, a) => sum + (a.dollarImpact || 0), 0);
    if (totalImpact > 0) {
      headline = `${actions.length} actions identified. $${totalImpact.toLocaleString()} at stake.`;
    } else {
      headline = `${actions.length} actions identified.`;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // STEP 6: BUILD OUTPUT
  // ════════════════════════════════════════════════════════════════════════
  return {
    headline,
    actions,
    thisWeek: {
      title: 'ACTIONS',
      cards: actions
    },
    protect: { cards: [] },
    ignore: {
      count: inventoryFacts.size - actions.length
    },
    summary: {
      reorderNow: allDecisions.filter(d => d.type === DECISION_TYPES.REORDER_NOW).length,
      sellNow: allDecisions.filter(d => d.type === DECISION_TYPES.HOLD_LINE).length,
      discountSlow: allDecisions.filter(d => d.type === DECISION_TYPES.DISCOUNT_SLOW).length,
      total: inventoryFacts.size
    },
    // MARGIN DATA - from SALES_FACTS only
    marginData: marginResult,
    factLayerStats: {
      salesFacts: salesFacts.size,
      inventoryFacts: inventoryFacts.size,
      excluded: suppressedItems.length
    },
    // DIAGNOSTIC: Suppressed items and why
    suppressedItems,
    generatedAt: new Date().toISOString()
  };
}

// ============================================================================
// LEGACY EXPORTS
// ============================================================================

export function classifySKU(item, velocityData = null) {
  const invFact = buildInventoryFact(item, velocityData);
  if (!invFact) {
    return { sku: item.sku, decision: null, excluded: true };
  }

  const salesData = velocityData ? {
    units_sold: velocityData.total_sold || 0,
    revenue: velocityData.total_revenue || 0
  } : null;

  const salesFact = salesData && salesData.units_sold > 0
    ? buildSalesFact(item, salesData)
    : null;

  // Simple classification
  if (salesFact && invFact.velocity >= THRESHOLDS.HIGH_VELOCITY && invFact.days_of_coverage <= THRESHOLDS.LOW_STOCK_DAYS) {
    return { sku: item.sku, name: invFact.display_name, decision: DECISION_TYPES.REORDER_NOW };
  }
  if (salesFact && salesFact.margin_percent >= THRESHOLDS.HIGH_MARGIN) {
    return { sku: item.sku, name: invFact.display_name, decision: DECISION_TYPES.HOLD_LINE };
  }
  if (invFact.is_slow_mover && invFact.available_quantity >= THRESHOLDS.MIN_STOCK_FOR_DISCOUNT) {
    return { sku: item.sku, name: invFact.display_name, decision: DECISION_TYPES.DISCOUNT_SLOW };
  }
  return { sku: item.sku, name: invFact.display_name, decision: DECISION_TYPES.DEPRIORITIZE };
}

export function classifyAllSKUs(inventory, velocityMetrics = []) {
  const { salesFacts, inventoryFacts } = buildFactTables(inventory, velocityMetrics, {});
  const decisions = generateDecisions(salesFacts, inventoryFacts);

  const grouped = {
    [DECISION_TYPES.REORDER_NOW]: decisions.filter(d => d.type === DECISION_TYPES.REORDER_NOW),
    [DECISION_TYPES.HOLD_LINE]: decisions.filter(d => d.type === DECISION_TYPES.HOLD_LINE),
    [DECISION_TYPES.DISCOUNT_SLOW]: decisions.filter(d => d.type === DECISION_TYPES.DISCOUNT_SLOW),
    [DECISION_TYPES.DEPRIORITIZE]: []
  };

  return {
    byType: grouped,
    summary: {
      reorderNow: grouped[DECISION_TYPES.REORDER_NOW].length,
      holdLine: grouped[DECISION_TYPES.HOLD_LINE].length,
      discountSlow: grouped[DECISION_TYPES.DISCOUNT_SLOW].length,
      total: inventoryFacts.size
    }
  };
}
