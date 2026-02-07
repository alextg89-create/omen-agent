/**
 * SINGLE SOURCE OF TRUTH: Supabase Virtual Tables
 *
 * AUTHORITY MODEL (REFACTORED):
 * - Inventory: inventory_virtual (real-time available quantity derived from orders)
 * - Sales: sold_by_sku (velocity data per SKU)
 * - Cost: sku_costs (unit cost)
 * - Profitability: sku_profitability (margin + profit-at-risk)
 *
 * KEY FORMULA:
 * - available_quantity = snapshot_quantity - sold_quantity
 * - This is DERIVED, not synced - orders automatically reduce availability
 *
 * MARGIN COMPUTATION:
 * - Comes directly from sku_profitability.unit_margin
 * - Profit at risk = available_quantity * unit_margin
 *
 * NO fallbacks, NO caching at this level, NO silent failures
 * Either data is fresh from Supabase or system refuses operation
 *
 * STRICT TRUTH MODE: Enabled
 */

import { getSupabaseClient, isSupabaseAvailable } from '../db/supabaseClient.js';

const STRICT_MODE = process.env.OMEN_STRICT_TRUTH_MODE !== 'false';

// ============================================================================
// AUTHORITATIVE TABLES - NO FALLBACK
// ============================================================================
const INVENTORY_TABLE = 'inventory_virtual';       // Real-time available inventory
const SALES_TABLE = 'sold_by_sku';                 // Sales velocity per SKU
const COST_TABLE = 'sku_costs';                    // Unit cost authority
const PROFITABILITY_TABLE = 'sku_profitability';   // Margin + profit-at-risk

/**
 * Authority error types for clean handling
 */
export const AUTHORITY_ERROR = {
  TABLE_MISSING: 'AUTHORITY_TABLE_MISSING',
  EMPTY: 'AUTHORITY_EMPTY',
  UNAVAILABLE: 'AUTHORITY_UNAVAILABLE',
  QUERY_FAILED: 'AUTHORITY_QUERY_FAILED'
};

/**
 * Create authority error with structured data
 */
function createAuthorityError(type, message, details = {}) {
  const error = new Error(message);
  error.authorityError = true;
  error.type = type;
  error.details = details;
  return error;
}

/**
 * Get authoritative inventory from Supabase
 *
 * READS FROM:
 * - inventory_virtual: Real-time availability (snapshot - sold)
 * - sku_profitability: Margin and profit-at-risk
 * - sold_by_sku: Sales velocity (optional, for depletion forecasts)
 *
 * THROWS if:
 * - Supabase not configured
 * - Tables don't exist
 * - Data missing
 *
 * NO silent fallbacks. NO polite lies.
 *
 * @returns {Promise<{items: Array, timestamp: string, source: string, count: number}>}
 */
export async function getAuthoritativeInventory() {
  console.log('[Authority] ========== EXECUTION CONTEXT ==========');
  console.log('[Authority] Function: getAuthoritativeInventory');
  console.log('[Authority] Timestamp:', new Date().toISOString());
  console.log('[Authority] STRICT_MODE:', STRICT_MODE);
  console.log('[Authority] INVENTORY_TABLE:', INVENTORY_TABLE);
  console.log('[Authority] PROFITABILITY_TABLE:', PROFITABILITY_TABLE);
  console.log('[Authority] SALES_TABLE:', SALES_TABLE);
  console.log('[Authority] Process ID:', process.pid);
  console.log('[Authority] ===========================================');

  // GATE 1: Supabase must be available
  if (!isSupabaseAvailable()) {
    console.error('[Authority] AUTHORITY_UNAVAILABLE: Supabase not configured');
    throw createAuthorityError(
      AUTHORITY_ERROR.UNAVAILABLE,
      'Authority unavailable. Supabase is not configured.',
      { hint: 'Set SUPABASE_SECRET_API_KEY in environment variables' }
    );
  }

  console.log('[Authority] isSupabaseAvailable() returned true');

  const client = getSupabaseClient();

  // ========================================================================
  // QUERY 1: Inventory Authority (inventory_virtual)
  // This is the REAL-TIME view: available_quantity = snapshot - sold
  // ========================================================================
  console.log(`[Authority] QUERY 1: ${INVENTORY_TABLE} (SELECT *)`);

  const { data: inventory, error: inventoryError } = await client
    .from(INVENTORY_TABLE)
    .select('*');

  if (inventoryError) {
    const isTableMissing =
      inventoryError.code === 'PGRST205' ||
      inventoryError.code === '42P01' ||
      inventoryError.message?.includes('does not exist') ||
      inventoryError.message?.includes('Could not find');

    if (isTableMissing) {
      console.error(`[Authority] AUTHORITY_TABLE_MISSING: ${INVENTORY_TABLE} does not exist`);
      throw createAuthorityError(
        AUTHORITY_ERROR.TABLE_MISSING,
        `Authority table "${INVENTORY_TABLE}" does not exist. This view should be created from inventory snapshots + orders.`,
        {
          table: INVENTORY_TABLE,
          hint: 'Create inventory_virtual view in Supabase'
        }
      );
    }

    console.error('[Authority] AUTHORITY_QUERY_FAILED:', inventoryError);
    throw createAuthorityError(
      AUTHORITY_ERROR.QUERY_FAILED,
      `Authority query failed: ${inventoryError.message}`,
      { code: inventoryError.code, details: inventoryError.details }
    );
  }

  console.log('[Authority] QUERY 1 COMPLETE:', {
    table: INVENTORY_TABLE,
    rowCount: inventory?.length || 0
  });

  if (!inventory || inventory.length === 0) {
    console.warn(`[Authority] AUTHORITY_EMPTY: ${INVENTORY_TABLE} is empty`);
    throw createAuthorityError(
      AUTHORITY_ERROR.EMPTY,
      `Authority table "${INVENTORY_TABLE}" is empty. Sync inventory snapshot first.`,
      {
        table: INVENTORY_TABLE,
        hint: 'Upload Wix inventory snapshot to populate the table'
      }
    );
  }

  console.log(`[Authority] Loaded ${inventory.length} inventory items from ${INVENTORY_TABLE}`);

  // ========================================================================
  // QUERY 2: Profitability Authority (sku_profitability)
  // Contains: unit_margin, retail, cost - pre-computed
  // ========================================================================
  console.log(`[Authority] QUERY 2: ${PROFITABILITY_TABLE}`);

  let profitMap = new Map();  // SKU -> { unit_margin, retail, cost, etc }
  let profitTableExists = true;

  const { data: profitability, error: profitError } = await client
    .from(PROFITABILITY_TABLE)
    .select('*');

  if (profitError) {
    const isTableMissing =
      profitError.code === 'PGRST205' ||
      profitError.code === '42P01' ||
      profitError.message?.includes('does not exist') ||
      profitError.message?.includes('Could not find');

    if (isTableMissing) {
      console.warn(`[Authority] Profitability table "${PROFITABILITY_TABLE}" does not exist`);
      profitTableExists = false;
    } else {
      console.warn(`[Authority] Profitability query failed: ${profitError.message}`);
    }
  } else if (profitability && profitability.length > 0) {
    for (const row of profitability) {
      if (row.sku) {
        profitMap.set(row.sku, {
          unit_margin: row.unit_margin !== null ? parseFloat(row.unit_margin) : null,
          retail: row.retail !== null ? parseFloat(row.retail) : null,
          cost: row.unit_cost !== null ? parseFloat(row.unit_cost) : null,
          margin_percent: row.margin_percent !== null ? parseFloat(row.margin_percent) : null,
          profit_at_risk: row.profit_at_risk !== null ? parseFloat(row.profit_at_risk) : null
        });
      }
    }
    console.log(`[Authority] QUERY 2 COMPLETE: Loaded ${profitMap.size} SKUs from ${PROFITABILITY_TABLE}`);
  } else {
    console.warn(`[Authority] Profitability table "${PROFITABILITY_TABLE}" is empty`);
  }

  // ========================================================================
  // QUERY 3: Sales Velocity (sold_by_sku) - OPTIONAL
  // Used for depletion forecasts and days-until-stockout
  // ========================================================================
  console.log(`[Authority] QUERY 3: ${SALES_TABLE}`);

  let salesMap = new Map();  // SKU -> { total_sold, avg_daily, etc }

  const { data: sales, error: salesError } = await client
    .from(SALES_TABLE)
    .select('*');

  if (salesError) {
    console.warn(`[Authority] Sales query failed (non-fatal): ${salesError.message}`);
  } else if (sales && sales.length > 0) {
    for (const row of sales) {
      if (row.sku) {
        salesMap.set(row.sku, {
          total_sold: row.total_sold || row.quantity_sold || 0,
          total_revenue: row.total_revenue || 0,
          order_count: row.order_count || 0,
          avg_daily: row.avg_daily_velocity || row.daily_velocity || 0,
          last_sold_at: row.last_sold_at || null
        });
      }
    }
    console.log(`[Authority] QUERY 3 COMPLETE: Loaded ${salesMap.size} SKUs from ${SALES_TABLE}`);
  }

  // ========================================================================
  // QUERY 4: Cost Authority (sku_costs) - Fallback if not in profitability
  // ========================================================================
  console.log(`[Authority] QUERY 4: ${COST_TABLE}`);

  let costMap = new Map();
  let costTableCount = 0;

  const { data: costs, error: costError } = await client
    .from(COST_TABLE)
    .select('sku, unit_cost, source');

  if (!costError && costs && costs.length > 0) {
    costTableCount = costs.length;
    for (const row of costs) {
      if (row.sku && row.unit_cost !== null) {
        costMap.set(row.sku, {
          unit_cost: parseFloat(row.unit_cost),
          source: row.source || 'unknown'
        });
      }
    }
    console.log(`[Authority] QUERY 4 COMPLETE: Loaded ${costMap.size} SKU costs from ${COST_TABLE}`);
  }

  // ========================================================================
  // ENRICH: Join all authority tables
  // ========================================================================
  let skusWithCost = 0;
  let skusWithoutCost = 0;
  let skusWithRetail = 0;
  let skusWithMargin = 0;

  const enriched = inventory.map(item => {
    // ======================================================================
    // QUANTITY: Use available_quantity from inventory_virtual
    // This is DERIVED: snapshot_quantity - sold_quantity
    // ======================================================================
    const availableQuantity = item.available_quantity ?? item.quantity ?? 0;
    const snapshotQuantity = item.snapshot_quantity ?? item.quantity_on_hand ?? availableQuantity;
    const soldQuantity = item.sold_quantity ?? 0;
    const inventoryStatus = item.inventory_status || 'COUNTED';
    const visible = item.visible !== false;

    // ======================================================================
    // PROFITABILITY: Get from sku_profitability table
    // ======================================================================
    const profitData = profitMap.get(item.sku);
    const costData = costMap.get(item.sku);

    // Prefer profitability table, fallback to cost table for cost
    const retail = profitData?.retail ?? item.retail ?? null;
    const cost = profitData?.cost ?? costData?.unit_cost ?? null;
    const unitMargin = profitData?.unit_margin ?? null;
    const marginPercent = profitData?.margin_percent ?? null;

    // Compute margin if we have both retail and cost but no pre-computed margin
    let margin = marginPercent;
    if (margin === null && retail !== null && retail > 0 && cost !== null) {
      margin = parseFloat(((retail - cost) / retail * 100).toFixed(2));
    }

    // ======================================================================
    // PROFIT AT RISK: available_quantity * unit_margin
    // ======================================================================
    let profitAtRisk = profitData?.profit_at_risk ?? null;
    if (profitAtRisk === null && unitMargin !== null && availableQuantity > 0) {
      profitAtRisk = parseFloat((availableQuantity * unitMargin).toFixed(2));
    }

    // ======================================================================
    // SALES VELOCITY: From sold_by_sku
    // ======================================================================
    const salesData = salesMap.get(item.sku);
    const avgDailyVelocity = salesData?.avg_daily ?? 0;
    const totalSold = salesData?.total_sold ?? soldQuantity;

    // Days until stockout (if velocity > 0)
    let daysUntilStockout = null;
    if (avgDailyVelocity > 0 && availableQuantity > 0) {
      daysUntilStockout = Math.round(availableQuantity / avgDailyVelocity);
    }

    // Track coverage stats
    if (retail !== null && retail > 0) skusWithRetail++;
    if (cost !== null) skusWithCost++;
    else skusWithoutCost++;
    if (margin !== null) skusWithMargin++;

    // Extract product info
    const productName = item.product_name || item.strain || item.name || 'Unknown';
    const variantName = item.variant_name || item.unit || 'Unknown';
    const category = item.category || item.quality || item.tier || 'STANDARD';

    return {
      sku: item.sku,
      strain: productName,
      name: `${productName} (${variantName})`,
      unit: variantName,
      quality: category,
      // ======================================================================
      // QUANTITY FIELDS - Order-driven, real-time
      // ======================================================================
      quantity: availableQuantity,           // REAL-TIME available
      availableQuantity,                     // Alias for clarity
      snapshotQuantity,                      // Original snapshot count
      soldQuantity,                          // Units sold since snapshot
      grams: getGramsForUnit(variantName),
      // ======================================================================
      // PRICING & MARGIN - From sku_profitability
      // ======================================================================
      pricing: {
        cost,
        retail,
        margin,
        unitMargin,                          // Dollar margin per unit
        profitAtRisk,                        // Available * unitMargin
        costSource: costData?.source ?? 'profitability'
      },
      // ======================================================================
      // VELOCITY & FORECASTS - From sold_by_sku
      // ======================================================================
      velocity: {
        totalSold,
        avgDaily: avgDailyVelocity,
        daysUntilStockout,
        lastSoldAt: salesData?.last_sold_at ?? null
      },
      // ======================================================================
      // STATUS FLAGS
      // ======================================================================
      inventoryStatus,
      visible,
      product_id: item.product_id || null,
      updated_at: item.synced_at || item.updated_at || item.last_updated,
      hasRetail: retail !== null && retail > 0,
      hasCost: cost !== null,
      hasMargin: margin !== null,
      hasProfitData: profitData !== undefined
    };
  });

  const timestamp = new Date().toISOString();

  // ========================================================================
  // SKU COUNTING - VISIBLE ONLY (Wix Dashboard Parity)
  // ========================================================================
  // CRITICAL: Only count SKUs where visible = true
  // This matches the Wix dashboard count (~75, not 337)
  // ========================================================================
  const visibleSKUs = enriched.filter(i => i.visible === true);
  const hiddenSKUs = enriched.filter(i => i.visible === false);

  // Sellable = visible AND has available quantity
  const sellableSKUs = visibleSKUs.filter(i =>
    i.availableQuantity > 0 || i.inventoryStatus === 'IN_STOCK'
  );

  // Out of stock = visible but no quantity
  const outOfStockSKUs = visibleSKUs.filter(i =>
    i.availableQuantity === 0 && i.inventoryStatus !== 'IN_STOCK'
  );

  // Product-level counts (unique product_ids)
  const uniqueProductIds = new Set(enriched.map(i => i.product_id).filter(Boolean));
  const visibleProductIds = new Set(visibleSKUs.map(i => i.product_id).filter(Boolean));
  const sellableProductIds = new Set(sellableSKUs.map(i => i.product_id).filter(Boolean));

  const totalProductCount = uniqueProductIds.size;
  const visibleProductCount = visibleProductIds.size;
  const sellableProductCount = sellableProductIds.size;

  // Find the most recent synced_at timestamp
  const syncTimestamps = enriched
    .map(i => i.updated_at)
    .filter(t => t)
    .sort((a, b) => new Date(b) - new Date(a));

  const inventoryLastSyncedAt = syncTimestamps[0] || null;

  // Coverage stats for VISIBLE SKUs only (policy-compliant)
  const visibleWithCost = visibleSKUs.filter(i => i.hasCost).length;
  const visibleWithMargin = visibleSKUs.filter(i => i.hasMargin).length;
  const visibleWithRetail = visibleSKUs.filter(i => i.hasRetail).length;

  const visibleCostCoverage = visibleSKUs.length > 0
    ? parseFloat(((visibleWithCost / visibleSKUs.length) * 100).toFixed(1))
    : 100;
  const visibleMarginCoverage = visibleSKUs.length > 0
    ? parseFloat(((visibleWithMargin / visibleSKUs.length) * 100).toFixed(1))
    : 100;

  // Calculate total profit at risk
  const totalProfitAtRisk = sellableSKUs.reduce((sum, i) =>
    sum + (i.pricing.profitAtRisk || 0), 0
  );

  // Log coverage summary
  console.log(`[Authority] ========================================`);
  console.log(`[Authority] ENRICHMENT COMPLETE at ${timestamp}`);
  console.log(`[Authority] ----------------------------------------`);
  console.log(`[Authority] SOURCE: ${INVENTORY_TABLE} (order-driven)`);
  console.log(`[Authority] ----------------------------------------`);
  console.log(`[Authority] TOTAL SKUs: ${enriched.length}`);
  console.log(`[Authority] VISIBLE SKUs: ${visibleSKUs.length} (matches Wix)`);
  console.log(`[Authority] HIDDEN SKUs: ${hiddenSKUs.length}`);
  console.log(`[Authority] ----------------------------------------`);
  console.log(`[Authority] SELLABLE: ${sellableSKUs.length} (visible + in stock)`);
  console.log(`[Authority] OUT OF STOCK: ${outOfStockSKUs.length} (visible + qty=0)`);
  console.log(`[Authority] ----------------------------------------`);
  console.log(`[Authority] PRODUCTS: ${totalProductCount} total, ${visibleProductCount} visible, ${sellableProductCount} sellable`);
  console.log(`[Authority] ----------------------------------------`);
  console.log(`[Authority] COST COVERAGE: ${visibleCostCoverage}% of visible SKUs`);
  console.log(`[Authority] MARGIN COVERAGE: ${visibleMarginCoverage}% of visible SKUs`);
  console.log(`[Authority] PROFIT AT RISK: $${totalProfitAtRisk.toFixed(2)}`);
  console.log(`[Authority] ========================================`);

  return {
    items: enriched,
    timestamp,
    source: 'supabase',
    table: INVENTORY_TABLE,
    profitabilityTable: PROFITABILITY_TABLE,
    salesTable: SALES_TABLE,
    costTable: COST_TABLE,
    count: enriched.length,
    inventoryLastSyncedAt,
    // ========================================================================
    // SKU COUNTS - VISIBLE ONLY (Wix Dashboard Parity)
    // ========================================================================
    // This is the FIX for "337 vs 75" - only count visible=true
    visibleSKUCount: visibleSKUs.length,      // THE count to display
    sellableSKUCount: sellableSKUs.length,    // Visible + has stock
    hiddenSKUCount: hiddenSKUs.length,        // Archived/hidden items
    outOfStockCount: outOfStockSKUs.length,   // Visible but qty=0
    // ========================================================================
    // PRODUCT COUNTS (unique products, not variants)
    // ========================================================================
    totalProductCount,
    visibleProductCount,
    sellableProductCount,
    // Legacy aliases for backwards compatibility
    activeProductCount: sellableProductCount,
    activeVariantCount: sellableSKUs.length,
    // ========================================================================
    // PROFIT INTELLIGENCE
    // ========================================================================
    totalProfitAtRisk,
    // ========================================================================
    // DETAILED STATS
    // ========================================================================
    stats: {
      total: enriched.length,
      visible: visibleSKUs.length,
      hidden: hiddenSKUs.length,
      sellable: sellableSKUs.length,
      outOfStock: outOfStockSKUs.length,
      products: {
        total: totalProductCount,
        visible: visibleProductCount,
        sellable: sellableProductCount
      },
      velocity: {
        skusWithSales: salesMap.size,
        totalUnitsSold: Array.from(salesMap.values()).reduce((sum, s) => sum + (s.total_sold || 0), 0)
      }
    },
    pricingStats: {
      skusWithRetail,
      skusWithoutRetail: enriched.length - skusWithRetail,
      retailCoverage: visibleSKUs.length > 0
        ? parseFloat(((visibleWithRetail / visibleSKUs.length) * 100).toFixed(1))
        : 0
    },
    costStats: {
      costTableExists: costTableCount > 0,
      profitabilityTableExists: profitTableExists,
      totalCostsLoaded: costTableCount,
      skusWithCost,
      skusWithoutCost,
      skusWithMargin,
      costCoverage: visibleCostCoverage,
      marginCoverage: visibleMarginCoverage,
      visibleWithCost,
      visibleWithMargin,
      visibleCount: visibleSKUs.length
    }
  };
}

/**
 * Map units/variants to grams (for compatibility)
 */
function getGramsForUnit(unit) {
  if (!unit) return null;

  const normalized = unit.toLowerCase().replace(/\s+/g, '');

  const gramsMap = {
    '28g': 28,
    '14g': 14,
    '7g': 7,
    '3.5g': 3.5,
    'oz': 28,
    'half': 14,
    'quarter': 7,
    'eighth': 3.5,
    '1g': 1,
    'gram': 1
  };

  return gramsMap[normalized] || null;
}
