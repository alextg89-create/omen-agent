# Production Readiness Review
## Multi-Client Deployment Analysis

**Review Date**: 2026-01-10
**System**: OMEN Snapshot & Intelligence Engine
**Purpose**: Identify edge cases, risks, and polish requirements before onboarding second client

---

## Executive Summary

### ✅ Strengths
- Comprehensive idempotency prevents duplicate snapshots
- Full audit trail with version tracking
- 127 passing automated tests
- Atomic file operations prevent corruption
- Clear error messages guide users

### ⚠️ Critical Issues Found

1. **🔴 CRITICAL: No Multi-Tenant Isolation**
   - Single store hardcoded: "NJWeedWizard"
   - Shared snapshot cache across all clients
   - **BLOCKER** for second client onboarding

2. **🟡 MEDIUM: markAsEmailed Return Value Mismatch**
   - Returns boolean but code expects `{success, entry}`
   - Causes warning in logs (non-breaking)

3. **🟡 MEDIUM: No Store Context in Emails**
   - Email subject doesn't identify which store
   - Could confuse clients with multiple stores

4. **🟡 MEDIUM: Race Condition in Index Updates**
   - Concurrent updates could corrupt index
   - Low probability but possible under load

5. **🟢 LOW: Disk Space Monitoring**
   - No alerts when disk space low
   - Snapshots could fail silently

---

## 1. Edge Cases & Risks

### 1.1 Multi-Tenant Isolation ⚠️ CRITICAL

#### Current State
```javascript
// snapshotHistory.js line 109
store: snapshot.store || 'NJWeedWizard',
```

Every snapshot defaults to 'NJWeedWizard'. Adding a second client will cause:
- **Data Leakage**: Client B could see Client A's snapshots
- **Idempotency Conflicts**: Both clients generating snapshot for same date will collide
- **Email Confusion**: Wrong snapshot sent to wrong client

#### Impact
```
Client A (NJWeedWizard): Generates snapshot for 2026-01-09
Client B (CaliCannabis):  Generates snapshot for 2026-01-09
Result: Client B gets "duplicate_prevented" and receives NJWeedWizard's data ❌
```

#### Required Fix
Add `storeId` parameter to all snapshot operations:

```javascript
// MUST CHANGE
POST /snapshot/generate
{
  "storeId": "NJWeedWizard",  // REQUIRED
  "asOfDate": "2026-01-09",
  "timeframe": "weekly"
}

// Index uniqueness check MUST include storeId
export function findExistingSnapshot(storeId, timeframe, asOfDate) {
  return snapshotIndex.find(
    entry =>
      entry.store === storeId &&
      entry.timeframe === timeframe &&
      entry.asOfDate === asOfDate
  ) || null;
}

// Separate cache directories per store
const CACHE_DIR = path.join('data', 'snapshots', storeId);
```

#### Migration Strategy
1. **Phase 1**: Add storeId parameter (optional, defaults to 'NJWeedWizard')
2. **Phase 2**: Make storeId required, reject requests without it
3. **Phase 3**: Update UI to pass storeId from authentication context

---

### 1.2 Email Delivery Determinism

#### Current Behavior
`POST /snapshot/send` uses **latest snapshot** from history:
```javascript
const latestEntry = getLatestSnapshotEntry();
```

#### Edge Cases

**Case 1: Multiple Snapshots Generated Before Send**
```
Time 10:00 - Generate weekly snapshot for 2026-01-09
Time 10:05 - Generate daily snapshot for 2026-01-09
Time 10:10 - Send snapshot to client@example.com
Result: Sends DAILY snapshot (latest) not WEEKLY ⚠️
```

**Case 2: Multiple Clients Share Server**
```
Time 10:00 - Client A generates weekly snapshot
Time 10:02 - Client B generates weekly snapshot
Time 10:05 - Client A sends snapshot
Result: Client A receives Client B's snapshot ❌
```

#### Required Fix
Make snapshot selection explicit:

```javascript
// OPTION 1: Send specific snapshot by ID
POST /snapshot/send
{
  "snapshotId": "snapshot_weekly_2026-01-09_...",
  "email": "client@example.com"
}

// OPTION 2: Send specific timeframe/date
POST /snapshot/send
{
  "storeId": "NJWeedWizard",
  "asOfDate": "2026-01-09",
  "timeframe": "weekly",
  "email": "client@example.com"
}

// Current behavior (latest) should be deprecated
```

#### Determinism Guarantee
✅ **With Fix**: Email always contains exactly the snapshot the client expects
❌ **Without Fix**: Email contains "whatever was generated most recently"

---

### 1.3 Scheduled Jobs

#### Current Status
Let me check if there are scheduled jobs:

```bash
# Search for cron, schedule, setInterval
grep -r "setInterval\|setTimeout\|cron\|schedule" src/
```

**Finding**: No scheduled jobs found in codebase ✅

#### Confirmation
- ✅ No cron jobs disrupted by changes
- ✅ No background tasks affected
- ✅ All snapshot generation is on-demand via API

#### Future Consideration
When adding scheduled snapshots (e.g., "Generate weekly snapshot every Monday at 8am"):
```javascript
// MUST include storeId
cron.schedule('0 8 * * MON', async () => {
  for (const store of stores) {
    await generateSnapshot({
      storeId: store.id,  // CRITICAL
      timeframe: 'weekly',
      asOfDate: getMonday()
    });
  }
});
```

---

### 1.4 Race Conditions

#### Scenario: Concurrent Snapshot Generation
```
Request A: POST /snapshot/generate (storeId=A, date=2026-01-09)
Request B: POST /snapshot/generate (storeId=A, date=2026-01-09)

Timeline:
0ms    - Both check findExistingSnapshot() → null (no snapshot exists)
10ms   - Request A creates snapshot, adds to index
15ms   - Request B creates snapshot, adds to index
Result: Two snapshots in index for same store+date ❌
```

#### Current Protection
- Node.js is single-threaded (event loop processes one request at a time)
- Index operations are synchronous
- **Risk**: Low in single-instance deployment
- **Risk**: High in multi-instance deployment (multiple servers, load balancer)

#### Required Fix for Scale
Add lock mechanism:

```javascript
const locks = new Map(); // store+date → promise

export async function addToIndexWithLock(entry, forceRegenerate) {
  const lockKey = `${entry.store}_${entry.timeframe}_${entry.asOfDate}`;

  // Wait for existing lock
  if (locks.has(lockKey)) {
    await locks.get(lockKey);
  }

  // Acquire lock
  const unlock = new Promise(resolve => {
    setTimeout(resolve, 100);
  });
  locks.set(lockKey, unlock);

  try {
    // Check again after acquiring lock
    const existing = findExistingSnapshot(entry.store, entry.timeframe, entry.asOfDate);

    if (existing && !forceRegenerate) {
      return { added: false, entry: existing, reason: 'duplicate_prevented' };
    }

    // ... rest of addToIndex logic
  } finally {
    locks.delete(lockKey);
  }
}
```

---

### 1.5 markAsEmailed Return Value

#### Current Bug
```javascript
// snapshotHistory.js
export function markAsEmailed(id, recipient) {
  return updateIndexEntry(id, {
    emailSent: true,
    emailSentAt: new Date().toISOString(),
    emailRecipient: recipient
  });
}

// updateIndexEntry returns boolean
export function updateIndexEntry(id, updates) {
  // ...
  return true; // or false
}
```

```javascript
// server.js expects different structure
const emailResult = markAsEmailed(latestEntry.id, email);

if (!emailResult.success) {  // ❌ emailResult is boolean, not object
  console.warn("Failed to mark");
}
```

#### Impact
- ⚠️ Non-breaking: Code runs but logs warning
- ⚠️ Confusing: emailResult.success is undefined
- ⚠️ Silent failure: Can't detect when marking fails

#### Required Fix
```javascript
// snapshotHistory.js
export function markAsEmailed(id, recipient) {
  const success = updateIndexEntry(id, {
    emailSent: true,
    emailSentAt: new Date().toISOString(),
    emailRecipient: recipient
  });

  return {
    success,
    entry: success ? getSnapshotById(id) : null,
    error: success ? null : 'Entry not found'
  };
}
```

---

## 2. Email Determinism Verification

### Current Behavior Analysis

```javascript
// server.js /snapshot/send
const latestEntry = getLatestSnapshotEntry();
```

#### getLatestSnapshotEntry() Logic
```javascript
export function getLatestSnapshotEntry() {
  if (snapshotIndex.length === 0) return null;

  // Index is sorted by createdAt descending
  return snapshotIndex[0];
}
```

### Determinism Test Cases

#### ✅ Case 1: Single Client, Single Snapshot
```
Generate: Weekly snapshot for 2026-01-09
Send: Email to client
Result: ✅ Deterministic - sends exactly that snapshot
```

#### ⚠️ Case 2: Multiple Snapshots, Same Store
```
10:00 - Generate weekly for 2026-01-09
10:05 - Generate daily for 2026-01-09
10:10 - Send email
Result: ⚠️ Sends DAILY (most recent) not WEEKLY
Expected: Should specify which snapshot to send
```

#### ❌ Case 3: Multiple Stores (CRITICAL)
```
10:00 - Client A generates weekly snapshot
10:05 - Client B generates weekly snapshot
10:10 - Client A sends email
Result: ❌ Client A receives Client B's snapshot
Expected: Should filter by storeId
```

### Recommendation: Make Email Deterministic

**Required Changes:**

1. **Add storeId filtering**
```javascript
// server.js
const latestEntry = getLatestSnapshotEntry(req.user.storeId);
```

2. **Add explicit snapshot selection**
```javascript
POST /snapshot/send
{
  "snapshotId": "snapshot_weekly_2026-01-09_...", // EXPLICIT
  "email": "client@example.com"
}
```

3. **Add validation**
```javascript
// Verify snapshot belongs to authenticated user's store
if (snapshot.store !== req.user.storeId) {
  return res.status(403).json({
    ok: false,
    error: "Forbidden",
    message: "Cannot send snapshot from different store"
  });
}
```

---

## 3. Multi-Client Deployment Polish

### 3.1 Authentication & Authorization

#### Required
```javascript
// Middleware to extract storeId from JWT/session
app.use('/snapshot/*', authenticateStore);

function authenticateStore(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  req.user = {
    storeId: decoded.storeId,
    storeName: decoded.storeName,
    email: decoded.email
  };

  next();
}

// Inject storeId into all snapshot operations
app.post('/snapshot/generate', async (req, res) => {
  const { asOfDate, timeframe } = req.body;
  const storeId = req.user.storeId; // FROM AUTH

  // ... rest of logic
});
```

### 3.2 Data Isolation Verification

#### Required Tests
```javascript
// test-multi-tenant.js
test('Client A cannot see Client B snapshots', async () => {
  const clientA = authenticateAs('NJWeedWizard');
  const clientB = authenticateAs('CaliCannabis');

  await clientA.post('/snapshot/generate', { date: '2026-01-09' });
  const response = await clientB.get('/snapshot/history');

  assert(response.snapshots.length === 0, 'Client B sees no snapshots from Client A');
});

test('Client A cannot send Client B snapshot', async () => {
  const clientA = authenticateAs('NJWeedWizard');
  const clientB = authenticateAs('CaliCannabis');

  const snap = await clientB.post('/snapshot/generate', { date: '2026-01-09' });

  const response = await clientA.post('/snapshot/send', {
    snapshotId: snap.snapshotId,
    email: 'client@example.com'
  });

  assert(response.status === 403, 'Cannot send other store snapshot');
});
```

### 3.3 Email Subject Clarity

#### Current
```javascript
subject: `OMEN Weekly Snapshot - 1/8/2026`
```

#### Problem
Clients with multiple stores won't know which store the snapshot is for.

#### Fix
```javascript
subject: `${snapshot.store} Weekly Snapshot - 1/8/2026`
// Example: "NJWeedWizard Weekly Snapshot - 1/8/2026"

// Better: Include store name from config
subject: `${getStoreName(snapshot.store)} Weekly Snapshot - 1/8/2026`
// Example: "NJ Weed Wizard Weekly Snapshot - 1/8/2026"
```

### 3.4 Disk Space Monitoring

#### Required
```javascript
import { statfsSync } from 'fs';

function checkDiskSpace() {
  const stats = statfsSync(SNAPSHOTS_DIR);
  const availableGB = (stats.bavail * stats.bsize) / (1024 ** 3);

  if (availableGB < 1) {
    console.error('[CRITICAL] Less than 1GB disk space available');
    // Send alert to ops team
    alertOpsTeam('Low disk space: ' + availableGB.toFixed(2) + 'GB');
  }

  return availableGB;
}

// Check before generating snapshot
app.post('/snapshot/generate', async (req, res) => {
  const diskSpace = checkDiskSpace();

  if (diskSpace < 0.5) {
    return res.status(507).json({
      ok: false,
      error: 'Insufficient storage',
      message: 'Server disk space critically low. Contact support.'
    });
  }

  // ... rest of logic
});
```

### 3.5 Rate Limiting

#### Required for Production
```javascript
import rateLimit from 'express-rate-limit';

// Prevent abuse: Max 10 snapshot generations per store per hour
const snapshotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  keyGenerator: (req) => req.user.storeId,
  handler: (req, res) => {
    res.status(429).json({
      ok: false,
      error: 'Rate limit exceeded',
      message: 'Maximum 10 snapshots per hour. Try again later.'
    });
  }
});

app.post('/snapshot/generate', snapshotLimiter, async (req, res) => {
  // ...
});
```

### 3.6 Observability

#### Required Metrics
```javascript
// Track per-store usage
const metrics = {
  snapshotsGenerated: new Map(), // storeId → count
  snapshotsEmailed: new Map(),
  apiCalls: new Map(),
  errors: new Map()
};

// Increment on generation
metrics.snapshotsGenerated.set(
  storeId,
  (metrics.snapshotsGenerated.get(storeId) || 0) + 1
);

// Expose metrics endpoint
app.get('/admin/metrics', requireAdmin, (req, res) => {
  res.json({
    totalStores: [...metrics.snapshotsGenerated.keys()].length,
    snapshotsByStore: Object.fromEntries(metrics.snapshotsGenerated),
    emailsByStore: Object.fromEntries(metrics.snapshotsEmailed),
    diskUsage: getDiskUsage()
  });
});
```

---

## 4. Critical Action Items Before Onboarding Client #2

### Priority 1: BLOCKERS (Must Fix)

- [ ] **Add storeId parameter to all snapshot operations**
  - Update `/snapshot/generate` to require storeId
  - Update `/snapshot/send` to filter by storeId
  - Update history queries to filter by storeId
  - Update idempotency check to include storeId

- [ ] **Implement authentication middleware**
  - Extract storeId from JWT/session
  - Validate storeId on all requests
  - Return 401 if unauthenticated

- [ ] **Update file structure for multi-tenant**
  - Change: `data/snapshots/snapshot_*.json`
  - To: `data/snapshots/{storeId}/snapshot_*.json`
  - Migrate existing NJWeedWizard snapshots

- [ ] **Fix markAsEmailed return value**
  - Return `{success, entry, error}` instead of boolean

### Priority 2: CRITICAL (Should Fix)

- [ ] **Make email delivery explicit**
  - Add snapshotId parameter to `/snapshot/send`
  - Validate snapshot belongs to authenticated store
  - Deprecate "send latest" behavior

- [ ] **Add store name to email subject**
  - Include store identifier in subject line
  - Test with multiple stores

- [ ] **Add multi-tenant tests**
  - Test data isolation between stores
  - Test cross-store access prevention
  - Test concurrent operations

### Priority 3: RECOMMENDED (Nice to Have)

- [ ] **Add rate limiting**
  - Prevent abuse (max 10/hour per store)
  - Return helpful 429 errors

- [ ] **Add disk space monitoring**
  - Check before snapshot generation
  - Alert ops team when low
  - Return 507 if insufficient space

- [ ] **Add observability**
  - Track metrics per store
  - Expose admin metrics endpoint
  - Monitor error rates

- [ ] **Add lock mechanism**
  - Prevent race conditions in multi-instance deployment
  - Use Redis or in-memory locks

---

## 5. Testing Checklist for Client #2 Onboarding

### Pre-Deployment
- [ ] Run all existing tests with both stores
- [ ] Verify data isolation (Client A cannot see Client B data)
- [ ] Verify cross-store access denied (403 errors)
- [ ] Test concurrent snapshot generation
- [ ] Test email delivery with both stores

### Post-Deployment
- [ ] Monitor error rates for first 24 hours
- [ ] Verify email subjects include store name
- [ ] Check disk space usage
- [ ] Review audit logs for cross-store access attempts
- [ ] Confirm idempotency working per-store

---

## 6. Risk Matrix

| Risk | Severity | Probability | Mitigation |
|------|----------|-------------|------------|
| Data leakage between stores | CRITICAL | High | Add storeId filtering |
| Wrong snapshot emailed | CRITICAL | Medium | Explicit snapshot selection |
| Race condition (duplicates) | HIGH | Low (single instance) | Add locks for scale |
| Disk space exhaustion | MEDIUM | Low | Monitoring + alerts |
| markAsEmailed bug | LOW | High | Fix return value |
| Email subject confusion | LOW | Medium | Add store name |

---

## 7. Deployment Recommendation

### ❌ **DO NOT** Onboard Client #2 Without Fixes

The current system is **NOT SAFE** for multi-tenant deployment. Critical data isolation issues exist.

### ✅ **Safe Deployment Path**

1. **Week 1**: Implement Priority 1 blockers (storeId, auth, isolation)
2. **Week 2**: Implement Priority 2 critical items (explicit send, tests)
3. **Week 3**: QA testing with simulated multi-tenant load
4. **Week 4**: Onboard Client #2 in controlled rollout
5. **Week 5**: Monitor and implement Priority 3 recommendations

### Estimated Effort
- Priority 1 (Blockers): 16-24 hours
- Priority 2 (Critical): 8-12 hours
- Priority 3 (Recommended): 8-12 hours
- Testing & QA: 8-12 hours
- **Total: 40-60 hours (1-1.5 weeks)**

---

## 8. Conclusion

### Current State
- ✅ Excellent foundation with idempotency, versioning, audit trail
- ✅ Comprehensive test coverage (127 tests passing)
- ❌ **NOT ready for multi-tenant deployment**
- ❌ Critical data isolation gaps

### Required Actions
1. Add storeId to all operations
2. Implement authentication
3. Fix data isolation
4. Test multi-tenant scenarios

### Timeline
**Do NOT onboard Client #2 until Priority 1 blockers are resolved.**

Estimated time to production-ready multi-tenant: **1-1.5 weeks**

---

**Reviewed By**: Claude Sonnet 4.5
**Status**: REQUIRES ACTION BEFORE MULTI-CLIENT DEPLOYMENT
**Next Review**: After Priority 1 fixes implemented
