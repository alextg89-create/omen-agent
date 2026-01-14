/**
 * TEST COMPLETE PARSER FIX
 * Simulates the full orderSyncService logic with string parsing
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testCompleteParserFix() {
  console.log('🔍 TESTING COMPLETE PARSER FIX\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Get recent webhook events
  const { data: events } = await supabase
    .from('webhook_events')
    .select('*')
    .eq('event_type', 'wix.order.created')
    .order('received_at', { ascending: false })
    .limit(3);

  if (!events || events.length === 0) {
    console.log('❌ No events found');
    return;
  }

  console.log(`Found ${events.length} webhook events\n`);

  let successCount = 0;
  let failCount = 0;

  for (const event of events) {
    console.log(`\n📦 Event ID: ${event.id}`);
    console.log(`   Received: ${event.received_at}`);

    try {
      let rawPayload = event.raw_payload;

      // STEP 1: Parse string to object
      if (typeof rawPayload === 'string') {
        console.log('   Type: STRING (needs parsing)');

        // Remove prefix
        const prefixMatch = rawPayload.match(/^Webhooks\s*→\s*Custom webhook\s*→\s*(.+)$/);
        if (prefixMatch) {
          rawPayload = prefixMatch[1];
          console.log('   ✓ Prefix removed');
        }

        // Parse JSON
        try {
          rawPayload = JSON.parse(rawPayload);
          console.log('   ✓ JSON parsed');
        } catch (parseError) {
          console.log(`   ❌ JSON parse failed: ${parseError.message}`);
          failCount++;
          continue;
        }
      }

      // STEP 2: Extract data (flat or wrapped)
      const data = rawPayload?.data || rawPayload;

      // STEP 3: Validate order data
      if (!data || !data.orderNumber) {
        console.log('   ❌ No valid order data');
        failCount++;
        continue;
      }

      console.log(`   ✅ Order Number: ${data.orderNumber}`);
      console.log(`   ✅ Line Items: ${data.lineItems?.length || 0}`);
      console.log(`   ✅ Payments: ${data.payments?.length || 0}`);

      if (data.lineItems && data.lineItems.length > 0) {
        const firstItem = data.lineItems[0];
        console.log(`   First Item: ${firstItem.itemName || 'Unknown'} (qty: ${firstItem.quantity || 1})`);
      }

      successCount++;

    } catch (err) {
      console.log(`   ❌ Error: ${err.message}`);
      failCount++;
    }
  }

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('RESULTS:');
  console.log(`  ✅ Success: ${successCount}/${events.length}`);
  console.log(`  ❌ Failed: ${failCount}/${events.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (successCount === events.length) {
    console.log('🎉 ALL EVENTS PARSED SUCCESSFULLY!');
    console.log('Parser fix is working correctly.\n');
  } else {
    console.log('⚠️  Some events still failing - review errors above\n');
  }
}

testCompleteParserFix().catch(console.error);
