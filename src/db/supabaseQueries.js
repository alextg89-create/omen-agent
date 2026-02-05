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
 * PRIORITY 1: orders_agg table (pre-aggregated, order-level grain)
 * FALLBACK: Compute aggregates from orders table (line-item grain)
 *
 * This ensures snapshots reflect real orders even when aggregation is pending.
 * Snapshots must NEVER say "0 orders" when orders exist in the pipeline.
 *
 * @param {string} startDate - ISO date string (YYYY-MM-DD)
 * @param {string} endDate - ISO date string (YYYY-MM-DD)
 * @returns {Promise<{ok: boolean, data?: array, error?: string, source?: string}>}
 */
export async function queryOrderEvents(startDate, endDate) {
  if (!isSupabaseAvailable()) {
    throw new Error('FATAL: Supabase not configured - cannot query orders. Set SUPABASE_SECRET_API_KEY in .env');
  }

  const client = getSupabaseClient();

  try {
    // STEP 1: Try orders_agg first (pre-aggregated)
    console.log(`[Supabase] Querying orders_agg from ${startDate} to ${endDate}`);

    const { data: aggData, error: aggError } = await client
      .from('orders_agg')
      .select('order_id, store_id, source, created_at, item_count, total_revenue, total_cost, total_profit')
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: true });

    // If orders_agg has data, use it
    if (!aggError && aggData && aggData.length > 0) {
      console.log(`[Supabase] Retrieved ${aggData.length} orders from orders_agg`);
      return {
        ok: true,
        data: aggData,
        count: aggData.length,
        source: 'orders_agg'
      };
    }

    // STEP 2: Fallback - compute aggregates from orders table (line-item level)
    // This ensures we never report "0 orders" when webhook_events → orders has data
    console.log(`[Supabase] orders_agg empty or error (${aggError?.message || 'no rows'}), falling back to orders table`);

    const { data: lineItems, error: lineError } = await client
      .from('orders')
      .select('order_id, sku, quantity, price_per_unit, total_amount, order_date, created_at')
      .gte('order_date', startDate)
      .lte('order_date', endDate)
      .order('order_date', { ascending: true });

    if (lineError) {
      throw new Error(`FATAL: Failed to query orders: ${lineError.message}`);
    }

    if (!lineItems || lineItems.length === 0) {
      console.log(`[Supabase] No orders found in either orders_agg or orders table`);
      return {
        ok: true,
        data: [],
        count: 0,
        source: 'orders_fallback'
      };
    }

    // Aggregate line items by order_id
    const orderMap = new Map();
    for (const item of lineItems) {
      const orderId = item.order_id;
      if (!orderMap.has(orderId)) {
        orderMap.set(orderId, {
          order_id: orderId,
          store_id: null,
          source: 'wix',
          created_at: item.order_date || item.created_at,
          item_count: 0,
          total_revenue: 0,
          total_cost: null,  // Cost not available at line-item level
          total_profit: null
        });
      }
      const order = orderMap.get(orderId);
      order.item_count += item.quantity || 1;
      order.total_revenue += item.total_amount || (item.quantity * item.price_per_unit) || 0;
    }

    const aggregatedOrders = Array.from(orderMap.values());
    console.log(`[Supabase] Computed ${aggregatedOrders.length} orders from ${lineItems.length} line items (fallback)`);

    return {
      ok: true,
      data: aggregatedOrders,
      count: aggregatedOrders.length,
      source: 'orders_fallback',
      aggregationPending: true  // Signal that proper aggregation should run
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

  // Track orders with valid financial data (don't fabricate from missing)
  const ordersWithRevenue = orders.filter(o => o.total_revenue !== null && o.total_revenue !== undefined);
  const ordersWithCost = orders.filter(o => o.total_cost !== null && o.total_cost !== undefined);
  const ordersWithProfit = orders.filter(o => o.total_profit !== null && o.total_profit !== undefined);

  // Aggregate only from orders with valid data - NULL if no valid data
  const totalRevenue = ordersWithRevenue.length > 0
    ? ordersWithRevenue.reduce((sum, o) => sum + o.total_revenue, 0)
    : null;
  const totalCost = ordersWithCost.length > 0
    ? ordersWithCost.reduce((sum, o) => sum + o.total_cost, 0)
    : null;
  const totalProfit = ordersWithProfit.length > 0
    ? ordersWithProfit.reduce((sum, o) => sum + o.total_profit, 0)
    : null;

  const totals = {
    orderCount: orders.length,
    itemCount: orders.reduce((sum, o) => sum + (o.item_count || 0), 0),
    totalRevenue,
    totalCost,
    totalProfit,
    // DATA QUALITY: Track how many orders have valid financial data
    dataQuality: {
      ordersWithRevenue: ordersWithRevenue.length,
      ordersWithCost: ordersWithCost.length,
      ordersWithProfit: ordersWithProfit.length,
      missingRevenue: orders.length - ordersWithRevenue.length,
      missingCost: orders.length - ordersWithCost.length,
      missingProfit: orders.length - ordersWithProfit.length
    },
    startDate,
    endDate,
    orders
  };

  const revenueStr = totalRevenue !== null ? `$${totalRevenue.toFixed(2)}` : 'N/A';
  const profitStr = totalProfit !== null ? `$${totalProfit.toFixed(2)}` : 'N/A';
  console.log(`[Supabase] Sales totals: ${totals.orderCount} orders, ${revenueStr} revenue, ${profitStr} profit`);

  if (totals.dataQuality.missingCost > 0) {
    console.warn(`[Supabase] ⚠️ ${totals.dataQuality.missingCost}/${orders.length} orders missing cost data`);
  }

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

/**
 * Get order context across multiple time scopes
 *
 * Returns order stats for:
 * - Specified timeframe (passed in)
 * - Last 30 days
 * - All-time (lifetime)
 *
 * This provides context without mixing metrics.
 *
 * @returns {Promise<{ok: boolean, context?: object, error?: string}>}
 */
export async function getOrderContext() {
  if (!isSupabaseAvailable()) {
    return {
      ok: false,
      error: 'Supabase not available'
    };
  }

  const client = getSupabaseClient();

  try {
    // Calculate date boundaries
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    console.log(`[Supabase] Querying order context (30-day and lifetime)`);

    // Query 1: Last 30 days
    const { data: last30Days, error: err30 } = await client
      .from('orders')
      .select('order_id, quantity, price_per_unit, total_amount, order_date')
      .gte('order_date', thirtyDaysAgo.toISOString());

    if (err30) {
      console.warn(`[Supabase] 30-day query failed: ${err30.message}`);
    }

    // Query 2: All-time (no date filter)
    const { data: allTime, error: errAll } = await client
      .from('orders')
      .select('order_id, sku, quantity, price_per_unit, total_amount');

    if (errAll) {
      console.warn(`[Supabase] All-time query failed: ${errAll.message}`);
    }

    // Aggregate 30-day stats
    const last30DaysOrders = last30Days || [];
    const uniqueOrders30 = new Set(last30DaysOrders.map(o => o.order_id));
    const revenue30 = last30DaysOrders.reduce((sum, o) =>
      sum + (o.total_amount || (o.quantity * o.price_per_unit) || 0), 0);

    // Aggregate all-time stats
    const allTimeOrders = allTime || [];
    const uniqueOrdersAll = new Set(allTimeOrders.map(o => o.order_id));
    const revenueAll = allTimeOrders.reduce((sum, o) =>
      sum + (o.total_amount || (o.quantity * o.price_per_unit) || 0), 0);

    // Find top SKU by revenue (all-time)
    const skuRevenue = new Map();
    for (const order of allTimeOrders) {
      const sku = order.sku || 'Unknown';
      const revenue = order.total_amount || (order.quantity * order.price_per_unit) || 0;
      skuRevenue.set(sku, (skuRevenue.get(sku) || 0) + revenue);
    }
    const topSku = Array.from(skuRevenue.entries())
      .sort((a, b) => b[1] - a[1])[0];

    const context = {
      last30Days: {
        orderCount: uniqueOrders30.size,
        lineItems: last30DaysOrders.length,
        totalRevenue: Math.round(revenue30 * 100) / 100,
        label: 'Last 30 days'
      },
      allTime: {
        orderCount: uniqueOrdersAll.size,
        lineItems: allTimeOrders.length,
        totalRevenue: Math.round(revenueAll * 100) / 100,
        topSku: topSku ? { sku: topSku[0], revenue: Math.round(topSku[1] * 100) / 100 } : null,
        label: 'All time'
      },
      queriedAt: new Date().toISOString()
    };

    console.log(`[Supabase] Order context: 30-day=${context.last30Days.orderCount} orders, all-time=${context.allTime.orderCount} orders`);

    return {
      ok: true,
      context
    };
  } catch (err) {
    console.error('[Supabase] Order context query error:', err.message);
    return { ok: false, error: err.message };
  }
}
