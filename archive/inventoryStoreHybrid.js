/**
 * Hybrid Inventory Store
 *
 * Reads from Supabase (if available) with fallback to local storage
 *
 * Data Flow Priority:
 * 1. Supabase (if OMEN_USE_SUPABASE=true and configured)
 * 2. In-memory cache (Map)
 * 3. Disk storage (inventory.snapshot.json)
 *
 * Write behavior:
 * - Writes always go to in-memory + disk (for backward compatibility)
 * - Supabase writes are NOT implemented (read-only integration)
 */

import fs from 'fs';
import path from 'path';
import { isSupabaseAvailable, getConnectionStatus } from '../db/supabaseClient.js';
import { queryInventoryState } from '../db/supabaseQueries.js';

const STORE_PATH = path.resolve('src/data/data/inventory.snapshot.json');
let INVENTORY_STORE = new Map();

/**
 * Load snapshot from disk on boot
 */
(function loadFromDisk() {
  if (!fs.existsSync(STORE_PATH)) {
    console.log('[inventoryStore] No snapshot found on disk');
    return;
  }

  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
      INVENTORY_STORE = new Map(Object.entries(parsed));
      console.log('[inventoryStore] Loaded snapshot from disk with', INVENTORY_STORE.size, 'sources');
    } else {
      console.log('[inventoryStore] Snapshot exists but is empty — keeping in-memory store');
    }
  } catch (err) {
    console.warn('[inventoryStore] Failed to load snapshot:', err.message);
  }
})();

/**
 * Persist snapshot to disk
 */
function persistToDisk() {
  const obj = Object.fromEntries(INVENTORY_STORE);
  fs.writeFileSync(STORE_PATH, JSON.stringify(obj, null, 2));
}

/**
 * Save inventory snapshot (WRITE operation)
 * Always writes to in-memory + disk for backward compatibility
 */
export function saveInventory(source, items = []) {
  INVENTORY_STORE.set(source, items);
  persistToDisk();

  console.log(`[inventoryStore] Saved ${items.length} items for source: ${source}`);

  return {
    source,
    count: items.length,
    storedAt: new Date().toISOString(),
    dataSource: 'local'
  };
}

/**
 * Retrieve inventory snapshot (READ operation)
 *
 * Priority:
 * 1. Supabase (if enabled and available)
 * 2. In-memory cache
 * 3. Empty array
 *
 * @param {string} source - Inventory source identifier (e.g., "NJWeedWizard")
 * @returns {Promise<array>} Inventory items
 */
export async function getInventory(source) {
  const supabaseStatus = getConnectionStatus();

  // PRIORITY 1: Try Supabase if available
  if (isSupabaseAvailable()) {
    console.log(`[inventoryStore] Attempting to fetch from Supabase for source: ${source}`);

    try {
      const result = await queryInventoryState('inventory');

      if (result.ok && result.data && result.data.length > 0) {
        console.log(`[inventoryStore] ✅ Retrieved ${result.data.length} items from Supabase`);

        // Cache in memory for performance (cache-aside pattern)
        INVENTORY_STORE.set(source, result.data);

        return result.data;
      }

      if (result.fallback) {
        console.log('[inventoryStore] Supabase query indicated fallback needed');
      } else {
        console.log('[inventoryStore] Supabase returned no data, falling back to local');
      }
    } catch (err) {
      console.warn(`[inventoryStore] Supabase query failed: ${err.message}, falling back to local`);
    }
  } else if (supabaseStatus.enabled) {
    console.log(`[inventoryStore] Supabase enabled but not available: ${supabaseStatus.error || 'unknown'}`);
  }

  // PRIORITY 2: Use in-memory cache
  const cachedData = INVENTORY_STORE.get(source);
  if (cachedData && cachedData.length > 0) {
    console.log(`[inventoryStore] Using cached data (${cachedData.length} items)`);
    return cachedData;
  }

  // PRIORITY 3: No data available
  console.log(`[inventoryStore] No data available for source: ${source}`);
  return [];
}

/**
 * Get inventory synchronously (for backward compatibility)
 * Only returns cached data, does not query Supabase
 */
export function getInventorySync(source) {
  return INVENTORY_STORE.get(source) || [];
}

/**
 * Clear inventory (optional)
 */
export function clearInventory(source) {
  if (source) {
    INVENTORY_STORE.delete(source);
  } else {
    INVENTORY_STORE.clear();
  }
  persistToDisk();
}

/**
 * Get data source status for diagnostics
 */
export function getDataSourceStatus() {
  const supabaseStatus = getConnectionStatus();

  return {
    supabase: {
      enabled: supabaseStatus.enabled,
      available: isSupabaseAvailable(),
      configured: supabaseStatus.configured,
      error: supabaseStatus.error
    },
    local: {
      cacheSize: INVENTORY_STORE.size,
      sources: Array.from(INVENTORY_STORE.keys())
    },
    priority: isSupabaseAvailable() ? 'supabase' : 'local'
  };
}
