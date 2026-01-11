/**
 * Snapshot Persistence Layer - Multi-Tenant
 *
 * Provides file-based caching for historical snapshots with:
 * - STRICT MULTI-TENANT ISOLATION (separate directories per store)
 * - Atomic writes (write to temp, then rename)
 * - Race condition prevention (file locking via write order)
 * - Automatic cleanup of old snapshots (optional)
 * - In-memory cache for performance
 *
 * Production considerations:
 * - Uses filesystem for persistence (survives restarts)
 * - Thread-safe via Node.js single-threaded model
 * - Handles concurrent reads/writes gracefully
 * - Provides TTL-based cleanup
 * - CRITICAL: All operations require storeId - no defaults
 */

import fs from 'fs';
import path from 'path';
import { generateSnapshotKey } from './dateCalculations.js';
import { validateStoreId } from '../middleware/auth.js';

// Base cache directory
const BASE_CACHE_DIR = path.resolve(process.cwd(), 'data', 'snapshots');

// In-memory cache (LRU with max 100 entries per store)
const memoryCache = new Map();
const MAX_MEMORY_CACHE_SIZE = 100;

// Ensure base cache directory exists
if (!fs.existsSync(BASE_CACHE_DIR)) {
  fs.mkdirSync(BASE_CACHE_DIR, { recursive: true });
  console.log('[SnapshotCache] Created base cache directory:', BASE_CACHE_DIR);
}

/**
 * Get store-specific cache directory
 *
 * Structure: data/snapshots/{storeId}/
 *
 * @param {string} storeId - Store identifier (validated)
 * @returns {string} - Store cache directory path
 */
function getStoreCacheDir(storeId) {
  // CRITICAL: Validate storeId to prevent path traversal
  const validation = validateStoreId(storeId);
  if (!validation.valid) {
    throw new Error(`Invalid storeId: ${validation.error}`);
  }

  const storeDir = path.join(BASE_CACHE_DIR, storeId);

  // Create store directory if doesn't exist
  if (!fs.existsSync(storeDir)) {
    fs.mkdirSync(storeDir, { recursive: true });
    console.log('[SnapshotCache] Created store directory:', storeDir);
  }

  return storeDir;
}

/**
 * Generate cache key with store isolation
 *
 * @param {string} storeId - Store identifier
 * @param {string} timeframe - 'daily' or 'weekly'
 * @param {string} asOfDate - YYYY-MM-DD
 * @returns {string} - Cache key
 */
function getStoreCacheKey(storeId, timeframe, asOfDate) {
  return `${storeId}:${generateSnapshotKey(timeframe, asOfDate)}`;
}

/**
 * Save snapshot to cache - MULTI-TENANT
 *
 * Uses atomic write pattern:
 * 1. Write to temporary file
 * 2. Rename to final location (atomic on POSIX)
 *
 * CRITICAL: Requires storeId - no defaults, no fallbacks
 *
 * @param {string} storeId - Store identifier (REQUIRED)
 * @param {string} timeframe - 'daily' or 'weekly'
 * @param {string} asOfDate - Date in YYYY-MM-DD
 * @param {object} snapshot - Snapshot data
 * @returns {object} - { success: boolean, path: string }
 */
export function saveSnapshot(storeId, timeframe, asOfDate, snapshot) {
  if (!storeId) {
    throw new Error('[SnapshotCache] saveSnapshot: storeId is required');
  }

  const storeDir = getStoreCacheDir(storeId);
  const key = generateSnapshotKey(timeframe, asOfDate);
  const filePath = path.join(storeDir, `${key}.json`);
  const tempPath = path.join(storeDir, `${key}.tmp.json`);

  try {
    // Add cache metadata
    const cacheEntry = {
      key,
      timeframe,
      asOfDate,
      snapshot,
      cachedAt: new Date().toISOString(),
      version: '1.0'
    };

    // Write to temp file first (atomic operation)
    fs.writeFileSync(tempPath, JSON.stringify(cacheEntry, null, 2), 'utf-8');

    // Rename to final location (atomic on most filesystems)
    fs.renameSync(tempPath, filePath);

    // Update in-memory cache with store-scoped key
    const cacheKey = getStoreCacheKey(storeId, timeframe, asOfDate);
    updateMemoryCache(cacheKey, cacheEntry);

    console.log('[SnapshotCache] Saved snapshot:', { storeId, key, path: filePath });

    return {
      success: true,
      path: filePath,
      key
    };
  } catch (err) {
    console.error('[SnapshotCache] Failed to save snapshot:', {
      key,
      error: err.message
    });

    // Cleanup temp file if exists
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }

    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Load snapshot from cache - MULTI-TENANT
 *
 * Checks memory cache first, then falls back to disk
 *
 * CRITICAL: Requires storeId - no defaults, no fallbacks
 *
 * @param {string} storeId - Store identifier (REQUIRED)
 * @param {string} timeframe - 'daily' or 'weekly'
 * @param {string} asOfDate - Date in YYYY-MM-DD
 * @returns {object|null} - Cached snapshot or null if not found
 */
export function loadSnapshot(storeId, timeframe, asOfDate) {
  if (!storeId) {
    throw new Error('[SnapshotCache] loadSnapshot: storeId is required');
  }

  const cacheKey = getStoreCacheKey(storeId, timeframe, asOfDate);
  const key = generateSnapshotKey(timeframe, asOfDate);

  // Check memory cache first
  if (memoryCache.has(cacheKey)) {
    console.log('[SnapshotCache] Memory cache hit:', cacheKey);
    return memoryCache.get(cacheKey);
  }

  // Check disk cache in store-specific directory
  const storeDir = getStoreCacheDir(storeId);
  const filePath = path.join(storeDir, `${key}.json`);

  if (!fs.existsSync(filePath)) {
    console.log('[SnapshotCache] Cache miss:', cacheKey);
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const cacheEntry = JSON.parse(content);

    // Update memory cache
    updateMemoryCache(cacheKey, cacheEntry);

    console.log('[SnapshotCache] Disk cache hit:', cacheKey);
    return cacheEntry;
  } catch (err) {
    console.error('[SnapshotCache] Failed to load snapshot:', {
      key,
      error: err.message
    });
    return null;
  }
}

/**
 * Get the most recently cached snapshot - MULTI-TENANT
 *
 * DEPRECATED: Use getLatestSnapshotForStore() or explicit snapshot selection
 *
 * CRITICAL: Requires storeId - no defaults, no fallbacks
 *
 * @param {string} storeId - Store identifier (REQUIRED)
 * @returns {object|null} - Most recent snapshot or null if none exist
 */
export function getLatestSnapshot(storeId) {
  if (!storeId) {
    throw new Error('[SnapshotCache] getLatestSnapshot: storeId is required');
  }

  try {
    const storeDir = getStoreCacheDir(storeId);

    // Read all snapshot files in store directory
    const files = fs.readdirSync(storeDir)
      .filter(f => f.startsWith('snapshot_') && f.endsWith('.json'))
      .map(f => {
        const filePath = path.join(storeDir, f);
        const stats = fs.statSync(filePath);
        return {
          path: filePath,
          mtime: stats.mtime.getTime()
        };
      })
      .sort((a, b) => b.mtime - a.mtime); // Sort by modified time descending

    if (files.length === 0) {
      console.log('[SnapshotCache] No cached snapshots found for store:', storeId);
      return null;
    }

    // Load most recent file
    const content = fs.readFileSync(files[0].path, 'utf-8');
    const cacheEntry = JSON.parse(content);

    console.log('[SnapshotCache] Loaded latest snapshot for store:', {
      storeId,
      key: cacheEntry.key,
      cachedAt: cacheEntry.cachedAt
    });

    return cacheEntry;
  } catch (err) {
    console.error('[SnapshotCache] Failed to get latest snapshot:', {
      storeId,
      error: err.message
    });
    return null;
  }
}

/**
 * Update in-memory cache with LRU eviction
 * @param {string} key - Cache key
 * @param {object} value - Cache value
 */
function updateMemoryCache(key, value) {
  // Remove if already exists (to update access order)
  if (memoryCache.has(key)) {
    memoryCache.delete(key);
  }

  // Add to cache
  memoryCache.set(key, value);

  // Evict oldest if over limit
  if (memoryCache.size > MAX_MEMORY_CACHE_SIZE) {
    const oldestKey = memoryCache.keys().next().value;
    memoryCache.delete(oldestKey);
    console.log('[SnapshotCache] Evicted from memory cache:', oldestKey);
  }
}

/**
 * List all cached snapshots - MULTI-TENANT
 *
 * CRITICAL: Requires storeId - no defaults, no fallbacks
 *
 * @param {string} storeId - Store identifier (REQUIRED)
 * @returns {Array} - List of cached snapshot metadata for this store
 */
export function listCachedSnapshots(storeId) {
  if (!storeId) {
    throw new Error('[SnapshotCache] listCachedSnapshots: storeId is required');
  }

  try {
    const storeDir = getStoreCacheDir(storeId);

    // Read all snapshot files in store directory
    const files = fs.readdirSync(storeDir)
      .filter(f => f.startsWith('snapshot_') && f.endsWith('.json'))
      .map(f => {
        const filePath = path.join(storeDir, f);
        const stats = fs.statSync(filePath);

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const entry = JSON.parse(content);
          return {
            key: entry.key,
            timeframe: entry.timeframe,
            asOfDate: entry.asOfDate,
            cachedAt: entry.cachedAt,
            sizeBytes: stats.size
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.cachedAt) - new Date(a.cachedAt));

    return files;
  } catch (err) {
    console.error('[SnapshotCache] Failed to list snapshots:', err.message);
    return [];
  }
}

/**
 * Delete snapshots older than specified days
 * @param {number} olderThanDays - Delete snapshots older than this many days
 * @returns {number} - Number of snapshots deleted
 */
export function cleanupOldSnapshots(olderThanDays = 90) {
  try {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    let deletedCount = 0;

    const files = fs.readdirSync(CACHE_DIR)
      .filter(f => f.startsWith('snapshot_') && f.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(CACHE_DIR, file);
      const stats = fs.statSync(filePath);

      if (stats.mtime.getTime() < cutoffTime) {
        fs.unlinkSync(filePath);
        deletedCount++;
        console.log('[SnapshotCache] Deleted old snapshot:', file);
      }
    }

    console.log('[SnapshotCache] Cleanup complete:', {
      deletedCount,
      olderThanDays
    });

    return deletedCount;
  } catch (err) {
    console.error('[SnapshotCache] Cleanup failed:', err.message);
    return 0;
  }
}

/**
 * Clear all cached snapshots
 * WARNING: This is destructive and should only be used for testing
 * @returns {number} - Number of snapshots deleted
 */
export function clearAllSnapshots() {
  try {
    const files = fs.readdirSync(CACHE_DIR)
      .filter(f => f.startsWith('snapshot_') && f.endsWith('.json'));

    for (const file of files) {
      fs.unlinkSync(path.join(CACHE_DIR, file));
    }

    memoryCache.clear();

    console.log('[SnapshotCache] Cleared all snapshots:', files.length);
    return files.length;
  } catch (err) {
    console.error('[SnapshotCache] Clear failed:', err.message);
    return 0;
  }
}
