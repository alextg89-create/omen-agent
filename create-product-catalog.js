/**
 * CREATE PRODUCT CATALOG - CANONICAL PRODUCT IDENTITY LAYER
 *
 * PURPOSE: Establish timeless product identities that survive stock changes
 *
 * RULES:
 * - Do NOT delete any rows
 * - Do NOT modify webhooks
 * - Do NOT depend on inventory_live completeness
 * - Creates stable canonical_sku for each unique product
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Generate deterministic canonical SKU from product identity
 */
function generateCanonicalSKU(strain, unit) {
  const normalizedStrain = (strain || 'unknown').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const normalizedUnit = (unit || 'unknown').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `${normalizedStrain}-${normalizedUnit}`;
}

/**
 * Extract category from product name patterns
 */
function inferCategory(strain, unit) {
  const strainLower = (strain || '').toLowerCase();
  const unitLower = (unit || '').toLowerCase();

  if (unitLower.includes('cart') || unitLower.includes('pod') || strainLower.includes('cart')) {
    return 'VAPE / CART';
  }
  if (unitLower.includes('roll') || unitLower.includes('blunt') || unitLower.includes('joint')) {
    return 'Pre-Rolls';
  }
  if (strainLower.includes('gummy') || strainLower.includes('chocolate') ||
      strainLower.includes('cookie') || strainLower.includes('edible') ||
      unitLower.includes('gummy') || unitLower.includes('chocolate')) {
    return 'Edibles';
  }
  if (strainLower.includes('hash') || strainLower.includes('rosin') ||
      strainLower.includes('sauce') || strainLower.includes('wax') ||
      strainLower.includes('badder') || strainLower.includes('diamond')) {
    return 'Concentrates';
  }
  if (unitLower.match(/\d+\s*g$/) || unitLower.match(/oz|ounce/i)) {
    return 'FLOWER';
  }

  return null;
}

/**
 * Infer quality tier from unit or strain patterns
 */
function inferQualityTier(strain, unit) {
  const strainLower = (strain || '').toLowerCase();
  const unitLower = (unit || '').toLowerCase();

  if (strainLower.includes('wizard') || strainLower.includes('exotic') ||
      strainLower.includes('designer')) {
    return 'EXOTIC/DESIGNER';
  }
  if (strainLower.includes('top shelf') || unitLower.includes('top shelf')) {
    return 'TOP SHELF';
  }
  if (strainLower.includes('mid shelf') || unitLower.includes('mid shelf')) {
    return 'MID SHELF';
  }
  if (strainLower.includes('standard') || unitLower.includes('standard')) {
    return 'STANDARD';
  }

  return null;
}

async function createProductCatalog() {
  console.log('🏗️  CREATING PRODUCT CATALOG - CANONICAL IDENTITY LAYER\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // STEP 1: Create product_catalog table
  console.log('📋 Step 1: Creating product_catalog table...\n');

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS public.product_catalog (
      canonical_sku TEXT PRIMARY KEY,
      strain_name TEXT NOT NULL,
      unit TEXT NOT NULL,
      category TEXT,
      brand TEXT,
      quality_tier TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      source_count INTEGER DEFAULT 1,
      notes TEXT,
      UNIQUE(strain_name, unit)
    );

    CREATE INDEX IF NOT EXISTS idx_product_catalog_category ON public.product_catalog(category);
    CREATE INDEX IF NOT EXISTS idx_product_catalog_strain ON public.product_catalog(strain_name);
    CREATE INDEX IF NOT EXISTS idx_product_catalog_unit ON public.product_catalog(unit);
  `;

  // Note: Table creation should be done via Supabase SQL Editor
  // SQL for reference:
  console.log('   SQL to create table (run in Supabase SQL Editor if needed):');
  console.log('   CREATE TABLE IF NOT EXISTS public.product_catalog (');
  console.log('     canonical_sku TEXT PRIMARY KEY,');
  console.log('     strain_name TEXT NOT NULL,');
  console.log('     unit TEXT NOT NULL,');
  console.log('     category TEXT,');
  console.log('     brand TEXT,');
  console.log('     quality_tier TEXT,');
  console.log('     created_at TIMESTAMPTZ DEFAULT NOW(),');
  console.log('     updated_at TIMESTAMPTZ DEFAULT NOW(),');
  console.log('     source_count INTEGER DEFAULT 1,');
  console.log('     notes TEXT,');
  console.log('     UNIQUE(strain_name, unit)');
  console.log('   );');
  console.log('');

  // STEP 2: Gather distinct products from inventory_live
  console.log('📦 Step 2: Scanning inventory_live for products...\n');

  const { data: inventoryProducts, error: invError } = await supabase
    .from('inventory_live')
    .select('sku, strain, product_name, unit, quality, brand');

  if (invError) {
    console.error('   ❌ Failed to load inventory_live:', invError.message);
  } else {
    console.log(`   ✓ Found ${inventoryProducts?.length || 0} inventory records\n`);
  }

  // STEP 3: Gather distinct products from orders
  console.log('📊 Step 3: Scanning orders for products...\n');

  const { data: orderProducts, error: ordError } = await supabase
    .from('orders')
    .select('strain, unit');

  if (ordError) {
    console.error('   ❌ Failed to load orders:', ordError.message);
  } else {
    console.log(`   ✓ Found ${orderProducts?.length || 0} order records\n`);
  }

  // STEP 4: Build unique product map
  console.log('🔍 Step 4: Identifying unique product identities...\n');

  const productMap = new Map();

  // Process inventory_live
  if (inventoryProducts) {
    for (const item of inventoryProducts) {
      const strain = item.strain || item.product_name || 'Unknown';
      const unit = item.unit || 'Unknown';
      const key = `${strain.toLowerCase().trim()}|${unit.toLowerCase().trim()}`;

      if (!productMap.has(key)) {
        productMap.set(key, {
          strain_name: strain,
          unit: unit,
          category: inferCategory(strain, unit),
          brand: item.brand || null,
          quality_tier: item.quality || inferQualityTier(strain, unit),
          source_count: 1,
          sources: ['inventory_live']
        });
      } else {
        const existing = productMap.get(key);
        existing.source_count++;
        if (!existing.sources.includes('inventory_live')) {
          existing.sources.push('inventory_live');
        }
        // Update with better data if available
        if (item.brand && !existing.brand) existing.brand = item.brand;
        if (item.quality && !existing.quality_tier) existing.quality_tier = item.quality;
      }
    }
  }

  // Process orders
  if (orderProducts) {
    for (const item of orderProducts) {
      const strain = item.strain || 'Unknown';
      const unit = item.unit || 'Unknown';
      const key = `${strain.toLowerCase().trim()}|${unit.toLowerCase().trim()}`;

      if (!productMap.has(key)) {
        productMap.set(key, {
          strain_name: strain,
          unit: unit,
          category: inferCategory(strain, unit),
          brand: null,
          quality_tier: inferQualityTier(strain, unit),
          source_count: 1,
          sources: ['orders']
        });
      } else {
        const existing = productMap.get(key);
        existing.source_count++;
        if (!existing.sources.includes('orders')) {
          existing.sources.push('orders');
        }
      }
    }
  }

  console.log(`   ✓ Identified ${productMap.size} unique products\n`);

  // STEP 5: Generate canonical SKUs and prepare catalog entries
  console.log('🏷️  Step 5: Generating canonical SKUs...\n');

  const catalogEntries = [];
  const skuCollisions = new Map();

  for (const [key, product] of productMap.entries()) {
    const canonicalSKU = generateCanonicalSKU(product.strain_name, product.unit);

    // Check for SKU collisions
    if (skuCollisions.has(canonicalSKU)) {
      const existing = skuCollisions.get(canonicalSKU);
      console.warn(`   ⚠️  SKU collision: ${canonicalSKU}`);
      console.warn(`      Existing: ${existing.strain_name} (${existing.unit})`);
      console.warn(`      New: ${product.strain_name} (${product.unit})`);
      // Append a number to make it unique
      let suffix = 2;
      let uniqueSKU = `${canonicalSKU}-${suffix}`;
      while (skuCollisions.has(uniqueSKU)) {
        suffix++;
        uniqueSKU = `${canonicalSKU}-${suffix}`;
      }
      skuCollisions.set(uniqueSKU, product);
      catalogEntries.push({
        canonical_sku: uniqueSKU,
        strain_name: product.strain_name,
        unit: product.unit,
        category: product.category,
        brand: product.brand,
        quality_tier: product.quality_tier,
        source_count: product.source_count,
        notes: `Sources: ${product.sources.join(', ')}`
      });
    } else {
      skuCollisions.set(canonicalSKU, product);
      catalogEntries.push({
        canonical_sku: canonicalSKU,
        strain_name: product.strain_name,
        unit: product.unit,
        category: product.category,
        brand: product.brand,
        quality_tier: product.quality_tier,
        source_count: product.source_count,
        notes: `Sources: ${product.sources.join(', ')}`
      });
    }
  }

  console.log(`   ✓ Generated ${catalogEntries.length} catalog entries\n`);

  // STEP 6: Insert into product_catalog (upsert to avoid duplicates)
  console.log('💾 Step 6: Inserting into product_catalog...\n');

  let inserted = 0;
  let updated = 0;
  let errors = 0;

  // Insert in batches of 50
  const batchSize = 50;
  for (let i = 0; i < catalogEntries.length; i += batchSize) {
    const batch = catalogEntries.slice(i, i + batchSize);

    const { error: insertError } = await supabase
      .from('product_catalog')
      .upsert(batch, {
        onConflict: 'canonical_sku',
        ignoreDuplicates: false
      });

    if (insertError) {
      console.error(`   ❌ Batch ${Math.floor(i / batchSize) + 1} failed:`, insertError.message);
      errors += batch.length;
    } else {
      inserted += batch.length;
      console.log(`   ✓ Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} entries`);
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log('✅ PRODUCT CATALOG CREATED\n');
  console.log(`Total unique products: ${catalogEntries.length}`);
  console.log(`Successfully inserted: ${inserted}`);
  console.log(`Errors: ${errors}\n`);

  // STEP 7: Summary by category
  console.log('📊 CATALOG BREAKDOWN BY CATEGORY:\n');

  const categoryCount = {};
  for (const entry of catalogEntries) {
    const cat = entry.category || 'UNCATEGORIZED';
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  }

  Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([category, count]) => {
      console.log(`   ${category}: ${count} products`);
    });

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // STEP 8: Show sample entries
  console.log('📝 SAMPLE CATALOG ENTRIES:\n');

  catalogEntries.slice(0, 10).forEach(entry => {
    console.log(`   ${entry.canonical_sku}`);
    console.log(`     Strain: ${entry.strain_name}`);
    console.log(`     Unit: ${entry.unit}`);
    console.log(`     Category: ${entry.category || 'N/A'}`);
    console.log(`     Quality: ${entry.quality_tier || 'N/A'}`);
    console.log(`     Sources: ${entry.source_count}`);
    console.log('');
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎯 NEXT STEP: Run /api/resync-orders to map orders to canonical SKUs\n');
}

createProductCatalog().catch(err => {
  console.error('\n❌ FATAL ERROR:');
  console.error(err.message);
  console.error(err.stack);
  process.exit(1);
});
