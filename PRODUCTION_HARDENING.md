# OMEN Production Hardening Features

This document describes the production-grade snapshot hardening features implemented to provide reliability, auditability, and operational excellence.

## Overview

The snapshot system has been enhanced with four critical production features:

1. **Snapshot History Index** - Complete audit trail with metadata
2. **Idempotency & Versioning** - Duplicate prevention and version tracking
3. **Preview vs Send Lock** - Email safety guardrails
4. **Diff-Ready Metadata** - Future comparison capabilities

---

## 1. Snapshot History Index

### Purpose
Store complete metadata for every snapshot generated, enabling audits, trust, and client confidence.

### What's Stored

Each snapshot in the history index contains:

```json
{
  "id": "snapshot_weekly_2026-01-09_1768013990884_a098d716",
  "timeframe": "weekly",
  "asOfDate": "2026-01-09",
  "createdAt": "2026-01-10T02:59:50.884Z",
  "generatedAt": "2026-01-10T02:59:50.884Z",
  "requestId": "30698c7c-ef1c-4856-9b88-60753408deef",
  "store": "NJWeedWizard",
  "summary": {
    "itemCount": 60,
    "totalRevenue": 8088,
    "totalProfit": 4863,
    "averageMargin": 60.51,
    "recommendationCount": 13
  },
  "version": 2,
  "supersedes": "snapshot_weekly_2026-01-09_1768013922779_12edff83",
  "diffMetadata": {
    "itemsWithPricing": 16,
    "highestMarginSku": "Bloopiez (eighth)",
    "lowestMarginSku": "Bloopiez (oz)",
    "dateRange": {...}
  },
  "emailSent": true,
  "emailSentAt": "2026-01-10T03:03:33.778Z",
  "emailRecipient": "test@example.com",
  "createdBy": "api",
  "createdVia": "api",
  "regenerated": false
}
```

### File Location
- **Index**: `data/snapshots/index.json`
- **Snapshots**: `data/snapshots/snapshot_*.json`

### Benefits
- **Audit Trail**: Complete history of all snapshots generated
- **Trust**: Clients can verify when snapshots were created and sent
- **Debugging**: Trace issues back to specific snapshots by ID
- **Compliance**: Track who generated snapshots and when

---

## 2. Idempotency & Versioning

### Purpose
Prevent accidental duplicate snapshots while allowing explicit regeneration with version tracking.

### Idempotency (Duplicate Prevention)

**First Request:**
```bash
POST /snapshot/generate
{
  "asOfDate": "2026-01-09",
  "timeframe": "weekly"
}
```

**Response:**
```json
{
  "ok": true,
  "snapshot": {...},
  "snapshotId": "snapshot_weekly_2026-01-09_1768013922779_12edff83",
  "fromCache": false
}
```

**Second Request (Same Parameters):**
```bash
POST /snapshot/generate
{
  "asOfDate": "2026-01-09",
  "timeframe": "weekly"
}
```

**Response:**
```json
{
  "ok": true,
  "snapshot": {...},
  "snapshotId": "snapshot_weekly_2026-01-09_1768013922779_12edff83",
  "fromCache": true,
  "reason": "duplicate_prevented",
  "message": "Snapshot already exists for this timeframe and date. Use forceRegenerate=true to regenerate."
}
```

### Versioning (Force Regenerate)

**Force Regeneration:**
```bash
POST /snapshot/generate
{
  "asOfDate": "2026-01-09",
  "timeframe": "weekly",
  "forceRegenerate": true
}
```

**Response:**
```json
{
  "ok": true,
  "snapshot": {...},
  "snapshotId": "snapshot_weekly_2026-01-09_1768013990884_a098d716",
  "fromCache": false,
  "regenerated": true,
  "superseded": "snapshot_weekly_2026-01-09_1768013922779_12edff83"
}
```

### Version Tracking

The history index tracks versions and supersedes relationships:

```json
{
  "id": "snapshot_weekly_2026-01-09_1768013990884_a098d716",
  "version": 2,
  "supersedes": "snapshot_weekly_2026-01-09_1768013922779_12edff83",
  "regenerated": true
}
```

### Benefits
- **Prevents Mistakes**: No accidental duplicate snapshots wasting resources
- **Explicit Control**: Must use `forceRegenerate: true` to regenerate
- **Version History**: Track which snapshot replaced which
- **Data Integrity**: Old version removed from active index but relationship preserved

---

## 3. Preview vs Send Lock

### Purpose
Prevent sending emails without an available snapshot. Provides clear error messages and guardrails.

### How It Works

#### ✅ Success Case: Snapshot Exists

```bash
# 1. Generate snapshot first
POST /snapshot/generate
{
  "asOfDate": "2026-01-09",
  "timeframe": "weekly"
}

# 2. Send email (uses latest snapshot)
POST /snapshot/send
{
  "email": "client@example.com"
}
```

**Response:**
```json
{
  "ok": true,
  "snapshot": {...},
  "snapshotId": "snapshot_weekly_2026-01-09_1768013990884_a098d716",
  "email": {
    "to": "client@example.com",
    "subject": "OMEN Weekly Snapshot - 1/8/2026",
    "body": "..."
  },
  "emailedAt": "2026-01-10T03:03:33.778Z"
}
```

#### ❌ Error Case: No Snapshot Available

```bash
# Try to send without generating snapshot first
POST /snapshot/send
{
  "email": "client@example.com"
}
```

**Response (400 Bad Request):**
```json
{
  "ok": false,
  "error": "No snapshot available",
  "message": "Please generate a snapshot first using POST /snapshot/generate before sending.",
  "nextAction": "Call POST /snapshot/generate to create a snapshot"
}
```

### Email Tracking

After sending, the snapshot is marked in the history index:

```json
{
  "id": "snapshot_weekly_2026-01-09_1768013990884_a098d716",
  "emailSent": true,
  "emailSentAt": "2026-01-10T03:03:33.778Z",
  "emailRecipient": "client@example.com"
}
```

### Benefits
- **Safety**: Cannot send email without snapshot (prevents footguns)
- **Clear Errors**: Helpful error messages guide users to correct action
- **Audit Trail**: Track which snapshots were emailed and when
- **UI Support**: UI can disable "Send" button if no snapshot exists

---

## 4. Snapshot History Listing

### Purpose
Allow clients to view, filter, and analyze historical snapshots.

### Endpoints

#### Get All Snapshots with Filters
```bash
GET /snapshot/history?limit=50&timeframe=weekly&startDate=2026-01-01&endDate=2026-01-10
```

**Response:**
```json
{
  "ok": true,
  "snapshots": [
    {
      "id": "snapshot_weekly_2026-01-09_1768013990884_a098d716",
      "timeframe": "weekly",
      "asOfDate": "2026-01-09",
      "createdAt": "2026-01-10T02:59:50.884Z",
      "summary": {...},
      "emailSent": true,
      "version": 2
    }
  ],
  "count": 1,
  "filters": {
    "limit": 50,
    "timeframe": "weekly",
    "startDate": "2026-01-01",
    "endDate": "2026-01-10"
  }
}
```

#### Get Last N Snapshots
```bash
GET /snapshot/history/last/7
GET /snapshot/history/last/10?timeframe=weekly
```

**Response:**
```json
{
  "ok": true,
  "snapshots": [...],
  "count": 7,
  "requested": 7,
  "timeframe": "all"
}
```

#### Get Snapshots in Date Range
```bash
GET /snapshot/history/range?startDate=2026-01-01&endDate=2026-01-10
GET /snapshot/history/range?startDate=2026-01-01&endDate=2026-01-10&timeframe=weekly
```

**Response:**
```json
{
  "ok": true,
  "snapshots": [...],
  "count": 5,
  "range": {
    "startDate": "2026-01-01",
    "endDate": "2026-01-10",
    "timeframe": "all"
  }
}
```

#### Get Statistics
```bash
GET /snapshot/history/stats
```

**Response:**
```json
{
  "ok": true,
  "stats": {
    "total": 5,
    "byTimeframe": {
      "weekly": 4,
      "daily": 1
    },
    "emailSentCount": 3,
    "regeneratedCount": 1,
    "oldest": {
      "id": "snapshot_weekly_2026-01-01_...",
      "asOfDate": "2026-01-01",
      "createdAt": "2026-01-10T02:58:42.759Z"
    },
    "newest": {
      "id": "snapshot_weekly_2026-01-09_...",
      "asOfDate": "2026-01-09",
      "createdAt": "2026-01-10T02:59:50.884Z"
    }
  }
}
```

### Use Cases

1. **"Show me the last 7 snapshots"**
   ```bash
   GET /snapshot/history/last/7
   ```

2. **"Show me all weekly snapshots from Jan 1-10"**
   ```bash
   GET /snapshot/history/range?startDate=2026-01-01&endDate=2026-01-10&timeframe=weekly
   ```

3. **"How many snapshots have been emailed?"**
   ```bash
   GET /snapshot/history/stats
   # Check stats.emailSentCount
   ```

---

## 5. Diff-Ready Metadata

### Purpose
Store enough metadata in the history index to enable future snapshot comparison without building the diff feature now.

### Stored Metadata

Each snapshot stores summary metrics suitable for comparison:

```json
{
  "summary": {
    "itemCount": 60,
    "totalRevenue": 8088,
    "totalProfit": 4863,
    "averageMargin": 60.51,
    "recommendationCount": 13
  },
  "diffMetadata": {
    "itemsWithPricing": 16,
    "highestMarginSku": "Bloopiez (eighth)",
    "lowestMarginSku": "Bloopiez (oz)",
    "dateRange": {
      "startDate": "2026-01-05T00:00:00.000Z",
      "endDate": "2026-01-11T23:59:59.999Z"
    }
  }
}
```

### Future Comparison Capability

When diff feature is needed, you can compare two snapshots:

```javascript
// Pseudo-code for future implementation
const snapshot1 = await getSnapshotFromHistory('snapshot_weekly_2026-01-01_...');
const snapshot2 = await getSnapshotFromHistory('snapshot_weekly_2026-01-09_...');

const diff = {
  itemCountChange: snapshot2.summary.itemCount - snapshot1.summary.itemCount,
  revenueChange: snapshot2.summary.totalRevenue - snapshot1.summary.totalRevenue,
  marginChange: snapshot2.summary.averageMargin - snapshot1.summary.averageMargin,
  topSkuChanged: snapshot1.diffMetadata.highestMarginSku !== snapshot2.diffMetadata.highestMarginSku
};
```

### Benefits
- **Future-Ready**: Metadata is already stored for comparison
- **No Overhead**: Doesn't slow down current snapshot generation
- **Complete History**: Can compare any two historical snapshots
- **Lightweight**: Summary data is small (< 1KB per snapshot)

---

## Testing

### Comprehensive Test Suite

Run the production hardening test suite:

```bash
node test-production-hardening.js
```

**Tests cover:**
- Idempotency (duplicate prevention)
- Versioning (force regenerate)
- Preview vs send lock
- Snapshot history listing (all endpoints)
- Email tracking
- Diff-ready metadata storage
- Error handling

**Expected output:**
```
🎉 All production hardening features working correctly!
✅ Tests Passed: 65
❌ Tests Failed: 0
```

### Manual Testing

#### Test Idempotency
```bash
# First request (generates snapshot)
curl -X POST http://localhost:3000/snapshot/generate \
  -H "Content-Type: application/json" \
  -d '{"asOfDate": "2026-01-09", "timeframe": "weekly"}'

# Second request (returns cached, prevents duplicate)
curl -X POST http://localhost:3000/snapshot/generate \
  -H "Content-Type: application/json" \
  -d '{"asOfDate": "2026-01-09", "timeframe": "weekly"}'
```

#### Test Versioning
```bash
# Force regeneration (creates version 2)
curl -X POST http://localhost:3000/snapshot/generate \
  -H "Content-Type: application/json" \
  -d '{"asOfDate": "2026-01-09", "timeframe": "weekly", "forceRegenerate": true}'

# Check version in history
curl http://localhost:3000/snapshot/history?timeframe=weekly&startDate=2026-01-09&endDate=2026-01-09
```

#### Test Preview Lock
```bash
# Try to send without snapshot (should fail with clear error)
curl -X POST http://localhost:3000/snapshot/send \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'

# Generate snapshot first
curl -X POST http://localhost:3000/snapshot/generate \
  -H "Content-Type: application/json" \
  -d '{"asOfDate": "2026-01-09", "timeframe": "weekly"}'

# Now send (should succeed)
curl -X POST http://localhost:3000/snapshot/send \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

#### Test History Listing
```bash
# Last 7 snapshots
curl http://localhost:3000/snapshot/history/last/7

# Date range
curl 'http://localhost:3000/snapshot/history/range?startDate=2026-01-01&endDate=2026-01-10'

# Statistics
curl http://localhost:3000/snapshot/history/stats
```

---

## Implementation Files

### Core Files

1. **[src/utils/snapshotHistory.js](src/utils/snapshotHistory.js)** (450+ lines)
   - Snapshot history index management
   - Idempotency checking
   - Versioning logic
   - Email tracking
   - Listing and filtering functions

2. **[src/server.js](src/server.js)** (Updated)
   - `/snapshot/generate` - Enhanced with idempotency and versioning
   - `/snapshot/send` - Enhanced with preview lock and email tracking
   - `/snapshot/history` - List snapshots with filters
   - `/snapshot/history/last/:count` - Last N snapshots
   - `/snapshot/history/range` - Date range filtering
   - `/snapshot/history/stats` - Statistics

3. **[src/utils/snapshotCache.js](src/utils/snapshotCache.js)** (Existing)
   - File-based persistent cache
   - Atomic writes
   - In-memory LRU cache

4. **[src/utils/dateCalculations.js](src/utils/dateCalculations.js)** (Existing)
   - Date range calculations
   - Week/day boundary handling

### Test Files

1. **[test-production-hardening.js](test-production-hardening.js)** (NEW)
   - 65 comprehensive tests
   - Tests all production features
   - Error handling verification

2. **[test-historical-snapshots.js](test-historical-snapshots.js)** (Existing)
   - 62 tests for historical snapshot system
   - Date range calculations
   - Backward compatibility

---

## Operational Benefits

### For Development Team
- **Confidence**: Comprehensive test coverage (127 tests total)
- **Debugging**: Complete audit trail with request IDs
- **Safety**: Idempotency prevents accidents
- **Clarity**: Clear error messages guide usage

### For Business/Clients
- **Trust**: Every snapshot tracked with timestamp and creator
- **Compliance**: Complete audit trail for regulatory needs
- **Transparency**: Clients can see snapshot history and email status
- **Reliability**: Production-grade features prevent data loss and errors

### For Operations
- **Monitoring**: Statistics endpoint shows system health
- **Troubleshooting**: Snapshot IDs allow precise debugging
- **Data Integrity**: Versioning tracks changes over time
- **Future-Ready**: Diff metadata enables comparison features later

---

## Error Handling

### Validation Errors

All endpoints validate input and return helpful 400 errors:

```json
{
  "ok": false,
  "error": "Invalid date format",
  "message": "Dates must be in YYYY-MM-DD format"
}
```

### System Errors

Internal errors return 500 with context:

```json
{
  "ok": false,
  "error": "Failed to save snapshot",
  "message": "Disk write failed: ENOSPC"
}
```

### Missing Data Errors

Clear 404 errors when data not found:

```json
{
  "ok": false,
  "error": "Snapshot not found",
  "message": "No weekly snapshot found for 2026-01-01"
}
```

---

## Migration Path

### Existing Snapshots
- Old snapshots in cache continue to work
- History index starts empty and builds over time
- No breaking changes to existing endpoints

### Backward Compatibility
- All existing functionality preserved
- New parameters are optional (`forceRegenerate`)
- Old UI code continues to work without changes

---

## Next Steps

1. **UI Integration** - Update frontend to show snapshot history
2. **Monitoring** - Add alerts for snapshot generation failures
3. **Diff Feature** - Build snapshot comparison UI using stored metadata
4. **Export** - Allow downloading snapshot history as CSV/Excel
5. **Scheduling** - Auto-generate snapshots on schedule

---

## Support

For issues or questions:
- Review test output: `node test-production-hardening.js`
- Check server logs for request IDs
- Verify snapshot history: `GET /snapshot/history/stats`
- Contact: Development Team

---

**Document Version**: 1.0
**Last Updated**: 2026-01-10
**Status**: Production Ready ✅
