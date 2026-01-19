/**
 * Catalog Lookup - SKU resolution from inventory_live
 *
 * Uses the AUTHORITATIVE Supabase client from supabaseClient.js
 * No separate client initialization - single source of truth
 */

import { getSupabaseClient, isSupabaseAvailable } from '../db/supabaseClient.js';

/* =========================
   CATALOG LOOKUP
   ========================= */
/**
 * Resolve a canonical SKU from inventory_live
 *
 * @param {Object} params
 * @param {string} params.strain
 * @param {string} params.unit
 * @param {string|null} params.brand
 * @param {string|null} params.category
 *
 * @returns {string|null} canonical SKU
 */
export async function lookupCatalogSku({ strain, unit, brand, category }) {
  if (!strain || !unit) return null;
  if (!isSupabaseAvailable()) return null; // Supabase not configured

  const supabase = getSupabaseClient();
  let query = supabase
    .from('inventory_live')
    .select('sku')
    .eq('strain', strain)
    .eq('unit', unit);

  if (brand) {
    query = query.eq('brand', brand);
  }

  if (category) {
    query = query.eq('category', category);
  }

  const { data, error } = await query.limit(1).maybeSingle();

  if (error || !data) {
    return null;
  }

  return data.sku;
}
