/**
 * MANUAL LINE ITEM SYNC
 * Populates orders table from webhook_events
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing Supabase env vars');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function syncLineItems() {
  console.log('=== MANUAL LINE ITEM SYNC ===\n');

  // Get webhook events
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - 30);

  const { data: webhooks, error: webhookError } = await supabase
    .from('webhook_events')
    .select('*')
    .eq('event_type', 'wix.order.created')
    .gte('received_at', lookbackDate.toISOString())
    .order('received_at', { ascending: false });

  if (webhookError) {
    console.log('Webhook query error:', webhookError.message);
    return;
  }

  console.log('Found', webhooks.length, 'webhook events\n');

  let synced = 0;
  let skipped = 0;
  let errors = 0;

  for (const event of webhooks) {
    let rawPayload = event.raw_payload;

    // Parse payload - handle string format
    if (typeof rawPayload === 'string') {
      // Remove prefix if present
      const jsonStart = rawPayload.indexOf('{');
      if (jsonStart >= 0) {
        rawPayload = rawPayload.substring(jsonStart);
      }
      try {
        rawPayload = JSON.parse(rawPayload);
      } catch (e) {
        console.log('Parse error for event', event.id, ':', e.message);
        skipped++;
        continue;
      }
    }

    // Skip non-object payloads
    if (!rawPayload || typeof rawPayload !== 'object') {
      console.log('Non-object payload for event', event.id);
      skipped++;
      continue;
    }

    const data = rawPayload.data || rawPayload;
    if (!data || !data.orderNumber) {
      console.log('No order number in event', event.id);
      skipped++;
      continue;
    }

    const orderNumber = String(data.orderNumber);
    const lineItems = data.lineItems || [];

    // Extract timestamp with proper precedence
    const orderTimestamp = data.paymentDate ||
                          data.createdDate ||
                          data.payments?.[0]?.createdDate ||
                          data.dateCreated ||
                          event.received_at;

    console.log('Order', orderNumber, ':', lineItems.length, 'items');
    console.log('  Timestamp:', orderTimestamp);

    if (lineItems.length === 0) {
      console.log('  (no line items)');
      skipped++;
      continue;
    }

    // Build rows
    const rows = [];
    for (const item of lineItems) {
      const itemName = item.itemName || item.productName?.original || 'Unknown';

      // Parse product name for strain/unit
      let strain = itemName;
      let unit = 'unit';
      const match = itemName.match(/^(.+?)\s*\(([^)]+)\)$/);
      if (match) {
        strain = match[1].trim();
        unit = match[2].trim();
      }

      // Generate normalized SKU
      const sku = strain.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' +
                  unit.toLowerCase().replace(/[^a-z0-9]+/g, '_');

      const quantity = item.quantity || 1;
      const pricePerUnit = parseFloat(item.totalPrice?.value || item.price || 0);

      rows.push({
        order_id: orderNumber,
        order_date: orderTimestamp,
        created_at: orderTimestamp,
        sku: sku,
        strain: strain,
        unit: unit,
        quantity: quantity,
        price_per_unit: pricePerUnit,
        total_amount: pricePerUnit * quantity
      });

      console.log('  -', strain, '(', unit, '):', quantity, 'x $' + pricePerUnit);
    }

    // Upsert rows (requires unique constraint)
    const { error: upsertError } = await supabase
      .from('orders')
      .upsert(rows, { onConflict: 'order_id,sku', ignoreDuplicates: true });

    if (upsertError) {
      // Try insert if upsert fails (constraint might not exist)
      console.log('  Upsert failed:', upsertError.message);
      console.log('  Trying insert...');

      const { error: insertError } = await supabase
        .from('orders')
        .insert(rows);

      if (insertError) {
        if (insertError.message.includes('duplicate')) {
          console.log('  (already exists)');
          skipped++;
        } else {
          console.log('  INSERT ERROR:', insertError.message);
          errors++;
        }
      } else {
        synced += rows.length;
        console.log('  ✅ Inserted', rows.length, 'line items');
      }
    } else {
      synced += rows.length;
      console.log('  ✅ Upserted', rows.length, 'line items');
    }
  }

  console.log('\n=== SYNC COMPLETE ===');
  console.log('Synced:', synced, 'line items');
  console.log('Skipped:', skipped);
  console.log('Errors:', errors);

  // Verify final count
  const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true });
  console.log('\nTotal orders table rows:', count);

  // Show distribution
  console.log('\n=== VERIFICATION ===');
  const { data: allRows } = await supabase.from('orders').select('created_at');
  if (allRows && allRows.length > 0) {
    const byDay = {};
    for (const row of allRows) {
      const day = row.created_at?.substring(0, 10) || 'null';
      byDay[day] = (byDay[day] || 0) + 1;
    }
    console.log('Distribution by day:');
    Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0])).forEach(([day, cnt]) => {
      console.log(' ', day, ':', cnt, 'items');
    });
  }
}

syncLineItems()
  .then(() => {
    console.log('\n✅ Done');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Failed:', err);
    process.exit(1);
  });
