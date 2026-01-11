/**
 * DEPRECATED: applyPricing module
 *
 * This module loaded pricing from static JSON file (src/data/pricing.json)
 * which caused stale data issues.
 *
 * NEW AUTHORITY: src/data/supabaseAuthority.js
 * - Pricing now comes from Supabase pricing table
 * - Joined with inventory at query time
 * - NO static files, NO boot-time loading
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
