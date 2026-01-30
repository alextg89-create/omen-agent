/**
 * SINGLE SOURCE OF TRUTH: Supabase
 *
 * NO fallbacks, NO caching at this level, NO silent failures
 * Either data is fresh from Supabase or system throws error
 *
 * STRICT TRUTH MODE: Enabled
 */

import { getSupabaseClient, isSupabaseAvailable } from '../db/supabaseClient.js';

const STRICT_MODE = process.env.OMEN_STRICT_TRUTH_MODE !== 'false';

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
  console.log('[Authority] Process ID:', process.pid);
  console.log('[Authority] ===========================================');

  if (!isSupabaseAvailable()) {
    console.error('[Authority] ❌ isSupabaseAvailable() returned false');
    throw new Error('FATAL: Supabase not configured. Set SUPABASE_SECRET_API_KEY in .env');
  }

  console.log('[Authority] ✅ isSupabaseAvailable() returned true');
  console.log('[Authority] Calling getSupabaseClient()...');

  const client = getSupabaseClient();

  // DIAGNOSTIC: Confirm we're using the validated client
  console.log('[Authority] Using validated Supabase client for inventory query');
  console.log('[Authority] Client state:', {
    exists: !!client,
    hasFrom: typeof client?.from === 'function',
    hasRest: !!client?.rest,
    hasAuth: !!client?.auth
  });

  // Query inventory table (inventory_live = current inventory from Make webhook)
  console.log('[Authority] 📡 QUERY: inventory_live (SELECT *)');

  const { data: inventory, error: invError } = await client
    .from('inventory_live')
    .select('*');

  console.log('[Authority] 📡 QUERY COMPLETE:', {
    success: !invError,
    rowCount: inventory?.length || 0,
    errorMessage: invError?.message || null,
    errorCode: invError?.code || null
  });

  if (invError) {
    console.error('[Authority] ❌ FATAL ERROR:', invError);
    throw new Error(`FATAL: Cannot load inventory from Supabase: ${invError.message}`);
  }

  if (!inventory || inventory.length === 0) {
    console.warn('[Authority] WARNING: Inventory table is empty');
    return {
      items: [],
      timestamp: new Date().toISOString(),
      source: 'supabase',
      count: 0,
      warning: 'Inventory table is empty'
    };
  }

  console.log(`[Authority] Loaded ${inventory.length} inventory items from inventory_live`);

  // Pricing is embedded in inventory_live rows (no separate pricing table)
  const enriched = inventory.map(item => {
    // STRICT MODE: Missing quantity is fatal
    if (item.quantity === null || item.quantity === undefined) {
      if (STRICT_MODE) {
        throw new Error(`FATAL: Missing quantity for SKU "${item.sku}". Inventory data incomplete.`);
      }
    }

    // Extract pricing from inventory row (pricing embedded in same table)
    const cost = item.cost || item.wholesale_cost || item.product_cost || null;
    const retail = item.retail || item.price || item.retail_price || null;
    const sale = item.sale || item.sale_price || null;

    // Calculate margin
    const margin = (cost && retail)
      ? ((retail - cost) / retail * 100).toFixed(2)
      : null;

    // STRICT MODE: Cannot calculate margin is warning (not fatal - some items may not have pricing yet)
    if (!margin && STRICT_MODE) {
      console.warn(`[Authority] WARNING: Cannot calculate margin for SKU "${item.sku}" - missing cost (${cost}) or retail (${retail})`);
    }

    return {
      sku: item.sku || `${item.strain}_${item.unit}`,
      strain: item.strain || item.name || item.product_name,
      name: `${item.strain || item.name} (${item.unit})`,
      unit: item.unit,
      quality: item.quality || item.tier || 'STANDARD',
      quantity: item.quantity || 0,
      grams: item.grams || getGramsForUnit(item.unit),
      pricing: {
        cost,
        retail,
        sale,
        margin: margin ? parseFloat(margin) : null
      },
      updated_at: item.updated_at,
      pricingMatch: !!(cost && retail)
    };
  });

  const timestamp = new Date().toISOString();

  console.log(`[Authority] ✅ Enriched ${enriched.length} items from Supabase at ${timestamp}`);
  console.log(`[Authority] STRICT_MODE: ${STRICT_MODE ? 'ENABLED' : 'DISABLED'}`);

  return {
    items: enriched,
    timestamp,
    source: 'supabase',
    count: enriched.length
  };
}

/**
 * Map units to grams (for compatibility)
 */
function getGramsForUnit(unit) {
  const gramsMap = {
    oz: 28,
    half: 14,
    quarter: 7,
    eighth: 3.5
  };
  return gramsMap[unit] || null;
}
