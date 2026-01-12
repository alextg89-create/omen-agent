/**
 * Test script to query existing orders from Supabase
 * This will show what live order data is already captured
 */

import { createClient } from '@supabase/supabase-js';

// Hardcode for testing (values from .env)
const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: Missing SUPABASE_URL or SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkOrders() {
  console.log('🔍 Checking Supabase tables...\n');

  // Check inventory_live
  const { count: invCount, error: invCountError } = await supabase
    .from('inventory_live')
    .select('*', { count: 'exact', head: true });

  if (invCountError) {
    console.error('❌ ERROR querying inventory_live:', invCountError.message);
  } else {
    console.log(`📦 inventory_live: ${invCount} products\n`);
  }

  // Check orders
  console.log('🔍 Querying orders table...\n');

  const { count, error: countError } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.error('❌ ERROR:', countError.message);
    process.exit(1);
  }

  console.log(`📊 Total orders in table: ${count}\n`);

  if (count === 0) {
    console.log('⚠️  Orders table is EMPTY');
    console.log('This means no live orders have been captured yet from Make webhook\n');
    return;
  }

  // Get sample orders
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .order('order_date', { ascending: false })
    .limit(20);

  if (error) {
    console.error('❌ ERROR:', error.message);
    process.exit(1);
  }

  console.log('📦 Sample orders (most recent 20):\n');
  console.log(JSON.stringify(orders, null, 2));

  console.log('\n\n📋 Column structure:');
  if (orders.length > 0) {
    console.log(Object.keys(orders[0]).join(', '));
  }

  // Analyze order data
  console.log('\n\n📈 VELOCITY ANALYSIS:');

  // Group by SKU
  const skuMap = new Map();
  orders.forEach(order => {
    const existing = skuMap.get(order.sku) || { count: 0, totalQty: 0 };
    existing.count++;
    existing.totalQty += order.quantity;
    skuMap.set(order.sku, existing);
  });

  console.log('\nTop products by order frequency:');
  const sorted = Array.from(skuMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  sorted.forEach(([sku, data]) => {
    console.log(`  ${sku}: ${data.count} orders, ${data.totalQty} units sold`);
  });

  // Check date range
  const dates = orders.map(o => new Date(o.order_date)).sort((a, b) => a - b);
  const oldest = dates[0];
  const newest = dates[dates.length - 1];
  const daysDiff = (newest - oldest) / (1000 * 60 * 60 * 24);

  console.log('\n📅 Date range:');
  console.log(`  Oldest: ${oldest.toISOString()}`);
  console.log(`  Newest: ${newest.toISOString()}`);
  console.log(`  Span: ${daysDiff.toFixed(1)} days`);

  console.log('\n✅ READY FOR VELOCITY RECOMMENDATIONS');
}

checkOrders().catch(console.error);
