/**
 * Polygon.io Basic Tier Client
 * Free tier: 5 API calls/minute, End-of-Day data, 2 years historical.
 * Used as fallback when Trade Republic API is unavailable.
 */

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════
export interface PolygonQuote {
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;
  timestamp: number;
  from: string;       // date string YYYY-MM-DD
}

export interface PolygonTickerDetail {
  ticker: string;
  name: string;
  market: string;
  locale: string;
  primary_exchange: string;
  type: string;
  currency_name: string;
}

// ═══════════════════════════════════════════════════════════
// RATE LIMITING
// ═══════════════════════════════════════════════════════════
const RATE_LIMIT_INTERVAL_MS = 12_500; // 5 calls/min = 1 call per 12s
let lastCallTime = 0;

async function rateLimitWait(): Promise<void> {
  const elapsed = Date.now() - lastCallTime;
  if (elapsed < RATE_LIMIT_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_INTERVAL_MS - elapsed));
  }
  lastCallTime = Date.now();
}

// ═══════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════
const polygonCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_EOD = 3600_000;  // 1h — EOD data doesn't change often
const CACHE_TTL_DETAIL = 86400_000; // 24h — ticker details rarely change

function getCached<T>(key: string, ttl: number): T | null {
  const entry = polygonCache.get(key);
  if (entry && Date.now() - entry.timestamp < ttl) return entry.data as T;
  return null;
}

function setCache(key: string, data: any, ttl: number = CACHE_TTL_EOD): void {
  polygonCache.set(key, { data, timestamp: Date.now() });
}

// ═══════════════════════════════════════════════════════════
// CLIENT
// ═══════════════════════════════════════════════════════════
export class PolygonClient {
  private apiKey: string;
  private enabled: boolean;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.POLYGON_API_KEY || "";
    this.enabled = !!this.apiKey;
    if (this.enabled) {
      console.log("[Polygon] Client initialized with API key");
    } else {
      console.log("[Polygon] No API key — client disabled. Set POLYGON_API_KEY to enable.");
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get previous day's OHLCV for a US stock ticker.
   * Free tier endpoint: /v2/aggs/ticker/{ticker}/prev
   */
  async getPreviousClose(ticker: string): Promise<PolygonQuote | null> {
    if (!this.enabled) return null;

    const cacheKey = `polygon:prev:${ticker}`;
    const cached = getCached<PolygonQuote>(cacheKey, CACHE_TTL_EOD);
    if (cached) return cached;

    try {
      await rateLimitWait();
      const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev?adjusted=true&apiKey=${this.apiKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

      if (!res.ok) {
        if (res.status === 429) {
          console.warn("[Polygon] Rate limit hit, backing off");
          lastCallTime = Date.now() + 60_000; // Extra 60s cooldown
        }
        console.warn(`[Polygon] Previous close failed for ${ticker}: ${res.status}`);
        return null;
      }

      const data = await res.json();
      const results = data.results;
      if (!results || results.length === 0) return null;

      const r = results[0];
      const quote: PolygonQuote = {
        ticker: data.ticker || ticker,
        open: r.o,
        high: r.h,
        low: r.l,
        close: r.c,
        volume: r.v,
        vwap: r.vw,
        timestamp: r.t,
        from: new Date(r.t).toISOString().split("T")[0],
      };

      setCache(cacheKey, quote);
      return quote;
    } catch (e) {
      console.warn(`[Polygon] Error fetching previous close for ${ticker}:`, (e as Error).message?.slice(0, 80));
      return null;
    }
  }

  /**
   * Get daily OHLCV bars for a US stock ticker over a date range.
   * Free tier endpoint: /v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}
   */
  async getDailyBars(ticker: string, from: string, to: string): Promise<PolygonQuote[]> {
    if (!this.enabled) return [];

    const cacheKey = `polygon:daily:${ticker}:${from}:${to}`;
    const cached = getCached<PolygonQuote[]>(cacheKey, CACHE_TTL_EOD);
    if (cached) return cached;

    try {
      await rateLimitWait();
      const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=5000&apiKey=${this.apiKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });

      if (!res.ok) {
        console.warn(`[Polygon] Daily bars failed for ${ticker}: ${res.status}`);
        return [];
      }

      const data = await res.json();
      const results = data.results || [];

      const bars: PolygonQuote[] = results.map((r: any) => ({
        ticker: data.ticker || ticker,
        open: r.o,
        high: r.h,
        low: r.l,
        close: r.c,
        volume: r.v,
        vwap: r.vw,
        timestamp: r.t,
        from: new Date(r.t).toISOString().split("T")[0],
      }));

      if (bars.length > 0) setCache(cacheKey, bars);
      return bars;
    } catch (e) {
      console.warn(`[Polygon] Error fetching daily bars for ${ticker}:`, (e as Error).message?.slice(0, 80));
      return [];
    }
  }

  /**
   * Get ticker details (name, exchange, type).
   * Free tier endpoint: /v3/reference/tickers/{ticker}
   */
  async getTickerDetails(ticker: string): Promise<PolygonTickerDetail | null> {
    if (!this.enabled) return null;

    const cacheKey = `polygon:detail:${ticker}`;
    const cached = getCached<PolygonTickerDetail>(cacheKey, CACHE_TTL_DETAIL);
    if (cached) return cached;

    try {
      await rateLimitWait();
      const url = `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(ticker)}?apiKey=${this.apiKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

      if (!res.ok) return null;

      const data = await res.json();
      const result = data.results;
      if (!result) return null;

      const detail: PolygonTickerDetail = {
        ticker: result.ticker,
        name: result.name,
        market: result.market,
        locale: result.locale,
        primary_exchange: result.primary_exchange,
        type: result.type,
        currency_name: result.currency_name,
      };

      setCache(cacheKey, detail, CACHE_TTL_DETAIL);
      return detail;
    } catch (e) {
      console.warn(`[Polygon] Error fetching ticker details for ${ticker}:`, (e as Error).message?.slice(0, 80));
      return null;
    }
  }

  /**
   * Search for tickers matching a query.
   * Free tier endpoint: /v3/reference/tickers?search={query}
   */
  async searchTickers(query: string, limit = 10): Promise<PolygonTickerDetail[]> {
    if (!this.enabled) return [];

    const cacheKey = `polygon:search:${query}`;
    const cached = getCached<PolygonTickerDetail[]>(cacheKey, 300_000); // 5min
    if (cached) return cached;

    try {
      await rateLimitWait();
      const url = `https://api.polygon.io/v3/reference/tickers?search=${encodeURIComponent(query)}&active=true&limit=${limit}&apiKey=${this.apiKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

      if (!res.ok) return [];

      const data = await res.json();
      const results = (data.results || []).map((r: any) => ({
        ticker: r.ticker,
        name: r.name,
        market: r.market,
        locale: r.locale,
        primary_exchange: r.primary_exchange,
        type: r.type,
        currency_name: r.currency_name,
      }));

      if (results.length > 0) setCache(cacheKey, results, 300_000);
      return results;
    } catch (e) {
      console.warn(`[Polygon] Search error:`, (e as Error).message?.slice(0, 80));
      return [];
    }
  }
}
