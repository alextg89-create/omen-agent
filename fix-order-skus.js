/**
 * FIX: Map order product names to actual inventory_live SKUs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fixSkus() {
  console.log('🔧 Fixing order SKUs to match inventory_live...\n');

  // Get all inventory
  const { data: inventory } = await supabase
    .from('inventory_live')
    .select('sku, strain, product_name, unit');

  // Get all orders
  const { data: orders } = await supabase
    .from('orders')
    .select('id, sku, strain, unit');

  console.log(`📦 ${inventory.length} inventory items`);
  console.log(`📦 ${orders.length} orders\n`);

  let fixed = 0;

  // For each order, find matching inventory SKU
  for (const order of orders) {
    // Try to match by strain name (fuzzy)
    const match = inventory.find(inv => {
      const invStrain = (inv.strain || inv.product_name || '').toLowerCase().trim();
      const orderStrain = (order.strain || '').toLowerCase().trim();

      // Exact match
      if (invStrain === orderStrain) return true;

      // Partial match (order name contains inventory name or vice versa)
      if (invStrain.includes(orderStrain) || orderStrain.includes(invStrain)) return true;

      return false;
    });

    if (match) {
      // Update order with correct SKU
      const { error } = await supabase
        .from('orders')
        .update({ sku: match.sku })
        .eq('id', order.id);

      if (!error) {
        fixed++;
        console.log(`✅ ${order.strain} → ${match.sku}`);
      }
    } else {
      console.log(`⚠️  No match for: ${order.strain}`);
    }
  }

  console.log(`\n✅ Fixed ${fixed} out of ${orders.length} orders`);
}

fixSkus().catch(console.error);
