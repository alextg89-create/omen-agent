/**
 * VERIFY INVENTORY VS WEBHOOK SKU MATCHING
 * Shows which webhook products match inventory and which don't
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function verifyMatching() {
  console.log('🔍 VERIFYING INVENTORY VS WEBHOOK PRODUCT MATCHING\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 1. Load inventory_live
  const { data: inventory, error: invError } = await supabase
    .from('inventory_live')
    .select('sku, strain, product_name, name, unit');

  if (invError || !inventory) {
    console.error('❌ Failed to load inventory:', invError?.message || 'No data');
    return;
  }

  console.log(`📦 Loaded ${inventory.length} inventory items from inventory_live\n`);

  // 2. Get recent webhook events
  const { data: webhooks } = await supabase
    .from('webhook_events')
    .select('*')
    .eq('event_type', 'wix.order.created')
    .order('received_at', { ascending: false })
    .limit(5);

  console.log(`📬 Analyzing ${webhooks.length} recent webhook orders\n`);

  // 3. Parse webhooks and check matches
  const uniqueProducts = new Map(); // product name -> { count, matched SKU or null }

  for (const webhook of webhooks) {
    let payload = webhook.raw_payload;

    // Strip prefix
    if (typeof payload === 'string') {
      const match = payload.match(/^Webhooks\s*→\s*Custom webhook\s*→\s*(.+)$/);
      if (match) payload = match[1];
      payload = JSON.parse(payload);
    }

    const data = payload?.data || payload;
    const lineItems = data?.lineItems || [];

    for (const item of lineItems) {
      const productName = item.itemName || item.productName?.original || 'Unknown';

      if (!uniqueProducts.has(productName)) {
        // Try to find matching SKU
        const nameLower = productName.toLowerCase().trim();

        let matchedSKU = null;
        for (const inv of inventory) {
          const invName = (inv.strain || inv.product_name || inv.name || '').toLowerCase().trim();

          if (invName === nameLower || invName.includes(nameLower) || nameLower.includes(invName)) {
            matchedSKU = inv.sku;
            break;
          }
        }

        uniqueProducts.set(productName, {
          count: 1,
          matchedSKU,
          inventoryName: matchedSKU ? inventory.find(i => i.sku === matchedSKU)?.strain || 'unknown' : null
        });
      } else {
        uniqueProducts.get(productName).count++;
      }
    }
  }

  // 4. Report results
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('WEBHOOK PRODUCT → INVENTORY MATCHING:\n');

  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const [productName, info] of uniqueProducts.entries()) {
    if (info.matchedSKU) {
      console.log(`✅ "${productName}"`);
      console.log(`   → Matched: ${info.matchedSKU} (${info.inventoryName})`);
      console.log(`   → Appears in ${info.count} order(s)\n`);
      matchedCount++;
    } else {
      console.log(`❌ "${productName}"`);
      console.log(`   → NO MATCH in inventory_live`);
      console.log(`   → Appears in ${info.count} order(s)\n`);
      unmatchedCount++;
    }
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SUMMARY:');
  console.log(`  ✅ Matched products: ${matchedCount}`);
  console.log(`  ❌ Unmatched products: ${unmatchedCount}`);
  console.log(`  📊 Total unique products: ${uniqueProducts.size}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (unmatchedCount > 0) {
    console.log('⚠️  RECOMMENDATION:');
    console.log('Unmatched products need to be added to inventory_live or');
    console.log('their names in Wix need to match existing inventory names.\n');

    console.log('To fix, either:');
    console.log('1. Update inventory_live.strain to match webhook product names');
    console.log('2. Update Wix product names to match inventory_live.strain');
    console.log('3. Add missing products to inventory_live\n');
  } else {
    console.log('✅ ALL webhook products match inventory! SKU matching will work.\n');
  }
}

verifyMatching().catch(console.error);
