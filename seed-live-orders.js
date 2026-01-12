/**
 * Seed realistic order history for OMEN velocity analysis
 * Based on ACTUAL inventory_live products (196 items)
 *
 * This generates 30 days of realistic sales patterns:
 * - High velocity items (moving fast)
 * - Medium velocity items (steady sellers)
 * - Low velocity items (slow movers)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function seedOrders() {
  console.log('📦 Loading inventory_live products...\n');

  // Get actual products
  const { data: products, error } = await supabase
    .from('inventory_live')
    .select('*')
    .gt('quantity', 0); // Only products in stock

  if (error) {
    console.error('❌ ERROR:', error.message);
    process.exit(1);
  }

  console.log(`Found ${products.length} products in stock\n`);

  // Select products for different velocity tiers
  const highVelocity = products.slice(0, 10); // Top 10 - will sell 30-50 times in 30 days
  const mediumVelocity = products.slice(10, 40); // Next 30 - will sell 10-25 times
  const lowVelocity = products.slice(40, 80); // Next 40 - will sell 3-8 times

  const orders = [];
  let orderCounter = 1000;

  console.log('🎯 Generating realistic order patterns...\n');

  // HIGH VELOCITY - Fast movers (30-50 sales in 30 days)
  highVelocity.forEach(product => {
    const salesCount = 30 + Math.floor(Math.random() * 20); // 30-50 sales
    console.log(`  HIGH: ${product.strain} (${product.unit}) - ${salesCount} sales`);

    for (let i = 0; i < salesCount; i++) {
      const daysAgo = Math.floor(Math.random() * 30);
      const orderDate = new Date();
      orderDate.setDate(orderDate.getDate() - daysAgo);

      orders.push({
        order_id: `ORD${orderCounter++}`,
        order_date: orderDate.toISOString(),
        sku: product.sku,
        strain: product.strain,
        unit: product.unit,
        quality: product.quality,
        quantity: Math.random() < 0.8 ? 1 : 2, // 80% single unit, 20% double
        price_per_unit: product.retail_price || product.cost * 1.5,
        total_amount: null, // Will calculate
        customer_id: `CUST${Math.floor(Math.random() * 500)}`,
        notes: null
      });
    }
  });

  // MEDIUM VELOCITY - Steady sellers (10-25 sales in 30 days)
  mediumVelocity.forEach(product => {
    const salesCount = 10 + Math.floor(Math.random() * 15); // 10-25 sales
    console.log(`  MED:  ${product.strain} (${product.unit}) - ${salesCount} sales`);

    for (let i = 0; i < salesCount; i++) {
      const daysAgo = Math.floor(Math.random() * 30);
      const orderDate = new Date();
      orderDate.setDate(orderDate.getDate() - daysAgo);

      orders.push({
        order_id: `ORD${orderCounter++}`,
        order_date: orderDate.toISOString(),
        sku: product.sku,
        strain: product.strain,
        unit: product.unit,
        quality: product.quality,
        quantity: 1,
        price_per_unit: product.retail_price || product.cost * 1.5,
        total_amount: null,
        customer_id: `CUST${Math.floor(Math.random() * 500)}`,
        notes: null
      });
    }
  });

  // LOW VELOCITY - Slow movers (3-8 sales in 30 days)
  lowVelocity.forEach(product => {
    const salesCount = 3 + Math.floor(Math.random() * 5); // 3-8 sales
    console.log(`  LOW:  ${product.strain} (${product.unit}) - ${salesCount} sales`);

    for (let i = 0; i < salesCount; i++) {
      const daysAgo = Math.floor(Math.random() * 30);
      const orderDate = new Date();
      orderDate.setDate(orderDate.getDate() - daysAgo);

      orders.push({
        order_id: `ORD${orderCounter++}`,
        order_date: orderDate.toISOString(),
        sku: product.sku,
        strain: product.strain,
        unit: product.unit,
        quality: product.quality,
        quantity: 1,
        price_per_unit: product.retail_price || product.cost * 1.5,
        total_amount: null,
        customer_id: `CUST${Math.floor(Math.random() * 500)}`,
        notes: null
      });
    }
  });

  // Calculate total_amount
  orders.forEach(order => {
    order.total_amount = order.quantity * order.price_per_unit;
  });

  console.log(`\n📊 Generated ${orders.length} orders across ${highVelocity.length + mediumVelocity.length + lowVelocity.length} products\n`);

  // Insert in batches (Supabase limit is 1000 per batch)
  const batchSize = 500;
  for (let i = 0; i < orders.length; i += batchSize) {
    const batch = orders.slice(i, i + batchSize);
    console.log(`📤 Inserting batch ${Math.floor(i / batchSize) + 1}... (${batch.length} orders)`);

    const { error: insertError } = await supabase
      .from('orders')
      .insert(batch);

    if (insertError) {
      console.error('❌ INSERT ERROR:', insertError.message);
      process.exit(1);
    }
  }

  console.log('\n✅ SUCCESS! Orders seeded.\n');

  // Verify
  const { count } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true });

  console.log(`📊 Total orders in table: ${count}`);
  console.log('\n🎉 OMEN is now ready for velocity-driven recommendations!\n');
}

seedOrders().catch(console.error);
