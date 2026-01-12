/**
 * ORDER SYNC SERVICE
 *
 * Syncs order data from webhook_events to orders table
 * Parses Wix webhook payloads and extracts order line items
 *
 * This runs automatically to keep orders table in sync with webhook_events
 */

import { getSupabaseClient, isSupabaseAvailable } from '../db/supabaseClient.js';

/**
 * Sync orders from webhook_events to orders table
 * @param {string} lookbackDays - How many days to sync (default: 30)
 * @returns {Promise<{synced: number, skipped: number, errors: number}>}
 */
export async function syncOrdersFromWebhooks(lookbackDays = 30) {
  if (!isSupabaseAvailable()) {
    throw new Error('Supabase not configured');
  }

  const client = getSupabaseClient();

  console.log(`[OrderSync] Starting sync for last ${lookbackDays} days...`);

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

  // Get existing orders to avoid duplicates
  const { data: existingOrders, error: ordersError } = await client
    .from('orders')
    .select('order_id');

  if (ordersError) {
    throw new Error(`Failed to load existing orders: ${ordersError.message}`);
  }

  const existingOrderIds = new Set(existingOrders.map(o => o.order_id));

  let synced = 0;
  let skipped = 0;
  let errors = 0;

  // Parse each webhook event
  for (const event of webhookEvents) {
    try {
      const payload = event.raw_payload;
      const data = payload?.data;

      if (!data) {
        console.warn(`[OrderSync] No data in event ${event.id}`);
        skipped++;
        continue;
      }

      const orderNumber = data.orderNumber;
      const orderDate = data.payments?.[0]?.createdDate || event.received_at;
      const lineItems = data.lineItems || [];

      // Skip if already synced
      if (existingOrderIds.has(orderNumber)) {
        skipped++;
        continue;
      }

      // Extract line items
      const orderRows = [];

      for (const item of lineItems) {
        // Parse product name to extract strain and unit
        const itemName = item.itemName || item.productName?.original || 'Unknown';
        const { strain, unit } = parseProductName(itemName);

        // Map to inventory_live SKU format
        const sku = findMatchingSKU(strain, unit);

        orderRows.push({
          order_id: orderNumber,
          order_date: orderDate,
          sku: sku || `unknown_${Date.now()}`,
          strain: strain,
          unit: unit,
          quality: null, // Not in webhook payload
          quantity: item.quantity || 1,
          price_per_unit: parseFloat(item.totalPrice?.value || item.price || 0),
          total_amount: parseFloat(item.totalPrice?.value || 0) * (item.quantity || 1),
          customer_id: data.buyerId || null,
          notes: item.descriptionLines?.map(d => `${d.name}: ${d.description}`).join(', ') || null
        });
      }

      // Insert order rows
      if (orderRows.length > 0) {
        const { error: insertError } = await client
          .from('orders')
          .insert(orderRows);

        if (insertError) {
          console.error(`[OrderSync] Failed to insert order ${orderNumber}:`, insertError.message);
          errors++;
        } else {
          synced += orderRows.length;
          console.log(`[OrderSync] ✅ Synced order ${orderNumber} (${orderRows.length} items)`);
        }
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
 * Parse product name to extract strain and unit
 * Examples:
 *   "Blue River Rosin Cartridge" -> { strain: "Blue River Rosin", unit: "Cartridge" }
 *   "Ice cream mintz (1 G)" -> { strain: "Ice cream mintz", unit: "1 G" }
 */
function parseProductName(name) {
  // Remove parentheses content and extract
  const match = name.match(/^(.+?)\s*\(([^)]+)\)$/);

  if (match) {
    return {
      strain: match[1].trim(),
      unit: match[2].trim()
    };
  }

  // No parentheses - try to detect unit at end
  const unitPatterns = [
    /\s+(1\s*G|2\s*G|3\.5\s*G|7\s*G|14\s*G|28\s*G)$/i,
    /\s+(Cartridge|Cart|Pre-?Roll|Edible|Gummy|Gummies)$/i
  ];

  for (const pattern of unitPatterns) {
    const match = name.match(pattern);
    if (match) {
      return {
        strain: name.replace(pattern, '').trim(),
        unit: match[1].trim()
      };
    }
  }

  // Default: entire name is strain, unknown unit
  return {
    strain: name.trim(),
    unit: 'Unknown'
  };
}

/**
 * Find matching SKU from inventory_live based on strain and unit
 * This would ideally query inventory_live, but for now returns a normalized SKU
 */
function findMatchingSKU(strain, unit) {
  // Normalize to match inventory_live SKU format
  const normalizedStrain = strain.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const normalizedUnit = unit.toLowerCase().replace(/[^a-z0-9]+/g, '_');

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
