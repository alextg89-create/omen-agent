import fs from "fs";
import path from "path";

/**
 * Disk-backed inventory store
 */

const STORE_PATH = path.resolve("src/data/data/inventory.snapshot.json");

let INVENTORY_STORE = new Map();

/**
 * Load snapshot from disk on boot
 */
(function loadFromDisk() {
  if (!fs.existsSync(STORE_PATH)) {
    console.log("[inventoryStore] No snapshot found on disk");
    return;
  }

  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);

    if (
      parsed &&
      typeof parsed === "object" &&
      Object.keys(parsed).length > 0
    ) {
      INVENTORY_STORE = new Map(Object.entries(parsed));
      console.log(
        "[inventoryStore] Loaded snapshot from disk with",
        INVENTORY_STORE.size,
        "sources"
      );
    } else {
      console.log(
        "[inventoryStore] Snapshot exists but is empty — keeping in-memory store"
      );
    }
  } catch (err) {
    console.warn(
      "[inventoryStore] Failed to load snapshot:",
      err.message
    );
  }
})();

/**
 * Persist snapshot to disk
 */
function persistToDisk() {
  const obj = Object.fromEntries(INVENTORY_STORE);
  fs.writeFileSync(STORE_PATH, JSON.stringify(obj, null, 2));
}

/**
 * Save inventory snapshot
 */
export function saveInventory(source, items = []) {
  INVENTORY_STORE.set(source, items);
  persistToDisk();

  return {
    source,
    count: items.length,
    storedAt: new Date().toISOString(),
  };
}

/**
 * Retrieve inventory snapshot
 */
export function getInventory(source) {
  return INVENTORY_STORE.get(source) || [];
}

/**
 * Clear inventory (optional)
 */
export function clearInventory(source) {
  if (source) {
    INVENTORY_STORE.delete(source);
  } else {
    INVENTORY_STORE.clear();
  }
  persistToDisk();
}


