import fs from "fs";
import path from "path";

/**
 * Build a merchandised snapshot from normalized inventory.
 * Pure function. No side effects.
 */
function buildInventorySnapshot(items = []) {
  const snapshot = {
    generated_at: new Date().toISOString(),
    featuredDeals: [],
    categories: {},
    lowStock: [],
    meta: {
      total: items.length,
      inStock: 0,
      outOfStock: 0
    }
  };

  for (const item of items) {
    if (item.in_stock) snapshot.meta.inStock++;
    else snapshot.meta.outOfStock++;

    // Featured deals (ONLY if discount already exists)
    if (
      item.in_stock &&
      typeof item.discount_percent === "number" &&
      item.discount_percent >= 20
    ) {
      snapshot.featuredDeals.push(item);
    }

    // Category grouping
    const category = item.category || "uncategorized";
    if (!snapshot.categories[category]) {
      snapshot.categories[category] = [];
    }
    snapshot.categories[category].push(item);

    // Low stock signal
    if (
      typeof item.current_stock === "number" &&
      item.current_stock <= 5
    ) {
      snapshot.lowStock.push(item);
    }
  }

  return snapshot;
}

const DATA_PATH = path.resolve(
  process.cwd(),
  "data",
  "inventory",
  "NJWeedWizard.current.json"
);

/**
 * Persist inventory + snapshot to disk
 */
export function persistInventory(normalizedRows) {
  const snapshot = buildInventorySnapshot(normalizedRows);

  const payload = {
    store: "NJWeedWizard",
    updated_at: new Date().toISOString(),
    inventory: normalizedRows,
    snapshot
  };

  fs.writeFileSync(DATA_PATH, JSON.stringify(payload, null, 2), "utf-8");

  return {
    stored: true,
    itemCount: normalizedRows.length,
    path: DATA_PATH
  };
}

