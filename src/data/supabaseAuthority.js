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
  if (!isSupabaseAvailable()) {
    throw new Error('FATAL: Supabase not configured. Set SUPABASE_SERVICE_KEY in .env');
  }

  const client = getSupabaseClient();

  console.log('[Authority] Querying Supabase for inventory + pricing...');

  // Query inventory table
  const { data: inventory, error: invError } = await client
    .from('inventory')
    .select('*');

  if (invError) {
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

  // Query pricing table
  const { data: pricing, error: priceError } = await client
    .from('pricing')
    .select('*');

  if (priceError) {
    throw new Error(`FATAL: Cannot load pricing from Supabase: ${priceError.message}`);
  }

  if (!pricing || pricing.length === 0) {
    throw new Error('FATAL: Pricing table is empty. Cannot calculate margins.');
  }

  console.log(`[Authority] Loaded ${inventory.length} inventory items, ${pricing.length} price records`);

  // Join inventory + pricing with STRICT validation
  const enriched = inventory.map(item => {
    // Find matching price
    const price = pricing.find(p =>
      p.quality === item.quality && p.unit === item.unit
    );

    // STRICT MODE: Missing price is fatal
    if (!price && STRICT_MODE) {
      throw new Error(`FATAL: No price for SKU "${item.sku}" (quality: ${item.quality}, unit: ${item.unit}). Pricing data incomplete.`);
    }

    // STRICT MODE: Missing quantity is fatal
    if (item.quantity === null || item.quantity === undefined) {
      throw new Error(`FATAL: Missing quantity for SKU "${item.sku}". Inventory data incomplete.`);
    }

    const cost = price?.cost || null;
    const retail = price?.retail || null;

    // Calculate margin
    const margin = (cost && retail)
      ? ((retail - cost) / retail * 100).toFixed(2)
      : null;

    // STRICT MODE: Cannot calculate margin is fatal
    if (!margin && STRICT_MODE) {
      throw new Error(`FATAL: Cannot calculate margin for SKU "${item.sku}" - missing cost (${cost}) or retail (${retail}). Pricing data incomplete.`);
    }

    return {
      sku: item.sku,
      strain: item.strain || item.name,
      name: `${item.strain || item.name} (${item.unit})`,
      unit: item.unit,
      quality: item.quality,
      quantity: item.quantity,
      grams: item.grams || getGramsForUnit(item.unit),
      pricing: {
        cost,
        retail,
        sale: price?.sale || null,
        margin: parseFloat(margin)
      },
      updated_at: item.updated_at,
      pricingMatch: true
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
