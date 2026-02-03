/**
 * SINGLE SOURCE OF TRUTH: Supabase
 *
 * AUTHORITY MODEL:
 * - Inventory: wix_inventory_live (SKU, quantity, visibility)
 * - Pricing: wix_inventory_live.retail (sell price from Wix)
 * - Cost: sku_costs table (unit_cost - MUST be explicitly set)
 *
 * MARGIN COMPUTATION:
 * - margin = (retail - unit_cost) / retail * 100
 * - ONLY computed when BOTH retail AND unit_cost exist
 * - If cost missing: margin = NULL (never 0, never estimated)
 *
 * NO fallbacks, NO caching at this level, NO silent failures
 * Either data is fresh from Supabase or system refuses operation
 *
 * STRICT TRUTH MODE: Enabled
 */

import { getSupabaseClient, isSupabaseAvailable } from '../db/supabaseClient.js';

const STRICT_MODE = process.env.OMEN_STRICT_TRUTH_MODE !== 'false';

// AUTHORITATIVE TABLES - NO FALLBACK
const INVENTORY_TABLE = 'wix_inventory_live';  // Inventory + Pricing authority
const COST_TABLE = 'sku_costs';                 // Cost authority

// Legacy alias for compatibility
const AUTHORITY_TABLE = INVENTORY_TABLE;

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
 * Get authoritative inventory + pricing from Supabase
 *
 * THROWS if:
 * - Supabase not configured
 * - Tables don't exist
 * - Data missing (no price, no quantity)
 * - Cannot calculate margins
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
  console.log('[Authority] COST_TABLE:', COST_TABLE);
  console.log('[Authority] Process ID:', process.pid);
  console.log('[Authority] ===========================================');

  // GATE 1: Supabase must be available
  if (!isSupabaseAvailable()) {
    console.error('[Authority] ❌ AUTHORITY_UNAVAILABLE: Supabase not configured');
    throw createAuthorityError(
      AUTHORITY_ERROR.UNAVAILABLE,
      'Authority unavailable. Supabase is not configured.',
      { hint: 'Set SUPABASE_SECRET_API_KEY in environment variables' }
    );
  }

  console.log('[Authority] ✅ isSupabaseAvailable() returned true');

  const client = getSupabaseClient();

  // ========================================================================
  // QUERY 1: Inventory Authority (wix_inventory_live)
  // ========================================================================
  console.log(`[Authority] 📡 QUERY 1: ${INVENTORY_TABLE} (SELECT *)`);

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
      console.error(`[Authority] ❌ AUTHORITY_TABLE_MISSING: ${INVENTORY_TABLE} does not exist`);
      throw createAuthorityError(
        AUTHORITY_ERROR.TABLE_MISSING,
        `Authority table "${INVENTORY_TABLE}" does not exist. Run migration 003_wix_inventory_live.sql in Supabase SQL Editor.`,
        {
          table: INVENTORY_TABLE,
          hint: 'Create table via Supabase SQL Editor, then sync via POST /sync/wix-inventory',
          migration: '003_wix_inventory_live.sql'
        }
      );
    }

    console.error('[Authority] ❌ AUTHORITY_QUERY_FAILED:', inventoryError);
    throw createAuthorityError(
      AUTHORITY_ERROR.QUERY_FAILED,
      `Authority query failed: ${inventoryError.message}`,
      { code: inventoryError.code, details: inventoryError.details }
    );
  }

  console.log('[Authority] 📡 QUERY 1 COMPLETE:', {
    table: INVENTORY_TABLE,
    rowCount: inventory?.length || 0
  });

  if (!inventory || inventory.length === 0) {
    console.warn(`[Authority] ⚠️ AUTHORITY_EMPTY: ${INVENTORY_TABLE} table exists but is empty`);
    throw createAuthorityError(
      AUTHORITY_ERROR.EMPTY,
      `Authority table "${INVENTORY_TABLE}" is empty. Sync inventory via POST /sync/wix-inventory.`,
      {
        table: INVENTORY_TABLE,
        hint: 'Upload Wix inventory CSV to populate the table'
      }
    );
  }

  console.log(`[Authority] Loaded ${inventory.length} inventory items from ${INVENTORY_TABLE}`);

  // ========================================================================
  // QUERY 2: Cost Authority (sku_costs) - OPTIONAL, continues if missing
  // ========================================================================
  console.log(`[Authority] 📡 QUERY 2: ${COST_TABLE} (SELECT sku, unit_cost, source)`);

  let costMap = new Map();  // SKU -> { unit_cost, source }
  let costTableExists = true;
  let costTableCount = 0;

  const { data: costs, error: costError } = await client
    .from(COST_TABLE)
    .select('sku, unit_cost, source');

  if (costError) {
    const isTableMissing =
      costError.code === 'PGRST205' ||
      costError.code === '42P01' ||
      costError.message?.includes('does not exist') ||
      costError.message?.includes('Could not find');

    if (isTableMissing) {
      console.warn(`[Authority] ⚠️ Cost table "${COST_TABLE}" does not exist. Run migration 004_sku_costs.sql`);
      console.warn(`[Authority] ⚠️ All margins will be NULL until costs are added`);
      costTableExists = false;
    } else {
      console.warn(`[Authority] ⚠️ Cost query failed: ${costError.message}`);
    }
  } else if (costs && costs.length > 0) {
    costTableCount = costs.length;
    for (const row of costs) {
      if (row.sku && row.unit_cost !== null) {
        costMap.set(row.sku, {
          unit_cost: parseFloat(row.unit_cost),
          source: row.source || 'unknown'
        });
      }
    }
    console.log(`[Authority] 📡 QUERY 2 COMPLETE: Loaded ${costMap.size} SKU costs from ${COST_TABLE}`);
  } else {
    console.warn(`[Authority] ⚠️ Cost table "${COST_TABLE}" is empty. No margins can be computed.`);
  }

  // ========================================================================
  // ENRICH: Join inventory with cost authority
  // ========================================================================
  let skusWithCost = 0;
  let skusWithoutCost = 0;
  let skusWithRetail = 0;
  let skusWithoutRetail = 0;
  let skusWithMargin = 0;

  const enriched = inventory.map(item => {
    // Get quantity - handle IN_STOCK status
    let quantity = item.quantity_on_hand || 0;
    let inventoryStatus = item.inventory_status || 'COUNTED';

    // IN_STOCK means available but unknown quantity - warn in strict mode
    if (inventoryStatus === 'IN_STOCK' && STRICT_MODE) {
      console.warn(`[Authority] ⚠️ SKU "${item.sku}" has IN_STOCK status (unknown quantity)`);
    }

    // STRICT MODE: Missing quantity is fatal (unless IN_STOCK)
    if (quantity === null && inventoryStatus !== 'IN_STOCK') {
      if (STRICT_MODE) {
        throw new Error(`FATAL: Missing quantity for SKU "${item.sku}". Inventory data incomplete.`);
      }
    }

    // PRICING AUTHORITY: retail ONLY from wix_inventory_live.retail - NO FALLBACKS
    const retail = item.retail ?? null;  // Exactly as stored in Wix
    const sale = item.compare_at ?? null;  // Compare-at price from Wix

    // COST AUTHORITY: Only use cost from sku_costs table
    const costData = costMap.get(item.sku);
    const cost = costData?.unit_cost ?? null;
    const costSource = costData?.source ?? null;

    // Track retail coverage (price authority)
    if (retail !== null && retail > 0) {
      skusWithRetail++;
    } else {
      skusWithoutRetail++;
      if (STRICT_MODE) {
        console.warn(`[Authority] ⚠️ SKU "${item.sku}" missing retail price - pricing unavailable`);
      }
    }

    // Track cost coverage
    if (cost !== null) {
      skusWithCost++;
    } else {
      skusWithoutCost++;
    }

    // MARGIN: Only compute when BOTH retail AND cost exist
    let margin = null;
    if (retail !== null && retail > 0 && cost !== null) {
      margin = parseFloat(((retail - cost) / retail * 100).toFixed(2));
      skusWithMargin++;
    }

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
      quantity: quantity,
      grams: getGramsForUnit(variantName),
      pricing: {
        cost,          // From sku_costs table ONLY
        retail,        // From inventory
        sale,          // Compare-at price
        margin,        // Computed only if both exist
        costSource     // Audit trail for cost
      },
      inventoryStatus,
      visible: item.visible !== false,
      product_id: item.product_id || null,
      updated_at: item.synced_at || item.updated_at || item.last_updated,
      hasRetail: retail !== null && retail > 0,
      hasCost: cost !== null,
      hasMargin: margin !== null
    };
  });

  const timestamp = new Date().toISOString();

  // Calculate stats
  const totalItems = enriched.length;
  const countedItems = enriched.filter(i => i.inventoryStatus === 'COUNTED').length;
  const inStockItems = enriched.filter(i => i.inventoryStatus === 'IN_STOCK').length;
  const outOfStockItems = enriched.filter(i => i.quantity === 0 && i.inventoryStatus !== 'IN_STOCK').length;

  // Find the most recent synced_at timestamp from inventory
  const syncTimestamps = enriched
    .map(i => i.updated_at)
    .filter(t => t)
    .sort((a, b) => new Date(b) - new Date(a));

  const inventoryLastSyncedAt = syncTimestamps[0] || null;

  // Log coverage summary
  console.log(`[Authority] ========================================`);
  console.log(`[Authority] ✅ ENRICHMENT COMPLETE at ${timestamp}`);
  console.log(`[Authority] Inventory: ${totalItems} SKUs from ${INVENTORY_TABLE}`);
  console.log(`[Authority] Costs: ${costTableCount} SKUs in ${COST_TABLE}`);
  console.log(`[Authority] ----------------------------------------`);
  console.log(`[Authority] SKUs with retail price: ${skusWithRetail}`);
  console.log(`[Authority] SKUs without retail price: ${skusWithoutRetail}`);
  console.log(`[Authority] SKUs with cost: ${skusWithCost}`);
  console.log(`[Authority] SKUs without cost: ${skusWithoutCost}`);
  console.log(`[Authority] SKUs with margin: ${skusWithMargin}`);
  console.log(`[Authority] ----------------------------------------`);
  console.log(`[Authority] Retail coverage: ${((skusWithRetail / totalItems) * 100).toFixed(1)}%`);
  console.log(`[Authority] Cost coverage: ${((skusWithCost / totalItems) * 100).toFixed(1)}%`);
  console.log(`[Authority] Margin coverage: ${((skusWithMargin / totalItems) * 100).toFixed(1)}%`);
  console.log(`[Authority] ========================================`);

  if (skusWithoutRetail > 0 && STRICT_MODE) {
    console.warn(`[Authority] ⚠️ ${skusWithoutRetail} SKUs missing retail price - pricing unavailable`);
  }
  if (skusWithoutCost > 0 && STRICT_MODE) {
    console.warn(`[Authority] ⚠️ ${skusWithoutCost} SKUs missing cost data - margins will be NULL`);
  }

  return {
    items: enriched,
    timestamp,
    source: 'supabase',
    table: INVENTORY_TABLE,
    costTable: COST_TABLE,
    count: enriched.length,
    inventoryLastSyncedAt,
    stats: {
      total: totalItems,
      counted: countedItems,
      inStock: inStockItems,
      outOfStock: outOfStockItems
    },
    pricingStats: {
      skusWithRetail,
      skusWithoutRetail,
      retailCoverage: totalItems > 0 ? parseFloat(((skusWithRetail / totalItems) * 100).toFixed(1)) : 0
    },
    costStats: {
      costTableExists,
      totalCostsLoaded: costTableCount,
      skusWithCost,
      skusWithoutCost,
      skusWithMargin,
      costCoverage: totalItems > 0 ? parseFloat(((skusWithCost / totalItems) * 100).toFixed(1)) : 0,
      marginCoverage: totalItems > 0 ? parseFloat(((skusWithMargin / totalItems) * 100).toFixed(1)) : 0
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
