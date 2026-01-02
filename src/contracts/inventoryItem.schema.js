export const InventoryItemSchema = {
  sku: "string",
  name: "string",
  category: "string",

  onHand: "number",
  unitCost: "number",
  unitPrice: "number",

  avgDailySales: "number",
  lastSoldAt: "ISODate",
  lastRestockedAt: "ISODate",

  daysOnShelf: "number",
  vendor: "string",

  flags: {
    expired: "boolean",
    promo: "boolean",
    seasonal: "boolean",
  },
};
