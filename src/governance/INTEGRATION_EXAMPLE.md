# Governance Integration Example (Phase 3 Preview)

**Status**: ⏸️ NOT YET IMPLEMENTED - For Planning Only
**Phase**: 3 (Integration Hooks) - Awaiting Approval

---

## Overview

This document shows **how** governance would be integrated into OMEN in Phase 3, once approved. **NO CODE HAS BEEN MODIFIED YET**.

---

## Integration Pattern

### Step 1: Import Governance Controller
```javascript
// At top of file
import {
  evaluateGovernanceState,
  maySpeak,
  mayExecute,
} from './governance/governanceController.js';
```

---

## Hook Point 1: Decision Engine Block Handler

**File**: `src/decisionEngine.js`
**Lines**: 23-30
**Purpose**: Evaluate governance when execution is blocked

### Current Code
```javascript
if (!routerResult.executionAllowed) {
  return {
    decision: "BLOCK",
    confidence: 0.95,
    requiresHuman: true,
    reason: "Execution not allowed by policy",
  };
}
```

### Proposed Integration (ONE LINE ADDED)
```javascript
if (!routerResult.executionAllowed) {
  // 🎯 NEW: Evaluate governance state
  evaluateGovernanceState({ routerResult, riskLevel, adminSignal, confidenceGate, decisionIntent });

  return {
    decision: "BLOCK",
    confidence: 0.95,
    requiresHuman: true,
    reason: "Execution not allowed by policy",
  };
}
```

**Impact**:
- ✅ Governance state evaluated when execution blocked
- ✅ Existing return unchanged
- ✅ If governance disabled/fails → silent (existing behavior)

---

## Hook Point 2: Intelligence Router HIGH Risk Detection

**File**: `src/intelligenceRouter.js`
**Lines**: 42-44
**Purpose**: Allow governance to assess and potentially override blocks

### Current Code
```javascript
if (riskLevel === "HIGH") {
  allowedIntelligences.push("GOVERNANCE");
  executionAllowed = false;
}
```

### Proposed Integration (TWO LINES ADDED)
```javascript
if (riskLevel === "HIGH") {
  allowedIntelligences.push("GOVERNANCE");

  // 🎯 NEW: Evaluate governance state
  evaluateGovernanceState({
    executionAllowed: false,
    riskLevel,
    adminSignal: input.adminOverride || false,
    confidenceGate: input.confidence >= 0.7,
    decisionIntent: input.intent || "NONE"
  });

  // 🎯 NEW: Allow governance to override if admin-approved
  executionAllowed = mayExecute();  // Governance may allow execution
}
```

**Impact**:
- ✅ Governance can override HIGH risk block with admin approval
- ✅ Defaults to `false` if governance disabled
- ✅ Backward compatible - same behavior unless governance enabled

---

## Hook Point 3: Server Route Handler (Audit Trail)

**File**: `src/server.js`
**Lines**: 109-119
**Purpose**: Log governance decisions for audit trail

### Current Code
```javascript
const decision = await makeDecision({
  routerResult: result,
  llmExplanation: llmResponse,
});

console.log("🟢 [OMEN] Final decision", { requestId, timestamp, decision });
```

### Proposed Integration (TWO LINES ADDED)
```javascript
const decision = await makeDecision({
  routerResult: result,
  llmExplanation: llmResponse,
});

// 🎯 NEW: Evaluate final governance state
evaluateGovernanceState({ routerResult: result, decision, riskLevel: req.body.riskLevel });

console.log("🟢 [OMEN] Final decision", {
  requestId,
  timestamp,
  decision,
  governanceMode: currentExecutionMode(),  // 🎯 NEW: Include mode in log
});
```

**Impact**:
- ✅ Governance mode logged for observability
- ✅ No change to decision logic
- ✅ Audit trail enhancement

---

## Feature Flag Implementation

### Environment Variable
```bash
# .env or environment
OMEN_GOVERNANCE_ENABLED=false  # Default: OFF
```

### Feature Flag Check (Added to each hook)
```javascript
// At start of each integration point
if (process.env.OMEN_GOVERNANCE_ENABLED !== 'true') {
  // Skip governance evaluation, use existing logic
  return;
}

// Governance enabled, proceed with evaluation
evaluateGovernanceState({ ... });
```

---

## Migration Strategy

### Phase 3A: Add Hooks (No Behavior Change)
1. Add `evaluateGovernanceState()` calls at hook points
2. Add `currentExecutionMode()` to logs
3. Feature flag OFF by default
4. Verify existing tests still pass
5. **No behavior changes** - governance evaluated but not enforced

### Phase 3B: Enable Read-Only Mode (Observation)
1. Governance enabled but only logs decisions
2. Doesn't override execution flags
3. Collect data on governance vs actual decisions
4. Identify discrepancies

### Phase 3C: Enable Enforcement (Gradual Rollout)
1. Add `mayExecute()` checks before actions
2. Start with LOW risk only
3. Monitor for false positives
4. Gradually expand to ELEVATED risk
5. CRITICAL risk always requires human approval

---

## Example Integrated Flow

```javascript
// src/server.js (conceptual)
app.post("/route", async (req, res) => {
  const requestId = generateId();

  // Step 1: Router decision
  const routerResult = intelligenceRouter(req.body);

  // Step 2: Safety enforcement (existing)
  if (routerResult.maxTier > OMEN_MAX_TIER) {
    routerResult.maxTier = OMEN_MAX_TIER;
    routerResult.executionAllowed = false;
  }

  // 🎯 GOVERNANCE HOOK #1: Evaluate state after router
  if (process.env.OMEN_GOVERNANCE_ENABLED === 'true') {
    evaluateGovernanceState({
      routerResult,
      riskLevel: req.body.riskLevel,
      adminSignal: req.headers['x-admin-override'] === 'true',
      confidenceGate: true, // Initial confidence
      decisionIntent: req.body.inputType === 'INSTRUCTION' ? 'ACT' : 'SPEAK',
    });
  }

  // Step 3: LLM explanation (if allowed)
  let llmResponse = null;

  // 🎯 GOVERNANCE CHECK: Use maySpeak() instead of executionAllowed
  const canSpeak = process.env.OMEN_GOVERNANCE_ENABLED === 'true'
    ? maySpeak()
    : routerResult.executionAllowed;

  if (canSpeak) {
    llmResponse = await callLLM({ ... });
  }

  // Step 4: Final decision
  const decision = await makeDecision({
    routerResult,
    llmExplanation: llmResponse,
  });

  // 🎯 GOVERNANCE HOOK #2: Re-evaluate with decision context
  if (process.env.OMEN_GOVERNANCE_ENABLED === 'true') {
    evaluateGovernanceState({
      routerResult,
      decision,
      riskLevel: req.body.riskLevel,
      adminSignal: req.headers['x-admin-override'] === 'true',
      confidenceGate: decision.confidence >= 0.7,
      decisionIntent: decision.decision === 'RESPOND_DIRECT' ? 'SPEAK' : 'ACT',
    });
  }

  // Step 5: Log decision with governance mode
  console.log("🟢 [OMEN] Final decision", {
    requestId,
    timestamp: new Date().toISOString(),
    decision,
    governanceMode: process.env.OMEN_GOVERNANCE_ENABLED === 'true'
      ? currentExecutionMode()
      : 'DISABLED',
  });

  // Step 6: Response
  res.json({
    ok: true,
    requestId,
    router: routerResult,
    decision,
    explanation: llmResponse,
    governanceMode: process.env.OMEN_GOVERNANCE_ENABLED === 'true'
      ? currentExecutionMode()
      : undefined,
  });
});
```

---

## Backward Compatibility Matrix

| Scenario | Governance Disabled | Governance Enabled (NONE) | Governance Enabled (EXECUTION) |
|----------|-------------------|--------------------------|-------------------------------|
| HIGH risk input | executionAllowed=false → Block | Same + logged mode | Same (CRITICAL blocks all) |
| LOW risk + admin | executionAllowed=true → Allow | Same + logged mode | Same (EXECUTION granted) |
| Missing admin | executionAllowed=false → Block | Same + logged mode | Same (no admin = NONE) |
| Confidence low | Current logic → Block | Same + logged mode | Same (no confidence = NONE) |

**Result**: Governance adds observability first, enforcement second, always backward compatible.

---

## Testing Strategy for Phase 3

### Unit Tests
- ✅ Test hooks don't break existing tests
- ✅ Test feature flag ON/OFF behavior
- ✅ Test governance evaluation with real OMEN contexts

### Integration Tests
- ✅ Test full request flow with governance
- ✅ Verify logs contain governance mode
- ✅ Verify execution blocked/allowed correctly

### Regression Tests
- ✅ Run existing OMEN test suite with governance OFF
- ✅ Run existing OMEN test suite with governance ON (NONE mode)
- ✅ Verify identical behavior in both cases

---

## Rollback Plan

If issues arise in Phase 3:

1. **Immediate**: Set `OMEN_GOVERNANCE_ENABLED=false`
2. **Next Deploy**: Remove hook calls (revert commits)
3. **Governance Module**: Remains isolated, can be improved offline

**No data loss, no breaking changes** - governance is additive layer only.

---

## Next Steps (Awaiting Approval)

1. **Your Approval**: Review this integration strategy
2. **Hook Selection**: Confirm which hook points to implement
3. **Feature Flag**: Confirm environment variable approach
4. **Phase 3 Execution**: Implement hooks with feature flag (default OFF)
5. **Testing**: Verify existing tests pass with governance disabled
6. **Observation**: Enable governance in read-only mode, collect data
7. **Enforcement**: Gradually enable enforcement with monitoring

---

**Status**: ⏸️ **PLANNING COMPLETE - AWAITING APPROVAL**
**Next Phase**: Phase 3 implementation pending your go-ahead
