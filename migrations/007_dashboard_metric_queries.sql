-- =============================================================================
-- OMEN VAULT — Dashboard Metric Queries
-- =============================================================================
-- Run each section independently in Supabase SQL editor.
-- All queries are read-only. No writes.
-- =============================================================================


-- =============================================================================
-- 1. SKUs TRACKED
-- Count distinct SKUs that appeared in orders within the reporting window.
-- Dashboard displays this as "SKUS TRACKED" in the urgent stats row.
-- =============================================================================

SELECT
  COUNT(DISTINCT sku)                                          AS skus_tracked,
  COUNT(DISTINCT order_id)                                     AS total_orders,
  MIN(order_date)::date                                        AS period_start,
  MAX(order_date)::date                                        AS period_end
FROM orders
WHERE order_date >= CURRENT_DATE - INTERVAL '30 days'
  AND price_per_unit > 0
  AND quantity > 0;


-- =============================================================================
-- 2. REVENUE OPPORTUNITY
-- Potential revenue sitting in slow-moving inventory.
-- Slow = no sale in 14+ days, or avg daily velocity ≤ 0.1 units/day.
-- =============================================================================

SELECT
  COUNT(DISTINCT iv.sku)                                       AS slow_sku_count,
  ROUND(SUM(iv.available_quantity * COALESCE(sp.retail, 0)), 2)     AS revenue_opportunity,
  ROUND(SUM(iv.available_quantity * COALESCE(sc.unit_cost, 0)), 2)  AS capital_at_risk
FROM inventory_virtual iv
LEFT JOIN sku_profitability sp   ON sp.sku = iv.sku
LEFT JOIN sku_costs sc           ON sc.sku = iv.sku
LEFT JOIN sold_by_sku sbs        ON sbs.sku = iv.sku
WHERE iv.available_quantity > 0
  AND (
    COALESCE(sbs.avg_daily_velocity, sbs.daily_velocity, 0) <= 0.1
    OR sbs.last_sold_at < CURRENT_DATE - INTERVAL '14 days'
    OR sbs.last_sold_at IS NULL
  );


-- =============================================================================
-- 3. INVENTORY HEALTH BREAKDOWN
-- Classifies every in-stock SKU into: healthy / slow / critical / dead.
--
-- healthy  = selling ≥ 0.5 units/day
-- slow     = selling 0 < v < 0.5 units/day
-- critical = no sale in last 14 days, but sold at some point
-- dead     = never sold, or no sale in 30+ days
-- =============================================================================

SELECT
  SUM(CASE WHEN velocity >= 0.5                                            THEN 1 ELSE 0 END) AS healthy,
  SUM(CASE WHEN velocity > 0   AND velocity < 0.5                         THEN 1 ELSE 0 END) AS slow,
  SUM(CASE WHEN velocity = 0
            AND last_sold_at IS NOT NULL
            AND last_sold_at >= CURRENT_DATE - INTERVAL '30 days'         THEN 1 ELSE 0 END) AS critical,
  SUM(CASE WHEN last_sold_at IS NULL
            OR  last_sold_at < CURRENT_DATE - INTERVAL '30 days'          THEN 1 ELSE 0 END) AS dead,
  COUNT(*)                                                                 AS total
FROM (
  SELECT
    iv.sku,
    COALESCE(sbs.avg_daily_velocity, sbs.daily_velocity, 0)    AS velocity,
    sbs.last_sold_at
  FROM inventory_virtual iv
  LEFT JOIN sold_by_sku sbs ON sbs.sku = iv.sku
  WHERE iv.available_quantity > 0
    AND iv.visible = true
) classified;


-- =============================================================================
-- 4. MARGIN TREND — Weekly
-- Computes realized margin per week directly from orders + sku_costs.
-- Uses two-step SKU join: exact norm match, then containment fallback.
--
-- The dashboard expects: [{date, margin, profit}, ...]
-- mapped to snapshot.metrics.marginTrend
-- =============================================================================

WITH norm AS (
  -- Normalize both sides: lowercase, strip non-alphanumeric
  SELECT
    sku,
    unit_cost,
    LOWER(REGEXP_REPLACE(sku, '[^a-zA-Z0-9]', '', 'g')) AS norm_sku
  FROM sku_costs
),
order_cost AS (
  SELECT
    o.order_id,
    o.order_date,
    o.sku,
    o.strain,
    o.unit,
    o.quantity,
    o.price_per_unit,
    o.price_per_unit * o.quantity                                  AS line_revenue,
    -- Step 1: exact normalized match on full SKU
    -- Step 2: containment match (order SKU contains cost SKU)
    -- Step 3: strain+unit match
    (
      SELECT n.unit_cost
      FROM norm n
      WHERE LOWER(REGEXP_REPLACE(o.sku, '[^a-zA-Z0-9]', '', 'g')) = n.norm_sku
      LIMIT 1
    )
    -- containment fallback
    IS NOT DISTINCT FROM NULL AND (
      SELECT n.unit_cost
      FROM norm n
      WHERE LOWER(REGEXP_REPLACE(o.sku, '[^a-zA-Z0-9]', '', 'g'))
            LIKE '%' || n.norm_sku || '%'
      ORDER BY LENGTH(n.norm_sku) DESC
      LIMIT 1
    ) IS NOT NULL
    -- resolved cost (coalesced in order)
    AS _unused,

    COALESCE(
      -- 1. exact SKU match
      (SELECT n.unit_cost FROM norm n
       WHERE LOWER(REGEXP_REPLACE(o.sku, '[^a-zA-Z0-9]', '', 'g')) = n.norm_sku
       LIMIT 1),
      -- 2. order SKU contains cost SKU (longest match wins)
      (SELECT n.unit_cost FROM norm n
       WHERE LOWER(REGEXP_REPLACE(o.sku, '[^a-zA-Z0-9]', '', 'g'))
             LIKE '%' || n.norm_sku || '%'
       ORDER BY LENGTH(n.norm_sku) DESC
       LIMIT 1),
      -- 3. strain+unit match
      (SELECT n.unit_cost FROM norm n
       WHERE LOWER(REGEXP_REPLACE(o.strain || ' ' || o.unit, '[^a-zA-Z0-9]', '', 'g'))
             LIKE '%' || n.norm_sku || '%'
       ORDER BY LENGTH(n.norm_sku) DESC
       LIMIT 1)
    ) AS unit_cost

  FROM orders o
  WHERE o.order_date >= CURRENT_DATE - INTERVAL '12 weeks'
    AND o.price_per_unit > 0
    AND o.quantity > 0
)
SELECT
  DATE_TRUNC('week', order_date)::date                              AS week_start,
  ROUND(
    SUM((price_per_unit - unit_cost) * quantity)
    / NULLIF(SUM(CASE WHEN unit_cost IS NOT NULL THEN price_per_unit * quantity END), 0)
    * 100
  , 1)                                                              AS margin_percent,
  ROUND(SUM((price_per_unit - unit_cost) * quantity), 2)           AS profit,
  ROUND(SUM(price_per_unit * quantity), 2)                         AS revenue,
  COUNT(DISTINCT order_id)                                          AS orders,
  COUNT(DISTINCT CASE WHEN unit_cost IS NOT NULL THEN sku END)      AS skus_with_cost,
  COUNT(DISTINCT sku)                                               AS skus_total
FROM order_cost
WHERE unit_cost IS NOT NULL
GROUP BY DATE_TRUNC('week', order_date)
ORDER BY week_start ASC;


-- =============================================================================
-- VERIFICATION — Run to confirm data exists in each table before using above
-- =============================================================================

SELECT
  (SELECT COUNT(*) FROM orders
   WHERE order_date >= CURRENT_DATE - INTERVAL '30 days')          AS orders_30d,
  (SELECT COUNT(*) FROM sku_costs)                                  AS cost_skus,
  (SELECT COUNT(*) FROM sku_profitability)                          AS profitability_skus,
  (SELECT COUNT(*) FROM sold_by_sku)                                AS velocity_skus,
  (SELECT COUNT(*) FROM inventory_virtual WHERE available_quantity > 0) AS in_stock_skus;
