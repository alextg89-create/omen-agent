-- =============================================================================
-- MIGRATION 010: OMEN Pipeline Verification Queries
-- =============================================================================
--
-- Run each section to verify the full analytics pipeline is healthy.
-- All queries are READ-ONLY.
--
-- Expected passing results:
--   orders_30d         > 0
--   unit_unknown_pct   < 5%
--   cost_match_pct     > 70%
--   velocity_skus      > 0
--   in_stock_skus      > 0
--   margin_trend rows  > 0
--
-- =============================================================================


-- =============================================================================
-- 1. PIPELINE HEALTH SNAPSHOT
--    One row that tells you whether every layer of the pipeline has data.
-- =============================================================================

SELECT
  -- Layer 1: Raw ingestion
  (SELECT COUNT(*) FROM webhook_events
   WHERE received_at >= CURRENT_DATE - INTERVAL '30 days')          AS webhooks_30d,

  -- Layer 2: Order sync
  (SELECT COUNT(*) FROM orders
   WHERE order_date >= CURRENT_DATE - INTERVAL '30 days'
     AND price_per_unit > 0 AND quantity > 0)                       AS orders_30d,

  -- Layer 3: SKU coverage
  (SELECT COUNT(DISTINCT sku) FROM orders
   WHERE order_date >= CURRENT_DATE - INTERVAL '30 days')           AS distinct_order_skus,

  -- Layer 4: Cost data
  (SELECT COUNT(*) FROM sku_costs)                                   AS cost_skus,

  -- Layer 5: Inventory
  (SELECT COUNT(*) FROM inventory_virtual
   WHERE available_qty > 0)                                          AS in_stock_skus,

  -- Layer 6: Velocity
  (SELECT COUNT(*) FROM sold_by_sku)                                 AS velocity_skus,

  -- Layer 7: Profitability view
  (SELECT COUNT(*) FROM sku_profitability)                           AS profitability_skus;


-- =============================================================================
-- 2. UNIT DISTRIBUTION
--    Shows the breakdown of orders.unit values.
--    Goal: 'unknown' < 5% of rows.
-- =============================================================================

SELECT
  unit,
  COUNT(*)                                                           AS row_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1)               AS pct
FROM orders
WHERE order_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY unit
ORDER BY row_count DESC;


-- =============================================================================
-- 3. COST MATCH RATE
--    Three-step join mirrors JS normKey() containment logic.
--    Goal: match_pct > 70%.
-- =============================================================================

WITH norm AS (
  SELECT
    sku,
    unit_cost,
    lower(regexp_replace(sku, '[^a-zA-Z0-9]', '', 'g')) AS norm_sku
  FROM sku_costs
),
matched AS (
  SELECT
    o.order_id,
    o.sku,
    o.strain,
    o.unit,
    -- Step 1: exact normalized match
    (SELECT n.unit_cost FROM norm n
     WHERE lower(regexp_replace(o.sku, '[^a-zA-Z0-9]', '', 'g')) = n.norm_sku
     LIMIT 1)                                                        AS cost_exact,
    -- Step 2: containment (order SKU contains cost SKU)
    (SELECT n.unit_cost FROM norm n
     WHERE lower(regexp_replace(o.sku, '[^a-zA-Z0-9]', '', 'g'))
           LIKE '%' || n.norm_sku || '%'
     ORDER BY length(n.norm_sku) DESC
     LIMIT 1)                                                        AS cost_contain,
    -- Step 3: strain + unit containment
    (SELECT n.unit_cost FROM norm n
     WHERE lower(regexp_replace(o.strain || ' ' || o.unit, '[^a-zA-Z0-9]', '', 'g'))
           LIKE '%' || n.norm_sku || '%'
     ORDER BY length(n.norm_sku) DESC
     LIMIT 1)                                                        AS cost_strain_unit
  FROM orders o
  WHERE o.order_date >= CURRENT_DATE - INTERVAL '30 days'
    AND o.price_per_unit > 0
    AND o.quantity > 0
)
SELECT
  COUNT(*)                                                           AS total_line_items,

  COUNT(CASE WHEN cost_exact     IS NOT NULL THEN 1 END)            AS matched_exact,
  COUNT(CASE WHEN cost_contain   IS NOT NULL
              AND cost_exact     IS NULL     THEN 1 END)            AS matched_containment,
  COUNT(CASE WHEN cost_strain_unit IS NOT NULL
              AND cost_contain   IS NULL
              AND cost_exact     IS NULL     THEN 1 END)            AS matched_strain_unit,

  COUNT(CASE WHEN COALESCE(cost_exact, cost_contain, cost_strain_unit)
               IS NOT NULL THEN 1 END)                              AS total_matched,

  ROUND(
    COUNT(CASE WHEN COALESCE(cost_exact, cost_contain, cost_strain_unit)
                 IS NOT NULL THEN 1 END)
    * 100.0 / NULLIF(COUNT(*), 0)
  , 1)                                                              AS match_pct,

  COUNT(CASE WHEN COALESCE(cost_exact, cost_contain, cost_strain_unit)
               IS NULL THEN 1 END)                                  AS unmatched,

  -- Top 5 unmatched SKUs (helps identify gaps in sku_costs)
  (SELECT string_agg(DISTINCT sku, ', ' ORDER BY sku)
   FROM (
     SELECT m2.sku FROM matched m2
     WHERE COALESCE(m2.cost_exact, m2.cost_contain, m2.cost_strain_unit) IS NULL
     LIMIT 10
   ) sub)                                                           AS sample_unmatched_skus
FROM matched;


-- =============================================================================
-- 4. VELOCITY METRICS
--    Confirms sold_by_sku (or equivalent view) is populated.
-- =============================================================================

SELECT
  COUNT(*)                                                           AS total_tracked_skus,
  COUNT(CASE WHEN COALESCE(avg_daily_velocity, daily_velocity, 0) >= 0.5 THEN 1 END) AS healthy,
  COUNT(CASE WHEN COALESCE(avg_daily_velocity, daily_velocity, 0) BETWEEN 0.01 AND 0.49 THEN 1 END) AS slow,
  COUNT(CASE WHEN COALESCE(avg_daily_velocity, daily_velocity, 0) = 0 THEN 1 END) AS zero_velocity,
  ROUND(AVG(COALESCE(avg_daily_velocity, daily_velocity, 0))::numeric, 3) AS avg_velocity,
  MAX(last_sold_at)::date                                            AS most_recent_sale
FROM sold_by_sku;


-- =============================================================================
-- 5. MARGIN TREND (12 weeks)
--    Mirrors the JS computeOrderBasedMargin() three-step cost join.
--    Goal: at least 8 weeks of data with margin_percent > 0.
-- =============================================================================

WITH norm AS (
  SELECT
    sku,
    unit_cost,
    lower(regexp_replace(sku, '[^a-zA-Z0-9]', '', 'g')) AS norm_sku
  FROM sku_costs
),
order_cost AS (
  SELECT
    o.order_date,
    o.quantity,
    o.price_per_unit,
    COALESCE(
      -- 1. exact
      (SELECT n.unit_cost FROM norm n
       WHERE lower(regexp_replace(o.sku, '[^a-zA-Z0-9]', '', 'g')) = n.norm_sku
       LIMIT 1),
      -- 2. containment on sku
      (SELECT n.unit_cost FROM norm n
       WHERE lower(regexp_replace(o.sku, '[^a-zA-Z0-9]', '', 'g'))
             LIKE '%' || n.norm_sku || '%'
       ORDER BY length(n.norm_sku) DESC LIMIT 1),
      -- 3. strain+unit
      (SELECT n.unit_cost FROM norm n
       WHERE lower(regexp_replace(o.strain || ' ' || o.unit, '[^a-zA-Z0-9]', '', 'g'))
             LIKE '%' || n.norm_sku || '%'
       ORDER BY length(n.norm_sku) DESC LIMIT 1)
    ) AS unit_cost
  FROM orders o
  WHERE o.order_date >= CURRENT_DATE - INTERVAL '12 weeks'
    AND o.price_per_unit > 0
    AND o.quantity > 0
)
SELECT
  DATE_TRUNC('week', order_date)::date                              AS week_start,
  COUNT(*)                                                          AS line_items,
  COUNT(CASE WHEN unit_cost IS NOT NULL THEN 1 END)                AS with_cost,
  ROUND(SUM(price_per_unit * quantity), 2)                         AS revenue,
  ROUND(SUM(CASE WHEN unit_cost IS NOT NULL
    THEN (price_per_unit - unit_cost) * quantity END), 2)          AS profit,
  ROUND(
    SUM(CASE WHEN unit_cost IS NOT NULL
      THEN (price_per_unit - unit_cost) * quantity END)
    / NULLIF(SUM(CASE WHEN unit_cost IS NOT NULL
      THEN price_per_unit * quantity END), 0)
    * 100
  , 1)                                                             AS margin_pct
FROM order_cost
GROUP BY DATE_TRUNC('week', order_date)
ORDER BY week_start ASC;


-- =============================================================================
-- 6. INVENTORY HEALTH BREAKDOWN
--    Classifies every in-stock SKU into healthy / slow / critical / dead.
-- =============================================================================

SELECT
  SUM(CASE WHEN velocity >= 0.5                           THEN 1 ELSE 0 END) AS healthy,
  SUM(CASE WHEN velocity > 0 AND velocity < 0.5           THEN 1 ELSE 0 END) AS slow,
  SUM(CASE WHEN velocity = 0
            AND last_sold_at IS NOT NULL
            AND last_sold_at >= CURRENT_DATE - INTERVAL '30 days'
                                                           THEN 1 ELSE 0 END) AS critical,
  SUM(CASE WHEN last_sold_at IS NULL
            OR last_sold_at < CURRENT_DATE - INTERVAL '30 days'
                                                           THEN 1 ELSE 0 END) AS dead,
  COUNT(*)                                                AS total_in_stock
FROM (
  SELECT
    iv.sku,
    COALESCE(sbs.avg_daily_velocity, sbs.daily_velocity, 0) AS velocity,
    sbs.last_sold_at
  FROM inventory_virtual iv
  LEFT JOIN sold_by_sku sbs ON sbs.sku = iv.sku
  WHERE iv.available_qty > 0
    AND iv.visible = true
) classified;


-- =============================================================================
-- 7. REVENUE OPPORTUNITY (slow + dead inventory)
-- =============================================================================

SELECT
  COUNT(DISTINCT iv.sku)                                            AS slow_sku_count,
  ROUND(SUM(iv.available_qty * COALESCE(sp.retail, 0)), 2)         AS revenue_opportunity,
  ROUND(SUM(iv.available_qty * COALESCE(sc.unit_cost, 0)), 2)      AS capital_at_risk
FROM inventory_virtual iv
LEFT JOIN sku_profitability sp   ON sp.sku = iv.sku
LEFT JOIN sku_costs sc           ON sc.sku = iv.sku
LEFT JOIN sold_by_sku sbs        ON sbs.sku = iv.sku
WHERE iv.available_qty > 0
  AND (
    COALESCE(sbs.avg_daily_velocity, sbs.daily_velocity, 0) <= 0.1
    OR sbs.last_sold_at < CURRENT_DATE - INTERVAL '14 days'
    OR sbs.last_sold_at IS NULL
  );


-- =============================================================================
-- 8. TOP 10 SKUs BY REVENUE (last 30 days) — confirms SKU tracking
-- =============================================================================

SELECT
  sku,
  strain,
  unit,
  SUM(quantity)                                                      AS units_sold,
  ROUND(SUM(price_per_unit * quantity), 2)                          AS revenue,
  COUNT(DISTINCT order_id)                                           AS orders
FROM orders
WHERE order_date >= CURRENT_DATE - INTERVAL '30 days'
  AND price_per_unit > 0
  AND quantity > 0
GROUP BY sku, strain, unit
ORDER BY revenue DESC
LIMIT 10;


-- =============================================================================
-- 9. DECISION CLASSIFIER INPUTS
--    What the JS classifier would see for top movers.
-- =============================================================================

SELECT
  iv.sku,
  iv.product_name                                                    AS strain,
  iv.variant_name                                                    AS unit,
  iv.available_qty                                                   AS qty_on_hand,
  COALESCE(sbs.avg_daily_velocity, sbs.daily_velocity, 0)           AS daily_velocity,
  CASE
    WHEN COALESCE(sbs.avg_daily_velocity, sbs.daily_velocity, 0) > 0
    THEN ROUND(iv.available_qty
           / COALESCE(sbs.avg_daily_velocity, sbs.daily_velocity, 1), 0)
    ELSE NULL
  END                                                               AS days_of_coverage,
  sbs.last_sold_at::date                                            AS last_sale,
  CURRENT_DATE - sbs.last_sold_at::date                             AS days_since_last_sale,
  sc.unit_cost,
  ROUND(iv.available_qty * COALESCE(sc.unit_cost, 0), 2)           AS capital_at_risk,
  CASE
    WHEN COALESCE(sbs.avg_daily_velocity, 0) >= 0.5
         AND ROUND(iv.available_qty / NULLIF(sbs.avg_daily_velocity, 0), 0) <= 10
      THEN 'RESTOCK'
    WHEN COALESCE(sbs.avg_daily_velocity, 0) = 0
         AND (sbs.last_sold_at IS NULL OR sbs.last_sold_at < CURRENT_DATE - 30)
      THEN 'DEAD'
    WHEN COALESCE(sbs.avg_daily_velocity, 0) < 0.1
         AND iv.available_qty * COALESCE(sc.unit_cost, 0) > 500
      THEN 'CAPITAL_AT_RISK'
    WHEN COALESCE(sbs.avg_daily_velocity, 0) < 0.1
      THEN 'SLOW'
    ELSE 'HEALTHY'
  END                                                               AS status
FROM inventory_virtual iv
LEFT JOIN sold_by_sku   sbs ON sbs.sku = iv.sku
LEFT JOIN sku_costs     sc  ON sc.sku  = iv.sku
WHERE iv.available_qty > 0
  AND iv.visible = true
ORDER BY daily_velocity DESC, capital_at_risk DESC
LIMIT 20;
