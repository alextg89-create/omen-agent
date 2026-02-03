/**
 * Temporal Intelligence Analyzer
 *
 * Analyzes order velocity, depletion rates, and generates actionable insights
 * Uses REAL Supabase order data - NO fake metrics
 *
 * Core Principle: OMEN OBSERVES, NEVER GUESSES
 */

import { queryOrderEvents, queryLineItemOrders } from '../db/supabaseQueries.js';
import { calculateDateRange } from '../utils/dateCalculations.js';

/**
 * Analyze inventory movement from real order data
 *
 * @param {Array} currentInventory - Current inventory state
 * @param {string} timeframe - 'daily' or 'weekly'
 * @returns {Object} Analysis with actionable insights
 */
export async function analyzeInventoryVelocity(currentInventory, timeframe = 'weekly') {
  const dateRange = calculateDateRange(timeframe, null);
  const startDate = dateRange.startDate;
  const endDate = dateRange.endDate;

  console.log(`[TemporalAnalyzer] Analyzing orders from ${startDate} to ${endDate}`);

  // STEP 1: Check orders_agg to determine if orders exist in timeframe
  let orderAggResult;
  try {
    orderAggResult = await queryOrderEvents(startDate, endDate);
  } catch (err) {
    console.error('[TemporalAnalyzer] ❌ orders_agg query failed:', err.message);
    return {
      ok: false,
      error: `Orders query failed: ${err.message}`,
      insights: [],
      hasData: false
    };
  }

    // 👇 STEP 1 DEBUG LOG GOES HERE
    console.log('[TemporalAnalyzer] orderAggResult debug:', {
    ok: orderAggResult?.ok,
    length: orderAggResult?.data?.length,
    sample: orderAggResult?.data?.[0],
   });

  const orderCount = orderAggResult.data?.length || 0;
  console.log(`[TemporalAnalyzer] Found ${orderCount} orders in orders_agg`);

  if (orderCount === 0) {
    return {
      ok: true,
      hasData: false,
      orderCount: 0,
      insights: [],
      message: 'No orders in timeframe'
    };
  }

  // STEP 2: Query line-item data for SKU velocity (optional)
  let orders = [];
  try {
    const lineItemResult = await queryLineItemOrders(startDate, endDate);
    orders = lineItemResult.data || [];
  } catch (err) {
    console.warn('[TemporalAnalyzer] Line-item query failed, velocity analysis skipped');
  }

  console.log(`[TemporalAnalyzer] Found ${orders.length} line items for velocity analysis`);

  // Aggregate orders by SKU
  const ordersBySkU = aggregateOrdersBySKU(orders);

  // Calculate velocity metrics
  const velocityMetrics = calculateVelocityMetrics(ordersBySkU, currentInventory, dateRange);

  // Generate actionable insights
  const insights = generateActionableInsights(velocityMetrics, currentInventory);

  return {
    ok: true,
    hasData: true,
    timeframe,
    dateRange,
    orderCount,
    lineItemCount: orders.length,
    uniqueSKUs: ordersBySkU.size,
    insights,
    velocityMetrics
  };
}

/**
 * Aggregate orders by SKU with quantity totals
 */
function aggregateOrdersBySKU(orders) {
  const skuMap = new Map();

  for (const order of orders) {
    // Handle different possible field names from Supabase
    const sku = order.sku || order.product_sku || order.item_sku;
    const unit = order.unit || order.product_unit || 'each';
    const quantity = Number(order.quantity) || 1;
    const orderDate = new Date(order.created_at || order.order_date || order.timestamp);

    if (!sku) continue;

    const key = `${sku}|${unit}`;

    if (!skuMap.has(key)) {
      skuMap.set(key, {
        sku,
        unit,
        totalSold: 0,
        orderCount: 0,
        firstOrder: orderDate,
        lastOrder: orderDate,
        orders: []
      });
    }

    const skuData = skuMap.get(key);
    skuData.totalSold += quantity;
    skuData.orderCount += 1;
    skuData.orders.push({ quantity, date: orderDate });

    if (orderDate < skuData.firstOrder) skuData.firstOrder = orderDate;
    if (orderDate > skuData.lastOrder) skuData.lastOrder = orderDate;
  }

  return skuMap;
}

/**
 * Calculate velocity metrics for each SKU
 */
function calculateVelocityMetrics(ordersBySkU, currentInventory, dateRange) {
  const metrics = [];
  const daysInPeriod = Math.max(1, Math.ceil((new Date(dateRange.endDate) - new Date(dateRange.startDate)) / (1000 * 60 * 60 * 24)));

  for (const [key, orderData] of ordersBySkU) {
    // Find matching inventory item by SKU only (unit matching is unreliable from Wix)
    const inventoryItem = currentInventory.find(item => item.sku === orderData.sku);

    if (!inventoryItem) {
      console.warn(`[TemporalAnalyzer] SKU ${orderData.sku} has orders but not in inventory`);
      continue;
    }

    const currentStock = inventoryItem.quantity || 0;
    const dailyVelocity = orderData.totalSold / daysInPeriod;
    const daysUntilStockout = currentStock > 0 && dailyVelocity > 0
      ? Math.ceil(currentStock / dailyVelocity)
      : null;

    metrics.push({
      sku: orderData.sku,
      unit: orderData.unit,
      name: inventoryItem.name || inventoryItem.product || orderData.sku,
      currentStock,
      totalSold: orderData.totalSold,
      orderCount: orderData.orderCount,
      dailyVelocity: parseFloat(dailyVelocity.toFixed(2)),
      daysUntilStockout,
      margin: inventoryItem.pricing?.margin ?? null,  // NULL if missing - never fabricate
      totalRevenue: inventoryItem.pricing?.retail ? orderData.totalSold * inventoryItem.pricing.retail : null,  // NULL if no retail price
      isMoving: dailyVelocity > 0,
      isAccelerating: calculateAcceleration(orderData.orders, daysInPeriod)
    });
  }

  // Sort by velocity (fastest moving first)
  return metrics.sort((a, b) => b.dailyVelocity - a.dailyVelocity);
}

/**
 * Detect if velocity is accelerating or decelerating
 */
function calculateAcceleration(orders, periodDays) {
  if (orders.length < 2) return false;

  // Split orders into first half and second half
  const midpoint = Math.floor(orders.length / 2);
  const firstHalf = orders.slice(0, midpoint);
  const secondHalf = orders.slice(midpoint);

  const firstAvg = firstHalf.reduce((sum, o) => sum + o.quantity, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, o) => sum + o.quantity, 0) / secondHalf.length;

  // Accelerating if second half average is > 20% higher than first half
  return secondAvg > firstAvg * 1.2;
}

/**
 * Generate actionable business insights
 */
function generateActionableInsights(velocityMetrics, currentInventory) {
  const insights = [];

  // Identify items that didn't sell at all
  const unmovedSKUs = currentInventory.filter(item => {
    return !velocityMetrics.some(m => m.sku === item.sku && m.unit === (item.unit || 'each'));
  });

  for (const metric of velocityMetrics) {
    // INSIGHT 1: Imminent stockout
    if (metric.daysUntilStockout !== null && metric.daysUntilStockout <= 7) {
      insights.push({
        type: 'URGENT_RESTOCK',
        priority: 'HIGH',
        sku: metric.sku,
        unit: metric.unit,
        name: metric.name,
        message: `${metric.name} will stock out in ${metric.daysUntilStockout} days`,
        details: `Currently ${metric.currentStock} in stock, selling ${metric.dailyVelocity}/day`,
        action: 'Reorder immediately or promote substitute',
        data: {
          currentStock: metric.currentStock,
          dailyVelocity: metric.dailyVelocity,
          daysUntilStockout: metric.daysUntilStockout
        }
      });
    }

    // INSIGHT 2: Fast seller (top 20% velocity)
    const topVelocityThreshold = velocityMetrics.length > 5
      ? velocityMetrics[Math.floor(velocityMetrics.length * 0.2)].dailyVelocity
      : metric.dailyVelocity;

    if (metric.dailyVelocity >= topVelocityThreshold && metric.dailyVelocity > 0.5) {
      const comparison = velocityMetrics.length > 1
        ? `${(metric.dailyVelocity / (velocityMetrics.reduce((sum, m) => sum + m.dailyVelocity, 0) / velocityMetrics.length)).toFixed(1)}x faster than average`
        : 'top seller';

      insights.push({
        type: 'HIGH_VELOCITY',
        priority: 'MEDIUM',
        sku: metric.sku,
        unit: metric.unit,
        name: metric.name,
        message: `${metric.name} is selling ${comparison}`,
        details: `Sold ${metric.totalSold} units in period (${metric.dailyVelocity}/day)`,
        action: metric.currentStock < metric.dailyVelocity * 14
          ? 'Ensure adequate stock - consider increased orders'
          : 'Monitor for sustained demand',
        data: {
          totalSold: metric.totalSold,
          dailyVelocity: metric.dailyVelocity,
          orderCount: metric.orderCount
        }
      });
    }

    // INSIGHT 3: Accelerating demand
    if (metric.isAccelerating) {
      insights.push({
        type: 'ACCELERATING_DEMAND',
        priority: 'MEDIUM',
        sku: metric.sku,
        unit: metric.unit,
        name: metric.name,
        message: `${metric.name} demand is accelerating`,
        details: `Order velocity increased significantly in recent period`,
        action: 'Consider increasing stock levels or promotional push',
        data: {
          totalSold: metric.totalSold,
          dailyVelocity: metric.dailyVelocity
        }
      });
    }

    // INSIGHT 4: Low stock on profitable item (only if margin is known)
    if (metric.margin !== null && metric.margin > 40 && metric.currentStock < metric.dailyVelocity * 7 && metric.dailyVelocity > 0.2) {
      insights.push({
        type: 'LOW_STOCK_HIGH_MARGIN',
        priority: 'MEDIUM',
        sku: metric.sku,
        unit: metric.unit,
        name: metric.name,
        message: `${metric.name} is low stock with ${metric.margin}% margin`,
        details: `Only ${metric.currentStock} units left, ${metric.daysUntilStockout} days until stockout`,
        action: 'Prioritize restocking - high profit opportunity',
        data: {
          currentStock: metric.currentStock,
          margin: metric.margin,  // Known to be non-null here
          dailyVelocity: metric.dailyVelocity
        }
      });
    }
  }

  // INSIGHT 5: Dead stock (has inventory but no sales)
  for (const item of unmovedSKUs.slice(0, 5)) { // Limit to top 5
    if ((item.quantity || 0) > 5) { // Only report significant quantities
      insights.push({
        type: 'NO_MOVEMENT',
        priority: 'LOW',
        sku: item.sku,
        unit: item.unit || 'each',
        name: item.name || item.product || item.sku,
        message: `${item.name || item.sku} had zero sales this period`,
        details: `${item.quantity} units in stock, tying up capital`,
        action: (item.pricing?.margin !== null && item.pricing?.margin > 30)
          ? 'Consider discount to move inventory'
          : 'Review if item should be discontinued',
        data: {
          currentStock: item.quantity,
          margin: item.pricing?.margin ?? null  // NULL if missing - never fabricate
        }
      });
    }
  }

  // Sort insights by priority
  const priorityOrder = { HIGH: 1, MEDIUM: 2, LOW: 3 };
  return insights.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

/**
 * Format insights for email/chat display
 */
export function formatInsightsForDisplay(insights) {
  if (!insights || insights.length === 0) {
    return 'No actionable insights at this time. Continue monitoring inventory movement.';
  }

  let output = '';

  const high = insights.filter(i => i.priority === 'HIGH');
  const medium = insights.filter(i => i.priority === 'MEDIUM');
  const low = insights.filter(i => i.priority === 'LOW');

  if (high.length > 0) {
    output += '🚨 URGENT ACTIONS NEEDED:\n\n';
    high.forEach((insight, i) => {
      output += `${i + 1}. ${insight.message}\n`;
      output += `   ${insight.details}\n`;
      output += `   → ${insight.action}\n\n`;
    });
  }

  if (medium.length > 0) {
    output += '\n📊 OPPORTUNITIES TO CONSIDER:\n\n';
    medium.forEach((insight, i) => {
      output += `${i + 1}. ${insight.message}\n`;
      output += `   ${insight.details}\n`;
      output += `   → ${insight.action}\n\n`;
    });
  }

  if (low.length > 0) {
    output += '\n💡 OBSERVATIONS:\n\n';
    low.forEach((insight, i) => {
      output += `${i + 1}. ${insight.message}\n`;
      output += `   → ${insight.action}\n\n`;
    });
  }

  return output;
}
