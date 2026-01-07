const UNIT_TO_GRAMS = {
  oz: 28,
  half: 14,
  quarter: 7,
  eighth: 3.5
};

export function aggregateInventory(rows) {
  const map = {};

  for (const row of rows) {
    const {
      strain,
      quality,
      unit,
      quantity,
      expires_at
    } = row;

    if (!strain || !unit || quantity == null) continue;

    const gramsPerUnit = UNIT_TO_GRAMS[unit];
    if (!gramsPerUnit) continue;

    const grams = gramsPerUnit * quantity;
    const key = `${strain}__${quality}`;

    if (!map[key]) {
      map[key] = {
        strain,
        quality,
        total_grams: 0,
        units: {
          oz: 0,
          half: 0,
          quarter: 0,
          eighth: 0
        },
        nearest_expiration: null
      };
    }

    map[key].total_grams += grams;
    map[key].units[unit] += quantity;

    if (expires_at) {
      const exp = new Date(expires_at);
      const current = map[key].nearest_expiration;

      if (!current || exp < new Date(current)) {
        map[key].nearest_expiration = expires_at;
      }
    }
  }

  return Object.values(map);
}
