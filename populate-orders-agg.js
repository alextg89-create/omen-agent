/**
 * Populate orders_agg from orders table
 * This syncs the aggregate table with live order data
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function populateOrdersAgg() {
  console.log('=== POPULATING ORDERS_AGG FROM ORDERS ===\n');

  // Get all orders
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('order_id, order_date, quantity, price_per_unit, total_amount');

  if (ordersError) {
    console.error('Error fetching orders:', ordersError.message);
    return;
  }

  console.log('Found', orders.length, 'order line items');

  // Aggregate by order_id
  const orderMap = new Map();
  for (const o of orders) {
    if (!orderMap.has(o.order_id)) {
      orderMap.set(o.order_id, {
        order_id: o.order_id,
        store_id: 'NJWeedWizard',
        source: 'wix',
        created_at: o.order_date,
        item_count: 0,
        total_revenue: 0,
        total_cost: 0,
        total_profit: 0
      });
    }
    const agg = orderMap.get(o.order_id);
    agg.item_count += 1;
    const itemRevenue = o.total_amount || o.price_per_unit || 0;
    agg.total_revenue += itemRevenue;
    // Estimate cost as 40% of revenue (60% margin)
    const estimatedCost = itemRevenue * 0.4;
    agg.total_cost += estimatedCost;
    agg.total_profit += (itemRevenue - estimatedCost);
  }

  console.log('Aggregated into', orderMap.size, 'unique orders');

  // Upsert to orders_agg
  const aggRows = Array.from(orderMap.values());
  const { error: upsertError } = await supabase
    .from('orders_agg')
    .upsert(aggRows, { onConflict: 'order_id' });

  if (upsertError) {
    console.error('Upsert error:', upsertError.message);
    return;
  }

  console.log('✅ Upserted', aggRows.length, 'rows to orders_agg');

  // Verify
  const { count } = await supabase.from('orders_agg').select('*', { count: 'exact', head: true });
  console.log('\norders_agg now has', count, 'rows');

  // Check most recent
  const { data: recent } = await supabase
    .from('orders_agg')
    .select('order_id, created_at, total_revenue')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\nMost recent orders in orders_agg:');
  recent.forEach(r => {
    console.log('  ', r.order_id, '@', r.created_at?.split('T')[0], '- $' + r.total_revenue);
  });
}

populateOrdersAgg().catch(console.error);
