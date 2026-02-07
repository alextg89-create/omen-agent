/**
 * DEPRECATED: applyPricing module
 *
 * This module loaded pricing from static JSON file (src/data/pricing.json)
 * which caused stale data issues.
 *
 * CURRENT AUTHORITY MODEL:
 * - Inventory: inventory_virtual (real-time, order-driven)
 * - Pricing: sku_profitability (retail, cost, margin)
 * - Costs: sku_costs (unit_cost)
 * - NO fallbacks, NO static files
 *
 * This file is disabled to prevent accidental usage.
 */

/**
 * Apply pricing - DEPRECATED
 *
 * @throws {Error} Always throws - operation not supported
 */
export function applyPricing(items = []) {
  throw new Error(
    'DEPRECATED: applyPricing is disabled. ' +
    'Pricing now comes from Supabase via src/data/supabaseAuthority.js. ' +
    'Static pricing.json is no longer used.'
  );
}

/**
 * Default export (required by server.js)
 */
export default applyPricing;
