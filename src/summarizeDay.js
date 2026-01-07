export function summarizeDay({ proofs, actions }) {
  return {
    risks: proofs.filter(p => p.risk_level === "high").length,
    recommendations: actions.length,
    topActions: actions.slice(0, 3),
  };
}
