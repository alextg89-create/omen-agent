export function detectLowStock(aggregates, threshold = 28) {
  return aggregates
    .filter(a => a.total_grams < threshold)
    .map(a => ({
      alert: "LOW_STOCK",
      strain: a.strain,
      quality: a.quality,
      total_grams: a.total_grams
    }));
}
