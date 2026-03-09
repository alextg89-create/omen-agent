-- =============================================================================
-- MIGRATION 006: Backfill unit field in orders from webhook_events.raw_payload
-- =============================================================================
--
-- PURPOSE:
-- Many historical orders have unit='Unknown' because parseProductName() only
-- parsed the product name string and missed the variant in descriptionLines.
-- Wix webhooks include the actual sold variant in:
--   lineItems[*].descriptionLines[{ name: "Weight", description: "28 G" }]
--
-- This migration reads raw_payload from webhook_events and backfills the
-- unit column in orders for all rows where unit = 'Unknown'.
--
-- SAFE:
-- - Only touches rows where unit = 'Unknown'
-- - Does not overwrite valid units
-- - Idempotent: safe to run multiple times
-- - Does not modify webhook_events
-- - Does not affect SKU resolution (sku column is left as-is)
--
-- HOW ORDERS LINK TO WEBHOOKS:
--   orders.order_id  =  webhook_events.raw_payload->>'orderNumber'
--                    OR webhook_events.raw_payload->'data'->>'orderNumber'
--   (Wix sends both flat and wrapped payload structures)
--
-- HOW UNIT IS FOUND:
--   raw_payload -> lineItems -> descriptionLines
--   where descriptionLine.name IN ('weight', 'size', 'unit')
--   and matched to the correct line item via strain
--
-- =============================================================================

-- STEP 1: Preview what will be updated (read-only, run first to verify)
-- =============================================================================
/*
SELECT
  o.order_id,
  o.strain,
  o.unit AS current_unit,
  wli.extracted_unit AS will_be_set_to,
  wli.item_name AS from_line_item
FROM orders o
JOIN LATERAL (
  SELECT
    COALESCE(
      we.raw_payload->'data'->>'orderNumber',
      we.raw_payload->>'orderNumber'
    ) AS order_number,
    li->>'itemName' AS item_name,
    (
      SELECT dl->>'description'
      FROM jsonb_array_elements(li->'descriptionLines') AS dl
      WHERE LOWER(dl->>'name') IN ('weight', 'size', 'unit')
        AND dl->>'description' IS NOT NULL
        AND dl->>'description' != ''
      LIMIT 1
    ) AS extracted_unit
  FROM webhook_events we,
    LATERAL jsonb_array_elements(
      COALESCE(
        we.raw_payload->'data'->'lineItems',
        we.raw_payload->'lineItems',
        '[]'::jsonb
      )
    ) AS li
  WHERE COALESCE(
    we.raw_payload->'data'->>'orderNumber',
    we.raw_payload->>'orderNumber'
  ) = o.order_id
) AS wli ON TRUE
WHERE o.unit = 'Unknown'
  AND wli.extracted_unit IS NOT NULL
  AND LOWER(REGEXP_REPLACE(wli.item_name, '[^a-zA-Z0-9]', '', 'g'))
      LIKE '%' || LOWER(REGEXP_REPLACE(o.strain, '[^a-zA-Z0-9]', '', 'g')) || '%'
ORDER BY o.order_id;
*/


-- STEP 2: Run the actual backfill
-- =============================================================================
UPDATE orders o
SET unit = wli.extracted_unit
FROM (
  SELECT
    o2.id AS order_row_id,
    (
      SELECT dl->>'description'
      FROM webhook_events we,
        LATERAL jsonb_array_elements(
          COALESCE(
            we.raw_payload->'data'->'lineItems',
            we.raw_payload->'lineItems',
            '[]'::jsonb
          )
        ) AS li,
        LATERAL jsonb_array_elements(li->'descriptionLines') AS dl
      WHERE COALESCE(
          we.raw_payload->'data'->>'orderNumber',
          we.raw_payload->>'orderNumber'
        ) = o2.order_id
        AND LOWER(dl->>'name') IN ('weight', 'size', 'unit')
        AND dl->>'description' IS NOT NULL
        AND dl->>'description' != ''
        -- Match line item to this order row by strain substring
        AND LOWER(REGEXP_REPLACE(li->>'itemName', '[^a-zA-Z0-9]', '', 'g'))
            LIKE '%' || LOWER(REGEXP_REPLACE(o2.strain, '[^a-zA-Z0-9]', '', 'g')) || '%'
      LIMIT 1
    ) AS extracted_unit
  FROM orders o2
  WHERE o2.unit = 'Unknown'
) AS wli
WHERE o.id = wli.order_row_id
  AND wli.extracted_unit IS NOT NULL
  AND wli.extracted_unit != '';


-- =============================================================================
-- VERIFICATION QUERIES (run after migration)
-- =============================================================================

-- 1. Count how many rows were fixed vs still unknown
SELECT
  unit,
  COUNT(*) AS row_count
FROM orders
GROUP BY unit
ORDER BY row_count DESC;

-- 2. Confirm no 'Unknown' units remain for orders that have webhook data
SELECT COUNT(*) AS still_unknown
FROM orders o
WHERE o.unit = 'Unknown'
  AND EXISTS (
    SELECT 1 FROM webhook_events we
    WHERE COALESCE(
      we.raw_payload->'data'->>'orderNumber',
      we.raw_payload->>'orderNumber'
    ) = o.order_id
  );

-- 3. Sample the backfilled rows to confirm correct values
SELECT order_id, strain, unit, sku, order_date
FROM orders
WHERE unit != 'Unknown'
  AND created_at >= NOW() - INTERVAL '90 days'
ORDER BY order_date DESC
LIMIT 20;
