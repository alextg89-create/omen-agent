/**
 * Clear sample data and sync ONLY real webhook orders
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

/* =========================
   ENV
   ========================= */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing Supabase env vars');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* =========================
   MAIN
   ========================= */

async function clearAndSync() {
  let synced = 0;

  console.log('🧹 Step 1: Clearing existing orders_agg...');

  const { error: deleteError } = await supabase
    .from('orders_agg')
    .delete()
    .neq('order_id', '');

  if (deleteError) throw deleteError;

  console.log('🔁 Step 2: Syncing REAL orders from webhook_events...');

  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - 30);

  const { data: webhookEvents, error } = await supabase
    .from('webhook_events')
    .select('*')
    .eq('event_type', 'wix.order.created')
    .gte('received_at', lookbackDate.toISOString());

  if (error) throw error;

  
  for (const event of webhookEvents) {
    const payload = event.raw_payload;

    // Skip the single bad string row
    if (!payload || typeof payload !== 'object') {
      console.warn('⚠️ Skipping non-object payload');
      continue;
    }

    // Wix order lives directly at payload
    const data = payload;

    const orderNumber = data.orderNumber;
    if (!orderNumber) {
      console.warn('⚠️ Missing orderNumber, skipping');
      continue;
    }

    const orderDate =
      data.payments?.[0]?.createdDate ||
      event.received_at;

    const lineItems = Array.isArray(data.lineItems)
  ? data.lineItems
  : [];

    if (lineItems.length === 0) {
      console.warn(` Order ${orderNumber} has no line items`);
      continue;
    }

    // =========================================================
    // AGGREGATE ORDER-LEVEL TOTALS FROM LINE ITEMS
    // =========================================================
    let item_count = 0;
    let total_revenue = 0;
    let total_cost = 0;

    for (const item of lineItems) {
      const quantity = item.quantity || 1;
      const price = parseFloat(
        item.totalPrice?.value ??
        item.price?.value ??
        item.price ??
        0
      );
      // Cost from item if available, otherwise estimate at 40% of price
      const cost = parseFloat(item.cost ?? item.costOfGoodsSold ?? (price * 0.4));

      item_count += quantity;
      total_revenue += price * quantity;
      total_cost += cost * quantity;
    }

    const total_profit = total_revenue - total_cost;

    // =========================================================
    // UPSERT ONE ORDER-LEVEL ROW INTO orders_agg (idempotent)
    // =========================================================
    const orderRow = {
      order_id: orderNumber,
      store_id: 'NJWeedWizard',
      source: 'wix',
      created_at: orderDate,
      item_count,
      total_revenue,
      total_cost,
      total_profit
    };

    const { error: upsertError } = await supabase
      .from('orders_agg')
      .upsert(orderRow, { onConflict: 'order_id' });

    if (upsertError) throw upsertError;

    synced++;
    console.log(`✅ Order ${orderNumber}: ${item_count} items, $${total_revenue.toFixed(2)} revenue`);
  }

  console.log(`🎯 Sync complete. Upserted ${synced} orders.`);
}

/* =========================
   RUN
   ========================= */

clearAndSync()
  .then(() => {
    console.log('✅ Done');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Sync failed:', err);
    process.exit(1);
  });
