import catalog from './catalog.json' with { type: 'json' };

export function search(query: string) {
  const normalized = query.toLowerCase();
  return catalog.filter(product => `${product.name} ${product.description} ${product.category}`.toLowerCase().includes(normalized))
    .sort((left, right) => left.id < right.id ? -1 : left.id === right.id ? 0 : 1).slice(0, 20);
}
