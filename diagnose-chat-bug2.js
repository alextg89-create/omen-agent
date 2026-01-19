/**
 * DIAGNOSE: Check snapshot history
 */

import 'dotenv/config';
import { listSnapshots } from './src/utils/snapshotHistory.js';

const STORE_ID = 'NJWeedWizard';

async function diagnose() {
  console.log('=== SNAPSHOT HISTORY CHECK ===\n');

  // List all snapshots
  const all = listSnapshots({ storeId: STORE_ID, limit: 10 });
  console.log('Total snapshots in index:', all.length);

  if (all.length > 0) {
    console.log('\nAll snapshots:');
    for (const s of all) {
      console.log(`  - store: ${s.store}, timeframe: ${s.timeframe}, date: ${s.asOfDate}`);
    }
  }

  // List for our store
  const forStore = listSnapshots({ storeId: STORE_ID, limit: 10 });
  console.log(`\nSnapshots for ${STORE_ID}:`, forStore.length);

  if (forStore.length > 0) {
    for (const s of forStore) {
      console.log(`  - timeframe: ${s.timeframe}, date: ${s.asOfDate}, hasData: ${!!s.data}`);
    }
  } else {
    console.log('❌ NO SNAPSHOTS FOR THIS STORE');
    console.log('Chat cannot find snapshot to read velocity from');
  }
}

diagnose()
  .then(() => console.log('\nDone'))
  .catch(err => console.error('Error:', err));
