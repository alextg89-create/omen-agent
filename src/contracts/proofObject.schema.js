module.exports = {
  type: "object",
  required: [
    "proof_id",
    "product_id",
    "claim_type",
    "claim_summary",
    "evidence",
    "confidence_score",
    "risk_level",
    "detected_at",
    "valid_until"
  ],
  properties: {
    proof_id: { type: "string" },
    product_id: { type: "string" },
    category: { type: "string" },
    claim_type: { type: "string" },
    claim_summary: { type: "string" },
    evidence: { type: "object" },
    confidence_score: { type: "number" },
    confidence_level: { type: "string" },
    risk_level: { type: "string" },
    detected_at: { type: "string" },
    valid_until: { type: "string" }
  }
};
