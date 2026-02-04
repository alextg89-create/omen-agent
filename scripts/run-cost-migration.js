/**
 * Execute SKU Cost Migration against Supabase
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('========================================');
  console.log('SKU COST MIGRATION');
  console.log('========================================\n');

  // Read the cost data from the generated SQL file to extract values
  const sqlPath = path.join(__dirname, '..', 'migrations', '005_sku_costs_data.sql');
  const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

  // Parse INSERT values from SQL
  const insertMatch = sqlContent.match(/INSERT INTO public\.sku_costs.*?VALUES\s*([\s\S]*?);/);
  if (!insertMatch) {
    console.error('ERROR: Could not parse INSERT statement from SQL file');
    process.exit(1);
  }

  // Extract individual value rows
  const valuesBlock = insertMatch[1];
  const rowPattern = /\('([^']+(?:''[^']*)*)', ([\d.]+), NOW\(\), '([^']+)'\)/g;

  const costs = [];
  let match;
  while ((match = rowPattern.exec(valuesBlock)) !== null) {
    costs.push({
      sku: match[1].replace(/''/g, "'"),  // Unescape single quotes
      unit_cost: parseFloat(match[2]),
      source: match[3]
    });
  }

  console.log(`Parsed ${costs.length} SKU costs from migration file\n`);

  // Step 1: Truncate existing data
  console.log('Step 1: Clearing existing sku_costs data...');
  const { error: truncateError } = await supabase
    .from('sku_costs')
    .delete()
    .neq('sku', '___never_match___');  // Delete all rows

  if (truncateError) {
    console.error('WARNING: Truncate failed:', truncateError.message);
    console.log('Continuing with upsert...\n');
  } else {
    console.log('✅ Existing data cleared\n');
  }

  // Step 2: Insert costs in batches
  console.log('Step 2: Inserting SKU costs...');
  const batchSize = 50;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < costs.length; i += batchSize) {
    const batch = costs.slice(i, i + batchSize).map(c => ({
      sku: c.sku,
      unit_cost: c.unit_cost,
      effective_date: new Date().toISOString(),
      source: c.source
    }));

    const { error } = await supabase
      .from('sku_costs')
      .upsert(batch, { onConflict: 'sku' });

    if (error) {
      console.error(`  Batch ${Math.floor(i/batchSize) + 1} failed:`, error.message);
      errors++;
    } else {
      inserted += batch.length;
      process.stdout.write(`  Inserted ${inserted}/${costs.length} SKUs\r`);
    }
  }

  console.log(`\n✅ Inserted ${inserted} SKU costs (${errors} batch errors)\n`);

  // Step 3: Verify
  console.log('Step 3: Verifying import...');

  const { count: costCount } = await supabase
    .from('sku_costs')
    .select('*', { count: 'exact', head: true });

  const { count: inventoryCount } = await supabase
    .from('wix_inventory_live')
    .select('*', { count: 'exact', head: true });

  // Get matched count via RPC or manual query
  const { data: costData } = await supabase
    .from('sku_costs')
    .select('sku');

  const { data: inventoryData } = await supabase
    .from('wix_inventory_live')
    .select('sku');

  const costSkus = new Set(costData?.map(r => r.sku) || []);
  const inventorySkus = new Set(inventoryData?.map(r => r.sku) || []);

  let matched = 0;
  for (const sku of inventorySkus) {
    if (costSkus.has(sku)) matched++;
  }

  const coverage = inventoryCount > 0 ? ((matched / inventoryCount) * 100).toFixed(1) : 0;

  console.log('\n========================================');
  console.log('VERIFICATION RESULTS');
  console.log('========================================');
  console.log(`Total costs in sku_costs: ${costCount}`);
  console.log(`Total SKUs in inventory: ${inventoryCount}`);
  console.log(`Matched SKUs: ${matched}`);
  console.log(`Cost coverage: ${coverage}%`);
  console.log('========================================\n');

  // List unmapped SKUs
  const unmapped = [...inventorySkus].filter(sku => !costSkus.has(sku));
  if (unmapped.length > 0) {
    console.log(`UNMAPPED SKUs (${unmapped.length}):`);
    unmapped.forEach(sku => console.log(`  - ${sku}`));
  }

  console.log('\n✅ Migration complete!');
}

runMigration().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
