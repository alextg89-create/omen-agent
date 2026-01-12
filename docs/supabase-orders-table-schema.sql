-- =====================================================
-- OMEN ORDERS TABLE - Transaction Velocity Tracking
-- =====================================================
-- This table captures completed transactions to calculate:
-- - Sales velocity (units/day per SKU)
-- - Trending products (acceleration/deceleration)
-- - Smart promotion recommendations (high velocity + high margin)
--
-- Data Source: Make.com webhook or POS integration
-- =====================================================

CREATE TABLE IF NOT EXISTS public.orders (
  -- Primary key
  id BIGSERIAL PRIMARY KEY,

  -- Order identification
  order_id TEXT NOT NULL,           -- External order ID from POS/Make
  order_date TIMESTAMPTZ NOT NULL,  -- When the order was completed

  -- Product identification (matches inventory_live)
  sku TEXT NOT NULL,                -- Product SKU
  strain TEXT,                      -- Product name/strain
  unit TEXT NOT NULL,               -- Unit size (oz, half, quarter, eighth, etc)
  quality TEXT,                     -- Quality tier (TOP_SHELF, PREMIUM, etc)

  -- Transaction details
  quantity INTEGER NOT NULL,        -- Units sold (negative = return)
  price_per_unit DECIMAL(10,2),     -- Sale price per unit
  total_amount DECIMAL(10,2),       -- Total transaction amount

  -- Optional metadata
  customer_id TEXT,                 -- Customer identifier (optional)
  notes TEXT,                       -- Additional notes

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT orders_quantity_check CHECK (quantity != 0),
  CONSTRAINT orders_positive_price CHECK (price_per_unit >= 0)
);

-- =====================================================
-- INDEXES for fast velocity queries
-- =====================================================

-- Index for date range queries (daily/weekly snapshots)
CREATE INDEX IF NOT EXISTS idx_orders_date
  ON public.orders (order_date DESC);

-- Index for SKU velocity lookups
CREATE INDEX IF NOT EXISTS idx_orders_sku_date
  ON public.orders (sku, order_date DESC);

-- Index for unit-level analysis
CREATE INDEX IF NOT EXISTS idx_orders_unit_date
  ON public.orders (unit, order_date DESC);

-- Composite index for full product velocity
CREATE INDEX IF NOT EXISTS idx_orders_product_date
  ON public.orders (sku, unit, order_date DESC);

-- =====================================================
-- EXAMPLE DATA - Seed with 30 days of sample orders
-- =====================================================
-- This gives you instant velocity data for testing
-- Replace with real data from your POS system

-- High velocity product (Bloopiez 3.5g) - 45 sales in 30 days
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'SEED_' || generate_series || '_' || floor(random() * 1000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'bloopiez_eighth',
  'Bloopiez',
  'eighth',
  'TOP_SHELF',
  (1 + floor(random() * 3))::integer,
  35.00 + (random() * 10)::decimal(10,2),
  NULL
FROM generate_series(1, 45);

-- Medium velocity product (Gelato 3.5g) - 22 sales in 30 days
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'SEED_' || generate_series || '_' || floor(random() * 1000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'gelato_eighth',
  'Gelato',
  'eighth',
  'PREMIUM',
  1,
  32.00 + (random() * 8)::decimal(10,2),
  NULL
FROM generate_series(1, 22);

-- Low velocity product (Ice Cream Mintz 1g) - 8 sales in 30 days
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'SEED_' || generate_series || '_' || floor(random() * 1000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'ice_cream_mintz_1g',
  'Ice cream mintz',
  '1 G',
  'TOP_SHELF',
  1,
  15.00,
  NULL
FROM generate_series(1, 8);

-- Fast mover (Wedding Cake oz) - 18 sales in 30 days
INSERT INTO public.orders (order_id, order_date, sku, strain, unit, quality, quantity, price_per_unit, total_amount)
SELECT
  'SEED_' || generate_series || '_' || floor(random() * 1000)::text,
  NOW() - (random() * INTERVAL '30 days'),
  'wedding_cake_oz',
  'Wedding Cake',
  'oz',
  'PREMIUM',
  (1 + floor(random() * 2))::integer,
  180.00 + (random() * 20)::decimal(10,2),
  NULL
FROM generate_series(1, 18);

-- Update total_amount based on quantity * price_per_unit
UPDATE public.orders
SET total_amount = quantity * price_per_unit
WHERE total_amount IS NULL;

-- =====================================================
-- RLS (Row Level Security) - Optional
-- =====================================================
-- Enable if you want to restrict access per user/org

-- ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Allow service role full access" ON public.orders
--   FOR ALL
--   TO service_role
--   USING (true)
--   WITH CHECK (true);

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Check total orders inserted
-- SELECT COUNT(*) as total_orders FROM public.orders;

-- Check velocity by SKU (orders per day)
-- SELECT
--   sku,
--   strain,
--   COUNT(*) as total_sales,
--   SUM(quantity) as units_sold,
--   ROUND(COUNT(*) / 30.0, 2) as orders_per_day,
--   ROUND(SUM(quantity) / 30.0, 2) as units_per_day
-- FROM public.orders
-- GROUP BY sku, strain
-- ORDER BY units_per_day DESC;

-- =====================================================
-- DONE!
-- =====================================================
-- After running this:
-- 1. Your snapshots will show REAL velocity recommendations
-- 2. Chat will give promotion insights based on sales data
-- 3. Daily vs Weekly will show DIFFERENT trending insights
-- =====================================================
