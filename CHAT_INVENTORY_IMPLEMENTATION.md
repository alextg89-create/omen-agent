# Chat Inventory Intelligence Implementation

## Overview

The OMEN chat endpoint now automatically fetches and analyzes inventory data when users ask business questions, providing real, data-backed answers instead of generic responses.

## What Was Implemented

### 1. Intent Detection (`detectInventoryIntent`)

**Location**: `src/server.js:394-407`

Deterministically detects when a user message requires inventory data by checking for keywords:
- `margin`, `profit`, `inventory`, `stock`, `sales`, `revenue`
- `cost`, `price`, `pricing`, `skus`, `items`, `products`
- `performance`, `sell`, `sold`, `movement`, `turnover`
- `value`, `worth`, `total`, `average`, `highest`, `lowest`

**Example**:
```javascript
detectInventoryIntent("what are my margins?") // true
detectInventoryIntent("hello") // false
```

### 2. Inventory Fetching (Reuses Existing Logic)

**Location**: `src/server.js:281-308`

When inventory is required:
- Fetches from existing inventory store: `getInventory("NJWeedWizard")`
- **NO NEW DATA ACCESS LOGIC** - reuses the same store used by weekly snapshots
- Handles unavailable inventory gracefully with clear messaging

**Failure Behavior**:
```json
{
  "response": "Inventory data is currently unavailable. I can still explain how margins are calculated if you'd like.",
  "confidence": "medium",
  "reason": "Inventory data not available",
  "nextBestAction": "Please ensure inventory has been ingested via /ingest/njweedwizard"
}
```

### 3. Metrics Calculation (`calculateInventoryMetrics`)

**Location**: `src/server.js:412-485`

Calculates comprehensive metrics from raw inventory data:

**Metrics Provided**:
- `totalItems`: Total inventory count
- `itemsWithPricing`: Items with valid cost/retail price data
- `averageMargin`: Weighted average margin across all items
- `totalRevenue`: Sum of (retail price × quantity)
- `totalCost`: Sum of (cost × quantity)
- `totalProfit`: Total revenue - total cost
- `highestMarginItem`: Item with best margin
- `lowestMarginItem`: Item with worst margin
- `topItems`: Top 5 items by margin

**Calculation Details**:
```javascript
margin = ((retailPrice - cost) / retailPrice) × 100
```

**Example Output**:
```json
{
  "totalItems": 150,
  "itemsWithPricing": 145,
  "averageMargin": 42.35,
  "totalRevenue": 125000.00,
  "totalCost": 72000.00,
  "totalProfit": 53000.00,
  "highestMarginItem": {
    "name": "Blue Dream (1/8oz)",
    "margin": 65.5
  }
}
```

### 4. LLM-Powered Responses

**Location**: `src/server.js:319-332`

When inventory data is available:
- Builds specialized system prompt with inventory context
- Provides calculated metrics to LLM
- LLM generates natural language explanation using real data

**System Prompt** (see `buildInventoryAwareSystemPrompt`, lines 490-510):
```
You are OMEN, an inventory intelligence assistant.
You have access to real, live inventory data...
Current Inventory Summary:
- Total Items: 150
- Average Margin: 42.35%
...
```

### 5. Fallback Responses (No LLM Required)

**Location**: `src/server.js:334-341, 515-532`

When LLM is unavailable (dev mode), generates deterministic responses:

**Margins Query**:
```
"Based on your current inventory, your average margin is 42.35%.
This was calculated using cost vs retail price across 145 SKUs
with valid pricing data. Your highest margin item is Blue Dream (1/8oz) at 65.5%."
```

**Profit Query**:
```
"Based on current inventory levels and pricing, your total potential profit is $53000.
This is calculated as total revenue ($125000) minus total cost ($72000) across 145 items."
```

### 6. Conversation Context Updates

**Location**: `src/server.js:352-356, 537-568`

Properly updates conversation metadata for UI display:

```json
{
  "conversationContext": {
    "lastIntent": "margin analysis",
    "recentTopics": ["inventory", "margins"],
    "messagesExchanged": 3
  }
}
```

**Intent Extraction** (lines 537-549):
- `margin analysis`, `profit analysis`, `revenue analysis`
- `inventory query`, `pricing query`, `general query`

**Topic Extraction** (lines 554-568):
- `inventory`, `margins`, `profitability`, `revenue`, `pricing`, `costs`

### 7. Response Metadata

**Location**: `src/server.js:365-373`

Includes comprehensive metadata for debugging and logging:

```json
{
  "meta": {
    "requestId": "uuid",
    "decision": "RESPOND_DIRECT",
    "executionAllowed": true,
    "inventoryRequired": true,
    "inventoryAvailable": true,
    "inventoryItemCount": 150
  }
}
```

## Response Format

### Successful Response (With Inventory)
```json
{
  "response": "Based on your current inventory, your average margin is 42.35%...",
  "confidence": "high",
  "reason": "Answered using live inventory data (150 items)",
  "nextBestAction": null,
  "conversationContext": {
    "lastIntent": "margin analysis",
    "recentTopics": ["inventory", "margins"],
    "messagesExchanged": 1
  },
  "meta": {
    "requestId": "abc-123",
    "decision": "RESPOND_DIRECT",
    "executionAllowed": true,
    "inventoryRequired": true,
    "inventoryAvailable": true,
    "inventoryItemCount": 150
  }
}
```

### Response Without Inventory Available
```json
{
  "response": "Inventory data is currently unavailable. I can still explain how margins are calculated if you'd like.",
  "confidence": "medium",
  "reason": "Inventory data not available",
  "nextBestAction": "Please ensure inventory has been ingested via /ingest/njweedwizard",
  "conversationContext": {
    "lastIntent": "margin analysis",
    "recentTopics": ["inventory", "unavailable"],
    "messagesExchanged": 1
  },
  "meta": {
    "requestId": "abc-123",
    "decision": "RESPOND_DIRECT",
    "executionAllowed": false,
    "inventoryRequired": true,
    "inventoryAvailable": false
  }
}
```

### General Query (No Inventory Needed)
```json
{
  "response": "How can I help you today?",
  "confidence": "medium",
  "reason": "General query answered",
  "nextBestAction": null,
  "conversationContext": {
    "lastIntent": "general query",
    "recentTopics": ["general"],
    "messagesExchanged": 1
  },
  "meta": {
    "requestId": "abc-123",
    "decision": "RESPOND_DIRECT",
    "executionAllowed": true,
    "inventoryRequired": false,
    "inventoryAvailable": false,
    "inventoryItemCount": 0
  }
}
```

## Testing

### Manual Testing via UI

1. **Ensure inventory is loaded**:
   ```bash
   # Check inventory status
   GET http://localhost:3000/debug/inventory
   ```

   Expected response:
   ```json
   {
     "ok": true,
     "count": 150,
     "sample": [...]
   }
   ```

2. **If inventory count is 0, ingest data first**:
   ```bash
   POST /ingest/njweedwizard
   {
     "rows": [your CSV data]
   }
   ```

3. **Test margin query**:
   ```
   User: "what are my margins?"
   ```

   Expected: Real data-backed answer with actual percentages.

4. **Test profit query**:
   ```
   User: "what is my total profit?"
   ```

   Expected: Actual dollar amounts from inventory.

5. **Test general query**:
   ```
   User: "hello"
   ```

   Expected: General response, no inventory fetched.

### Automated Testing

Run the test script:
```bash
node test-chat-inventory.js
```

This tests:
- Intent detection
- Inventory fetching
- Conversation context updates
- Fallback behavior
- General queries

## What Was NOT Changed

✅ **No UI changes** - Chat interface unchanged
✅ **No snapshot logic changes** - Reuses existing `getInventory()`
✅ **No governance changes** - Decision engine untouched
✅ **No new services** - Uses existing inventory store
✅ **No mock data** - Only real inventory from store
✅ **Determinism preserved** - Intent detection is keyword-based

## Files Modified

1. **`src/server.js`** (lines 262-568)
   - Updated `/chat` endpoint to be `async`
   - Added intent detection
   - Added inventory fetching logic
   - Added metrics calculation
   - Added conversation context updates
   - Added 6 helper functions

## Files Created

1. **`test-chat-inventory.js`**
   - Automated test script for verification

2. **`CHAT_INVENTORY_IMPLEMENTATION.md`**
   - This documentation file

## Verification Checklist

✅ Asking "what are my margins?" returns real data
✅ Asking "what is my profit?" returns calculated values
✅ Asking "hello" doesn't fetch inventory
✅ Inventory only fetched when needed
✅ Conversation context properly updated
✅ LLM responses include data explanations
✅ Fallback responses work without LLM
✅ Graceful failure when inventory unavailable
✅ No UI changes required
✅ Weekly snapshot logic unchanged
✅ Governance system untouched

## Example Queries Supported

### Margin Queries
- "what are my margins?"
- "show me my profit margins"
- "which items have the best margins?"
- "what's my average margin?"

### Profit Queries
- "what is my total profit?"
- "how much profit am I making?"
- "what's my potential profit?"

### Revenue Queries
- "what's my total revenue?"
- "how much are my sales worth?"
- "what's my inventory value?"

### Inventory Queries
- "how many items do I have?"
- "what's in stock?"
- "show me my inventory"

### Pricing Queries
- "what are my prices?"
- "which items cost the most?"
- "what's my pricing strategy?"

## Logging

All chat requests log:
```javascript
console.log("💬 [OMEN] CHAT HIT", { requestId, message, historyLength })
console.log("💬 [OMEN] Inventory required for query", { requestId })
console.log("💬 [OMEN] Inventory context prepared", { requestId, itemCount, metrics })
console.warn("💬 [OMEN] Inventory unavailable", { requestId })
console.error("[OMEN] CHAT ERROR", { requestId, error, stack })
```

## Error Handling

All errors are caught and return safe responses:

```json
{
  "ok": false,
  "requestId": "uuid",
  "error": "Chat handler failed safely",
  "response": "I encountered an error processing your request. Please try again."
}
```

Errors never expose internal state or crash the server.

## Performance Considerations

- Intent detection: O(n) keyword scan (fast)
- Inventory fetch: O(1) map lookup (instant)
- Metrics calculation: O(n) single pass (scales linearly)
- No database queries per chat message
- No external API calls unless LLM is enabled

## Future Enhancements (Not Implemented)

- Historical trend analysis
- SKU-specific queries
- Comparative analysis (month-over-month)
- Predictive analytics
- Custom metric calculations
- Multi-store support

## Conclusion

The chat endpoint now provides intelligent, data-backed responses to business questions while maintaining:
- System determinism
- Governance guarantees
- Existing architecture
- Zero breaking changes
- Production stability

Users can now ask "what are my margins?" and receive real answers using live inventory data.
