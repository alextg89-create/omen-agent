// src/intelligenceRouter.js

function intelligenceRouter(input) {
  const allowedIntelligences = ["SELECTIVE"];
  let maxTier = 0;
  let executionAllowed = false;

  const {
    inputType,
    riskLevel,
    ambiguity,
    costSensitivity,
    userOverride,
  } = input;

  // Tier escalation
  if (inputType === "DATA" || ambiguity !== "CLEAR") {
    maxTier = 1;
  }

  if (userOverride === "FORCE_DEEP") {
    maxTier = 2;
  }

  // Temporal intelligence
  if (ambiguity === "CONFLICTING") {
    allowedIntelligences.push("TEMPORAL");
  }

  // Economic intelligence
  if (costSensitivity && costSensitivity !== "NORMAL") {
    allowedIntelligences.push("ECONOMIC");
  }

  // Execution intelligence
  if (inputType === "DATA" || inputType === "INSTRUCTION") {
    allowedIntelligences.push("EXECUTION");
    executionAllowed = true;
  }

  // 🔓 Admin / Intelligence-only override (non-executing)
if (
  signals?.admin_request === true ||
  process.env.OMEN_ALLOW_EXECUTION === "true"
) {
  allowedIntelligences.push("INTELLIGENCE");
  executionAllowed = true;
}
  // Governance override
  if (riskLevel === "HIGH") {
    allowedIntelligences.push("GOVERNANCE");
    executionAllowed = false;
  }

  return {
    allowedIntelligences: [...new Set(allowedIntelligences)],
    maxTier,
    executionAllowed,
  };
}

export { intelligenceRouter };
