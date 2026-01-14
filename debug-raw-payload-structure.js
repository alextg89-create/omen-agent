/**
 * DEBUG: Check actual structure of raw_payload in webhook_events
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function debug() {
  console.log('🔍 CHECKING RAW_PAYLOAD STRUCTURE\n');

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
  console.log('Event Type:', event.event_type);
  console.log('Source:', event.source);
  console.log('\nraw_payload TYPE:', typeof event.raw_payload);
  console.log('\nraw_payload VALUE:');

  if (typeof event.raw_payload === 'string') {
    console.log('  -> It\'s a STRING');
    console.log('  -> First 500 chars:', event.raw_payload.substring(0, 500));

    // Try to parse it
    try {
      const parsed = JSON.parse(event.raw_payload);
      console.log('\n✅ JSON.parse() succeeded');
      console.log('Parsed keys:', Object.keys(parsed));
    } catch (err) {
      console.log('\n❌ JSON.parse() FAILED:', err.message);
    }
  } else if (typeof event.raw_payload === 'object') {
    console.log('  -> It\'s an OBJECT');
    console.log('  -> Keys:', Object.keys(event.raw_payload));
    console.log('  -> Full object:', JSON.stringify(event.raw_payload, null, 2).substring(0, 500));
  } else {
    console.log('  -> Unexpected type:', typeof event.raw_payload);
  }

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DIAGNOSIS COMPLETE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

debug().catch(console.error);
