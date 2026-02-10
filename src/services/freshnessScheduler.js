/**
 * OMEN FRESHNESS SCHEDULER
 *
 * Background cron that checks inventory freshness every 6 hours.
 * If data is stale > 24h, triggers automatic resync.
 *
 * DESIGN:
 * - Non-blocking: Uses setInterval, never blocks request handling
 * - Idempotent: Safe to call multiple times
 * - Logged: All actions recorded to rebuild history
 * - Fail-safe: Errors are logged, not thrown
 */

import { getSystemStatus, rebuildController } from './selfHealingService.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // How often to check (6 hours in ms)
  CHECK_INTERVAL_MS: 6 * 60 * 60 * 1000,

  // Staleness threshold that triggers resync (24 hours)
  STALE_THRESHOLD_HOURS: 24,

  // Startup delay before first check (30 seconds - let server boot)
  STARTUP_DELAY_MS: 30 * 1000,

  // Enable/disable via env var
  ENABLED_ENV_VAR: 'OMEN_FRESHNESS_CRON_ENABLED'
};

// ============================================================================
// STATE
// ============================================================================

let schedulerState = {
  isRunning: false,
  intervalId: null,
  lastCheck: null,
  lastResync: null,
  checkCount: 0,
  resyncCount: 0,
  history: []
};

// ============================================================================
// CORE LOGIC
// ============================================================================

/**
 * Check inventory freshness and trigger resync if needed
 * This is the main cron job function
 *
 * @returns {Promise<{checked: boolean, resynced: boolean, details: object}>}
 */
async function checkAndResyncIfStale() {
  const checkId = `check_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const startTime = Date.now();

  console.log(`[FreshnessCron] ========================================`);
  console.log(`[FreshnessCron] Scheduled check starting: ${checkId}`);
  console.log(`[FreshnessCron] Time: ${new Date().toISOString()}`);
  console.log(`[FreshnessCron] ========================================`);

  const result = {
    checkId,
    timestamp: new Date().toISOString(),
    checked: false,
    resynced: false,
    stale: false,
    ageHours: null,
    error: null,
    duration: null
  };

  try {
    // Get current system status
    const status = await getSystemStatus();
    result.checked = true;
    schedulerState.checkCount++;
    schedulerState.lastCheck = new Date().toISOString();

    // Check if inventory data is available
    if (!status.inventory || status.inventory.lastSyncedAt === null) {
      console.log(`[FreshnessCron] No inventory sync timestamp found - triggering initial sync`);
      result.stale = true;
      result.ageHours = Infinity;
    } else {
      // Calculate age
      const syncTime = new Date(status.inventory.lastSyncedAt);
      const ageHours = (Date.now() - syncTime.getTime()) / (1000 * 60 * 60);
      result.ageHours = Math.round(ageHours * 100) / 100;
      result.stale = ageHours > CONFIG.STALE_THRESHOLD_HOURS;

      console.log(`[FreshnessCron] Inventory age: ${result.ageHours.toFixed(1)} hours`);
      console.log(`[FreshnessCron] Stale threshold: ${CONFIG.STALE_THRESHOLD_HOURS} hours`);
      console.log(`[FreshnessCron] Is stale: ${result.stale}`);
    }

    // Trigger resync if stale
    if (result.stale) {
      console.log(`[FreshnessCron] STALE DATA DETECTED - Triggering automatic resync...`);

      const resyncResult = await rebuildController(
        `Scheduled freshness check: inventory ${result.ageHours === Infinity ? 'never synced' : `${result.ageHours.toFixed(1)}h stale`}`,
        {
          inventory: true,
          orders: false, // Only resync inventory, not orders
          force: false
        }
      );

      result.resynced = true;
      result.resyncResult = {
        ok: resyncResult.ok,
        duration: resyncResult.duration,
        itemCount: resyncResult.results?.inventory?.itemCount || null
      };

      schedulerState.resyncCount++;
      schedulerState.lastResync = new Date().toISOString();

      console.log(`[FreshnessCron] Resync complete:`, result.resyncResult);
    } else {
      console.log(`[FreshnessCron] Data is fresh - no resync needed`);
    }

  } catch (err) {
    console.error(`[FreshnessCron] Check failed:`, err.message);
    result.error = err.message;
  }

  // Record duration
  result.duration = Date.now() - startTime;

  // Add to history (keep last 20)
  schedulerState.history.push(result);
  if (schedulerState.history.length > 20) {
    schedulerState.history = schedulerState.history.slice(-20);
  }

  console.log(`[FreshnessCron] Check complete in ${result.duration}ms`);
  console.log(`[FreshnessCron] ========================================`);

  return result;
}

// ============================================================================
// SCHEDULER CONTROL
// ============================================================================

/**
 * Start the freshness scheduler
 * Called once at server startup
 */
export function startFreshnessScheduler() {
  // Check if already running
  if (schedulerState.isRunning) {
    console.log(`[FreshnessCron] Scheduler already running - skipping start`);
    return { started: false, reason: 'already_running' };
  }

  // Check if disabled via env
  const envEnabled = process.env[CONFIG.ENABLED_ENV_VAR];
  if (envEnabled === 'false' || envEnabled === '0') {
    console.log(`[FreshnessCron] Scheduler disabled via ${CONFIG.ENABLED_ENV_VAR}`);
    return { started: false, reason: 'disabled_by_env' };
  }

  console.log(`[FreshnessCron] ========================================`);
  console.log(`[FreshnessCron] STARTING FRESHNESS SCHEDULER`);
  console.log(`[FreshnessCron] Check interval: ${CONFIG.CHECK_INTERVAL_MS / 1000 / 60 / 60} hours`);
  console.log(`[FreshnessCron] Stale threshold: ${CONFIG.STALE_THRESHOLD_HOURS} hours`);
  console.log(`[FreshnessCron] First check in: ${CONFIG.STARTUP_DELAY_MS / 1000} seconds`);
  console.log(`[FreshnessCron] ========================================`);

  schedulerState.isRunning = true;

  // Run first check after startup delay (let server boot fully)
  setTimeout(async () => {
    console.log(`[FreshnessCron] Running initial startup check...`);
    await checkAndResyncIfStale();
  }, CONFIG.STARTUP_DELAY_MS);

  // Schedule recurring checks
  schedulerState.intervalId = setInterval(async () => {
    await checkAndResyncIfStale();
  }, CONFIG.CHECK_INTERVAL_MS);

  // Ensure interval doesn't prevent process exit
  if (schedulerState.intervalId.unref) {
    schedulerState.intervalId.unref();
  }

  return {
    started: true,
    checkIntervalHours: CONFIG.CHECK_INTERVAL_MS / 1000 / 60 / 60,
    staleThresholdHours: CONFIG.STALE_THRESHOLD_HOURS
  };
}

/**
 * Stop the freshness scheduler
 */
export function stopFreshnessScheduler() {
  if (!schedulerState.isRunning) {
    return { stopped: false, reason: 'not_running' };
  }

  if (schedulerState.intervalId) {
    clearInterval(schedulerState.intervalId);
    schedulerState.intervalId = null;
  }

  schedulerState.isRunning = false;

  console.log(`[FreshnessCron] Scheduler stopped`);

  return { stopped: true };
}

/**
 * Get scheduler status for debugging/monitoring
 */
export function getSchedulerStatus() {
  return {
    isRunning: schedulerState.isRunning,
    config: {
      checkIntervalHours: CONFIG.CHECK_INTERVAL_MS / 1000 / 60 / 60,
      staleThresholdHours: CONFIG.STALE_THRESHOLD_HOURS
    },
    stats: {
      checkCount: schedulerState.checkCount,
      resyncCount: schedulerState.resyncCount,
      lastCheck: schedulerState.lastCheck,
      lastResync: schedulerState.lastResync
    },
    history: schedulerState.history.slice(-10)
  };
}

/**
 * Manually trigger a freshness check (for testing/debugging)
 */
export async function triggerManualCheck() {
  console.log(`[FreshnessCron] Manual check triggered`);
  return checkAndResyncIfStale();
}

export default {
  startFreshnessScheduler,
  stopFreshnessScheduler,
  getSchedulerStatus,
  triggerManualCheck
};
