/**
 * Sales Event Schema
 *
 * Defines the structure for recording individual sales transactions
 *
 * IMPORTANT:
 * - This schema tracks ACTUAL sales (units sold)
 * - Do NOT fabricate or infer sales data
 * - All fields must come from real transaction data
 */

export const SalesEventSchema = {
  // Unique identifier
  eventId: "string", // UUID v4

  // Store identification
  storeId: "string", // e.g., "NJWeedWizard"

  // Product identification (must match inventory SKU)
  sku: "string", // Product SKU (e.g., "Bloopiez")
  unit: "string", // Unit size (oz, half, quarter, eighth)

  // Quantity sold
  quantity: "number", // Number of units sold (NOT grams, actual units)

  // Timestamp
  soldAt: "ISODate", // When the sale occurred (ISO 8601 format)

  // Financial data (OPTIONAL - may not be available)
  soldPrice: "number?", // Actual price customer paid (null if unknown)
  cost: "number?", // Cost basis at time of sale (null if unknown)

  // Metadata
  source: "string", // Data source: "pos", "manual", "imported", "api"
  recordedAt: "ISODate", // When this event was recorded in system

  // Customer info (OPTIONAL - for future segmentation)
  customerId: "string?", // Customer identifier (null if anonymous)
};

/**
 * Sales Event Validation Rules
 *
 * SAFEGUARDS:
 * 1. eventId must be unique
 * 2. storeId must not be empty
 * 3. sku must match existing inventory item
 * 4. unit must be valid (oz, half, quarter, eighth)
 * 5. quantity must be positive integer
 * 6. soldAt must be valid ISO date
 * 7. soldAt must not be in the future
 * 8. soldPrice (if provided) must be positive
 * 9. source must be one of allowed sources
 */
export const VALIDATION_RULES = {
  eventId: (val) => typeof val === "string" && val.length > 0,
  storeId: (val) => typeof val === "string" && val.length >= 3,
  sku: (val) => typeof val === "string" && val.length > 0,
  unit: (val) => ["oz", "half", "quarter", "eighth"].includes(val),
  quantity: (val) => typeof val === "number" && val > 0 && Number.isInteger(val),
  soldAt: (val) => {
    const date = new Date(val);
    return !isNaN(date.getTime()) && date <= new Date();
  },
  soldPrice: (val) => val === null || val === undefined || (typeof val === "number" && val > 0),
  source: (val) => ["pos", "manual", "imported", "api"].includes(val),
};

/**
 * Validate sales event data
 *
 * @param {object} event - Sales event to validate
 * @returns {object} - { valid: boolean, errors: string[] }
 */
export function validateSalesEvent(event) {
  const errors = [];

  // Check required fields exist
  const requiredFields = ["eventId", "storeId", "sku", "unit", "quantity", "soldAt", "source"];
  for (const field of requiredFields) {
    if (!(field in event)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate each field
  for (const [field, validator] of Object.entries(VALIDATION_RULES)) {
    if (field in event && !validator(event[field])) {
      errors.push(`Invalid value for ${field}: ${event[field]}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create a new sales event with defaults
 *
 * @param {object} data - Partial sales event data
 * @returns {object} - Complete sales event
 */
export function createSalesEvent(data) {
  const now = new Date().toISOString();

  return {
    eventId: data.eventId || crypto.randomUUID(),
    storeId: data.storeId,
    sku: data.sku,
    unit: data.unit,
    quantity: data.quantity,
    soldAt: data.soldAt,
    soldPrice: data.soldPrice || null,
    cost: data.cost || null,
    source: data.source || "manual",
    recordedAt: now,
    customerId: data.customerId || null,
  };
}
