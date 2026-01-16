/**
 * OMEN INVENTORY RESOLVER
 *
 * Canonical Line Item Parsing & Inventory Resolution Layer
 *
 * PURPOSE:
 * - Deterministic parsing of Wix webhook line items
 * - Exact matching to inventory_live records
 * - Foundation for inventory accuracy, forecasting, and agent reasoning
 *
 * CONSTRAINTS:
 * - Pure functions only (no side effects)
 * - No database queries (operates on pre-loaded data)
 * - No mutation of inventory
 * - Deterministic and auditable
 *
 * SOURCE OF TRUTH: inventory_live (sole inventory table)
 */

// ============================================================================
// NORMALIZATION HELPERS
// ============================================================================

/**
 * Normalize a string for matching: lowercase, strip punctuation, trim whitespace
 *
 * @param {string} str - Input string
 * @returns {string} - Normalized string
 *
 * @example
 * normalize("Bacio Gelato!") → "bacio gelato"
 * normalize("  Blue-Mints  ") → "blue mints"
 */
export function normalize(str) {
  if (str === null || str === undefined) {
    return '';
  }

  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ');    // Collapse multiple spaces
}

/**
 * Normalize a unit string with special handling for weight formats
 *
 * @param {string} unit - Unit string (e.g., "28g", "1/8 OZ", "1 G")
 * @returns {string} - Normalized unit string
 *
 * @example
 * normalizeUnit("28g") → "28g"
 * normalizeUnit("28 G") → "28g"
 * normalizeUnit("1/8 OZ") → "1/8oz"
 */
export function normalizeUnit(unit) {
  if (unit === null || unit === undefined) {
    return '';
  }

  return String(unit)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '')     // Remove all spaces: "28 G" → "28g"
    .replace(/[^\w\/]/g, ''); // Keep alphanumeric and slashes for fractions
}

/**
 * Generate a deterministic match key from strain + unit
 * Used for exact matching when catalogItemId is unavailable
 *
 * @param {string} strain - Product strain/name
 * @param {string} unit - Product unit
 * @returns {string} - Composite match key
 */
export function generateMatchKey(strain, unit) {
  return `${normalize(strain)}|${normalizeUnit(unit)}`;
}

// ============================================================================
// LINE ITEM PARSING
// ============================================================================

/**
 * Parse a Wix webhook line item into a normalized structure
 *
 * PURE FUNCTION: No side effects, deterministic output
 *
 * @param {Object} lineItem - Raw line item from Wix webhook
 * @param {string} lineItem.itemName - Product name
 * @param {string} lineItem.catalogItemId - Wix catalog ID
 * @param {number} lineItem.quantity - Quantity ordered
 * @param {Array} lineItem.descriptionLines - Optional metadata array
 *
 * @returns {Object} Parsed line item with normalized fields
 *
 * @example
 * parseLineItem({
 *   itemName: "Bacio Gelato",
 *   catalogItemId: "abc-123",
 *   quantity: 2,
 *   descriptionLines: [{ name: "Weight", description: "28g" }]
 * })
 * // Returns:
 * // {
 * //   catalogItemId: "abc-123",
 * //   itemName: "Bacio Gelato",
 * //   itemNameNormalized: "bacio gelato",
 * //   unit: "28g",
 * //   unitNormalized: "28g",
 * //   quantity: 2,
 * //   matchKey: "bacio gelato|28g",
 * //   _raw: { ... },  // Original for debugging
 * //   _parseMetadata: { ... }  // Extension point for confidence scores
 * // }
 */
export function parseLineItem(lineItem) {
  // Validate input
  if (!lineItem || typeof lineItem !== 'object') {
    throw new Error('parseLineItem: Invalid input - expected object');
  }

  // Extract core fields
  const catalogItemId = lineItem.catalogItemId || null;
  const itemName = lineItem.itemName || lineItem.name || '';
  const quantity = typeof lineItem.quantity === 'number'
    ? lineItem.quantity
    : parseInt(lineItem.quantity, 10) || 1;

  // Extract unit from descriptionLines
  let unit = '';
  if (Array.isArray(lineItem.descriptionLines)) {
    for (const line of lineItem.descriptionLines) {
      if (line && line.name) {
        const lineName = line.name.toLowerCase();
        if (lineName === 'weight' || lineName === 'size' || lineName === 'unit') {
          unit = line.description || line.value || '';
          break;
        }
      }
    }
  }

  // Fallback: try to extract unit from options or variant
  if (!unit && lineItem.options) {
    const weightOption = lineItem.options.find(
      opt => opt.option && opt.option.toLowerCase().includes('weight')
    );
    if (weightOption) {
      unit = weightOption.selection || '';
    }
  }

  // Build normalized values
  const itemNameNormalized = normalize(itemName);
  const unitNormalized = normalizeUnit(unit);
  const matchKey = generateMatchKey(itemName, unit);

  return {
    // Core identifiers
    catalogItemId,
    itemName,
    itemNameNormalized,
    unit,
    unitNormalized,
    quantity,
    matchKey,

    // Debugging: preserve original payload
    _raw: lineItem,

    // =========================================================================
    // EXTENSION POINT: Future metadata for agent reasoning
    // =========================================================================
    // This object can later be extended to include:
    // - confidence: 0.0-1.0 parsing confidence score
    // - ambiguityFlags: array of potential parsing issues
    // - alternativeUnits: other possible unit interpretations
    // - sourceWebhook: reference to originating webhook for tracing
    _parseMetadata: {
      parsedAt: new Date().toISOString(),
      version: '1.0.0',
      // Future: confidence, ambiguityFlags, alternativeUnits
    }
  };
}

// ============================================================================
// INVENTORY RESOLUTION
// ============================================================================

/**
 * Resolve a parsed line item to exactly one inventory row
 *
 * PURE FUNCTION: No side effects, no mutations
 *
 * Resolution Strategy:
 * 1. Exact match by catalogItemId (if inventory has wix_catalog_id column)
 * 2. Exact match by normalized strain + unit
 * 3. Fallback: normalized name matching with unit
 *
 * @param {Object} parsedItem - Output from parseLineItem()
 * @param {Array} inventoryRows - Pre-loaded inventory_live rows
 *
 * @returns {Object} Resolution result with matched inventory row
 *
 * @throws {Error} If zero matches found (explicit, human-readable)
 * @throws {Error} If multiple matches found (explicit, human-readable)
 *
 * @example
 * const result = resolveInventoryItem(parsedItem, inventory);
 * // Returns:
 * // {
 * //   matched: true,
 * //   inventoryItem: { id, sku, strain, unit, quantity },
 * //   matchMethod: 'exact_strain_unit',
 * //   _resolutionMetadata: { ... }  // Extension point
 * // }
 */
export function resolveInventoryItem(parsedItem, inventoryRows) {
  // Validate inputs
  if (!parsedItem || typeof parsedItem !== 'object') {
    throw new Error('resolveInventoryItem: Invalid parsedItem - expected object');
  }

  if (!Array.isArray(inventoryRows)) {
    throw new Error('resolveInventoryItem: Invalid inventoryRows - expected array');
  }

  if (inventoryRows.length === 0) {
    throw new Error(
      `resolveInventoryItem: No inventory loaded. ` +
      `Cannot resolve "${parsedItem.itemName}" (${parsedItem.unit})`
    );
  }

  const candidates = [];
  let matchMethod = null;

  // -------------------------------------------------------------------------
  // STRATEGY 1: Exact match by catalogItemId
  // -------------------------------------------------------------------------
  if (parsedItem.catalogItemId) {
    for (const row of inventoryRows) {
      // Check if inventory has wix_catalog_id or catalog_item_id column
      const rowCatalogId = row.wix_catalog_id || row.catalog_item_id || row.catalogItemId;
      if (rowCatalogId && rowCatalogId === parsedItem.catalogItemId) {
        candidates.push(row);
        matchMethod = 'catalog_id';
      }
    }
  }

  // -------------------------------------------------------------------------
  // STRATEGY 2: Exact match by normalized strain + unit
  // -------------------------------------------------------------------------
  if (candidates.length === 0) {
    const targetKey = parsedItem.matchKey;

    for (const row of inventoryRows) {
      const rowStrain = row.strain || row.product_name || '';
      const rowUnit = row.unit || '';
      const rowKey = generateMatchKey(rowStrain, rowUnit);

      if (rowKey === targetKey) {
        candidates.push(row);
        matchMethod = 'exact_strain_unit';
      }
    }
  }

  // -------------------------------------------------------------------------
  // STRATEGY 3: Fallback - normalized name contains matching
  // -------------------------------------------------------------------------
  if (candidates.length === 0) {
    const targetName = parsedItem.itemNameNormalized;
    const targetUnit = parsedItem.unitNormalized;

    for (const row of inventoryRows) {
      const rowStrain = normalize(row.strain || row.product_name || '');
      const rowUnit = normalizeUnit(row.unit || '');

      // Check if names match (contains in either direction)
      const nameMatches = rowStrain.includes(targetName) || targetName.includes(rowStrain);

      // Check if units match
      const unitMatches = !targetUnit || !rowUnit || rowUnit === targetUnit;

      if (nameMatches && unitMatches && targetName.length > 2) {
        candidates.push(row);
        matchMethod = 'fuzzy_name_unit';
      }
    }
  }

  // -------------------------------------------------------------------------
  // RESOLUTION OUTCOME
  // -------------------------------------------------------------------------

  // NO MATCH: Explicit error with actionable details
  if (candidates.length === 0) {
    throw new Error(
      `INVENTORY_NO_MATCH: Could not find inventory for ` +
      `"${parsedItem.itemName}" (unit: ${parsedItem.unit || 'none'}). ` +
      `Searched ${inventoryRows.length} inventory rows. ` +
      `This product may not exist in inventory_live or has a naming mismatch.`
    );
  }

  // MULTIPLE MATCHES: Explicit error with candidate list
  if (candidates.length > 1) {
    const candidateList = candidates
      .slice(0, 5) // Limit to 5 for readability
      .map(c => `  - SKU: ${c.sku}, Strain: ${c.strain || c.product_name}, Unit: ${c.unit}`)
      .join('\n');

    throw new Error(
      `INVENTORY_MULTIPLE_MATCHES: Found ${candidates.length} inventory matches for ` +
      `"${parsedItem.itemName}" (unit: ${parsedItem.unit || 'none'}). ` +
      `Ambiguous resolution requires manual intervention.\n` +
      `Candidates:\n${candidateList}`
    );
  }

  // EXACT ONE MATCH: Success
  const matchedRow = candidates[0];

  return {
    matched: true,
    inventoryItem: {
      id: matchedRow.id,
      sku: matchedRow.sku,
      strain: matchedRow.strain || matchedRow.product_name,
      unit: matchedRow.unit,
      quantity: matchedRow.quantity,
      // Include any other useful fields
      brand: matchedRow.brand,
      quality: matchedRow.quality
    },
    matchMethod,

    // =========================================================================
    // EXTENSION POINT: Future metadata for agent reasoning
    // =========================================================================
    // This object can later be extended to include:
    // - confidence: 0.0-1.0 match confidence score
    // - alternativeMatches: near-miss candidates for review
    // - matchScore: numeric similarity score
    // - forecastImpact: predicted velocity impact of this sale
    _resolutionMetadata: {
      resolvedAt: new Date().toISOString(),
      candidatesEvaluated: inventoryRows.length,
      matchMethod,
      version: '1.0.0',
      // Future: confidence, alternativeMatches, matchScore, forecastImpact
    }
  };
}

// ============================================================================
// BATCH PROCESSING HELPERS
// ============================================================================

/**
 * Parse and resolve all line items from an order
 *
 * Returns results for ALL items, including failures (does not throw)
 *
 * @param {Array} lineItems - Array of raw line items from webhook
 * @param {Array} inventoryRows - Pre-loaded inventory_live rows
 *
 * @returns {Object} Batch result with successes and failures
 *
 * @example
 * const result = resolveOrderLineItems(order.lineItems, inventory);
 * // Returns:
 * // {
 * //   resolved: [ { parsedItem, inventoryItem, matchMethod } ],
 * //   unresolved: [ { parsedItem, error } ],
 * //   summary: { total: 3, resolved: 2, unresolved: 1 }
 * // }
 */
export function resolveOrderLineItems(lineItems, inventoryRows) {
  if (!Array.isArray(lineItems)) {
    return {
      resolved: [],
      unresolved: [],
      summary: { total: 0, resolved: 0, unresolved: 0 }
    };
  }

  const resolved = [];
  const unresolved = [];

  for (const lineItem of lineItems) {
    try {
      // Parse the line item
      const parsedItem = parseLineItem(lineItem);

      // Resolve to inventory
      const resolution = resolveInventoryItem(parsedItem, inventoryRows);

      resolved.push({
        parsedItem,
        inventoryItem: resolution.inventoryItem,
        matchMethod: resolution.matchMethod,
        quantity: parsedItem.quantity
      });

    } catch (error) {
      // Capture failures without throwing
      let parsedItem = null;
      try {
        parsedItem = parseLineItem(lineItem);
      } catch (parseError) {
        parsedItem = { itemName: lineItem?.itemName || 'unknown', unit: 'unknown' };
      }

      unresolved.push({
        parsedItem,
        error: error.message,
        rawLineItem: lineItem
      });
    }
  }

  return {
    resolved,
    unresolved,
    summary: {
      total: lineItems.length,
      resolved: resolved.length,
      unresolved: unresolved.length
    },

    // =========================================================================
    // EXTENSION POINT: Batch-level analytics for forecasting
    // =========================================================================
    // Future: orderVelocityImpact, inventoryHealthScore, alertTriggers
    _batchMetadata: {
      processedAt: new Date().toISOString(),
      version: '1.0.0'
    }
  };
}

// ============================================================================
// EXPORTS (CommonJS compatibility)
// ============================================================================

export default {
  // Normalization
  normalize,
  normalizeUnit,
  generateMatchKey,

  // Core functions
  parseLineItem,
  resolveInventoryItem,
  resolveOrderLineItems
};
