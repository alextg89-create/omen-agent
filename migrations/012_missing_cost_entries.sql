-- =============================================================================
-- MIGRATION 012: Add Missing Cost Entries for Unmatched SKUs
-- =============================================================================
--
-- SOURCE: Gap list from migration 011 diagnostic (Step 4 output).
--
-- These SKUs appeared in orders but had NO matching cost entry:
--   bubble_hash_1g        — Bubble Hash sold by the gram (premium product)
--   faded_gummies         — Faded brand gummies (edible)
--   afghani_hash_unknown  — Afghani Hash (unit needs normalizing via 008)
--   sauce_bars_1g         — Sauce Bars 1g disposable
--   peach_ringz_*         — Peach Ringz (strain, needs weight cost entries)
--   silly_gummies         — Silly brand gummies
--
-- INSTRUCTIONS:
--   1. Replace the unit_cost values below with YOUR actual wholesale costs.
--   2. Each INSERT uses ON CONFLICT DO NOTHING — safe to run multiple times.
--   3. After inserting, re-run migration 011 Step C/3 to verify match rate.
--
-- NOTE: Entries marked "ESTIMATE" below are PLACEHOLDERS derived from order
-- prices. You MUST update them to actual wholesale costs before relying on
-- margin analytics for these SKUs.
--
-- =============================================================================


-- =============================================================================
-- BUBBLE HASH — premium hash sold per gram
-- Observed avg retail: ~$600 per order (6 line items total)
-- =============================================================================

INSERT INTO sku_costs (sku, unit_cost, effective_date, source) VALUES
  ('BUBBLE HASH-1G',   12.00, NOW(), 'manual_estimate_REPLACE'),
  ('BUBBLE HASH-2G',   22.00, NOW(), 'manual_estimate_REPLACE'),
  ('BUBBLE HASH-3.5G', 35.00, NOW(), 'manual_estimate_REPLACE'),
  ('BUBBLE HASH-7G',   65.00, NOW(), 'manual_estimate_REPLACE'),
  ('BUBBLE HASH-14G', 120.00, NOW(), 'manual_estimate_REPLACE'),
  ('BUBBLE HASH-28G', 220.00, NOW(), 'manual_estimate_REPLACE')
ON CONFLICT (sku) DO NOTHING;


-- =============================================================================
-- AFGHANI HASH — similar category to Bubble Hash
-- =============================================================================

INSERT INTO sku_costs (sku, unit_cost, effective_date, source) VALUES
  ('AFGHANI HASH-1G',   10.00, NOW(), 'manual_estimate_REPLACE'),
  ('AFGHANI HASH-2G',   18.00, NOW(), 'manual_estimate_REPLACE'),
  ('AFGHANI HASH-3.5G', 30.00, NOW(), 'manual_estimate_REPLACE'),
  ('AFGHANI HASH-7G',   55.00, NOW(), 'manual_estimate_REPLACE'),
  ('AFGHANI HASH-14G', 100.00, NOW(), 'manual_estimate_REPLACE'),
  ('AFGHANI HASH-28G', 180.00, NOW(), 'manual_estimate_REPLACE')
ON CONFLICT (sku) DO NOTHING;


-- =============================================================================
-- SAUCE BARS — 1g disposable vape
-- =============================================================================

INSERT INTO sku_costs (sku, unit_cost, effective_date, source) VALUES
  ('SAUCE BARS-1G',     18.00, NOW(), 'manual_estimate_REPLACE'),
  ('SAUCE BARS-2G',     32.00, NOW(), 'manual_estimate_REPLACE')
ON CONFLICT (sku) DO NOTHING;


-- =============================================================================
-- PEACH RINGZ — strain, needs all weight tiers
-- =============================================================================

INSERT INTO sku_costs (sku, unit_cost, effective_date, source) VALUES
  ('PEACH RINGZ-3.5G',  7.00, NOW(), 'manual_estimate_REPLACE'),
  ('PEACH RINGZ-7G',   13.00, NOW(), 'manual_estimate_REPLACE'),
  ('PEACH RINGZ-14G',  25.00, NOW(), 'manual_estimate_REPLACE'),
  ('PEACH RINGZ-28G',  50.00, NOW(), 'manual_estimate_REPLACE')
ON CONFLICT (sku) DO NOTHING;


-- =============================================================================
-- FADED GUMMIES — edible product
-- Observed avg retail: ~$178/order (8 line items)
-- =============================================================================

INSERT INTO sku_costs (sku, unit_cost, effective_date, source) VALUES
  ('FADED GUMMIES',     15.00, NOW(), 'manual_estimate_REPLACE'),
  ('FADED-GUMMIES',     15.00, NOW(), 'manual_estimate_REPLACE')
ON CONFLICT (sku) DO NOTHING;


-- =============================================================================
-- SILLY GUMMIES — edible product
-- =============================================================================

INSERT INTO sku_costs (sku, unit_cost, effective_date, source) VALUES
  ('SILLY GUMMIES',     12.00, NOW(), 'manual_estimate_REPLACE'),
  ('SILLY-GUMMIES',     12.00, NOW(), 'manual_estimate_REPLACE')
ON CONFLICT (sku) DO NOTHING;


-- =============================================================================
-- VERIFICATION — confirm entries were inserted and check new match rate
-- =============================================================================

-- 1. Show just-inserted entries
SELECT sku, unit_cost, source
FROM sku_costs
WHERE source = 'manual_estimate_REPLACE'
ORDER BY sku;

-- 2. Re-check cost match rate (full three-step resolver)
WITH norm AS (
  SELECT sku, unit_cost,
    lower(regexp_replace(sku, '[^a-zA-Z0-9]', '', 'g')) AS norm_sku
  FROM sku_costs
)
SELECT
  COUNT(*)                                               AS total_line_items,
  COUNT(CASE WHEN COALESCE(step1.uc, step2.uc, step3.uc) IS NOT NULL THEN 1 END) AS matched,
  ROUND(
    COUNT(CASE WHEN COALESCE(step1.uc, step2.uc, step3.uc) IS NOT NULL THEN 1 END)
    * 100.0 / NULLIF(COUNT(*), 0)
  , 1)                                                   AS match_pct
FROM orders o
LEFT JOIN LATERAL (
  SELECT n.unit_cost AS uc FROM norm n
  WHERE lower(regexp_replace(o.sku, '[^a-zA-Z0-9]', '', 'g')) = n.norm_sku LIMIT 1
) step1 ON TRUE
LEFT JOIN LATERAL (
  SELECT n.unit_cost AS uc FROM norm n
  WHERE lower(regexp_replace(o.sku, '[^a-zA-Z0-9]', '', 'g'))
        LIKE '%' || n.norm_sku || '%'
  ORDER BY length(n.norm_sku) DESC LIMIT 1
) step2 ON TRUE
LEFT JOIN LATERAL (
  SELECT n.unit_cost AS uc FROM norm n
  WHERE lower(regexp_replace(o.strain || ' ' || o.unit, '[^a-zA-Z0-9]', '', 'g'))
        LIKE '%' || n.norm_sku || '%'
  ORDER BY length(n.norm_sku) DESC LIMIT 1
) step3 ON TRUE
WHERE o.order_date >= CURRENT_DATE - INTERVAL '30 days'
  AND o.price_per_unit > 0
  AND o.quantity > 0;


-- =============================================================================
-- REMINDER: Update unit_cost values for all rows with source = 'manual_estimate_REPLACE'
-- after verifying actual wholesale costs:
--
--   UPDATE sku_costs SET unit_cost = <actual>, source = 'verified', effective_date = NOW()
--   WHERE source = 'manual_estimate_REPLACE' AND sku = '<SKU>';
--
-- =============================================================================
