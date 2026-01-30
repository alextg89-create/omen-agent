/**
 * Supabase Query Layer
 *
 * Queries for order events and inventory state
 * Safe fallback behavior if tables don't exist
 *
 * IMPORTANT: This module does NOT invent table names.
 * Table schema must be verified before use.
 */

import { getSupabaseClient, isSupabaseAvailable } from './supabaseClient.js';

/**
 * Query order-level aggregates within a date range
 *
 * SOURCE OF TRUTH: orders_agg table (order-level grain)
 * Schema: order_id, store_id, source, created_at, item_count, total_revenue, total_cost, total_profit
 *
 * @param {string} startDate - ISO date string (YYYY-MM-DD)
 * @param {string} endDate - ISO date string (YYYY-MM-DD)
 * @returns {Promise<{ok: boolean, data?: array, error?: string}>}
 */
export async function queryOrderEvents(startDate, endDate) {
  if (!isSupabaseAvailable()) {
    throw new Error('FATAL: Supabase not configured - cannot query orders. Set SUPABASE_SECRET_API_KEY in .env');
  }

  const client = getSupabaseClient();

  try {
    console.log(`[Supabase] Querying orders_agg from ${startDate} to ${endDate}`);

    const { data, error } = await client
      .from('orders_agg')
      .select('order_id, store_id, source, created_at, item_count, total_revenue, total_cost, total_profit')
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`FATAL: Failed to query orders_agg: ${error.message}`);
    }

    console.log(`[Supabase] Retrieved ${data?.length || 0} orders from orders_agg`);

    return {
      ok: true,
      data: data || [],
      count: data?.length || 0
    };
  } catch (err) {
    console.error('[Supabase] Query error:', err.message);
    throw err;
  }
}

/**
 * Query line-item order events (for SKU velocity analysis)
 *
 * SOURCE OF TRUTH: orders table (line-item grain)
 * Schema: order_id, sku, strain, unit, quantity, price_per_unit, order_date
 *
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 * @returns {Promise<{ok: boolean, data?: array, error?: string}>}
 */
export async function queryLineItemOrders(startDate, endDate) {
  if (!isSupabaseAvailable()) {
    throw new Error('FATAL: Supabase not configured - cannot query orders. Set SUPABASE_SECRET_API_KEY in .env');
  }

  const client = getSupabaseClient();

  try {
    console.log(`[Supabase] Querying line-item orders from ${startDate} to ${endDate}`);

    const { data, error } = await client
      .from('orders')
      .select('order_id, sku, strain, unit, quantity, price_per_unit, order_date, created_at')
      .gte('order_date', startDate)
      .lte('order_date', endDate)
      .order('order_date', { ascending: true });

    if (error) {
      throw new Error(`FATAL: Failed to query orders (line-item): ${error.message}`);
    }

    console.log(`[Supabase] Retrieved ${data?.length || 0} line items from orders`);

    return {
      ok: true,
      data: data || [],
      count: data?.length || 0
    };
  } catch (err) {
    console.error('[Supabase] Query error:', err.message);
    throw err;
  }
}

/**
 * Get sales totals for a time window (daily or weekly)
 *
 * SOURCE OF TRUTH: orders_agg
 *
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 * @returns {Promise<{ok: boolean, totals?: object, error?: string}>}
 */
export async function getSalesTotals(startDate, endDate) {
  const result = await queryOrderEvents(startDate, endDate);

  if (!result.ok) {
    return result;
  }

  const orders = result.data || [];

  const totals = {
    orderCount: orders.length,
    itemCount: orders.reduce((sum, o) => sum + (o.item_count || 0), 0),
    totalRevenue: orders.reduce((sum, o) => sum + (o.total_revenue || 0), 0),
    totalCost: orders.reduce((sum, o) => sum + (o.total_cost || 0), 0),
    totalProfit: orders.reduce((sum, o) => sum + (o.total_profit || 0), 0),
    startDate,
    endDate,
    orders
  };

  console.log(`[Supabase] Sales totals: ${totals.orderCount} orders, $${totals.totalRevenue.toFixed(2)} revenue, $${totals.totalProfit.toFixed(2)} profit`);

  return { ok: true, totals };
}

/**
 * Query current inventory state
 *
 * IMPORTANT: Inventory is OPTIONAL - failures must NEVER crash snapshot generation
 * Returns empty data on failure instead of throwing
 *
 * Expected table structure:
 * - inventory table with columns: sku, unit, quantity, quality, updated_at
 *
 * @param {string} tableName - Table name (default: 'inventory')
 * @returns {Promise<{ok: boolean, data?: array, error?: string}>}
 */
export async function queryInventoryState(tableName = 'inventory') {
  // Inventory is OPTIONAL - don't crash if Supabase unavailable
  if (!isSupabaseAvailable()) {
    console.warn('[Supabase] Inventory query skipped - Supabase not available');
    return { ok: false, data: [], count: 0, error: 'Supabase not available', skipped: true };
  }

  const client = getSupabaseClient();

  try {
    console.log(`[Supabase] Querying inventory state from ${tableName}`);

    const { data, error } = await client
      .from(tableName)
      .select('*')
      .gt('quantity', 0) // Only items in stock
      .order('updated_at', { ascending: false });

    if (error) {
      // WARN + CONTINUE instead of throwing - inventory is optional
      console.warn(`[Supabase] Inventory query failed (non-fatal): ${error.message}`);
      return { ok: false, data: [], count: 0, error: error.message };
    }

    console.log(`[Supabase] Retrieved ${data?.length || 0} inventory items`);

    return {
      ok: true,
      data: data || [],
      count: data?.length || 0
    };
  } catch (err) {
    // WARN + CONTINUE - inventory failures must never crash snapshots
    console.warn('[Supabase] Inventory query error (non-fatal):', err.message);
    return { ok: false, data: [], count: 0, error: err.message };
  }
}

/**
 * Get sales summary for a SKU
 *
 * Aggregates order events to compute total units sold
 *
 * @param {string} sku - Product SKU
 * @param {string} unit - Product unit (eighth, quarter, half, oz)
 * @param {number} daysSince - Number of days to look back
 * @param {string} tableName - Table name (default: 'orders')
 * @returns {Promise<{ok: boolean, summary?: object, error?: string}>}
 */
export async function getSalesSummary(sku, unit, daysSince = 30, tableName = 'orders') {
  if (!isSupabaseAvailable()) {
    throw new Error('FATAL: Supabase not configured - cannot query sales. Set SUPABASE_SECRET_API_KEY in .env');
  }

  const client = getSupabaseClient();

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysSince);
    const startISO = startDate.toISOString();

    console.log(`[Supabase] Getting sales summary for ${sku} (${unit}) since ${startISO}`);

    const { data, error } = await client
      .from(tableName)
      .select('quantity, created_at')
      .eq('sku', sku)
      .eq('unit', unit)
      .gte('created_at', startISO)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`FATAL: Failed to query sales for ${sku}: ${error.message}`);
    }

    // Aggregate results
    const totalUnitsSold = data.reduce((sum, order) => sum + (order.quantity || 0), 0);
    const orderCount = data.length;

    const summary = {
      sku,
      unit,
      daysSince,
      totalUnitsSold,
      orderCount,
      dailyAverage: orderCount > 0 ? totalUnitsSold / daysSince : 0,
      orders: data
    };

    console.log(`[Supabase] Sales summary: ${totalUnitsSold} units sold in ${orderCount} orders`);

    return {
      ok: true,
      summary
    };
  } catch (err) {
    console.error('[Supabase] Query error:', err.message);
    throw err;
  }
}

/**
 * List available tables (for debugging/verification)
 *
 * @returns {Promise<{ok: boolean, tables?: array, error?: string}>}
 */
export async function listTables() {
  if (!isSupabaseAvailable()) {
    return {
      ok: false,
      error: 'Supabase not available'
    };
  }

  const client = getSupabaseClient();

  try {
    // Query information_schema to get table list
    const { data, error } = await client
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public');

    if (error) {
      // This might fail if permissions don't allow schema queries
      console.warn('[Supabase] Could not list tables:', error.message);
      return {
        ok: false,
        error: error.message
      };
    }

    const tableNames = data.map(row => row.table_name);
    console.log(`[Supabase] Available tables: ${tableNames.join(', ')}`);

    return {
      ok: true,
      tables: tableNames
    };
  } catch (err) {
    console.error('[Supabase] List tables error:', err.message);
    return {
      ok: false,
      error: err.message
    };
  }
}

/**
 * Verify expected schema exists
 * Checks for presence of required tables
 *
 * @param {array} requiredTables - Array of table names to check
 * @returns {Promise<{ok: boolean, missing?: array, error?: string}>}
 */
export async function verifySchema(requiredTables = ['orders', 'inventory']) {
  const tablesResult = await listTables();

  if (!tablesResult.ok) {
    return {
      ok: false,
      error: 'Could not verify schema: ' + tablesResult.error
    };
  }

  const availableTables = tablesResult.tables || [];
  const missingTables = requiredTables.filter(table => !availableTables.includes(table));

  if (missingTables.length > 0) {
    console.warn(`[Supabase] Missing required tables: ${missingTables.join(', ')}`);
    return {
      ok: false,
      missing: missingTables,
      error: `Missing tables: ${missingTables.join(', ')}`
    };
  }

  console.log('[Supabase] Schema verification passed');
  return { ok: true };
}

/**
 * Record inventory event (append-only)
 *
 * Inserts a row into inventory_snapshots table
 * Does NOT update inventory_live (separate operation)
 *
 * @param {object} inventoryEvent - { sku, quantity, source, timestamp }
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
export async function recordInventorySnapshot(inventoryEvent) {
  if (!isSupabaseAvailable()) {
    return {
      ok: false,
      error: 'Supabase not available',
      fallback: true
    };
  }

  const client = getSupabaseClient();

  try {
    const { data, error } = await client
      .from('inventory_snapshots')
      .insert({
        sku: inventoryEvent.sku,
        quantity: inventoryEvent.quantity,
        source: inventoryEvent.source,
        recorded_at: inventoryEvent.timestamp || new Date().toISOString()
      })
      .select();

    if (error) {
      console.error(`[Supabase] Failed to record inventory snapshot: ${error.message}`);
      return { ok: false, error: error.message };
    }

    console.log(`[Supabase] Recorded inventory snapshot: ${inventoryEvent.sku} = ${inventoryEvent.quantity}`);
    return { ok: true, data: data[0] };
  } catch (err) {
    console.error('[Supabase] Record inventory snapshot error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Update live inventory state (upsert)
 *
 * Updates or inserts current inventory in inventory_live table
 *
 * @param {object} inventoryUpdate - { sku, quantity, source, timestamp }
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
export async function updateLiveInventory(inventoryUpdate) {
  if (!isSupabaseAvailable()) {
    return {
      ok: false,
      error: 'Supabase not available',
      fallback: true
    };
  }

  const client = getSupabaseClient();

  try {
    const { data, error } = await client
      .from('inventory_live')
      .upsert({
        sku: inventoryUpdate.sku,
        quantity: inventoryUpdate.quantity,
        last_updated: inventoryUpdate.timestamp || new Date().toISOString(),
        source: inventoryUpdate.source
      }, {
        onConflict: 'sku'
      })
      .select();

    if (error) {
      console.error(`[Supabase] Failed to update live inventory: ${error.message}`);
      return { ok: false, error: error.message };
    }

    console.log(`[Supabase] Updated live inventory: ${inventoryUpdate.sku} = ${inventoryUpdate.quantity}`);
    return { ok: true, data: data[0] };
  } catch (err) {
    console.error('[Supabase] Update live inventory error:', err.message);
    return { ok: false, error: err.message };
  }
}
