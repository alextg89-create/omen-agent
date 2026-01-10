/**
 * Snapshot History Index
 *
 * Provides audit trail, versioning, and idempotency for snapshots.
 *
 * Features:
 * - Unique snapshot IDs (UUIDs)
 * - Prevent duplicate snapshots (idempotency)
 * - List by date range, timeframe, count
 * - Snapshot versioning (regenerate vs reuse)
 * - Diff-ready metadata storage
 * - Audit trail (who, when, why)
 *
 * Production guarantees:
 * - Thread-safe (Node.js single-threaded)
 * - Atomic index updates
 * - Fast lookups (in-memory index)
 * - Persistent storage (survives restarts)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Paths
const SNAPSHOTS_DIR = path.resolve(process.cwd(), 'data', 'snapshots');
const INDEX_FILE = path.join(SNAPSHOTS_DIR, 'index.json');

// In-memory index (loaded at startup)
let snapshotIndex = [];

// Ensure directory and index exist
if (!fs.existsSync(SNAPSHOTS_DIR)) {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
}

if (!fs.existsSync(INDEX_FILE)) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify([], null, 2), 'utf-8');
}

// Load index at startup
loadIndex();

/**
 * Load index from disk into memory
 */
function loadIndex() {
  try {
    const content = fs.readFileSync(INDEX_FILE, 'utf-8');
    snapshotIndex = JSON.parse(content);
    console.log(`[SnapshotHistory] Loaded ${snapshotIndex.length} snapshots from index`);
  } catch (err) {
    console.error('[SnapshotHistory] Failed to load index:', err.message);
    snapshotIndex = [];
  }
}

/**
 * Save index to disk (atomic write)
 */
function saveIndex() {
  try {
    const tempFile = INDEX_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(snapshotIndex, null, 2), 'utf-8');
    fs.renameSync(tempFile, INDEX_FILE);
  } catch (err) {
    console.error('[SnapshotHistory] Failed to save index:', err.message);
    throw err;
  }
}

/**
 * Generate unique snapshot ID
 * Format: snapshot_{timeframe}_{asOfDate}_{timestamp}_{uuid}
 *
 * Example: snapshot_weekly_2026-01-09_1736469000000_a1b2c3d4
 */
export function generateSnapshotId(timeframe, asOfDate) {
  const timestamp = Date.now();
  const uuid = crypto.randomUUID().split('-')[0]; // First segment only
  return `snapshot_${timeframe}_${asOfDate}_${timestamp}_${uuid}`;
}

/**
 * Create snapshot entry for index
 *
 * @param {object} snapshot - Snapshot data
 * @param {string} timeframe - "daily" or "weekly"
 * @param {string} asOfDate - YYYY-MM-DD
 * @param {object} options - Additional metadata
 * @returns {object} - Index entry
 */
export function createSnapshotEntry(snapshot, timeframe, asOfDate, options = {}) {
  const id = generateSnapshotId(timeframe, asOfDate);
  const now = new Date().toISOString();

  return {
    // Core identifiers
    id,
    timeframe,
    asOfDate,

    // Timestamps
    createdAt: now,
    generatedAt: snapshot.generatedAt || now,

    // Metadata for auditing
    requestId: snapshot.requestId,
    store: snapshot.store || 'NJWeedWizard',

    // Summary metrics (for quick reference without loading full snapshot)
    summary: {
      itemCount: snapshot.itemCount,
      totalRevenue: snapshot.metrics?.totalRevenue,
      totalProfit: snapshot.metrics?.totalProfit,
      averageMargin: snapshot.metrics?.averageMargin,
      recommendationCount:
        (snapshot.recommendations?.promotions?.length || 0) +
        (snapshot.recommendations?.pricing?.length || 0) +
        (snapshot.recommendations?.inventory?.length || 0)
    },

    // File metadata
    filePath: `${id}.json`,
    sizeBytes: 0, // Updated after file write

    // Versioning (for detecting regenerations)
    version: 1,
    supersedes: null, // ID of snapshot this replaces (if regenerated)

    // Diff-ready metadata (for future comparison)
    diffMetadata: {
      itemsWithPricing: snapshot.metrics?.itemsWithPricing,
      highestMarginSku: snapshot.metrics?.highestMarginItem?.name,
      lowestMarginSku: snapshot.metrics?.lowestMarginItem?.name,
      dateRange: snapshot.dateRange
    },

    // Audit trail
    createdBy: options.createdBy || 'system',
    createdVia: options.createdVia || 'api',
    regenerated: options.regenerated || false,

    // Client-facing
    emailSent: false,
    emailSentAt: null,
    emailRecipient: null
  };
}

/**
 * Check if snapshot already exists for storeId + timeframe + asOfDate
 *
 * MULTI-TENANT: Idempotency is scoped per store
 *
 * @param {string} storeId - Store identifier (REQUIRED)
 * @param {string} timeframe - "daily" or "weekly"
 * @param {string} asOfDate - YYYY-MM-DD
 * @returns {object|null} - Existing snapshot entry or null
 */
export function findExistingSnapshot(storeId, timeframe, asOfDate) {
  if (!storeId) {
    throw new Error('[SnapshotHistory] findExistingSnapshot: storeId is required');
  }

  return snapshotIndex.find(
    entry =>
      entry.store === storeId &&
      entry.timeframe === timeframe &&
      entry.asOfDate === asOfDate
  ) || null;
}

/**
 * Add snapshot to index - MULTI-TENANT
 *
 * IDEMPOTENCY: If snapshot already exists for same store + timeframe + asOfDate,
 * either reuse existing or mark new one as regeneration.
 *
 * CRITICAL: entry.store must be set before calling
 *
 * @param {object} entry - Snapshot index entry (must include entry.store)
 * @param {boolean} forceRegenerate - If true, supersede existing snapshot
 * @returns {object} - { added: boolean, entry: object, superseded: object|null }
 */
export function addToIndex(entry, forceRegenerate = false) {
  if (!entry.store) {
    throw new Error('[SnapshotHistory] addToIndex: entry.store is required');
  }

  const existing = findExistingSnapshot(entry.store, entry.timeframe, entry.asOfDate);

  if (existing && !forceRegenerate) {
    console.log('[SnapshotHistory] Snapshot already exists (idempotent)', {
      id: existing.id,
      timeframe: entry.timeframe,
      asOfDate: entry.asOfDate
    });

    return {
      added: false,
      entry: existing,
      superseded: null,
      reason: 'duplicate_prevented'
    };
  }

  if (existing && forceRegenerate) {
    console.log('[SnapshotHistory] Regenerating snapshot (superseding existing)', {
      oldId: existing.id,
      newId: entry.id
    });

    // Mark new entry as regeneration
    entry.supersedes = existing.id;
    entry.version = existing.version + 1;
    entry.regenerated = true;

    // Remove old entry from index
    snapshotIndex = snapshotIndex.filter(e => e.id !== existing.id);
  }

  // Add to index
  snapshotIndex.push(entry);

  // Sort by createdAt descending (newest first)
  snapshotIndex.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Save index to disk
  saveIndex();

  console.log('[SnapshotHistory] Added to index', {
    id: entry.id,
    timeframe: entry.timeframe,
    asOfDate: entry.asOfDate,
    version: entry.version
  });

  return {
    added: true,
    entry,
    superseded: existing,
    reason: forceRegenerate ? 'regenerated' : 'new'
  };
}

/**
 * Update index entry (e.g., mark email sent)
 *
 * @param {string} id - Snapshot ID
 * @param {object} updates - Fields to update
 */
export function updateIndexEntry(id, updates) {
  const entry = snapshotIndex.find(e => e.id === id);

  if (!entry) {
    console.warn('[SnapshotHistory] Entry not found for update:', id);
    return false;
  }

  Object.assign(entry, updates);
  saveIndex();

  console.log('[SnapshotHistory] Updated entry', { id, updates });
  return true;
}

/**
 * Mark snapshot as emailed
 *
 * @param {string} id - Snapshot ID
 * @param {string} recipient - Email recipient
 */
export function markAsEmailed(id, recipient) {
  return updateIndexEntry(id, {
    emailSent: true,
    emailSentAt: new Date().toISOString(),
    emailRecipient: recipient
  });
}

/**
 * Get snapshot by ID
 *
 * @param {string} id - Snapshot ID
 * @returns {object|null} - Index entry or null
 */
export function getSnapshotById(id) {
  return snapshotIndex.find(e => e.id === id) || null;
}

/**
 * List snapshots with filters - MULTI-TENANT
 *
 * CRITICAL: Requires storeId - no defaults, no fallbacks
 *
 * @param {object} filters
 * @param {string} filters.storeId - Store identifier (REQUIRED)
 * @param {number} filters.limit - Max results (default: 50)
 * @param {string} filters.timeframe - Filter by timeframe
 * @param {string} filters.startDate - YYYY-MM-DD (inclusive)
 * @param {string} filters.endDate - YYYY-MM-DD (inclusive)
 * @param {boolean} filters.emailSent - Filter by email status
 * @returns {Array} - Filtered snapshot entries for this store only
 */
export function listSnapshots(filters = {}) {
  if (!filters.storeId) {
    throw new Error('[SnapshotHistory] listSnapshots: filters.storeId is required');
  }

  let results = [...snapshotIndex];

  // CRITICAL: Filter by storeId FIRST (multi-tenant isolation)
  results = results.filter(e => e.store === filters.storeId);

  // Filter by timeframe
  if (filters.timeframe) {
    results = results.filter(e => e.timeframe === filters.timeframe);
  }

  // Filter by date range (asOfDate between startDate and endDate)
  if (filters.startDate) {
    results = results.filter(e => e.asOfDate >= filters.startDate);
  }
  if (filters.endDate) {
    results = results.filter(e => e.asOfDate <= filters.endDate);
  }

  // Filter by email sent status
  if (filters.emailSent !== undefined) {
    results = results.filter(e => e.emailSent === filters.emailSent);
  }

  // Limit results
  const limit = filters.limit || 50;
  results = results.slice(0, limit);

  return results;
}

/**
 * Get last N snapshots - MULTI-TENANT
 *
 * CRITICAL: Requires storeId - no defaults, no fallbacks
 *
 * @param {string} storeId - Store identifier (REQUIRED)
 * @param {number} count - Number of snapshots to return
 * @param {string} timeframe - Optional timeframe filter
 * @returns {Array} - Snapshot entries for this store only
 */
export function getLastSnapshots(storeId, count = 7, timeframe = null) {
  if (!storeId) {
    throw new Error('[SnapshotHistory] getLastSnapshots: storeId is required');
  }

  return listSnapshots({
    storeId,
    limit: count,
    timeframe
  });
}

/**
 * Get snapshots for date range - MULTI-TENANT
 *
 * CRITICAL: Requires storeId - no defaults, no fallbacks
 *
 * @param {string} storeId - Store identifier (REQUIRED)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {string} timeframe - Optional timeframe filter
 * @returns {Array} - Snapshot entries for this store only
 */
export function getSnapshotsInRange(storeId, startDate, endDate, timeframe = null) {
  if (!storeId) {
    throw new Error('[SnapshotHistory] getSnapshotsInRange: storeId is required');
  }

  return listSnapshots({
    storeId,
    startDate,
    endDate,
    timeframe
  });
}

/**
 * Get latest snapshot (most recent by createdAt) - MULTI-TENANT
 *
 * CRITICAL: Requires storeId - no defaults, no fallbacks
 *
 * @param {string} storeId - Store identifier (REQUIRED)
 * @param {string} timeframe - Optional timeframe filter
 * @returns {object|null} - Latest snapshot entry for this store or null
 */
export function getLatestSnapshotEntry(storeId, timeframe = null) {
  if (!storeId) {
    throw new Error('[SnapshotHistory] getLatestSnapshotEntry: storeId is required');
  }

  const results = listSnapshots({
    storeId,
    limit: 1,
    timeframe
  });

  return results.length > 0 ? results[0] : null;
}

/**
 * Get statistics about snapshot history - MULTI-TENANT
 *
 * CRITICAL: Requires storeId - no defaults, no fallbacks
 *
 * @param {string} storeId - Store identifier (REQUIRED)
 * @returns {object} - Statistics for this store only
 */
export function getStatistics(storeId) {
  if (!storeId) {
    throw new Error('[SnapshotHistory] getStatistics: storeId is required');
  }

  const storeSnapshots = snapshotIndex.filter(e => e.store === storeId);

  const total = storeSnapshots.length;
  const byTimeframe = storeSnapshots.reduce((acc, entry) => {
    acc[entry.timeframe] = (acc[entry.timeframe] || 0) + 1;
    return acc;
  }, {});

  const emailSentCount = storeSnapshots.filter(e => e.emailSent).length;
  const regeneratedCount = storeSnapshots.filter(e => e.regenerated).length;

  const oldestEntry = storeSnapshots[storeSnapshots.length - 1];
  const newestEntry = storeSnapshots[0];

  return {
    total,
    byTimeframe,
    emailSentCount,
    regeneratedCount,
    oldest: oldestEntry ? {
      id: oldestEntry.id,
      asOfDate: oldestEntry.asOfDate,
      createdAt: oldestEntry.createdAt
    } : null,
    newest: newestEntry ? {
      id: newestEntry.id,
      asOfDate: newestEntry.asOfDate,
      createdAt: newestEntry.createdAt
    } : null
  };
}

/**
 * Delete snapshot from index (does not delete file)
 *
 * @param {string} id - Snapshot ID
 * @returns {boolean} - Success
 */
export function deleteFromIndex(id) {
  const initialLength = snapshotIndex.length;
  snapshotIndex = snapshotIndex.filter(e => e.id !== id);

  if (snapshotIndex.length < initialLength) {
    saveIndex();
    console.log('[SnapshotHistory] Deleted from index:', id);
    return true;
  }

  return false;
}

/**
 * Cleanup old snapshots from index
 *
 * @param {number} olderThanDays - Delete entries older than this
 * @returns {number} - Number of entries deleted
 */
export function cleanupOldEntries(olderThanDays = 90) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
  const cutoffISO = cutoffDate.toISOString();

  const initialLength = snapshotIndex.length;
  snapshotIndex = snapshotIndex.filter(e => e.createdAt >= cutoffISO);

  const deletedCount = initialLength - snapshotIndex.length;

  if (deletedCount > 0) {
    saveIndex();
    console.log('[SnapshotHistory] Cleaned up old entries:', {
      deletedCount,
      olderThanDays
    });
  }

  return deletedCount;
}

/**
 * Reload index from disk (useful after external changes)
 */
export function reloadIndex() {
  loadIndex();
}

/**
 * Get full index (for debugging/admin)
 *
 * @returns {Array} - Complete snapshot index
 */
export function getFullIndex() {
  return [...snapshotIndex];
}
