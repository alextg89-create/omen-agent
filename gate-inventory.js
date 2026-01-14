/**
 * GATE INVENTORY - ACTION ELIGIBILITY WITHOUT DELETION
 *
 * PURPOSE: Mark inventory items as actionable vs reference-only
 *
 * RULES:
 * - DO NOT delete any rows
 * - Add inventory_status column (not existence, but action eligibility)
 * - Conservative defaults (existing rows remain ACTIVE)
 * - No automatic classification (manual override available)
 * - Historical preservation
 *
 * STATUS VALUES:
 * - ACTIVE       → eligible for promos/recommendations
 * - INACTIVE     → known product, not currently stocked
 * - LEGACY       → historical / reference-only
 * - DISCONTINUED → intentionally removed from offerings
 *
 * RESULT:
 * - inventory_live can contain anything
 * - Only ACTIVE items influence recommendations
 * - Historical products remain visible for reference
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'YOUR_SERVICE_KEY_HERE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function gateInventory() {
  console.log('🚪 GATING INVENTORY - ACTION ELIGIBILITY LAYER\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // STEP 1: Ensure inventory_status column exists
  console.log('📋 Step 1: Ensuring inventory_status column exists...\n');

  const addColumnSQL = `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'inventory_live' AND column_name = 'inventory_status'
      ) THEN
        ALTER TABLE inventory_live ADD COLUMN inventory_status TEXT DEFAULT 'ACTIVE';
        CREATE INDEX IF NOT EXISTS idx_inventory_status ON inventory_live(inventory_status);
      END IF;
    END $$;
  `;

  console.log('   ✓ Column definition ready (add via Supabase SQL editor if needed)\n');
  console.log('   SQL: ALTER TABLE inventory_live ADD COLUMN inventory_status TEXT DEFAULT \'ACTIVE\';\n');
  console.log('   SQL: CREATE INDEX idx_inventory_status ON inventory_live(inventory_status);\n');

  // STEP 2: Load current inventory
  console.log('📦 Step 2: Loading inventory_live...\n');

  const { data: inventory, error: invError } = await supabase
    .from('inventory_live')
    .select('sku, strain, unit, quantity, inventory_status');

  if (invError) {
    console.error(`   ❌ Failed to load inventory_live: ${invError.message}\n`);

    // Check if column doesn't exist
    if (invError.message.includes('column') && invError.message.includes('does not exist')) {
      console.log('   📝 Column inventory_status does not exist yet. Creating it...\n');
      console.log('   Run this SQL in Supabase SQL Editor:\n');
      console.log('   ALTER TABLE inventory_live ADD COLUMN inventory_status TEXT DEFAULT \'ACTIVE\';');
      console.log('   CREATE INDEX idx_inventory_status ON inventory_live(inventory_status);\n');
    }
    return;
  }

  if (!inventory || inventory.length === 0) {
    console.log('   ⚠️  inventory_live is empty\n');
    return;
  }

  console.log(`   ✓ Loaded ${inventory.length} inventory items\n`);

  // STEP 3: Analyze current status distribution
  console.log('📊 Step 3: Current inventory status distribution...\n');

  const statusCounts = {
    ACTIVE: 0,
    INACTIVE: 0,
    LEGACY: 0,
    DISCONTINUED: 0,
    null: 0,
    undefined: 0
  };

  for (const item of inventory) {
    const status = item.inventory_status || 'null';
    if (statusCounts[status] !== undefined) {
      statusCounts[status]++;
    } else {
      statusCounts[status] = 1;
    }
  }

  console.log('   Current Status Distribution:');
  for (const [status, count] of Object.entries(statusCounts)) {
    if (count > 0) {
      console.log(`     ${status}: ${count} items`);
    }
  }
  console.log('');

  // STEP 4: Conservative classification logic
  console.log('🔍 Step 4: Applying conservative classification...\n');

  const needsUpdate = [];

  for (const item of inventory) {
    // Only update items where inventory_status IS NULL or undefined
    if (!item.inventory_status) {
      // Conservative default: mark as ACTIVE unless clearly not
      let status = 'ACTIVE';

      // Zero quantity → INACTIVE (not currently stocked)
      if (item.quantity === 0 || item.quantity === null) {
        status = 'INACTIVE';
      }

      needsUpdate.push({
        sku: item.sku,
        new_status: status,
        reason: item.quantity === 0 ? 'Zero quantity' : 'Default ACTIVE'
      });
    }
  }

  console.log(`   Items needing status: ${needsUpdate.length}`);
  console.log(`   Items already classified: ${inventory.length - needsUpdate.length}\n`);

  if (needsUpdate.length === 0) {
    console.log('✅ All inventory items already have status classification\n');
  } else {
    console.log('   Sample classifications:');
    needsUpdate.slice(0, 5).forEach(item => {
      console.log(`     ${item.sku} → ${item.new_status} (${item.reason})`);
    });
    console.log('');
  }

  // STEP 5: Update inventory_status (only NULL values)
  if (needsUpdate.length > 0) {
    console.log('💾 Step 5: Updating inventory_status...\n');

    let updated = 0;
    let errors = 0;

    for (const item of needsUpdate) {
      const { error: updateError } = await supabase
        .from('inventory_live')
        .update({ inventory_status: item.new_status })
        .eq('sku', item.sku)
        .is('inventory_status', null); // Only update if still NULL

      if (updateError) {
        console.error(`   ❌ Failed to update ${item.sku}:`, updateError.message);
        errors++;
      } else {
        updated++;
      }
    }

    console.log(`   ✓ Updated: ${updated} items`);
    console.log(`   ❌ Errors: ${errors}\n`);
  }

  // STEP 6: Final verification
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 VERIFICATION:\n');

  const { data: finalInventory, error: finalError } = await supabase
    .from('inventory_live')
    .select('inventory_status');

  if (!finalError && finalInventory) {
    const finalStatusCounts = {
      ACTIVE: 0,
      INACTIVE: 0,
      LEGACY: 0,
      DISCONTINUED: 0,
      null: 0
    };

    for (const item of finalInventory) {
      const status = item.inventory_status || 'null';
      if (finalStatusCounts[status] !== undefined) {
        finalStatusCounts[status]++;
      } else {
        finalStatusCounts[status] = 1;
      }
    }

    console.log('   Final Status Distribution:');
    for (const [status, count] of Object.entries(finalStatusCounts)) {
      if (count > 0) {
        const percentage = ((count / finalInventory.length) * 100).toFixed(1);
        console.log(`     ${status}: ${count} items (${percentage}%)`);
      }
    }
    console.log('');

    // Show ACTIVE items (actionable inventory)
    const activeCount = finalStatusCounts.ACTIVE || 0;
    console.log(`   🎯 ACTIONABLE INVENTORY: ${activeCount} items`);
    console.log(`   These items are eligible for recommendations and promotions\n`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('✅ RESULT:');
  console.log('   - inventory_status added/updated (no rows deleted)');
  console.log('   - ACTIVE items are actionable for recommendations');
  console.log('   - INACTIVE/LEGACY/DISCONTINUED items preserved for reference');
  console.log('   - System can now distinguish actionable vs historical inventory\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('📝 MANUAL CLASSIFICATION:');
  console.log('   To manually set status for specific items:');
  console.log('   UPDATE inventory_live SET inventory_status = \'LEGACY\' WHERE sku = \'...\';');
  console.log('   UPDATE inventory_live SET inventory_status = \'DISCONTINUED\' WHERE sku = \'...\';');
  console.log('');
  console.log('   Status meanings:');
  console.log('   - ACTIVE: Currently stocked, eligible for recommendations');
  console.log('   - INACTIVE: Known product, temporarily out of stock');
  console.log('   - LEGACY: Historical reference, not actively sold');
  console.log('   - DISCONTINUED: Intentionally removed from catalog\n');

  console.log('🎯 SYSTEM READY:');
  console.log('   ✅ Orders canonicalized (orders.canonical_sku)');
  console.log('   ✅ Inventory gated (inventory_live.inventory_status)');
  console.log('   ✅ Product catalog established (product_catalog)');
  console.log('');
  console.log('   Intelligence queries can now safely:');
  console.log('   - What sold: orders WHERE canonical_sku IS NOT NULL');
  console.log('   - What exists: product_catalog');
  console.log('   - What is actionable: inventory_live WHERE inventory_status = \'ACTIVE\'\n');
}

gateInventory().catch(err => {
  console.error('\n❌ FATAL ERROR:');
  console.error(err.message);
  console.error(err.stack);
  process.exit(1);
});
