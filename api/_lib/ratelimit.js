export const WINDOW_MS = 60_000;
export const MAX_REQUESTS = 10;
const MAX_TRACKED_IPS = 10_000;

const hits = new Map(); // ip -> array of request timestamps (ms)

// Best-effort per-instance limiter. `now` is injectable for tests.
export function isRateLimited(ip, now = Date.now()) {
  const cutoff = now - WINDOW_MS;
  const recent = (hits.get(ip) ?? []).filter((t) => t > cutoff);
  if (recent.length >= MAX_REQUESTS) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  if (hits.size >= MAX_TRACKED_IPS && !hits.has(ip)) hits.clear();
  hits.set(ip, recent);
  return false;
}
