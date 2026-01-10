# Pricing & Language Correctness Hotfix

**Date**: 2026-01-10
**Status**: ✅ COMPLETE (Code Changes Ready - Awaiting Deployment)
**Priority**: Production Trust-Critical

---

## Executive Summary

Completed comprehensive audit and fixes for pricing accuracy and explanatory language in the OMEN snapshot system.

**Key Finding**: Pricing is CORRECT - the $18 uniform pricing observed is accurate for STANDARD quality eighths. The issue was LANGUAGE, not data.

**Changes Made**:
1. ✅ Removed misleading "best-selling" / "top performer" language
2. ✅ Added explicit disclaimers about missing sales data
3. ✅ Renamed ambiguous fields (`topItems` → `highestMarginItems`)
4. ✅ Added validation safeguards to detect and warn about uniform pricing
5. ✅ Updated system prompts to enforce conservative language

---

## Audit Findings

### 1. Pricing Source Audit ✅

**Question**: Why are all prices showing $18?

**Answer**: This is CORRECT behavior, not a bug.

- The system uses a **pricing lookup table** ([src/data/pricing.json](src/data/pricing.json))
- Pricing is matched by **Quality Tier + Unit Size**
- Example: `STANDARD | eighth` = $18 retail, $7 cost
- Current inventory has many STANDARD eighths → uniform $18 pricing

**Evidence from pricing catalog**:
```json
{
  "Quality": "STANDARD",
  "Weight (g)": "3.5 G",
  "Cost": "$7",
  "Retail Price": "$18",
  "Sale Price": "$30"
}
```

**Implementation** ([src/tools/applyPricing.js:45-77](src/tools/applyPricing.js)):
- Normalizes quality and unit to lookup key: `QUALITY|UNIT`
- Retrieves pricing from catalog
- Applied via `applyPricing()` function during inventory ingest

**Conclusion**: Pricing is accurate. The field represents true retail shelf prices for each Quality + Unit combination.

---

### 2. Language Audit - CRITICAL ISSUES FOUND ❌

**Problem**: System uses sales-performance language WITHOUT sales data.

**Examples of Misleading Language**:
- ❌ "Top Performer" (line 904) - implies sales performance
- ❌ `topItems` field (line 550) - sorted by margin, not sales
- ❌ Recommendations presented as comprehensive without volume data

**What's Missing**:
- No `units_sold` tracking
- No sales velocity data
- No revenue history
- No actual performance metrics

**Risk**: Client makes business decisions based on margin-only rankings, thinking they represent sales performance.

---

## Changes Implemented

### Change #1: Removed Performance Language

**Before** ([server.js:904](src/server.js)):
```javascript
Top Performer: ${metrics.highestMarginItem.name} (${metrics.highestMarginItem.margin}%)
```

**After**:
```javascript
Highest Margin Item: ${metrics.highestMarginItem.name} (${metrics.highestMarginItem.margin}%)
Lowest Margin Item: ${metrics.lowestMarginItem.name} (${metrics.lowestMarginItem.margin}%)
```

**Rationale**: "Highest Margin" is factually accurate; "Top Performer" implies untracked sales data.

---

### Change #2: Renamed Data Structure

**Before**:
```javascript
topItems: margins
  .sort((a, b) => b.margin - a.margin)
  .slice(0, 5)
```

**After**:
```javascript
highestMarginItems: margins
  .sort((a, b) => b.margin - a.margin)
  .slice(0, 5)
```

**Rationale**: Eliminates ambiguity - this field ranks by margin ONLY.

---

### Change #3: Added Sales Data Disclaimer

**Email Output**:
```
⚠️ DATA NOTES:
• Sales volume data is not currently tracked
• Rankings are based on margin and stock levels only
```

**Location**: Added to email formatter ([server.js:937-940](src/server.js))

**Impact**: Client immediately knows the limitation of the insights.

---

### Change #4: Validation Safeguards

**Purpose**: Detect uniform pricing and margin clustering to prevent misleading differentiation.

**Implementation** ([server.js:535-548](src/server.js)):
```javascript
// Detect uniform pricing patterns
const uniqueRetailPrices = new Set(margins.map(m => m.retailPrice));
const priceVariety = uniqueRetailPrices.size / margins.length;
const hasPriceDiversity = priceVariety > 0.3; // At least 30% diversity

// Detect margin clustering
const marginGroups = new Map();
margins.forEach(m => {
  const roundedMargin = Math.round(m.margin);
  marginGroups.set(roundedMargin, (marginGroups.get(roundedMargin) || 0) + 1);
});
const largestMarginGroup = Math.max(...marginGroups.values());
const marginDiversity = largestMarginGroup / margins.length < 0.7; // < 70% in one group
```

**Output** (added to metrics):
```javascript
dataQuality: {
  hasPriceDiversity: false,
  marginDiversity: false,
  uniquePriceCount: 4,
  pricingNote: "Limited pricing diversity detected - items may share standard tier pricing"
}
```

**Email Integration**:
When diversity is low, the email automatically includes:
```
• Limited pricing diversity detected - items may share standard tier pricing
```

---

### Change #5: Updated System Prompts

**Chat System Prompt** ([server.js:565-591](src/server.js)):
```javascript
IMPORTANT CONSTRAINTS:
- Sales volume data is NOT available - do not make claims about "best-selling" or "top-performing" items
- Rankings and insights are based on margin and stock levels only
- Use conservative, factual language - avoid speculative or causal statements
- Clearly label potential revenue as "potential" since it's based on current inventory, not actual sales
```

**Fallback Responses**:
```javascript
return `Your total potential revenue from current inventory is $${inventoryContext.totalRevenue},
        calculated by multiplying retail price × quantity for ${inventoryContext.itemsWithPricing} items
        with valid pricing. Note: This is potential revenue based on inventory on hand,
        not actual sales performance.`;
```

---

### Change #6: Fixed Chat Response Formatting

**Problem**: Chat responses were overly verbose with markdown formatting:
- Using `**asterisks**` for emphasis (markdown bold)
- Showing unnecessary calculation formulas
- Technical jargon instead of conversational language

**Before**:
```
Your inventory margins can be summarized as follows: 1. **Average Margin**: The average
margin across your items is **60.51%**. This means that, on average, you retain 60.51%
of the selling price as profit after covering the cost of the items. 2. **Highest Margin
Item**: **Bloopiez (eighth)**, which has a margin of **60%**... ### Calculation of
Margins: - **Margin Calculation Formula**: \[ \text{Margin} = \left( \frac{\text{Retail
Price} - \text{Cost}}{\text{Retail Price}} \right) \times 100 \]
```

**After** (with updated prompts):
```
Your average margin is 60.51%. The highest margin item is Bloopiez (eighth) at 61.11%,
and the lowest is Bloopiez (oz) at 60%. This is calculated using retail price minus
cost divided by retail price across 16 items with valid pricing.
```

**Implementation** ([server.js:599-605, 361-365](src/server.js)):
```javascript
RESPONSE FORMAT:
- Use plain text - NO markdown formatting, NO asterisks, NO special characters
- Keep responses concise (2-3 sentences max unless asked for detail)
- Use natural conversational language, not technical jargon
- Do NOT show calculation formulas unless explicitly asked
- Do NOT use asterisks (**) or underscores (__) for emphasis
```

**Note**: System uses GPT-4o-mini which defaults to markdown formatting - explicit constraints required.

---

### Change #7: Updated Recommendation Comments

**Before**:
```javascript
// High stock + decent margin = promote
// High margin + low velocity = bundle opportunity
```

**After**:
```javascript
// NOTE: Without sales data, these are based on margin and stock patterns only
// High stock + healthy margin = promotion candidate
// High margin + moderate stock = potential bundle opportunity
```

**Rationale**: Makes clear these are heuristics, not data-driven insights.

---

## Example Corrected Output

### Before (Misleading):
```
Top Performer: Bloopiez (eighth) (61.11%)
Lowest Margin: Bloopiez (oz) (60%)

═══════════════════════════════════════
💡 RECOMMENDED ACTIONS THIS WEEK
═══════════════════════════════════════

🎯 PROMOTION OPPORTUNITIES (1):

1. Bloopiez (oz)
   Action: PROMOTE_AS_FEATURED
   Reason: High stock + healthy margin
```

### After (Conservative & Accurate):
```
Highest Margin Item: Bloopiez (eighth) (61.11%)
Lowest Margin Item: Bloopiez (oz) (60%)

⚠️ DATA NOTES:
• Sales volume data is not currently tracked
• Rankings are based on margin and stock levels only
• Limited pricing diversity detected - items may share standard tier pricing

═══════════════════════════════════════
💡 RECOMMENDED ACTIONS THIS WEEK
═══════════════════════════════════════

🎯 PROMOTION OPPORTUNITIES (1):

1. Bloopiez (oz)
   Action: PROMOTE_AS_FEATURED
   Reason: High stock with healthy margin - promotion candidate
```

---

## Files Modified

1. **[src/server.js](src/server.js)** - Primary changes
   - Line 550-582: Added validation safeguards to `calculateInventoryMetrics()`
   - Line 565-591: Updated system prompt with constraints
   - Line 607-609: Updated fallback responses
   - Line 772: Added comment about missing sales data
   - Line 780: Updated promotion reason language
   - Line 904-905: Changed "Top Performer" → "Highest Margin Item"
   - Line 937-940: Added data notes disclaimer in email

---

## Safeguards Added

### 1. Price Diversity Detection
- **Metric**: `uniquePriceCount / totalItems`
- **Threshold**: If < 30% price diversity → flag it
- **Action**: Add warning to email

### 2. Margin Clustering Detection
- **Metric**: Largest margin group size / total items
- **Threshold**: If > 70% share same margin → flag it
- **Action**: Add warning to email

### 3. Language Enforcement
- System prompts block "best-selling" / "top-performing" language
- All references to revenue labeled as "potential"
- All rankings explicitly state "based on margin only"

---

## Testing Status

**Local Code**: ✅ Changes Complete
**Deployed Code**: ❌ Not Yet Deployed (Railway running old version)

**To Deploy**:
1. Commit changes to git
2. Push to origin/main
3. Railway auto-deploys from main branch
4. Generate new snapshot to verify

**Test Commands** (after deployment):
```bash
# Generate fresh snapshot
curl -X POST https://omen-agent-production.up.railway.app/snapshot/generate \
  -H "Content-Type: application/json" \
  -d '{"timeframe":"weekly","forceRegenerate":true}'

# Check email format
curl -X POST https://omen-agent-production.up.railway.app/snapshot/send \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}' | jq -r '.email.body'
```

---

## Why This Was Critical

**Before Hotfix**:
- Client sees "Top Performer" and thinks it's based on sales
- Makes merchandising decisions based on margin-only rankings
- Doesn't realize pricing uniformity is normal for tier-based catalog

**After Hotfix**:
- Client knows rankings are margin + stock only
- Understands pricing is tier-based (STANDARD/MID/TOP SHELF)
- Can make informed decisions with clear data limitations

**Trust Impact**:
- ✅ No more overstated claims
- ✅ No more misleading performance language
- ✅ Clear, upfront data limitations
- ✅ Accurate labeling of pricing methodology

---

## Next Steps

1. **Deploy** - Commit and push to trigger Railway deployment
2. **Verify** - Generate new snapshot and confirm email format
3. **Proceed** - Move forward with Delta & Trend integration
4. **Document** - Update client-facing documentation with data limitations

---

## Commit Message (Suggested)

```
fix: correct pricing language and add sales data disclaimers

BREAKING CHANGE: Renamed metrics.topItems → metrics.highestMarginItems

- Remove misleading "top performer" language (no sales data exists)
- Add explicit disclaimer about missing sales volume data
- Detect and warn about uniform pricing patterns
- Update system prompts to enforce conservative language
- Update recommendation comments to clarify heuristic basis

This is a trust-critical hotfix. Pricing data is accurate, but language
was overstating certainty without sales performance data.

Refs: Production readiness review, trust & correctness requirements
```

---

## Summary

**What Was Wrong**: Language implied sales performance data that doesn't exist
**What Was Right**: Pricing accuracy (tier-based catalog matching)
**What We Fixed**: Removed performance language, added disclaimers, added validation
**What We Protected**: Client trust and decision-making accuracy

**Delta & Trend Work Can Now Proceed**: Foundation is honest and conservative.
