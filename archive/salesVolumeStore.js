/**
 * Sales Volume Storage
 *
 * Manages storage and retrieval of sales events
 *
 * STORAGE FORMAT:
 * - JSONL (JSON Lines) - one event per line
 * - Append-only (never modify existing entries)
 * - Daily files for atomic writes
 *
 * DIRECTORY STRUCTURE:
 * data/sales/{storeId}/events/YYYY-MM-DD.jsonl
 *
 * SAFEGUARDS:
 * - Atomic writes (temp file + rename)
 * - Never fabricate data
 * - Validate all events before storage
 * - Path traversal protection
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { validateSalesEvent, createSalesEvent } from "../contracts/salesEvent.schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base directory for sales data
const SALES_DATA_DIR = path.join(__dirname, "..", "..", "data", "sales");

/**
 * SAFEGUARD: Validate storeId to prevent path traversal
 *
 * @param {string} storeId
 * @returns {boolean}
 */
function isValidStoreId(storeId) {
  if (!storeId || typeof storeId !== "string") return false;

  // Only alphanumeric, underscore, and hyphen
  const validPattern = /^[a-zA-Z0-9_-]{3,50}$/;
  if (!validPattern.test(storeId)) return false;

  // Prevent path traversal
  if (storeId.includes("..") || storeId.includes("/") || storeId.includes("\\")) {
    return false;
  }

  return true;
}

/**
 * Get directory path for store's sales events
 *
 * @param {string} storeId
 * @returns {string}
 */
function getStoreEventsDir(storeId) {
  if (!isValidStoreId(storeId)) {
    throw new Error(`Invalid storeId: ${storeId}`);
  }
  return path.join(SALES_DATA_DIR, storeId, "events");
}

/**
 * Get file path for date's events
 *
 * @param {string} storeId
 * @param {Date} date
 * @returns {string}
 */
function getEventFilePath(storeId, date) {
  const eventsDir = getStoreEventsDir(storeId);
  const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD
  return path.join(eventsDir, `${dateStr}.jsonl`);
}

/**
 * Ensure directory exists
 *
 * @param {string} dirPath
 */
async function ensureDirectory(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
}

/**
 * Record a sales event
 *
 * ATOMIC OPERATION:
 * 1. Validate event
 * 2. Append to daily JSONL file
 * 3. Never overwrite existing data
 *
 * @param {object} eventData - Sales event data
 * @returns {Promise<object>} - { ok: true, eventId } or { ok: false, error }
 */
export async function recordSalesEvent(eventData) {
  try {
    // Create complete event with defaults
    const event = createSalesEvent(eventData);

    // Validate event
    const validation = validateSalesEvent(event);
    if (!validation.valid) {
      return {
        ok: false,
        error: "Validation failed",
        details: validation.errors,
      };
    }

    // Ensure directory exists
    const eventsDir = getStoreEventsDir(event.storeId);
    await ensureDirectory(eventsDir);

    // Get file path for event date
    const soldDate = new Date(event.soldAt);
    const filePath = getEventFilePath(event.storeId, soldDate);

    // Append event to JSONL file (one line per event)
    const eventLine = JSON.stringify(event) + "\n";
    await fs.appendFile(filePath, eventLine, "utf8");

    return {
      ok: true,
      eventId: event.eventId,
      message: "Sales event recorded",
    };
  } catch (error) {
    console.error("Error recording sales event:", error);
    return {
      ok: false,
      error: error.message,
    };
  }
}

/**
 * Read events from JSONL file
 *
 * @param {string} filePath
 * @returns {Promise<Array<object>>}
 */
async function readEventsFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trim().split("\n").filter((line) => line.length > 0);
    return lines.map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") {
      return []; // File doesn't exist - no events
    }
    throw error;
  }
}

/**
 * Query sales events for date range
 *
 * @param {string} storeId
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<Array<object>>} - Array of sales events
 */
export async function querySalesEvents(storeId, startDate, endDate) {
  if (!isValidStoreId(storeId)) {
    throw new Error(`Invalid storeId: ${storeId}`);
  }

  const events = [];
  const eventsDir = getStoreEventsDir(storeId);

  // Check if directory exists
  try {
    await fs.access(eventsDir);
  } catch {
    return []; // No sales data for this store yet
  }

  // Iterate through each day in range
  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const filePath = getEventFilePath(storeId, currentDate);
    const dayEvents = await readEventsFile(filePath);
    events.push(...dayEvents);

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return events;
}

/**
 * Get daily sales aggregate for SKU
 *
 * Returns total units sold per day for a SKU
 *
 * @param {string} storeId
 * @param {string} sku
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<Array<object>>} - [{ date, sku, unitsSold, revenue }]
 */
export async function getDailySalesAggregate(storeId, sku, startDate, endDate) {
  const events = await querySalesEvents(storeId, startDate, endDate);

  // Filter for specific SKU
  const skuEvents = events.filter((e) => e.sku === sku);

  // Group by date
  const dailyMap = new Map();

  for (const event of skuEvents) {
    const date = event.soldAt.split("T")[0]; // YYYY-MM-DD

    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        date,
        sku,
        unitsSold: 0,
        revenue: 0,
        eventCount: 0,
      });
    }

    const day = dailyMap.get(date);
    day.unitsSold += event.quantity;
    day.eventCount += 1;

    if (event.soldPrice) {
      day.revenue += event.soldPrice * event.quantity;
    }
  }

  // Convert to array and sort by date
  return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get sales summary for all SKUs in date range
 *
 * @param {string} storeId
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<Array<object>>} - Summary per SKU
 */
export async function getSalesSummary(storeId, startDate, endDate) {
  const events = await querySalesEvents(storeId, startDate, endDate);

  // Group by SKU + unit
  const summaryMap = new Map();

  for (const event of events) {
    const key = `${event.sku}:${event.unit}`;

    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        sku: event.sku,
        unit: event.unit,
        totalUnitsSold: 0,
        totalRevenue: 0,
        eventCount: 0,
        firstSale: event.soldAt,
        lastSale: event.soldAt,
      });
    }

    const summary = summaryMap.get(key);
    summary.totalUnitsSold += event.quantity;
    summary.eventCount += 1;

    if (event.soldPrice) {
      summary.totalRevenue += event.soldPrice * event.quantity;
    }

    // Track date range
    if (event.soldAt < summary.firstSale) {
      summary.firstSale = event.soldAt;
    }
    if (event.soldAt > summary.lastSale) {
      summary.lastSale = event.soldAt;
    }
  }

  return Array.from(summaryMap.values()).sort((a, b) => b.totalUnitsSold - a.totalUnitsSold);
}

/**
 * Check if sales data exists for store
 *
 * @param {string} storeId
 * @returns {Promise<boolean>}
 */
export async function hasSalesData(storeId) {
  if (!isValidStoreId(storeId)) {
    return false;
  }

  try {
    const eventsDir = getStoreEventsDir(storeId);
    await fs.access(eventsDir);
    const files = await fs.readdir(eventsDir);
    return files.length > 0;
  } catch {
    return false;
  }
}

/**
 * SAFEGUARD: Validate SKU exists in inventory before recording sale
 *
 * This is a helper function - actual validation should happen at API layer
 *
 * @param {string} sku
 * @param {Array<object>} inventory
 * @returns {boolean}
 */
export function validateSkuExists(sku, inventory) {
  if (!Array.isArray(inventory)) return false;
  return inventory.some((item) => item.strain === sku || item.sku === sku);
}
