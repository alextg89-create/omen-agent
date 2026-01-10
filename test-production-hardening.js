/**
 * Production Hardening Test Suite
 *
 * Tests for:
 * 1. Snapshot idempotency (duplicate prevention)
 * 2. Snapshot versioning (forceRegenerate)
 * 3. Preview vs send lock (must generate before send)
 * 4. Snapshot history listing
 * 5. Email tracking
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
  console.log('  Production Hardening Test Suite');
  console.log('═══════════════════════════════════════════\n');

  // ========================================================================
  // TEST 1: Idempotency - Duplicate Prevention
  // ========================================================================
  await test('Idempotency: First snapshot generation', async () => {
    const response = await makeRequest('POST', '/snapshot/generate', {
      asOfDate: '2026-01-05',
      timeframe: 'weekly'
    });

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');
    assert(response.body.fromCache === false, 'First generation not from cache');
    assert(response.body.snapshotId !== undefined, 'Snapshot ID assigned');

    console.log(`   Snapshot ID: ${response.body.snapshotId}`);
  });

  await test('Idempotency: Duplicate snapshot prevented', async () => {
    const response = await makeRequest('POST', '/snapshot/generate', {
      asOfDate: '2026-01-05',
      timeframe: 'weekly'
    });

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');
    assert(response.body.fromCache === true, 'Returns from cache');
    assert(response.body.reason === 'duplicate_prevented', 'Reason is duplicate_prevented');
    assert(response.body.message !== undefined, 'Helpful message provided');
    assert(response.body.message.includes('forceRegenerate'), 'Message mentions forceRegenerate');

    console.log(`   Message: ${response.body.message}`);
  });

  // ========================================================================
  // TEST 2: Versioning - Force Regenerate
  // ========================================================================
  await test('Versioning: Force regenerate creates new version', async () => {
    const response = await makeRequest('POST', '/snapshot/generate', {
      asOfDate: '2026-01-05',
      timeframe: 'weekly',
      forceRegenerate: true
    });

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');
    assert(response.body.fromCache === false, 'New generation not from cache');
    assert(response.body.regenerated === true, 'Marked as regenerated');
    assert(response.body.superseded !== undefined, 'Superseded ID provided');

    console.log(`   New ID: ${response.body.snapshotId}`);
    console.log(`   Superseded: ${response.body.superseded}`);
  });

  await test('Versioning: History shows version number', async () => {
    const response = await makeRequest('GET', '/snapshot/history?timeframe=weekly&startDate=2026-01-05&endDate=2026-01-05');

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');
    assert(response.body.snapshots.length > 0, 'Snapshots found');

    const latest = response.body.snapshots[0];
    assert(latest.version === 2, 'Version incremented to 2');
    assert(latest.supersedes !== null, 'Supersedes relationship stored');
    assert(latest.regenerated === true, 'Marked as regenerated');

    console.log(`   Version: ${latest.version}`);
    console.log(`   Supersedes: ${latest.supersedes}`);
  });

  // ========================================================================
  // TEST 3: Preview vs Send Lock
  // ========================================================================
  await test('Preview Lock: Send uses latest snapshot', async () => {
    const response = await makeRequest('POST', '/snapshot/send', {
      email: 'test-production@example.com'
    });

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');
    assert(response.body.snapshotId !== undefined, 'Snapshot ID included');
    assert(response.body.email !== undefined, 'Email object included');
    assert(response.body.email.to === 'test-production@example.com', 'Recipient correct');

    console.log(`   Sent snapshot: ${response.body.snapshotId}`);
    console.log(`   To: ${response.body.email.to}`);
  });

  await test('Preview Lock: Email tracking in history', async () => {
    const response = await makeRequest('GET', '/snapshot/history?limit=1');

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');
    assert(response.body.snapshots.length > 0, 'Snapshots found');

    const latest = response.body.snapshots[0];
    assert(latest.emailSent === true, 'Email marked as sent');
    assert(latest.emailSentAt !== null, 'Email sent timestamp recorded');
    assert(latest.emailRecipient !== null, 'Email recipient recorded');

    console.log(`   Email sent at: ${latest.emailSentAt}`);
    console.log(`   Recipient: ${latest.emailRecipient}`);
  });

  // ========================================================================
  // TEST 4: Snapshot History Listing
  // ========================================================================
  await test('History: List all snapshots', async () => {
    const response = await makeRequest('GET', '/snapshot/history');

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');
    assert(Array.isArray(response.body.snapshots), 'Snapshots is array');
    assert(response.body.count === response.body.snapshots.length, 'Count matches length');
    assert(response.body.filters !== undefined, 'Filters included');

    console.log(`   Total snapshots: ${response.body.count}`);
  });

  await test('History: Last N snapshots', async () => {
    const response = await makeRequest('GET', '/snapshot/history/last/3');

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');
    assert(response.body.snapshots.length <= 3, 'Returns max 3 snapshots');
    assert(response.body.requested === 3, 'Requested count recorded');

    console.log(`   Returned: ${response.body.count} snapshots`);
  });

  await test('History: Date range filter', async () => {
    const response = await makeRequest('GET', '/snapshot/history/range?startDate=2026-01-01&endDate=2026-01-09');

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');
    assert(response.body.range !== undefined, 'Range info included');
    assert(response.body.range.startDate === '2026-01-01', 'Start date correct');
    assert(response.body.range.endDate === '2026-01-09', 'End date correct');

    console.log(`   Found ${response.body.count} snapshots in range`);
  });

  await test('History: Statistics endpoint', async () => {
    const response = await makeRequest('GET', '/snapshot/history/stats');

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.ok === true, 'Response ok = true');
    assert(response.body.stats !== undefined, 'Stats object present');
    assert(response.body.stats.total !== undefined, 'Total count included');
    assert(response.body.stats.byTimeframe !== undefined, 'Breakdown by timeframe');
    assert(response.body.stats.emailSentCount !== undefined, 'Email sent count included');

    console.log(`   Total snapshots: ${response.body.stats.total}`);
    console.log(`   Emails sent: ${response.body.stats.emailSentCount}`);
    console.log(`   Weekly: ${response.body.stats.byTimeframe.weekly || 0}`);
    console.log(`   Daily: ${response.body.stats.byTimeframe.daily || 0}`);
  });

  // ========================================================================
  // TEST 5: Diff-Ready Metadata
  // ========================================================================
  await test('Diff Metadata: Summary stored in history', async () => {
    const response = await makeRequest('GET', '/snapshot/history/last/1');

    assert(response.status === 200, 'Returns 200 status');
    assert(response.body.snapshots.length > 0, 'Snapshot found');

    const snapshot = response.body.snapshots[0];
    assert(snapshot.summary !== undefined, 'Summary metadata present');
    assert(snapshot.summary.itemCount !== undefined, 'Item count stored');
    assert(snapshot.summary.totalRevenue !== undefined, 'Revenue stored');
    assert(snapshot.summary.averageMargin !== undefined, 'Margin stored');
    assert(snapshot.diffMetadata !== undefined, 'Diff metadata present');

    console.log(`   Item count: ${snapshot.summary.itemCount}`);
    console.log(`   Revenue: $${snapshot.summary.totalRevenue}`);
    console.log(`   Margin: ${snapshot.summary.averageMargin}%`);
  });

  // ========================================================================
  // TEST 6: Error Handling
  // ========================================================================
  await test('Error: Invalid date range (missing endDate)', async () => {
    const response = await makeRequest('GET', '/snapshot/history/range?startDate=2026-01-01');

    assert(response.status === 400, 'Returns 400 status');
    assert(response.body.ok === false, 'Response ok = false');
    assert(response.body.error !== undefined, 'Error message present');

    console.log(`   Error: ${response.body.error}`);
  });

  await test('Error: Invalid date format', async () => {
    const response = await makeRequest('GET', '/snapshot/history/range?startDate=01/01/2026&endDate=01/15/2026');

    assert(response.status === 400, 'Returns 400 status');
    assert(response.body.ok === false, 'Response ok = false');
    assert(response.body.error === 'Invalid date format', 'Error message correct');

    console.log(`   Message: ${response.body.message}`);
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
    console.log('\n🎉 All production hardening features working correctly!');
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
