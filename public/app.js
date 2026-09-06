const form = document.querySelector('#search-form');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
let pending;
form.addEventListener('submit', async event => {
  event.preventDefault();
  pending?.abort();
  const request = new AbortController();
  pending = request;
  status.textContent = 'Searching...';
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(form.elements.q.value)}`, { signal: request.signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error.message);
    results.replaceChildren(...body.results.map(product => {
      const item = document.createElement('li');
      const heading = document.createElement('h2');
      const description = document.createElement('p');
      const price = document.createElement('span');
      heading.textContent = product.name;
      description.textContent = product.description;
      price.textContent = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(product.priceCents / 100);
      item.append(heading, description, price);
      return item;
    }));
    status.textContent = `${body.results.length} ${body.results.length === 1 ? 'result' : 'results'}`;
  } catch (error) {
    if (request.signal.aborted) return;
    results.replaceChildren();
    status.textContent = error instanceof Error ? error.message : 'Search failed. Try again.';
  }
});
form.requestSubmit();
