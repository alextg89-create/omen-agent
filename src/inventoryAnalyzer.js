import crypto from "crypto";

/**
 * Layer 3 – Inventory Analyzer
 * Input: normalized inventory items
 * Output: ProofObjects ONLY
 */
export function analyzeInventory(items = []) {
  const proofs = [];

  for (const item of items) {
    // ---- VELOCITY ANALYSIS ----
    const velocity7d = item.units_sold_7d / 7;
    const velocity30d = item.units_sold_30d / 30;

    if (velocity30d > 0) {
      const delta = (velocity7d - velocity30d) / velocity30d;

      if (Math.abs(delta) >= 0.25) {
        proofs.push({
          proof_id: crypto.randomUUID(),
          product_id: item.id,
          category: item.category || "unknown",
          claim_type: delta < 0 ? "velocity_decline" : "velocity_growth",
          claim_summary: `Velocity changed ${(delta * 100).toFixed(1)}%`,
          evidence: {
            velocity_7d: velocity7d,
            velocity_30d: velocity30d,
            delta
          },
          confidence_score: 0.7,
          confidence_level: "medium",
          risk_level: delta < 0 ? "medium" : "low",
          detected_at: new Date().toISOString(),
          valid_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        });
      }
    }

    // ---- STOCK RISK ANALYSIS ----
    if (item.current_stock && item.avg_daily_velocity) {
      const daysToStockout =
        item.current_stock / item.avg_daily_velocity;

      const riskWindow =
        (item.lead_time_days || 5) + (item.safety_buffer_days || 3);

      if (daysToStockout <= riskWindow) {
        proofs.push({
          proof_id: crypto.randomUUID(),
          product_id: item.id,
          category: item.category || "unknown",
          claim_type: "stockout_risk",
          claim_summary: `Stockout risk in ${daysToStockout.toFixed(1)} days`,
          evidence: {
            days_to_stockout: daysToStockout,
            risk_window: riskWindow
          },
          confidence_score: 0.8,
          confidence_level: "high",
          risk_level: "high",
          detected_at: new Date().toISOString(),
          valid_until: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
        });
      }
    }
  }

  return proofs;
}
