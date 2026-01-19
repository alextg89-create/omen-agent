/**
 * COMPLETE SKU BACKFILL
 *
 * Executes full backfill to achieve 100% SKU match rate:
 * 1. Insert missing products into inventory_live with UNMATCHED- SKUs
 * 2. Update orders to use UNMATCHED- SKUs for unmatched strains
 * 3. Verify 100% match rate
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { generateUnmatchedSku } from './src/utils/skuResolver.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing Supabase env vars');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function completeBackfill() {
  console.log('=== COMPLETE SKU BACKFILL ===\n');

  // Step 1: Get current state
  const { data: orders } = await supabase.from('orders').select('*');
  const { data: inventory } = await supabase.from('inventory_live').select('sku');

  const invSkus = new Set(inventory.map(i => i.sku));

  console.log('Orders:', orders.length);
  console.log('Inventory SKUs:', inventory.length);

  // Find unmatched orders grouped by strain
  const unmatchedByStrain = new Map();
  let matchedBefore = 0;
  let unmatchedBefore = 0;

  for (const o of orders) {
    if (invSkus.has(o.sku)) {
      matchedBefore++;
    } else {
      unmatchedBefore++;
      const key = o.strain;
      if (!unmatchedByStrain.has(key)) {
        unmatchedByStrain.set(key, {
          strain: o.strain,
          unit: o.unit,
          maxPrice: 0,
          orderIds: []
        });
      }
      const item = unmatchedByStrain.get(key);
      item.maxPrice = Math.max(item.maxPrice, o.price_per_unit || 0);
      item.orderIds.push(o.id);
    }
  }

  console.log(`\nBefore backfill: ${matchedBefore} matched, ${unmatchedBefore} unmatched`);
  console.log(`Match rate: ${((matchedBefore / orders.length) * 100).toFixed(1)}%`);
  console.log(`Unique unmatched strains: ${unmatchedByStrain.size}\n`);

  if (unmatchedByStrain.size === 0) {
    console.log('Already at 100% match rate!');
    return;
  }

  // Step 2: Insert missing products into inventory_live
  console.log('--- INSERTING MISSING PRODUCTS ---\n');

  let insertedCount = 0;
  let skippedCount = 0;

  for (const [strain, data] of unmatchedByStrain) {
    const canonicalSku = generateUnmatchedSku(strain);

    // Check if already exists
    const { data: existing } = await supabase
      .from('inventory_live')
      .select('sku')
      .eq('sku', canonicalSku)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log(`SKIP: ${canonicalSku} already exists`);
      skippedCount++;
    } else {
      const { error } = await supabase.from('inventory_live').insert({
        sku: canonicalSku,
        category: 'UNCATEGORIZED',
        brand: 'UNKNOWN',
        product_name: strain,
        strain: strain,
        unit: data.unit || 'unit',
        quantity: 0,
        cost: null,
        retail_price: data.maxPrice > 0 ? data.maxPrice : null,
        source: 'order_backfill'
      });

      if (error) {
        console.error(`ERROR inserting ${canonicalSku}:`, error.message);
      } else {
        console.log(`INSERTED: ${canonicalSku} (${strain})`);
        insertedCount++;
      }
    }
  }

  console.log(`\nInserted: ${insertedCount}, Skipped: ${skippedCount}\n`);

  // Step 3: Update orders to use UNMATCHED- SKUs
  console.log('--- UPDATING ORDER SKUS ---\n');

  let updatedCount = 0;

  for (const [strain, data] of unmatchedByStrain) {
    const canonicalSku = generateUnmatchedSku(strain);

    const { error, count } = await supabase
      .from('orders')
      .update({ sku: canonicalSku })
      .eq('strain', strain)
      .neq('sku', canonicalSku);

    if (error) {
      console.error(`ERROR updating orders for ${strain}:`, error.message);
    } else {
      console.log(`UPDATED: ${data.orderIds.length} orders -> ${canonicalSku}`);
      updatedCount += data.orderIds.length;
    }
  }

  console.log(`\nTotal orders updated: ${updatedCount}\n`);

  // Step 4: Verify final state
  console.log('--- VERIFICATION ---\n');

  const { data: finalOrders } = await supabase.from('orders').select('sku');
  const { data: finalInventory } = await supabase.from('inventory_live').select('sku');

  const finalInvSkus = new Set(finalInventory.map(i => i.sku));

  let matchedAfter = 0;
  let unmatchedAfter = 0;
  const stillUnmatched = [];

  for (const o of finalOrders) {
    if (finalInvSkus.has(o.sku)) {
      matchedAfter++;
    } else {
      unmatchedAfter++;
      if (!stillUnmatched.includes(o.sku)) {
        stillUnmatched.push(o.sku);
      }
    }
  }

  console.log(`After backfill: ${matchedAfter} matched, ${unmatchedAfter} unmatched`);
  console.log(`Match rate: ${((matchedAfter / finalOrders.length) * 100).toFixed(1)}%`);

  if (unmatchedAfter > 0) {
    console.log('\nStill unmatched SKUs:');
    for (const sku of stillUnmatched) {
      console.log(`  - ${sku}`);
    }
  } else {
    console.log('\n100% MATCH RATE ACHIEVED!');
  }
}

completeBackfill()
  .then(() => {
    console.log('\nDone');
    process.exit(0);
  })
  .catch(err => {
    console.error('FAILED:', err);
    process.exit(1);
  });
