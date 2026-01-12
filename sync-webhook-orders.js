/**
 * DIRECT SYNC: webhook_events → orders table
 * Parses Wix order webhooks and extracts line items
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Parse product name to extract strain and unit
 */
function parseProductName(name) {
  // Remove parentheses content
  const match = name.match(/^(.+?)\s*\(([^)]+)\)$/);

  if (match) {
    return {
      strain: match[1].trim(),
      unit: match[2].trim()
    };
  }

  // Try to detect unit at end
  const unitPatterns = [
    /\s+(1\s*G|2\s*G|3\.5\s*G|7\s*G|14\s*G|28\s*G)$/i,
    /\s+(Cartridge|Cart|Pre-?Roll|Edible|Gummy|Gummies|500\s*MG|1000\s*MG)$/i
  ];

  for (const pattern of unitPatterns) {
    const match = name.match(pattern);
    if (match) {
      return {
        strain: name.replace(pattern, '').trim(),
        unit: match[1].trim()
      };
    }
  }

  // Default
  return {
    strain: name.trim(),
    unit: 'Unknown'
  };
}

async function syncOrders() {
  console.log('🔄 Syncing orders from webhook_events...\n');

  // Step 1: Get webhook events (last 30 days)
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - 30);

  const { data: webhookEvents, error: webhookError } = await supabase
    .from('webhook_events')
    .select('*')
    .eq('event_type', 'wix.order.created')
    .gte('received_at', lookbackDate.toISOString())
    .order('received_at', { ascending: false });

  if (webhookError) {
    console.error('❌ ERROR loading webhook_events:', webhookError.message);
    process.exit(1);
  }

  console.log(`📦 Found ${webhookEvents.length} order events\n`);

  // Step 2: Get existing orders
  const { data: existingOrders } = await supabase
    .from('orders')
    .select('order_id');

  const existingOrderIds = new Set((existingOrders || []).map(o => o.order_id));

  let synced = 0;
  let skipped = 0;

  // Step 3: Parse and insert
  for (const event of webhookEvents) {
    const payload = event.raw_payload;
    const data = payload?.data;

    if (!data) {
      skipped++;
      continue;
    }

    const orderNumber = data.orderNumber;
    const orderDate = data.payments?.[0]?.createdDate || event.received_at;
    const lineItems = data.lineItems || [];

    // Skip if already synced
    if (existingOrderIds.has(orderNumber)) {
      skipped++;
      continue;
    }

    // Extract line items
    const orderRows = [];

    for (const item of lineItems) {
      const itemName = item.itemName || item.productName?.original || 'Unknown';
      const { strain, unit } = parseProductName(itemName);

      // Create normalized SKU
      const sku = `${strain.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${unit.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

      const pricePerUnit = parseFloat(item.totalPrice?.value || item.price || 0);
      const quantity = item.quantity || 1;

      orderRows.push({
        order_id: orderNumber,
        order_date: orderDate,
        sku: sku,
        strain: strain,
        unit: unit,
        quality: null,
        quantity: quantity,
        price_per_unit: pricePerUnit,
        total_amount: pricePerUnit * quantity,
        customer_id: data.buyerId || null,
        notes: item.descriptionLines?.map(d => `${d.name}: ${d.description}`).join(', ') || null
      });
    }

    // Insert
    if (orderRows.length > 0) {
      const { error: insertError } = await supabase
        .from('orders')
        .insert(orderRows);

      if (insertError) {
        console.error(`❌ Failed to insert order ${orderNumber}:`, insertError.message);
      } else {
        synced += orderRows.length;
        console.log(`✅ Synced order ${orderNumber} (${orderRows.length} items)`);
      }
    }
  }

  console.log('\n📊 SYNC COMPLETE:');
  console.log(`  Synced: ${synced} order items`);
  console.log(`  Skipped: ${skipped} duplicates/invalid`);

  // Verify
  const { count } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true });

  console.log(`\n📦 Total orders in table: ${count}`);
  console.log('\n✅ OMEN can now generate velocity-driven recommendations!');
}

syncOrders().catch(console.error);
