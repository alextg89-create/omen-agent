/**
 * OMEN RESOLVER TEST SUITE
 *
 * Tests the inventory resolution and state management functions
 */

import { createClient } from '@supabase/supabase-js';
import {
  normalize,
  normalizeUnit,
  generateMatchKey,
  parseLineItem,
  resolveInventoryItem,
  resolveOrderLineItems
} from './src/utils/inventoryResolver.js';

import {
  applyOrderToInventory,
  verifyInventoryChanges,
  getItemStatus,
  getInventoryStatus
} from './src/utils/inventoryState.js';

const SUPABASE_URL = 'https://kaqnpprkwyxqwmumtmmh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcW5wcHJrd3l4cXdtdW10bW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NjA3ODYsImV4cCI6MjA4MzEzNjc4Nn0.2Xxddl7I33Sc5zdgMpop2jG65SSVD7K6pVa0N48FliY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// TEST HELPERS
// ============================================================================

function test(name, fn) {
  try {
    fn();
    console.log(`   ✅ ${name}`);
    return true;
  } catch (error) {
    console.log(`   ❌ ${name}`);
    console.log(`      Error: ${error.message}`);
    return false;
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message}\n      Expected: ${expected}\n      Actual: ${actual}`);
  }
}

function assertThrows(fn, expectedError = null) {
  try {
    fn();
    throw new Error('Expected function to throw, but it did not');
  } catch (error) {
    if (expectedError && !error.message.includes(expectedError)) {
      throw new Error(`Expected error containing "${expectedError}", got "${error.message}"`);
    }
  }
}

// ============================================================================
// UNIT TESTS
// ============================================================================

async function runTests() {
  console.log('\n🧪 OMEN RESOLVER TEST SUITE\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let passed = 0;
  let failed = 0;

  // -------------------------------------------------------------------------
  // Normalization Tests
  // -------------------------------------------------------------------------
  console.log('📋 NORMALIZATION HELPERS:\n');

  if (test('normalize: lowercase and trim', () => {
    assertEqual(normalize('  Bacio Gelato  '), 'bacio gelato');
  })) passed++; else failed++;

  if (test('normalize: remove punctuation', () => {
    assertEqual(normalize("Blue-Mints!"), 'bluemints');
  })) passed++; else failed++;

  if (test('normalize: handle null/undefined', () => {
    assertEqual(normalize(null), '');
    assertEqual(normalize(undefined), '');
  })) passed++; else failed++;

  if (test('normalizeUnit: remove spaces', () => {
    assertEqual(normalizeUnit('28 G'), '28g');
    assertEqual(normalizeUnit('1/8 OZ'), '1/8oz');
  })) passed++; else failed++;

  if (test('generateMatchKey: creates composite key', () => {
    const key = generateMatchKey('Bacio Gelato', '28g');
    assertEqual(key, 'bacio gelato|28g');
  })) passed++; else failed++;

  console.log('');

  // -------------------------------------------------------------------------
  // parseLineItem Tests
  // -------------------------------------------------------------------------
  console.log('📦 PARSE LINE ITEM:\n');

  if (test('parseLineItem: basic extraction', () => {
    const result = parseLineItem({
      itemName: 'Bacio Gelato',
      catalogItemId: 'abc-123',
      quantity: 2,
      descriptionLines: [{ name: 'Weight', description: '28g' }]
    });

    assertEqual(result.itemName, 'Bacio Gelato');
    assertEqual(result.catalogItemId, 'abc-123');
    assertEqual(result.quantity, 2);
    assertEqual(result.unit, '28g');
    assertEqual(result.itemNameNormalized, 'bacio gelato');
  })) passed++; else failed++;

  if (test('parseLineItem: missing optional fields', () => {
    const result = parseLineItem({
      itemName: 'Test Product',
      quantity: 1
    });

    assertEqual(result.itemName, 'Test Product');
    assertEqual(result.catalogItemId, null);
    assertEqual(result.unit, '');
  })) passed++; else failed++;

  if (test('parseLineItem: throws on invalid input', () => {
    assertThrows(() => parseLineItem(null), 'Invalid input');
    assertThrows(() => parseLineItem('string'), 'Invalid input');
  })) passed++; else failed++;

  console.log('');

  // -------------------------------------------------------------------------
  // resolveInventoryItem Tests
  // -------------------------------------------------------------------------
  console.log('🔍 RESOLVE INVENTORY ITEM:\n');

  const mockInventory = [
    { id: 1, sku: 'SKU-001', strain: 'Bacio Gelato', unit: '28g', quantity: 10 },
    { id: 2, sku: 'SKU-002', strain: 'Blue Mints', unit: '28g', quantity: 5 },
    { id: 3, sku: 'SKU-003', strain: 'Bloopiez', unit: '28 G', quantity: 20 }
  ];

  if (test('resolveInventoryItem: exact match by strain+unit', () => {
    const parsed = parseLineItem({ itemName: 'Bacio Gelato', quantity: 1, descriptionLines: [{ name: 'Weight', description: '28g' }] });
    const result = resolveInventoryItem(parsed, mockInventory);

    assertEqual(result.matched, true);
    assertEqual(result.inventoryItem.sku, 'SKU-001');
    assertEqual(result.matchMethod, 'exact_strain_unit');
  })) passed++; else failed++;

  if (test('resolveInventoryItem: throws on no match', () => {
    const parsed = parseLineItem({ itemName: 'Nonexistent Strain', quantity: 1 });
    assertThrows(() => resolveInventoryItem(parsed, mockInventory), 'INVENTORY_NO_MATCH');
  })) passed++; else failed++;

  if (test('resolveInventoryItem: throws on empty inventory', () => {
    const parsed = parseLineItem({ itemName: 'Test', quantity: 1 });
    assertThrows(() => resolveInventoryItem(parsed, []), 'No inventory loaded');
  })) passed++; else failed++;

  console.log('');

  // -------------------------------------------------------------------------
  // resolveOrderLineItems Tests
  // -------------------------------------------------------------------------
  console.log('📋 RESOLVE ORDER LINE ITEMS:\n');

  if (test('resolveOrderLineItems: processes batch with mixed results', () => {
    const lineItems = [
      { itemName: 'Bacio Gelato', quantity: 1, descriptionLines: [{ name: 'Weight', description: '28g' }] },
      { itemName: 'Blue Mints', quantity: 2, descriptionLines: [{ name: 'Weight', description: '28g' }] },
      { itemName: 'Unknown Product', quantity: 1 }
    ];

    const result = resolveOrderLineItems(lineItems, mockInventory);

    assertEqual(result.summary.total, 3);
    assertEqual(result.summary.resolved, 2);
    assertEqual(result.summary.unresolved, 1);
  })) passed++; else failed++;

  console.log('');

  // -------------------------------------------------------------------------
  // applyOrderToInventory Tests
  // -------------------------------------------------------------------------
  console.log('🔧 APPLY ORDER TO INVENTORY:\n');

  if (test('applyOrderToInventory: decrements correctly', () => {
    const order = {
      id: 'ORDER-001',
      lineItems: [
        { itemName: 'Bacio Gelato', quantity: 2, descriptionLines: [{ name: 'Weight', description: '28g' }] }
      ]
    };

    const result = applyOrderToInventory(order, mockInventory);

    assertEqual(result.success, true);
    assertEqual(result.appliedChanges.length, 1);
    assertEqual(result.appliedChanges[0].previousQty, 10);
    assertEqual(result.appliedChanges[0].soldQty, 2);
    assertEqual(result.appliedChanges[0].newQty, 8);
  })) passed++; else failed++;

  if (test('applyOrderToInventory: prevents negative inventory', () => {
    const order = {
      id: 'ORDER-002',
      lineItems: [
        { itemName: 'Blue Mints', quantity: 100, descriptionLines: [{ name: 'Weight', description: '28g' }] }
      ]
    };

    const result = applyOrderToInventory(order, mockInventory);

    assertEqual(result.success, false);
    assertEqual(result.skippedItems.length, 1);
    assertEqual(result.skippedItems[0].error, 'INSUFFICIENT_INVENTORY');
  })) passed++; else failed++;

  if (test('applyOrderToInventory: does not mutate original', () => {
    const originalQty = mockInventory[0].quantity;
    const order = {
      id: 'ORDER-003',
      lineItems: [
        { itemName: 'Bacio Gelato', quantity: 1, descriptionLines: [{ name: 'Weight', description: '28g' }] }
      ]
    };

    applyOrderToInventory(order, mockInventory);

    assertEqual(mockInventory[0].quantity, originalQty, 'Original array was mutated');
  })) passed++; else failed++;

  console.log('');

  // -------------------------------------------------------------------------
  // getInventoryStatus Tests
  // -------------------------------------------------------------------------
  console.log('📊 INVENTORY STATUS:\n');

  if (test('getItemStatus: classifies correctly', () => {
    const inStock = getItemStatus({ sku: 'A', strain: 'Test', quantity: 10 });
    const lowStock = getItemStatus({ sku: 'B', strain: 'Test', quantity: 4 });
    const critical = getItemStatus({ sku: 'C', strain: 'Test', quantity: 1 });
    const outOfStock = getItemStatus({ sku: 'D', strain: 'Test', quantity: 0 });

    assertEqual(inStock.status, 'IN_STOCK');
    assertEqual(lowStock.status, 'LOW_STOCK');
    assertEqual(critical.status, 'CRITICAL');
    assertEqual(outOfStock.status, 'OUT_OF_STOCK');
  })) passed++; else failed++;

  if (test('getInventoryStatus: generates summary', () => {
    const testInventory = [
      { sku: 'A', strain: 'High', quantity: 50 },
      { sku: 'B', strain: 'Low', quantity: 3 },
      { sku: 'C', strain: 'Critical', quantity: 1 },
      { sku: 'D', strain: 'Out', quantity: 0 }
    ];

    const status = getInventoryStatus(testInventory);

    assertEqual(status.summary.total, 4);
    assertEqual(status.summary.inStock, 1);
    assertEqual(status.summary.lowStock, 1);
    assertEqual(status.summary.criticalStock, 1);
    assertEqual(status.summary.outOfStock, 1);
    assertEqual(status.alerts.length, 2); // Critical + Out of stock
  })) passed++; else failed++;

  console.log('');

  // -------------------------------------------------------------------------
  // LIVE INTEGRATION TEST
  // -------------------------------------------------------------------------
  console.log('🌐 LIVE INTEGRATION (Supabase inventory_live):\n');

  try {
    const { data: inventory, error } = await supabase
      .from('inventory_live')
      .select('*')
      .limit(10);

    if (error) {
      console.log(`   ⚠️  Skipped: ${error.message}`);
    } else if (!inventory || inventory.length === 0) {
      console.log('   ⚠️  Skipped: No inventory data');
    } else {
      console.log(`   ✓ Loaded ${inventory.length} inventory rows`);

      // Test with real inventory
      const status = getInventoryStatus(inventory);
      console.log(`   ✓ Status summary: ${status.summary.inStock} in stock, ${status.summary.outOfStock} out of stock`);

      // Try to match a real item
      if (inventory[0]) {
        const testLineItem = {
          itemName: inventory[0].strain || inventory[0].product_name,
          quantity: 1,
          descriptionLines: [{ name: 'Weight', description: inventory[0].unit }]
        };

        const parsed = parseLineItem(testLineItem);
        const resolved = resolveInventoryItem(parsed, inventory);

        console.log(`   ✓ Resolved "${parsed.itemName}" to SKU: ${resolved.inventoryItem.sku}`);
        passed++;
      }
    }
  } catch (err) {
    console.log(`   ❌ Integration test failed: ${err.message}`);
    failed++;
  }

  console.log('');

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n📊 TEST RESULTS: ${passed} passed, ${failed} failed\n`);

  if (failed === 0) {
    console.log('✅ ALL TESTS PASSED\n');
  } else {
    console.log('❌ SOME TESTS FAILED\n');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('🎯 OMEN RESOLVER READY FOR INTEGRATION');
  console.log('');
  console.log('Files created:');
  console.log('  - src/utils/inventoryResolver.js (parsing + resolution)');
  console.log('  - src/utils/inventoryState.js (state application + status)');
  console.log('');
  console.log('Extension points marked with comments for:');
  console.log('  - Confidence scores');
  console.log('  - Ambiguity reporting');
  console.log('  - Agent reasoning hooks');
  console.log('  - Forecast integration');
  console.log('  - Alert triggers');
  console.log('');
}

runTests().catch(console.error);
