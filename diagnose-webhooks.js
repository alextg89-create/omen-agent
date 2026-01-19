/**
 * Diagnose webhook_events raw_payload shapes
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://kaqnpprkwyxqwmumtmmh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY'
);

async function diagnose() {
  const { data: all } = await supabase
    .from('webhook_events')
    .select('id, raw_payload')
    .eq('event_type', 'wix.order.created');

  console.log('=== ANALYZING ALL ROWS ===\n');

  let alreadyFixed = 0;
  let needsFix = 0;
  let noise = 0;

  for (const row of all || []) {
    const rp = row.raw_payload;
    const typeOf = typeof rp;

    if (typeOf === 'object' && rp !== null) {
      // Already a JSON object - check if it has order data
      if (rp.orderNumber || rp.data?.orderNumber) {
        alreadyFixed++;
        console.log('ID:', row.id, '-> ALREADY FIXED (object with orderNumber)');
      } else {
        console.log('ID:', row.id, '-> OBJECT but no orderNumber, keys:', Object.keys(rp).slice(0, 5));
      }
    } else if (typeOf === 'string') {
      const rpStr = rp;
      if (rpStr.includes('Custom webhook')) {
        needsFix++;
        console.log('ID:', row.id, '-> NEEDS FIX (string with embedded JSON)');
      } else if (rpStr === 'Webhooks → data' || rpStr.length < 50) {
        noise++;
        console.log('ID:', row.id, '-> NOISE (short string):', rpStr.substring(0, 50));
      } else {
        console.log('ID:', row.id, '-> UNKNOWN STRING:', rpStr.substring(0, 100));
      }
    } else {
      console.log('ID:', row.id, '-> UNKNOWN TYPE:', typeOf);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log('Already fixed (proper JSON):', alreadyFixed);
  console.log('Needs fix (string with JSON):', needsFix);
  console.log('Noise (skip):', noise);
  console.log('Total:', (all || []).length);
}

diagnose().catch(console.error);
