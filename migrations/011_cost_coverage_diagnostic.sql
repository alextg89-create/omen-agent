-- =============================================================================
-- MIGRATION 011: Cost Coverage Diagnostic + Gap Repair
-- =============================================================================
--
-- PURPOSE:
-- The verified cost match rate was 23.1% (57/247 line items).
-- This migration diagnoses WHY orders aren't matching and provides
-- targeted repairs without touching authoritative cost data.
--
-- ROOT CAUSES:
-- 1. Many orders have unit='unknown' → strain+unit fallback produces no weight key
-- 2. UNMATCHED-* prefixed SKUs (from legacy backfill) lack weight component
-- 3. Product types (gummies, cartridges, edibles) have no cost entries at all
--
-- SAFE: All INSERT are ON CONFLICT DO NOTHING.
-- READ the diagnostic queries first, then run the repair sections.
--
-- =============================================================================


-- =============================================================================
-- STEP 1: DIAGNOSTIC — Understand the unmatched distribution
-- Run this first. Do NOT skip.
-- =============================================================================

-- A. How many orders still have unknown unit?
SELECT
  unit,
  COUNT(*)                                   AS row_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS pct
FROM orders
WHERE order_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY unit
ORDER BY row_count DESC;

-- B. Unmatched orders: why can't they match?
WITH norm AS (
  SELECT
    sku                                       AS cost_sku,
    unit_cost,
    lower(regexp_replace(sku, '[^a-zA-Z0-9]', '', 'g')) AS norm_cost_sku
  FROM sku_costs
)
SELECT
  o.sku                                       AS order_sku,
  o.strain,
  o.unit,
  lower(regexp_replace(o.sku, '[^a-zA-Z0-9]', '', 'g'))  AS norm_order_sku,
  lower(regexp_replace(o.strain || ' ' || o.unit, '[^a-zA-Z0-9]', '', 'g')) AS norm_strain_unit,
  COUNT(o.order_id)                           AS line_items,
  ROUND(SUM(o.price_per_unit * o.quantity), 2) AS revenue,
  -- Can any cost SKU match via containment on order SKU?
  (SELECT COUNT(*) FROM norm n
   WHERE lower(regexp_replace(o.sku, '[^a-zA-Z0-9]', '', 'g'))
         LIKE '%' || n.norm_cost_sku || '%')  AS sku_containment_candidates,
  -- Can any cost SKU match via strain+unit?
  (SELECT COUNT(*) FROM norm n
   WHERE lower(regexp_replace(o.strain || ' ' || o.unit, '[^a-zA-Z0-9]', '', 'g'))
         LIKE '%' || n.norm_cost_sku || '%')  AS strain_unit_candidates
FROM orders o
WHERE o.order_date >= CURRENT_DATE - INTERVAL '30 days'
  AND o.price_per_unit > 0
  AND NOT EXISTS (
    SELECT 1 FROM norm n
    WHERE lower(regexp_replace(o.sku, '[^a-zA-Z0-9]', '', 'g')) LIKE '%' || n.norm_cost_sku || '%'
       OR lower(regexp_replace(o.strain || ' ' || o.unit, '[^a-zA-Z0-9]', '', 'g')) LIKE '%' || n.norm_cost_sku || '%'
  )
GROUP BY o.sku, o.strain, o.unit
ORDER BY revenue DESC
LIMIT 20;


-- C. Full three-step match rate (mirrors JS computeOrderBasedMargin)
WITH norm AS (
  SELECT sku, unit_cost,
    lower(regexp_replace(sku, '[^a-zA-Z0-9]', '', 'g')) AS norm_sku
  FROM sku_costs
)
SELECT
  COUNT(*)                                               AS total_line_items,
  COUNT(CASE WHEN step1.uc IS NOT NULL THEN 1 END)      AS step1_exact,
  COUNT(CASE WHEN step2.uc IS NOT NULL
              AND step1.uc IS NULL     THEN 1 END)      AS step2_containment,
  COUNT(CASE WHEN step3.uc IS NOT NULL
              AND step2.uc IS NULL
              AND step1.uc IS NULL     THEN 1 END)      AS step3_strain_unit,
  COUNT(CASE WHEN COALESCE(step1.uc, step2.uc, step3.uc) IS NOT NULL THEN 1 END) AS total_matched,
  ROUND(
    COUNT(CASE WHEN COALESCE(step1.uc, step2.uc, step3.uc) IS NOT NULL THEN 1 END)
    * 100.0 / NULLIF(COUNT(*), 0)
  , 1)                                                   AS match_pct
FROM orders o
LEFT JOIN LATERAL (
  SELECT n.unit_cost AS uc FROM norm n
  WHERE lower(regexp_replace(o.sku, '[^a-zA-Z0-9]', '', 'g')) = n.norm_sku
  LIMIT 1
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
-- STEP 2: REPAIR — Run backfill_order_units() if not already done
-- This normalizes unit='unknown' rows so the strain+unit path can fire.
-- =============================================================================

SELECT backfill_order_units();

-- Confirm improvement
SELECT
  unit,
  COUNT(*) AS row_count
FROM orders
WHERE order_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY unit
ORDER BY row_count DESC;


-- =============================================================================
-- STEP 3: REPAIR — Re-check match rate after unit normalization
-- Run Step C again here to see improvement.
-- =============================================================================

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
  , 1)                                                   AS match_pct_after_normalization
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
-- STEP 4: REMAINING GAPS — Identify strains that still need cost entries
--
-- After unit normalization the only remaining unmatched SKUs are:
-- - Product types with no cost entries (gummies, cartridges, edibles)
-- - Strains genuinely missing from sku_costs
--
-- Run this to see the gap list, then add entries to sku_costs manually.
-- =============================================================================

WITH norm AS (
  SELECT sku, unit_cost,
    lower(regexp_replace(sku, '[^a-zA-Z0-9]', '', 'g')) AS norm_sku
  FROM sku_costs
),
unmatched AS (
  SELECT
    o.strain,
    o.unit,
    o.sku,
    COUNT(*)                                             AS line_items,
    ROUND(SUM(o.price_per_unit * o.quantity), 2)         AS revenue
  FROM orders o
  WHERE o.order_date >= CURRENT_DATE - INTERVAL '30 days'
    AND o.price_per_unit > 0
    AND o.quantity > 0
    AND NOT EXISTS (
      SELECT 1 FROM norm n
      WHERE lower(regexp_replace(o.sku, '[^a-zA-Z0-9]', '', 'g')) LIKE '%' || n.norm_sku || '%'
         OR lower(regexp_replace(o.strain || ' ' || o.unit, '[^a-zA-Z0-9]', '', 'g'))
            LIKE '%' || n.norm_sku || '%'
    )
  GROUP BY o.strain, o.unit, o.sku
)
SELECT
  strain,
  unit,
  sku,
  line_items,
  revenue,
  -- Suggest a cost SKU format to add to sku_costs
  UPPER(regexp_replace(strain, '[^a-zA-Z0-9]', '', 'g'))
  || '-' || UPPER(unit)                                  AS suggested_cost_sku
FROM unmatched
ORDER BY revenue DESC;
