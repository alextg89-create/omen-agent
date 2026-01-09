// src/governance/governanceController.js
// Phase 2 - Governance Controller
// Lightweight orchestrator that manages governance state per-request

import {
  resolveExecutionMode,
  ExecutionMode,
  RiskTier,
  DecisionIntent,
} from "./resolveExecutionMode.js";

/**
 * Internal state (per-request)
 * Initialized to safe default: NONE
 */
let currentMode = ExecutionMode.NONE;

/**
 * Signal extraction helpers
 * These safely extract governance signals from various context formats
 */

/**
 * Extracts executionAllowed from context
 * @param {Object} context - Request context
 * @returns {boolean} - Execution allowed flag
 */
function extractExecutionAllowed(context) {
  // Check direct property
  if (typeof context?.executionAllowed === "boolean") {
    return context.executionAllowed;
  }

  // Check nested in routerResult (common OMEN pattern)
  if (typeof context?.routerResult?.executionAllowed === "boolean") {
    return context.routerResult.executionAllowed;
  }

  // Check nested in router (alternative pattern)
  if (typeof context?.router?.executionAllowed === "boolean") {
    return context.router.executionAllowed;
  }

  // Conservative default: execution not allowed
  return false;
}

/**
 * Extracts riskTier from context
 * @param {Object} context - Request context
 * @returns {RiskTier} - Risk tier enum value
 */
function extractRiskTier(context) {
  // Check direct property
  const directRisk = context?.riskTier;
  if (Object.values(RiskTier).includes(directRisk)) {
    return directRisk;
  }

  // Check riskLevel and map to riskTier
  const riskLevel = context?.riskLevel || context?.routerResult?.riskLevel;
  if (riskLevel === "HIGH" || riskLevel === "CRITICAL") {
    return RiskTier.CRITICAL;
  }
  if (riskLevel === "MEDIUM" || riskLevel === "ELEVATED") {
    return RiskTier.ELEVATED;
  }
  if (riskLevel === "LOW") {
    return RiskTier.LOW;
  }

  // Conservative default: treat unknown as ELEVATED
  return RiskTier.ELEVATED;
}

/**
 * Extracts adminSignal from context
 * @param {Object} context - Request context
 * @returns {boolean} - Admin signal flag
 */
function extractAdminSignal(context) {
  // Check direct property
  if (typeof context?.adminSignal === "boolean") {
    return context.adminSignal;
  }

  // Check adminOverride or adminApproval
  if (typeof context?.adminOverride === "boolean") {
    return context.adminOverride;
  }
  if (typeof context?.adminApproval === "boolean") {
    return context.adminApproval;
  }

  // Check environment variable (if passed in context)
  if (context?.env?.OMEN_ADMIN_OVERRIDE === "true") {
    return true;
  }

  // Conservative default: no admin signal
  return false;
}

/**
 * Extracts confidenceGate from context
 * @param {Object} context - Request context
 * @returns {boolean} - Confidence gate flag
 */
function extractConfidenceGate(context) {
  // Check direct property
  if (typeof context?.confidenceGate === "boolean") {
    return context.confidenceGate;
  }

  // Check confidence score and threshold
  const confidence = context?.confidence || context?.decision?.confidence;
  if (typeof confidence === "number") {
    const threshold = context?.confidenceThreshold || 0.7;
    return confidence >= threshold;
  }

  // Check requiresHuman (inverse logic - if requires human, confidence is low)
  if (typeof context?.requiresHuman === "boolean") {
    return !context.requiresHuman;
  }

  // Conservative default: confidence gate not met
  return false;
}

/**
 * Extracts decisionIntent from context
 * @param {Object} context - Request context
 * @returns {DecisionIntent} - Decision intent enum value
 */
function extractDecisionIntent(context) {
  // Check direct property
  const directIntent = context?.decisionIntent || context?.intent;
  if (Object.values(DecisionIntent).includes(directIntent)) {
    return directIntent;
  }

  // Infer from decision type
  const decisionType = context?.decision?.decision || context?.decisionType;
  if (decisionType === "RESPOND_DIRECT" || decisionType === "ASK_CLARIFYING") {
    return DecisionIntent.SPEAK;
  }
  if (decisionType === "EXECUTE" || decisionType === "ACT") {
    return DecisionIntent.ACT;
  }
  if (decisionType === "BLOCK") {
    return DecisionIntent.NONE;
  }

  // Infer from inputType
  const inputType = context?.inputType || context?.input?.inputType;
  if (inputType === "INSTRUCTION" || inputType === "DATA") {
    return DecisionIntent.ACT;
  }
  if (inputType === "QUESTION" || inputType === "QUERY") {
    return DecisionIntent.SPEAK;
  }

  // Conservative default: no intent
  return DecisionIntent.NONE;
}

/**
 * PUBLIC API
 */

/**
 * Evaluates governance state for the current request
 * This is the ONLY function that modifies internal state
 *
 * @param {Object} context - Request context containing governance signals
 * @returns {void} - No return value, updates internal state only
 *
 * Usage:
 *   evaluateGovernanceState({ routerResult, decision, ... })
 *   // Internal state updated, use accessors to read
 */
export function evaluateGovernanceState(context) {
  // Safe guard: if no context provided, default to NONE
  if (!context || typeof context !== "object") {
    currentMode = ExecutionMode.NONE;
    return;
  }

  try {
    // Extract governance signals from context
    const executionAllowed = extractExecutionAllowed(context);
    const riskTier = extractRiskTier(context);
    const adminSignal = extractAdminSignal(context);
    const confidenceGate = extractConfidenceGate(context);
    const decisionIntent = extractDecisionIntent(context);

    // Invoke resolver (single source of truth)
    currentMode = resolveExecutionMode(
      executionAllowed,
      riskTier,
      adminSignal,
      confidenceGate,
      decisionIntent
    );
  } catch (error) {
    // Conservative fallback on any error
    console.error("[Governance] Error evaluating state:", error.message);
    currentMode = ExecutionMode.NONE;
  }
}

/**
 * Returns the current execution mode
 * Read-only accessor, no side effects
 *
 * @returns {ExecutionMode} - Current execution mode (NONE, INTELLIGENCE_ONLY, EXECUTION)
 *
 * Usage:
 *   const mode = currentExecutionMode();
 *   if (mode === ExecutionMode.EXECUTION) { ... }
 */
export function currentExecutionMode() {
  return currentMode;
}

/**
 * Checks if system may generate intelligence/speak
 * Returns true if INTELLIGENCE_ONLY or EXECUTION
 *
 * @returns {boolean} - True if speaking is allowed
 *
 * Usage:
 *   if (maySpeak()) {
 *     // Generate intelligence, recommendations, explanations
 *   }
 */
export function maySpeak() {
  return (
    currentMode === ExecutionMode.INTELLIGENCE_ONLY ||
    currentMode === ExecutionMode.EXECUTION
  );
}

/**
 * Checks if system may execute actions
 * Returns true ONLY if EXECUTION
 *
 * @returns {boolean} - True if execution is allowed
 *
 * Usage:
 *   if (mayExecute()) {
 *     // Perform side effects, state changes, actions
 *   }
 */
export function mayExecute() {
  return currentMode === ExecutionMode.EXECUTION;
}

/**
 * TESTING/DEBUG ONLY - Resets internal state to NONE
 * Used by tests to ensure clean state between test cases
 * NOT for production use
 *
 * @private
 */
export function _resetForTesting() {
  currentMode = ExecutionMode.NONE;
}

/**
 * TESTING/DEBUG ONLY - Gets current mode value for assertions
 * Alias for currentExecutionMode() for test clarity
 *
 * @private
 */
export function _getCurrentModeForTesting() {
  return currentMode;
}
