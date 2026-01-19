-- =====================================================
-- INVENTORY BACKFILL SQL
-- Generated: 2026-01-17T19:50:21.034Z
-- =====================================================

-- =====================================================
-- 1) SELECT: List missing products from orders
-- =====================================================

SELECT
  strain,
  unit,
  COUNT(*) as order_count,
  SUM(quantity) as total_units_sold,
  MAX(price_per_unit) as max_price,
  MIN(order_date) as first_order,
  MAX(order_date) as last_order
FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_live i
  WHERE i.sku = o.sku
)
GROUP BY strain, unit
ORDER BY order_count DESC;


-- =====================================================
-- 2) BATCH INSERT: Add all missing products
-- =====================================================

-- SAFE INSERT: Only adds rows that don't already exist
-- Uses UNMATCHED- prefix to clearly mark auto-generated SKUs

INSERT INTO inventory_live (
  sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source
)
SELECT
  'UNMATCHED-' || UPPER(REGEXP_REPLACE(strain, '[^a-zA-Z0-9]', '', 'g')) as sku,
  'UNCATEGORIZED' as category,
  'UNKNOWN' as brand,
  strain as product_name,
  strain as strain,
  COALESCE(unit, 'unit') as unit,
  0 as quantity,
  NULL as cost,
  MAX(price_per_unit) as retail_price,
  'order_backfill' as source
FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_live i
  WHERE i.sku = o.sku
)
GROUP BY strain, unit
ON CONFLICT (sku) DO NOTHING;


-- =====================================================
-- 3) VERIFICATION QUERIES
-- =====================================================

-- Check match rate after backfill
SELECT
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM inventory_live i WHERE i.sku = o.sku)) as matched,
  COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM inventory_live i WHERE i.sku = o.sku)) as unmatched,
  COUNT(*) as total
FROM orders o;

-- List newly added inventory items
SELECT sku, strain, unit, retail_price, source
FROM inventory_live
WHERE source = 'order_backfill'
ORDER BY strain;


-- =====================================================
-- 4) INDIVIDUAL INSERT STATEMENTS
-- (Run these if batch insert fails)
-- =====================================================

-- Bacio Gelato (ordered 3x, 4 units, max price $180)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-BACIOGELATO', 'UNCATEGORIZED', 'UNKNOWN', 'Bacio Gelato', 'Bacio Gelato', 'unit', 0, NULL, 180, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-BACIOGELATO');

-- Faded gummies (ordered 3x, 3 units, max price $55)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-FADEDGUMMIES', 'UNCATEGORIZED', 'UNKNOWN', 'Faded gummies', 'Faded gummies', 'unit', 0, NULL, 55, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-FADEDGUMMIES');

-- Blueberry Ghost OG (ordered 2x, 4 units, max price $540)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-BLUEBERRYGHOSTOG', 'UNCATEGORIZED', 'UNKNOWN', 'Blueberry Ghost OG', 'Blueberry Ghost OG', 'unit', 0, NULL, 540, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-BLUEBERRYGHOSTOG');

-- Trop Cherry (ordered 2x, 2 units, max price $85.5)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-TROPCHERRY', 'UNCATEGORIZED', 'UNKNOWN', 'Trop Cherry', 'Trop Cherry', 'unit', 0, NULL, 85.5, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-TROPCHERRY');

-- Lemon Cherry Gelato (ordered 2x, 2 units, max price $112.5)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-LEMONCHERRYGELATO', 'UNCATEGORIZED', 'UNKNOWN', 'Lemon Cherry Gelato', 'Lemon Cherry Gelato', 'unit', 0, NULL, 112.5, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-LEMONCHERRYGELATO');

-- Kind Canna Pre-Roll Joints (ordered 2x, 4 units, max price $60)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-KINDCANNAPREROLLJOINTS', 'UNCATEGORIZED', 'UNKNOWN', 'Kind Canna Pre-Roll Joints', 'Kind Canna Pre-Roll Joints', 'unit', 0, NULL, 60, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-KINDCANNAPREROLLJOINTS');

-- Lemon Cherry Gelato  (ordered 1x, 1 units, max price $45)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-LEMONCHERRYGELATO', 'UNCATEGORIZED', 'UNKNOWN', 'Lemon Cherry Gelato ', 'Lemon Cherry Gelato ', 'unit', 0, NULL, 45, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-LEMONCHERRYGELATO');

-- Juiced Extract (ordered 1x, 1 units, max price $31.5)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-JUICEDEXTRACT', 'UNCATEGORIZED', 'UNKNOWN', 'Juiced Extract', 'Juiced Extract', 'unit', 0, NULL, 31.5, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-JUICEDEXTRACT');

-- Loud Sauce Extract (ordered 1x, 1 units, max price $31.5)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-LOUDSAUCEEXTRACT', 'UNCATEGORIZED', 'UNKNOWN', 'Loud Sauce Extract', 'Loud Sauce Extract', 'unit', 0, NULL, 31.5, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-LOUDSAUCEEXTRACT');

-- KoKo Dabz (ordered 1x, 1 units, max price $18)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-KOKODABZ', 'UNCATEGORIZED', 'UNKNOWN', 'KoKo Dabz', 'KoKo Dabz', 'unit', 0, NULL, 18, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-KOKODABZ');

-- Kaws Moonrocks (ordered 1x, 1 units, max price $63)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-KAWSMOONROCKS', 'UNCATEGORIZED', 'UNKNOWN', 'Kaws Moonrocks', 'Kaws Moonrocks', 'unit', 0, NULL, 63, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-KAWSMOONROCKS');

-- Zoap (ordered 1x, 1 units, max price $45)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-ZOAP', 'UNCATEGORIZED', 'UNKNOWN', 'Zoap', 'Zoap', 'unit', 0, NULL, 45, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-ZOAP');

-- Venom Carts (ordered 1x, 2 units, max price $45)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-VENOMCARTS', 'UNCATEGORIZED', 'UNKNOWN', 'Venom Carts', 'Venom Carts', 'unit', 0, NULL, 45, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-VENOMCARTS');

-- Bubble Hash (ordered 1x, 6 units, max price $216)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-BUBBLEHASH', 'UNCATEGORIZED', 'UNKNOWN', 'Bubble Hash', 'Bubble Hash', 'unit', 0, NULL, 216, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-BUBBLEHASH');

-- Nugz Medicated Chocolates (ordered 1x, 1 units, max price $22.5)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-NUGZMEDICATEDCHOCOLATES', 'UNCATEGORIZED', 'UNKNOWN', 'Nugz Medicated Chocolates', 'Nugz Medicated Chocolates', 'unit', 0, NULL, 22.5, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-NUGZMEDICATEDCHOCOLATES');

-- Punch Bar Chocolates (ordered 1x, 3 units, max price $81)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-PUNCHBARCHOCOLATES', 'UNCATEGORIZED', 'UNKNOWN', 'Punch Bar Chocolates', 'Punch Bar Chocolates', 'unit', 0, NULL, 81, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-PUNCHBARCHOCOLATES');

-- Blue River Rosin Cartridge (ordered 1x, 1 units, max price $20)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-BLUERIVERROSINCARTRIDGE', 'UNCATEGORIZED', 'UNKNOWN', 'Blue River Rosin Cartridge', 'Blue River Rosin Cartridge', 'unit', 0, NULL, 20, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-BLUERIVERROSINCARTRIDGE');

-- Heights (ordered 1x, 1 units, max price $40)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-HEIGHTS', 'UNCATEGORIZED', 'UNKNOWN', 'Heights', 'Heights', 'unit', 0, NULL, 40, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-HEIGHTS');

-- Cali Gold chocolate (ordered 1x, 1 units, max price $50)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-CALIGOLDCHOCOLATE', 'UNCATEGORIZED', 'UNKNOWN', 'Cali Gold chocolate', 'Cali Gold chocolate', 'unit', 0, NULL, 50, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-CALIGOLDCHOCOLATE');

-- Muha Med 2 Gram Disposable (ordered 1x, 1 units, max price $75)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-MUHAMED2GRAMDISPOSABLE', 'UNCATEGORIZED', 'UNKNOWN', 'Muha Med 2 Gram Disposable', 'Muha Med 2 Gram Disposable', 'unit', 0, NULL, 75, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-MUHAMED2GRAMDISPOSABLE');

-- Stiiizy (ordered 1x, 3 units, max price $105)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-STIIIZY', 'UNCATEGORIZED', 'UNKNOWN', 'Stiiizy', 'Stiiizy', 'unit', 0, NULL, 105, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-STIIIZY');

-- Kind Canna Mini 10pk (ordered 1x, 1 units, max price $25)
INSERT INTO inventory_live (sku, category, brand, product_name, strain, unit, quantity, cost, retail_price, source)
SELECT 'UNMATCHED-KINDCANNAMINI10PK', 'UNCATEGORIZED', 'UNKNOWN', 'Kind Canna Mini 10pk', 'Kind Canna Mini 10pk', 'unit', 0, NULL, 25, 'order_backfill'
WHERE NOT EXISTS (SELECT 1 FROM inventory_live WHERE sku = 'UNMATCHED-KINDCANNAMINI10PK');


-- =====================================================
-- 5) UPDATE ORDERS TO USE NEW SKUS
-- (Run after inventory backfill)
-- =====================================================

UPDATE orders SET sku = 'UNMATCHED-BACIOGELATO' WHERE strain = 'Bacio Gelato' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-FADEDGUMMIES' WHERE strain = 'Faded gummies' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-BLUEBERRYGHOSTOG' WHERE strain = 'Blueberry Ghost OG' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-TROPCHERRY' WHERE strain = 'Trop Cherry' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-LEMONCHERRYGELATO' WHERE strain = 'Lemon Cherry Gelato' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-KINDCANNAPREROLLJOINTS' WHERE strain = 'Kind Canna Pre-Roll Joints' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-LEMONCHERRYGELATO' WHERE strain = 'Lemon Cherry Gelato ' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-JUICEDEXTRACT' WHERE strain = 'Juiced Extract' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-LOUDSAUCEEXTRACT' WHERE strain = 'Loud Sauce Extract' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-KOKODABZ' WHERE strain = 'KoKo Dabz' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-KAWSMOONROCKS' WHERE strain = 'Kaws Moonrocks' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-ZOAP' WHERE strain = 'Zoap' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-VENOMCARTS' WHERE strain = 'Venom Carts' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-BUBBLEHASH' WHERE strain = 'Bubble Hash' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-NUGZMEDICATEDCHOCOLATES' WHERE strain = 'Nugz Medicated Chocolates' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-PUNCHBARCHOCOLATES' WHERE strain = 'Punch Bar Chocolates' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-BLUERIVERROSINCARTRIDGE' WHERE strain = 'Blue River Rosin Cartridge' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-HEIGHTS' WHERE strain = 'Heights' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-CALIGOLDCHOCOLATE' WHERE strain = 'Cali Gold chocolate' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-MUHAMED2GRAMDISPOSABLE' WHERE strain = 'Muha Med 2 Gram Disposable' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-STIIIZY' WHERE strain = 'Stiiizy' AND sku LIKE '%_unit';
UPDATE orders SET sku = 'UNMATCHED-KINDCANNAMINI10PK' WHERE strain = 'Kind Canna Mini 10pk' AND sku LIKE '%_unit';

-- =====================================================
-- SUMMARY
-- =====================================================
-- Total unmatched strains: 22
-- Total unmatched order rows: 30

-- Done
