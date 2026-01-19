/**
 * SKU MISMATCH AUDIT
 * Analyzes why order SKUs don't match inventory_live SKUs
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function auditSkuMismatch() {
  console.log('=== STEP 1: SKU MISMATCH AUDIT ===\n');

  // Get all order SKUs
  const { data: orders } = await supabase.from('orders').select('sku, strain, unit');

  // Get all inventory SKUs
  const { data: inventory, error: invError } = await supabase.from('inventory_live').select('sku, strain, product_name, unit, category, brand');

  if (invError) {
    console.log('Inventory query error:', invError.message);
    return;
  }

  console.log('Orders table:', orders?.length || 0, 'rows');
  console.log('Inventory table:', inventory?.length || 0, 'rows');

  if (!inventory || inventory.length === 0) {
    console.log('ERROR: No inventory data found');
    return;
  }

  // Build inventory SKU set
  const inventorySkus = new Set(inventory.map(i => i.sku));

  // Find unmatched order SKUs
  const unmatchedOrders = [];
  const matchedOrders = [];

  for (const o of orders) {
    if (inventorySkus.has(o.sku)) {
      matchedOrders.push(o);
    } else {
      unmatchedOrders.push(o);
    }
  }

  console.log('\n--- MATCH SUMMARY ---');
  console.log('Matched orders:', matchedOrders.length);
  console.log('Unmatched orders:', unmatchedOrders.length);
  console.log('Match rate:', ((matchedOrders.length / orders.length) * 100).toFixed(1) + '%');

  // Group unmatched by SKU with counts
  const unmatchedBysku = {};
  for (const o of unmatchedOrders) {
    const key = o.sku;
    if (!unmatchedBysku[key]) {
      unmatchedBysku[key] = { sku: o.sku, strain: o.strain, unit: o.unit, count: 0 };
    }
    unmatchedBysku[key].count++;
  }

  const sorted = Object.values(unmatchedBysku).sort((a, b) => b.count - a.count);

  console.log('\n--- UNMATCHED ORDER SKUS (by frequency) ---');
  for (const item of sorted.slice(0, 20)) {
    console.log('  ' + item.count + 'x | sku: ' + item.sku);
    console.log('       strain: "' + item.strain + '" | unit: "' + item.unit + '"');
  }

  // Show sample inventory SKUs for comparison
  console.log('\n--- SAMPLE INVENTORY SKUS ---');
  for (const inv of inventory.slice(0, 15)) {
    console.log('  sku: "' + inv.sku + '"');
    console.log('       strain: "' + (inv.strain || '') + '" | product: "' + (inv.product_name || '') + '" | unit: "' + (inv.unit || '') + '"');
  }

  // Analyze patterns
  console.log('\n--- PATTERN ANALYSIS ---');

  // Check if order SKUs have _unit suffix
  const orderSkusWithUnit = orders.filter(o => o.sku.endsWith('_unit'));
  console.log('Order SKUs ending in _unit:', orderSkusWithUnit.length, '/', orders.length);

  // Check inventory SKU patterns
  let invWithUnderscore = 0;
  let invWithUnit = 0;

  for (const inv of inventory) {
    if (inv.sku.includes('_')) invWithUnderscore++;
    if (inv.sku.toLowerCase().includes('unit')) invWithUnit++;
  }

  console.log('Inventory SKUs with underscore:', invWithUnderscore, '/', inventory.length);
  console.log('Inventory SKUs containing "unit":', invWithUnit, '/', inventory.length);

  // Try to find potential matches
  console.log('\n--- POTENTIAL MATCH CANDIDATES ---');

  for (const item of sorted.slice(0, 10)) {
    const orderStrain = item.strain.toLowerCase().trim();

    // Find inventory items with similar strain names
    const candidates = inventory.filter(inv => {
      const invStrain = (inv.strain || inv.product_name || '').toLowerCase().trim();
      return invStrain.includes(orderStrain.substring(0, 5)) ||
             orderStrain.includes(invStrain.substring(0, 5));
    });

    if (candidates.length > 0) {
      console.log('\nOrder: "' + item.strain + '" (' + item.unit + ')');
      console.log('  Current SKU: ' + item.sku);
      console.log('  Potential matches:');
      for (const c of candidates.slice(0, 3)) {
        console.log('    - ' + c.sku + ' (strain: "' + (c.strain || c.product_name) + '", unit: "' + c.unit + '")');
      }
    } else {
      console.log('\nOrder: "' + item.strain + '" (' + item.unit + ')');
      console.log('  Current SKU: ' + item.sku);
      console.log('  NO MATCHES FOUND');
    }
  }
}

auditSkuMismatch()
  .then(() => console.log('\n✅ Audit complete'))
  .catch(console.error);
