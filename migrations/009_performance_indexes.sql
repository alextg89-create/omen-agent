-- =============================================================================
-- MIGRATION 009: Performance Indexes
-- =============================================================================
--
-- PURPOSE:
-- Ensure all analytics queries run under 100ms.
--
-- QUERIES BEING OPTIMIZED:
--   - Velocity: GROUP BY strain, unit over order_date ranges
--   - Cost matching: WHERE sku ILIKE '%...' containment scans
--   - Webhook sync: WHERE event_type + received_at range
--   - Dashboard: sold_by_sku lookups, inventory_virtual joins
--   - backfill_order_units(): WHERE unit = 'unknown'
--
-- SAFE: All CREATE INDEX IF NOT EXISTS — idempotent.
-- =============================================================================


-- =============================================================================
-- orders table
-- =============================================================================

-- Primary date-range filter (all velocity/margin queries)
CREATE INDEX IF NOT EXISTS idx_orders_order_date
  ON orders (order_date DESC);

-- Strain-based lookups (velocity grouping, backfill)
CREATE INDEX IF NOT EXISTS idx_orders_strain
  ON orders (strain);

-- Unit-based lookups (normalization pass, cost matching)
CREATE INDEX IF NOT EXISTS idx_orders_unit
  ON orders (unit);

-- Combined: the most common analytics filter
CREATE INDEX IF NOT EXISTS idx_orders_date_sku
  ON orders (order_date DESC, sku);

-- SKU containment search (cost resolution Step c — normKey containment)
-- text_pattern_ops enables LIKE '%...%' scans on the normalized form
-- Note: this helps prefix scans; pure suffix scans still seq-scan but rows are bounded by date
CREATE INDEX IF NOT EXISTS idx_orders_sku_lower
  ON orders (lower(sku));

-- Upsert conflict path (idempotency constraint)
-- The unique constraint orders_order_id_sku_unique already creates this index;
-- only create if the constraint doesn't exist yet.
CREATE INDEX IF NOT EXISTS idx_orders_order_id_sku
  ON orders (order_id, sku);

-- Backfill / repair: fast scan for unknown units
CREATE INDEX IF NOT EXISTS idx_orders_unit_unknown
  ON orders (unit)
  WHERE lower(unit) = 'unknown';

-- created_at (legacy velocity queries that use this column)
CREATE INDEX IF NOT EXISTS idx_orders_created_at
  ON orders (created_at DESC);


-- =============================================================================
-- webhook_events table
-- =============================================================================

-- Sync lookback window (primary filter in syncOrdersFromWebhooks)
CREATE INDEX IF NOT EXISTS idx_webhook_received_at
  ON webhook_events (received_at DESC);

-- Event type filter (always combined with received_at)
CREATE INDEX IF NOT EXISTS idx_webhook_event_type_received
  ON webhook_events (event_type, received_at DESC);

-- JSONB order number extraction (used in migration 006 backfill joins)
-- Expression index on the two payload structures Wix uses
CREATE INDEX IF NOT EXISTS idx_webhook_order_number_flat
  ON webhook_events ((raw_payload->>'orderNumber'))
  WHERE raw_payload->>'orderNumber' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_order_number_nested
  ON webhook_events ((raw_payload->'data'->>'orderNumber'))
  WHERE raw_payload->'data'->>'orderNumber' IS NOT NULL;


-- =============================================================================
-- sold_by_sku table (velocity view / materialized)
-- =============================================================================

-- Primary lookup by sku
CREATE INDEX IF NOT EXISTS idx_sold_by_sku_sku
  ON sold_by_sku (sku);

-- Velocity-based sorts (dashboard health breakdown)
CREATE INDEX IF NOT EXISTS idx_sold_by_sku_velocity
  ON sold_by_sku (avg_daily_velocity DESC NULLS LAST);

-- Last-sold-at (dead/slow mover detection)
CREATE INDEX IF NOT EXISTS idx_sold_by_sku_last_sold
  ON sold_by_sku (last_sold_at DESC NULLS LAST);


-- =============================================================================
-- inventory_virtual table
-- =============================================================================

-- Primary SKU lookup (all join paths)
CREATE INDEX IF NOT EXISTS idx_inventory_virtual_sku
  ON inventory_virtual (sku);

-- In-stock filter (dashboard health, revenue opportunity)
CREATE INDEX IF NOT EXISTS idx_inventory_virtual_available
  ON inventory_virtual (available_qty)
  WHERE available_qty > 0;

-- Visible items only (health breakdown query uses visible = true)
CREATE INDEX IF NOT EXISTS idx_inventory_virtual_visible
  ON inventory_virtual (sku)
  WHERE visible = true AND available_qty > 0;


-- =============================================================================
-- sku_costs table
-- =============================================================================

-- Primary cost lookup
CREATE INDEX IF NOT EXISTS idx_sku_costs_sku
  ON sku_costs (sku);

-- Normalized SKU for containment matching
CREATE INDEX IF NOT EXISTS idx_sku_costs_sku_lower
  ON sku_costs (lower(regexp_replace(sku, '[^a-zA-Z0-9]', '', 'g')));


-- =============================================================================
-- VERIFICATION — confirm indexes exist and show size estimates
-- =============================================================================

SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE tablename IN ('orders', 'webhook_events', 'sold_by_sku', 'inventory_virtual', 'sku_costs')
ORDER BY tablename, indexname;
