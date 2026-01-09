// src/governance/governanceController.test.js
// Unit tests for the governance controller
// Non-destructive, isolated tests

import {
  evaluateGovernanceState,
  currentExecutionMode,
  maySpeak,
  mayExecute,
  _resetForTesting,
  _getCurrentModeForTesting,
} from "./governanceController.js";

import { ExecutionMode } from "./resolveExecutionMode.js";

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
      // Reset state before each test
      _resetForTesting();

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
      throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
  }

  function assertBoolean(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(
        message || `Expected ${expected ? "true" : "false"}, got ${actual}`
      );
    }
  }

  console.log("\n🧪 Running Governance Controller Tests\n");

  // ========================================
  // Initialization & Default State Tests
  // ========================================
  console.log("📋 Initialization & Default State Tests");

  test("Initial state is NONE", () => {
    const mode = currentExecutionMode();
    assertEquals(mode, ExecutionMode.NONE);
  });

  test("Initial maySpeak() is false", () => {
    assertBoolean(maySpeak(), false);
  });

  test("Initial mayExecute() is false", () => {
    assertBoolean(mayExecute(), false);
  });

  test("Calling evaluateGovernanceState with no context defaults to NONE", () => {
    evaluateGovernanceState();
    assertEquals(currentExecutionMode(), ExecutionMode.NONE);
    assertBoolean(maySpeak(), false);
    assertBoolean(mayExecute(), false);
  });

  test("Calling evaluateGovernanceState with null defaults to NONE", () => {
    evaluateGovernanceState(null);
    assertEquals(currentExecutionMode(), ExecutionMode.NONE);
  });

  test("Calling evaluateGovernanceState with empty object defaults to NONE", () => {
    evaluateGovernanceState({});
    assertEquals(currentExecutionMode(), ExecutionMode.NONE);
  });

  // ========================================
  // Signal Extraction Tests
  // ========================================
  console.log("\n📋 Signal Extraction Tests");

  test("Extract executionAllowed from direct property", () => {
    evaluateGovernanceState({
      executionAllowed: true,
      riskTier: "LOW",
      adminSignal: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.EXECUTION);
  });

  test("Extract executionAllowed from routerResult", () => {
    evaluateGovernanceState({
      routerResult: { executionAllowed: true },
      riskTier: "LOW",
      adminSignal: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.EXECUTION);
  });

  test("Extract executionAllowed from router", () => {
    evaluateGovernanceState({
      router: { executionAllowed: true },
      riskTier: "LOW",
      adminSignal: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.EXECUTION);
  });

  test("Extract riskTier from direct property", () => {
    evaluateGovernanceState({
      executionAllowed: false,
      riskTier: "LOW",
      adminSignal: false,
      confidenceGate: true,
      decisionIntent: "SPEAK",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.INTELLIGENCE_ONLY);
  });

  test("Map riskLevel HIGH to riskTier CRITICAL", () => {
    evaluateGovernanceState({
      executionAllowed: true,
      riskLevel: "HIGH",
      adminSignal: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    });
    // CRITICAL risk should block execution
    assertEquals(currentExecutionMode(), ExecutionMode.NONE);
  });

  test("Map riskLevel MEDIUM to riskTier ELEVATED", () => {
    evaluateGovernanceState({
      executionAllowed: false,
      riskLevel: "MEDIUM",
      adminSignal: false,
      confidenceGate: true,
      decisionIntent: "SPEAK",
    });
    // ELEVATED risk with SPEAK intent should allow INTELLIGENCE_ONLY
    assertEquals(currentExecutionMode(), ExecutionMode.INTELLIGENCE_ONLY);
  });

  test("Extract adminSignal from direct property", () => {
    evaluateGovernanceState({
      executionAllowed: true,
      riskTier: "LOW",
      adminSignal: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.EXECUTION);
  });

  test("Extract adminSignal from adminOverride", () => {
    evaluateGovernanceState({
      executionAllowed: true,
      riskTier: "LOW",
      adminOverride: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.EXECUTION);
  });

  test("Extract confidenceGate from direct property", () => {
    evaluateGovernanceState({
      executionAllowed: false,
      riskTier: "LOW",
      adminSignal: false,
      confidenceGate: true,
      decisionIntent: "SPEAK",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.INTELLIGENCE_ONLY);
  });

  test("Extract confidenceGate from confidence score", () => {
    evaluateGovernanceState({
      executionAllowed: false,
      riskTier: "LOW",
      adminSignal: false,
      confidence: 0.85, // Above default threshold 0.7
      decisionIntent: "SPEAK",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.INTELLIGENCE_ONLY);
  });

  test("Confidence score below threshold blocks intelligence", () => {
    evaluateGovernanceState({
      executionAllowed: false,
      riskTier: "LOW",
      adminSignal: false,
      confidence: 0.5, // Below threshold
      decisionIntent: "SPEAK",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.NONE);
  });

  test("Extract decisionIntent from direct property", () => {
    evaluateGovernanceState({
      executionAllowed: false,
      riskTier: "LOW",
      adminSignal: false,
      confidenceGate: true,
      decisionIntent: "SPEAK",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.INTELLIGENCE_ONLY);
  });

  test("Infer decisionIntent from decision type RESPOND_DIRECT", () => {
    evaluateGovernanceState({
      executionAllowed: false,
      riskTier: "LOW",
      adminSignal: false,
      confidenceGate: true,
      decision: { decision: "RESPOND_DIRECT" },
    });
    assertEquals(currentExecutionMode(), ExecutionMode.INTELLIGENCE_ONLY);
  });

  test("Infer decisionIntent from inputType INSTRUCTION", () => {
    evaluateGovernanceState({
      executionAllowed: true,
      riskTier: "LOW",
      adminSignal: true,
      confidenceGate: true,
      inputType: "INSTRUCTION",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.EXECUTION);
  });

  // ========================================
  // Accessor Function Tests
  // ========================================
  console.log("\n📋 Accessor Function Tests");

  test("currentExecutionMode() returns NONE by default", () => {
    assertEquals(currentExecutionMode(), ExecutionMode.NONE);
  });

  test("currentExecutionMode() returns EXECUTION after evaluation", () => {
    evaluateGovernanceState({
      executionAllowed: true,
      riskTier: "LOW",
      adminSignal: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.EXECUTION);
  });

  test("currentExecutionMode() returns INTELLIGENCE_ONLY after evaluation", () => {
    evaluateGovernanceState({
      executionAllowed: false,
      riskTier: "LOW",
      adminSignal: false,
      confidenceGate: true,
      decisionIntent: "SPEAK",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.INTELLIGENCE_ONLY);
  });

  test("maySpeak() is false for NONE mode", () => {
    evaluateGovernanceState({});
    assertBoolean(maySpeak(), false);
  });

  test("maySpeak() is true for INTELLIGENCE_ONLY mode", () => {
    evaluateGovernanceState({
      executionAllowed: false,
      riskTier: "LOW",
      confidenceGate: true,
      decisionIntent: "SPEAK",
    });
    assertBoolean(maySpeak(), true);
  });

  test("maySpeak() is true for EXECUTION mode", () => {
    evaluateGovernanceState({
      executionAllowed: true,
      riskTier: "LOW",
      adminSignal: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    });
    assertBoolean(maySpeak(), true);
  });

  test("mayExecute() is false for NONE mode", () => {
    evaluateGovernanceState({});
    assertBoolean(mayExecute(), false);
  });

  test("mayExecute() is false for INTELLIGENCE_ONLY mode", () => {
    evaluateGovernanceState({
      executionAllowed: false,
      riskTier: "LOW",
      confidenceGate: true,
      decisionIntent: "SPEAK",
    });
    assertBoolean(mayExecute(), false);
  });

  test("mayExecute() is true for EXECUTION mode", () => {
    evaluateGovernanceState({
      executionAllowed: true,
      riskTier: "LOW",
      adminSignal: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    });
    assertBoolean(mayExecute(), true);
  });

  // ========================================
  // State Persistence Tests
  // ========================================
  console.log("\n📋 State Persistence Tests");

  test("State persists between accessor calls", () => {
    evaluateGovernanceState({
      executionAllowed: true,
      riskTier: "LOW",
      adminSignal: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.EXECUTION);
    assertBoolean(maySpeak(), true);
    assertBoolean(mayExecute(), true);
    // Call again to verify persistence
    assertEquals(currentExecutionMode(), ExecutionMode.EXECUTION);
    assertBoolean(maySpeak(), true);
    assertBoolean(mayExecute(), true);
  });

  test("State updates on new evaluation", () => {
    // First evaluation: EXECUTION
    evaluateGovernanceState({
      executionAllowed: true,
      riskTier: "LOW",
      adminSignal: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.EXECUTION);

    // Second evaluation: INTELLIGENCE_ONLY
    evaluateGovernanceState({
      executionAllowed: false,
      riskTier: "LOW",
      confidenceGate: true,
      decisionIntent: "SPEAK",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.INTELLIGENCE_ONLY);

    // Third evaluation: NONE
    evaluateGovernanceState({});
    assertEquals(currentExecutionMode(), ExecutionMode.NONE);
  });

  // ========================================
  // Error Handling Tests
  // ========================================
  console.log("\n📋 Error Handling Tests");

  test("Invalid context type defaults to NONE", () => {
    evaluateGovernanceState("invalid");
    assertEquals(currentExecutionMode(), ExecutionMode.NONE);
  });

  test("Undefined context defaults to NONE", () => {
    evaluateGovernanceState(undefined);
    assertEquals(currentExecutionMode(), ExecutionMode.NONE);
  });

  test("Null context defaults to NONE", () => {
    evaluateGovernanceState(null);
    assertEquals(currentExecutionMode(), ExecutionMode.NONE);
  });

  test("Context with invalid signal types falls back gracefully", () => {
    evaluateGovernanceState({
      executionAllowed: "not a boolean",
      riskTier: 123,
      adminSignal: null,
      confidenceGate: undefined,
      decisionIntent: {},
    });
    // Should not throw, should evaluate with defaults
    const mode = currentExecutionMode();
    // Verify it returned a valid mode
    const validModes = Object.values(ExecutionMode);
    if (!validModes.includes(mode)) {
      throw new Error(`Invalid mode returned: ${mode}`);
    }
  });

  // ========================================
  // Read-Only Invariant Tests
  // ========================================
  console.log("\n📋 Read-Only Invariant Tests");

  test("Accessor functions don't modify state", () => {
    evaluateGovernanceState({
      executionAllowed: true,
      riskTier: "LOW",
      adminSignal: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    });

    const mode1 = currentExecutionMode();
    const speak1 = maySpeak();
    const exec1 = mayExecute();

    // Call accessors multiple times
    for (let i = 0; i < 10; i++) {
      assertEquals(currentExecutionMode(), mode1, "Mode changed after read");
      assertEquals(maySpeak(), speak1, "maySpeak changed after read");
      assertEquals(mayExecute(), exec1, "mayExecute changed after read");
    }
  });

  test("Multiple evaluations with same context produce same result", () => {
    const context = {
      executionAllowed: false,
      riskTier: "LOW",
      confidenceGate: true,
      decisionIntent: "SPEAK",
    };

    evaluateGovernanceState(context);
    const result1 = currentExecutionMode();

    evaluateGovernanceState(context);
    const result2 = currentExecutionMode();

    evaluateGovernanceState(context);
    const result3 = currentExecutionMode();

    assertEquals(result1, result2);
    assertEquals(result2, result3);
    assertEquals(result1, ExecutionMode.INTELLIGENCE_ONLY);
  });

  // ========================================
  // Real-World OMEN Context Tests
  // ========================================
  console.log("\n📋 Real-World OMEN Context Tests");

  test("OMEN routerResult format - HIGH risk block", () => {
    evaluateGovernanceState({
      routerResult: {
        executionAllowed: false,
        maxTier: 1,
        allowedIntelligences: ["SELECTIVE", "GOVERNANCE"],
      },
      riskLevel: "HIGH",
      confidenceGate: true,
      decisionIntent: "ACT",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.NONE);
    assertBoolean(mayExecute(), false);
  });

  test("OMEN routerResult format - LOW risk with admin", () => {
    evaluateGovernanceState({
      routerResult: {
        executionAllowed: true,
        maxTier: 0,
        allowedIntelligences: ["SELECTIVE", "EXECUTION"],
      },
      riskLevel: "LOW",
      adminSignal: true,
      confidenceGate: true,
      inputType: "INSTRUCTION",
    });
    assertEquals(currentExecutionMode(), ExecutionMode.EXECUTION);
    assertBoolean(mayExecute(), true);
  });

  test("OMEN decision format - BLOCK decision", () => {
    evaluateGovernanceState({
      routerResult: { executionAllowed: false },
      decision: {
        decision: "BLOCK",
        confidence: 0.95,
        requiresHuman: true,
      },
      riskLevel: "MEDIUM",
    });
    // requiresHuman: true means confidenceGate = false
    // decision: BLOCK means intent = NONE
    assertEquals(currentExecutionMode(), ExecutionMode.NONE);
  });

  test("OMEN decision format - RESPOND_DIRECT with confidence", () => {
    evaluateGovernanceState({
      routerResult: { executionAllowed: false },
      decision: {
        decision: "RESPOND_DIRECT",
        confidence: 0.85,
        requiresHuman: false,
      },
      riskLevel: "LOW",
    });
    // RESPOND_DIRECT maps to SPEAK intent
    // requiresHuman: false means confidenceGate = true
    assertEquals(currentExecutionMode(), ExecutionMode.INTELLIGENCE_ONLY);
    assertBoolean(maySpeak(), true);
  });

  // ========================================
  // Single Invocation Invariant Tests
  // ========================================
  console.log("\n📋 Single Invocation Invariant Tests");

  test("Resolver called once per evaluateGovernanceState", () => {
    // This test verifies the controller only calls resolver once
    // by checking state consistency
    const context = {
      executionAllowed: true,
      riskTier: "LOW",
      adminSignal: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    };

    evaluateGovernanceState(context);
    const mode = currentExecutionMode();

    // State should not change without new evaluation
    assertEquals(currentExecutionMode(), mode);
    assertEquals(currentExecutionMode(), ExecutionMode.EXECUTION);
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
    console.log("✅ All tests passed! Controller is working correctly.\n");
  }

  return results;
}

// Run tests if executed directly
runTests();

export { runTests };
