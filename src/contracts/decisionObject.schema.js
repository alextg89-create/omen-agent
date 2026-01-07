module.exports = {
  type: "object",
  required: [
    "decision_id",
    "product_id",
    "decision_type",
    "recommendation",
    "justification",
    "decision_confidence",
    "created_at"
  ],
  properties: {
    decision_id: { type: "string" },
    product_id: { type: "string" },
    decision_type: { type: "string" },
    recommendation: { type: "string" },
    justification: { type: "array" },
    risk_profile: { type: "string" },
    preconditions: { type: "array" },
    kill_conditions: { type: "array" },
    requires_human: { type: "boolean" },
    decision_confidence: { type: "number" },
    created_at: { type: "string" }
  }
};
