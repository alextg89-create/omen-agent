/**
 * COMPARE CSV INVENTORY TO SUPABASE
 *
 * PURPOSE: Verify original CSV product catalogs match current Supabase state
 *
 * RULES:
 * - CSVs are REFERENCE MATERIAL (original inventory)
 * - Supabase is SOURCE OF TRUTH (do not overwrite)
 * - Report mismatches, missing products, naming differences
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'YOUR_SERVICE_KEY_HERE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Parse CSV file into array of objects
 */
function parseCSV(filepath) {
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length === 0) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] || '';
      });
      rows.push(row);
    }

    return rows;
  } catch (err) {
    console.error(`   ⚠️  Could not read ${path.basename(filepath)}: ${err.message}`);
    return [];
  }
}

/**
 * Normalize product name for comparison
 */
function normalizeProductName(name) {
  return (name || '').toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Extract product identity from CSV row
 */
function extractCSVProduct(row, category) {
  let strain = '';
  let unit = '';
  let quality = '';
  let brand = '';
  let cost = '';
  let retail = '';

  // Different CSV files have different structures
  if (row['Strain']) {
    strain = row['Strain'];
  } else if (row['Product']) {
    strain = row['Product'];
  } else if (row['Product Name']) {
    strain = row['Product Name'];
  }

  if (row['Weight'] || row['Unit']) {
    unit = row['Weight'] || row['Unit'];
  }

  if (row['Quality'] || row['Quality Tier']) {
    quality = row['Quality'] || row['Quality Tier'];
  }

  if (row['Brand']) {
    brand = row['Brand'];
  }

  if (row['Cost']) {
    cost = row['Cost'];
  }

  if (row['Retail Price'] || row['Retail']) {
    retail = row['Retail Price'] || row['Retail'];
  }

  return {
    strain: strain || 'Unknown',
    unit: unit || 'Unknown',
    quality,
    brand,
    cost,
    retail,
    category,
    normalizedName: normalizeProductName(strain),
    originalRow: row
  };
}

async function compareCSVToSupabase() {
  console.log('🔍 COMPARING CSV INVENTORY TO SUPABASE\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // STEP 1: Load all CSV files
  console.log('📋 Step 1: Loading CSV files...\n');

  const csvFiles = [
    { name: 'Master Inventory.csv', category: 'MASTER' },
    { name: 'Flower.csv', category: 'FLOWER' },
    { name: 'Carts.csv', category: 'VAPE / CART' },
    { name: 'Concentrates.csv', category: 'Concentrates' },
    { name: 'Edibles.csv', category: 'Edibles' },
    { name: 'Pre-Rolls.csv', category: 'Pre-Rolls' },
    { name: 'Specials.csv', category: 'SPECIALS' }
  ];

  const csvProducts = new Map(); // normalized_name -> product info
  let totalCSVProducts = 0;

  for (const csvFile of csvFiles) {
    const filepath = path.join(__dirname, csvFile.name);
    const rows = parseCSV(filepath);

    if (rows.length === 0) {
      console.log(`   ⚠️  ${csvFile.name}: No data or file not found`);
      continue;
    }

    console.log(`   ✓ ${csvFile.name}: ${rows.length} rows`);

    for (const row of rows) {
      const product = extractCSVProduct(row, csvFile.category);
      const key = `${product.normalizedName}|${normalizeProductName(product.unit)}`;

      if (!csvProducts.has(key)) {
        csvProducts.set(key, {
          ...product,
          sources: [csvFile.name]
        });
        totalCSVProducts++;
      } else {
        const existing = csvProducts.get(key);
        if (!existing.sources.includes(csvFile.name)) {
          existing.sources.push(csvFile.name);
        }
      }
    }
  }

  console.log(`\n   Total unique CSV products: ${totalCSVProducts}\n`);

  // STEP 2: Load Supabase inventory_live
  console.log('📦 Step 2: Loading Supabase inventory_live...\n');

  const { data: inventory, error: invError } = await supabase
    .from('inventory_live')
    .select('sku, strain, product_name, name, unit, quality, brand, quantity');

  if (invError) {
    console.error(`   ❌ Failed to load inventory_live: ${invError.message}\n`);
    return;
  }

  console.log(`   ✓ Loaded ${inventory?.length || 0} inventory items\n`);

  const supabaseProducts = new Map();

  if (inventory) {
    for (const item of inventory) {
      const strain = item.strain || item.product_name || item.name || 'Unknown';
      const unit = item.unit || 'Unknown';
      const key = `${normalizeProductName(strain)}|${normalizeProductName(unit)}`;

      supabaseProducts.set(key, {
        sku: item.sku,
        strain,
        unit,
        quality: item.quality,
        brand: item.brand,
        quantity: item.quantity,
        normalizedName: normalizeProductName(strain)
      });
    }
  }

  // STEP 3: Load Supabase product_catalog (if it exists)
  console.log('🏷️  Step 3: Checking product_catalog...\n');

  const { data: catalog, error: catError } = await supabase
    .from('product_catalog')
    .select('*');

  if (catError) {
    console.log(`   ⚠️  product_catalog not available: ${catError.message}\n`);
  } else {
    console.log(`   ✓ Loaded ${catalog?.length || 0} catalog entries\n`);
  }

  // STEP 4: Compare CSV to Supabase
  console.log('🔍 Step 4: Comparing products...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const matched = [];
  const csvOnly = [];
  const supabaseOnly = [];
  const nameMismatches = [];

  // Check each CSV product against Supabase
  for (const [key, csvProduct] of csvProducts.entries()) {
    if (supabaseProducts.has(key)) {
      const supabaseProduct = supabaseProducts.get(key);
      matched.push({
        csv: csvProduct,
        supabase: supabaseProduct,
        key
      });
    } else {
      // Try fuzzy match
      let fuzzyMatch = null;
      for (const [sbKey, sbProduct] of supabaseProducts.entries()) {
        const csvName = csvProduct.normalizedName;
        const sbName = sbProduct.normalizedName;

        if (csvName.includes(sbName) || sbName.includes(csvName)) {
          fuzzyMatch = { key: sbKey, product: sbProduct };
          break;
        }
      }

      if (fuzzyMatch) {
        nameMismatches.push({
          csv: csvProduct,
          supabase: fuzzyMatch.product,
          csvKey: key,
          supabaseKey: fuzzyMatch.key
        });
      } else {
        csvOnly.push(csvProduct);
      }
    }
  }

  // Check for Supabase products not in CSV
  for (const [key, sbProduct] of supabaseProducts.entries()) {
    if (!csvProducts.has(key)) {
      // Check if it's in matched or nameMismatches
      const isMatched = matched.some(m => m.key === key) ||
                       nameMismatches.some(m => m.supabaseKey === key);

      if (!isMatched) {
        supabaseOnly.push(sbProduct);
      }
    }
  }

  // STEP 5: Report results
  console.log('✅ EXACT MATCHES:\n');
  console.log(`   Total: ${matched.length} products\n`);

  if (matched.length > 0 && matched.length <= 10) {
    matched.slice(0, 10).forEach(m => {
      console.log(`   • ${m.csv.strain} (${m.csv.unit})`);
      console.log(`     CSV: ${m.csv.sources.join(', ')}`);
      console.log(`     Supabase SKU: ${m.supabase.sku}`);
      console.log('');
    });
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('⚠️  NAME MISMATCHES (similar but not exact):\n');
  console.log(`   Total: ${nameMismatches.length} products\n`);

  nameMismatches.slice(0, 10).forEach(m => {
    console.log(`   CSV: "${m.csv.strain}" (${m.csv.unit})`);
    console.log(`   Supabase: "${m.supabase.strain}" (${m.supabase.unit})`);
    console.log(`   SKU: ${m.supabase.sku}`);
    console.log('');
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('❌ CSV ONLY (products in CSV but NOT in Supabase):\n');
  console.log(`   Total: ${csvOnly.length} products\n`);

  csvOnly.slice(0, 20).forEach(p => {
    console.log(`   • ${p.strain} (${p.unit})`);
    console.log(`     Category: ${p.category}`);
    console.log(`     Brand: ${p.brand || 'N/A'}`);
    console.log(`     Quality: ${p.quality || 'N/A'}`);
    console.log(`     Cost: ${p.cost || 'N/A'} | Retail: ${p.retail || 'N/A'}`);
    console.log(`     Source: ${p.sources.join(', ')}`);
    console.log('');
  });

  if (csvOnly.length > 20) {
    console.log(`   ... and ${csvOnly.length - 20} more\n`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('🆕 SUPABASE ONLY (products in Supabase but NOT in CSV):\n');
  console.log(`   Total: ${supabaseOnly.length} products\n`);

  supabaseOnly.slice(0, 20).forEach(p => {
    console.log(`   • ${p.strain} (${p.unit})`);
    console.log(`     SKU: ${p.sku}`);
    console.log(`     Brand: ${p.brand || 'N/A'}`);
    console.log(`     Quality: ${p.quality || 'N/A'}`);
    console.log(`     Quantity: ${p.quantity || 0}`);
    console.log('');
  });

  if (supabaseOnly.length > 20) {
    console.log(`   ... and ${supabaseOnly.length - 20} more\n`);
  }

  // STEP 6: Summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 SUMMARY:\n');
  console.log(`   CSV Products: ${totalCSVProducts}`);
  console.log(`   Supabase Products: ${supabaseProducts.size}`);
  console.log(`   ✅ Exact Matches: ${matched.length}`);
  console.log(`   ⚠️  Name Mismatches: ${nameMismatches.length}`);
  console.log(`   ❌ CSV Only: ${csvOnly.length}`);
  console.log(`   🆕 Supabase Only: ${supabaseOnly.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // STEP 7: Recommendations
  if (csvOnly.length > 0) {
    console.log('💡 RECOMMENDATIONS:\n');
    console.log(`1. ${csvOnly.length} products from CSV are missing in Supabase`);
    console.log('   → Review if these should be added to inventory_live\n');
  }

  if (supabaseOnly.length > 0) {
    console.log(`2. ${supabaseOnly.length} products in Supabase don't exist in original CSV`);
    console.log('   → These are likely new products added after CSV export\n');
  }

  if (nameMismatches.length > 0) {
    console.log(`3. ${nameMismatches.length} products have naming inconsistencies`);
    console.log('   → Consider standardizing product names between systems\n');
  }

  if (matched.length === totalCSVProducts && supabaseOnly.length === 0) {
    console.log('✅ PERFECT MATCH: All CSV products exist in Supabase!\n');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('⚠️  REMINDER: Supabase is SOURCE OF TRUTH');
  console.log('CSV files are reference material only. Do not overwrite Supabase.\n');
}

compareCSVToSupabase().catch(err => {
  console.error('\n❌ FATAL ERROR:');
  console.error(err.message);
  console.error(err.stack);
  process.exit(1);
});
