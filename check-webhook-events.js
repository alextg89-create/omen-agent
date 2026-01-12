/**
 * Check webhook_events table for order data
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkWebhookEvents() {
  console.log('🔍 Checking webhook_events for orders...\n');

  // Get order events
  const { data: events, error } = await supabase
    .from('webhook_events')
    .select('*')
    .eq('event_type', 'wix.order.created')
    .order('received_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('❌ ERROR:', error.message);
    process.exit(1);
  }

  console.log(`📦 Found ${events.length} order events\n`);

  if (events.length === 0) {
    console.log('⚠️  No order events found');
    return;
  }

  // Parse first event to see structure
  console.log('📋 Sample order event:\n');
  const sample = events[0];

  console.log('Event ID:', sample.id);
  console.log('Event Type:', sample.event_type);
  console.log('Received At:', sample.received_at);
  console.log('\nRaw Payload Structure:');
  console.log(JSON.stringify(sample.raw_payload, null, 2).slice(0, 2000)); // First 2000 chars

  // Try to extract order details
  console.log('\n\n🎯 EXTRACTING ORDER DATA:\n');

  events.forEach((event, idx) => {
    const payload = event.raw_payload;
    const data = payload?.data;

    if (data) {
      console.log(`\nOrder ${idx + 1}:`);
      console.log('  Order Number:', data.orderNumber);
      console.log('  Created:', data.payments?.[0]?.createdDate);
      console.log('  Total:', data.payments?.[0]?.amount?.value, data.payments?.[0]?.amount?.currency);
      console.log('  Line Items:', data.lineItems?.length || 0);

      if (data.lineItems && data.lineItems.length > 0) {
        data.lineItems.forEach((item, i) => {
          console.log(`    Item ${i + 1}:`, item.productName?.original || 'Unknown');
          console.log(`      Quantity:`, item.quantity);
          console.log(`      Price:`, item.price);
        });
      }
    }
  });

  console.log('\n\n✅ SOLUTION: OMEN needs to read webhook_events and parse raw_payload');
}

checkWebhookEvents().catch(console.error);
