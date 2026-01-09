// src/governance/resolveExecutionMode.js
// Phase 1 - Isolated Governance Resolver
// Pure, deterministic function - no side effects, no I/O, no async

/**
 * Execution Mode Enum
 * Represents the governance decision for what OMEN may do
 */
const ExecutionMode = Object.freeze({
  NONE: "NONE",                     // No output, no actions (safest default)
  INTELLIGENCE_ONLY: "INTELLIGENCE_ONLY", // May generate intelligence but not execute
  EXECUTION: "EXECUTION",           // Full execution allowed
});

/**
 * Risk Tier Enum
 * Represents the risk assessment level
 */
const RiskTier = Object.freeze({
  LOW: "LOW",
  ELEVATED: "ELEVATED",
  CRITICAL: "CRITICAL",
});

/**
 * Decision Intent Enum
 * Represents the intended action category
 */
const DecisionIntent = Object.freeze({
  NONE: "NONE",
  SPEAK: "SPEAK",
  ACT: "ACT",
});

/**
 * Validates that all required inputs are present and of correct type
 * @param {Object} inputs - The governance inputs to validate
 * @returns {boolean} - True if all inputs are valid, false otherwise
 */
function validateInputs(inputs) {
  const {
    executionAllowed,
    riskTier,
    adminSignal,
    confidenceGate,
    decisionIntent,
  } = inputs;

  // Check all required fields are present
  if (
    executionAllowed === undefined ||
    executionAllowed === null ||
    riskTier === undefined ||
    riskTier === null ||
    adminSignal === undefined ||
    adminSignal === null ||
    confidenceGate === undefined ||
    confidenceGate === null ||
    decisionIntent === undefined ||
    decisionIntent === null
  ) {
    return false;
  }

  // Type validation
  if (typeof executionAllowed !== "boolean") return false;
  if (typeof adminSignal !== "boolean") return false;
  if (typeof confidenceGate !== "boolean") return false;

  // Enum validation
  if (!Object.values(RiskTier).includes(riskTier)) return false;
  if (!Object.values(DecisionIntent).includes(decisionIntent)) return false;

  return true;
}

/**
 * Pure governance resolver function
 * Determines execution mode based on governance signals
 *
 * @param {boolean} executionAllowed - Base execution permission from router
 * @param {RiskTier} riskTier - Risk assessment level (LOW, ELEVATED, CRITICAL)
 * @param {boolean} adminSignal - Explicit admin override/approval
 * @param {boolean} confidenceGate - Whether confidence threshold is met
 * @param {DecisionIntent} decisionIntent - Intent category (NONE, SPEAK, ACT)
 * @returns {ExecutionMode} - The resolved execution mode
 *
 * Decision Tree:
 * 1. Invalid/missing inputs → NONE
 * 2. Unsafe conditions (!confidenceGate OR CRITICAL risk OR NONE intent) → NONE
 * 3. Admin-approved low-risk execution → EXECUTION
 * 4. Intelligence-only conditions (SPEAK intent, blocked, low/elevated risk, confident) → INTELLIGENCE_ONLY
 * 5. All other cases → NONE (conservative default)
 */
function resolveExecutionMode(
  executionAllowed,
  riskTier,
  adminSignal,
  confidenceGate,
  decisionIntent
) {
  // Step 1: Validate inputs - any missing, invalid, or inconsistent signals → NONE
  if (
    !validateInputs({
      executionAllowed,
      riskTier,
      adminSignal,
      confidenceGate,
      decisionIntent,
    })
  ) {
    return ExecutionMode.NONE;
  }

  // Step 2: Check blocking conditions
  // If confidence gate not met → NONE (unsafe to proceed)
  if (!confidenceGate) {
    return ExecutionMode.NONE;
  }

  // If risk is CRITICAL → NONE (too dangerous)
  if (riskTier === RiskTier.CRITICAL) {
    return ExecutionMode.NONE;
  }

  // If decision intent is NONE → NONE (no clear purpose)
  if (decisionIntent === DecisionIntent.NONE) {
    return ExecutionMode.NONE;
  }

  // Step 3: Check for admin-approved execution
  // All three conditions must be true:
  // - Admin explicitly approved (adminSignal = true)
  // - Base execution permission granted (executionAllowed = true)
  // - Risk is LOW (not ELEVATED or CRITICAL)
  if (
    adminSignal === true &&
    executionAllowed === true &&
    riskTier === RiskTier.LOW
  ) {
    return ExecutionMode.EXECUTION;
  }

  // Step 4: Check for intelligence-only mode
  // All conditions must be true:
  // - Intent is to SPEAK (generate intelligence/recommendation)
  // - Base execution is blocked (executionAllowed = false)
  // - Risk is LOW or ELEVATED (not CRITICAL - already handled above)
  // - Confidence gate is met (already validated above)
  if (
    decisionIntent === DecisionIntent.SPEAK &&
    executionAllowed === false &&
    (riskTier === RiskTier.LOW || riskTier === RiskTier.ELEVATED) &&
    confidenceGate === true
  ) {
    return ExecutionMode.INTELLIGENCE_ONLY;
  }

  // Step 5: Conservative default - all other cases return NONE
  // This includes:
  // - decisionIntent = ACT without admin approval
  // - executionAllowed = true but adminSignal = false
  // - Any combination not explicitly allowed above
  return ExecutionMode.NONE;
}

// Exports
export { resolveExecutionMode, ExecutionMode, RiskTier, DecisionIntent };
