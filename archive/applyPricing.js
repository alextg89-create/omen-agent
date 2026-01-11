import { PRICING_CATALOG } from "./pricingCatalog.js";

/**
 * Attach pricing + margins to aggregated inventory
 */
export function applyPricing(aggregatedInventory = []) {
  return aggregatedInventory.map((item) => {
    const pricing = PRICING_CATALOG.find(
      (p) =>
        p.quality === item.quality &&
        item.units[p.unit] > 0
    );

    if (!pricing) {
      return {
        ...item,
        pricing_missing: true
      };
    }

    const margin =
      pricing.sale && pricing.cost
        ? pricing.sale - pricing.cost
        : null;

    return {
      ...item,
      pricing: {
        cost: pricing.cost,
        retail: pricing.retail,
        sale: pricing.sale,
        margin
      }
    };
  });
}
