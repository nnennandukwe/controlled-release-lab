// Synthetic local provider routing for CLI subprocess tests. Unknown destinations
// fail closed, so this preload can't send a test request to a hosted service.
const base = process.env.OPERATOR_FIXTURE_URL;
if (!base || new URL(base).hostname !== '127.0.0.1') throw new Error('A loopback provider fixture is required.');
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(String(input));
  if (!['backboard.railway.com', 'app.launchdarkly.com', 'operator-fixture.invalid'].includes(url.hostname)) throw new Error('Unexpected fixture destination');
  return nativeFetch(`${base}/${url.hostname}${url.pathname}${url.search}`, options);
};
export {};
