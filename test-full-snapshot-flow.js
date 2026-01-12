/**
 * FULL SNAPSHOT FLOW TEST
 * Simulates exactly what happens when user clicks "Generate Snapshot"
 */

process.env.OMEN_USE_SUPABASE = 'true';
process.env.SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
process.env.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

import { analyzeInventoryVelocity } from './src/intelligence/temporalAnalyzer.js';
import { getInventory } from './src/tools/inventoryStore.js';

async function testSnapshotFlow() {
  console.log('🔍 TESTING FULL SNAPSHOT FLOW\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // 1. Load inventory (same as OMEN does)
    console.log('📦 Step 1: Loading inventory...');
    const inventory = await getInventory('NJWeedWizard');
    console.log(`   ✓ Loaded ${inventory.length} items\n`);

    // 2. Test DAILY velocity analysis
    console.log('📊 Step 2: Testing DAILY velocity analysis...');
    const dailyAnalysis = await analyzeInventoryVelocity(inventory, 'daily');

    console.log(`   Result: ${dailyAnalysis.ok ? '✓ SUCCESS' : '✗ FAILED'}`);
    console.log(`   Orders found: ${dailyAnalysis.orderCount || 0}`);
    console.log(`   Insights generated: ${dailyAnalysis.insights?.length || 0}`);

    if (dailyAnalysis.insights && dailyAnalysis.insights.length > 0) {
      console.log(`\n   Daily insights:`);
      dailyAnalysis.insights.forEach(insight => {
        console.log(`     - ${insight.type}: ${insight.name}`);
      });
    } else {
      console.log(`   ⚠️  NO INSIGHTS (reason: ${dailyAnalysis.error || 'unknown'})`);
    }

    // 3. Test WEEKLY velocity analysis
    console.log('\n📊 Step 3: Testing WEEKLY velocity analysis...');
    const weeklyAnalysis = await analyzeInventoryVelocity(inventory, 'weekly');

    console.log(`   Result: ${weeklyAnalysis.ok ? '✓ SUCCESS' : '✗ FAILED'}`);
    console.log(`   Orders found: ${weeklyAnalysis.orderCount || 0}`);
    console.log(`   Insights generated: ${weeklyAnalysis.insights?.length || 0}`);

    if (weeklyAnalysis.insights && weeklyAnalysis.insights.length > 0) {
      console.log(`\n   Weekly insights:`);
      weeklyAnalysis.insights.forEach(insight => {
        console.log(`     - ${insight.type}: ${insight.name} (${insight.priority})`);
      });
    } else {
      console.log(`   ⚠️  NO INSIGHTS (reason: ${weeklyAnalysis.error || 'unknown'})`);
    }

    // 4. Compare Daily vs Weekly
    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 DAILY vs WEEKLY COMPARISON');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`Daily orders:   ${dailyAnalysis.orderCount || 0}`);
    console.log(`Weekly orders:  ${weeklyAnalysis.orderCount || 0}`);
    console.log(`Daily insights: ${dailyAnalysis.insights?.length || 0}`);
    console.log(`Weekly insights: ${weeklyAnalysis.insights?.length || 0}`);

    if (dailyAnalysis.orderCount === weeklyAnalysis.orderCount) {
      console.log('\n⚠️  WARNING: Daily and Weekly have SAME order count');
      console.log('   This means either:');
      console.log('   1. All orders are from last 24h (unlikely)');
      console.log('   2. Date filtering is broken');
    }

    if ((dailyAnalysis.insights?.length || 0) === (weeklyAnalysis.insights?.length || 0)) {
      console.log('\n⚠️  WARNING: Daily and Weekly have SAME insight count');
      console.log('   Snapshots will look identical (BAD UX)');
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('DIAGNOSIS COMPLETE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (err) {
    console.error('\n❌ FATAL ERROR:');
    console.error(err.message);
    console.error(err.stack);
  }
}

testSnapshotFlow();
