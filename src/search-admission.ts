/** Per-process admission for the public demo; no queue or per-persona state. */
export function createSearchAdmission() {
  let active = 0, tokens = 20, updatedAt = performance.now();
  return () => {
    const now = performance.now();
    tokens = Math.min(20, tokens + (now - updatedAt) * 20 / 1000);
    updatedAt = now;
    if (active >= 16 || tokens < 1) return undefined;
    tokens--;active++;
    let released = false;
    return () => { if (!released) { released = true;active--; } };
  };
}
