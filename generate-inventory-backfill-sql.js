/**
 * Generate SQL to backfill inventory_live with unmatched order products
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { generateUnmatchedSku } from './src/utils/skuResolver.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function generateBackfillSQL() {
  console.log('-- =====================================================');
  console.log('-- INVENTORY BACKFILL SQL');
  console.log('-- Generated:', new Date().toISOString());
  console.log('-- =====================================================\n');

  // Get unmatched orders with aggregated data
  const { data: orders } = await supabase.from('orders').select('*');
  const { data: inventory } = await supabase.from('inventory_live').select('sku');

  const invSkus = new Set(inventory.map(i => i.sku));

  // Find unmatched and aggregate by strain
  const unmatchedByStrain = new Map();

  for (const o of orders) {
    if (invSkus.has(o.sku)) continue; // Already matched

    const key = o.strain;
    if (!unmatchedByStrain.has(key)) {
      unmatchedByStrain.set(key, {
        strain: o.strain,
        unit: o.unit,
        totalQuantity: 0,
        maxPrice: 0,
        orderCount: 0
      });
    }

    const item = unmatchedByStrain.get(key);
    item.totalQuantity += o.quantity || 1;
    item.maxPrice = Math.max(item.maxPrice, o.price_per_unit || 0);
    item.orderCount++;
  }

  // Sort by order count (most popular first)
  const sorted = [...unmatchedByStrain.values()].sort((a, b) => b.orderCount - a.orderCount);

  console.log('-- =====================================================');
  console.log('-- 1) SELECT: List missing products from orders');
  console.log('-- =====================================================');
  console.log(`
SELECT
  o.strain,
  o.unit,
  COUNT(*) as order_count,
  SUM(o.quantity) as total_units_sold,
  MAX(o.price_per_unit) as max_price,
  MIN(o.order_date) as first_order,
  MAX(o.order_date) as last_order
FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_live i
  WHERE i.sku = o.sku
)
GROUP BY o.strain, o.unit
ORDER BY order_count DESC;
`);

  console.log('\n-- =====================================================');
  console.log('-- 2) BATCH INSERT: Add all missing products');
  console.log('-- =====================================================');
  console.log(`
-- SAFE INSERT: Only adds rows that don't already exist
-- Uses UNMATCHED- prefix to clearly mark auto-generated SKUs

INSERT INTO inventory_live (
  sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source
)
SELECT
  'UNMATCHED-' || UPPER(REGEXP_REPLACE(o.strain, '[^a-zA-Z0-9]', '', 'g')) as sku,
  'UNCATEGORIZED' as category,
  'UNKNOWN' as brand,
  o.strain as product_name,
  o.strain as strain,
  COALESCE(o.unit, 'unit') as unit,
  0 as quantity,
  NULL as cost,
  MAX(o.price_per_unit) as retail_price,
  'order_backfill' as source
FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_live i
  WHERE i.sku = o.sku
)
GROUP BY o.strain, o.unit
ON CONFLICT (sku) DO NOTHING;
`);

  console.log('\n-- =====================================================');
  console.log('-- 3) VERIFICATION QUERIES');
  console.log('-- =====================================================');
  console.log(`
-- Check match rate after backfill
SELECT
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM inventory_live i WHERE i.sku = o.sku)) AS matched,
  COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM inventory_live i WHERE i.sku = o.sku)) AS unmatched,
  COUNT(*) AS total
FROM orders o;

-- List newly added inventory items
SELECT i.sku, i.strain, i.unit, i.retail_price, i.source
FROM inventory_live i
WHERE i.source = 'order_backfill'
ORDER BY i.strain;
`);

  console.log('\n-- =====================================================');
  console.log('-- 4) INDIVIDUAL INSERT STATEMENTS');
  console.log('-- (Run these if batch insert fails)');
  console.log('-- =====================================================\n');

  for (const item of sorted) {
    const safeSku = generateUnmatchedSku(item.strain);
    const safeStrain = item.strain.replace(/'/g, "''");
    const price = item.maxPrice > 0 ? item.maxPrice : 'NULL';

    console.log(`-- ${item.strain} (ordered ${item.orderCount}x, ${item.totalQuantity} units, max price $${item.maxPrice})`);
    console.log(`INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)`);
    console.log(`SELECT '${safeSku}', 'UNCATEGORIZED', 'UNKNOWN', '${safeStrain}', '${safeStrain}', 'unit', 0, NULL, ${price}, 'order_backfill'`);
    console.log(`WHERE NOT EXISTS (SELECT 1 FROM inventory_live i WHERE i.sku = '${safeSku}');\n`);
  }

  console.log('\n-- =====================================================');
  console.log('-- 5) UPDATE ORDERS TO USE NEW SKUS');
  console.log('-- (Run after inventory backfill)');
  console.log('-- =====================================================\n');

  for (const item of sorted) {
    const safeSku = generateUnmatchedSku(item.strain);
    const safeStrain = item.strain.replace(/'/g, "''");

    console.log(`UPDATE orders o SET sku = '${safeSku}' WHERE o.strain = '${safeStrain}' AND o.sku LIKE '%_unit';`);
  }

  console.log('\n-- =====================================================');
  console.log('-- SUMMARY');
  console.log('-- =====================================================');
  console.log(`-- Total unmatched strains: ${sorted.length}`);
  console.log(`-- Total unmatched order rows: ${sorted.reduce((sum, i) => sum + i.orderCount, 0)}`);
}

generateBackfillSQL()
  .then(() => console.log('\n-- Done'))
  .catch(console.error);
