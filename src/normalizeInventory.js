export function normalizeInventory(rawItems = []) {
  return rawItems.map(item => {
    return {
      id: item.id || item.sku,
      name: item.name,
      category: item.category || "unknown",

      // sales velocity
      units_sold_7d:
        item.units_sold_7d ??
        Math.round((item.avgDailySales ?? 0) * 7),

      units_sold_30d:
        item.units_sold_30d ??
        Math.round((item.avgDailySales ?? 0) * 30),

      // stock
      current_stock:
        item.current_stock ?? item.onHand ?? 0,

      avg_daily_velocity:
        item.avg_daily_velocity ?? item.avgDailySales ?? 0,

      lead_time_days: item.lead_time_days ?? 5,
      safety_buffer_days: item.safety_buffer_days ?? 3,

      flags: item.flags ?? {}
    };
  });
}
