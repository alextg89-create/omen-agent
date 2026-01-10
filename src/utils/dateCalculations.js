/**
 * Date Calculations Utility
 *
 * Handles all date range calculations for snapshot timeframes.
 * Uses asOfDate as the logical "now" for all calculations.
 *
 * Production considerations:
 * - Timezone-aware (uses UTC for consistency)
 * - Handles edge cases (month boundaries, leap years)
 * - Returns ISO 8601 formatted dates
 * - Validates input dates
 */

/**
 * Validate and parse date string
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {Date|null} - Parsed Date object or null if invalid
 */
export function parseDate(dateString) {
  if (!dateString || typeof dateString !== 'string') {
    return null;
  }

  // Validate YYYY-MM-DD format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) {
    return null;
  }

  const date = new Date(dateString + 'T00:00:00.000Z');

  // Check if date is valid
  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

/**
 * Get the logical "now" timestamp
 * @param {string|null} asOfDate - Optional YYYY-MM-DD override
 * @returns {Date} - The effective "now" moment
 */
export function getEffectiveNow(asOfDate = null) {
  if (asOfDate) {
    const parsed = parseDate(asOfDate);
    if (parsed) {
      // Set to end of day (23:59:59.999) for "as of" semantics
      parsed.setUTCHours(23, 59, 59, 999);
      return parsed;
    }
  }

  return new Date(); // Current timestamp
}

/**
 * Calculate date range for "daily" timeframe
 *
 * Daily = midnight to 11:59:59.999 PM of asOfDate
 *
 * @param {string|null} asOfDate - Optional YYYY-MM-DD override
 * @returns {object} - { startDate, endDate, asOfDate, timeframe }
 */
export function calculateDailyRange(asOfDate = null) {
  const effectiveNow = getEffectiveNow(asOfDate);

  // Start of day (00:00:00.000 UTC)
  const startDate = new Date(effectiveNow);
  startDate.setUTCHours(0, 0, 0, 0);

  // End of day (23:59:59.999 UTC)
  const endDate = new Date(effectiveNow);
  endDate.setUTCHours(23, 59, 59, 999);

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    asOfDate: asOfDate || formatDate(effectiveNow),
    timeframe: 'daily'
  };
}

/**
 * Calculate date range for "weekly" timeframe
 *
 * Weekly = Monday 00:00:00 to Sunday 23:59:59.999 of the week containing asOfDate
 * Week starts on Monday (ISO 8601)
 *
 * @param {string|null} asOfDate - Optional YYYY-MM-DD override
 * @returns {object} - { startDate, endDate, asOfDate, timeframe }
 */
export function calculateWeeklyRange(asOfDate = null) {
  const effectiveNow = getEffectiveNow(asOfDate);

  // Get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  const dayOfWeek = effectiveNow.getUTCDay();

  // Calculate days since Monday (ISO week starts on Monday)
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  // Start of week (Monday 00:00:00 UTC)
  const startDate = new Date(effectiveNow);
  startDate.setUTCDate(effectiveNow.getUTCDate() - daysSinceMonday);
  startDate.setUTCHours(0, 0, 0, 0);

  // End of week (Sunday 23:59:59.999 UTC)
  const endDate = new Date(startDate);
  endDate.setUTCDate(startDate.getUTCDate() + 6);
  endDate.setUTCHours(23, 59, 59, 999);

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    asOfDate: asOfDate || formatDate(effectiveNow),
    timeframe: 'weekly'
  };
}

/**
 * Format Date object as YYYY-MM-DD
 * @param {Date} date - Date to format
 * @returns {string} - Formatted date string
 */
export function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculate date range based on timeframe
 * @param {string} timeframe - 'daily' or 'weekly'
 * @param {string|null} asOfDate - Optional YYYY-MM-DD override
 * @returns {object} - Date range object
 */
export function calculateDateRange(timeframe = 'weekly', asOfDate = null) {
  switch (timeframe) {
    case 'daily':
      return calculateDailyRange(asOfDate);
    case 'weekly':
      return calculateWeeklyRange(asOfDate);
    default:
      throw new Error(`Invalid timeframe: ${timeframe}. Must be 'daily' or 'weekly'.`);
  }
}

/**
 * Validate asOfDate is not in the future
 * @param {string} asOfDate - Date to validate
 * @returns {boolean} - True if valid, false if in future
 */
export function validateAsOfDate(asOfDate) {
  if (!asOfDate) return true; // null/undefined is valid (means "now")

  const parsed = parseDate(asOfDate);
  if (!parsed) return false; // Invalid format

  const now = new Date();
  now.setUTCHours(23, 59, 59, 999); // End of today

  return parsed <= now; // asOfDate must be <= today
}

/**
 * Generate snapshot cache key
 * @param {string} timeframe - 'daily' or 'weekly'
 * @param {string} asOfDate - Date in YYYY-MM-DD format
 * @returns {string} - Cache key
 */
export function generateSnapshotKey(timeframe, asOfDate) {
  return `snapshot_${timeframe}_${asOfDate}`;
}
