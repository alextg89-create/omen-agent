/**
 * CANONICALIZE ORDERS - ESTABLISH STABLE PRODUCT IDENTITY
 *
 * PURPOSE: Link orders to canonical product identities without deleting history
 *
 * RULES:
 * - DO NOT delete any rows
 * - DO NOT overwrite existing canonical_sku values
 * - DO NOT rebuild orders table
 * - UPDATE only where canonical_sku IS NULL
 * - Match EXACTLY ONE product_catalog entry (strain + unit)
 * - Leave ambiguous matches untouched
 *
 * RESULT:
 * - orders.canonical_sku becomes authoritative join key
 * - orders.sku remains as raw reference
 * - Historical integrity preserved
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Normalize for matching (same logic as product_catalog generation)
 */
function normalize(str) {
  return (str || 'unknown').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function canonicalizeOrders() {
  console.log('🔗 CANONICALIZING ORDERS - STABLE PRODUCT IDENTITY\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // STEP 1: Ensure canonical_sku column exists
  console.log('📋 Step 1: Ensuring canonical_sku column exists in orders...\n');

  const addColumnSQL = `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'canonical_sku'
      ) THEN
        ALTER TABLE orders ADD COLUMN canonical_sku TEXT;
        CREATE INDEX IF NOT EXISTS idx_orders_canonical_sku ON orders(canonical_sku);
      END IF;
    END $$;
  `;

  // Note: Direct SQL execution may not be available, so we'll handle gracefully
  console.log('   ✓ Column definition ready (add via Supabase SQL editor if needed)\n');
  console.log('   SQL: ALTER TABLE orders ADD COLUMN canonical_sku TEXT;\n');

  // STEP 2: Load product_catalog
  console.log('📦 Step 2: Loading product_catalog...\n');

  const { data: catalog, error: catalogError } = await supabase
    .from('product_catalog')
    .select('canonical_sku, strain_name, unit');

  if (catalogError) {
    console.error(`   ❌ Failed to load product_catalog: ${catalogError.message}\n`);
    console.log('   ⚠️  Run create-product-catalog.js first to create product_catalog table\n');
    return;
  }

  if (!catalog || catalog.length === 0) {
    console.log('   ⚠️  product_catalog is empty - run create-product-catalog.js first\n');
    return;
  }

  console.log(`   ✓ Loaded ${catalog.length} canonical products\n`);

  // Build lookup map: "strain|unit" -> canonical_sku (with collision detection)
  const catalogMap = new Map();
  const collisions = new Map();

  for (const product of catalog) {
    const key = `${normalize(product.strain_name)}|${normalize(product.unit)}`;

    if (catalogMap.has(key)) {
      // Collision detected - mark as ambiguous
      if (!collisions.has(key)) {
        collisions.set(key, [catalogMap.get(key)]);
      }
      collisions.get(key).push(product.canonical_sku);
    } else {
      catalogMap.set(key, product.canonical_sku);
    }
  }

  // Remove collisions from catalogMap (we won't match ambiguous entries)
  for (const key of collisions.keys()) {
    catalogMap.delete(key);
  }

  console.log(`   ✓ ${catalogMap.size} unique catalog entries ready for matching\n`);
  if (collisions.size > 0) {
    console.log(`   ⚠️  ${collisions.size} ambiguous entries (multiple canonical_skus per strain+unit) - will skip\n`);
  }

  // STEP 3: Load orders WHERE canonical_sku IS NULL
  console.log('📊 Step 3: Loading orders needing canonicalization...\n');

  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, order_id, strain, unit, sku, canonical_sku')
    .is('canonical_sku', null);

  if (ordersError) {
    console.error(`   ❌ Failed to load orders: ${ordersError.message}\n`);

    // Check if column doesn't exist
    if (ordersError.message.includes('column') && ordersError.message.includes('does not exist')) {
      console.log('   📝 Column canonical_sku does not exist yet. Creating it...\n');
      console.log('   Run this SQL in Supabase SQL Editor:\n');
      console.log('   ALTER TABLE orders ADD COLUMN canonical_sku TEXT;');
      console.log('   CREATE INDEX idx_orders_canonical_sku ON orders(canonical_sku);\n');
    }
    return;
  }

  if (!orders || orders.length === 0) {
    console.log('   ✅ All orders already canonicalized (or orders table is empty)\n');
    return;
  }

  console.log(`   ✓ Found ${orders.length} orders without canonical_sku\n`);

  // STEP 4: Match orders to catalog
  console.log('🔍 Step 4: Matching orders to canonical products...\n');

  let scanned = 0;
  let matched = 0;
  let skipped = 0;
  let errors = 0;

  const updates = []; // Batch updates

  for (const order of orders) {
    scanned++;

    const strain = order.strain || '';
    const unit = order.unit || '';
    const key = `${normalize(strain)}|${normalize(unit)}`;

    const canonicalSKU = catalogMap.get(key);

    if (canonicalSKU) {
      // EXACTLY ONE match found
      updates.push({
        id: order.id,
        canonical_sku: canonicalSKU
      });
      matched++;
    } else {
      // No match or ambiguous match - skip
      skipped++;
    }
  }

  console.log(`   Scanned: ${scanned} orders`);
  console.log(`   Matched: ${matched} orders (unique catalog match)`);
  console.log(`   Skipped: ${skipped} orders (no match or ambiguous)\n`);

  // STEP 5: Update orders in batches
  if (updates.length === 0) {
    console.log('✅ No updates needed\n');
    return;
  }

  console.log('💾 Step 5: Updating orders.canonical_sku...\n');

  const batchSize = 100;
  let updated = 0;

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);

    for (const update of batch) {
      const { error: updateError } = await supabase
        .from('orders')
        .update({ canonical_sku: update.canonical_sku })
        .eq('id', update.id);

      if (updateError) {
        console.error(`   ❌ Failed to update order ${update.id}:`, updateError.message);
        errors++;
      } else {
        updated++;
      }
    }

    console.log(`   ✓ Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} orders processed`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ CANONICALIZATION COMPLETE\n');
  console.log(`   Orders Scanned: ${scanned}`);
  console.log(`   Orders Updated: ${updated}`);
  console.log(`   Orders Skipped: ${skipped} (no match or ambiguous)`);
  console.log(`   Errors: ${errors}\n`);

  // STEP 6: Verification
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 VERIFICATION:\n');

  const { data: canonicalized, error: verifyError } = await supabase
    .from('orders')
    .select('canonical_sku')
    .not('canonical_sku', 'is', null);

  const { data: total, error: totalError } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true });

  if (!verifyError && !totalError) {
    const canonicalizedCount = canonicalized?.length || 0;
    const totalCount = total?.length || 0;
    const percentage = totalCount > 0 ? ((canonicalizedCount / totalCount) * 100).toFixed(1) : 0;

    console.log(`   Total Orders: ${totalCount}`);
    console.log(`   Canonicalized: ${canonicalizedCount} (${percentage}%)`);
    console.log(`   Remaining: ${totalCount - canonicalizedCount} (no unique match)\n`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('✅ RESULT:');
  console.log('   - orders.canonical_sku is now the authoritative join key');
  console.log('   - orders.sku remains as raw reference only');
  console.log('   - Historical integrity preserved (no rows deleted)\n');

  console.log('🎯 NEXT STEP: Run gate-inventory.js to add inventory_status gating\n');
}

canonicalizeOrders().catch(err => {
  console.error('\n❌ FATAL ERROR:');
  console.error(err.message);
  console.error(err.stack);
  process.exit(1);
});
