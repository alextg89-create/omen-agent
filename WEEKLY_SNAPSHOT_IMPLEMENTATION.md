# Weekly Snapshot + Recommendation Engine Implementation

## Overview

The OMEN Weekly Snapshot system now generates comprehensive financial reports with **deterministic, calculation-based business recommendations**. No LLM is required for recommendation logic - all suggestions are derived from pure mathematical analysis of inventory metrics.

## What Was Implemented

### 1. Snapshot Generation Endpoint

**Location**: `src/server.js:820-892`

**Endpoint**: `POST /snapshot/generate`

**Purpose**: Generate a comprehensive weekly operations snapshot with financial metrics and actionable recommendations.

**Process**:
1. Fetches live inventory from store via `getInventory("NJWeedWizard")`
2. Calculates financial metrics via `calculateInventoryMetrics()` (reused from chat)
3. Generates recommendations via `generateRecommendations()`
4. Caches snapshot for chat queries
5. Returns structured snapshot object

**Response Format**:
```json
{
  "ok": true,
  "snapshot": {
    "requestId": "uuid",
    "generatedAt": "ISO timestamp",
    "store": "NJWeedWizard",
    "metrics": {
      "totalItems": 60,
      "itemsWithPricing": 60,
      "averageMargin": 56.32,
      "totalRevenue": 45000.00,
      "totalCost": 19500.00,
      "totalProfit": 25500.00,
      "highestMarginItem": { "name": "...", "margin": 72.5 },
      "lowestMarginItem": { "name": "...", "margin": 38.2 },
      "topItems": [...]
    },
    "recommendations": {
      "promotions": [...],
      "pricing": [...],
      "inventory": [...]
    },
    "confidence": "high",
    "itemCount": 60
  }
}
```

### 2. Email Delivery Endpoint

**Location**: `src/server.js:895-967`

**Endpoint**: `POST /snapshot/send`

**Purpose**: Prepare snapshot for email delivery with formatted report.

**Request Body**:
```json
{
  "email": "user@example.com"
}
```

**Response**:
```json
{
  "ok": true,
  "snapshot": { ... },
  "email": {
    "to": "user@example.com",
    "subject": "OMEN Weekly Snapshot - 1/9/2026",
    "body": "formatted email content"
  },
  "message": "Snapshot prepared for email delivery"
}
```

**Email Format** (see `formatSnapshotEmail()` at line 740):
- Financial Metrics section
- Recommended Actions This Week section
  - Promotion Opportunities
  - Pricing Actions
  - Inventory Actions
- Each recommendation shows: name, action, reason, metrics, confidence

### 3. Deterministic Recommendation Engine

**Location**: `src/server.js:602-735`

**Function**: `generateRecommendations(inventory, metrics)`

**Logic**: 100% calculation-based, NO LLM involved

**Recommendation Categories**:

#### A. Promotion Recommendations
1. **High Stock + Healthy Margin** (qty ≥ 20, margin 45-65%)
   - Action: `PROMOTE_AS_FEATURED`
   - Confidence: 0.85
   - Reason: "High stock + healthy margin"

2. **High Margin Bundle** (margin > 65%, qty 10-25)
   - Action: `CREATE_BUNDLE`
   - Confidence: 0.75
   - Reason: "High margin with moderate stock - bundle candidate"

#### B. Pricing Recommendations
1. **Low Margin Review** (margin < 40%)
   - Action: `REVIEW_PRICING`
   - Confidence: 0.90
   - Reason: "Margin below target threshold (40%)"

2. **Protect Premium Pricing** (margin > 70%)
   - Action: `PROTECT_PRICING`
   - Confidence: 0.80
   - Reason: "Premium margin - maintain pricing power"

#### C. Inventory Recommendations
1. **Reorder Soon** (qty 1-5)
   - Action: `REORDER_SOON`
   - Confidence: 0.95
   - Reason: "Low stock - reorder soon"

2. **Consider Discount** (qty > 50)
   - Action: `CONSIDER_DISCOUNT`
   - Confidence: 0.70
   - Reason: "High inventory - consider promotional pricing"

**Recommendation Object Structure**:
```javascript
{
  sku: "Bloopiez",
  unit: "oz",
  name: "Bloopiez (oz)",
  reason: "High stock + healthy margin",
  triggeringMetrics: {
    quantity: 28,
    margin: 60.00
  },
  confidence: 0.85,
  action: "PROMOTE_AS_FEATURED"
}
```

**Sorting**: All recommendations sorted by confidence (highest first)

### 4. Chat Integration

**Location**: `src/server.js:274-330, 412-424`

**New Intent Detection**: `detectRecommendationIntent()`

Detects keywords: recommend, suggestion, should i, what to promote, advice, action, bundle, discount, reorder, priority, focus on

**Chat Flow for Recommendations**:
1. Detects recommendation intent
2. Fetches inventory + calculates metrics
3. Generates recommendations via `generateRecommendations()`
4. Passes recommendations to LLM with specialized prompt
5. Fallback to `generateFallbackRecommendationResponse()` if no LLM

**Example Queries**:
- "what should I promote?"
- "what are your recommendations?"
- "what should I focus on?"
- "should I discount anything?"
- "what needs reordering?"

**LLM Prompt** (when recommendations requested):
```
You are OMEN, an inventory intelligence assistant with access to business recommendations.

When answering:
- Explain recommendations clearly and concisely
- Prioritize by confidence level
- Give specific actionable advice
- Reference the triggering metrics when helpful

Current Recommendations Available:
- X promotion opportunities
- Y pricing actions
- Z inventory actions
```

### 5. Fallback Responses (Dev Mode)

**Location**: `src/server.js:584-649`

**Function**: `generateFallbackRecommendationResponse(message, recommendations)`

**Purpose**: Provide deterministic responses when LLM is unavailable

**Handles**:
- Promotion queries: Returns top 3 promotion recommendations
- Pricing queries: Returns top 3 pricing recommendations
- Inventory queries: Returns top 3 inventory recommendations
- General queries: Summarizes all recommendation categories

**Example Fallback**:
```
I have 12 recommendations for you:

📣 5 promotion opportunities
Top: Bloopiez (oz) - High stock + healthy margin

💰 4 pricing actions
Top: Dosi Pop (eighth) - Margin below target threshold (40%)

📦 3 inventory actions
Top: Purple Haze (quarter) - Low stock - reorder soon
```

### 6. Shared Metrics Calculation

**Location**: `src/server.js:426-505`

**Function**: `calculateInventoryMetrics(inventory)`

**Used By**:
- Chat endpoint
- Snapshot generation
- Email preparation

**Ensures**:
- Pricing fields use `pricing.retail` (not `retailPrice`)
- All financial calculations consistent across system
- Same filtering rules (valid pricing data required)
- Same margin formula: `((retail - cost) / retail) × 100`

## API Endpoints Summary

| Endpoint | Method | Purpose | Auth Required |
|----------|--------|---------|---------------|
| `/snapshot/generate` | POST | Generate weekly snapshot with recommendations | No |
| `/snapshot/send` | POST | Prepare snapshot for email delivery | No |
| `/chat` | POST | Chat with recommendation support | No |

## Testing

### 1. Test Snapshot Generation

```bash
curl -X POST http://localhost:3000/snapshot/generate
```

**Expected Response**:
- `ok: true`
- `snapshot.metrics` with financial data
- `snapshot.recommendations` with 3 categories
- No errors if inventory is ingested

### 2. Test Snapshot Email

```bash
curl -X POST http://localhost:3000/snapshot/send \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

**Expected Response**:
- `ok: true`
- `email.body` with formatted report
- Includes metrics and recommendations

### 3. Test Chat Recommendations

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "what should I promote?",
    "conversationHistory": []
  }'
```

**Expected Response**:
- `response` with specific recommendations
- `meta.recommendationsProvided: true`
- `meta.recommendationCount` > 0

### 4. Test Chat Fallback (No LLM)

Ensure `OPENAI_API_KEY` is not set, then:

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "what are your recommendations?",
    "conversationHistory": []
  }'
```

**Expected Response**:
- Deterministic recommendation list
- No hallucinated data
- Specific SKUs and metrics

## Error Handling

### No Inventory Available
```json
{
  "ok": false,
  "error": "No inventory data available",
  "message": "Please ingest inventory via /ingest/njweedwizard first"
}
```

### No Valid Pricing Data
```json
{
  "ok": false,
  "error": "Unable to calculate metrics",
  "message": "No items with valid pricing data"
}
```

### Email Missing
```json
{
  "ok": false,
  "error": "Email address required"
}
```

## Determinism Guarantees

✅ **No hallucinated numbers** - All calculations from real inventory
✅ **No LLM business logic** - Recommendations from pure math
✅ **Auditable** - Each recommendation shows triggering metrics
✅ **Reproducible** - Same inventory = same recommendations
✅ **Explainable** - Clear reason for each suggestion
✅ **Confidence scores** - Transparent uncertainty levels

## Recommendation Thresholds (Configurable)

Current thresholds (can be adjusted in code):

| Metric | Threshold | Purpose |
|--------|-----------|---------|
| High stock | ≥ 20 units | Promotion candidate |
| Healthy margin | 45-65% | Safe to promote |
| High margin | > 65% | Bundle opportunity |
| Premium margin | > 70% | Protect pricing |
| Low margin | < 40% | Review pricing |
| Low stock | 1-5 units | Reorder soon |
| Overstocked | > 50 units | Consider discount |
| Moderate stock | 10-25 units | Bundle with high margin |

## Files Modified

1. **`src/server.js`**
   - Added `generateRecommendations()` (lines 602-735)
   - Added `formatSnapshotEmail()` (lines 740-814)
   - Added `detectRecommendationIntent()` (lines 412-424)
   - Added `generateFallbackRecommendationResponse()` (lines 584-649)
   - Added `/snapshot/generate` endpoint (lines 820-892)
   - Added `/snapshot/send` endpoint (lines 895-967)
   - Updated `/chat` endpoint to support recommendations (lines 274-409)
   - Added global `latestSnapshot` cache (line 817)

## Files NOT Modified

✅ No governance changes
✅ No UI changes
✅ No ingestion changes
✅ No database schema changes
✅ No breaking changes to existing endpoints

## Integration with n8n

The `/snapshot/send` endpoint returns a formatted email body that n8n can use directly:

1. n8n hits `/snapshot/send` with email address
2. Response includes `email.subject` and `email.body`
3. n8n passes these to email provider
4. Recommendations appear in user inbox

## Chat Examples

### Example 1: Promotion Query
**User**: "what should I promote this week?"

**Response**:
```
Here are my top promotion recommendations:

1. Bloopiez (oz) - High stock + healthy margin
   Stock: 28 | Margin: 60% | Confidence: 85%

2. Dosi Pop (half) - High stock + healthy margin
   Stock: 22 | Margin: 58% | Confidence: 85%

3. Purple Haze (oz) - High margin with moderate stock - bundle candidate
   Stock: 16 | Margin: 72% | Confidence: 75%
```

### Example 2: Pricing Query
**User**: "should I adjust any prices?"

**Response**:
```
Here are my pricing recommendations:

1. White Widow (eighth) - Margin below target threshold (40%)
   Current: 38.2% | Confidence: 90%

2. OG Kush (oz) - Premium margin - maintain pricing power
   Current: 74.5% | Confidence: 80%
```

### Example 3: General Query
**User**: "what are your recommendations?"

**Response**:
```
I have 12 recommendations for you:

📣 5 promotion opportunities
Top: Bloopiez (oz) - High stock + healthy margin

💰 4 pricing actions
Top: White Widow (eighth) - Margin below target threshold (40%)

📦 3 inventory actions
Top: Gelato (quarter) - Low stock - reorder soon
```

## Verification Checklist

✅ Snapshot generation works
✅ Email preparation works
✅ Recommendations are deterministic
✅ No LLM required for business logic
✅ Chat handles recommendation queries
✅ Fallbacks work without LLM
✅ Metrics match chat endpoint
✅ Pricing uses correct fields (pricing.retail)
✅ Error handling is graceful
✅ n8n integration ready
✅ No governance changes
✅ No UI changes required

## Future Enhancements (Not Implemented)

- Historical trend analysis (week-over-week)
- Seasonal recommendation adjustments
- Customer preference integration
- Velocity-based recommendations
- Cross-category bundling logic
- Margin optimization suggestions
- Inventory turnover optimization

## Conclusion

The Weekly Snapshot system now provides:
- **Accurate financial metrics** using correct pricing fields
- **Deterministic recommendations** without LLM dependency
- **Email-ready reports** for stakeholders
- **Chat integration** for interactive queries
- **Graceful error handling** for all edge cases
- **Auditable logic** with transparent reasoning

All recommendations are calculation-based, reproducible, and explainable. The system never hallucinates numbers or makes unfounded suggestions.
