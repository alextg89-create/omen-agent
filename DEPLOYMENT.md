# OMEN Deployment Guide

## System Overview

OMEN is now a fully functional inventory intelligence system that:
- Analyzes real order velocity from Supabase
- Generates actionable business insights
- Runs scheduled daily/weekly snapshots
- Provides interactive chat interface
- Delivers value through concrete recommendations

---

## Environment Variables (Required for Railway)

### Supabase Connection (CRITICAL)
```env
OMEN_USE_SUPABASE=true
SUPABASE_URL=https://kaqnpprkwyxqwmumtmmh.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key-here
```

**Why Critical**: Without Supabase, OMEN falls back to static snapshot analysis. Real intelligence requires live order data from Supabase.

### OpenAI (Optional - for chat responses)
```env
OPENAI_API_KEY=sk-your-key-here
```

**Fallback**: Chat works without OpenAI but uses template responses. Recommendations still work.

### Server Configuration
```env
PORT=3000
NODE_ENV=production
```

---

## Railway Deployment Steps

### 1. Configure Environment Variables in Railway

Go to Railway project → Variables → Add all required variables:

```
OMEN_USE_SUPABASE=true
SUPABASE_URL=https://kaqnpprkwyxqwmumtmmh.supabase.co
SUPABASE_SERVICE_KEY=<paste-your-service-key>
OPENAI_API_KEY=<optional>
PORT=3000
```

###  2. Verify Supabase Tables Exist

OMEN expects these tables in Supabase:

**`orders` table** (for velocity analysis):
```sql
CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sku TEXT NOT NULL,
  unit TEXT,
  quantity INTEGER NOT NULL,
  -- Add other Wix webhook fields as needed
  product_name TEXT,
  price DECIMAL(10,2)
);

CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_orders_sku ON orders(sku);
```

**`inventory_live` table** (current state):
```sql
CREATE TABLE inventory_live (
  sku TEXT PRIMARY KEY,
  quantity INTEGER NOT NULL,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL
);
```

**`inventory_snapshots` table** (historical append-only):
```sql
CREATE TABLE inventory_snapshots (
  id BIGSERIAL PRIMARY KEY,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  source TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inventory_snapshots_sku ON inventory_snapshots(sku);
CREATE INDEX idx_inventory_snapshots_recorded_at ON inventory_snapshots(recorded_at);
```

### 3. Deploy to Railway

Railway will automatically:
- Deploy the application from `main` branch
- Read `railway.toml` for cron configuration
- Start scheduled jobs:
  - **Daily snapshot**: 8 AM EST (1 PM UTC) every day
  - **Weekly snapshot**: Monday 9 AM EST (2 PM UTC)

### 4. Verify Deployment

After deployment, check:

1. **Server Health**:
   ```bash
   curl https://your-railway-domain.up.railway.app/health
   ```

2. **Supabase Connection**:
   ```bash
   curl https://your-railway-domain.up.railway.app/supabase/status
   ```
   Should return: `{"ok": true, "configured": true, "connected": true}`

3. **Chat Endpoint**:
   ```bash
   curl -X POST https://your-railway-domain.up.railway.app/chat \
     -H "Content-Type: application/json" \
     -d '{"message": "What should I promote?"}'
   ```

4. **Snapshot Generation**:
   ```bash
   curl -X POST https://your-railway-domain.up.railway.app/snapshot/generate \
     -H "Content-Type: application/json" \
     -d '{"timeframe": "weekly"}'
   ```

---

## How OMEN Works Now

### Data Flow

```
Wix Store
    ↓
Make.com Webhook
    ↓
Supabase (orders table) ← CSV Upload (inventory state)
    ↓                           ↓
Order Velocity Analyzer    Inventory Store
    ↓                           ↓
Temporal Intelligence Engine ←──┘
    ↓
Actionable Insights
    ↓
┌─────────────────┬──────────────────┬─────────────────┐
│   Chat UI       │   Snapshots      │   Cron Jobs     │
│ (Real-time Q&A) │ (Manual/Scheduled│ (Automated)     │
└─────────────────┴──────────────────┴─────────────────┘
```

### Intelligence Sources (Priority Order)

1. **REAL ORDER DATA** (Best) - Supabase orders table
   - Calculates daily velocity per SKU
   - Predicts stockout dates
   - Detects accelerating demand
   - Identifies dead stock

2. **SNAPSHOT DELTAS** (Fallback) - Cached JSON comparisons
   - Used when Supabase unavailable
   - Less accurate, but better than nothing

3. **STATIC RULES** (Last Resort) - Generic margin/stock rules
   - Only if no other data available
   - Not actionable, just informational

### Example Insights Generated

**HIGH Priority** (Urgent Actions):
- "Bloopiez Eighth will stock out in 3 days - Currently 45 units, selling 15/day"
- "Cookies Gram has 8 days of stock left with 67% margin - Reorder immediately"

**MEDIUM Priority** (Opportunities):
- "Cherry Pie Half is selling 2.3x faster than average - Sold 34 units in 7 days"
- "Sherbert Quarter demand is accelerating - Order velocity increased 40% in recent period"

**LOW Priority** (Observations):
- "Diesel Preroll had zero sales this period - 23 units in stock tying up capital"

---

## Scheduled Jobs

### Daily Snapshot (8 AM EST)
- Analyzes previous 24 hours
- Identifies urgent stockouts
- Stores snapshot for historical comparison
- Endpoint: `POST /cron/daily-snapshot`

### Weekly Snapshot (Monday 9 AM EST)
- Analyzes previous 7 days
- Full velocity analysis across all SKUs
- Generates comprehensive business insights
- Endpoint: `POST /cron/weekly-snapshot`
- **Future**: Will auto-email owner

---

## Using the Admin UI

Access: `https://your-railway-domain.up.railway.app`

### Chat Tab
1. Click "Chat" in navigation
2. Ask questions like:
   - "What should I promote this week?"
   - "Show me items that might stock out soon"
   - "What's selling fastest?"
3. OMEN responds with real data-backed insights

### Snapshot Tab
1. Select timeframe (daily/weekly)
2. Optional: Choose historical date
3. Click "Generate Snapshot"
4. Review insights in preview
5. Click "Send Snapshot Now" to prepare email (delivery TBD)

---

## Troubleshooting

### "No order data available"

**Cause**: Supabase not connected or no orders in date range

**Fix**:
1. Check environment variables in Railway
2. Verify `OMEN_USE_SUPABASE=true`
3. Test Supabase connection: `GET /supabase/status`
4. Check if orders exist: Query Supabase `orders` table directly

### "Snapshot using fallback intelligence"

**Cause**: Supabase unavailable, using snapshot deltas instead

**Fix**:
1. Configure Supabase (see above)
2. Ensure orders are flowing from Wix → Make.com → Supabase
3. Verify date range has orders (check Supabase directly)

### Chat not responding

**Cause**: OpenAI key missing (non-critical)

**Behavior**: Chat still works with template responses
**Fix**: Add `OPENAI_API_KEY` for natural language responses (optional)

### Cron jobs not running

**Cause**: Railway cron not configured

**Fix**:
1. Ensure `railway.toml` exists in repo root
2. Check Railway dashboard → Deployments → Cron Jobs
3. Verify cron syntax is correct (currently 8 AM & 9 AM EST)
4. Manually trigger: `curl -X POST https://your-domain/cron/weekly-snapshot`

---

## Testing the System End-to-End

### 1. Verify Order Ingestion
```bash
# Check if orders are in Supabase
curl https://kaqnpprkwyxqwmumtmmh.supabase.co/rest/v1/orders \
  -H "apikey: your-anon-key" \
  -H "Authorization: Bearer your-anon-key"
```

### 2. Generate Snapshot Manually
```bash
curl -X POST https://your-domain/snapshot/generate \
  -H "Content-Type: application/json" \
  -d '{"timeframe": "weekly"}'
```

### 3. Check for Real Intelligence
Look for in response:
```json
{
  "temporal": {
    "intelligenceSource": "real_orders",  // Should be this, not "snapshot_deltas"
    "hasRealData": true
  },
  "velocity": {
    "orderCount": 47,  // Should have actual order count
    "uniqueSKUs": 12,
    "insights": [...]  // Array of actionable insights
  }
}
```

### 4. Test Chat
```bash
curl -X POST https://your-domain/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What should I promote this week?"}'
```

---

## What Changed

### Before This Fix
- ❌ Chat UI didn't exist
- ❌ Snapshots used identical cached data (no temporal analysis)
- ❌ No scheduled jobs
- ❌ Supabase connected but never queried
- ❌ Recommendations were generic ("High margin, promote")
- ❌ Email just returned JSON, didn't actually send
- ❌ No business value - owner couldn't act on anything

### After This Fix
- ✅ Full chat interface with real-time Q&A
- ✅ Analyzes real Supabase order data
- ✅ Railway cron jobs running daily/weekly
- ✅ Queries orders by date range for velocity analysis
- ✅ Insights like "stocks out in 4 days", "selling 3x faster"
- ✅ Email formatted for actionable insights
- ✅ Owner gets concrete actions: reorder now, promote this, discount that

---

## Next Steps (Optional Enhancements)

1. **SendGrid Integration** (email delivery)
   - Add SendGrid API key to environment
   - Install `@sendgrid/mail` package
   - Auto-email weekly snapshot to owner

2. **Slack/Discord Webhooks** (urgent alerts)
   - Send HIGH priority insights to Slack channel
   - Owner gets notified of imminent stockouts

3. **Historical Trend Charts** (UI enhancement)
   - Show velocity over time
   - Graph depletion curves
   - Visual stockout predictions

4. **Multi-Store Support** (scalability)
   - Support multiple Wix stores
   - Comparative analysis across stores

---

## Support

**Issues**: Report at https://github.com/alextg89-create/omen-agent/issues
**Logs**: Check Railway deployment logs for debugging
**Database**: Query Supabase directly to verify data flow

---

**OMEN is now a calm, competent operator that runs your business intelligence quietly and correctly in the background.**
