// src/governance/resolveExecutionMode.test.js
// Unit tests for the governance resolver
// Non-destructive, isolated tests

import {
  resolveExecutionMode,
  ExecutionMode,
  RiskTier,
  DecisionIntent,
} from "./resolveExecutionMode.js";

/**
 * Simple test runner
 */
function runTests() {
  const results = {
    passed: 0,
    failed: 0,
    tests: [],
  };

  function test(name, fn) {
    try {
      fn();
      results.passed++;
      results.tests.push({ name, status: "PASS" });
      console.log(`✓ ${name}`);
    } catch (error) {
      results.failed++;
      results.tests.push({ name, status: "FAIL", error: error.message });
      console.error(`✗ ${name}`);
      console.error(`  Error: ${error.message}`);
    }
  }

  function assertEquals(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(
        message || `Expected ${expected}, got ${actual}`
      );
    }
  }

  console.log("\n🧪 Running Governance Resolver Tests\n");

  // ========================================
  // Step 1: Input Validation Tests
  // ========================================
  console.log("📋 Step 1: Input Validation Tests");

  test("Missing executionAllowed → NONE", () => {
    const result = resolveExecutionMode(
      undefined,
      RiskTier.LOW,
      false,
      true,
      DecisionIntent.SPEAK
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("Missing riskTier → NONE", () => {
    const result = resolveExecutionMode(
      false,
      undefined,
      false,
      true,
      DecisionIntent.SPEAK
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("Missing adminSignal → NONE", () => {
    const result = resolveExecutionMode(
      false,
      RiskTier.LOW,
      undefined,
      true,
      DecisionIntent.SPEAK
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("Missing confidenceGate → NONE", () => {
    const result = resolveExecutionMode(
      false,
      RiskTier.LOW,
      false,
      undefined,
      DecisionIntent.SPEAK
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("Missing decisionIntent → NONE", () => {
    const result = resolveExecutionMode(
      false,
      RiskTier.LOW,
      false,
      true,
      undefined
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("Invalid riskTier value → NONE", () => {
    const result = resolveExecutionMode(
      false,
      "INVALID",
      false,
      true,
      DecisionIntent.SPEAK
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("Invalid decisionIntent value → NONE", () => {
    const result = resolveExecutionMode(
      false,
      RiskTier.LOW,
      false,
      true,
      "INVALID"
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("Non-boolean executionAllowed → NONE", () => {
    const result = resolveExecutionMode(
      "true",
      RiskTier.LOW,
      false,
      true,
      DecisionIntent.SPEAK
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("Null values → NONE", () => {
    const result = resolveExecutionMode(
      null,
      null,
      null,
      null,
      null
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  // ========================================
  // Step 2: Blocking Conditions Tests
  // ========================================
  console.log("\n📋 Step 2: Blocking Conditions Tests");

  test("confidenceGate = false → NONE", () => {
    const result = resolveExecutionMode(
      true,
      RiskTier.LOW,
      true,
      false, // confidenceGate = false
      DecisionIntent.ACT
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("riskTier = CRITICAL → NONE", () => {
    const result = resolveExecutionMode(
      true,
      RiskTier.CRITICAL, // CRITICAL risk
      true,
      true,
      DecisionIntent.ACT
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("decisionIntent = NONE → NONE", () => {
    const result = resolveExecutionMode(
      true,
      RiskTier.LOW,
      true,
      true,
      DecisionIntent.NONE // No intent
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("CRITICAL risk overrides admin approval → NONE", () => {
    const result = resolveExecutionMode(
      true,
      RiskTier.CRITICAL,
      true, // Admin approved
      true,
      DecisionIntent.ACT
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("No confidence overrides all permissions → NONE", () => {
    const result = resolveExecutionMode(
      true,
      RiskTier.LOW,
      true, // Admin approved
      false, // No confidence
      DecisionIntent.ACT
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  // ========================================
  // Step 3: EXECUTION Mode Tests
  // ========================================
  console.log("\n📋 Step 3: EXECUTION Mode Tests");

  test("Admin + executionAllowed + LOW risk → EXECUTION", () => {
    const result = resolveExecutionMode(
      true,  // executionAllowed
      RiskTier.LOW,
      true,  // adminSignal
      true,  // confidenceGate
      DecisionIntent.ACT
    );
    assertEquals(result, ExecutionMode.EXECUTION);
  });

  test("Missing adminSignal prevents EXECUTION", () => {
    const result = resolveExecutionMode(
      true,
      RiskTier.LOW,
      false, // No admin approval
      true,
      DecisionIntent.ACT
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("Missing executionAllowed prevents EXECUTION", () => {
    const result = resolveExecutionMode(
      false, // Execution blocked
      RiskTier.LOW,
      true,
      true,
      DecisionIntent.ACT
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("ELEVATED risk prevents EXECUTION", () => {
    const result = resolveExecutionMode(
      true,
      RiskTier.ELEVATED, // Not LOW
      true,
      true,
      DecisionIntent.ACT
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("EXECUTION granted when all conditions met (any intent)", () => {
    const result = resolveExecutionMode(
      true,
      RiskTier.LOW,
      true,
      true,
      DecisionIntent.SPEAK // Intent doesn't matter for Step 3
    );
    // Step 3 checks: adminSignal=true AND executionAllowed=true AND riskTier=LOW
    // Intent is not checked in Step 3, so EXECUTION is granted
    assertEquals(result, ExecutionMode.EXECUTION);
  });

  // ========================================
  // Step 4: INTELLIGENCE_ONLY Mode Tests
  // ========================================
  console.log("\n📋 Step 4: INTELLIGENCE_ONLY Mode Tests");

  test("SPEAK + blocked + LOW risk + confident → INTELLIGENCE_ONLY", () => {
    const result = resolveExecutionMode(
      false, // Execution blocked
      RiskTier.LOW,
      false,
      true,  // Confident
      DecisionIntent.SPEAK
    );
    assertEquals(result, ExecutionMode.INTELLIGENCE_ONLY);
  });

  test("SPEAK + blocked + ELEVATED risk + confident → INTELLIGENCE_ONLY", () => {
    const result = resolveExecutionMode(
      false, // Execution blocked
      RiskTier.ELEVATED,
      false,
      true,  // Confident
      DecisionIntent.SPEAK
    );
    assertEquals(result, ExecutionMode.INTELLIGENCE_ONLY);
  });

  test("SPEAK + executionAllowed = true → Not INTELLIGENCE_ONLY", () => {
    const result = resolveExecutionMode(
      true,  // Execution allowed (not blocked)
      RiskTier.LOW,
      false,
      true,
      DecisionIntent.SPEAK
    );
    // Should be NONE because executionAllowed = true
    assertEquals(result, ExecutionMode.NONE);
  });

  test("ACT intent → Not INTELLIGENCE_ONLY", () => {
    const result = resolveExecutionMode(
      false,
      RiskTier.LOW,
      false,
      true,
      DecisionIntent.ACT // ACT, not SPEAK
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("CRITICAL risk → Not INTELLIGENCE_ONLY", () => {
    const result = resolveExecutionMode(
      false,
      RiskTier.CRITICAL, // Too high risk
      false,
      true,
      DecisionIntent.SPEAK
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  // ========================================
  // Step 5: Conservative Default Tests
  // ========================================
  console.log("\n📋 Step 5: Conservative Default Tests");

  test("ACT without admin approval → NONE", () => {
    const result = resolveExecutionMode(
      true,
      RiskTier.LOW,
      false, // No admin signal
      true,
      DecisionIntent.ACT
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("executionAllowed without admin → NONE", () => {
    const result = resolveExecutionMode(
      true,
      RiskTier.LOW,
      false,
      true,
      DecisionIntent.ACT
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("Valid inputs but no matching condition → NONE", () => {
    const result = resolveExecutionMode(
      true,
      RiskTier.ELEVATED,
      false,
      true,
      DecisionIntent.ACT
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  // ========================================
  // Determinism Tests
  // ========================================
  console.log("\n📋 Determinism Tests");

  test("Same inputs produce same output (test 1)", () => {
    const result1 = resolveExecutionMode(
      false,
      RiskTier.LOW,
      false,
      true,
      DecisionIntent.SPEAK
    );
    const result2 = resolveExecutionMode(
      false,
      RiskTier.LOW,
      false,
      true,
      DecisionIntent.SPEAK
    );
    assertEquals(result1, result2, "Results must be deterministic");
    assertEquals(result1, ExecutionMode.INTELLIGENCE_ONLY);
  });

  test("Same inputs produce same output (test 2)", () => {
    const result1 = resolveExecutionMode(
      true,
      RiskTier.LOW,
      true,
      true,
      DecisionIntent.ACT
    );
    const result2 = resolveExecutionMode(
      true,
      RiskTier.LOW,
      true,
      true,
      DecisionIntent.ACT
    );
    assertEquals(result1, result2, "Results must be deterministic");
    assertEquals(result1, ExecutionMode.EXECUTION);
  });

  test("Function is pure (no side effects)", () => {
    const inputs = [false, RiskTier.LOW, false, true, DecisionIntent.SPEAK];
    // Call multiple times
    const result1 = resolveExecutionMode(...inputs);
    const result2 = resolveExecutionMode(...inputs);
    const result3 = resolveExecutionMode(...inputs);
    // All should be identical
    assertEquals(result1, result2);
    assertEquals(result2, result3);
    assertEquals(result1, ExecutionMode.INTELLIGENCE_ONLY);
  });

  // ========================================
  // Edge Cases
  // ========================================
  console.log("\n📋 Edge Case Tests");

  test("All permissions granted but CRITICAL risk → NONE", () => {
    const result = resolveExecutionMode(
      true,
      RiskTier.CRITICAL,
      true,
      true,
      DecisionIntent.ACT
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("All signals optimal but no confidence → NONE", () => {
    const result = resolveExecutionMode(
      true,
      RiskTier.LOW,
      true,
      false, // No confidence
      DecisionIntent.ACT
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("Admin override doesn't bypass CRITICAL risk", () => {
    const result = resolveExecutionMode(
      true,
      RiskTier.CRITICAL,
      true, // Admin trying to override
      true,
      DecisionIntent.ACT
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("INTELLIGENCE_ONLY doesn't escalate to EXECUTION", () => {
    const result = resolveExecutionMode(
      false, // Blocked
      RiskTier.LOW,
      true,  // Admin signal present
      true,
      DecisionIntent.SPEAK
    );
    // Should stay INTELLIGENCE_ONLY, not escalate
    assertEquals(result, ExecutionMode.INTELLIGENCE_ONLY);
  });

  // ========================================
  // Comprehensive Scenario Tests
  // ========================================
  console.log("\n📋 Comprehensive Scenario Tests");

  test("Scenario: Safe execution with full approval", () => {
    const result = resolveExecutionMode(
      true,  // Router allows
      RiskTier.LOW,
      true,  // Admin approves
      true,  // System confident
      DecisionIntent.ACT
    );
    assertEquals(result, ExecutionMode.EXECUTION);
  });

  test("Scenario: Advisory mode for blocked low-risk", () => {
    const result = resolveExecutionMode(
      false, // Router blocks
      RiskTier.LOW,
      false, // No admin override
      true,  // System confident
      DecisionIntent.SPEAK
    );
    assertEquals(result, ExecutionMode.INTELLIGENCE_ONLY);
  });

  test("Scenario: Complete lockdown for CRITICAL", () => {
    const result = resolveExecutionMode(
      true,  // Even if allowed
      RiskTier.CRITICAL,
      true,  // Even with admin approval
      true,  // Even if confident
      DecisionIntent.ACT
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("Scenario: Uncertain system stays silent", () => {
    const result = resolveExecutionMode(
      true,
      RiskTier.LOW,
      true,
      false, // Not confident
      DecisionIntent.ACT
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  test("Scenario: Default production behavior (silent)", () => {
    const result = resolveExecutionMode(
      false, // Default: blocked
      RiskTier.ELEVATED,
      false, // Default: no admin
      true,
      DecisionIntent.NONE // Default: no intent
    );
    assertEquals(result, ExecutionMode.NONE);
  });

  // ========================================
  // Summary
  // ========================================
  console.log("\n" + "=".repeat(50));
  console.log("📊 Test Results Summary");
  console.log("=".repeat(50));
  console.log(`Total Tests: ${results.passed + results.failed}`);
  console.log(`✓ Passed: ${results.passed}`);
  console.log(`✗ Failed: ${results.failed}`);
  console.log("=".repeat(50) + "\n");

  if (results.failed > 0) {
    console.error("❌ Some tests failed. Review errors above.");
    process.exit(1);
  } else {
    console.log("✅ All tests passed! Resolver is working correctly.\n");
  }

  return results;
}

// Run tests if executed directly
runTests();

export { runTests };
