/**
 * SKU RESOLVER
 *
 * Resolves order line item names to canonical inventory SKUs
 *
 * Match Strategy (in order):
 * 1. Exact SKU match (if already canonical)
 * 2. Exact strain match (normalized)
 * 3. Partial strain match (contains)
 * 4. Fallback: generate normalized slug (flagged as unmatched)
 *
 * RULES:
 * - No fuzzy matching without explicit confidence
 * - All resolutions logged
 * - Unmatched items explicitly flagged
 */

/**
 * Normalize a string for matching
 * - lowercase
 * - trim whitespace
 * - remove punctuation except hyphens
 * - collapse multiple spaces/hyphens
 */
export function normalizeForMatch(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // remove punctuation except hyphen
    .replace(/\s+/g, ' ')      // collapse spaces
    .replace(/-+/g, '-')       // collapse hyphens
    .trim();
}

/**
 * Generate canonical UNMATCHED SKU from strain name
 * SINGLE SOURCE OF TRUTH for unmatched SKU generation
 *
 * Format: UNMATCHED-{UPPERCASED_ALPHANUMERIC_ONLY}
 * Example: "Blue Dream #2" -> "UNMATCHED-BLUEDREAM2"
 *
 * @param {string} strain - Strain name from order
 * @returns {string} Canonical UNMATCHED SKU
 */
export function generateUnmatchedSku(strain) {
  if (!strain) return 'UNMATCHED-UNKNOWN';
  return 'UNMATCHED-' + strain.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Build a lookup index from inventory
 * @param {Array} inventory - inventory_live rows
 * @returns {Object} - { byExactSku, byNormalizedStrain, all }
 */
export function buildInventoryIndex(inventory) {
  const byExactSku = new Map();
  const byNormalizedStrain = new Map();

  for (const item of inventory) {
    // Index by exact SKU
    byExactSku.set(item.sku, item);

    // Index by normalized strain
    const normalizedStrain = normalizeForMatch(item.strain);
    if (normalizedStrain) {
      if (!byNormalizedStrain.has(normalizedStrain)) {
        byNormalizedStrain.set(normalizedStrain, []);
      }
      byNormalizedStrain.get(normalizedStrain).push(item);
    }
  }

  return {
    byExactSku,
    byNormalizedStrain,
    all: inventory
  };
}

/**
 * Resolve an order line item to a canonical inventory SKU
 *
 * @param {Object} lineItem - { strain, unit, sku (current) }
 * @param {Object} inventoryIndex - from buildInventoryIndex
 * @returns {Object} - { sku, matchType, confidence, originalSku, matchedItem }
 */
export function resolveToCanonicalSku(lineItem, inventoryIndex) {
  const { strain, unit, sku: currentSku } = lineItem;

  // 1. Check if current SKU is already in inventory (exact match)
  if (currentSku && inventoryIndex.byExactSku.has(currentSku)) {
    return {
      sku: currentSku,
      matchType: 'EXACT_SKU',
      confidence: 1.0,
      originalSku: currentSku,
      matchedItem: inventoryIndex.byExactSku.get(currentSku)
    };
  }

  // 2. Try exact normalized strain match
  const normalizedStrain = normalizeForMatch(strain);
  if (normalizedStrain && inventoryIndex.byNormalizedStrain.has(normalizedStrain)) {
    const matches = inventoryIndex.byNormalizedStrain.get(normalizedStrain);
    // Pick first match (could prioritize by unit if needed)
    const bestMatch = matches[0];
    return {
      sku: bestMatch.sku,
      matchType: 'EXACT_STRAIN',
      confidence: 0.95,
      originalSku: currentSku,
      matchedItem: bestMatch,
      alternateMatches: matches.length > 1 ? matches.length : undefined
    };
  }

  // 3. Try partial strain match (order strain contains inventory strain or vice versa)
  for (const [invNormStrain, items] of inventoryIndex.byNormalizedStrain) {
    if (normalizedStrain.includes(invNormStrain) || invNormStrain.includes(normalizedStrain)) {
      // Ensure minimum overlap (at least 5 chars or 50% of shorter string)
      const minLen = Math.min(normalizedStrain.length, invNormStrain.length);
      const overlapRequired = Math.max(5, Math.floor(minLen * 0.5));

      // Check actual overlap
      const overlap = normalizedStrain.includes(invNormStrain)
        ? invNormStrain.length
        : normalizedStrain.length;

      if (overlap >= overlapRequired) {
        const bestMatch = items[0];
        return {
          sku: bestMatch.sku,
          matchType: 'PARTIAL_STRAIN',
          confidence: 0.7,
          originalSku: currentSku,
          matchedItem: bestMatch,
          matchReason: `"${normalizedStrain}" ~ "${invNormStrain}"`
        };
      }
    }
  }

  // 4. Fallback: generate normalized slug (flagged as unmatched)
  const fallbackSku = generateUnmatchedSku(strain);
  return {
    sku: fallbackSku,
    matchType: 'UNMATCHED',
    confidence: 0,
    originalSku: currentSku,
    matchedItem: null,
    reason: `No inventory match for strain: "${strain}"`
  };
}

/**
 * Resolve multiple line items and return stats
 * @param {Array} lineItems - array of { strain, unit, sku }
 * @param {Array} inventory - inventory_live rows
 * @returns {Object} - { resolved: [], stats: { exact, strain, partial, unmatched } }
 */
export function resolveAllSkus(lineItems, inventory) {
  const index = buildInventoryIndex(inventory);

  const stats = {
    exactSku: 0,
    exactStrain: 0,
    partialStrain: 0,
    unmatched: 0,
    total: lineItems.length
  };

  const resolved = lineItems.map(item => {
    const result = resolveToCanonicalSku(item, index);

    switch (result.matchType) {
      case 'EXACT_SKU': stats.exactSku++; break;
      case 'EXACT_STRAIN': stats.exactStrain++; break;
      case 'PARTIAL_STRAIN': stats.partialStrain++; break;
      case 'UNMATCHED': stats.unmatched++; break;
    }

    return {
      ...item,
      resolvedSku: result.sku,
      matchType: result.matchType,
      confidence: result.confidence,
      matchedInventoryItem: result.matchedItem
    };
  });

  return { resolved, stats };
}
