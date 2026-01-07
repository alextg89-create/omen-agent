/**
 * NJWeedWizard Inventory Ingest
 * MODE: Bottom section (in-house inventory counts)
 * OUTPUT: Canonical inventory rows
 */

export function ingestNjWeedWizardCsv(rows = []) {
  const UNIT_COLUMNS = [
    { key: "OZ", unit: "oz" },
    { key: "1/2", unit: "half" },
    { key: "1/4", unit: "quarter" },
    { key: "1/8", unit: "eighth" }
  ];

  const normalized = [];

  for (const row of rows) {
    const strain = row["STRAIN"] || row["Strain"];
    const quality = row["QUALITY"] || "STANDARD";

    if (!strain) continue;

    for (const { key, unit } of UNIT_COLUMNS) {
      const quantity = Number(row[key]);

      if (!Number.isFinite(quantity) || quantity <= 0) continue;

      normalized.push({
        strain,
        quality,
        unit,
        quantity
      });
    }
  }

  return normalized;
}

