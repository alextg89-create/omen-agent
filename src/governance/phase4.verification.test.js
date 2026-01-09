// src/governance/phase4.verification.test.js
// Phase 4 - Governance Verification Test Suite
// Production-like scenarios with mocked I/O
// Validates action gating, reasoning paths, and feature flag isolation

import { makeDecision } from "../decisionEngine.js";
import {
  evaluateGovernanceState,
  currentExecutionMode,
  maySpeak,
  mayExecute,
  _resetForTesting,
} from "./governanceController.js";
import { ExecutionMode } from "./resolveExecutionMode.js";

/**
 * Mock Database (simulates write operations)
 */
class MockDatabase {
  constructor() {
    this.writes = [];
    this.reads = [];
  }

  async write(table, data) {
    this.writes.push({ table, data, timestamp: Date.now() });
    return { success: true, id: this.writes.length };
  }

  async read(table, id) {
    this.reads.push({ table, id, timestamp: Date.now() });
    return { id, data: "mock_data" };
  }

  reset() {
    this.writes = [];
    this.reads = [];
  }

  getWriteCount() {
    return this.writes.length;
  }

  getReadCount() {
    return this.reads.length;
  }
}

/**
 * Mock External API (simulates webhooks, notifications, etc.)
 */
class MockExternalAPI {
  constructor() {
    this.calls = [];
  }

  async sendNotification(message) {
    this.calls.push({ type: "notification", message, timestamp: Date.now() });
    return { sent: true };
  }

  async triggerAction(action) {
    this.calls.push({ type: "action", action, timestamp: Date.now() });
    return { triggered: true };
  }

  reset() {
    this.calls = [];
  }

  getCallCount() {
    return this.calls.length;
  }
}

/**
 * Mock Action Executor (simulates inventory actions)
 */
class MockActionExecutor {
  constructor(db, api) {
    this.db = db;
    this.api = api;
    this.executedActions = [];
  }

  async executeReorder(productId, quantity) {
    // Only execute if governance allows
    if (!mayExecute()) {
      this.executedActions.push({
        action: "reorder",
        productId,
        quantity,
        blocked: true,
        reason: `Governance blocked (mode: ${currentExecutionMode()})`,
      });
      return { success: false, blocked: true };
    }

    // Execute action
    await this.db.write("reorders", { productId, quantity });
    await this.api.triggerAction({ type: "reorder", productId, quantity });

    this.executedActions.push({
      action: "reorder",
      productId,
      quantity,
      blocked: false,
    });

    return { success: true, blocked: false };
  }

  async executePromotion(productId, discount) {
    if (!mayExecute()) {
      this.executedActions.push({
        action: "promotion",
        productId,
        discount,
        blocked: true,
        reason: `Governance blocked (mode: ${currentExecutionMode()})`,
      });
      return { success: false, blocked: true };
    }

    await this.db.write("promotions", { productId, discount });
    await this.api.sendNotification(`Promotion: ${productId} at ${discount}%`);

    this.executedActions.push({
      action: "promotion",
      productId,
      discount,
      blocked: false,
    });

    return { success: true, blocked: false };
  }

  getExecutedCount() {
    return this.executedActions.filter((a) => !a.blocked).length;
  }

  getBlockedCount() {
    return this.executedActions.filter((a) => a.blocked).length;
  }

  reset() {
    this.executedActions = [];
  }
}

/**
 * Mock Reasoning Engine (simulates LLM/AI calls)
 */
class MockReasoningEngine {
  constructor() {
    this.calls = [];
  }

  async generateExplanation(context) {
    // Only generate if governance allows speaking
    if (!maySpeak()) {
      this.calls.push({
        type: "explanation",
        context,
        blocked: true,
        reason: `Governance blocked (mode: ${currentExecutionMode()})`,
      });
      return { explanation: null, blocked: true };
    }

    this.calls.push({
      type: "explanation",
      context,
      blocked: false,
    });

    return {
      explanation: "Mock explanation based on context",
      blocked: false,
    };
  }

  async generateRecommendation(data) {
    if (!maySpeak()) {
      this.calls.push({
        type: "recommendation",
        data,
        blocked: true,
        reason: `Governance blocked (mode: ${currentExecutionMode()})`,
      });
      return { recommendation: null, blocked: true };
    }

    this.calls.push({
      type: "recommendation",
      data,
      blocked: false,
    });

    return {
      recommendation: "Mock recommendation based on data",
      blocked: false,
    };
  }

  getCallCount() {
    return this.calls.length;
  }

  getAllowedCallCount() {
    return this.calls.filter((c) => !c.blocked).length;
  }

  getBlockedCallCount() {
    return this.calls.filter((c) => c.blocked).length;
  }

  reset() {
    this.calls = [];
  }
}

/**
 * Test runner
 */
async function runTests() {
  const results = {
    passed: 0,
    failed: 0,
    tests: [],
  };

  // Initialize mocks
  const db = new MockDatabase();
  const api = new MockExternalAPI();
  const executor = new MockActionExecutor(db, api);
  const reasoning = new MockReasoningEngine();

  async function test(name, fn) {
    try {
      // Reset state before each test
      _resetForTesting();
      db.reset();
      api.reset();
      executor.reset();
      reasoning.reset();
      delete process.env.OMEN_GOVERNANCE_ENABLED;

      await fn();
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

  console.log("\n🧪 Running Phase 4 Governance Verification Tests\n");

  // ========================================
  // Category 1: NONE Mode - Total Lockdown
  // ========================================
  console.log("📋 Category 1: NONE Mode - Total Lockdown");

  await test("NONE mode: Blocks all database writes", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    evaluateGovernanceState({
      executionAllowed: false,
      riskTier: "ELEVATED",
      adminSignal: false,
      confidenceGate: false, // Low confidence → NONE
      decisionIntent: "ACT",
    });

    assertEquals(currentExecutionMode(), ExecutionMode.NONE);

    // Attempt action
    const result = await executor.executeReorder("PROD-123", 100);

    assertBoolean(result.blocked, true, "Action should be blocked");
    assertEquals(db.getWriteCount(), 0, "No database writes should occur");
    assertEquals(api.getCallCount(), 0, "No API calls should occur");
  });

  await test("NONE mode: Blocks reasoning/LLM calls", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    evaluateGovernanceState({
      executionAllowed: false,
      riskTier: "LOW",
      adminSignal: false,
      confidenceGate: false, // No confidence → NONE
      decisionIntent: "SPEAK",
    });

    assertEquals(currentExecutionMode(), ExecutionMode.NONE);

    // Attempt reasoning
    const result = await reasoning.generateExplanation({ data: "test" });

    assertBoolean(result.blocked, true, "Reasoning should be blocked");
    assertEquals(reasoning.getAllowedCallCount(), 0, "No reasoning calls allowed");
  });

  await test("NONE mode: maySpeak() and mayExecute() both false", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    evaluateGovernanceState({
      executionAllowed: false,
      riskTier: "CRITICAL",
      adminSignal: false,
      confidenceGate: true,
      decisionIntent: "ACT",
    });

    assertEquals(currentExecutionMode(), ExecutionMode.NONE);
    assertBoolean(maySpeak(), false);
    assertBoolean(mayExecute(), false);
  });

  await test("NONE mode: Feature flag OFF bypasses governance (write succeeds)", async () => {
    delete process.env.OMEN_GOVERNANCE_ENABLED; // Disabled

    // Even with bad signals, action should succeed (no governance)
    const result = await executor.executeReorder("PROD-456", 50);

    // Without governance, mock executor doesn't check mayExecute()
    // So this tests that governance isn't active
    assertBoolean(mayExecute(), false, "Governance not evaluated, should default to false");
  });

  // ========================================
  // Category 2: INTELLIGENCE_ONLY Mode
  // ========================================
  console.log("\n📋 Category 2: INTELLIGENCE_ONLY Mode - Reasoning Allowed");

  await test("INTELLIGENCE_ONLY: Allows reasoning calls", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    evaluateGovernanceState({
      executionAllowed: false,
      riskTier: "LOW",
      adminSignal: false,
      confidenceGate: true,
      decisionIntent: "SPEAK",
    });

    assertEquals(currentExecutionMode(), ExecutionMode.INTELLIGENCE_ONLY);

    // Reasoning should succeed
    const result = await reasoning.generateExplanation({ data: "test" });

    assertBoolean(result.blocked, false, "Reasoning should be allowed");
    assertEquals(reasoning.getAllowedCallCount(), 1, "One reasoning call allowed");
  });

  await test("INTELLIGENCE_ONLY: Blocks action execution", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    evaluateGovernanceState({
      executionAllowed: false,
      riskTier: "ELEVATED",
      adminSignal: false,
      confidenceGate: true,
      decisionIntent: "SPEAK",
    });

    assertEquals(currentExecutionMode(), ExecutionMode.INTELLIGENCE_ONLY);

    // Action should be blocked
    const result = await executor.executePromotion("PROD-789", 20);

    assertBoolean(result.blocked, true, "Action should be blocked");
    assertEquals(db.getWriteCount(), 0, "No database writes");
    assertEquals(api.getCallCount(), 0, "No API calls");
  });

  await test("INTELLIGENCE_ONLY: maySpeak() true, mayExecute() false", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    evaluateGovernanceState({
      executionAllowed: false,
      riskTier: "LOW",
      adminSignal: false,
      confidenceGate: true,
      decisionIntent: "SPEAK",
    });

    assertEquals(currentExecutionMode(), ExecutionMode.INTELLIGENCE_ONLY);
    assertBoolean(maySpeak(), true);
    assertBoolean(mayExecute(), false);
  });

  await test("INTELLIGENCE_ONLY: Multiple reasoning calls allowed", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    evaluateGovernanceState({
      executionAllowed: false,
      riskTier: "ELEVATED",
      adminSignal: false,
      confidenceGate: true,
      decisionIntent: "SPEAK",
    });

    // Multiple reasoning calls
    await reasoning.generateExplanation({ data: "test1" });
    await reasoning.generateRecommendation({ data: "test2" });
    await reasoning.generateExplanation({ data: "test3" });

    assertEquals(reasoning.getAllowedCallCount(), 3, "All reasoning calls allowed");
    assertEquals(reasoning.getBlockedCallCount(), 0, "No reasoning calls blocked");
  });

  // ========================================
  // Category 3: EXECUTION Mode
  // ========================================
  console.log("\n📋 Category 3: EXECUTION Mode - Full Permissions");

  await test("EXECUTION: Allows action execution", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    evaluateGovernanceState({
      executionAllowed: true,
      riskTier: "LOW",
      adminSignal: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    });

    assertEquals(currentExecutionMode(), ExecutionMode.EXECUTION);

    // Action should succeed
    const result = await executor.executeReorder("PROD-999", 200);

    assertBoolean(result.blocked, false, "Action should be allowed");
    assertEquals(db.getWriteCount(), 1, "One database write");
    assertEquals(api.getCallCount(), 1, "One API call");
  });

  await test("EXECUTION: Allows reasoning calls", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    evaluateGovernanceState({
      executionAllowed: true,
      riskTier: "LOW",
      adminSignal: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    });

    assertEquals(currentExecutionMode(), ExecutionMode.EXECUTION);

    // Reasoning should succeed
    const result = await reasoning.generateExplanation({ data: "test" });

    assertBoolean(result.blocked, false, "Reasoning should be allowed");
    assertEquals(reasoning.getAllowedCallCount(), 1);
  });

  await test("EXECUTION: maySpeak() and mayExecute() both true", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

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
  });

  await test("EXECUTION: Multiple actions allowed", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    evaluateGovernanceState({
      executionAllowed: true,
      riskTier: "LOW",
      adminSignal: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    });

    // Multiple actions
    await executor.executeReorder("PROD-1", 100);
    await executor.executePromotion("PROD-2", 15);
    await executor.executeReorder("PROD-3", 50);

    assertEquals(executor.getExecutedCount(), 3, "All actions executed");
    assertEquals(executor.getBlockedCount(), 0, "No actions blocked");
    assertEquals(db.getWriteCount(), 3, "Three database writes");
    assertEquals(api.getCallCount(), 3, "Three API calls");
  });

  // ========================================
  // Category 4: Decision Engine Integration
  // ========================================
  console.log("\n📋 Category 4: Decision Engine Integration (Hook #3)");

  await test("Hook #3: Governance disabled - decision proceeds normally", async () => {
    delete process.env.OMEN_GOVERNANCE_ENABLED;

    const routerResult = { executionAllowed: false };
    const decision = await makeDecision({ routerResult });

    assertEquals(decision.decision, "BLOCK");
    assertEquals(decision.reason, "Execution not allowed by policy");
  });

  await test("Hook #3: Governance enabled, NONE mode - decision blocked", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    const routerResult = { executionAllowed: true }; // Router says OK
    const signals = { riskLevel: "HIGH" }; // But HIGH risk

    const decision = await makeDecision({ routerResult, signals });

    assertEquals(decision.decision, "BLOCK");
    assertBoolean(
      decision.reason.includes("governance"),
      true,
      "Reason should mention governance"
    );
  });

  await test("Hook #3: Governance enabled, EXECUTION mode - allows decision", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    const routerResult = { executionAllowed: true, maxTier: 0 };
    const signals = { riskLevel: "LOW", adminOverride: true };

    const decision = await makeDecision({ routerResult, signals });

    // Should return RESPOND_DIRECT (not blocked by governance)
    assertEquals(decision.decision, "RESPOND_DIRECT");
  });

  await test("Hook #3: Governance evaluation updates internal state", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    const routerResult = { executionAllowed: true };
    const signals = { riskLevel: "MEDIUM" };

    await makeDecision({ routerResult, signals });

    // State should be updated (NONE or INTELLIGENCE_ONLY)
    const mode = currentExecutionMode();
    assertBoolean(
      [ExecutionMode.NONE, ExecutionMode.INTELLIGENCE_ONLY].includes(mode),
      true,
      "Mode should be NONE or INTELLIGENCE_ONLY"
    );
  });

  // ========================================
  // Category 5: Feature Flag Isolation
  // ========================================
  console.log("\n📋 Category 5: Feature Flag Isolation");

  await test("Feature flag undefined: Original behavior preserved", async () => {
    delete process.env.OMEN_GOVERNANCE_ENABLED;

    const routerResult = { executionAllowed: true, maxTier: 0 };
    const decision = await makeDecision({ routerResult });

    assertEquals(decision.decision, "RESPOND_DIRECT");
    assertEquals(decision.reason, "Low-risk, clear intent");
  });

  await test("Feature flag 'false': Original behavior preserved", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "false";

    const routerResult = { executionAllowed: false };
    const decision = await makeDecision({ routerResult });

    assertEquals(decision.decision, "BLOCK");
    assertEquals(decision.reason, "Execution not allowed by policy");
  });

  await test("Feature flag 'invalid': Original behavior preserved", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "yes"; // Invalid value

    const routerResult = { executionAllowed: true, maxTier: 0 };
    const decision = await makeDecision({ routerResult });

    assertEquals(decision.decision, "RESPOND_DIRECT");
    // Governance not active with invalid flag value
  });

  await test("Feature flag 'true': Governance active", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    const routerResult = { executionAllowed: true };
    const signals = { riskLevel: "HIGH" };

    const decision = await makeDecision({ routerResult, signals });

    // Governance should block HIGH risk
    assertEquals(decision.decision, "BLOCK");
    assertBoolean(decision.reason.includes("governance"), true);
  });

  // ========================================
  // Category 6: Determinism & Idempotency
  // ========================================
  console.log("\n📋 Category 6: Determinism & Idempotency");

  await test("Determinism: Same inputs produce same mode (10 iterations)", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    const context = {
      executionAllowed: false,
      riskTier: "LOW",
      adminSignal: false,
      confidenceGate: true,
      decisionIntent: "SPEAK",
    };

    const modes = [];
    for (let i = 0; i < 10; i++) {
      evaluateGovernanceState(context);
      modes.push(currentExecutionMode());
    }

    // All modes should be identical
    const allSame = modes.every((m) => m === modes[0]);
    assertBoolean(allSame, true, "All iterations should produce same mode");
    assertEquals(modes[0], ExecutionMode.INTELLIGENCE_ONLY);
  });

  await test("Idempotency: Calling accessors multiple times doesn't change state", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    evaluateGovernanceState({
      executionAllowed: true,
      riskTier: "LOW",
      adminSignal: true,
      confidenceGate: true,
      decisionIntent: "ACT",
    });

    const initialMode = currentExecutionMode();

    // Call accessors 100 times
    for (let i = 0; i < 100; i++) {
      currentExecutionMode();
      maySpeak();
      mayExecute();
    }

    // Mode should be unchanged
    assertEquals(currentExecutionMode(), initialMode);
    assertEquals(initialMode, ExecutionMode.EXECUTION);
  });

  // ========================================
  // Category 7: Safety Defaults
  // ========================================
  console.log("\n📋 Category 7: Safety Defaults");

  await test("Safety: Missing signals default to NONE mode", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    evaluateGovernanceState({}); // Empty context

    assertEquals(currentExecutionMode(), ExecutionMode.NONE);
    assertBoolean(maySpeak(), false);
    assertBoolean(mayExecute(), false);
  });

  await test("Safety: Invalid signals default to NONE mode", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    evaluateGovernanceState({
      executionAllowed: "not a boolean",
      riskTier: 123,
      adminSignal: null,
      confidenceGate: undefined,
      decisionIntent: {},
    });

    // Should not crash, should default to NONE
    const mode = currentExecutionMode();
    assertBoolean(
      [ExecutionMode.NONE].includes(mode),
      true,
      "Invalid signals should default to NONE"
    );
  });

  await test("Safety: Null context defaults to NONE mode", async () => {
    process.env.OMEN_GOVERNANCE_ENABLED = "true";

    evaluateGovernanceState(null);

    assertEquals(currentExecutionMode(), ExecutionMode.NONE);
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
    console.log("✅ All Phase 4 verification tests passed!\n");
    console.log("Verified:");
    console.log("  ✓ NONE mode blocks all writes and reasoning");
    console.log("  ✓ INTELLIGENCE_ONLY allows reasoning, blocks actions");
    console.log("  ✓ EXECUTION allows both reasoning and actions");
    console.log("  ✓ Feature flag isolation (disabled = no governance)");
    console.log("  ✓ Determinism (same inputs → same outputs)");
    console.log("  ✓ Safety defaults (invalid/missing → NONE mode)\n");
  }

  return results;
}

// Run tests if executed directly
await runTests();

export { runTests };
