import catalog from './catalog.json' with { type: 'json' };

/** Preserve matching membership; optionally rank names first, then price and ID. */
export function search(query: string, ranked = false) {
  const normalized = query.toLowerCase();
  return catalog.filter(product => `${product.name} ${product.description} ${product.category}`.toLowerCase().includes(normalized))
    .sort((left, right) => {
      if (ranked) {
        const nameMatch = Number(right.name.toLowerCase().includes(normalized)) - Number(left.name.toLowerCase().includes(normalized));
        if (nameMatch) return nameMatch;
        if (left.priceCents !== right.priceCents) return left.priceCents - right.priceCents;
      }
      return left.id < right.id ? -1 : left.id === right.id ? 0 : 1;
    }).slice(0, 20);
}
