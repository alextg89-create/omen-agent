/**
 * Snapshot Persistence Layer
 *
 * Provides file-based caching for historical snapshots with:
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
 */

import fs from 'fs';
import path from 'path';
import { generateSnapshotKey } from './dateCalculations.js';

// Cache directory
const CACHE_DIR = path.resolve(process.cwd(), 'data', 'snapshots');

// In-memory cache (LRU with max 100 entries)
const memoryCache = new Map();
const MAX_MEMORY_CACHE_SIZE = 100;

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log('[SnapshotCache] Created cache directory:', CACHE_DIR);
}

/**
 * Save snapshot to cache
 *
 * Uses atomic write pattern:
 * 1. Write to temporary file
 * 2. Rename to final location (atomic on POSIX)
 *
 * @param {string} timeframe - 'daily' or 'weekly'
 * @param {string} asOfDate - Date in YYYY-MM-DD
 * @param {object} snapshot - Snapshot data
 * @returns {object} - { success: boolean, path: string }
 */
export function saveSnapshot(timeframe, asOfDate, snapshot) {
  const key = generateSnapshotKey(timeframe, asOfDate);
  const filePath = path.join(CACHE_DIR, `${key}.json`);
  const tempPath = path.join(CACHE_DIR, `${key}.tmp.json`);

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

    // Update in-memory cache
    updateMemoryCache(key, cacheEntry);

    console.log('[SnapshotCache] Saved snapshot:', { key, path: filePath });

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
 * Load snapshot from cache
 *
 * Checks memory cache first, then falls back to disk
 *
 * @param {string} timeframe - 'daily' or 'weekly'
 * @param {string} asOfDate - Date in YYYY-MM-DD
 * @returns {object|null} - Cached snapshot or null if not found
 */
export function loadSnapshot(timeframe, asOfDate) {
  const key = generateSnapshotKey(timeframe, asOfDate);

  // Check memory cache first
  if (memoryCache.has(key)) {
    console.log('[SnapshotCache] Memory cache hit:', key);
    return memoryCache.get(key);
  }

  // Check disk cache
  const filePath = path.join(CACHE_DIR, `${key}.json`);

  if (!fs.existsSync(filePath)) {
    console.log('[SnapshotCache] Cache miss:', key);
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const cacheEntry = JSON.parse(content);

    // Update memory cache
    updateMemoryCache(key, cacheEntry);

    console.log('[SnapshotCache] Disk cache hit:', key);
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
 * Get the most recently cached snapshot
 *
 * Used by /snapshot/send to send the latest snapshot regardless of date
 *
 * @returns {object|null} - Most recent snapshot or null if none exist
 */
export function getLatestSnapshot() {
  try {
    // Read all snapshot files
    const files = fs.readdirSync(CACHE_DIR)
      .filter(f => f.startsWith('snapshot_') && f.endsWith('.json'))
      .map(f => {
        const filePath = path.join(CACHE_DIR, f);
        const stats = fs.statSync(filePath);
        return {
          path: filePath,
          mtime: stats.mtime.getTime()
        };
      })
      .sort((a, b) => b.mtime - a.mtime); // Sort by modified time descending

    if (files.length === 0) {
      console.log('[SnapshotCache] No cached snapshots found');
      return null;
    }

    // Load most recent file
    const content = fs.readFileSync(files[0].path, 'utf-8');
    const cacheEntry = JSON.parse(content);

    console.log('[SnapshotCache] Loaded latest snapshot:', {
      key: cacheEntry.key,
      cachedAt: cacheEntry.cachedAt
    });

    return cacheEntry;
  } catch (err) {
    console.error('[SnapshotCache] Failed to get latest snapshot:', err.message);
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
 * List all cached snapshots
 * @returns {Array} - List of cached snapshot metadata
 */
export function listCachedSnapshots() {
  try {
    const files = fs.readdirSync(CACHE_DIR)
      .filter(f => f.startsWith('snapshot_') && f.endsWith('.json'))
      .map(f => {
        const filePath = path.join(CACHE_DIR, f);
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
