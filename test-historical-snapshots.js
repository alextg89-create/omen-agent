/**
 * Comprehensive Test Suite for Historical Snapshot System
 *
 * Tests:
 * 1. Backward compatibility (no params)
 * 2. Historical date generation (weekly)
 * 3. Historical date generation (daily)
 * 4. Cache hit behavior
 * 5. Future date validation
 * 6. Invalid format validation
 * 7. Send with cached snapshot
 * 8. List cached snapshots
 * 9. Retrieve specific snapshot
 * 10. Edge cases (week boundaries, month boundaries)
 */

import http from 'http';

const BASE_URL = 'http://localhost:3000';

// Test counter
let testsPassed = 0;
let testsFailed = 0;

// Helper: Make HTTP request
async function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';

    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            body: JSON.parse(data),
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            body: data,
          });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// Helper: Assert
function assert(condition, message) {
  if (condition) {
    console.log(`✅ ${message}`);
    testsPassed++;
  } else {
    console.log(`❌ ${message}`);
    testsFailed++;
  }
}

// Helper: Test wrapper
async function test(name, fn) {
  console.log(`\n🧪 ${name}`);
  try {
    await fn();
  } catch (err) {
    console.log(`❌ Test threw error: ${err.message}`);
    testsFailed++;
  }
}

// Main test suite
async function runTests() {
  console.log('═══════════════════════════════════════════');
  console.log('  Historical Snapshot System Test Suite');
  console.log('═══════════════════════════════════════════\n');

  // ========================================================================
  // TEST 1: Backward Compatibility - No Parameters
  // ========================================================================
  await test('Backward Compatibility: No parameters (current snapshot)', async () => {
    const response = await makeRequest('POST', '/snapshot/generate', {});

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');
    assert(response.body.snapshot !== null, 'Snapshot exists');
    assert(response.body.snapshot.timeframe === 'weekly', 'Default timeframe is weekly');
    assert(response.body.fromCache === false, 'Current snapshot not from cache');
    assert(response.body.snapshot.asOfDate !== undefined, 'asOfDate is set');

    console.log(`   As of date: ${response.body.snapshot.asOfDate}`);
  });

  // ========================================================================
  // TEST 2: Historical Weekly Snapshot
  // ========================================================================
  await test('Historical Weekly Snapshot: asOfDate = 2026-01-09', async () => {
    const response = await makeRequest('POST', '/snapshot/generate', {
      asOfDate: '2026-01-09',
      timeframe: 'weekly'
    });

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');
    assert(response.body.snapshot.asOfDate === '2026-01-09', 'asOfDate matches request');
    assert(response.body.snapshot.timeframe === 'weekly', 'Timeframe is weekly');
    assert(response.body.snapshot.dateRange !== undefined, 'Date range calculated');
    assert(response.body.fromCache === false, 'First generation not from cache');

    const dateRange = response.body.snapshot.dateRange;
    console.log(`   Start: ${dateRange.startDate}`);
    console.log(`   End: ${dateRange.endDate}`);

    // Verify week calculation (2026-01-09 is Thursday)
    // Week should be Monday 2026-01-06 to Sunday 2026-01-12
    assert(dateRange.startDate.startsWith('2026-01-06'), 'Week starts on Monday');
    assert(dateRange.endDate.startsWith('2026-01-12'), 'Week ends on Sunday');
  });

  // ========================================================================
  // TEST 3: Cache Hit - Same Request Again
  // ========================================================================
  await test('Cache Hit: Request same weekly snapshot again', async () => {
    const response = await makeRequest('POST', '/snapshot/generate', {
      asOfDate: '2026-01-09',
      timeframe: 'weekly'
    });

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');
    assert(response.body.fromCache === true, 'Returns from cache');
    assert(response.body.cachedAt !== undefined, 'cachedAt timestamp present');

    console.log(`   Cached at: ${response.body.cachedAt}`);
  });

  // ========================================================================
  // TEST 4: Historical Daily Snapshot
  // ========================================================================
  await test('Historical Daily Snapshot: asOfDate = 2026-01-09', async () => {
    const response = await makeRequest('POST', '/snapshot/generate', {
      asOfDate: '2026-01-09',
      timeframe: 'daily'
    });

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');
    assert(response.body.snapshot.asOfDate === '2026-01-09', 'asOfDate matches request');
    assert(response.body.snapshot.timeframe === 'daily', 'Timeframe is daily');

    const dateRange = response.body.snapshot.dateRange;
    console.log(`   Start: ${dateRange.startDate}`);
    console.log(`   End: ${dateRange.endDate}`);

    // Verify day calculation
    assert(dateRange.startDate.startsWith('2026-01-09T00:00'), 'Day starts at midnight');
    assert(dateRange.endDate.startsWith('2026-01-09T23:59'), 'Day ends at 23:59');
  });

  // ========================================================================
  // TEST 5: Future Date Validation
  // ========================================================================
  await test('Validation: Future date should fail', async () => {
    const response = await makeRequest('POST', '/snapshot/generate', {
      asOfDate: '2027-01-01',
      timeframe: 'weekly'
    });

    assert(response.status === 400, 'Returns 400 status');
    assert(response.body.ok === false, 'Response ok = false');
    assert(response.body.error === 'Invalid asOfDate', 'Error message correct');

    console.log(`   Error: ${response.body.message}`);
  });

  // ========================================================================
  // TEST 6: Invalid Date Format
  // ========================================================================
  await test('Validation: Invalid date format should fail', async () => {
    const response = await makeRequest('POST', '/snapshot/generate', {
      asOfDate: '01/09/2026',
      timeframe: 'weekly'
    });

    assert(response.status === 400, 'Returns 400 status');
    assert(response.body.ok === false, 'Response ok = false');
    assert(response.body.error === 'Invalid asOfDate', 'Error message correct');
  });

  // ========================================================================
  // TEST 7: Invalid Timeframe
  // ========================================================================
  await test('Validation: Invalid timeframe should fail', async () => {
    const response = await makeRequest('POST', '/snapshot/generate', {
      timeframe: 'monthly'
    });

    assert(response.status === 400, 'Returns 400 status');
    assert(response.body.ok === false, 'Response ok = false');
    assert(response.body.error === 'Invalid timeframe', 'Error message correct');
  });

  // ========================================================================
  // TEST 8: List Cached Snapshots
  // ========================================================================
  await test('List Cached Snapshots', async () => {
    const response = await makeRequest('GET', '/snapshot/list');

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');
    assert(Array.isArray(response.body.snapshots), 'Snapshots is array');
    assert(response.body.count === response.body.snapshots.length, 'Count matches array length');

    console.log(`   Found ${response.body.count} cached snapshots`);

    if (response.body.snapshots.length > 0) {
      const first = response.body.snapshots[0];
      console.log(`   Latest: ${first.key} (cached at ${first.cachedAt})`);
    }
  });

  // ========================================================================
  // TEST 9: Get Specific Cached Snapshot
  // ========================================================================
  await test('Get Specific Cached Snapshot: 2026-01-09 weekly', async () => {
    const response = await makeRequest('GET', '/snapshot/get?asOfDate=2026-01-09&timeframe=weekly');

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');
    assert(response.body.fromCache === true, 'Returns from cache');
    assert(response.body.snapshot !== null, 'Snapshot exists');
    assert(response.body.snapshot.asOfDate === '2026-01-09', 'asOfDate matches');

    console.log(`   Retrieved from cache at: ${response.body.cachedAt}`);
  });

  // ========================================================================
  // TEST 10: Get Non-Existent Snapshot
  // ========================================================================
  await test('Get Non-Existent Snapshot: Should return 404', async () => {
    const response = await makeRequest('GET', '/snapshot/get?asOfDate=2025-01-01&timeframe=weekly');

    assert(response.status === 404, 'Returns 404 status');
    assert(response.body.ok === false, 'Response ok = false');
    assert(response.body.error === 'Snapshot not found', 'Error message correct');
  });

  // ========================================================================
  // TEST 11: Send Snapshot (Uses Cached)
  // ========================================================================
  await test('Send Snapshot: Should use latest cached snapshot', async () => {
    const response = await makeRequest('POST', '/snapshot/send', {
      email: 'test@example.com'
    });

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');
    assert(response.body.email !== undefined, 'Email object present');
    assert(response.body.email.to === 'test@example.com', 'Email recipient correct');
    assert(response.body.email.subject !== undefined, 'Email subject present');
    assert(response.body.email.body !== undefined, 'Email body present');
    assert(response.body.snapshotDate !== undefined, 'Snapshot date included');

    console.log(`   Email subject: ${response.body.email.subject}`);
    console.log(`   Snapshot date: ${response.body.snapshotDate}`);
    console.log(`   From cache: ${response.body.fromCache}`);
  });

  // ========================================================================
  // TEST 12: Week Boundary (Sunday)
  // ========================================================================
  await test('Week Boundary: Sunday (2026-01-11)', async () => {
    const response = await makeRequest('POST', '/snapshot/generate', {
      asOfDate: '2026-01-11',
      timeframe: 'weekly'
    });

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');

    const dateRange = response.body.snapshot.dateRange;
    console.log(`   Start: ${dateRange.startDate}`);
    console.log(`   End: ${dateRange.endDate}`);

    // 2026-01-11 is Sunday, so week should end on that day
    assert(dateRange.startDate.startsWith('2026-01-05'), 'Week starts on Monday');
    assert(dateRange.endDate.startsWith('2026-01-11'), 'Week ends on Sunday (same day)');
  });

  // ========================================================================
  // TEST 13: Week Boundary (Monday)
  // ========================================================================
  await test('Week Boundary: Monday (2026-01-12)', async () => {
    const response = await makeRequest('POST', '/snapshot/generate', {
      asOfDate: '2026-01-12',
      timeframe: 'weekly'
    });

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');

    const dateRange = response.body.snapshot.dateRange;
    console.log(`   Start: ${dateRange.startDate}`);
    console.log(`   End: ${dateRange.endDate}`);

    // 2026-01-12 is Monday, so week should start on that day
    assert(dateRange.startDate.startsWith('2026-01-12'), 'Week starts on Monday (same day)');
    assert(dateRange.endDate.startsWith('2026-01-18'), 'Week ends on following Sunday');
  });

  // ========================================================================
  // TEST 14: Month/Year Boundary
  // ========================================================================
  await test('Month/Year Boundary: New Year (2026-01-01)', async () => {
    const response = await makeRequest('POST', '/snapshot/generate', {
      asOfDate: '2026-01-01',
      timeframe: 'weekly'
    });

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');

    const dateRange = response.body.snapshot.dateRange;
    console.log(`   Start: ${dateRange.startDate}`);
    console.log(`   End: ${dateRange.endDate}`);

    // 2026-01-01 is Thursday, week should span two years
    assert(dateRange.startDate.startsWith('2025-12-29'), 'Week starts in previous year');
    assert(dateRange.endDate.startsWith('2026-01-04'), 'Week ends in new year');
  });

  // ========================================================================
  // SUMMARY
  // ========================================================================
  console.log('\n═══════════════════════════════════════════');
  console.log('  Test Summary');
  console.log('═══════════════════════════════════════════');
  console.log(`✅ Tests Passed: ${testsPassed}`);
  console.log(`❌ Tests Failed: ${testsFailed}`);
  console.log(`📊 Total Tests: ${testsPassed + testsFailed}`);

  if (testsFailed === 0) {
    console.log('\n🎉 All tests passed!');
  } else {
    console.log('\n⚠️  Some tests failed. Review output above.');
  }

  console.log('\n');
}

// Run tests
runTests().catch(err => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
