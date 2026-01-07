/**
 * Pricing Catalog
 * SOURCE OF TRUTH: Top section of Google Sheet
 * Lookup-only. No inventory logic.
 */

export const PRICING_CATALOG = [
  // STANDARD
  { quality: "STANDARD", unit: "eighth", cost: 7, retail: 18, sale: 30 },
  { quality: "STANDARD", unit: "quarter", cost: 13, retail: 33, sale: 50 },
  { quality: "STANDARD", unit: "half", cost: 25, retail: 63, sale: 95 },
  { quality: "STANDARD", unit: "oz", cost: 50, retail: 125, sale: 150 },

  // MID SHELF
  { quality: "MID SHELF", unit: "eighth", cost: 9, retail: 23, sale: 45 },
  { quality: "MID SHELF", unit: "quarter", cost: 17, retail: 43, sale: 80 },
  { quality: "MID SHELF", unit: "half", cost: 33, retail: 83, sale: 140 },
  { quality: "MID SHELF", unit: "oz", cost: 65, retail: 163, sale: 250 },

  // TOP SHELF
  { quality: "TOP SHELF", unit: "eighth", cost: 10, retail: 25, sale: 55 },
  { quality: "TOP SHELF", unit: "quarter", cost: 19, retail: 48, sale: 100 },
  { quality: "TOP SHELF", unit: "half", cost: 38, retail: 95, sale: 180 },
  { quality: "TOP SHELF", unit: "oz", cost: 75, retail: 188, sale: 325 },

  // EXOTIC / DESIGN
  { quality: "EXOTIC/DESIGN", unit: "eighth", cost: 12, retail: 30, sale: 65 },
  { quality: "EXOTIC/DESIGN", unit: "half", cost: 45, retail: 113, sale: 200 }
];
