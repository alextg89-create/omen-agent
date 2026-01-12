/**
 * Test order sync from webhook_events
 */

// Set environment for testing
process.env.OMEN_USE_SUPABASE = 'true';
process.env.SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
process.env.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

import { syncOrdersFromWebhooks } from './src/services/orderSyncService.js';

async function test() {
  console.log('🔄 Testing order sync from webhook_events...\n');

  const result = await syncOrdersFromWebhooks(30); // Last 30 days

  console.log('\n📊 RESULTS:');
  console.log(`  Synced: ${result.synced} order items`);
  console.log(`  Skipped: ${result.skipped} duplicates`);
  console.log(`  Errors: ${result.errors}`);

  if (result.synced > 0) {
    console.log('\n✅ SUCCESS! Orders table now has velocity data');
    console.log('OMEN can now generate velocity-driven recommendations');
  }
}

test().catch(console.error);
