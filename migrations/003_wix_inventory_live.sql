-- =====================================================
-- WIX INVENTORY LIVE TABLE
-- Single source of truth for Wix inventory
-- Generated: 2026-01-31
-- =====================================================

-- Drop existing table if it exists (clean slate)
DROP TABLE IF EXISTS wix_inventory_live;

-- Create the authoritative inventory table
CREATE TABLE wix_inventory_live (
  -- Primary key: deterministic SKU from product_name + variant
  sku TEXT PRIMARY KEY,

  -- Wix product identifiers
  product_id TEXT NOT NULL,           -- Wix handle (Product_uuid)
  product_name TEXT NOT NULL,         -- Human readable name (from PRODUCT row)
  variant_name TEXT NOT NULL,         -- Weight variant (3.5g, 7g, 14g, 28g)

  -- Category/classification
  category TEXT,                      -- e.g., "Hybrid (Indica Dominant)"

  -- Pricing (from VARIANT rows)
  retail DECIMAL(10,2),               -- Current retail price
  compare_at DECIMAL(10,2),           -- Strikethrough/compare-at price
  cost DECIMAL(10,2),                 -- Wholesale cost (if available)

  -- Inventory
  quantity_on_hand INTEGER NOT NULL DEFAULT 0,
  inventory_status TEXT,              -- 'IN_STOCK', 'OUT_OF_STOCK', or numeric-derived

  -- Visibility
  visible BOOLEAN DEFAULT true,

  -- Sync metadata
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'wix_csv'
);

-- Indexes for common queries
CREATE INDEX idx_wix_inventory_product_id ON wix_inventory_live(product_id);
CREATE INDEX idx_wix_inventory_product_name ON wix_inventory_live(product_name);
CREATE INDEX idx_wix_inventory_variant ON wix_inventory_live(variant_name);
CREATE INDEX idx_wix_inventory_quantity ON wix_inventory_live(quantity_on_hand);
CREATE INDEX idx_wix_inventory_visible ON wix_inventory_live(visible);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to generate deterministic SKU from product name and variant
CREATE OR REPLACE FUNCTION generate_wix_sku(p_name TEXT, p_variant TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN UPPER(
    REGEXP_REPLACE(p_name, '[^a-zA-Z0-9]', '', 'g') ||
    '_' ||
    REGEXP_REPLACE(p_variant, '[^a-zA-Z0-9.]', '', 'g')
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================
-- SYNC PROCEDURE
-- Full-replace sync: DELETE all, INSERT all
-- =====================================================

-- This is called by the sync endpoint before bulk insert
-- The sync endpoint will:
-- 1. Call this to clear the table
-- 2. Bulk insert all rows from CSV
-- 3. Commit transaction

CREATE OR REPLACE FUNCTION wix_inventory_full_refresh_start()
RETURNS void AS $$
BEGIN
  -- Clear all existing data
  DELETE FROM wix_inventory_live;

  -- Log the refresh
  RAISE NOTICE 'wix_inventory_live cleared for full refresh at %', NOW();
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE wix_inventory_live IS 'Authoritative inventory from Wix CSV export. Full-replaced on each sync.';
COMMENT ON COLUMN wix_inventory_live.sku IS 'Deterministic SKU: PRODUCTNAME_VARIANT (e.g., BLOOPIEZ_3.5G)';
COMMENT ON COLUMN wix_inventory_live.quantity_on_hand IS 'Actual inventory count. 0 if IN_STOCK was provided.';
COMMENT ON COLUMN wix_inventory_live.inventory_status IS 'Original status from Wix: numeric value OR IN_STOCK/OUT_OF_STOCK';

-- =====================================================
-- VERIFICATION QUERY
-- =====================================================

-- Run after migration to verify table exists:
-- SELECT COUNT(*) FROM wix_inventory_live;
-- Expected: 0 (empty until first sync)
