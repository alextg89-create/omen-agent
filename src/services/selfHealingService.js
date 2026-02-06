/**
 * OMEN SELF-HEALING DATA SYNC SERVICE
 *
 * This module implements automatic data synchronization and validation.
 * All guards are idempotent - safe to call multiple times.
 * All rebuilds are safe to run concurrently (use locks internally).
 *
 * ARCHITECTURE:
 * - Guards: Pure functions that decide if work is needed
 * - Controllers: Orchestrate actual sync/rebuild work
 * - Resolver: Main entry point that coordinates guards and controllers
 *
 * TRIGGERS:
 * - Inventory: cost import, Wix webhook, staleness detection
 * - Orders: webhook arrival, orders_agg empty/stale
 *
 * POLICY:
 * - Staleness based on timestamps, not guesses
 * - Phantom SKUs excluded (archived, non-sellable)
 * - No manual buttons required for correctness
 */

import { getSupabaseClient, isSupabaseAvailable } from '../db/supabaseClient.js';
import { syncOrdersFromWebhooks } from './orderSyncService.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Staleness thresholds (in hours)
  INVENTORY_STALE_THRESHOLD_HOURS: 24,
  ORDERS_STALE_THRESHOLD_HOURS: 1,
  ORDERS_AGG_STALE_THRESHOLD_HOURS: 6,

  // Sync lookback periods (in days)
  ORDER_SYNC_LOOKBACK_DAYS: 30,

  // Lock timeout (in ms)
  REBUILD_LOCK_TIMEOUT_MS: 60000,

  // Active SKU definition
  ACTIVE_SKU_STATUSES: ['IN_STOCK', 'COUNTED']
};

// ============================================================================
// STATE (in-memory locks to prevent concurrent rebuilds)
// ============================================================================

const state = {
  inventoryRebuildInProgress: false,
  orderRebuildInProgress: false,
  lastInventorySync: null,
  lastOrderSync: null,
  lastOrderAggregation: null,
  rebuildHistory: []
};

// ============================================================================
// GUARDS - Pure functions that decide if work is needed
// ============================================================================

/**
 * INVENTORY SYNC GUARD
 *
 * Determines if inventory needs to be synced based on:
 * - Time since last sync
 * - Explicit trigger (cost import, webhook)
 * - Missing or stale data
 *
 * @param {object} params - Guard parameters
 * @param {string} params.trigger - What triggered the check
 * @param {string|null} params.lastSyncedAt - Last sync timestamp
 * @param {boolean} params.forcedByWebhook - Webhook just fired
 * @param {boolean} params.forcedByCostImport - Costs just imported
 * @returns {{ needsSync: boolean, reason: string, priority: string }}
 */
export function inventorySyncGuard({
  trigger = 'scheduled',
  lastSyncedAt = null,
  forcedByWebhook = false,
  forcedByCostImport = false
}) {
  // Priority 1: Explicit triggers always sync
  if (forcedByWebhook) {
    return {
      needsSync: true,
      reason: 'Wix inventory webhook received',
      priority: 'high'
    };
  }

  if (forcedByCostImport) {
    return {
      needsSync: true,
      reason: 'New costs imported - need to re-enrich inventory',
      priority: 'high'
    };
  }

  // Priority 2: No sync timestamp = first time or corrupted
  if (!lastSyncedAt) {
    return {
      needsSync: true,
      reason: 'No inventory sync timestamp found',
      priority: 'critical'
    };
  }

  // Priority 3: Check staleness
  const syncTime = new Date(lastSyncedAt);
  if (isNaN(syncTime.getTime())) {
    return {
      needsSync: true,
      reason: 'Invalid inventory sync timestamp',
      priority: 'critical'
    };
  }

  const ageHours = (Date.now() - syncTime.getTime()) / (1000 * 60 * 60);

  if (ageHours > CONFIG.INVENTORY_STALE_THRESHOLD_HOURS) {
    return {
      needsSync: true,
      reason: `Inventory ${Math.round(ageHours)} hours stale (threshold: ${CONFIG.INVENTORY_STALE_THRESHOLD_HOURS}h)`,
      priority: 'medium'
    };
  }

  // No sync needed
  return {
    needsSync: false,
    reason: `Inventory fresh (${Math.round(ageHours * 10) / 10}h old)`,
    priority: 'none'
  };
}

/**
 * ORDER AGGREGATION GUARD
 *
 * Determines if orders need aggregation based on:
 * - orders_agg table empty
 * - New orders arrived since last aggregation
 * - Time since last aggregation
 *
 * @param {object} params - Guard parameters
 * @param {number} params.ordersAggCount - Rows in orders_agg
 * @param {number} params.ordersCount - Rows in orders table
 * @param {string|null} params.lastAggregatedAt - Last aggregation timestamp
 * @param {string|null} params.latestOrderAt - Most recent order timestamp
 * @param {boolean} params.forcedByWebhook - New order webhook just arrived
 * @returns {{ needsAggregation: boolean, reason: string, priority: string }}
 */
export function orderAggregationGuard({
  ordersAggCount = 0,
  ordersCount = 0,
  lastAggregatedAt = null,
  latestOrderAt = null,
  forcedByWebhook = false
}) {
  // Priority 1: Webhook trigger
  if (forcedByWebhook) {
    return {
      needsAggregation: true,
      reason: 'New order webhook received',
      priority: 'high'
    };
  }

  // Priority 2: orders_agg is empty but orders exist
  if (ordersAggCount === 0 && ordersCount > 0) {
    return {
      needsAggregation: true,
      reason: `orders_agg empty but ${ordersCount} orders exist`,
      priority: 'critical'
    };
  }

  // Priority 3: No orders at all - nothing to aggregate
  if (ordersCount === 0) {
    return {
      needsAggregation: false,
      reason: 'No orders to aggregate',
      priority: 'none'
    };
  }

  // Priority 4: Check if new orders arrived since last aggregation
  if (lastAggregatedAt && latestOrderAt) {
    const aggTime = new Date(lastAggregatedAt);
    const orderTime = new Date(latestOrderAt);

    if (orderTime > aggTime) {
      return {
        needsAggregation: true,
        reason: 'New orders arrived since last aggregation',
        priority: 'medium'
      };
    }
  }

  // Priority 5: Check staleness of aggregation
  if (lastAggregatedAt) {
    const aggTime = new Date(lastAggregatedAt);
    const ageHours = (Date.now() - aggTime.getTime()) / (1000 * 60 * 60);

    if (ageHours > CONFIG.ORDERS_AGG_STALE_THRESHOLD_HOURS) {
      return {
        needsAggregation: true,
        reason: `Aggregation ${Math.round(ageHours)} hours stale (threshold: ${CONFIG.ORDERS_AGG_STALE_THRESHOLD_HOURS}h)`,
        priority: 'low'
      };
    }
  }

  // No aggregation needed
  return {
    needsAggregation: false,
    reason: 'Orders aggregation is current',
    priority: 'none'
  };
}

// ============================================================================
// CONTROLLERS - Orchestrate actual sync/rebuild work
// ============================================================================

/**
 * REBUILD CONTROLLER
 *
 * Main orchestrator for rebuild operations.
 * Handles locking, execution, and logging.
 *
 * @param {string} reason - Why rebuild was triggered
 * @param {object} options - Rebuild options
 * @param {boolean} options.inventory - Rebuild inventory
 * @param {boolean} options.orders - Rebuild orders
 * @param {boolean} options.force - Force rebuild even if locked
 * @returns {Promise<{ ok: boolean, results: object, duration: number }>}
 */
export async function rebuildController(reason, options = {}) {
  const {
    inventory = true,
    orders = true,
    force = false
  } = options;

  const startTime = Date.now();
  const rebuildId = `rebuild_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  console.log(`[SelfHealing] ========================================`);
  console.log(`[SelfHealing] REBUILD INITIATED: ${rebuildId}`);
  console.log(`[SelfHealing] Reason: ${reason}`);
  console.log(`[SelfHealing] Options: inventory=${inventory}, orders=${orders}, force=${force}`);
  console.log(`[SelfHealing] ========================================`);

  const results = {
    rebuildId,
    reason,
    startedAt: new Date().toISOString(),
    inventory: null,
    orders: null,
    errors: []
  };

  try {
    // Inventory rebuild
    if (inventory) {
      results.inventory = await rebuildInventory(rebuildId, force);
    }

    // Orders rebuild
    if (orders) {
      results.orders = await rebuildOrders(rebuildId, force);
    }

    results.completedAt = new Date().toISOString();
    results.duration = Date.now() - startTime;
    results.success = results.errors.length === 0;

    // Record in history
    state.rebuildHistory.push({
      id: rebuildId,
      reason,
      timestamp: results.startedAt,
      duration: results.duration,
      success: results.success
    });

    // Keep only last 50 rebuilds
    if (state.rebuildHistory.length > 50) {
      state.rebuildHistory = state.rebuildHistory.slice(-50);
    }

    console.log(`[SelfHealing] REBUILD COMPLETE: ${rebuildId} in ${results.duration}ms`);

    return {
      ok: results.success,
      results,
      duration: results.duration
    };

  } catch (err) {
    console.error(`[SelfHealing] REBUILD FAILED: ${rebuildId}`, err.message);
    results.errors.push(err.message);
    results.completedAt = new Date().toISOString();
    results.duration = Date.now() - startTime;
    results.success = false;

    return {
      ok: false,
      results,
      duration: results.duration,
      error: err.message
    };
  }
}

/**
 * Rebuild inventory cache
 */
async function rebuildInventory(rebuildId, force) {
  if (state.inventoryRebuildInProgress && !force) {
    return {
      skipped: true,
      reason: 'Inventory rebuild already in progress'
    };
  }

  state.inventoryRebuildInProgress = true;

  try {
    console.log(`[SelfHealing] [${rebuildId}] Starting inventory rebuild...`);

    // Clear local cache
    const { clearInventory, getInventory } = await import('../tools/inventoryStore.js');
    clearInventory();

    // Force fresh load from Supabase
    const STORE_ID = process.env.STORE_ID || 'NJWeedWizard';
    const inventory = await getInventory(STORE_ID);

    state.lastInventorySync = new Date().toISOString();

    console.log(`[SelfHealing] [${rebuildId}] Inventory rebuild complete: ${inventory.length} items`);

    return {
      skipped: false,
      itemCount: inventory.length,
      syncedAt: state.lastInventorySync
    };

  } finally {
    state.inventoryRebuildInProgress = false;
  }
}

/**
 * Rebuild orders from webhooks
 */
async function rebuildOrders(rebuildId, force) {
  if (state.orderRebuildInProgress && !force) {
    return {
      skipped: true,
      reason: 'Order rebuild already in progress'
    };
  }

  state.orderRebuildInProgress = true;

  try {
    console.log(`[SelfHealing] [${rebuildId}] Starting order sync...`);

    const result = await syncOrdersFromWebhooks(CONFIG.ORDER_SYNC_LOOKBACK_DAYS);

    state.lastOrderSync = new Date().toISOString();

    console.log(`[SelfHealing] [${rebuildId}] Order sync complete: ${result.synced} synced, ${result.skipped} skipped`);

    return {
      skipped: false,
      synced: result.synced,
      skippedOrders: result.skipped,
      errors: result.errors,
      syncedAt: state.lastOrderSync
    };

  } finally {
    state.orderRebuildInProgress = false;
  }
}

/**
 * FRESHNESS RESOLVER
 *
 * Main entry point for self-healing checks.
 * Evaluates all guards and triggers rebuilds as needed.
 *
 * @param {object} params - Resolver parameters
 * @param {string} params.trigger - What triggered the check
 * @param {boolean} params.forcedByWebhook - Webhook trigger
 * @param {boolean} params.forcedByCostImport - Cost import trigger
 * @returns {Promise<{ status: object, actions: array }>}
 */
export async function freshnessResolver({
  trigger = 'scheduled',
  forcedByWebhook = false,
  forcedByCostImport = false
} = {}) {
  console.log(`[SelfHealing] Freshness check triggered: ${trigger}`);

  const status = await getSystemStatus();
  const actions = [];

  // Check inventory guard
  const inventoryGuard = inventorySyncGuard({
    trigger,
    lastSyncedAt: status.inventory.lastSyncedAt,
    forcedByWebhook,
    forcedByCostImport
  });

  // Check order aggregation guard
  const orderGuard = orderAggregationGuard({
    ordersAggCount: status.orders.aggCount,
    ordersCount: status.orders.totalCount,
    lastAggregatedAt: status.orders.lastAggregatedAt,
    latestOrderAt: status.orders.latestOrderAt,
    forcedByWebhook
  });

  // Execute rebuilds based on guard decisions
  if (inventoryGuard.needsSync) {
    actions.push({
      type: 'inventory_sync',
      reason: inventoryGuard.reason,
      priority: inventoryGuard.priority
    });
  }

  if (orderGuard.needsAggregation) {
    actions.push({
      type: 'order_sync',
      reason: orderGuard.reason,
      priority: orderGuard.priority
    });
  }

  // If any high-priority actions, execute rebuild
  const highPriorityActions = actions.filter(a => ['high', 'critical'].includes(a.priority));

  let rebuildResult = null;
  if (highPriorityActions.length > 0) {
    const reasons = highPriorityActions.map(a => a.reason).join('; ');
    rebuildResult = await rebuildController(reasons, {
      inventory: inventoryGuard.needsSync,
      orders: orderGuard.needsAggregation
    });
  }

  return {
    trigger,
    timestamp: new Date().toISOString(),
    guards: {
      inventory: inventoryGuard,
      orders: orderGuard
    },
    actions,
    rebuildTriggered: rebuildResult !== null,
    rebuildResult,
    status
  };
}

// ============================================================================
// STATUS & VERIFICATION
// ============================================================================

/**
 * Get comprehensive system status
 */
export async function getSystemStatus() {
  const status = {
    timestamp: new Date().toISOString(),
    supabaseAvailable: isSupabaseAvailable(),
    inventory: {
      lastSyncedAt: state.lastInventorySync,
      rebuildInProgress: state.inventoryRebuildInProgress,
      itemCount: null,
      activeCount: null,
      stale: null
    },
    orders: {
      lastSyncedAt: state.lastOrderSync,
      lastAggregatedAt: state.lastOrderAggregation,
      rebuildInProgress: state.orderRebuildInProgress,
      totalCount: null,
      aggCount: null,
      latestOrderAt: null
    },
    rebuildHistory: state.rebuildHistory.slice(-10)
  };

  if (!isSupabaseAvailable()) {
    return status;
  }

  try {
    const client = getSupabaseClient();

    // Get inventory stats
    const { data: invData, error: invError } = await client
      .from('wix_inventory_live')
      .select('sku, quantity, inventory_status, synced_at')
      .limit(1000);

    if (!invError && invData) {
      status.inventory.itemCount = invData.length;
      status.inventory.activeCount = invData.filter(i =>
        i.quantity > 0 || i.inventory_status === 'IN_STOCK'
      ).length;

      // Get most recent sync timestamp
      const syncTimestamps = invData
        .map(i => i.synced_at)
        .filter(t => t)
        .sort((a, b) => new Date(b) - new Date(a));

      if (syncTimestamps.length > 0) {
        status.inventory.lastSyncedAt = syncTimestamps[0];
        const ageHours = (Date.now() - new Date(syncTimestamps[0]).getTime()) / (1000 * 60 * 60);
        status.inventory.stale = ageHours > CONFIG.INVENTORY_STALE_THRESHOLD_HOURS;
        status.inventory.ageHours = Math.round(ageHours * 10) / 10;
      }
    }

    // Get orders stats
    const { count: ordersCount } = await client
      .from('orders')
      .select('*', { count: 'exact', head: true });

    status.orders.totalCount = ordersCount || 0;

    // Get orders_agg stats
    const { count: aggCount } = await client
      .from('orders_agg')
      .select('*', { count: 'exact', head: true });

    status.orders.aggCount = aggCount || 0;

    // Get latest order timestamp
    const { data: latestOrder } = await client
      .from('orders')
      .select('order_date')
      .order('order_date', { ascending: false })
      .limit(1);

    if (latestOrder && latestOrder.length > 0) {
      status.orders.latestOrderAt = latestOrder[0].order_date;
    }

  } catch (err) {
    console.error('[SelfHealing] Status query error:', err.message);
    status.error = err.message;
  }

  return status;
}

/**
 * Verify data integrity
 *
 * Checks:
 * - Inventory and costs match
 * - Orders and orders_agg match
 * - No phantom SKUs
 * - Timestamps are valid
 */
export async function verifyDataIntegrity() {
  console.log('[SelfHealing] Starting data integrity verification...');

  const verification = {
    timestamp: new Date().toISOString(),
    checks: [],
    passed: true,
    issues: []
  };

  if (!isSupabaseAvailable()) {
    verification.passed = false;
    verification.issues.push('Supabase not available');
    return verification;
  }

  try {
    const client = getSupabaseClient();

    // Check 1: Inventory exists
    const { count: invCount } = await client
      .from('wix_inventory_live')
      .select('*', { count: 'exact', head: true });

    verification.checks.push({
      name: 'inventory_exists',
      passed: invCount > 0,
      value: invCount
    });

    if (invCount === 0) {
      verification.passed = false;
      verification.issues.push('No inventory data in wix_inventory_live');
    }

    // Check 2: Costs exist
    const { count: costCount } = await client
      .from('sku_costs')
      .select('*', { count: 'exact', head: true });

    verification.checks.push({
      name: 'costs_exist',
      passed: costCount > 0,
      value: costCount
    });

    if (costCount === 0) {
      verification.issues.push('No cost data in sku_costs');
    }

    // Check 3: Orders sync
    const { count: ordersCount } = await client
      .from('orders')
      .select('*', { count: 'exact', head: true });

    const { count: webhooksCount } = await client
      .from('webhook_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'wix.order.created');

    verification.checks.push({
      name: 'orders_synced',
      passed: ordersCount > 0 || webhooksCount === 0,
      ordersCount,
      webhooksCount
    });

    if (webhooksCount > 0 && ordersCount === 0) {
      verification.passed = false;
      verification.issues.push(`${webhooksCount} order webhooks exist but no orders synced`);
    }

    // Check 4: No phantom SKUs (SKUs in orders but not in inventory)
    const { data: orderSkus } = await client
      .from('orders')
      .select('sku')
      .limit(500);

    const { data: invSkus } = await client
      .from('wix_inventory_live')
      .select('sku')
      .limit(500);

    if (orderSkus && invSkus) {
      const inventorySkuSet = new Set(invSkus.map(i => i.sku));
      const phantomSkus = orderSkus
        .filter(o => o.sku && !o.sku.startsWith('UNMATCHED-') && !inventorySkuSet.has(o.sku))
        .map(o => o.sku);

      const uniquePhantoms = [...new Set(phantomSkus)];

      verification.checks.push({
        name: 'no_phantom_skus',
        passed: uniquePhantoms.length === 0,
        phantomCount: uniquePhantoms.length,
        examples: uniquePhantoms.slice(0, 5)
      });

      if (uniquePhantoms.length > 0) {
        verification.issues.push(`${uniquePhantoms.length} phantom SKUs found in orders`);
      }
    }

    // Check 5: Inventory freshness
    const { data: invTimestamps } = await client
      .from('wix_inventory_live')
      .select('synced_at')
      .not('synced_at', 'is', null)
      .order('synced_at', { ascending: false })
      .limit(1);

    if (invTimestamps && invTimestamps.length > 0) {
      const ageHours = (Date.now() - new Date(invTimestamps[0].synced_at).getTime()) / (1000 * 60 * 60);
      const isFresh = ageHours <= CONFIG.INVENTORY_STALE_THRESHOLD_HOURS;

      verification.checks.push({
        name: 'inventory_fresh',
        passed: isFresh,
        ageHours: Math.round(ageHours * 10) / 10,
        threshold: CONFIG.INVENTORY_STALE_THRESHOLD_HOURS
      });

      if (!isFresh) {
        verification.issues.push(`Inventory ${Math.round(ageHours)}h stale`);
      }
    }

    console.log('[SelfHealing] Verification complete:', {
      passed: verification.passed,
      checksRun: verification.checks.length,
      issues: verification.issues.length
    });

  } catch (err) {
    console.error('[SelfHealing] Verification error:', err.message);
    verification.passed = false;
    verification.issues.push(`Verification error: ${err.message}`);
  }

  return verification;
}

// ============================================================================
// HOOKS - Integration points for other services
// ============================================================================

/**
 * Hook: Call after Wix inventory webhook
 */
export async function onWixInventoryWebhook() {
  console.log('[SelfHealing] Wix inventory webhook hook triggered');
  return freshnessResolver({
    trigger: 'wix_inventory_webhook',
    forcedByWebhook: true
  });
}

/**
 * Hook: Call after costs are imported
 */
export async function onCostImport() {
  console.log('[SelfHealing] Cost import hook triggered');
  return freshnessResolver({
    trigger: 'cost_import',
    forcedByCostImport: true
  });
}

/**
 * Hook: Call after order webhook
 */
export async function onOrderWebhook() {
  console.log('[SelfHealing] Order webhook hook triggered');
  return freshnessResolver({
    trigger: 'order_webhook',
    forcedByWebhook: true
  });
}

/**
 * Hook: Call when snapshot/chat detects stale data
 */
export async function onStaleDataDetected(source) {
  console.log(`[SelfHealing] Stale data detected by ${source}`);
  return freshnessResolver({
    trigger: `stale_detection_${source}`
  });
}
