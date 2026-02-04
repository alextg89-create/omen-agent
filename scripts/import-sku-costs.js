/**
 * SKU Cost Ledger Import Script
 *
 * Parses the authoritative Excel/CSV cost ledger and generates SQL
 * to populate public.sku_costs table.
 *
 * Usage: node scripts/import-sku-costs.js <path-to-csv>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line args
const csvPath = process.argv[2] || path.join(__dirname, '..', 'data', 'omen_cost_ledger_v1.csv');

if (!fs.existsSync(csvPath)) {
  console.error(`ERROR: CSV file not found at ${csvPath}`);
  process.exit(1);
}

console.log(`Parsing cost ledger: ${csvPath}\n`);

// Read and parse CSV
const csvContent = fs.readFileSync(csvPath, 'utf-8');
const lines = csvContent.split('\n');

// Parse header to find column indices
const header = parseCSVLine(lines[0]);
const skuIndex = header.indexOf('sku');
const costIndex = header.indexOf('cost');
const fieldTypeIndex = header.indexOf('fieldType');

console.log(`Column indices - SKU: ${skuIndex}, Cost: ${costIndex}, FieldType: ${fieldTypeIndex}`);

if (skuIndex === -1 || costIndex === -1 || fieldTypeIndex === -1) {
  console.error('ERROR: Required columns not found in CSV');
  process.exit(1);
}

// Extract SKU/cost pairs from VARIANT rows
const validCosts = [];
const invalidCosts = [];
const seenSkus = new Set();

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;

  const cols = parseCSVLine(line);
  const fieldType = cols[fieldTypeIndex]?.trim();

  // Only process VARIANT rows (they contain SKU data)
  if (fieldType !== 'VARIANT') continue;

  const sku = cols[skuIndex]?.trim();
  const rawCost = cols[costIndex]?.trim();

  if (!sku) continue;

  // Check for duplicate SKUs
  if (seenSkus.has(sku)) {
    console.warn(`WARNING: Duplicate SKU found: ${sku}`);
    continue;
  }
  seenSkus.add(sku);

  // Parse cost value (remove $, whitespace, handle NA)
  const cost = parseCost(rawCost);

  if (cost !== null) {
    validCosts.push({ sku, cost });
  } else {
    invalidCosts.push({ sku, rawCost: rawCost || '(empty)' });
  }
}

console.log(`\n========================================`);
console.log(`PARSING RESULTS`);
console.log(`========================================`);
console.log(`Valid SKU/cost pairs: ${validCosts.length}`);
console.log(`Invalid/missing costs: ${invalidCosts.length}`);

if (invalidCosts.length > 0) {
  console.log(`\nSKUs WITHOUT VALID COST:`);
  invalidCosts.forEach(({ sku, rawCost }) => {
    console.log(`  - ${sku}: ${rawCost}`);
  });
}

// Generate SQL
console.log(`\n========================================`);
console.log(`GENERATING SQL`);
console.log(`========================================\n`);

const sqlStatements = [];

// Truncate existing data for clean authoritative import
sqlStatements.push(`-- =====================================================`);
sqlStatements.push(`-- SKU COST AUTHORITATIVE IMPORT`);
sqlStatements.push(`-- Generated: ${new Date().toISOString()}`);
sqlStatements.push(`-- Source: ${path.basename(csvPath)}`);
sqlStatements.push(`-- Valid costs: ${validCosts.length}`);
sqlStatements.push(`-- Invalid/missing: ${invalidCosts.length}`);
sqlStatements.push(`-- =====================================================`);
sqlStatements.push(``);
sqlStatements.push(`-- Clear existing data (authoritative replace)`);
sqlStatements.push(`TRUNCATE TABLE public.sku_costs;`);
sqlStatements.push(``);
sqlStatements.push(`-- Insert all valid SKU costs`);
sqlStatements.push(`INSERT INTO public.sku_costs (sku, unit_cost, effective_date, source) VALUES`);

const valueRows = validCosts.map(({ sku, cost }, idx) => {
  const escapedSku = sku.replace(/'/g, "''"); // Escape single quotes
  const comma = idx < validCosts.length - 1 ? ',' : ';';
  return `  ('${escapedSku}', ${cost.toFixed(2)}, NOW(), 'excel_authoritative_import')${comma}`;
});

sqlStatements.push(...valueRows);

// Add verification queries
sqlStatements.push(``);
sqlStatements.push(`-- =====================================================`);
sqlStatements.push(`-- VERIFICATION QUERIES`);
sqlStatements.push(`-- =====================================================`);
sqlStatements.push(``);
sqlStatements.push(`-- Count imported costs`);
sqlStatements.push(`SELECT COUNT(*) as total_costs FROM public.sku_costs;`);
sqlStatements.push(``);
sqlStatements.push(`-- Check cost coverage against inventory`);
sqlStatements.push(`SELECT`);
sqlStatements.push(`  (SELECT COUNT(*) FROM wix_inventory_live) as total_inventory_skus,`);
sqlStatements.push(`  (SELECT COUNT(*) FROM sku_costs) as total_cost_skus,`);
sqlStatements.push(`  (SELECT COUNT(*) FROM wix_inventory_live i INNER JOIN sku_costs c ON c.sku = i.sku) as matched_skus,`);
sqlStatements.push(`  ROUND(`);
sqlStatements.push(`    (SELECT COUNT(*) FROM wix_inventory_live i INNER JOIN sku_costs c ON c.sku = i.sku)::numeric /`);
sqlStatements.push(`    NULLIF((SELECT COUNT(*) FROM wix_inventory_live), 0) * 100, 2`);
sqlStatements.push(`  ) as cost_coverage_percent;`);
sqlStatements.push(``);
sqlStatements.push(`-- SKUs in inventory without cost (UNMAPPED)`);
sqlStatements.push(`SELECT i.sku, i.product_name, 'UNMAPPED_SKU' as status`);
sqlStatements.push(`FROM wix_inventory_live i`);
sqlStatements.push(`LEFT JOIN sku_costs c ON c.sku = i.sku`);
sqlStatements.push(`WHERE c.sku IS NULL`);
sqlStatements.push(`ORDER BY i.sku;`);
sqlStatements.push(``);
sqlStatements.push(`-- SKUs in cost table not in inventory (orphaned)`);
sqlStatements.push(`SELECT c.sku, 'COST_NO_INVENTORY' as status`);
sqlStatements.push(`FROM sku_costs c`);
sqlStatements.push(`LEFT JOIN wix_inventory_live i ON i.sku = c.sku`);
sqlStatements.push(`WHERE i.sku IS NULL`);
sqlStatements.push(`ORDER BY c.sku;`);

const sql = sqlStatements.join('\n');

// Write SQL file
const outputPath = path.join(__dirname, '..', 'migrations', '005_sku_costs_data.sql');
fs.writeFileSync(outputPath, sql);
console.log(`SQL written to: ${outputPath}`);

// Also output to console
console.log(`\n========================================`);
console.log(`SQL PREVIEW (first 50 rows)`);
console.log(`========================================\n`);
console.log(sqlStatements.slice(0, 60).join('\n'));
console.log(`\n... (${validCosts.length} total rows)`);

console.log(`\n========================================`);
console.log(`NEXT STEPS`);
console.log(`========================================`);
console.log(`1. Review the generated SQL at: ${outputPath}`);
console.log(`2. Run migration against Supabase:`);
console.log(`   psql $DATABASE_URL -f migrations/005_sku_costs_data.sql`);
console.log(`3. Verify cost coverage in OMEN dashboard`);

// Helper functions
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseCost(rawCost) {
  if (!rawCost) return null;

  // Handle NA, na, N/A, etc.
  const normalized = rawCost.toLowerCase().trim();
  if (normalized === 'na' || normalized === 'n/a' || normalized === '' || normalized === 'in_stock') {
    return null;
  }

  // Remove $ and whitespace, parse as number
  const cleaned = rawCost.replace(/[$\s]/g, '');
  const cost = parseFloat(cleaned);

  if (isNaN(cost) || cost < 0) {
    return null;
  }

  return cost;
}
