/**
 * ORDER SYNC SERVICE
 *
 * Syncs order data from webhook_events to orders table
 * Parses Wix webhook payloads and extracts order line items
 *
 * CRITICAL: created_at MUST be the actual order timestamp, NOT ingestion time.
 * Velocity analysis, daily/weekly logic, and chat all depend on accurate timestamps.
 *
 * IDEMPOTENCY: Enforced by database constraint on (order_id, sku).
 * No fallback logic - upsert fails hard if constraint missing.
 */

import { getSupabaseClient, isSupabaseAvailable } from '../db/supabaseClient.js';
import { lookupCatalogSku } from '../utils/catalogLookup.js';

/**
 * Extract the actual order timestamp from Wix payload
 *
 * Precedence (per spec):
 * 1. data.paymentDate (Wix payment timestamp)
 * 2. data.createdDate (Wix order creation)
 * 3. payments[0].createdDate (first payment timestamp)
 * 4. webhook.received_at (last resort)
 *
 * @param {object} data - Parsed Wix order data
 * @param {string} webhookReceivedAt - Fallback timestamp from webhook_events
 * @returns {string} ISO timestamp string
 */
function extractOrderTimestamp(data, webhookReceivedAt) {
  // Try Wix timestamps in order of preference
  const candidates = [
    data.paymentDate,
    data.createdDate,
    data.payments?.[0]?.createdDate,
    data.dateCreated,
    webhookReceivedAt
  ];

  for (const ts of candidates) {
    if (ts) {
      // Validate it's a parseable date
      const parsed = new Date(ts);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  }

  // Should never reach here, but fail safe
  console.warn('[OrderSync] No valid timestamp found, using webhook received_at');
  return webhookReceivedAt || new Date().toISOString();
}

/**
 * Sync orders from webhook_events to orders table
 * @param {number} lookbackDays - How many days to sync (default: 30)
 * @returns {Promise<{synced: number, skipped: number, errors: number}>}
 */
export async function syncOrdersFromWebhooks(lookbackDays = 30) {
  console.log('[OrderSync] ========== EXECUTION CONTEXT ==========');
  console.log('[OrderSync] Function: syncOrdersFromWebhooks');
  console.log('[OrderSync] Timestamp:', new Date().toISOString());
  console.log('[OrderSync] Lookback days:', lookbackDays);
  console.log('[OrderSync] Process ID:', process.pid);
  console.log('[OrderSync] ===========================================');

  if (!isSupabaseAvailable()) {
    console.error('[OrderSync] ❌ isSupabaseAvailable() returned false');
    throw new Error('Supabase not configured');
  }

  console.log('[OrderSync] ✅ isSupabaseAvailable() returned true');
  console.log('[OrderSync] Calling getSupabaseClient()...');

  const client = getSupabaseClient();

  // DIAGNOSTIC: Verify client state before inventory query
  console.log('[OrderSync] Client state:', {
    exists: !!client,
    hasFrom: typeof client?.from === 'function',
    clientType: typeof client,
    // Log client internal structure to detect tampering
    hasRest: !!client?.rest,
    hasAuth: !!client?.auth,
    hasRealtime: !!client?.realtime
  });

  console.log(`[OrderSync] Starting sync for last ${lookbackDays} days...`);

  // Load inventory_virtual for SKU matching (OPTIONAL - continue if fails)
  // AUTHORITY TABLE: inventory_virtual (order-driven real-time view)
  console.log('[OrderSync] QUERY 1: inventory_virtual');
  console.log('[OrderSync] Query table: inventory_virtual');
  console.log('[OrderSync] Query columns: sku, product_name, variant_name');

  const { data: inventory, error: inventoryError } = await client
    .from('inventory_virtual')
    .select('sku, product_name, variant_name');

  console.log('[OrderSync] 📡 QUERY 1 COMPLETE:', {
    success: !inventoryError,
    rowCount: inventory?.length || 0,
    errorMessage: inventoryError?.message || null,
    errorCode: inventoryError?.code || null
  });

  // Use inventory for SKU matching, or empty array if unavailable
  const inventoryItems = inventoryError ? [] : (inventory || []);

  if (inventoryError) {
    // DIAGNOSTIC: Log full error details
    console.error('[OrderSync] Inventory query error details:', {
      message: inventoryError.message,
      code: inventoryError.code,
      details: inventoryError.details,
      hint: inventoryError.hint
    });
    console.warn('[OrderSync] ⚠️ Inventory unavailable, continuing with fallback SKU matching');
  } else {
    console.log(`[OrderSync] Loaded ${inventoryItems.length} inventory items for SKU matching`);
  }

  // Get order events from webhook_events
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);

  const { data: webhookEvents, error: webhookError } = await client
    .from('webhook_events')
    .select('*')
    .eq('event_type', 'wix.order.created')
    .gte('received_at', lookbackDate.toISOString())
    .order('received_at', { ascending: false });

  if (webhookError) {
    throw new Error(`Failed to load webhook events: ${webhookError.message}`);
  }

  console.log(`[OrderSync] Found ${webhookEvents.length} order events`);

  let synced = 0;
  let skipped = 0;
  let errors = 0;

  // Parse each webhook event
  for (const event of webhookEvents) {
    try {
      let rawPayload = event.raw_payload;
      let needsPayloadUpdate = false;

      // raw_payload is stored as a JSON string in JSONB column
      // Parse it once and update the row so SQL queries work
      if (typeof rawPayload === 'string') {
        // Remove "Webhooks → Custom webhook →" prefix if present
        const prefixMatch = rawPayload.match(/^Webhooks\s*→\s*Custom webhook\s*→\s*(.+)$/s);
        if (prefixMatch) {
          rawPayload = prefixMatch[1];
        }

        // Parse JSON string to object
        try {
          rawPayload = JSON.parse(rawPayload);
          needsPayloadUpdate = true; // Mark for update
        } catch (parseError) {
          console.error(`[OrderSync] Failed to parse JSON for event ${event.id}:`, parseError.message);
          skipped++;
          continue;
        }
      }

      // Update webhook_events.raw_payload with parsed JSON object
      // This fixes SQL queries: raw_payload->>'orderId' will now work
      if (needsPayloadUpdate) {
        const { error: updateError } = await client
          .from('webhook_events')
          .update({ raw_payload: rawPayload })
          .eq('id', event.id);

        if (updateError) {
          console.warn(`[OrderSync] Failed to update raw_payload for event ${event.id}:`, updateError.message);
          // Continue processing - this is not fatal
        } else {
          console.log(`[OrderSync] Fixed raw_payload for event ${event.id}`);
        }
      }

      // Handle both wrapped and flat JSON structures
      // Wix webhooks send flat structure: { orderNumber, payments, lineItems }
      // Not wrapped: { data: { orderNumber, ... } }
      const data = rawPayload?.data || rawPayload;

      if (!data || !data.orderNumber) {
        console.warn(`[OrderSync] No valid order data in event ${event.id}`);
        skipped++;
        continue;
      }

      const orderNumber = data.orderNumber;
      const lineItems = data.lineItems || [];

      // CRITICAL: Extract actual order timestamp (NOT ingestion time)
      const orderTimestamp = extractOrderTimestamp(data, event.received_at);

      if (lineItems.length === 0) {
        console.warn(`[OrderSync] Order ${orderNumber} has no line items`);
        skipped++;
        continue;
      }

      // Build line item rows
      const orderRows = [];

      for (const item of lineItems) {
        // Parse product name to extract strain and unit
        const itemName = item.itemName || item.productName?.original || 'Unknown';
        let { strain, unit } = parseProductName(itemName);

        // Priority 1: descriptionLines — Wix sends variant in
        //   descriptionLines[{name:"Weight", description:"28 G"}]
        if (unit === 'unknown' && Array.isArray(item.descriptionLines)) {
          for (const line of item.descriptionLines) {
            if (line && line.name) {
              const lineName = line.name.toLowerCase();
              if (lineName === 'weight' || lineName === 'size' || lineName === 'unit') {
                const extracted = (line.description || line.value || '').trim();
                if (extracted) {
                  unit = normalizeUnit(extracted);
                  break;
                }
              }
            }
          }
        }

        // Priority 2: item.options weight field
        if (unit === 'unknown' && Array.isArray(item.options)) {
          const weightOpt = item.options.find(
            opt => opt.option && opt.option.toLowerCase().includes('weight')
          );
          if (weightOpt && weightOpt.selection) {
            unit = normalizeUnit(weightOpt.selection);
          }
        }

        // Ensure final unit is always normalized (guards against any raw value
        // that made it through without hitting normalizeUnit above)
        unit = normalizeUnit(unit);

        // Map to inventory_live SKU format (async catalog lookup)
        const sku = await findMatchingSKU(strain, unit, inventoryItems, itemName);

        orderRows.push({
          order_id: orderNumber,
          order_date: orderTimestamp,
          created_at: orderTimestamp,  // ACTUAL ORDER TIME, NOT NOW()
          sku: sku || `unknown_${orderNumber}_${strain.substring(0, 10)}`,
          strain: strain,
          unit: unit,
          quality: null,
          quantity: item.quantity || 1,
          price_per_unit: parseFloat(item.totalPrice?.value || item.price || 0),
          total_amount: parseFloat(item.totalPrice?.value || 0) * (item.quantity || 1),
          customer_id: data.buyerId || null,
          notes: item.descriptionLines?.map(d => `${d.name}: ${d.description}`).join(', ') || null
        });
      }

      // SINGLE DETERMINISTIC UPSERT - NO FALLBACKS
      // Requires unique constraint: (order_id, sku)
      if (orderRows.length > 0) {
        const { error: upsertError } = await client
          .from('orders')
          .upsert(orderRows, {
            onConflict: 'order_id,sku',
            ignoreDuplicates: true
          });

        if (upsertError) {
          // Hard fail - do not attempt insert fallback
          console.error(`[OrderSync] UPSERT FAILED for order ${orderNumber}: ${upsertError.message}`);
          console.error(`[OrderSync] Ensure unique constraint exists: ALTER TABLE orders ADD CONSTRAINT orders_order_id_sku_unique UNIQUE (order_id, sku);`);
          errors++;
          continue;
        }

        synced += orderRows.length;
        console.log(`[OrderSync] ✅ Order ${orderNumber}: ${orderRows.length} items @ ${orderTimestamp}`);
      }

    } catch (err) {
      console.error(`[OrderSync] Error processing event ${event.id}:`, err.message);
      errors++;
    }
  }

  console.log(`[OrderSync] Complete: ${synced} items synced, ${skipped} skipped, ${errors} errors`);

  return { synced, skipped, errors };
}

/**
 * Normalize a raw unit string to a canonical stored form.
 *
 * Canonical values:
 *   Weight:       '3.5g', '7g', '14g', '28g', '1g', '2g'
 *   Product type: 'cartridge', 'gummies', 'preroll'
 *   Unknown:      'unknown'
 *
 * This runs on EVERY unit value before it is written to orders.unit.
 * It is the single source of truth for unit normalization in JS.
 */
function normalizeUnit(raw) {
  if (!raw) return 'unknown';

  let u = raw.toLowerCase().trim();

  // Literal 'unit' / 'units' is not a measurement
  if (u === 'unit' || u === 'units' || u === '') return 'unknown';

  // Collapse space between number and g: '28 G' → '28g', '3.5 G' → '3.5g'
  u = u.replace(/(\d+\.?\d*)\s+g\b/gi, '$1g');

  // Fraction forms
  if (/^1\s*\/\s*8$/.test(u)) return '3.5g';
  if (/^1\s*\/\s*4$/.test(u)) return '7g';
  if (/^1\s*\/\s*2$/.test(u)) return '14g';
  if (/^(1\s*oz|one\s*oz|1\s*ounce|ounce)$/i.test(u)) return '28g';

  // Word synonyms (whole-string only — avoids mangling compound names)
  if (/^eighths?$/.test(u)) return '3.5g';
  if (/^quarters?$/.test(u)) return '7g';
  if (/^half$/.test(u)) return '14g';
  if (/^ounces?$/.test(u)) return '28g';

  // Strip trailing descriptor after a weight: '1g disposable' → '1g', '2g flavored' → '2g'
  const weightDesc = u.match(/^(\d+\.?\d*g)\s+\S/);
  if (weightDesc) u = weightDesc[1];

  // Product-type detection (check after weight stripping)
  if (/cart/.test(u))                        return 'cartridge';
  if (/gumm/.test(u))                        return 'gummies';
  if (/^disposable$/.test(u))                return '1g';
  if (/(pre.?roll|preroll|^roll$)/.test(u))  return 'preroll';

  // Already a canonical weight
  if (/^\d+\.?\d*g$/.test(u)) return u;

  // Return lowercased as-is (better than 'unknown' for debugging)
  return u;
}

/**
 * Parse product name to extract strain and unit.
 *
 * Priority order:
 *   1. Parenthesised weight/variant at end: "Ice cream mintz (1 G)"
 *   2. Explicit weight/synonym token at end of name string
 *   3. Weight token embedded anywhere in name: "Bubble Hash 28G"
 *   4. Product-type suffix: "Blue River Rosin Cartridge"
 *   5. Fallback: entire name is strain, unit = 'unknown'
 *
 * All returned units pass through normalizeUnit() so values are
 * always in canonical form before being stored.
 */
function parseProductName(name) {
  if (!name || name === 'Unknown') {
    return { strain: 'Unknown', unit: 'unknown' };
  }

  // 1. Parenthesised weight/variant at end: "Ice cream mintz (1 G)"
  const parenMatch = name.match(/^(.+?)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    return {
      strain: parenMatch[1].trim(),
      unit: normalizeUnit(parenMatch[2].trim()),
    };
  }

  // 2. Explicit weight token at end (handles space-separated formats)
  const weightSuffix = name.match(
    /^(.+?)\s+((?:\d+\.?\d*)\s*[Gg]|1\/[248]|eighth|quarter|half|ounce|oz)(\s+.*)?$/i
  );
  if (weightSuffix) {
    const rawUnit = (weightSuffix[2] + (weightSuffix[3] || '')).trim();
    return {
      strain: weightSuffix[1].trim(),
      unit: normalizeUnit(rawUnit),
    };
  }

  // 3. Weight token embedded anywhere in name: "Bubble Hash 28G OG"
  const embeddedWeight = name.match(/(.*?)\s*\b(\d+\.?\d*)\s*[Gg]\b(.*)/);
  if (embeddedWeight) {
    const strain = (embeddedWeight[1] + embeddedWeight[3]).trim().replace(/\s+/g, ' ');
    return {
      strain: strain || name.trim(),
      unit: normalizeUnit(embeddedWeight[2] + 'g'),
    };
  }

  // 4. Product-type suffix
  const typeSuffix = name.match(
    /^(.+?)\s+(cartridge|cart|pre-?roll|preroll|gumm(?:y|ies)|disposable|edible)s?$/i
  );
  if (typeSuffix) {
    return {
      strain: typeSuffix[1].trim(),
      unit: normalizeUnit(typeSuffix[2].trim()),
    };
  }

  // 5. Fallback: entire name is strain
  return {
    strain: name.trim(),
    unit: 'unknown',
  };
}

/**
 * Find matching SKU from inventory_live based on product name
 * Uses catalog lookup first, then fuzzy matching as fallback
 */
async function findMatchingSKU(strain, unit, inventory, fullProductName) {
  const strainLower = strain.toLowerCase().trim();
  const unitLower = unit.toLowerCase().trim();
  const fullLower = fullProductName.toLowerCase().trim();

  // 0. Try catalog lookup first (canonical source)
  try {
    const catalogSku = await lookupCatalogSku({ strain, unit, brand: null, category: null });
    if (catalogSku) {
      return catalogSku;
    }
  } catch (err) {
    // Catalog lookup failed, continue with fallback matching
  }

  // 1. Try exact strain + unit match
  // inventory_virtual columns: product_name (strain), variant_name (unit)
  for (const inv of inventory) {
    const invStrain = (inv.product_name || '').toLowerCase().trim();
    const invUnit = (inv.variant_name || '').toLowerCase().trim();

    if (invStrain === strainLower && invUnit === unitLower) {
      return inv.sku;
    }
  }

  // 2. Try strain contains or contained by
  for (const inv of inventory) {
    const invStrain = (inv.product_name || '').toLowerCase().trim();

    if (invStrain.includes(strainLower) || strainLower.includes(invStrain)) {
      return inv.sku;
    }
  }

  // 3. Try full product name match
  for (const inv of inventory) {
    const invFull = (inv.product_name || '').toLowerCase().trim();

    if (fullLower.includes(invFull) || invFull.includes(fullLower)) {
      return inv.sku;
    }
  }

  // 4. Fallback: generate normalized SKU (will not match velocity, but allows sync)
  const normalizedStrain = strainLower.replace(/[^a-z0-9]+/g, '_');
  const normalizedUnit = unitLower.replace(/[^a-z0-9]+/g, '_');

  return `${normalizedStrain}_${normalizedUnit}`;
}

/**
 * Auto-sync orders (run on server startup)
 */
export async function autoSyncOrders() {
  try {
    console.log('[OrderSync] Starting automatic order sync...');
    const result = await syncOrdersFromWebhooks(30); // Last 30 days

    if (result.synced > 0) {
      console.log(`[OrderSync] ✅ Auto-sync complete: ${result.synced} new order items`);
    } else {
      console.log('[OrderSync] ✅ Auto-sync complete: no new orders');
    }

    return result;
  } catch (err) {
    console.error('[OrderSync] Auto-sync failed:', err.message);
    return { synced: 0, skipped: 0, errors: 1 };
  }
}
