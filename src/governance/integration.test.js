// src/governance/integration.test.js
// Integration tests for Phase 3 hooks
// Tests governance integration with OMEN decision flow

import { makeDecision } from "../decisionEngine.js";
import {
  evaluateGovernanceState,
  currentExecutionMode,
  mayExecute,
  maySpeak,
  _resetForTesting,
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
      // Clear environment variable
      delete process.env.OMEN_GOVERNANCE_ENABLED;

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

  console.log("\n🧪 Running Governance Integration Tests (Phase 3)\n");

  // ========================================
  // Feature Flag Tests (Governance DISABLED)
  // ========================================
  console.log("📋 Feature Flag Tests - Governance DISABLED");

  test("Governance disabled: makeDecision respects original logic", async () => {
    // Governance flag OFF (default)
    process.env.OMEN_GOVERNANCE_ENABLED = "false";

    const routerResult = { executionAllowed: false };
    const decision = await makeDecision({ routerResult });

    // Should return BLOCK (original behavior)
    assertEquals(decision.decision, "BLOCK");
    assertEquals(decision.reason, "Execution not allowed by policy");
  });

  test("Governance disabled: Hard block always wins", async () => {
    delete process.env.OMEN_GOVERNANCE_ENABLED; // Undefined = disabled

    const routerResult = { executionAllowed: false };
    const decision = await makeDecision({ routerResult });

    assertEquals(decision.decision, "BLOCK");
    assertEquals(decision.requiresHuman, true);
  });

  test("Governance disabled: Low tier responds directly", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "false";

    const routerResult = { executionAllowed: true, maxTier: 0 };
    const decision = await makeDecision({ routerResult });

    assertEquals(decision.decision, "RESPOND_DIRECT");
    assertEquals(decision.requiresHuman, false);
  });

  // ========================================
  // Feature Flag Tests (Governance ENABLED)
  // ========================================
  console.log("\n📋 Feature Flag Tests - Governance ENABLED");

  test("Governance enabled: NONE mode blocks execution", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    const routerResult = { executionAllowed: true };
    const signals = { riskLevel: "HIGH" }; // CRITICAL risk → NONE mode

    const decision = await makeDecision({ routerResult, signals });

    // Governance should block even though routerResult.executionAllowed = true
    assertEquals(decision.decision, "BLOCK");
    assertEquals(
      decision.reason.includes("governance"),
      true,
      "Reason should mention governance"
    );
  });

  test("Governance enabled: EXECUTION mode allows execution", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    const routerResult = { executionAllowed: true, maxTier: 0 };
    const signals = { riskLevel: "LOW", adminOverride: true };

    // Manually evaluate governance to set up EXECUTION mode
    evaluateGovernanceState({
      routerResult,
      riskLevel: "LOW",
      adminSignal: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    });

    // Should allow execution
    assertBoolean(mayExecute(), true);
    assertEquals(currentExecutionMode(), ExecutionMode.EXECUTION);
  });

  test("Governance enabled: Governance block overrides routerResult", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    const routerResult = { executionAllowed: true }; // Router says OK
    const signals = { riskLevel: "HIGH" }; // But HIGH risk

    const decision = await makeDecision({ routerResult, signals });

    // Governance should block
    assertEquals(decision.decision, "BLOCK");
    assertEquals(decision.requiresHuman, true);
  });

  // ========================================
  // Hook #3: Decision Engine Integration
  // ========================================
  console.log("\n📋 Hook #3: Decision Engine Execution Guard");

  test("Hook #3: Evaluates governance state before decision", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    const routerResult = { executionAllowed: true };
    const signals = { riskLevel: "LOW", adminOverride: true };

    await makeDecision({ routerResult, signals });

    // Governance state should be evaluated
    const mode = currentExecutionMode();
    assertEquals(
      [ExecutionMode.NONE, ExecutionMode.EXECUTION].includes(mode),
      true,
      "Mode should be NONE or EXECUTION"
    );
  });

  test("Hook #3: Blocks when mayExecute() returns false", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    const routerResult = { executionAllowed: true };
    const signals = { riskLevel: "MEDIUM" }; // ELEVATED risk, no admin

    const decision = await makeDecision({ routerResult, signals });

    // Should block (no admin approval for ELEVATED risk)
    assertEquals(decision.decision, "BLOCK");
  });

  test("Hook #3: Allows when mayExecute() returns true", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    const routerResult = { executionAllowed: true, maxTier: 0 };
    const signals = { riskLevel: "LOW", adminOverride: true };

    const decision = await makeDecision({ routerResult, signals });

    // Should NOT block (LOW risk + admin + executionAllowed)
    // Will return RESPOND_DIRECT (maxTier: 0 logic)
    assertEquals(decision.decision, "RESPOND_DIRECT");
  });

  // ========================================
  // Backward Compatibility Tests
  // ========================================
  console.log("\n📋 Backward Compatibility Tests");

  test("Backward compat: Disabled governance = original behavior (block)", async () => {
    delete process.env.OMEN_GOVERNANCE_ENABLED;

    const routerResult = { executionAllowed: false };
    const decision = await makeDecision({ routerResult });

    assertEquals(decision.decision, "BLOCK");
    assertEquals(decision.reason, "Execution not allowed by policy");
  });

  test("Backward compat: Disabled governance = original behavior (respond)", async () => {
    delete process.env.OMEN_GOVERNANCE_ENABLED;

    const routerResult = { executionAllowed: true, maxTier: 0 };
    const decision = await makeDecision({ routerResult });

    assertEquals(decision.decision, "RESPOND_DIRECT");
    assertEquals(decision.reason, "Low-risk, clear intent");
  });

  test("Backward compat: Missing signals don't crash when disabled", async () => {
    delete process.env.OMEN_GOVERNANCE_ENABLED;

    const routerResult = { executionAllowed: true, maxTier: 0 };
    const signals = undefined; // Missing signals

    const decision = await makeDecision({ routerResult, signals });

    // Should still work (governance not invoked)
    assertEquals(decision.decision, "RESPOND_DIRECT");
  });

  // ========================================
  // Error Handling Tests
  // ========================================
  console.log("\n📋 Error Handling Tests");

  test("Error handling: Invalid signals default to NONE mode", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    const routerResult = { executionAllowed: true };
    const signals = { riskLevel: "INVALID_VALUE" };

    const decision = await makeDecision({ routerResult, signals });

    // Should block (invalid signals → NONE mode)
    assertEquals(decision.decision, "BLOCK");
  });

  test("Error handling: Missing signals default to safe behavior", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    const routerResult = { executionAllowed: true };
    const signals = {}; // Empty signals

    const decision = await makeDecision({ routerResult, signals });

    // Should block (missing signals → ELEVATED risk → NONE mode)
    assertEquals(decision.decision, "BLOCK");
  });

  // ========================================
  // Real-World Scenario Tests
  // ========================================
  console.log("\n📋 Real-World Scenario Tests");

  test("Scenario: Production default (governance disabled)", async () => {
    delete process.env.OMEN_GOVERNANCE_ENABLED;

    const routerResult = { executionAllowed: false };
    const decision = await makeDecision({ routerResult });

    assertEquals(decision.decision, "BLOCK");
    assertEquals(decision.requiresHuman, true);
  });

  test("Scenario: HIGH risk blocked by governance", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    const routerResult = { executionAllowed: true };
    const signals = { riskLevel: "HIGH" };

    const decision = await makeDecision({ routerResult, signals });

    assertEquals(decision.decision, "BLOCK");
    assertEquals(
      decision.reason.includes("governance"),
      true,
      "Should mention governance in reason"
    );
  });

  test("Scenario: LOW risk with admin approval allows execution", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    const routerResult = { executionAllowed: true, maxTier: 0 };
    const signals = { riskLevel: "LOW", adminOverride: true };

    const decision = await makeDecision({ routerResult, signals });

    // Should allow (will return RESPOND_DIRECT for maxTier: 0)
    assertEquals(decision.decision, "RESPOND_DIRECT");
  });

  test("Scenario: MEDIUM risk without admin blocks", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    const routerResult = { executionAllowed: true };
    const signals = { riskLevel: "MEDIUM", adminOverride: false };

    const decision = await makeDecision({ routerResult, signals });

    assertEquals(decision.decision, "BLOCK");
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
    console.log("✅ All integration tests passed!\n");
  }

  return results;
}

// Run tests if executed directly
runTests();

export { runTests };
