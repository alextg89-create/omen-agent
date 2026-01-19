/**
 * BACKFILL ORDER SKUS
 *
 * One-time script to update existing orders with canonical inventory SKUs
 * - Reads all orders from orders table
 * - Resolves each to canonical inventory SKU
 * - Updates sku field only if match confidence >= threshold
 * - Logs stats: updated / skipped / ambiguous
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import {
  buildInventoryIndex,
  resolveToCanonicalSku,
  normalizeForMatch
} from './src/utils/skuResolver.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing Supabase env vars');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Minimum confidence to update SKU
const MIN_CONFIDENCE = 0.7;

async function backfillOrderSkus() {
  console.log('=== BACKFILL ORDER SKUS ===\n');

  // Load inventory
  const { data: inventory, error: invError } = await supabase
    .from('inventory_live')
    .select('*');

  if (invError) {
    console.error('Failed to load inventory:', invError.message);
    process.exit(1);
  }

  console.log('Loaded', inventory.length, 'inventory items');

  // Build index
  const index = buildInventoryIndex(inventory);
  console.log('Built index with', index.byNormalizedStrain.size, 'unique strains\n');

  // Load orders
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('*');

  if (ordersError) {
    console.error('Failed to load orders:', ordersError.message);
    process.exit(1);
  }

  console.log('Loaded', orders.length, 'order line items\n');

  // Stats
  const stats = {
    updated: 0,
    skipped: 0,
    unmatched: 0,
    alreadyCorrect: 0,
    errors: 0
  };

  const unmatchedStrains = new Set();

  // Process each order
  for (const order of orders) {
    const lineItem = {
      strain: order.strain,
      unit: order.unit,
      sku: order.sku
    };

    const result = resolveToCanonicalSku(lineItem, index);

    // Check if already correct
    if (order.sku === result.sku) {
      stats.alreadyCorrect++;
      continue;
    }

    // Skip if below confidence threshold
    if (result.confidence < MIN_CONFIDENCE) {
      stats.unmatched++;
      unmatchedStrains.add(order.strain);
      console.log('UNMATCHED:', order.strain, '→', result.sku, '(confidence:', result.confidence + ')');
      continue;
    }

    // Update the order
    const { error: updateError } = await supabase
      .from('orders')
      .update({ sku: result.sku })
      .eq('id', order.id);

    if (updateError) {
      console.error('Update error for order', order.id, ':', updateError.message);
      stats.errors++;
      continue;
    }

    stats.updated++;
    console.log('UPDATED:', order.strain, '→', result.sku, '(' + result.matchType + ')');
  }

  // Summary
  console.log('\n=== BACKFILL COMPLETE ===');
  console.log('Updated:', stats.updated);
  console.log('Already correct:', stats.alreadyCorrect);
  console.log('Skipped (low confidence):', stats.unmatched);
  console.log('Errors:', stats.errors);
  console.log('Total processed:', orders.length);

  if (unmatchedStrains.size > 0) {
    console.log('\n--- UNMATCHED STRAINS ---');
    for (const strain of unmatchedStrains) {
      console.log('  -', strain);
    }
  }

  // Verify
  console.log('\n=== VERIFICATION ===');

  const { data: verifyOrders } = await supabase.from('orders').select('sku');
  const { data: verifyInventory } = await supabase.from('inventory_live').select('sku');

  const invSkuSet = new Set(verifyInventory.map(i => i.sku));
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const o of verifyOrders) {
    if (invSkuSet.has(o.sku)) {
      matchedCount++;
    } else {
      unmatchedCount++;
    }
  }

  console.log('Orders matching inventory SKUs:', matchedCount, '/', verifyOrders.length);
  console.log('Orders not matching:', unmatchedCount);
  console.log('Match rate:', ((matchedCount / verifyOrders.length) * 100).toFixed(1) + '%');

  // Show unique SKUs now
  const uniqueSkus = new Set(verifyOrders.filter(o => invSkuSet.has(o.sku)).map(o => o.sku));
  console.log('\nUnique matched SKUs:', uniqueSkus.size);
}

backfillOrderSkus()
  .then(() => {
    console.log('\n✅ Done');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Failed:', err);
    process.exit(1);
  });
