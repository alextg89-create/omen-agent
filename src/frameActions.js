export function frameActions(proofs = []) {
  const actions = [];

  for (const proof of proofs) {
    if (proof.claim_type === "stockout_risk") {
      actions.push({
        action: "REORDER",
        product_id: proof.product_id,
        urgency: "high",
        reason: proof.claim_summary
      });
    }

    if (proof.claim_type === "velocity_decline") {
      actions.push({
        action: "PROMOTE_OR_DISCOUNT",
        product_id: proof.product_id,
        urgency: "medium",
        reason: proof.claim_summary
      });
    }

    if (proof.claim_type === "velocity_growth") {
      actions.push({
        action: "INCREASE_REORDER_QTY",
        product_id: proof.product_id,
        urgency: "low",
        reason: proof.claim_summary
      });
    }
  }

  return actions;
}
