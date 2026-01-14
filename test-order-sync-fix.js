/**
 * TEST ORDER SYNC WITH FIXED PARSER
 * Verify the flat JSON structure is now handled correctly
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testParserFix() {
  console.log('🔍 TESTING ORDER SYNC PARSER FIX\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Get one webhook event
  const { data: events } = await supabase
    .from('webhook_events')
    .select('*')
    .eq('event_type', 'wix.order.created')
    .limit(1);

  if (!events || events.length === 0) {
    console.log('❌ No events found');
    return;
  }

  const event = events[0];
  console.log('Event ID:', event.id);
  console.log('Received at:', event.received_at);

  const payload = event.raw_payload;

  // SIMULATE FIXED PARSER LOGIC
  console.log('\n📊 Testing FIXED parser logic:\n');

  const data = payload?.data || payload;  // ← THE FIX

  console.log('Step 1: Extract data');
  console.log(`  payload?.data exists: ${!!payload?.data}`);
  console.log(`  payload exists: ${!!payload}`);
  console.log(`  data assigned: ${!!data}`);

  console.log('\nStep 2: Check orderNumber');
  console.log(`  data.orderNumber: ${data?.orderNumber || 'MISSING'}`);

  if (!data || !data.orderNumber) {
    console.log('\n❌ WOULD SKIP: No valid order data');
  } else {
    console.log('\n✅ WOULD PROCESS');
    console.log(`  Order Number: ${data.orderNumber}`);
    console.log(`  Line Items: ${data.lineItems?.length || 0}`);
    console.log(`  Payments: ${data.payments?.length || 0}`);

    if (data.lineItems && data.lineItems.length > 0) {
      console.log('\n  First line item:');
      const item = data.lineItems[0];
      console.log(`    Name: ${item.itemName || item.productName?.original || 'Unknown'}`);
      console.log(`    Quantity: ${item.quantity || 1}`);
      console.log(`    Price: $${item.totalPrice?.value || 0}`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PARSER FIX TEST COMPLETE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

testParserFix().catch(console.error);
