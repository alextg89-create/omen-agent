import fs from "fs";
import path from "path";

/**
 * Pricing catalog
 */
const PRICING_PATH = path.resolve("src/data/pricing.json");
const pricing = JSON.parse(fs.readFileSync(PRICING_PATH, "utf8"));

/**
 * Normalization helpers
 */
const norm = (v = "") => String(v).trim().toUpperCase();

const unitMap = {
  OZ: "oz",
  "28 G": "oz",

  HALF: "half",
  "14 G": "half",

  QUARTER: "quarter",
  "7 G": "quarter",

  EIGHTH: "eighth",
  EIGHT: "eighth",        // <-- important for your data
  "3.5 G": "eighth",
};

const gramsMap = {
  oz: 28,
  half: 14,
  quarter: 7,
  eighth: 3.5,
};

const toNum = (s) =>
  typeof s === "number"
    ? s
    : Number(String(s).replace(/[^0-9.]/g, "")) || null;

/**
 * Build lookup table: QUALITY|UNIT → pricing
 */
const priceIndex = new Map(
  pricing.map((p) => {
    const quality = norm(p["Quality"]);
    const unitRaw = norm(p["Weight (g)"]);
    const unit =
      unitMap[unitRaw] ||
      unitMap[norm(p["Unit"])] ||
      null;

    return [
      `${quality}|${unit}`,
      {
        cost: toNum(p["Cost"]),
        retail: toNum(p["Retail Price"]),
        sale: toNum(p["Sale Price"]),
      },
    ];
  })
);

/**
 * Apply pricing to normalized inventory items
 */
export function applyPricing(items = []) {
  return items.map((item) => {
    const quality = norm(item.quality);
    const unit =
      unitMap[norm(item.unit)] ||
      String(item.unit).toLowerCase();

    const grams = gramsMap[unit] ?? null;
    const key = `${quality}|${unit}`;
    const price = priceIndex.get(key);

    if (!price) {
      return {
        ...item,
        unit,
        grams,
        pricing: null,
        pricingMatch: false,
      };
    }

    const margin =
      price.retail != null && price.cost != null
        ? Number((price.retail - price.cost).toFixed(2))
        : null;

    return {
      ...item,
      unit,
      grams,
      pricing: { ...price, margin },
      pricingMatch: true,
    };
  });
}

/**
 * Default export (required by server.js)
 */
export default applyPricing;
