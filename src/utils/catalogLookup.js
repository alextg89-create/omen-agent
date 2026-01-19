import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

/* =========================
   SHARED SUPABASE CLIENT
   ========================= */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Don't crash on startup if Supabase not configured - just log warning
let supabase = null;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('[CatalogLookup] Supabase not configured - catalog lookup disabled');
} else {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
}

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
  if (!supabase) return null; // Supabase not configured

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
