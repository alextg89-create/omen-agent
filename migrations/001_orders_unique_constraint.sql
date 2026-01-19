-- =============================================================================
-- MIGRATION: Add unique constraint for idempotent order line-item upserts
-- =============================================================================
--
-- PURPOSE:
-- Ensures (order_id, sku) is unique in the orders table.
-- This enables deterministic upserts without fallback logic.
--
-- MUST RUN BEFORE: orderSyncService.js can function correctly
--
-- =============================================================================

-- Step 1: Check for existing duplicates (run this first to identify issues)
-- SELECT order_id, sku, COUNT(*) as cnt
-- FROM orders
-- GROUP BY order_id, sku
-- HAVING COUNT(*) > 1;

-- Step 2: If duplicates exist, dedupe by keeping the earliest record
-- DELETE FROM orders a USING orders b
-- WHERE a.id > b.id AND a.order_id = b.order_id AND a.sku = b.sku;

-- Step 3: Add the unique constraint
ALTER TABLE orders
ADD CONSTRAINT orders_order_id_sku_unique
UNIQUE (order_id, sku);

-- Step 4: Create index on created_at for velocity queries
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

-- Step 5: Create index on order_date for date range queries
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date);

-- =============================================================================
-- VERIFICATION QUERIES (run after migration)
-- =============================================================================

-- Verify constraint exists:
-- SELECT conname FROM pg_constraint WHERE conname = 'orders_order_id_sku_unique';

-- Verify timestamps are actual order times (not all same day):
-- SELECT DATE(created_at) as order_day, COUNT(*)
-- FROM orders
-- GROUP BY DATE(created_at)
-- ORDER BY order_day DESC
-- LIMIT 10;

-- Verify line items exist for velocity analysis:
-- SELECT COUNT(*) as line_item_count,
--        COUNT(DISTINCT order_id) as unique_orders,
--        COUNT(DISTINCT sku) as unique_skus
-- FROM orders
-- WHERE created_at >= NOW() - INTERVAL '7 days';
