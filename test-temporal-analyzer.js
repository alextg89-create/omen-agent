/**
 * TEST TEMPORAL ANALYZER
 * Verifies velocity analysis works with 100% SKU match rate
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { analyzeInventoryVelocity, formatInsightsForDisplay } from './src/intelligence/temporalAnalyzer.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing Supabase env vars');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testTemporalAnalyzer() {
  console.log('=== TEST TEMPORAL ANALYZER ===\n');

  // Load current inventory
  const { data: inventory, error: invError } = await supabase
    .from('inventory_live')
    .select('*');

  if (invError) {
    console.error('Failed to load inventory:', invError.message);
    process.exit(1);
  }

  console.log(`Loaded ${inventory.length} inventory items\n`);

  // Run temporal analysis
  console.log('--- WEEKLY ANALYSIS ---\n');

  const result = await analyzeInventoryVelocity(inventory, 'weekly');

  console.log('Result:', JSON.stringify({
    ok: result.ok,
    hasData: result.hasData,
    timeframe: result.timeframe,
    orderCount: result.orderCount,
    lineItemCount: result.lineItemCount,
    uniqueSKUs: result.uniqueSKUs,
    insightsCount: result.insights?.length || 0,
    velocityMetricsCount: result.velocityMetrics?.length || 0
  }, null, 2));

  if (result.velocityMetrics && result.velocityMetrics.length > 0) {
    console.log('\n--- TOP 5 VELOCITY METRICS ---\n');
    for (const m of result.velocityMetrics.slice(0, 5)) {
      console.log(`  ${m.sku}`);
      console.log(`    Name: ${m.name}`);
      console.log(`    Sold: ${m.totalSold} units`);
      console.log(`    Velocity: ${m.dailyVelocity}/day`);
      console.log(`    Stock: ${m.currentStock}`);
      console.log(`    Days to stockout: ${m.daysUntilStockout || 'N/A'}`);
      console.log('');
    }
  }

  if (result.insights && result.insights.length > 0) {
    console.log('\n--- INSIGHTS ---\n');
    console.log(formatInsightsForDisplay(result.insights));
  } else {
    console.log('\n--- NO INSIGHTS GENERATED ---');
    console.log('This is expected if no items meet insight thresholds.');
  }

  // Verify SKU matching
  console.log('\n--- SKU MATCH VERIFICATION ---\n');

  const invSkus = new Set(inventory.map(i => i.sku));
  let matchedMetrics = 0;
  let unmatchedMetrics = 0;

  for (const m of result.velocityMetrics || []) {
    if (invSkus.has(m.sku)) {
      matchedMetrics++;
    } else {
      unmatchedMetrics++;
      console.log(`WARNING: Metric SKU not in inventory: ${m.sku}`);
    }
  }

  console.log(`Velocity metrics matched to inventory: ${matchedMetrics}/${matchedMetrics + unmatchedMetrics}`);

  if (unmatchedMetrics === 0 && matchedMetrics > 0) {
    console.log('\nTEMPORAL ANALYZER VERIFIED OK');
  } else if (matchedMetrics === 0 && result.velocityMetrics?.length === 0) {
    console.log('\nWARNING: No velocity metrics generated');
    console.log('Check if orders exist in the date range');
  }
}

testTemporalAnalyzer()
  .then(() => {
    console.log('\nDone');
    process.exit(0);
  })
  .catch(err => {
    console.error('FAILED:', err);
    process.exit(1);
  });
