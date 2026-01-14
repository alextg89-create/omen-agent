/**
 * VERIFY CSV TO SUPABASE MATCH
 *
 * This script checks if Supabase inventory_live contains the products
 * that were documented in the original CSV files.
 *
 * Based on CSV data visible in VSCode tabs:
 * - Master Inventory.csv
 * - Flower.csv
 * - Carts.csv
 * - Concentrates.csv
 * - Edibles.csv
 * - Pre-Rolls.csv
 * - Specials.csv
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Known products from CSV files (sample from what's visible)
 */
const CSV_EXPECTED_PRODUCTS = {
  flower: [
    { strain: 'Bloopiez', unit: '28 G', quality: 'STANDARD', cost: 50, retail: 125 },
    { strain: 'Bloopiez', unit: '1/2 OZ', quality: 'STANDARD', cost: 50, retail: 125 },
    { strain: 'Bloopiez', unit: '1/4 OZ', quality: 'STANDARD', cost: 25, retail: 65 },
    { strain: 'Bloopiez', unit: '1/8 OZ', quality: 'STANDARD', cost: 13, retail: 35 },
    { strain: 'Dosi Pop', unit: '28 G', quality: 'MID SHELF' },
    { strain: 'Mai Tai', unit: '28 G', quality: 'MID SHELF' },
    { strain: 'Blue Mints', unit: '28 G', quality: 'TOP SHELF' },
    { strain: 'Lemon Cherry Gelato', unit: '28 G', quality: 'TOP SHELF' }
  ],
  carts: [
    { brand: 'VENOM', product: '1G cart', cost: 8, retail: 20 },
    { brand: 'SAUSE BARS', product: '1G', cost: 25, retail: 63 },
    { brand: 'TORCH FLOW', product: '1G disposable' },
    { brand: 'MUHA MEDS', product: '2G disposable' },
    { brand: 'BOUTIQ', product: 'DUEL' },
    { brand: 'BOUTIQ', product: 'TRIO' }
  ],
  concentrates: [
    { product: 'AFGHANI STICKY HASH', unit: '1G', cost: 5, retail: 13 },
    { product: 'BUBBLE PLAYDOUGH' },
    { product: 'KAWS ROCKS', unit: '3.5G' },
    { product: 'KAWS ROCKS', unit: '28G' },
    { product: 'LOUD SAUCE' },
    { product: 'BLUE RIVER LIVE HASH ROSIN' }
  ],
  edibles: [
    { product: 'MUNCHIES MUNCH BOX', size: '100mg 10pc', cost: 4, retail: 10 },
    { product: 'Punch Bars', size: '225mg chocolate' },
    { product: 'SOURZ SOUR SQUARS', size: '600mg' },
    { product: 'FADEDFRUIT', size: '1000mg' },
    { product: 'SILLY', size: '2000mg' }
  ],
  prerolls: [
    { product: 'MUNCHIES TRIPLE AAA', infused: false, cost: 4, retail: 10 },
    { product: 'MUNCHIES DONUT HOLE', infused: true, cost: 18, retail: 45 },
    { product: 'MUHA MEDS MATE', infused: true, cost: 21, retail: 53 },
    { product: 'KAWS KONES 5PK' },
    { product: 'FIDEL 5PK' }
  ]
};

/**
 * Normalize product name for comparison
 */
function normalize(str) {
  return (str || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function verifyCSVMatch() {
  console.log('🔍 VERIFYING CSV PRODUCTS AGAINST SUPABASE\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('📝 NOTE: CSV files visible in VSCode tabs but not saved to repo');
  console.log('   Using known product samples from CSV content\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Load Supabase inventory
  console.log('📦 Loading Supabase inventory_live...\n');

  const { data: inventory, error: invError } = await supabase
    .from('inventory_live')
    .select('sku, strain, product_name, unit, quality, brand, quantity');

  if (invError) {
    console.error(`❌ Failed to load inventory: ${invError.message}\n`);
    console.log('⚠️  Make sure SUPABASE_SERVICE_KEY is set in .env\n');
    return;
  }

  if (!inventory || inventory.length === 0) {
    console.log('⚠️  Supabase inventory_live is empty\n');
    return;
  }

  console.log(`✓ Loaded ${inventory.length} items from Supabase\n`);

  // Build lookup map
  const supabaseMap = new Map();
  for (const item of inventory) {
    const strain = item.strain || item.product_name || '';
    const key = `${normalize(strain)}|${normalize(item.unit || '')}`;
    supabaseMap.set(key, item);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('CHECKING KEY CSV PRODUCTS:\n');

  let totalChecked = 0;
  let foundCount = 0;
  let missingCount = 0;

  // Check FLOWER
  console.log('🌿 FLOWER:\n');
  for (const product of CSV_EXPECTED_PRODUCTS.flower) {
    totalChecked++;
    const key = `${normalize(product.strain)}|${normalize(product.unit)}`;
    const found = supabaseMap.get(key);

    if (found) {
      foundCount++;
      console.log(`   ✅ ${product.strain} (${product.unit})`);
      console.log(`      SKU: ${found.sku} | Quality: ${found.quality || 'N/A'} | Qty: ${found.quantity || 0}`);
    } else {
      missingCount++;
      console.log(`   ❌ ${product.strain} (${product.unit}) - NOT FOUND`);
      console.log(`      Expected: Quality ${product.quality}, Cost $${product.cost}, Retail $${product.retail}`);
    }
  }

  // Check CARTS
  console.log('\n🛒 CARTS / VAPES:\n');
  for (const product of CSV_EXPECTED_PRODUCTS.carts) {
    totalChecked++;
    const searchName = product.brand || product.product;
    let found = null;

    // Search by brand or product name
    for (const item of inventory) {
      const strain = item.strain || item.product_name || '';
      const brand = item.brand || '';

      if (normalize(strain).includes(normalize(searchName)) ||
          normalize(brand).includes(normalize(searchName))) {
        found = item;
        break;
      }
    }

    if (found) {
      foundCount++;
      console.log(`   ✅ ${product.brand} ${product.product}`);
      console.log(`      SKU: ${found.sku} | Brand: ${found.brand || 'N/A'}`);
    } else {
      missingCount++;
      console.log(`   ❌ ${product.brand} ${product.product} - NOT FOUND`);
      if (product.cost && product.retail) {
        console.log(`      Expected: Cost $${product.cost}, Retail $${product.retail}`);
      }
    }
  }

  // Check CONCENTRATES
  console.log('\n💎 CONCENTRATES:\n');
  for (const product of CSV_EXPECTED_PRODUCTS.concentrates) {
    totalChecked++;
    let found = null;

    for (const item of inventory) {
      const strain = item.strain || item.product_name || '';

      if (normalize(strain).includes(normalize(product.product))) {
        found = item;
        break;
      }
    }

    if (found) {
      foundCount++;
      console.log(`   ✅ ${product.product}${product.unit ? ' (' + product.unit + ')' : ''}`);
      console.log(`      SKU: ${found.sku}`);
    } else {
      missingCount++;
      console.log(`   ❌ ${product.product}${product.unit ? ' (' + product.unit + ')' : ''} - NOT FOUND`);
    }
  }

  // Check EDIBLES
  console.log('\n🍬 EDIBLES:\n');
  for (const product of CSV_EXPECTED_PRODUCTS.edibles) {
    totalChecked++;
    let found = null;

    for (const item of inventory) {
      const strain = item.strain || item.product_name || '';

      if (normalize(strain).includes(normalize(product.product))) {
        found = item;
        break;
      }
    }

    if (found) {
      foundCount++;
      console.log(`   ✅ ${product.product} (${product.size})`);
      console.log(`      SKU: ${found.sku}`);
    } else {
      missingCount++;
      console.log(`   ❌ ${product.product} (${product.size}) - NOT FOUND`);
    }
  }

  // Check PRE-ROLLS
  console.log('\n🚬 PRE-ROLLS:\n');
  for (const product of CSV_EXPECTED_PRODUCTS.prerolls) {
    totalChecked++;
    let found = null;

    for (const item of inventory) {
      const strain = item.strain || item.product_name || '';

      if (normalize(strain).includes(normalize(product.product))) {
        found = item;
        break;
      }
    }

    if (found) {
      foundCount++;
      console.log(`   ✅ ${product.product}`);
      console.log(`      SKU: ${found.sku} | Infused: ${product.infused ? 'Yes' : 'No'}`);
    } else {
      missingCount++;
      console.log(`   ❌ ${product.product} - NOT FOUND`);
    }
  }

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 VERIFICATION SUMMARY:\n');
  console.log(`   CSV Products Checked: ${totalChecked}`);
  console.log(`   ✅ Found in Supabase: ${foundCount} (${((foundCount / totalChecked) * 100).toFixed(1)}%)`);
  console.log(`   ❌ Missing from Supabase: ${missingCount} (${((missingCount / totalChecked) * 100).toFixed(1)}%)`);
  console.log(`   📦 Total Supabase Items: ${inventory.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (missingCount > 0) {
    console.log('⚠️  FINDINGS:\n');
    console.log(`   ${missingCount} products from CSV are not in Supabase inventory_live`);
    console.log('   These products may need to be added to maintain catalog consistency\n');
  }

  if (foundCount === totalChecked) {
    console.log('✅ SUCCESS: All checked CSV products exist in Supabase!\n');
  }

  // Show what IS in Supabase
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 CURRENT SUPABASE INVENTORY (First 20 items):\n');

  inventory.slice(0, 20).forEach(item => {
    const strain = item.strain || item.product_name || 'Unknown';
    console.log(`   • ${strain} (${item.unit || 'N/A'})`);
    console.log(`     SKU: ${item.sku} | Quality: ${item.quality || 'N/A'} | Qty: ${item.quantity || 0}`);
  });

  if (inventory.length > 20) {
    console.log(`\n   ... and ${inventory.length - 20} more items\n`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('✅ SOURCE OF TRUTH: Supabase inventory_live');
  console.log('📝 CSV files are reference material for historical comparison\n');
}

verifyCSVMatch().catch(console.error);
