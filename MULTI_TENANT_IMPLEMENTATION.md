# Multi-Tenant Implementation Plan

## Status: IN PROGRESS

This document tracks the systematic implementation of multi-tenant isolation.

---

## Phase 1: Core Infrastructure ✅ IN PROGRESS

### 1.1 Authentication Middleware ✅ COMPLETE
- [x] Created `src/middleware/auth.js`
- [x] JWT extraction and verification
- [x] storeId validation (alphanumeric + underscores, 3-50 chars)
- [x] Token generation utility
- [x] Admin role enforcement
- [x] Test token generation (dev only)

### 1.2 Storage Partitioning 🔄 IN PROGRESS
- [x] Updated `src/utils/snapshotCache.js` header
- [x] Added `getStoreCacheDir()` - creates `data/snapshots/{storeId}/`
- [x] Added `getStoreCacheKey()` - cache keys include storeId
- [x] Updated `saveSnapshot()` - requires storeId parameter
- [x] Updated `loadSnapshot()` - requires storeId parameter
- [ ] Update `getLatestSnapshot()` - filter by storeId
- [ ] Update `listCachedSnapshots()` - filter by storeId
- [ ] Update `cleanupOldSnapshots()` - scope to storeId

### 1.3 History Index Multi-Tenant 🔄 PENDING
- [ ] Update `src/utils/snapshotHistory.js`
- [ ] Modify `findExistingSnapshot()` - require storeId
- [ ] Modify `addToIndex()` - validate storeId
- [ ] Modify `listSnapshots()` - filter by storeId
- [ ] Modify `getLatestSnapshotEntry()` - filter by storeId
- [ ] Update index file structure: `data/snapshots/{storeId}/index.json` OR single index with store field

---

## Phase 2: API Endpoints 🔄 PENDING

### 2.1 POST /snapshot/generate
- [ ] Add `authenticateStore` middleware
- [ ] Extract `storeId` from `req.user.storeId` (NOT req.body)
- [ ] Pass `storeId` to all cache/history functions
- [ ] Update idempotency check to include storeId
- [ ] Update logging to include storeId

### 2.2 POST /snapshot/send - CRITICAL FIX
- [ ] Add `authenticateStore` middleware
- [ ] **BREAKING CHANGE**: Require explicit snapshot selection:
  - Option A: `snapshotId` (recommended)
  - Option B: `{ timeframe, asOfDate }` + filter by auth storeId
- [ ] Remove "get latest globally" behavior
- [ ] Validate snapshot belongs to authenticated store
- [ ] Return 403 if cross-store access attempted

### 2.3 GET /snapshot/history
- [ ] Add `authenticateStore` middleware
- [ ] Filter results by `req.user.storeId`
- [ ] Never return snapshots from other stores

### 2.4 GET /snapshot/history/last/:count
- [ ] Add `authenticateStore` middleware
- [ ] Filter by authenticated storeId

### 2.5 GET /snapshot/history/range
- [ ] Add `authenticateStore` middleware
- [ ] Filter by authenticated storeId

### 2.6 GET /snapshot/history/stats
- [ ] Add `authenticateStore` middleware
- [ ] Return stats only for authenticated store

### 2.7 GET /snapshot/list
- [ ] Add `authenticateStore` middleware
- [ ] Filter by authenticated storeId

### 2.8 GET /snapshot/get
- [ ] Add `authenticateStore` middleware
- [ ] Filter by authenticated storeId
- [ ] Return 404 if snapshot exists but belongs to different store

---

## Phase 3: Testing 🔄 PENDING

### 3.1 Multi-Tenant Isolation Tests
- [ ] Create `test-multi-tenant-isolation.js`
- [ ] Test: Client A cannot see Client B snapshots
- [ ] Test: Client A cannot send Client B snapshot
- [ ] Test: Idempotency scoped per store (A and B can have same date snapshot)
- [ ] Test: Concurrent snapshot generation (A and B same date)
- [ ] Test: Cross-store access returns 403
- [ ] Test: Invalid storeId rejected (path traversal attempt)

### 3.2 Authentication Tests
- [ ] Test: Missing Authorization header → 401
- [ ] Test: Invalid JWT → 401
- [ ] Test: Expired JWT → 401
- [ ] Test: JWT missing storeId → 401
- [ ] Test: Valid JWT → 200 with correct storeId

### 3.3 Email Determinism Tests
- [ ] Test: Send with snapshotId → sends exact snapshot
- [ ] Test: Send with timeframe+date → sends correct snapshot for authenticated store
- [ ] Test: Send with invalid snapshotId → 404
- [ ] Test: Send with other store's snapshotId → 403

---

## Phase 4: Migration & Deployment 🔄 PENDING

### 4.1 Data Migration
- [ ] Create migration script: `scripts/migrate-to-multi-tenant.js`
- [ ] Move existing snapshots from `data/snapshots/*.json` to `data/snapshots/NJWeedWizard/*.json`
- [ ] Update index entries to include storeId
- [ ] Backup before migration
- [ ] Test rollback procedure

### 4.2 Breaking Changes Documentation
- [ ] Document API changes in `BREAKING_CHANGES.md`
- [ ] Update API reference docs
- [ ] Add migration guide for clients
- [ ] Version bump strategy (v1 → v2)

### 4.3 Deployment Checklist
- [ ] Set JWT_SECRET environment variable (production)
- [ ] Run data migration
- [ ] Deploy new code
- [ ] Test with NJWeedWizard (existing client)
- [ ] Onboard Client #2 (CaliCannabis)
- [ ] Monitor logs for cross-store access attempts
- [ ] Monitor error rates

---

## Critical Security Checks

### ✅ Completed
- [x] storeId extracted from JWT (server-signed), not request body
- [x] storeId validated for path traversal prevention
- [x] Store directories created with validation

### 🔄 In Progress
- [ ] All cache operations require storeId
- [ ] All history operations require storeId
- [ ] All API endpoints validate storeId from auth

### 🔒 Must Verify Before Production
- [ ] No code path allows cross-store data access
- [ ] No default storeId fallbacks anywhere
- [ ] All snapshot operations scoped to authenticated store
- [ ] Email delivery cannot leak data between stores
- [ ] Audit logs include storeId for all operations

---

## File Status

| File | Status | Changes Required |
|------|--------|------------------|
| `src/middleware/auth.js` | ✅ COMPLETE | None |
| `src/utils/snapshotCache.js` | 🔄 IN PROGRESS | Update remaining functions |
| `src/utils/snapshotHistory.js` | 🔄 PENDING | Add storeId to all operations |
| `src/server.js` | 🔄 PENDING | Add auth middleware, update endpoints |
| `test-multi-tenant-isolation.js` | ❌ NOT STARTED | Create new test file |
| `scripts/migrate-to-multi-tenant.js` | ❌ NOT STARTED | Create migration script |
| `BREAKING_CHANGES.md` | ❌ NOT STARTED | Document API changes |

---

## Next Steps (Priority Order)

1. ✅ Complete `snapshotCache.js` updates (getLatestSnapshot, listCachedSnapshots)
2. Update `snapshotHistory.js` for multi-tenant
3. Update `server.js` endpoints with authentication
4. Create multi-tenant test suite
5. Create migration script
6. Document breaking changes
7. Test end-to-end with two simulated clients

---

## Estimated Completion

- **Remaining Core Implementation**: 6-8 hours
- **Testing & Validation**: 4-6 hours
- **Migration & Documentation**: 2-4 hours
- **Total**: 12-18 hours

**Target**: Complete before onboarding Client #2
