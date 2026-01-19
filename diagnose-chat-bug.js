/**
 * DIAGNOSE: Why chat says "without velocity" when velocity exists
 */

import 'dotenv/config';
import { getLatestSnapshotEntry } from './src/utils/snapshotHistory.js';
import { loadSnapshot } from './src/utils/snapshotCache.js';

const STORE_ID = 'NJWeedWizard';

async function diagnose() {
  console.log('=== DIAGNOSING CHAT VELOCITY BUG ===\n');

  // Get exactly what chat would get (FIXED VERSION)
  const latestSnapshotEntry = getLatestSnapshotEntry(STORE_ID);
  let snapshot = null;

  if (latestSnapshotEntry) {
    console.log('Index entry found:', {
      timeframe: latestSnapshotEntry.timeframe,
      asOfDate: latestSnapshotEntry.asOfDate
    });
    // Load actual snapshot data from disk
    const loaded = loadSnapshot(STORE_ID, latestSnapshotEntry.timeframe, latestSnapshotEntry.asOfDate);
    snapshot = loaded?.data || null;
  }

  if (!snapshot) {
    console.log('❌ NO SNAPSHOT FOUND');
    console.log('This is the bug - chat has no snapshot to read from');
    return;
  }

  console.log('Snapshot found:', {
    generatedAt: snapshot.generatedAt,
    timeframe: snapshot.timeframe
  });

  // Check velocity
  console.log('\n--- VELOCITY CHECK ---');
  console.log('snapshot.velocity:', snapshot.velocity ? 'EXISTS' : 'MISSING');
  if (snapshot.velocity) {
    console.log('  orderCount:', snapshot.velocity.orderCount);
    console.log('  uniqueSKUs:', snapshot.velocity.uniqueSKUs);
    console.log('  lineItemCount:', snapshot.velocity.lineItemCount);
    console.log('  insights count:', snapshot.velocity.insights?.length || 0);
  }

  // Check recommendations
  console.log('\n--- RECOMMENDATIONS CHECK ---');
  console.log('snapshot.recommendations:', snapshot.recommendations ? 'EXISTS' : 'MISSING');
  if (snapshot.recommendations) {
    console.log('  promotions:', snapshot.recommendations.promotions?.length || 0);
    console.log('  inventory:', snapshot.recommendations.inventory?.length || 0);
    console.log('  pricing:', snapshot.recommendations.pricing?.length || 0);

    if (snapshot.recommendations.promotions?.length > 0) {
      console.log('\n  First promotion:');
      const p = snapshot.recommendations.promotions[0];
      console.log('    name:', p.name);
      console.log('    reason:', p.reason);
      console.log('    type:', p.signalType);
    }
  }

  // Check metrics
  console.log('\n--- METRICS CHECK ---');
  console.log('snapshot.metrics:', snapshot.metrics ? 'EXISTS' : 'MISSING');
  if (snapshot.metrics) {
    console.log('  highestMarginItem:', snapshot.metrics.highestMarginItem?.name || 'MISSING');
    console.log('  itemsWithPricing:', snapshot.metrics.itemsWithPricing || 0);
  }

  // Simulate chatContext construction
  console.log('\n--- SIMULATED chatContext ---');
  const chatContext = {
    snapshot,
    hasVelocity: !!(snapshot?.velocity && snapshot.velocity.orderCount > 0),
    velocity: snapshot?.velocity || null,
    recommendations: snapshot?.recommendations || null,
    metrics: snapshot?.metrics || null,
    highestMarginItem: snapshot?.metrics?.highestMarginItem || null,
    itemsWithPricing: snapshot?.metrics?.itemsWithPricing || 0
  };

  console.log('hasVelocity:', chatContext.hasVelocity);
  console.log('recommendations.promotions.length:', chatContext.recommendations?.promotions?.length || 0);
  console.log('highestMarginItem:', chatContext.highestMarginItem?.name || 'MISSING');

  // THE KEY QUESTION
  console.log('\n=== ROOT CAUSE ANALYSIS ===');

  if (!chatContext.hasVelocity) {
    console.log('❌ hasVelocity is FALSE - this is why chat says "without velocity"');
    console.log('   But velocity.orderCount =', snapshot.velocity?.orderCount);
  } else if (chatContext.recommendations?.promotions?.length === 0) {
    console.log('⚠️ hasVelocity is TRUE but promotions array is EMPTY');
    console.log('   This means no items met HIGH_VELOCITY or ACCELERATING_DEMAND thresholds');
    console.log('   Chat will fall through to Strategy 2 which SHOULD check hasVelocity');
    console.log('   If chat still says "without velocity", the bug is in chatIntelligence.js line 247');
  } else {
    console.log('✓ hasVelocity is TRUE and promotions exist');
    console.log('   Chat should be using velocity-based language');
  }
}

diagnose()
  .then(() => console.log('\nDone'))
  .catch(err => console.error('Error:', err));
