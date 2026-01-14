/**
 * Check what's ACTUALLY in raw_payload column
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkPayload() {
  console.log('🔍 CHECKING ACTUAL PAYLOAD IN DATABASE\n');

  // Get the most recent webhook event
  const { data: events } = await supabase
    .from('webhook_events')
    .select('id, event_type, source, raw_payload, received_at')
    .eq('event_type', 'wix.order.created')
    .order('received_at', { ascending: false })
    .limit(3);

  if (!events || events.length === 0) {
    console.log('❌ No events found');
    return;
  }

  events.forEach((event, i) => {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`EVENT ${i + 1}:`);
    console.log(`ID: ${event.id}`);
    console.log(`Type: ${event.event_type}`);
    console.log(`Received: ${event.received_at}`);
    console.log(`\nraw_payload type: ${typeof event.raw_payload}`);

    if (typeof event.raw_payload === 'string') {
      console.log(`\nraw_payload string length: ${event.raw_payload.length} chars`);
      console.log(`\nFirst 1000 characters:`);
      console.log(event.raw_payload.substring(0, 1000));

      // Check if it starts with the prefix
      if (event.raw_payload.startsWith('Webhooks → Custom webhook →')) {
        console.log('\n✓ Has "Webhooks → Custom webhook →" prefix');
        const jsonPart = event.raw_payload.replace('Webhooks → Custom webhook →', '').trim();
        console.log(`\nJSON part length: ${jsonPart.length} chars`);
        console.log(`JSON part preview: ${jsonPart.substring(0, 200)}`);

        try {
          const parsed = JSON.parse(jsonPart);
          console.log('\n✅ JSON PARSED SUCCESSFULLY');
          console.log('Has data key:', !!parsed.data);
          console.log('Order number:', parsed.data?.orderNumber);
          console.log('Line items:', parsed.data?.lineItems?.length);
        } catch (err) {
          console.log('\n❌ JSON PARSE FAILED:', err.message);
        }
      } else if (event.raw_payload.startsWith('Webhooks → data')) {
        console.log('\n❌ Only has "Webhooks → data" - NO ACTUAL JSON');
      } else {
        console.log('\n⚠️  Unexpected format');
      }
    } else if (typeof event.raw_payload === 'object') {
      console.log('\nraw_payload is already an object:');
      console.log(JSON.stringify(event.raw_payload, null, 2).substring(0, 500));
    }
  });

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DIAGNOSIS COMPLETE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

checkPayload().catch(console.error);
