// src/decisionEngine.js

export function makeDecision({ routerResult, llmExplanation }) {
  // Hard block always wins
  if (!routerResult.executionAllowed) {
    return {
      decision: "BLOCK",
      confidence: 0.95,
      requiresHuman: true,
      reason: "Execution not allowed by policy",
    };
  }

  // Lowest tier, safe to respond directly
  if (routerResult.maxTier === 0) {
    return {
      decision: "RESPOND_DIRECT",
      confidence: 0.85,
      requiresHuman: false,
      reason: "Low-risk, clear intent",
    };
  }

  // Everything else needs clarification
  return {
    decision: "ASK_CLARIFYING_QUESTION",
    confidence: 0.7,
    requiresHuman: false,
    reason: "Ambiguity or elevated tier",
  };
}
