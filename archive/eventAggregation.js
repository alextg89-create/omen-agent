/**
 * Event-to-State Aggregation Engine
 *
 * Derives inventory state and movement from Supabase order events
 *
 * Key Capabilities:
 * - Aggregate unitsSold per SKU from order events
 * - Compute quantityDelta over time
 * - Preserve OMEN's existing inventory snapshot format
 * - Never fabricate missing events
 */

import { queryOrderEvents, getSalesSummary } from '../db/supabaseQueries.js';
import { isSupabaseAvailable } from '../db/supabaseClient.js';

/**
 * Aggregate order events to compute sales volume
 *
 * @param {string} startDate - ISO date (YYYY-MM-DD)
 * @param {string} endDate - ISO date (YYYY-MM-DD)
 * @returns {Promise<{ok: boolean, aggregated?: object, error?: string}>}
 */
export async function aggregateOrderEvents(startDate, endDate) {
  if (!isSupabaseAvailable()) {
    return {
      ok: false,
      error: 'Supabase not available',
      aggregated: null
    };
  }

  const result = await queryOrderEvents(startDate, endDate);

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      aggregated: null
    };
  }

  const orders = result.data || [];

  // Aggregate by SKU + unit
  const aggregationMap = new Map();

  for (const order of orders) {
    const sku = order.sku || order.strain;
    const unit = order.unit;
    const quantity = Number(order.quantity) || 0;
    const orderDate = order.created_at;

    if (!sku || !unit || quantity <= 0) continue;

    const key = `${sku}|${unit}`;

    if (!aggregationMap.has(key)) {
      aggregationMap.set(key, {
        sku,
        unit,
        totalUnitsSold: 0,
        orderCount: 0,
        firstOrderDate: orderDate,
        lastOrderDate: orderDate,
        orders: []
      });
    }

    const entry = aggregationMap.get(key);
    entry.totalUnitsSold += quantity;
    entry.orderCount += 1;
    entry.lastOrderDate = orderDate;
    entry.orders.push({
      date: orderDate,
      quantity
    });
  }

  const aggregated = Array.from(aggregationMap.values());

  console.log(`[EventAggregation] Aggregated ${orders.length} orders into ${aggregated.length} SKU summaries`);

  return {
    ok: true,
    aggregated,
    dateRange: { startDate, endDate },
    totalOrders: orders.length,
    uniqueSkus: aggregated.length
  };
}

/**
 * Enrich inventory items with sales velocity data from Supabase
 *
 * Takes OMEN's inventory format and adds temporal fields:
 * - unitsSold (last N days)
 * - dailyVelocity
 * - daysUntilDepletion
 *
 * @param {array} inventory - Inventory items (OMEN format)
 * @param {number} daysSince - Number of days to aggregate (default: 30)
 * @returns {Promise<{ok: boolean, enriched?: array, error?: string}>}
 */
export async function enrichInventoryWithVelocity(inventory, daysSince = 30) {
  if (!isSupabaseAvailable()) {
    console.log('[EventAggregation] Supabase not available - returning inventory without velocity');
    return {
      ok: true,
      enriched: inventory.map(item => ({
        ...item,
        velocity: null,
        velocitySource: 'unavailable'
      }))
    };
  }

  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - daysSince * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  // Get aggregated sales data
  const aggregationResult = await aggregateOrderEvents(startDate, endDate);

  if (!aggregationResult.ok) {
    console.warn('[EventAggregation] Failed to aggregate events:', aggregationResult.error);
    return {
      ok: true,
      enriched: inventory.map(item => ({
        ...item,
        velocity: null,
        velocitySource: 'error'
      })),
      error: aggregationResult.error
    };
  }

  const salesMap = new Map();
  for (const sale of aggregationResult.aggregated) {
    const key = `${sale.sku}|${sale.unit}`;
    salesMap.set(key, sale);
  }

  // Enrich each inventory item
  const enriched = inventory.map(item => {
    const sku = item.strain || item.sku;
    const unit = item.unit;
    const currentQuantity = item.quantity || 0;
    const key = `${sku}|${unit}`;

    const salesData = salesMap.get(key);

    if (!salesData || salesData.totalUnitsSold === 0) {
      // No sales data - item has not moved
      return {
        ...item,
        velocity: {
          unitsSold: 0,
          dailyVelocity: 0,
          orderCount: 0,
          daysUntilDepletion: null,
          confidence: 'none'
        },
        velocitySource: 'supabase'
      };
    }

    // Calculate velocity
    const dailyVelocity = salesData.totalUnitsSold / daysSince;
    const daysUntilDepletion = dailyVelocity > 0
      ? Math.ceil(currentQuantity / dailyVelocity)
      : null;

    // Confidence based on order count
    let confidence = 'low';
    if (salesData.orderCount >= 10) confidence = 'high';
    else if (salesData.orderCount >= 5) confidence = 'medium';

    return {
      ...item,
      velocity: {
        unitsSold: salesData.totalUnitsSold,
        dailyVelocity: parseFloat(dailyVelocity.toFixed(2)),
        orderCount: salesData.orderCount,
        daysUntilDepletion,
        confidence,
        observationDays: daysSince,
        firstOrderDate: salesData.firstOrderDate,
        lastOrderDate: salesData.lastOrderDate
      },
      velocitySource: 'supabase'
    };
  });

  const itemsWithVelocity = enriched.filter(item => item.velocity && item.velocity.unitsSold > 0).length;

  console.log(`[EventAggregation] Enriched ${enriched.length} items, ${itemsWithVelocity} have velocity data`);

  return {
    ok: true,
    enriched,
    stats: {
      totalItems: enriched.length,
      itemsWithVelocity,
      itemsWithoutVelocity: enriched.length - itemsWithVelocity,
      dateRange: { startDate, endDate }
    }
  };
}

/**
 * Compute delta between current and previous snapshot
 *
 * @param {array} currentSnapshot - Current inventory state
 * @param {array} previousSnapshot - Previous inventory state
 * @returns {object} Delta analysis
 */
export function computeSnapshotDelta(currentSnapshot, previousSnapshot) {
  const deltaMap = new Map();

  // Index previous snapshot
  const previousMap = new Map();
  for (const item of previousSnapshot || []) {
    const key = `${item.strain || item.sku}|${item.unit}`;
    previousMap.set(key, item);
  }

  // Compute deltas
  for (const current of currentSnapshot) {
    const key = `${current.strain || current.sku}|${current.unit}`;
    const previous = previousMap.get(key);

    const currentQty = current.quantity || 0;
    const previousQty = previous?.quantity || 0;
    const quantityDelta = currentQty - previousQty;

    const currentVelocity = current.velocity?.dailyVelocity || 0;
    const previousVelocity = previous?.velocity?.dailyVelocity || 0;
    const velocityDelta = currentVelocity - previousVelocity;

    const velocityDeltaPercent = previousVelocity > 0
      ? ((velocityDelta / previousVelocity) * 100)
      : null;

    deltaMap.set(key, {
      sku: current.strain || current.sku,
      unit: current.unit,
      currentQuantity: currentQty,
      previousQuantity: previousQty,
      quantityDelta,
      quantityDeltaPercent: previousQty > 0 ? ((quantityDelta / previousQty) * 100) : null,
      currentVelocity,
      previousVelocity,
      velocityDelta,
      velocityDeltaPercent,
      hasAccelerated: velocityDeltaPercent !== null && velocityDeltaPercent > 20,
      hasDecelerated: velocityDeltaPercent !== null && velocityDeltaPercent < -20
    });
  }

  const deltas = Array.from(deltaMap.values());

  return {
    deltas,
    summary: {
      totalItems: deltas.length,
      accelerating: deltas.filter(d => d.hasAccelerated).length,
      decelerating: deltas.filter(d => d.hasDecelerated).length,
      depleting: deltas.filter(d => d.quantityDelta < 0).length,
      restocked: deltas.filter(d => d.quantityDelta > 0).length
    }
  };
}
