// src/decisionEngine.js

import { callLLM } from "./llm.js";

// TEMP: Contract disabled until finalized
// import { DecisionContract } from "./contracts/DecisionContract.js";

const DECISION_PROMPT = `
You are OMEN, an inventory intelligence system.

Interpret the provided signals and router output.
Resolve ambiguity by reasoning conservatively.
Provide recommendations, confidence, and escalation if required.
`

export async function makeDecision({
  routerResult,
  signals,
  anchors,
  priorDecisions = [],
}) {
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

  // Ambiguity = LLM arbitration
  const ambiguous = routerResult.maxTier > 0;

  if (ambiguous) {
    const llmResponse = await callLLM({
    prompt: DECISION_PROMPT,
    input: {
    signals,
    routerResult,
    anchors,
    priorDecisions,
  },
});


    return {
      ...llmResponse,
      reason: llmResponse.reason || "LLM-resolved ambiguity",
    };
  }

  // Fallback (should rarely hit)
  return {
    decision: "ASK_CLARIFYING_QUESTION",
    confidence: 0.6,
    requiresHuman: false,
    reason: "Unhandled decision state",
  };
}
