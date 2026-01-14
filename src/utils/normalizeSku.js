export function normalizeSku(sku) {
  if (!sku) return '';
  return sku
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}
