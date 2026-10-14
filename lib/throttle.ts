// A small in-memory brake for sign-in routes: at most `limit` hits per key per window.
// Per server instance only, so it slows abuse rather than guaranteeing a limit; a Vercel
// Firewall rate-limit rule is the real backstop. Old entries are pruned so it can't grow forever.

type Hits = { count: number; resetAt: number };

export function createThrottle(limit: number, windowMs: number, maxKeys = 5000) {
  const hits = new Map<string, Hits>();
  return {
    /** Seconds to wait if over the limit, else 0 (and the hit is counted). */
    hit(key: string, now = Date.now()): number {
      if (hits.size > maxKeys) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
        // Still full of live entries: drop the oldest half rather than grow.
        if (hits.size > maxKeys) for (const k of [...hits.keys()].slice(0, Math.floor(maxKeys / 2))) hits.delete(k);
      }
      const h = hits.get(key);
      if (!h || h.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return 0;
      }
      if (h.count >= limit) return Math.ceil((h.resetAt - now) / 1000);
      h.count += 1;
      return 0;
    },
  };
}

/** The caller's IP as Vercel reports it, or "unknown". */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
