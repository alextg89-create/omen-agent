/**
 * FINAL TRUTH CHECK
 *
 * Verifies:
 * 1. 100% SKU match rate
 * 2. Orders table has correct timestamps
 * 3. TemporalAnalyzer returns data
 * 4. Velocity metrics are generated
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { analyzeInventoryVelocity } from './src/intelligence/temporalAnalyzer.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing Supabase env vars');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function finalTruthCheck() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║               FINAL TRUTH CHECK                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const results = {
    skuMatchRate: false,
    ordersHaveTimestamps: false,
    temporalAnalyzerWorks: false,
    velocityMetricsGenerated: false
  };

  // CHECK 1: SKU Match Rate
  console.log('CHECK 1: SKU Match Rate');
  console.log('─────────────────────────────────────────');

  const { data: orders } = await supabase.from('orders').select('sku');
  const { data: inventory } = await supabase.from('inventory_live').select('sku');

  const invSkus = new Set(inventory.map(i => i.sku));
  let matched = 0;
  let unmatched = 0;
  const unmatchedSkus = [];

  for (const o of orders) {
    if (invSkus.has(o.sku)) {
      matched++;
    } else {
      unmatched++;
      if (!unmatchedSkus.includes(o.sku)) {
        unmatchedSkus.push(o.sku);
      }
    }
  }

  const matchRate = (matched / orders.length) * 100;
  console.log(`  Orders: ${orders.length}`);
  console.log(`  Inventory SKUs: ${inventory.length}`);
  console.log(`  Matched: ${matched}`);
  console.log(`  Unmatched: ${unmatched}`);
  console.log(`  Match Rate: ${matchRate.toFixed(1)}%`);

  if (matchRate === 100) {
    console.log('  ✅ PASS: 100% SKU match rate\n');
    results.skuMatchRate = true;
  } else {
    console.log('  ❌ FAIL: Not 100% match rate');
    console.log('  Unmatched SKUs:', unmatchedSkus.slice(0, 5).join(', '));
    console.log('');
  }

  // CHECK 2: Orders have proper timestamps
  console.log('CHECK 2: Orders have proper timestamps');
  console.log('─────────────────────────────────────────');

  const { data: orderDates } = await supabase
    .from('orders')
    .select('id, order_date, created_at')
    .order('order_date', { ascending: false })
    .limit(5);

  let hasValidDates = true;
  for (const o of orderDates) {
    const orderDate = o.order_date ? new Date(o.order_date) : null;
    if (!orderDate || isNaN(orderDate.getTime())) {
      hasValidDates = false;
      console.log(`  ❌ Order ${o.id}: invalid order_date`);
    }
  }

  if (hasValidDates) {
    console.log(`  Sample timestamps:`);
    for (const o of orderDates.slice(0, 3)) {
      console.log(`    Order ${o.id}: ${o.order_date}`);
    }
    console.log('  ✅ PASS: Orders have valid timestamps\n');
    results.ordersHaveTimestamps = true;
  } else {
    console.log('  ❌ FAIL: Some orders have invalid timestamps\n');
  }

  // CHECK 3: TemporalAnalyzer works
  console.log('CHECK 3: TemporalAnalyzer returns data');
  console.log('─────────────────────────────────────────');

  const { data: fullInventory } = await supabase.from('inventory_live').select('*');
  const analysis = await analyzeInventoryVelocity(fullInventory, 'weekly');

  console.log(`  ok: ${analysis.ok}`);
  console.log(`  hasData: ${analysis.hasData}`);
  console.log(`  orderCount: ${analysis.orderCount}`);
  console.log(`  lineItemCount: ${analysis.lineItemCount}`);
  console.log(`  uniqueSKUs: ${analysis.uniqueSKUs}`);

  if (analysis.ok && analysis.hasData && analysis.lineItemCount > 0) {
    console.log('  ✅ PASS: TemporalAnalyzer returns data\n');
    results.temporalAnalyzerWorks = true;
  } else {
    console.log('  ❌ FAIL: TemporalAnalyzer not returning data\n');
  }

  // CHECK 4: Velocity metrics generated
  console.log('CHECK 4: Velocity metrics generated');
  console.log('─────────────────────────────────────────');

  const metricsCount = analysis.velocityMetrics?.length || 0;
  const insightsCount = analysis.insights?.length || 0;

  console.log(`  Velocity metrics: ${metricsCount}`);
  console.log(`  Insights generated: ${insightsCount}`);

  if (metricsCount > 0) {
    console.log(`  Top velocity item: ${analysis.velocityMetrics[0].sku}`);
    console.log(`    Sold: ${analysis.velocityMetrics[0].totalSold} units`);
    console.log(`    Velocity: ${analysis.velocityMetrics[0].dailyVelocity}/day`);
    console.log('  ✅ PASS: Velocity metrics generated\n');
    results.velocityMetricsGenerated = true;
  } else {
    console.log('  ❌ FAIL: No velocity metrics\n');
  }

  // FINAL SUMMARY
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║               FINAL RESULTS                                ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const allPass = Object.values(results).every(v => v);

  console.log(`  SKU Match Rate:           ${results.skuMatchRate ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Orders Timestamps:        ${results.ordersHaveTimestamps ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  TemporalAnalyzer Works:   ${results.temporalAnalyzerWorks ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Velocity Metrics:         ${results.velocityMetricsGenerated ? '✅ PASS' : '❌ FAIL'}`);
  console.log('');

  if (allPass) {
    console.log('  ════════════════════════════════════════');
    console.log('  ║  ALL CHECKS PASSED - SYSTEM VERIFIED  ║');
    console.log('  ════════════════════════════════════════');
  } else {
    console.log('  ════════════════════════════════════════');
    console.log('  ║  SOME CHECKS FAILED - REVIEW ABOVE    ║');
    console.log('  ════════════════════════════════════════');
    process.exit(1);
  }
}

finalTruthCheck()
  .then(() => {
    console.log('\nDone');
    process.exit(0);
  })
  .catch(err => {
    console.error('FAILED:', err);
    process.exit(1);
  });
