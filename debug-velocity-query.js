/**
 * DEBUG: Test velocity query exactly as OMEN runs it
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function debugVelocity() {
  console.log('🔍 DEBUGGING VELOCITY QUERY\n');

  // 1. Check what orders exist with matched SKUs
  const { data: orders } = await supabase
    .from('orders')
    .select('*')
    .order('order_date', { ascending: false });

  console.log(`📦 Total orders: ${orders.length}`);

  // Group by SKU
  const bySku = {};
  orders.forEach(order => {
    if (!bySku[order.sku]) {
      bySku[order.sku] = [];
    }
    bySku[order.sku].push(order);
  });

  console.log(`\n📊 Orders grouped by SKU:\n`);
  Object.entries(bySku).forEach(([sku, skuOrders]) => {
    const totalQty = skuOrders.reduce((sum, o) => sum + o.quantity, 0);
    console.log(`  ${sku}:`);
    console.log(`    Orders: ${skuOrders.length}`);
    console.log(`    Total units: ${totalQty}`);
    console.log(`    First order: ${skuOrders[0].order_date}`);
    console.log(`    Latest order: ${skuOrders[skuOrders.length - 1].order_date}`);
  });

  // 2. Check if these SKUs exist in inventory_live
  console.log(`\n\n🔗 CHECKING SKU MATCHES IN INVENTORY:\n`);

  for (const sku of Object.keys(bySku)) {
    const { data: invMatch } = await supabase
      .from('inventory_live')
      .select('sku, strain, unit, quantity, cost, retail_price')
      .eq('sku', sku)
      .single();

    if (invMatch) {
      const orders = bySku[sku];
      const velocity = orders.reduce((sum, o) => sum + o.quantity, 0) / 30; // Last 30 days

      console.log(`✅ ${sku}:`);
      console.log(`   Inventory: ${invMatch.strain} (${invMatch.unit})`);
      console.log(`   Stock: ${invMatch.quantity}`);
      console.log(`   Velocity: ${velocity.toFixed(2)} units/day`);
      console.log(`   Margin: ${invMatch.cost && invMatch.retail_price ? ((invMatch.retail_price - invMatch.cost) / invMatch.retail_price * 100).toFixed(1) : 'N/A'}%`);
    } else {
      console.log(`❌ ${sku}: NO MATCH in inventory_live`);
    }
  }

  // 3. Simulate OMEN's velocity query for Daily timeframe
  console.log(`\n\n🎯 SIMULATING DAILY VELOCITY QUERY (last 24 hours):\n`);

  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  const { data: recentOrders } = await supabase
    .from('orders')
    .select('*')
    .gte('order_date', oneDayAgo.toISOString());

  console.log(`Orders in last 24h: ${recentOrders.length}`);

  if (recentOrders.length === 0) {
    console.log('⚠️  NO ORDERS IN LAST 24 HOURS - Daily snapshot will show zero velocity');
  } else {
    const dailyBySku = {};
    recentOrders.forEach(order => {
      if (!dailyBySku[order.sku]) {
        dailyBySku[order.sku] = 0;
      }
      dailyBySku[order.sku] += order.quantity;
    });

    console.log('\nDaily velocity by SKU:');
    Object.entries(dailyBySku).forEach(([sku, qty]) => {
      console.log(`  ${sku}: ${qty} units/day`);
    });
  }

  // 4. Simulate WEEKLY velocity query
  console.log(`\n\n🎯 SIMULATING WEEKLY VELOCITY QUERY (last 7 days):\n`);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: weekOrders } = await supabase
    .from('orders')
    .select('*')
    .gte('order_date', sevenDaysAgo.toISOString());

  console.log(`Orders in last 7 days: ${weekOrders.length}`);

  if (weekOrders.length === 0) {
    console.log('⚠️  NO ORDERS IN LAST 7 DAYS - Weekly snapshot will show zero velocity');
  } else {
    const weeklyBySku = {};
    weekOrders.forEach(order => {
      if (!weeklyBySku[order.sku]) {
        weeklyBySku[order.sku] = 0;
      }
      weeklyBySku[order.sku] += order.quantity;
    });

    console.log('\nWeekly velocity by SKU:');
    Object.entries(weeklyBySku).forEach(([sku, qty]) => {
      console.log(`  ${sku}: ${(qty / 7).toFixed(2)} units/day`);
    });
  }

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DIAGNOSIS COMPLETE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

debugVelocity().catch(console.error);
