/**
 * Inventory Store - REFACTORED TO USE SUPABASE AUTHORITY
 *
 * DEPRECATED BEHAVIOR:
 * - NO boot-time disk loading
 * - NO static Map caching
 * - NO persistent JSON files
 *
 * NEW BEHAVIOR:
 * - Queries Supabase via authority module
 * - Short-lived cache (5 min TTL)
 * - Explicit cache invalidation via clearInventory()
 */

import { getAuthoritativeInventory, AUTHORITY_ERROR } from '../data/supabaseAuthority.js';

// Re-export for consumers
export { AUTHORITY_ERROR };

let cachedInventory = null;
let cachedMetadata = null;
let cacheTimestamp = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get inventory from Supabase (with short-lived cache)
 *
 * Cache TTL: 5 minutes
 * After TTL expires, fetches fresh data from Supabase
 *
 * @param {string} source - Store ID (legacy parameter, ignored)
 * @returns {Promise<Array>} - Enriched inventory items
 */
export async function getInventory(source) {
  const now = Date.now();

  // Check cache validity
  if (cachedInventory && cacheTimestamp && (now - cacheTimestamp < CACHE_TTL_MS)) {
    const ageSeconds = Math.floor((now - cacheTimestamp) / 1000);
    console.log(`[InventoryStore] Cache HIT (age: ${ageSeconds}s, TTL: ${CACHE_TTL_MS/1000}s)`);
    return cachedInventory;
  }

  // Cache miss or expired - fetch fresh
  console.log('[InventoryStore] Cache MISS or EXPIRED - fetching from Supabase authority');

  try {
    const result = await getAuthoritativeInventory();

    cachedInventory = result.items;
    cachedMetadata = {
      timestamp: result.timestamp,
      source: result.source,
      inventoryLastSyncedAt: result.inventoryLastSyncedAt,
      count: result.count
    };
    cacheTimestamp = now;

    console.log(`[InventoryStore] ✅ Cached ${result.items.length} items from ${result.source} at ${result.timestamp}`);

    return cachedInventory;
  } catch (err) {
    // DO NOT FALLBACK - propagate error
    console.error('[InventoryStore] ❌ FATAL: Cannot load inventory:', err.message);
    throw err;
  }
}

/**
 * Get inventory with full metadata including freshness info
 *
 * @param {string} source - Store ID (legacy parameter, ignored)
 * @returns {Promise<{items: Array, metadata: Object}>}
 */
export async function getInventoryWithMetadata(source) {
  // Ensure cache is populated
  await getInventory(source);

  return {
    items: cachedInventory,
    metadata: cachedMetadata
  };
}

/**
 * Save inventory - DEPRECATED
 *
 * Inventory is READ-ONLY from Supabase.
 * Updates must go through Make → Supabase webhook.
 *
 * @throws {Error} Always throws - operation not supported
 */
export function saveInventory(source, items) {
  throw new Error('DEPRECATED: saveInventory is no longer supported. Inventory is READ-ONLY from Supabase. Use Make webhook to update data.');
}

/**
 * Clear inventory cache
 *
 * Forces next getInventory() call to fetch fresh data from Supabase
 *
 * @param {string} source - Store ID (legacy parameter, ignored)
 */
export function clearInventory(source) {
  cachedInventory = null;
  cachedMetadata = null;
  cacheTimestamp = null;
  console.log('[InventoryStore] 🔄 Cache CLEARED - next request will fetch fresh Supabase data');
}
