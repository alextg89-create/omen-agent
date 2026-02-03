-- =====================================================
-- SKU COSTS TABLE - Cost Authority
-- Single source of truth for SKU-level unit costs
-- Generated: 2026-02-02
-- =====================================================

-- Drop existing table if it exists (clean slate for dev)
DROP TABLE IF EXISTS sku_costs;

-- Create the SKU cost authority table
CREATE TABLE sku_costs (
  -- Primary key: SKU must match wix_inventory_live.sku exactly
  sku TEXT PRIMARY KEY,

  -- Unit cost in dollars (NOT NULL - if you don't know cost, don't insert)
  unit_cost NUMERIC(10,2) NOT NULL CHECK (unit_cost >= 0),

  -- When this cost became effective
  effective_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Source of cost data (for audit trail)
  source TEXT NOT NULL DEFAULT 'manual',

  -- Notes (optional)
  notes TEXT,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for joins with inventory
CREATE INDEX idx_sku_costs_sku ON sku_costs(sku);

-- Index for finding costs by source
CREATE INDEX idx_sku_costs_source ON sku_costs(source);

-- =====================================================
-- TRIGGER: Auto-update updated_at timestamp
-- =====================================================

CREATE OR REPLACE FUNCTION update_sku_costs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sku_costs_updated_at
  BEFORE UPDATE ON sku_costs
  FOR EACH ROW
  EXECUTE FUNCTION update_sku_costs_timestamp();

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE sku_costs IS 'SKU-level unit cost authority. One row per SKU. Cost must be explicitly known, never estimated.';
COMMENT ON COLUMN sku_costs.sku IS 'Must match wix_inventory_live.sku exactly (e.g., BLOOPIEZ-3.5G)';
COMMENT ON COLUMN sku_costs.unit_cost IS 'Wholesale/acquisition cost per unit in dollars. Must be >= 0.';
COMMENT ON COLUMN sku_costs.effective_date IS 'When this cost became active. Used for historical accuracy.';
COMMENT ON COLUMN sku_costs.source IS 'Origin of cost data: manual, invoice, supplier_api, etc.';

-- =====================================================
-- VERIFICATION QUERY
-- Returns SKUs with complete margin data (inventory + cost + price)
-- =====================================================

-- Run this after populating costs to verify margins work:
/*
SELECT
  i.sku,
  i.product_name,
  i.retail as sell_price,
  c.unit_cost,
  ROUND((i.retail - c.unit_cost), 2) as unit_margin,
  ROUND(((i.retail - c.unit_cost) / i.retail * 100), 2) as margin_percent,
  i.quantity_on_hand as stock,
  c.source as cost_source
FROM wix_inventory_live i
INNER JOIN sku_costs c ON c.sku = i.sku
WHERE i.retail IS NOT NULL AND i.retail > 0
ORDER BY margin_percent DESC;
*/

-- =====================================================
-- DIAGNOSTIC: SKUs missing cost data
-- =====================================================

-- Run this to see which SKUs need cost data:
/*
SELECT
  i.sku,
  i.product_name,
  i.variant_name,
  i.retail,
  'MISSING_COST' as status
FROM wix_inventory_live i
LEFT JOIN sku_costs c ON c.sku = i.sku
WHERE c.sku IS NULL
ORDER BY i.product_name, i.variant_name;
*/
