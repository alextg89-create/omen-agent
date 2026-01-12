/**
 * Sync REAL orders from webhook_events (fixed parser)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function parseProductName(name) {
  const match = name.match(/^(.+?)\s*\(([^)]+)\)$/);
  if (match) {
    return { strain: match[1].trim(), unit: match[2].trim() };
  }

  const unitPatterns = [
    /\s+(1\s*G|2\s*G|3\.5\s*G|7\s*G|14\s*G|28\s*G|500\s*MG|1000\s*MG)$/i,
    /\s+(Cartridge|Cart|Pre-?Roll|Edible|Gummy|Gummies)$/i
  ];

  for (const pattern of unitPatterns) {
    const m = name.match(pattern);
    if (m) {
      return {
        strain: name.replace(pattern, '').trim(),
        unit: m[1].trim()
      };
    }
  }

  return { strain: name.trim(), unit: 'Unit' };
}

async function syncRealOrders() {
  console.log('🔄 Syncing REAL orders from webhook_events...\n');

  // Get webhook events
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - 30);

  const { data: webhookEvents, error: webhookError } = await supabase
    .from('webhook_events')
    .select('*')
    .eq('event_type', 'wix.order.created')
    .gte('received_at', lookbackDate.toISOString())
    .order('received_at', { ascending: false });

  if (webhookError) {
    console.error('❌ ERROR:', webhookError.message);
    process.exit(1);
  }

  console.log(`📦 Found ${webhookEvents.length} webhook events\n`);

  let synced = 0;
  let skipped = 0;

  for (const event of webhookEvents) {
    try {
      // Parse raw_payload - it's stored as a string with prefix
      let rawPayload = event.raw_payload;

      // If it's a string, extract JSON
      if (typeof rawPayload === 'string') {
        // Remove "Webhooks → Custom webhook →" prefix
        const jsonStart = rawPayload.indexOf('{');
        if (jsonStart >= 0) {
          rawPayload = rawPayload.substring(jsonStart);
          rawPayload = JSON.parse(rawPayload);
        } else {
          console.warn(`⚠️  Event ${event.id}: No JSON found in raw_payload`);
          skipped++;
          continue;
        }
      }

      // Extract order data
      const data = rawPayload?.data || rawPayload;

      if (!data || !data.orderNumber) {
        console.warn(`⚠️  Event ${event.id}: No order data found`);
        skipped++;
        continue;
      }

      const orderNumber = data.orderNumber;
      const orderDate = data.payments?.[0]?.createdDate || event.received_at;
      const lineItems = data.lineItems || [];

      console.log(`📝 Processing order ${orderNumber} (${lineItems.length} items)...`);

      const orderRows = [];

      for (const item of lineItems) {
        const itemName = item.itemName || item.productName?.original || 'Unknown';
        const { strain, unit } = parseProductName(itemName);

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

        console.log(`  - ${strain} (${unit}): ${quantity} x $${pricePerUnit}`);
      }

      if (orderRows.length > 0) {
        const { error: insertError } = await supabase
          .from('orders')
          .insert(orderRows);

        if (!insertError) {
          synced += orderRows.length;
          console.log(`✅ Synced order ${orderNumber}\n`);
        } else {
          console.error(`❌ Insert failed for order ${orderNumber}:`, insertError.message);
          skipped++;
        }
      }

    } catch (err) {
      console.error(`❌ Error processing event ${event.id}:`, err.message);
      skipped++;
    }
  }

  console.log('\n📊 SYNC COMPLETE:');
  console.log(`  Synced: ${synced} order items`);
  console.log(`  Skipped: ${skipped} errors/invalid\n`);

  // Verify
  const { count } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true });

  console.log(`📦 Total orders in table: ${count}\n`);

  // Show sample
  const { data: sample } = await supabase
    .from('orders')
    .select('*')
    .order('order_date', { ascending: false })
    .limit(10);

  console.log('📋 Recent orders:');
  sample.forEach((order, i) => {
    console.log(`  ${i + 1}. ${order.strain} (${order.unit}) - ${order.quantity} units @ $${order.price_per_unit}`);
  });

  console.log('\n✅ SUCCESS! OMEN now has REAL velocity data from live sales');
}

syncRealOrders().catch(console.error);
