# DEPLOYMENT FIX - RAILWAY ENVIRONMENT

## PROBLEM
Railway deployment shows `promotions: 0` because velocity analysis is failing.

## ROOT CAUSE
Missing or incorrect `SUPABASE_SERVICE_KEY` in Railway environment variables.

The `orders` table query requires service_role permissions because:
- Anon key has Row Level Security (RLS) restrictions
- Orders table may have RLS enabled blocking anon reads
- Service key bypasses RLS for backend operations

## FIX STEPS

### 1. Get Supabase Service Key
1. Go to: https://supabase.com/dashboard/project/kaqnpprkwyxqwmumtmmh/settings/api
2. Copy the `service_role` key (NOT the anon key)
3. This key should start with: `eyJhbGc...` and be much longer than anon key

### 2. Add to Railway
1. Go to: Railway dashboard → omen-agent project → Variables
2. Add new variable:
   - Name: `SUPABASE_SERVICE_KEY`
   - Value: (paste the service_role key from step 1)
3. Save and redeploy

### 3. Verify Fix
After redeployment:
1. Generate new snapshot (Daily or Weekly)
2. Check Deploy Logs for:
   ```
   [TemporalAnalyzer] Found X orders in timeframe
   [OMEN] Using REAL order-based intelligence
   promotions: 1 (or more)
   ```

## EXPECTED RESULTS AFTER FIX

**Daily Snapshot:**
- Should show 0-1 promotion (only if recent 24h has matched orders)
- Example: "Bloopiez" if sold in last 24h with matching SKU

**Weekly Snapshot:**
- Should show 1-2 promotions:
  - Bloopiez (0.86 units/day) - HIGH VELOCITY
  - Possibly: Tangerine Cookies, Blue Nerdz (if above 0.5 threshold)

## IF STILL BROKEN AFTER SERVICE KEY

Check Deploy Logs for:
```
[TemporalAnalyzer] Orders table not available
[TemporalAnalyzer] No order data available
```

If this appears, the problem is RLS on orders table.

### Disable RLS on Orders Table:
Run in Supabase SQL Editor:
```sql
ALTER TABLE public.orders DISABLE ROW LEVEL SECURITY;
```

This allows backend service key to read orders without policy restrictions.

## VERIFICATION QUERY

Test in Supabase SQL Editor:
```sql
SELECT COUNT(*) FROM public.orders;
```

Should return: 32

If it returns 0 or error → RLS is blocking reads.
