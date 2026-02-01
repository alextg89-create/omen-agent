/**
 * WIX CSV PARSER
 *
 * Parses Wix product catalog CSV exports into structured inventory data.
 *
 * KEY BEHAVIORS:
 * 1. Only processes VARIANT rows (these have inventory)
 * 2. Joins with parent PRODUCT row to get product name
 * 3. REQUIRES explicit SKU from CSV - rows without SKU are DROPPED
 * 4. Handles "IN_STOCK" inventory values (converts to 0 with status flag)
 *
 * STRICT EXCLUSION RULES:
 * - If SKU is empty, null, or whitespace → SKIP (reason: MISSING_SKU)
 * - If SKU duplicates another SKU → SKIP (reason: DUPLICATE_SKU)
 * - OMEN drops data, it does NOT invent data
 *
 * INPUT: CSV text content
 * OUTPUT: Array of inventory items ready for Supabase insert
 */

/**
 * Parse inventory value from CSV
 *
 * Wix inventory can be:
 * - Numeric: "6", "23", "0"
 * - Status: "IN_STOCK", "OUT_OF_STOCK"
 *
 * @param {string} inventoryValue - Raw inventory value from CSV
 * @returns {{ quantity: number, status: string }}
 */
export function parseInventoryValue(inventoryValue) {
  if (!inventoryValue || inventoryValue.trim() === '') {
    return { quantity: 0, status: 'UNKNOWN' };
  }

  const trimmed = inventoryValue.trim().toUpperCase();

  // Check for status strings
  if (trimmed === 'IN_STOCK') {
    // IN_STOCK means available but unknown quantity
    // We'll flag this so OMEN knows it's imprecise
    return { quantity: 0, status: 'IN_STOCK' };
  }

  if (trimmed === 'OUT_OF_STOCK') {
    return { quantity: 0, status: 'OUT_OF_STOCK' };
  }

  // Try to parse as number
  const parsed = parseInt(inventoryValue, 10);
  if (!isNaN(parsed)) {
    return {
      quantity: parsed,
      status: parsed > 0 ? 'COUNTED' : 'OUT_OF_STOCK'
    };
  }

  console.warn(`[WixParser] Unknown inventory value: "${inventoryValue}"`);
  return { quantity: 0, status: 'UNKNOWN' };
}

/**
 * Parse CSV line respecting quoted fields
 *
 * @param {string} line - CSV line
 * @returns {string[]} Array of field values
 */
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields;
}

/**
 * Check if SKU is valid (non-empty, non-whitespace)
 *
 * @param {string} sku - SKU value from CSV
 * @returns {boolean}
 */
function isValidSku(sku) {
  return sku !== null && sku !== undefined && sku.trim() !== '';
}

/**
 * Parse Wix CSV content into inventory items
 *
 * STRICT EXCLUSION:
 * - Rows without valid SKU are DROPPED (not fixed)
 * - Rows with duplicate SKUs are DROPPED (not fixed)
 *
 * @param {string} csvContent - Raw CSV text
 * @returns {{ items: Array, stats: object, errors: Array, skipped: Array }}
 */
export function parseWixCsv(csvContent) {
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim());

  if (lines.length < 2) {
    throw new Error('CSV must have header row and at least one data row');
  }

  // Parse header to get column indices
  const headerLine = lines[0].replace(/^\uFEFF/, ''); // Remove BOM if present
  const headers = parseCSVLine(headerLine);

  // Map column names to indices
  const colIndex = {};
  headers.forEach((h, i) => {
    colIndex[h.trim().toLowerCase()] = i;
  });

  // Required columns (sku is now required)
  const requiredCols = ['handle', 'fieldtype', 'name', 'price', 'inventory', 'productoptionchoices1', 'visible', 'sku'];
  const missingCols = requiredCols.filter(c => colIndex[c] === undefined);
  if (missingCols.length > 0) {
    throw new Error(`Missing required columns: ${missingCols.join(', ')}`);
  }

  // First pass: build product name map from PRODUCT rows
  const productNames = new Map(); // handle -> { name, category }
  const seenSkus = new Set(); // Track SKUs for duplicate detection
  const items = [];
  const errors = [];
  const skipped = []; // Detailed skip log

  const stats = {
    totalRows: lines.length - 1,
    productRows: 0,
    variantRows: 0,
    mediaRows: 0,
    skippedRows: 0,
    inStockVariants: 0,
    countedVariants: 0
  };

  // Skip breakdown for summary
  const skippedBreakdown = {
    MISSING_SKU: 0,
    DUPLICATE_SKU: 0,
    MISSING_PARENT: 0,
    PARSE_ERROR: 0
  };

  // First pass: collect PRODUCT rows for name lookup
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const fieldType = fields[colIndex['fieldtype']]?.trim().toUpperCase();
    const handle = fields[colIndex['handle']]?.trim();

    if (fieldType === 'PRODUCT' && handle) {
      const name = fields[colIndex['name']]?.trim();
      const brand = fields[colIndex['brand']]?.trim(); // This is category in Wix

      if (name) {
        productNames.set(handle, { name, category: brand });
        stats.productRows++;
      }
    }
  }

  console.log(`[WixParser] Found ${productNames.size} products in CSV`);

  // Second pass: process VARIANT rows with STRICT SKU validation
  for (let i = 1; i < lines.length; i++) {
    try {
      const fields = parseCSVLine(lines[i]);
      const fieldType = fields[colIndex['fieldtype']]?.trim().toUpperCase();

      if (fieldType === 'MEDIA') {
        stats.mediaRows++;
        continue;
      }

      if (fieldType !== 'VARIANT') {
        continue;
      }

      stats.variantRows++;

      const handle = fields[colIndex['handle']]?.trim();
      const variantName = fields[colIndex['productoptionchoices1']]?.trim();
      const visible = fields[colIndex['visible']]?.trim().toLowerCase() === 'true';
      const priceStr = fields[colIndex['price']]?.trim();
      const compareAtStr = fields[colIndex['strikethroughprice']]?.trim();
      const costStr = fields[colIndex['cost']]?.trim();
      const inventoryStr = fields[colIndex['inventory']]?.trim();

      // STRICT: Read SKU directly from CSV column
      const rawSku = fields[colIndex['sku']];
      const sku = rawSku?.trim();

      // EXCLUSION RULE 1: Missing SKU → DROP ROW
      if (!isValidSku(sku)) {
        skippedBreakdown.MISSING_SKU++;
        stats.skippedRows++;
        skipped.push({
          line: i + 1,
          reason: 'MISSING_SKU',
          handle,
          variantName,
          rawSku: rawSku === undefined ? 'undefined' : rawSku === null ? 'null' : `"${rawSku}"`
        });
        console.log(`[WixParser] SKIP line ${i + 1}: MISSING_SKU (handle=${handle}, variant=${variantName})`);
        continue;
      }

      // EXCLUSION RULE 2: Duplicate SKU → DROP ROW
      if (seenSkus.has(sku)) {
        skippedBreakdown.DUPLICATE_SKU++;
        stats.skippedRows++;
        skipped.push({
          line: i + 1,
          reason: 'DUPLICATE_SKU',
          sku,
          handle,
          variantName
        });
        console.log(`[WixParser] SKIP line ${i + 1}: DUPLICATE_SKU (sku=${sku})`);
        continue;
      }

      // Mark SKU as seen
      seenSkus.add(sku);

      // Get product name from parent PRODUCT row
      const productInfo = productNames.get(handle);
      if (!productInfo) {
        skippedBreakdown.MISSING_PARENT++;
        stats.skippedRows++;
        skipped.push({
          line: i + 1,
          reason: 'MISSING_PARENT',
          sku,
          handle
        });
        console.log(`[WixParser] SKIP line ${i + 1}: MISSING_PARENT (sku=${sku}, handle=${handle})`);
        continue;
      }

      // Parse inventory
      const { quantity, status } = parseInventoryValue(inventoryStr);

      if (status === 'IN_STOCK') {
        stats.inStockVariants++;
      } else if (status === 'COUNTED') {
        stats.countedVariants++;
      }

      // Parse prices
      const retail = priceStr ? parseFloat(priceStr) : null;
      const compareAt = compareAtStr ? parseFloat(compareAtStr) : null;
      const cost = costStr ? parseFloat(costStr) : null;

      items.push({
        sku,
        product_id: handle,
        product_name: productInfo.name,
        variant_name: variantName || null,
        category: productInfo.category || null,
        retail: isNaN(retail) ? null : retail,
        compare_at: isNaN(compareAt) ? null : compareAt,
        cost: isNaN(cost) ? null : cost,
        quantity_on_hand: quantity,
        inventory_status: status,
        visible,
        source: 'wix_csv'
      });

    } catch (err) {
      skippedBreakdown.PARSE_ERROR++;
      stats.skippedRows++;
      errors.push({
        line: i + 1,
        error: err.message
      });
      skipped.push({
        line: i + 1,
        reason: 'PARSE_ERROR',
        error: err.message
      });
    }
  }

  // Build summary object (required format)
  const summary = {
    rows_processed: stats.variantRows,
    rows_inserted: items.length,
    rows_skipped: stats.skippedRows,
    skipped_breakdown: {
      MISSING_SKU: skippedBreakdown.MISSING_SKU,
      DUPLICATE_SKU: skippedBreakdown.DUPLICATE_SKU
    }
  };

  console.log(`[WixParser] ========== PARSE SUMMARY ==========`);
  console.log(`[WixParser] rows_processed: ${summary.rows_processed}`);
  console.log(`[WixParser] rows_inserted: ${summary.rows_inserted}`);
  console.log(`[WixParser] rows_skipped: ${summary.rows_skipped}`);
  console.log(`[WixParser] skipped_breakdown: MISSING_SKU=${summary.skipped_breakdown.MISSING_SKU}, DUPLICATE_SKU=${summary.skipped_breakdown.DUPLICATE_SKU}`);
  console.log(`[WixParser] =======================================`);

  if (skipped.length > 0) {
    console.warn(`[WixParser] ${skipped.length} rows excluded (not fixed, dropped)`);
  }

  return { items, stats, errors, skipped, summary };
}

/**
 * Validate parsed items before Supabase insert
 *
 * @param {Array} items - Parsed inventory items
 * @returns {{ valid: Array, invalid: Array }}
 */
export function validateItems(items) {
  const valid = [];
  const invalid = [];

  for (const item of items) {
    const issues = [];

    if (!item.sku) issues.push('missing sku');
    if (!item.product_id) issues.push('missing product_id');
    if (!item.product_name) issues.push('missing product_name');

    if (issues.length > 0) {
      invalid.push({ item, issues });
    } else {
      valid.push(item);
    }
  }

  return { valid, invalid };
}
