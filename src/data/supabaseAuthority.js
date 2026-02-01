/**
 * SINGLE SOURCE OF TRUTH: Supabase → wix_inventory_live
 *
 * NO fallbacks, NO caching at this level, NO silent failures
 * Either data is fresh from Supabase or system refuses operation
 *
 * DATA SOURCE: wix_inventory_live table
 * POPULATED BY: POST /sync/wix-inventory endpoint (Make.com → Wix CSV)
 *
 * AUTHORITY ERRORS:
 * - Table does not exist → AUTHORITY_TABLE_MISSING
 * - Table empty → AUTHORITY_EMPTY
 * - Supabase unavailable → AUTHORITY_UNAVAILABLE
 *
 * STRICT TRUTH MODE: Enabled
 */

import { getSupabaseClient, isSupabaseAvailable } from '../db/supabaseClient.js';

const STRICT_MODE = process.env.OMEN_STRICT_TRUTH_MODE !== 'false';

// AUTHORITATIVE TABLE - NO FALLBACK
const AUTHORITY_TABLE = 'wix_inventory_live';

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
  console.log('[Authority] AUTHORITY_TABLE:', AUTHORITY_TABLE);
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

  console.log(`[Authority] 📡 QUERY: ${AUTHORITY_TABLE} (SELECT *)`);

  const { data: inventory, error: queryError } = await client
    .from(AUTHORITY_TABLE)
    .select('*');

  // GATE 2: Table must exist (NO FALLBACK)
  if (queryError) {
    const isTableMissing =
      queryError.code === 'PGRST205' ||
      queryError.code === '42P01' ||
      queryError.message?.includes('does not exist') ||
      queryError.message?.includes('Could not find');

    if (isTableMissing) {
      console.error(`[Authority] ❌ AUTHORITY_TABLE_MISSING: ${AUTHORITY_TABLE} does not exist`);
      throw createAuthorityError(
        AUTHORITY_ERROR.TABLE_MISSING,
        `Authority table "${AUTHORITY_TABLE}" does not exist. Run migration 003_wix_inventory_live.sql in Supabase SQL Editor.`,
        {
          table: AUTHORITY_TABLE,
          hint: 'Create table via Supabase SQL Editor, then sync via POST /sync/wix-inventory',
          migration: '003_wix_inventory_live.sql'
        }
      );
    }

    // Other query errors
    console.error('[Authority] ❌ AUTHORITY_QUERY_FAILED:', queryError);
    throw createAuthorityError(
      AUTHORITY_ERROR.QUERY_FAILED,
      `Authority query failed: ${queryError.message}`,
      { code: queryError.code, details: queryError.details }
    );
  }

  console.log('[Authority] 📡 QUERY COMPLETE:', {
    table: AUTHORITY_TABLE,
    rowCount: inventory?.length || 0
  });

  // GATE 3: Table must have data
  if (!inventory || inventory.length === 0) {
    console.warn(`[Authority] ⚠️ AUTHORITY_EMPTY: ${AUTHORITY_TABLE} table exists but is empty`);
    throw createAuthorityError(
      AUTHORITY_ERROR.EMPTY,
      `Authority table "${AUTHORITY_TABLE}" is empty. Sync inventory via POST /sync/wix-inventory.`,
      {
        table: AUTHORITY_TABLE,
        hint: 'Upload Wix inventory CSV to populate the table'
      }
    );
  }

  console.log(`[Authority] Loaded ${inventory.length} inventory items from ${AUTHORITY_TABLE}`);

  // Enrich items from wix_inventory_live schema
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

    // Extract pricing - handle both table schemas
    const cost = item.cost || item.wholesale_cost || item.product_cost || null;
    const retail = item.retail || item.price || item.retail_price || null;
    const sale = item.sale || item.sale_price || item.compare_at || null;

    // Calculate margin
    const margin = (cost && retail)
      ? ((retail - cost) / retail * 100).toFixed(2)
      : null;

    // STRICT MODE: Cannot calculate margin is warning (not fatal)
    if (!margin && STRICT_MODE && retail) {
      console.warn(`[Authority] ⚠️ Cannot calculate margin for SKU "${item.sku}" - missing cost`);
    }

    // Extract product info - handle both schemas
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
        cost,
        retail,
        sale,
        margin: margin ? parseFloat(margin) : null
      },
      inventoryStatus,
      visible: item.visible !== false,
      product_id: item.product_id || null,
      updated_at: item.synced_at || item.updated_at || item.last_updated,
      pricingMatch: !!(cost && retail)
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

  console.log(`[Authority] ✅ Enriched ${enriched.length} items from ${AUTHORITY_TABLE} at ${timestamp}`);
  console.log(`[Authority] Stats: ${countedItems} counted, ${inStockItems} IN_STOCK, ${outOfStockItems} out of stock`);
  console.log(`[Authority] Inventory last synced: ${inventoryLastSyncedAt || 'UNKNOWN'}`);
  console.log(`[Authority] STRICT_MODE: ${STRICT_MODE ? 'ENABLED' : 'DISABLED'}`);

  return {
    items: enriched,
    timestamp,
    source: 'supabase',
    table: AUTHORITY_TABLE,
    count: enriched.length,
    inventoryLastSyncedAt,
    stats: {
      total: totalItems,
      counted: countedItems,
      inStock: inStockItems,
      outOfStock: outOfStockItems
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
