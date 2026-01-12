-- =====================================================
-- REALISTIC ORDER SEED DATA
-- =====================================================
-- Based on typical cannabis dispensary inventory
-- Using realistic strain names, pricing, and units
-- 10-15 high-margin products with 5-10 orders each over past 30 days
-- =====================================================

-- Product 1: Ice cream mintz (1 G) - Premium quality, $15/unit
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'ORD_' || generate_series || '_' || floor(random() * 10000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'ice_cream_mintz_1g',
  'Ice cream mintz',
  '1 G',
  'TOP_SHELF',
  (1 + floor(random() * 2))::integer,
  15.00,
  NULL
FROM generate_series(1, 8);

-- Product 2: Ice cream mintz (eighth) - Premium eighth, $45-50/unit
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'ORD_' || generate_series || '_' || floor(random() * 10000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'ice_cream_mintz_eighth',
  'Ice cream mintz',
  'eighth',
  'TOP_SHELF',
  (1 + floor(random() * 2))::integer,
  45.00 + (random() * 5)::decimal(10,2),
  NULL
FROM generate_series(1, 10);

-- Product 3: Gelato (eighth) - High seller, $40-45/unit
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'ORD_' || generate_series || '_' || floor(random() * 10000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'gelato_eighth',
  'Gelato',
  'eighth',
  'PREMIUM',
  (1 + floor(random() * 2))::integer,
  40.00 + (random() * 5)::decimal(10,2),
  NULL
FROM generate_series(1, 12);

-- Product 4: Wedding Cake (quarter) - Popular quantity, $75-85/unit
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'ORD_' || generate_series || '_' || floor(random() * 10000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'wedding_cake_quarter',
  'Wedding Cake',
  'quarter',
  'PREMIUM',
  (1 + floor(random() * 2))::integer,
  75.00 + (random() * 10)::decimal(10,2),
  NULL
FROM generate_series(1, 9);

-- Product 5: Wedding Cake (oz) - Bulk buyers, $180-200/unit
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'ORD_' || generate_series || '_' || floor(random() * 10000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'wedding_cake_oz',
  'Wedding Cake',
  'oz',
  'PREMIUM',
  1,
  180.00 + (random() * 20)::decimal(10,2),
  NULL
FROM generate_series(1, 7);

-- Product 6: Purple Punch (eighth) - Mid-tier popular strain, $38-42/unit
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'ORD_' || generate_series || '_' || floor(random() * 10000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'purple_punch_eighth',
  'Purple Punch',
  'eighth',
  'PREMIUM',
  (1 + floor(random() * 3))::integer,
  38.00 + (random() * 4)::decimal(10,2),
  NULL
FROM generate_series(1, 11);

-- Product 7: Blue Dream (half) - Classic strain, bulk size, $130-145/unit
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'ORD_' || generate_series || '_' || floor(random() * 10000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'blue_dream_half',
  'Blue Dream',
  'half',
  'STANDARD',
  1,
  130.00 + (random() * 15)::decimal(10,2),
  NULL
FROM generate_series(1, 6);

-- Product 8: Sunset Sherbet (1 G) - Small purchases, high margin, $18/unit
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'ORD_' || generate_series || '_' || floor(random() * 10000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'sunset_sherbet_1g',
  'Sunset Sherbet',
  '1 G',
  'TOP_SHELF',
  (1 + floor(random() * 2))::integer,
  18.00,
  NULL
FROM generate_series(1, 9);

-- Product 9: OG Kush (eighth) - Classic bestseller, $42-47/unit
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'ORD_' || generate_series || '_' || floor(random() * 10000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'og_kush_eighth',
  'OG Kush',
  'eighth',
  'TOP_SHELF',
  (1 + floor(random() * 2))::integer,
  42.00 + (random() * 5)::decimal(10,2),
  NULL
FROM generate_series(1, 13);

-- Product 10: Zkittlez (quarter) - High-demand exotic, $80-90/unit
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'ORD_' || generate_series || '_' || floor(random() * 10000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'zkittlez_quarter',
  'Zkittlez',
  'quarter',
  'TOP_SHELF',
  (1 + floor(random() * 2))::integer,
  80.00 + (random() * 10)::decimal(10,2),
  NULL
FROM generate_series(1, 8);

-- Product 11: Gorilla Glue (oz) - Bulk favorite, $175-195/unit
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'ORD_' || generate_series || '_' || floor(random() * 10000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'gorilla_glue_oz',
  'Gorilla Glue #4',
  'oz',
  'PREMIUM',
  1,
  175.00 + (random() * 20)::decimal(10,2),
  NULL
FROM generate_series(1, 5);

-- Product 12: Do-Si-Dos (eighth) - Trendy strain, $43-48/unit
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'ORD_' || generate_series || '_' || floor(random() * 10000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'do_si_dos_eighth',
  'Do-Si-Dos',
  'eighth',
  'TOP_SHELF',
  (1 + floor(random() * 2))::integer,
  43.00 + (random() * 5)::decimal(10,2),
  NULL
FROM generate_series(1, 10);

-- Product 13: Strawberry Cough (1 G) - Daytime favorite, $16/unit
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'ORD_' || generate_series || '_' || floor(random() * 10000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'strawberry_cough_1g',
  'Strawberry Cough',
  '1 G',
  'PREMIUM',
  (1 + floor(random() * 3))::integer,
  16.00,
  NULL
FROM generate_series(1, 7);

-- Product 14: Platinum OG (half) - Premium bulk, $140-155/unit
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'ORD_' || generate_series || '_' || floor(random() * 10000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'platinum_og_half',
  'Platinum OG',
  'half',
  'TOP_SHELF',
  1,
  140.00 + (random() * 15)::decimal(10,2),
  NULL
FROM generate_series(1, 6);

-- Product 15: Mac 1 (eighth) - Exotic/high-end, $48-53/unit
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'ORD_' || generate_series || '_' || floor(random() * 10000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'mac_1_eighth',
  'Mac 1',
  'eighth',
  'TOP_SHELF',
  (1 + floor(random() * 2))::integer,
  48.00 + (random() * 5)::decimal(10,2),
  NULL
FROM generate_series(1, 9);

-- Calculate total_amount = quantity * price_per_unit
UPDATE public.orders
SET total_amount = quantity * price_per_unit
WHERE total_amount IS NULL;

-- =====================================================
-- VERIFICATION QUERY
-- =====================================================
-- Run this after inserting to verify the data:
/*
SELECT
  strain,
  unit,
  COUNT(*) as order_count,
  SUM(quantity) as total_units_sold,
  ROUND(AVG(price_per_unit)::numeric, 2) as avg_price,
  ROUND(SUM(total_amount)::numeric, 2) as total_revenue
FROM public.orders
WHERE order_id LIKE 'ORD_%'
GROUP BY strain, unit
ORDER BY total_revenue DESC;
*/

-- =====================================================
-- SUMMARY
-- =====================================================
-- Total products: 15
-- Total orders: ~125 orders over past 30 days
-- Product mix:
--   - 3x 1G products (small purchases, high margin)
--   - 7x eighth products (most popular size)
--   - 3x quarter products (value buyers)
--   - 2x half products (bulk buyers)
--   - 3x oz products (largest bulk size)
-- Price range: $15-200 per unit
-- Quality tiers: TOP_SHELF, PREMIUM, STANDARD
-- =====================================================
