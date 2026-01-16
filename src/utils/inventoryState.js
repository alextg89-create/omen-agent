/**
 * OMEN INVENTORY STATE ENGINE
 *
 * Inventory State Application & System Readiness
 *
 * PURPOSE:
 * - Apply order decrements to inventory safely
 * - Prevent negative inventory
 * - Provide read-only inventory status for web app
 * - Maintain auditability of all changes
 *
 * CONSTRAINTS:
 * - No schema changes
 * - No new tables
 * - No async background jobs
 * - No AI logic
 * - No business policy inference
 *
 * SOURCE OF TRUTH: inventory_live (sole inventory table)
 *
 * DEPENDS ON: inventoryResolver.js (parseLineItem, resolveInventoryItem)
 */

import {
  parseLineItem,
  resolveInventoryItem,
  resolveOrderLineItems
} from './inventoryResolver.js';

// ============================================================================
// CONFIGURATION (Thresholds - can be tuned externally)
// ============================================================================

const CONFIG = {
  LOW_STOCK_THRESHOLD: 5,     // Below this = low stock warning
  CRITICAL_STOCK_THRESHOLD: 2, // Below this = critical/urgent
  OUT_OF_STOCK_THRESHOLD: 0    // Zero or below = out of stock
};

// ============================================================================
// INVENTORY STATE APPLICATION
// ============================================================================

/**
 * Apply an order to inventory, decrementing quantities safely
 *
 * PURE FUNCTION: Does not mutate input arrays, returns new state
 *
 * Safety guarantees:
 * - Never produces negative inventory
 * - Collects all changes for auditability
 * - Reports unresolvable line items separately
 *
 * @param {Object} order - Order object containing lineItems array
 * @param {Array} inventoryRows - Current inventory_live rows (will NOT be mutated)
 *
 * @returns {Object} Application result with changes and new state
 *
 * @example
 * const result = applyOrderToInventory(order, inventory);
 * // Returns:
 * // {
 * //   success: true,
 * //   appliedChanges: [
 * //     { sku: "ABC", previousQty: 10, soldQty: 2, newQty: 8 }
 * //   ],
 * //   skippedItems: [],
 * //   newInventoryState: [ ... ],  // Cloned inventory with updates
 * //   audit: { ... }
 * // }
 */
export function applyOrderToInventory(order, inventoryRows) {
  // Validate inputs
  if (!order || typeof order !== 'object') {
    throw new Error('applyOrderToInventory: Invalid order - expected object');
  }

  if (!Array.isArray(inventoryRows)) {
    throw new Error('applyOrderToInventory: Invalid inventoryRows - expected array');
  }

  const lineItems = order.lineItems || order.line_items || [];

  if (lineItems.length === 0) {
    return {
      success: true,
      appliedChanges: [],
      skippedItems: [],
      newInventoryState: inventoryRows, // No changes
      audit: {
        orderId: order.id || order.order_id || 'unknown',
        processedAt: new Date().toISOString(),
        totalItems: 0,
        applied: 0,
        skipped: 0
      }
    };
  }

  // Clone inventory to avoid mutation
  const inventoryClone = inventoryRows.map(row => ({ ...row }));

  // Build SKU index for fast updates
  const inventoryBySku = new Map();
  for (const row of inventoryClone) {
    inventoryBySku.set(row.sku, row);
  }

  // Resolve all line items
  const resolution = resolveOrderLineItems(lineItems, inventoryClone);

  const appliedChanges = [];
  const skippedItems = [];

  // Process resolved items
  for (const item of resolution.resolved) {
    const { inventoryItem, quantity } = item;
    const row = inventoryBySku.get(inventoryItem.sku);

    if (!row) {
      // Shouldn't happen if resolution worked, but handle gracefully
      skippedItems.push({
        item: item.parsedItem,
        reason: 'Inventory row not found after resolution',
        error: 'INVENTORY_ROW_MISSING'
      });
      continue;
    }

    const previousQty = row.quantity || 0;
    const soldQty = quantity;

    // SAFETY: Prevent negative inventory
    if (previousQty < soldQty) {
      // =========================================================================
      // EXTENSION POINT: Alert trigger for oversell
      // =========================================================================
      // Future: This condition could trigger:
      // - alertSystem.trigger('OVERSELL_ATTEMPTED', { sku, previousQty, soldQty })
      // - agentQueue.enqueue('investigate_oversell', { sku, order })

      skippedItems.push({
        item: item.parsedItem,
        sku: row.sku,
        previousQty,
        attemptedSoldQty: soldQty,
        reason: `Insufficient inventory: have ${previousQty}, need ${soldQty}`,
        error: 'INSUFFICIENT_INVENTORY'
      });
      continue;
    }

    // Apply the decrement
    const newQty = previousQty - soldQty;
    row.quantity = newQty;

    appliedChanges.push({
      sku: row.sku,
      strain: row.strain || row.product_name,
      unit: row.unit,
      previousQty,
      soldQty,
      newQty,

      // =========================================================================
      // EXTENSION POINT: Forecasting hooks
      // =========================================================================
      // Future: This change could feed into:
      // - forecastEngine.recordSale({ sku, soldQty, timestamp })
      // - velocityTracker.update({ sku, quantity: soldQty })
      _changeMetadata: {
        appliedAt: new Date().toISOString(),
        // Future: forecastImpact, velocityDelta, restockEta
      }
    });
  }

  // Collect unresolved items
  for (const item of resolution.unresolved) {
    skippedItems.push({
      item: item.parsedItem,
      reason: item.error,
      error: 'RESOLUTION_FAILED',
      rawLineItem: item.rawLineItem
    });
  }

  const success = skippedItems.length === 0;

  return {
    success,
    appliedChanges,
    skippedItems,
    newInventoryState: inventoryClone,

    audit: {
      orderId: order.id || order.order_id || 'unknown',
      processedAt: new Date().toISOString(),
      totalItems: lineItems.length,
      applied: appliedChanges.length,
      skipped: skippedItems.length,
      totalDecremented: appliedChanges.reduce((sum, c) => sum + c.soldQty, 0)
    },

    // =========================================================================
    // EXTENSION POINT: Order-level analytics
    // =========================================================================
    // Future: This could include:
    // - orderValue, customerSegment, channelSource
    // - inventoryHealthAfter: overall health score post-order
    _applicationMetadata: {
      version: '1.0.0'
    }
  };
}

// ============================================================================
// ORDER-SYNC LOOP INTEGRATION
// ============================================================================

/**
 * Process multiple orders in sequence, updating inventory state
 *
 * This is how applyOrderToInventory integrates into a batch sync job
 *
 * @param {Array} orders - Array of order objects
 * @param {Array} initialInventory - Starting inventory state
 *
 * @returns {Object} Batch processing result
 */
export function processOrderBatch(orders, initialInventory) {
  if (!Array.isArray(orders)) {
    throw new Error('processOrderBatch: Invalid orders - expected array');
  }

  let currentInventory = initialInventory;
  const results = [];
  let totalApplied = 0;
  let totalSkipped = 0;

  for (const order of orders) {
    try {
      const result = applyOrderToInventory(order, currentInventory);

      // Update inventory state for next iteration
      currentInventory = result.newInventoryState;

      results.push({
        orderId: result.audit.orderId,
        success: result.success,
        applied: result.audit.applied,
        skipped: result.audit.skipped
      });

      totalApplied += result.audit.applied;
      totalSkipped += result.audit.skipped;

    } catch (error) {
      results.push({
        orderId: order.id || order.order_id || 'unknown',
        success: false,
        error: error.message
      });
      totalSkipped += (order.lineItems || order.line_items || []).length;
    }
  }

  return {
    ordersProcessed: orders.length,
    totalApplied,
    totalSkipped,
    finalInventory: currentInventory,
    results,

    // =========================================================================
    // EXTENSION POINT: Batch-level alerting
    // =========================================================================
    // Future: After batch processing, trigger alerts:
    // - if (lowStockItems.length > 0) alertSystem.trigger('BATCH_LOW_STOCK', lowStockItems)
    // - if (totalSkipped > threshold) alertSystem.trigger('HIGH_SKIP_RATE', { rate })
    _batchMetadata: {
      processedAt: new Date().toISOString(),
      version: '1.0.0'
    }
  };
}

// ============================================================================
// VERIFICATION
// ============================================================================

/**
 * Verify inventory changes match expected totals
 *
 * Confirms:
 * - Total decrements equal total sold
 * - No inventory row went negative
 *
 * @param {Array} appliedChanges - Array of change records from applyOrderToInventory
 * @param {Array} newInventoryState - Updated inventory array
 *
 * @returns {Object} Verification result
 */
export function verifyInventoryChanges(appliedChanges, newInventoryState) {
  const errors = [];

  // Check 1: Calculate total decremented
  const totalDecremented = appliedChanges.reduce((sum, change) => {
    return sum + change.soldQty;
  }, 0);

  // Check 2: Verify no negative inventory
  const negativeItems = [];
  for (const row of newInventoryState) {
    if (row.quantity < 0) {
      negativeItems.push({
        sku: row.sku,
        strain: row.strain || row.product_name,
        quantity: row.quantity
      });
    }
  }

  if (negativeItems.length > 0) {
    errors.push({
      type: 'NEGATIVE_INVENTORY',
      message: `${negativeItems.length} items have negative quantity`,
      items: negativeItems
    });
  }

  // Check 3: Verify change records are consistent
  for (const change of appliedChanges) {
    if (change.previousQty - change.soldQty !== change.newQty) {
      errors.push({
        type: 'CALCULATION_MISMATCH',
        message: `SKU ${change.sku}: ${change.previousQty} - ${change.soldQty} != ${change.newQty}`,
        change
      });
    }
  }

  return {
    valid: errors.length === 0,
    totalDecremented,
    errors,
    summary: {
      changesVerified: appliedChanges.length,
      inventoryRowsChecked: newInventoryState.length,
      negativeCount: negativeItems.length
    }
  };
}

// ============================================================================
// READ-ONLY INVENTORY STATUS (Web App Usage)
// ============================================================================

/**
 * Get inventory status for a single item (read-only)
 *
 * Returns:
 * - current quantity
 * - low-stock flag
 * - out-of-stock flag
 *
 * @param {Object} inventoryRow - Single inventory_live row
 *
 * @returns {Object} Status object for web app display
 */
export function getItemStatus(inventoryRow) {
  if (!inventoryRow || typeof inventoryRow !== 'object') {
    return {
      sku: null,
      strain: null,
      unit: null,
      quantity: 0,
      isOutOfStock: true,
      isLowStock: true,
      isCriticalStock: true,
      status: 'UNKNOWN'
    };
  }

  const quantity = inventoryRow.quantity || 0;

  const isOutOfStock = quantity <= CONFIG.OUT_OF_STOCK_THRESHOLD;
  const isCriticalStock = quantity <= CONFIG.CRITICAL_STOCK_THRESHOLD && !isOutOfStock;
  const isLowStock = quantity <= CONFIG.LOW_STOCK_THRESHOLD && !isCriticalStock && !isOutOfStock;

  let status = 'IN_STOCK';
  if (isOutOfStock) status = 'OUT_OF_STOCK';
  else if (isCriticalStock) status = 'CRITICAL';
  else if (isLowStock) status = 'LOW_STOCK';

  return {
    sku: inventoryRow.sku,
    strain: inventoryRow.strain || inventoryRow.product_name,
    unit: inventoryRow.unit,
    quantity,
    isOutOfStock,
    isLowStock,
    isCriticalStock,
    status,

    // =========================================================================
    // EXTENSION POINT: Forecasting data for web app
    // =========================================================================
    // Future: This could include:
    // - daysUntilStockout: estimated days until zero
    // - reorderRecommendation: suggested restock quantity
    // - velocity: current sales velocity (units/day)
    _statusMetadata: {
      thresholds: { ...CONFIG },
      checkedAt: new Date().toISOString()
    }
  };
}

/**
 * Get inventory status for all items (read-only, web app usage)
 *
 * @param {Array} inventoryRows - Full inventory_live array
 *
 * @returns {Object} Complete inventory status for web app
 */
export function getInventoryStatus(inventoryRows) {
  if (!Array.isArray(inventoryRows)) {
    return {
      items: [],
      summary: {
        total: 0,
        inStock: 0,
        lowStock: 0,
        criticalStock: 0,
        outOfStock: 0
      },
      alerts: []
    };
  }

  const items = [];
  const alerts = [];

  let inStock = 0;
  let lowStock = 0;
  let criticalStock = 0;
  let outOfStock = 0;

  for (const row of inventoryRows) {
    const status = getItemStatus(row);
    items.push(status);

    // Count by status
    switch (status.status) {
      case 'IN_STOCK':
        inStock++;
        break;
      case 'LOW_STOCK':
        lowStock++;
        // =========================================================================
        // EXTENSION POINT: Alert triggers
        // =========================================================================
        // Future: alertQueue.push({ type: 'LOW_STOCK', sku: status.sku, quantity: status.quantity })
        break;
      case 'CRITICAL':
        criticalStock++;
        alerts.push({
          type: 'CRITICAL_STOCK',
          sku: status.sku,
          strain: status.strain,
          quantity: status.quantity,
          message: `${status.strain} is critically low (${status.quantity} remaining)`
        });
        break;
      case 'OUT_OF_STOCK':
        outOfStock++;
        alerts.push({
          type: 'OUT_OF_STOCK',
          sku: status.sku,
          strain: status.strain,
          quantity: 0,
          message: `${status.strain} is out of stock`
        });
        break;
    }
  }

  return {
    items,
    summary: {
      total: inventoryRows.length,
      inStock,
      lowStock,
      criticalStock,
      outOfStock
    },
    alerts,

    // =========================================================================
    // EXTENSION POINT: System health for OMEN agents
    // =========================================================================
    // Future: This could include:
    // - overallHealthScore: 0-100 inventory health
    // - reorderQueue: items needing restock, prioritized
    // - forecastedStockouts: items predicted to run out soon
    _inventoryMetadata: {
      generatedAt: new Date().toISOString(),
      version: '1.0.0'
    }
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  // Configuration
  CONFIG,

  // Core application
  applyOrderToInventory,
  processOrderBatch,

  // Verification
  verifyInventoryChanges,

  // Read-only status
  getItemStatus,
  getInventoryStatus
};
