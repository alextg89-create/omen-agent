# OMEN Governance System - Phase 1: Resolver

## Overview

Phase 1 implements an isolated, pure governance resolver that serves as the **single source of truth** for execution mode decisions. This module is completely self-contained and does not integrate with or modify any existing OMEN logic.

## Status: ✅ COMPLETE

**Date**: 2026-01-08
**Phase**: 1 (Resolver Implementation)
**Integration**: None (isolated module, ready for Phase 2)

---

## Files Created

| File | Purpose | Lines | Status |
|------|---------|-------|--------|
| `resolveExecutionMode.js` | Pure resolver function + enums | 168 | ✅ Complete |
| `resolveExecutionMode.test.js` | Comprehensive unit tests | 559 | ✅ All 39 tests pass |
| `README.md` | This documentation | - | ✅ Complete |

---

## Architecture

### Core Function: `resolveExecutionMode()`

**Signature**:
```javascript
resolveExecutionMode(
  executionAllowed: Boolean,
  riskTier: Enum { LOW, ELEVATED, CRITICAL },
  adminSignal: Boolean,
  confidenceGate: Boolean,
  decisionIntent: Enum { NONE, SPEAK, ACT }
) -> ExecutionMode { NONE, INTELLIGENCE_ONLY, EXECUTION }
```

### Execution Modes

| Mode | Description | When Returned |
|------|-------------|---------------|
| `NONE` | No output, no actions (safest default) | Invalid inputs, unsafe conditions, or no matching approval path |
| `INTELLIGENCE_ONLY` | May generate intelligence but not execute | SPEAK intent + blocked execution + LOW/ELEVATED risk + confident |
| `EXECUTION` | Full execution allowed | Admin approval + execution allowed + LOW risk |

### Risk Tiers

| Tier | Description | Behavior |
|------|-------------|----------|
| `LOW` | Safe operations | Can escalate to EXECUTION or INTELLIGENCE_ONLY |
| `ELEVATED` | Moderate risk | Can only reach INTELLIGENCE_ONLY (not EXECUTION) |
| `CRITICAL` | High risk, requires human intervention | Always returns NONE |

### Decision Intents

| Intent | Description | Usage |
|--------|-------------|-------|
| `NONE` | No clear purpose | Always returns NONE |
| `SPEAK` | Generate recommendations/intelligence | Can trigger INTELLIGENCE_ONLY |
| `ACT` | Execute actions | Required for some execution paths |

---

## Decision Logic

The resolver follows a 5-step decision tree per the Governance Interface Reference spec:

### Step 1: Input Validation
**Rule**: If any signals are missing, invalid, or inconsistent → `NONE`

**Validations**:
- All 5 parameters must be present (not `undefined`, `null`)
- `executionAllowed`, `adminSignal`, `confidenceGate` must be boolean
- `riskTier` must be valid enum value (`LOW`, `ELEVATED`, `CRITICAL`)
- `decisionIntent` must be valid enum value (`NONE`, `SPEAK`, `ACT`)

**Tests Covering**: 9 test cases

---

### Step 2: Blocking Conditions
**Rule**: If unsafe conditions present → `NONE`

**Blocking Conditions**:
1. `!confidenceGate` (system not confident)
2. `riskTier == CRITICAL` (too dangerous)
3. `decisionIntent == NONE` (no clear intent)

**Precedence**: These blocks override all other permissions (even admin approval)

**Tests Covering**: 5 test cases

---

### Step 3: EXECUTION Path
**Rule**: If `adminSignal == true` AND `executionAllowed == true` AND `riskTier == LOW` → `EXECUTION`

**Requirements** (all must be true):
- ✅ Admin explicitly approved (`adminSignal = true`)
- ✅ Base execution permission granted (`executionAllowed = true`)
- ✅ Risk is LOW (not ELEVATED or CRITICAL)

**Note**: Decision intent is not checked in this step. If all three conditions are met, execution is granted regardless of intent.

**Tests Covering**: 5 test cases

---

### Step 4: INTELLIGENCE_ONLY Path
**Rule**: If `decisionIntent == SPEAK` AND `executionAllowed == false` AND `riskTier ∈ { LOW, ELEVATED }` AND `confidenceGate == true` → `INTELLIGENCE_ONLY`

**Requirements** (all must be true):
- ✅ Intent is to SPEAK (generate intelligence)
- ✅ Base execution is BLOCKED (`executionAllowed = false`)
- ✅ Risk is LOW or ELEVATED (not CRITICAL)
- ✅ Confidence gate is met (`confidenceGate = true`)

**Use Case**: System can provide recommendations but not execute actions

**Tests Covering**: 5 test cases

---

### Step 5: Conservative Default
**Rule**: Otherwise → `NONE`

**Rationale**: Any combination not explicitly allowed above defaults to the safest mode (NONE)

**Examples**:
- `decisionIntent = ACT` without admin approval
- `executionAllowed = true` but `adminSignal = false`
- Any ambiguous or unmatched condition

**Tests Covering**: 3 test cases

---

## Invariants

✅ **Deterministic**: Same inputs always produce same output
✅ **Pure**: No side effects, no I/O, no async operations
✅ **Conservative**: Defaults to NONE when uncertain
✅ **Non-escalating**: Never grants more permissions than explicitly allowed
✅ **Stateless**: No dependency on environment or external state

**Tests Covering**: 3 dedicated determinism/purity tests

---

## Test Coverage

### Test Suite Summary
- **Total Tests**: 39
- **Passed**: 39 ✅
- **Failed**: 0
- **Coverage**: All decision paths, edge cases, and invariants

### Test Categories

| Category | Tests | Purpose |
|----------|-------|---------|
| Input Validation | 9 | Missing, invalid, null, type errors |
| Blocking Conditions | 5 | Unsafe states that force NONE |
| EXECUTION Mode | 5 | Admin-approved execution path |
| INTELLIGENCE_ONLY Mode | 5 | Advisory-only path |
| Conservative Default | 3 | Fallback to NONE |
| Determinism | 3 | Verify pure function behavior |
| Edge Cases | 4 | Boundary conditions, override limits |
| Comprehensive Scenarios | 5 | End-to-end realistic use cases |

### Running Tests

```bash
# From project root
node src/governance/resolveExecutionMode.test.js
```

**Expected Output**: All 39 tests pass with detailed reporting

---

## Usage Example

```javascript
import { resolveExecutionMode, ExecutionMode, RiskTier, DecisionIntent } from './governance/resolveExecutionMode.js';

// Scenario 1: Safe execution with full approval
const mode1 = resolveExecutionMode(
  true,                    // executionAllowed
  RiskTier.LOW,           // riskTier
  true,                    // adminSignal
  true,                    // confidenceGate
  DecisionIntent.ACT      // decisionIntent
);
console.log(mode1); // "EXECUTION"

// Scenario 2: Advisory mode for blocked low-risk
const mode2 = resolveExecutionMode(
  false,                   // executionAllowed (blocked)
  RiskTier.LOW,
  false,
  true,
  DecisionIntent.SPEAK
);
console.log(mode2); // "INTELLIGENCE_ONLY"

// Scenario 3: Critical risk lockdown
const mode3 = resolveExecutionMode(
  true,
  RiskTier.CRITICAL,      // Too dangerous
  true,
  true,
  DecisionIntent.ACT
);
console.log(mode3); // "NONE"
```

---

## Integration Points (Phase 2)

This module is **ready for integration** but **not yet wired** into the live system. No existing OMEN code has been modified.

### Proposed Integration Locations

1. **Decision Engine** ([decisionEngine.js](../decisionEngine.js))
   - Hook Point: Block handler (lines 23-30)
   - Purpose: Evaluate governance mode when execution is blocked

2. **Intelligence Router** ([intelligenceRouter.js](../intelligenceRouter.js))
   - Hook Point: HIGH risk detection (lines 42-44)
   - Purpose: Allow governance to assess and potentially override blocks

3. **Server Route Handler** ([server.js](../server.js))
   - Hook Point: After decision (lines 109-119)
   - Purpose: Audit trail and decision logging

**Next Phase**: Create governance controller to coordinate resolver with OMEN decision flow

---

## Compliance

### Guardrails Adherence

✅ **System Integrity**: No existing files modified
✅ **Isolation Principle**: Completely separate module, no external imports
✅ **Backward Compatibility**: No impact on runtime behavior
✅ **Controlled Rollout**: Add-only code, ready for review
✅ **Non-Destructive**: Zero changes to production logic

### Default Operating Behavior

| Situation | Behavior |
|-----------|----------|
| Governance module absent | System continues normally (module not imported) |
| Resolver misconfigured | Returns `NONE` (safe default) |
| Missing governance signals | Returns `NONE` (graceful degradation) |
| Invalid inputs | Returns `NONE` (no exceptions thrown) |

---

## Performance Characteristics

- **Time Complexity**: O(1) - constant time decision tree
- **Space Complexity**: O(1) - no allocations, pure function
- **Async**: None - synchronous execution only
- **Dependencies**: Zero - stdlib only

---

## Known Limitations

1. **No Audit Trail**: Resolver makes decisions but doesn't log them (deferred to Phase 2 Controller)
2. **No State Persistence**: Decisions are ephemeral (intentional for Phase 1)
3. **No Override Mechanism**: Once a mode is determined, it's final (no appeals process yet)
4. **No Context Awareness**: Doesn't consider request history or patterns (pure function by design)

These are intentional limitations for Phase 1 isolation. Phase 2 (Controller) will add coordination, logging, and state management.

---

## Next Steps

### Phase 2: Controller Implementation
- Create `governanceController.js` - coordination layer
- Create `governanceAuditLog.js` - decision trail persistence
- Create `governanceConfig.js` - environment-based feature flags
- Wire resolver into controller (still no integration with live system)

### Phase 3: Integration
- Add minimal hooks to existing OMEN code (with explicit approval)
- Test integration in isolated environment
- Verify backward compatibility

### Phase 4: Testing & Verification
- End-to-end integration tests
- Production health checks
- Rollout with feature flag (default: disabled)

---

## Appendix: Decision Tree Flowchart

```
┌─────────────────────────────────────────────────────────────┐
│                    resolveExecutionMode()                    │
│                  Input: 5 governance signals                 │
└────────────────────────────┬────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │ Step 1: Validate │
                    │ All inputs valid?│
                    └────────┬────────┘
                             │
                ┌────────────┴────────────┐
                │ NO                      │ YES
                ▼                         ▼
         ┌──────────┐            ┌────────────────┐
         │   NONE   │            │ Step 2: Check  │
         └──────────┘            │ Blocking Conds │
                                 └────────┬────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
          ┌─────────▼─────────┐  ┌────────▼────────┐  ┌────────▼────────┐
          │ !confidenceGate   │  │ riskTier==      │  │ decisionIntent  │
          │ OR riskTier==     │  │ CRITICAL        │  │ == NONE         │
          │ CRITICAL          │  │                 │  │                 │
          │ OR intent==NONE   │  │                 │  │                 │
          └─────────┬─────────┘  └────────┬────────┘  └────────┬────────┘
                    │ YES                 │ YES                │ YES
                    ▼                     ▼                    ▼
             ┌──────────┐          ┌──────────┐        ┌──────────┐
             │   NONE   │          │   NONE   │        │   NONE   │
             └──────────┘          └──────────┘        └──────────┘
                                          │ NO
                                          ▼
                                 ┌────────────────┐
                                 │ Step 3: Check  │
                                 │ EXECUTION Path │
                                 │ adminSignal &&  │
                                 │ execAllowed &&  │
                                 │ riskTier==LOW   │
                                 └────────┬────────┘
                                          │
                            ┌─────────────┴─────────────┐
                            │ YES                       │ NO
                            ▼                           ▼
                     ┌────────────┐           ┌─────────────────┐
                     │ EXECUTION  │           │ Step 4: Check   │
                     └────────────┘           │ INTELLIGENCE_   │
                                              │ ONLY Path       │
                                              │ intent==SPEAK && │
                                              │ !execAllowed &&  │
                                              │ risk<=ELEVATED   │
                                              └────────┬─────────┘
                                                       │
                                         ┌─────────────┴─────────────┐
                                         │ YES                       │ NO
                                         ▼                           ▼
                              ┌──────────────────┐           ┌──────────┐
                              │ INTELLIGENCE_    │           │   NONE   │
                              │ ONLY             │           │(Step 5:  │
                              └──────────────────┘           │Default)  │
                                                             └──────────┘
```

---

## Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-08 | 1.0.0 | Phase 1 complete: Resolver + tests + documentation |

---

**Phase 1 Status**: ✅ **COMPLETE & VERIFIED**
**Ready for**: Phase 2 (Controller Implementation)
**Integration**: None (awaiting explicit approval)
