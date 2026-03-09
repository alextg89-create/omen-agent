-- =============================================================================
-- MIGRATION 008: Normalize orders.unit column
-- =============================================================================
--
-- PURPOSE:
-- The orders.unit column contains inconsistent values that break cost matching:
--   - 'Unknown' / 'unknown'
--   - 'unit' (the literal word, not a measurement)
--   - '28 G', '3.5 G' (space before G)
--   - 'Eighth', 'Quarter', 'Half', '1/8', '1/4', '1/2'
--   - '1G Disposable', '2G Flavored' (weight + descriptor)
--   - 'Cartridge', 'Cart', 'Gummies', 'Disposable', 'Pre-Roll'
--
-- CANONICAL OUTPUT FORMS:
--   Weight:       '3.5g', '7g', '14g', '28g', '1g', '2g'
--   Product type: 'cartridge', 'gummies', 'preroll'
--   No data:      'unknown'
--
-- SAFE:
--   - Idempotent: safe to run multiple times
--   - All normalization is deterministic
--   - Does NOT touch any other table
--   - backfill_order_units() can be called on a schedule
--
-- =============================================================================


-- =============================================================================
-- STEP 1: Create normalize_unit() helper function
-- =============================================================================

CREATE OR REPLACE FUNCTION normalize_unit(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  u text;
BEGIN
  -- NULL or empty → unknown
  IF raw IS NULL OR trim(raw) = '' THEN
    RETURN 'unknown';
  END IF;

  u := lower(trim(raw));

  -- Literal 'unit' / 'units' is not a measurement
  IF u IN ('unit', 'units') THEN
    RETURN 'unknown';
  END IF;

  -- ── Weight normalization ─────────────────────────────────────────────────

  -- Collapse space between number and g: '28 g' → '28g', '3.5 g' → '3.5g'
  u := regexp_replace(u, '(\d+\.?\d*)\s+g(\b|$)', '\1g', 'gi');

  -- Fraction forms
  u := regexp_replace(u, '^\s*1\s*/\s*8\s*$', '3.5g');
  u := regexp_replace(u, '^\s*1\s*/\s*4\s*$', '7g');
  u := regexp_replace(u, '^\s*1\s*/\s*2\s*$', '14g');
  u := regexp_replace(u, '^\s*(1\s*oz|one\s*oz|1\s*ounce|ounce)\s*$', '28g', 'i');

  -- Word synonyms (whole-string match — won't mangle 'quarter pounder' etc.)
  u := regexp_replace(u, '^eighths?$', '3.5g');
  u := regexp_replace(u, '^quarters?$', '7g');
  u := regexp_replace(u, '^half$', '14g');
  u := regexp_replace(u, '^ounces?$', '28g');

  -- Strip trailing descriptor after a recognized weight prefix
  -- '1g disposable' → '1g',  '2g flavored' → '2g',  '3.5g pre-roll' → '3.5g'
  u := regexp_replace(u, '^(\d+\.?\d*g)\s+\S.*$', '\1');

  -- ── Product-type detection ───────────────────────────────────────────────
  IF u ~* 'cart' THEN RETURN 'cartridge'; END IF;
  IF u ~* 'gumm' THEN RETURN 'gummies';   END IF;
  -- disposables are sold as 1g units; 'disposable' alone maps to 1g
  IF u ~* '^disposable$' THEN RETURN '1g'; END IF;
  IF u ~* '(pre.?roll|preroll|^roll$)' THEN RETURN 'preroll'; END IF;

  -- ── Clean canonical weight ───────────────────────────────────────────────
  IF u ~ '^\d+\.?\d*g$' THEN RETURN u; END IF;

  -- Everything else: return lowercased as-is (better than 'unknown' for debug)
  RETURN u;
END;
$$;


-- =============================================================================
-- STEP 2: One-time normalization of all existing rows
-- =============================================================================

-- Preview (uncomment to verify before running the UPDATE):
/*
SELECT
  unit                   AS current_unit,
  normalize_unit(unit)   AS normalized_unit,
  COUNT(*)               AS row_count
FROM orders
GROUP BY unit, normalize_unit(unit)
ORDER BY row_count DESC;
*/

UPDATE orders
SET unit = normalize_unit(unit)
WHERE unit IS DISTINCT FROM normalize_unit(unit);


-- =============================================================================
-- STEP 3: Create backfill_order_units() — reusable repair function
--
-- Runs two passes:
--   Pass 1  normalize_unit() on every row (idempotent)
--   Pass 2  for rows still 'unknown', try extracting weight / type from strain
-- =============================================================================

CREATE OR REPLACE FUNCTION backfill_order_units()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  pass1 integer := 0;
  pass2 integer := 0;
BEGIN
  -- ── Pass 1: Apply normalize_unit() to all rows ───────────────────────────
  UPDATE orders
  SET    unit = normalize_unit(unit)
  WHERE  unit IS DISTINCT FROM normalize_unit(unit);
  GET DIAGNOSTICS pass1 = ROW_COUNT;

  -- ── Pass 2: For still-unknown, extract from strain ───────────────────────
  WITH strain_extraction AS (
    SELECT
      id,
      CASE
        -- Explicit weight tokens in strain string
        WHEN strain ~* '\m28\s*g\M'   THEN '28g'
        WHEN strain ~* '\m14\s*g\M'   THEN '14g'
        WHEN strain ~* '\m7\s*g\M'    THEN '7g'
        WHEN strain ~* '\m3\.5\s*g\M' THEN '3.5g'
        WHEN strain ~* '\m1\s*g\M'    THEN '1g'
        WHEN strain ~* '\m2\s*g\M'    THEN '2g'
        -- Fraction synonyms embedded in strain
        WHEN strain ~* '\m(eighth|1/8)\M'  THEN '3.5g'
        WHEN strain ~* '\m(quarter|1/4)\M' THEN '7g'
        WHEN strain ~* '\m(half|1/2)\M'    THEN '14g'
        WHEN strain ~* '\m(ounce|oz)\M'    THEN '28g'
        -- Product types embedded in strain
        WHEN strain ~* 'cart'         THEN 'cartridge'
        WHEN strain ~* 'gumm'         THEN 'gummies'
        WHEN strain ~* 'disposable'   THEN '1g'
        WHEN strain ~* '(pre.?roll|preroll)' THEN 'preroll'
        ELSE NULL
      END AS extracted_unit
    FROM orders
    WHERE lower(unit) = 'unknown'
      AND strain IS NOT NULL
  )
  UPDATE orders o
  SET    unit = se.extracted_unit
  FROM   strain_extraction se
  WHERE  o.id = se.id
    AND  se.extracted_unit IS NOT NULL;
  GET DIAGNOSTICS pass2 = ROW_COUNT;

  RETURN jsonb_build_object(
    'pass1_normalized',        pass1,
    'pass2_strain_extracted',  pass2,
    'total_updated',           pass1 + pass2,
    'ran_at',                  now()::text
  );
END;
$$;


-- =============================================================================
-- STEP 4: Run the backfill now
-- =============================================================================

SELECT backfill_order_units();


-- =============================================================================
-- VERIFICATION — run after migration to confirm results
-- =============================================================================

-- 1. Unit distribution after normalization
SELECT
  unit,
  COUNT(*)                                         AS row_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS pct
FROM orders
GROUP BY unit
ORDER BY row_count DESC;

-- 2. Remaining unknowns (should be 0 or near-0)
SELECT COUNT(*) AS still_unknown
FROM   orders
WHERE  lower(unit) = 'unknown';

-- 3. Cost-join success rate (after normalization)
WITH norm AS (
  SELECT
    sku,
    unit_cost,
    lower(regexp_replace(sku, '[^a-zA-Z0-9]', '', 'g')) AS norm_sku
  FROM sku_costs
)
SELECT
  COUNT(*)                                           AS total_line_items,
  COUNT(CASE WHEN n.sku IS NOT NULL THEN 1 END)      AS matched_cost,
  ROUND(
    COUNT(CASE WHEN n.sku IS NOT NULL THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0)
  , 1)                                               AS match_pct
FROM orders o
LEFT JOIN norm n
  ON lower(regexp_replace(o.sku, '[^a-zA-Z0-9]', '', 'g'))
     LIKE '%' || n.norm_sku || '%'
WHERE o.order_date >= CURRENT_DATE - INTERVAL '30 days'
  AND o.price_per_unit > 0
  AND o.quantity > 0;
