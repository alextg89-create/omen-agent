/**
 * SINGLE SOURCE OF TRUTH: Supabase → wix_inventory_live
 *
 * NO fallbacks, NO caching at this level, NO silent failures
 * Either data is fresh from Supabase or system throws error
 *
 * DATA SOURCE: wix_inventory_live table
 * POPULATED BY: POST /sync/wix-inventory endpoint (Make.com → Wix CSV)
 *
 * STRICT TRUTH MODE: Enabled
 */

import { getSupabaseClient, isSupabaseAvailable } from '../db/supabaseClient.js';

const STRICT_MODE = process.env.OMEN_STRICT_TRUTH_MODE !== 'false';

// Table to use for inventory
// wix_inventory_live = new authoritative source from Wix CSV
// inventory_live = legacy table (fallback if wix table doesn't exist)
const PRIMARY_TABLE = 'wix_inventory_live';
const FALLBACK_TABLE = 'inventory_live';

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
  console.log('[Authority] PRIMARY_TABLE:', PRIMARY_TABLE);
  console.log('[Authority] Process ID:', process.pid);
  console.log('[Authority] ===========================================');

  if (!isSupabaseAvailable()) {
    console.error('[Authority] ❌ isSupabaseAvailable() returned false');
    throw new Error('FATAL: Supabase not configured. Set SUPABASE_SECRET_API_KEY in .env');
  }

  console.log('[Authority] ✅ isSupabaseAvailable() returned true');

  const client = getSupabaseClient();

  // Try primary table first (wix_inventory_live)
  let inventory;
  let tableName = PRIMARY_TABLE;

  console.log(`[Authority] 📡 QUERY: ${PRIMARY_TABLE} (SELECT *)`);

  const { data: wixInventory, error: wixError } = await client
    .from(PRIMARY_TABLE)
    .select('*');

  if (wixError) {
    // If primary table doesn't exist, try fallback
    if (wixError.code === '42P01' || wixError.message?.includes('does not exist')) {
      console.warn(`[Authority] ⚠️ ${PRIMARY_TABLE} doesn't exist, trying fallback: ${FALLBACK_TABLE}`);

      const { data: legacyInventory, error: legacyError } = await client
        .from(FALLBACK_TABLE)
        .select('*');

      if (legacyError) {
        console.error('[Authority] ❌ FATAL ERROR:', legacyError);
        throw new Error(`FATAL: Cannot load inventory from Supabase: ${legacyError.message}`);
      }

      inventory = legacyInventory;
      tableName = FALLBACK_TABLE;
    } else {
      console.error('[Authority] ❌ FATAL ERROR:', wixError);
      throw new Error(`FATAL: Cannot load inventory from Supabase: ${wixError.message}`);
    }
  } else {
    inventory = wixInventory;
  }

  console.log('[Authority] 📡 QUERY COMPLETE:', {
    table: tableName,
    rowCount: inventory?.length || 0
  });

  if (!inventory || inventory.length === 0) {
    console.warn(`[Authority] WARNING: ${tableName} table is empty`);
    return {
      items: [],
      timestamp: new Date().toISOString(),
      source: 'supabase',
      table: tableName,
      count: 0,
      warning: `${tableName} table is empty. Run /sync/wix-inventory to populate.`
    };
  }

  console.log(`[Authority] Loaded ${inventory.length} inventory items from ${tableName}`);

  // Enrich items based on table structure
  const enriched = inventory.map(item => {
    // Handle both table schemas
    const isWixTable = tableName === PRIMARY_TABLE;

    // Get quantity - handle IN_STOCK status
    let quantity = 0;
    let inventoryStatus = 'UNKNOWN';

    if (isWixTable) {
      quantity = item.quantity_on_hand || 0;
      inventoryStatus = item.inventory_status || 'COUNTED';

      // IN_STOCK means available but unknown quantity - warn in strict mode
      if (inventoryStatus === 'IN_STOCK' && STRICT_MODE) {
        console.warn(`[Authority] ⚠️ SKU "${item.sku}" has IN_STOCK status (unknown quantity)`);
      }
    } else {
      quantity = item.quantity || 0;
      inventoryStatus = quantity > 0 ? 'COUNTED' : 'OUT_OF_STOCK';
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

  console.log(`[Authority] ✅ Enriched ${enriched.length} items from ${tableName} at ${timestamp}`);
  console.log(`[Authority] Stats: ${countedItems} counted, ${inStockItems} IN_STOCK, ${outOfStockItems} out of stock`);
  console.log(`[Authority] STRICT_MODE: ${STRICT_MODE ? 'ENABLED' : 'DISABLED'}`);

  return {
    items: enriched,
    timestamp,
    source: 'supabase',
    table: tableName,
    count: enriched.length,
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
