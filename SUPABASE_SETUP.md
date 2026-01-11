# OMEN + Supabase Integration Guide

## Current Setup Status

✅ **Supabase Project**: `kaqnpprkwyxqwmumtmmh.supabase.co`
✅ **Orders Ingesting**: Wix → Make.com webhook → Supabase
✅ **Communication Method**: `primeagentvault`
⚠️ **Need**: Service role key for OMEN to read orders

---

## Step 1: Get Supabase Service Role Key

### In Supabase Dashboard:

1. Go to https://supabase.com/dashboard
2. Select your project: `kaqnpprkwyxqwmumtmmh`
3. Click **Settings** (gear icon) in left sidebar
4. Click **API** in the settings menu
5. Scroll to **Project API keys**
6. Copy the **`service_role`** key (not the anon key)

**IMPORTANT**: The service role key bypasses Row Level Security (RLS) and should ONLY be used server-side.

---

## Step 2: Configure Railway Environment Variables

### In Railway Dashboard:

1. Go to your OMEN project
2. Click **Variables** tab
3. Add these environment variables:

```env
OMEN_USE_SUPABASE=true
SUPABASE_URL=https://kaqnpprkwyxqwmumtmmh.supabase.co
SUPABASE_SERVICE_KEY=<paste-service-role-key-here>
```

**Optional** (for better chat):
```env
OPENAI_API_KEY=sk-xxx
```

4. Click **Deploy** to restart with new variables

---

## Step 3: Verify Table Structure

OMEN expects specific table structures. Check if these tables exist in your Supabase project:

### Expected Tables

#### 1. `orders` table
This is where your Make.com webhook should be sending orders.

**Required columns**:
- `created_at` (timestamptz) - Order timestamp
- `sku` (text) - Product SKU
- `quantity` (integer) - Quantity sold
- `unit` (text) - Unit type (eighth, gram, etc.) - optional
- `product_name` (text) - Product name - optional
- `price` (decimal) - Sale price - optional

**Check if it exists**:
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name = 'orders';
```

**View structure**:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'orders';
```

**Sample data check**:
```sql
SELECT * FROM orders
ORDER BY created_at DESC
LIMIT 5;
```

#### 2. `inventory_live` table (optional - for current stock)
```sql
CREATE TABLE IF NOT EXISTS inventory_live (
  sku TEXT PRIMARY KEY,
  quantity INTEGER NOT NULL,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL
);
```

#### 3. `inventory_snapshots` table (optional - for historical tracking)
```sql
CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id BIGSERIAL PRIMARY KEY,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  source TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_snapshots_sku
ON inventory_snapshots(sku);

CREATE INDEX IF NOT EXISTS idx_inventory_snapshots_recorded_at
ON inventory_snapshots(recorded_at);
```

---

## Step 4: Verify Make.com Webhook Format

Your Make.com webhook should send data in this format:

```json
{
  "sku": "Bloopiez_eighth",
  "quantity": 2,
  "product_name": "Bloopiez Eighth",
  "price": 25.00,
  "unit": "eighth",
  "created_at": "2026-01-11T12:00:00Z"
}
```

### Check Recent Orders in Supabase

Run this query to see what's being ingested:

```sql
SELECT
  sku,
  quantity,
  product_name,
  created_at,
  unit
FROM orders
WHERE created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 10;
```

If you see data, ✅ webhook is working!

---

## Step 5: Test OMEN Connection (After Railway Deploy)

### 1. Check Supabase Status
```bash
curl https://omen-agent-production.up.railway.app/supabase/status
```

**Expected Response (Success)**:
```json
{
  "ok": true,
  "enabled": true,
  "configured": true,
  "connected": true,
  "error": null
}
```

**If you see**:
- `"enabled": false` → Set `OMEN_USE_SUPABASE=true` in Railway
- `"configured": false` → Add `SUPABASE_SERVICE_KEY` to Railway
- `"connected": false` → Check service key is correct

### 2. Generate Snapshot with Real Data
```bash
curl -X POST https://omen-agent-production.up.railway.app/snapshot/generate \
  -H "Content-Type: application/json" \
  -d '{"timeframe":"weekly"}'
```

**Check Response**:
```json
{
  "ok": true,
  "temporal": {
    "intelligenceSource": "real_orders",  // ← Should say this!
    "hasRealData": true
  },
  "velocity": {
    "orderCount": 47,  // ← Should show actual orders
    "uniqueSKUs": 12,
    "insights": [
      {
        "type": "HIGH_VELOCITY",
        "priority": "MEDIUM",
        "message": "Cherry Pie Half is selling 2.3x faster than average",
        "details": "Sold 34 units in period (4.9/day)",
        "action": "Ensure adequate stock - consider increased orders"
      }
    ]
  }
}
```

### 3. Test Chat with Real Intelligence
```bash
curl -X POST https://omen-agent-production.up.railway.app/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"What should I promote this week?"}'
```

Should get response based on actual sales velocity!

---

## Step 6: Verify Data Flow End-to-End

### Complete Pipeline:

```
Wix Order
    ↓
Make.com Webhook
    ↓
Supabase → orders table
    ↓
OMEN queries orders by date range
    ↓
Calculates velocity: units sold / days
    ↓
Generates insights:
  - "Stocks out in X days"
  - "Selling Nx faster than average"
  - "Zero sales - consider discount"
    ↓
Available via:
  - Chat (instant Q&A)
  - Snapshots (weekly reports)
  - Cron jobs (automated)
```

### Verification Checklist:

1. ✅ Orders appear in Supabase `orders` table
2. ✅ OMEN connects to Supabase (`/supabase/status` shows connected)
3. ✅ Snapshot uses `intelligenceSource: "real_orders"`
4. ✅ `velocity.orderCount` > 0
5. ✅ `velocity.insights` array has specific recommendations
6. ✅ Chat responses reference real sales data

---

## Troubleshooting

### "No order data available"

**Check**:
1. Orders exist in Supabase for the date range
2. Service key has read permissions
3. Table is named `orders` (not `Orders` or `order`)

**Fix**:
```sql
-- Check if orders exist in last 7 days
SELECT COUNT(*) FROM orders
WHERE created_at > NOW() - INTERVAL '7 days';

-- If 0, webhook may not be configured correctly
```

### "Intelligence source is snapshot_deltas"

**This means**: Supabase query failed or returned no orders

**Check**:
1. `SUPABASE_SERVICE_KEY` is set correctly in Railway
2. Service key has `SELECT` permission on `orders` table
3. Orders exist in the queried date range

**Debug**:
```bash
# Check Railway logs for error messages
# Look for: "[TemporalAnalyzer] No order data available"
```

### "Supabase not available"

**Check**:
1. `OMEN_USE_SUPABASE=true` (not "True" or "TRUE")
2. `SUPABASE_URL` matches your project
3. `SUPABASE_SERVICE_KEY` is the service role (not anon key)

---

## What OMEN Will Do With Your Orders

### Velocity Analysis

For each SKU, OMEN calculates:

1. **Daily Velocity**: `total_sold / days_in_period`
   - Example: Sold 35 units in 7 days = 5 units/day

2. **Days Until Stockout**: `current_stock / daily_velocity`
   - Example: 20 in stock ÷ 5/day = 4 days until stockout

3. **Acceleration**: Comparing first half vs second half of period
   - Example: 2 units/day → 6 units/day = accelerating

4. **Dead Stock**: Items in inventory but zero sales
   - Example: 45 units sitting, $0 revenue

### Insights Generated

**URGENT (High Priority)**:
- Imminent stockouts (< 7 days)
- Low stock on high-margin items

**OPPORTUNITIES (Medium Priority)**:
- High-velocity products (top 20%)
- Accelerating demand

**OBSERVATIONS (Low Priority)**:
- Zero movement (dead stock)

---

## Expected Business Value

### Before (Without Supabase):
- Generic recommendations: "High margin, promote"
- No velocity data
- No stockout predictions
- Owner acts on guesses

### After (With Supabase):
- Specific insights: "Bloopiez Eighth stocks out in 3 days"
- Real velocity: "Cherry Pie selling 4.9 units/day"
- Actionable forecasts: "Will need restock by Thursday"
- Owner acts on data

---

## Communication via primeagentvault

Once configured, you can interact with OMEN through:

### 1. **Chat UI**
- Navigate to: https://your-railway-domain/
- Click "Chat" tab
- Ask: "What's moving fast?" or "What should I reorder?"

### 2. **Direct API**
```bash
curl -X POST https://your-railway-domain/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"What products are at risk of stocking out?"}'
```

### 3. **Automated Snapshots**
- Daily at 8 AM EST (shows urgent actions)
- Weekly on Monday at 9 AM EST (full analysis)

---

## Next Steps

1. **Get service role key** from Supabase dashboard
2. **Add to Railway** environment variables
3. **Redeploy** Railway (happens automatically)
4. **Test connection**: `GET /supabase/status`
5. **Generate snapshot**: `POST /snapshot/generate`
6. **Verify intelligence**: Check `intelligenceSource: "real_orders"`

---

**Once configured, OMEN will provide real-time, data-driven inventory intelligence based on actual sales velocity from your Wix store.**
