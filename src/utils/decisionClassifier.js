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
 * NOTE: We do NOT check hasValidIdentity upfront anymore.
 * Instead, we extract names from compound fields first, THEN validate.
 */
function buildSalesFact(item, salesData) {
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
  // CRITICAL FIX: Extract variant from name when unit is "Unknown"
  let product_name = item.product_name || item.strain || null;
  let variant_name = item.variant_name || item.unit || null;
  const fullName = item.name || product_name || '';

  // If no product_name but we have a full name like "Mai Tai (28 G)", extract it
  if (!product_name && fullName) {
    product_name = fullName.split('(')[0].trim() || null;
  }

  // If variant is "Unknown" or missing, try to extract from name
  if (!variant_name || variant_name.toLowerCase() === 'unknown') {
    const match = fullName.match(/\(([^)]+)\)/);
    if (match) {
      variant_name = match[1];
    }
  }

  if (!product_name || !variant_name) {
    return null;
  }

  // Only reject if BOTH names are missing/unknown (not just one)
  const productLower = product_name.toLowerCase();
  if (productLower === 'missing' || productLower === 'unknown') {
    return null;
  }

  // Revenue - try multiple sources
  let revenue = salesData?.revenue ?? salesData?.total_revenue ?? 0;

  // CRITICAL FIX: Calculate revenue from pricing when missing
  if (revenue === 0 && units_sold > 0) {
    const retail = item.pricing?.retail || item.retail || item.price || 0;
    if (retail > 0) {
      revenue = units_sold * retail;
    }
  }

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
 * NOTE: We do NOT check hasValidIdentity upfront anymore.
 * Instead, we extract names from compound fields first, THEN validate.
 */
function buildInventoryFact(item, velocityData) {
  // Required: SKU
  const sku = item.sku;
  if (!sku || typeof sku !== 'string' || sku.trim() === '') {
    return null;
  }

  // Required: Names
  // CRITICAL FIX: Extract variant from name when unit is "Unknown"
  let product_name = item.product_name || item.strain || null;
  let variant_name = item.variant_name || item.unit || null;
  const fullName = item.name || product_name || '';

  // If no product_name but we have a full name like "Mai Tai (28 G)", extract it
  if (!product_name && fullName) {
    product_name = fullName.split('(')[0].trim() || null;
  }

  // If variant is "Unknown" or missing, try to extract from name
  if (!variant_name || variant_name.toLowerCase() === 'unknown') {
    const match = fullName.match(/\(([^)]+)\)/);
    if (match) {
      variant_name = match[1];
    }
  }

  if (!product_name || !variant_name) {
    return null;
  }

  // Only reject if product name is completely invalid
  const productLower = product_name.toLowerCase();
  if (productLower === 'missing' || productLower === 'unknown') {
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

  // Build velocity lookup with normalized names
  // CRITICAL FIX: Extract product_name and variant_name from velocity name field
  const velocityMap = new Map();
  for (const v of velocityMetrics) {
    if (v.sku) {
      // Extract names from format like "Mai Tai (28 G)"
      const fullName = v.name || '';
      const match = fullName.match(/\(([^)]+)\)/);
      velocityMap.set(v.sku, {
        ...v,
        // Add normalized field names
        extracted_product_name: fullName.split('(')[0].trim() || null,
        extracted_variant_name: match ? match[1] : (v.unit !== 'Unknown' ? v.unit : null)
      });
    }
  }

  // Build sales lookup from velocity metrics (which include sales data)
  // CRITICAL: Accept both camelCase (from temporalAnalyzer) AND snake_case
  const salesMap = new Map();
  for (const v of velocityMetrics) {
    const unitsSold = v.totalSold || v.total_sold || v.units_sold || 0;
    const revenue = v.totalRevenue || v.total_revenue || v.revenue || 0;
    if (v.sku && unitsSold > 0) {
      salesMap.set(v.sku, {
        units_sold: unitsSold,
        revenue: revenue
      });
    }
  }
  // Merge with explicit period sales (accept both camelCase and snake_case)
  for (const [sku, sales] of Object.entries(periodSalesMap)) {
    const unitsSold = sales.totalSold || sales.units_sold || sales.total_sold || 0;
    const revenue = sales.totalRevenue || sales.revenue || sales.total_revenue || 0;
    if (unitsSold > 0) {
      salesMap.set(sku, {
        units_sold: unitsSold,
        revenue: revenue
      });
    }
  }

  // CRITICAL FIX: Enhance inventory items with velocityMetrics names
  // This ensures items missing product_name/variant_name get them from velocity data
  const enhancedInventory = inventory.map(item => {
    const velocity = velocityMap.get(item.sku);
    if (velocity) {
      // Merge velocity names if inventory item is missing them
      return {
        ...item,
        // Use velocity extracted names as fallback
        name: item.name || velocity.name || null,
        product_name: item.product_name || item.strain || velocity.extracted_product_name || null,
        variant_name: item.variant_name || (item.unit !== 'Unknown' ? item.unit : null) || velocity.extracted_variant_name || null
      };
    }
    return item;
  });

  // Process each enhanced inventory item
  for (const item of enhancedInventory) {
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
 * SIMPLE RULE: If ANY SKU has cost data, compute and display margin.
 * Only return null if ZERO line items have cost.
 */
export function computeWeightedMargin(salesFacts) {
  let totalPeriodRevenue = 0;
  let revenueWithMargin = 0;
  let totalMarginDollars = 0;
  let skusWithValidMargin = 0;
  let skusWithSales = 0;

  for (const [sku, fact] of salesFacts) {
    // Count all SKUs with sales
    if (fact.revenue !== null && isFinite(fact.revenue) && fact.revenue > 0) {
      totalPeriodRevenue += fact.revenue;
      skusWithSales++;
    }

    // Count SKUs with valid margin data
    if (fact.unit_margin === null || !isFinite(fact.unit_margin)) continue;
    if (fact.revenue === null || !isFinite(fact.revenue) || fact.revenue <= 0) continue;
    if (fact.units_sold === null || !isFinite(fact.units_sold) || fact.units_sold <= 0) continue;

    const marginContribution = fact.unit_margin * fact.units_sold;
    if (!isFinite(marginContribution)) continue;

    revenueWithMargin += fact.revenue;
    totalMarginDollars += marginContribution;
    skusWithValidMargin++;
  }

  // Calculate coverage percentage
  const revenueCoverage = totalPeriodRevenue > 0
    ? revenueWithMargin / totalPeriodRevenue
    : 0;
  const coveragePercent = Math.round(revenueCoverage * 100);

  // SIMPLE RULE: Only block if ZERO SKUs have cost data
  if (skusWithValidMargin === 0 || revenueWithMargin <= 0) {
    return {
      averageMargin: null,
      totalRevenue: totalPeriodRevenue || 0,
      revenueWithMargin: 0,
      totalMarginDollars: 0,
      skusWithMargin: 0,
      skusWithSales,
      coveragePercent: 0,
      confidence: 'none',
      reason: 'No cost data available for sold items in this period'
    };
  }

  const avgMarginPercent = (totalMarginDollars / revenueWithMargin) * 100;

  // NaN guard
  if (!isFinite(avgMarginPercent)) {
    return {
      averageMargin: null,
      totalRevenue: totalPeriodRevenue,
      revenueWithMargin,
      totalMarginDollars,
      skusWithMargin: skusWithValidMargin,
      skusWithSales,
      coveragePercent,
      confidence: 'none',
      reason: 'Margin calculation resulted in invalid value'
    };
  }

  // Confidence is informational only - does NOT block display
  const confidence = coveragePercent >= 60 ? 'high' : 'partial';
  const reason = coveragePercent < 100
    ? `Based on ${coveragePercent}% of revenue (${skusWithValidMargin} of ${skusWithSales} SKUs with cost data)`
    : null;

  return {
    averageMargin: parseFloat(avgMarginPercent.toFixed(2)),
    totalRevenue: totalPeriodRevenue,
    revenueWithMargin: parseFloat(revenueWithMargin.toFixed(2)),
    totalMarginDollars: parseFloat(totalMarginDollars.toFixed(2)),
    skusWithMargin: skusWithValidMargin,
    skusWithSales,
    coveragePercent,
    confidence,
    reason
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
  // STEP 5: COMPUTE IMPACT BUCKETS (Quantified vs Unquantified)
  // ════════════════════════════════════════════════════════════════════════
  let quantifiedImpact = 0;
  let unquantifiedUnits = 0;
  let actionsWithCost = 0;
  let actionsWithoutCost = 0;

  for (const action of actions) {
    if (action.dollarImpact && action.dollarImpact > 0) {
      quantifiedImpact += action.dollarImpact;
      actionsWithCost++;
    } else {
      unquantifiedUnits += action.metrics?.quantity || 0;
      actionsWithoutCost++;
    }
  }

  // Also count unquantified from full decision set
  for (const d of allDecisions) {
    if (!d.hasFinancialData && d.metrics?.quantity) {
      unquantifiedUnits += d.metrics.quantity;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // STEP 6: GENERATE HEADLINE (Scoped Language)
  // ════════════════════════════════════════════════════════════════════════
  let headline;
  if (actions.length === 0) {
    headline = 'Signals detected but financial coverage incomplete';
  } else if (actions.length === 1) {
    headline = `${actions[0].name}: ${actions[0].impactLabel || actions[0].why}`;
  } else {
    // Build scoped headline with quantified and unquantified parts
    const parts = [];
    if (quantifiedImpact > 0) {
      parts.push(`$${quantifiedImpact.toLocaleString()} quantified impact`);
    }
    if (unquantifiedUnits > 0) {
      parts.push(`${unquantifiedUnits} units unpriced`);
    }
    if (parts.length > 0) {
      headline = `${actions.length} actions: ${parts.join(' + ')}`;
    } else {
      headline = `${actions.length} actions identified`;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // STEP 7: BUILD OUTPUT
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
      holdLine: allDecisions.filter(d => d.type === DECISION_TYPES.HOLD_LINE).length,
      total: inventoryFacts.size
    },
    // IMPACT BUCKETS (Recovery Mode)
    impactBuckets: {
      quantifiedImpact,
      unquantifiedUnits,
      actionsWithCost,
      actionsWithoutCost,
      coverageLabel: actionsWithCost === actions.length
        ? 'Full cost coverage'
        : `${actionsWithCost} of ${actions.length} actions have cost data`
    },
    // MARGIN DATA - from SALES_FACTS only
    marginData: marginResult,
    factLayerStats: {
      salesFacts: salesFacts.size,
      inventoryFacts: inventoryFacts.size,
      excluded: suppressedItems.length,
      validFacts: inventoryFacts.size
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
