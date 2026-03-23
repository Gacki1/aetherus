import type { Express } from "express";
import { createServer, type Server } from "http";
import type { NewsSource, StockPrediction } from "@shared/schema";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { getPriceProvider } from "./price-provider";

// ═══════════════════════════════════════════════════════════
// CACHING LAYER
// ═══════════════════════════════════════════════════════════
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}
const cache = new Map<string, CacheEntry<any>>();

function getCached<T>(key: string, maxAgeMs: number): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < maxAgeMs) return entry.data as T;
  return null;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

/** Delete all cache entries whose key starts with the given prefix */
function clearCachePrefix(prefix: string): number {
  let count = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) { cache.delete(key); count++; }
  }
  return count;
}

/** Wipe every cache entry — used when the user explicitly refreshes */
function clearAllCache(): void {
  cache.clear();
}

// ═══════════════════════════════════════════════════════════
// YAHOO FINANCE (no API key needed)
// ═══════════════════════════════════════════════════════════
let yahooFinance: any = null;

async function getYahoo() {
  if (!yahooFinance) {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  }
  return yahooFinance;
}

async function yahooQuote(symbol: string): Promise<any> {
  const yf = await getYahoo();
  try {
    return await yf.quote(symbol);
  } catch (e) {
    console.warn(`Yahoo quote failed for ${symbol}:`, (e as Error).message?.slice(0, 100));
    return null;
  }
}

async function yahooSearch(query: string): Promise<any[]> {
  const yf = await getYahoo();
  try {
    const result = await yf.search(query);
    return (result.quotes || []).filter(
      (q: any) => q.quoteType === "EQUITY" || q.quoteType === "ETF"
    );
  } catch (e) {
    console.warn(`Yahoo search failed:`, (e as Error).message?.slice(0, 100));
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// EUR CONVERSION
// ═══════════════════════════════════════════════════════════
let eurRateCache: { rate: number; timestamp: number } | null = null;

async function getEurRate(): Promise<number> {
  // Cache for 30 minutes
  if (eurRateCache && Date.now() - eurRateCache.timestamp < 1800000) {
    return eurRateCache.rate;
  }
  try {
    const yf = await getYahoo();
    const quote = await yf.quote("EURUSD=X");
    const rate = quote?.regularMarketPrice || 1.09;
    eurRateCache = { rate, timestamp: Date.now() };
    console.log(`EUR/USD rate updated: ${rate}`);
    return rate;
  } catch (e) {
    console.warn("Failed to fetch EUR/USD rate, using fallback 1.09");
    return eurRateCache?.rate || 1.09;
  }
}

function convertToEur(usdAmount: number, eurRate: number): number {
  return round2(usdAmount / eurRate);
}

// ═══════════════════════════════════════════════════════════
// ISIN RESOLUTION
// ═══════════════════════════════════════════════════════════
const ISIN_REGEX = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

// Preferred exchanges ranked by priority
const PREFERRED_EXCHANGES = [
  "NYQ", "NMS", "NGM", "NYSE", "NASDAQ", "NasdaqGS", "NasdaqGM", "NasdaqCM",  // US
  "GER", "XETRA", "FRA", "Frankfurt",  // Germany
  "LSE", "London",  // UK
  "PAR", "Paris",  // France
  "AMS", "Amsterdam",  // Netherlands
];

async function resolveIsin(isin: string): Promise<any[]> {
  const yf = await getYahoo();

  // Step 1: Direct ISIN search on Yahoo
  let results: any[] = [];
  try {
    const searchResult = await yf.search(isin);
    results = (searchResult.quotes || []).filter(
      (q: any) => q.quoteType === "EQUITY" || q.quoteType === "ETF"
    );
  } catch (e) {
    console.warn(`ISIN search failed for ${isin}:`, (e as Error).message?.slice(0, 80));
  }

  // If we got results, try to find the best one on a major exchange
  if (results.length > 0) {
    // Get the company name from the first result to do a secondary search
    const companyName = results[0].shortname || results[0].longname || "";
    if (companyName) {
      try {
        const nameSearch = await yf.search(companyName);
        const nameResults = (nameSearch.quotes || []).filter(
          (q: any) => q.quoteType === "EQUITY" || q.quoteType === "ETF"
        );
        // Merge results, dedup by symbol
        const seen = new Set(results.map((r: any) => r.symbol));
        for (const r of nameResults) {
          if (!seen.has(r.symbol)) {
            results.push(r);
            seen.add(r.symbol);
          }
        }
      } catch (e) {
        // Ignore secondary search failure
      }
    }
  }

  // Sort by preferred exchange
  results.sort((a: any, b: any) => {
    const aExch = a.exchange || a.exchDisp || "";
    const bExch = b.exchange || b.exchDisp || "";
    const aIdx = PREFERRED_EXCHANGES.findIndex(
      (e) => aExch.toUpperCase().includes(e.toUpperCase())
    );
    const bIdx = PREFERRED_EXCHANGES.findIndex(
      (e) => bExch.toUpperCase().includes(e.toUpperCase())
    );
    // Preferred exchanges first (lower index = higher priority)
    const aPrio = aIdx >= 0 ? aIdx : 999;
    const bPrio = bIdx >= 0 ? bIdx : 999;
    return aPrio - bPrio;
  });

  return results;
}

// ═══════════════════════════════════════════════════════════
// TICKER → ISIN MAPPING
// ═══════════════════════════════════════════════════════════
const TICKER_TO_ISIN: Record<string, string> = {
  // US Stocks
  "AAPL": "US0378331005", "MSFT": "US5949181045", "GOOGL": "US02079K3059",
  "AMZN": "US0231351067", "NVDA": "US67066G1040", "META": "US30303M1027",
  "TSLA": "US88160R1014", "JPM": "US46625H1005", "V": "US92826C8394",
  "WMT": "US9311421039", "JNJ": "US4781601046", "MA": "US57636Q1040",
  "PG": "US7427181091", "UNH": "US91324P1021", "HD": "US4370761029",
  "BAC": "US0605051046", "XOM": "US30231G1022", "KO": "US1912161007",
  "PFE": "US7170811035", "CSCO": "US17275R1023", "DIS": "US2546871060",
  "NFLX": "US64110L1061", "AMD": "US0079031078", "INTC": "US4581401001",
  "CRM": "US79466L3024", "ORCL": "US68389X1054", "ADBE": "US00724F1012",
  "PYPL": "US70450Y1038", "NKE": "US6541061031", "MRK": "US58933Y1055",
  "ABBV": "US00287Y1091", "TMO": "US8835561023", "ABT": "US0028241000",
  "COST": "US22160K1051", "CVX": "US1667641005", "LLY": "US5324571083",
  "AVGO": "US11135F1012", "PEP": "US7134481081", "MCD": "US5801351017",
  "T": "US00206R1023", "IBM": "US4592001014", "GS": "US38141G1040",
  "MS": "US6174464486", "QCOM": "US7475251036", "LOW": "US5486611073",
  "UBER": "US90353T1007", "COIN": "US19260Q1076", "SQ": "US8522341036",
  "SNAP": "US83304A1060", "SHOP": "CA82509L1076",
  // DAX 40
  "ADS.DE": "DE000A1EWWW0", "AIR.DE": "NL0000235190", "ALV.DE": "DE0008404005",
  "BAS.DE": "DE000BASF111", "BAYN.DE": "DE000BAY0017", "BEI.DE": "DE0005200000",
  "BMW.DE": "DE0005190003", "BNR.DE": "DE000A2YN371", "CBK.DE": "DE000CBK1001",
  "CON.DE": "DE0005439004", "1COV.DE": "DE0006062144", "DTG.DE": "DE000DTR0CK8",
  "DBK.DE": "DE0005140008", "DB1.DE": "DE0005810055", "DHL.DE": "DE0005552004",
  "DTE.DE": "DE0005557508", "EOAN.DE": "DE000ENAG999", "FRE.DE": "DE0005785604",
  "HNR1.DE": "DE0008402215", "HEI.DE": "DE0006047004", "HEN3.DE": "DE0006048432",
  "IFX.DE": "DE0006231004", "MBG.DE": "DE0007100000", "MRK.DE": "DE0006599905",
  "MTX.DE": "DE000MTX0012", "MUV2.DE": "DE0008430026", "PAH3.DE": "DE0007664039",
  "QIA.DE": "DE0006969603", "RHM.DE": "DE0007030009", "RWE.DE": "DE0007037129",
  "SAP.DE": "DE0007164600", "SRT3.DE": "DE0007165631", "SIE.DE": "DE0007236101",
  "ENR.DE": "DE000ENER6Y0", "SHL.DE": "DE000SHL1006", "SY1.DE": "DE000SYM9999",
  "VNA.DE": "DE000A1ML7J1", "VOW3.DE": "DE0007664039", "ZAL.DE": "DE000ZAL1111",
  "P911.DE": "DE000PAG9113",
  // MDAX
  "AIX.DE": "DE000A0WMPJ6", "AT1.DE": "DE0005232805", "BC8.DE": "DE0005158703",
  "DHER.DE": "NL0012015705", "DWS.DE": "DE000DWS1007", "EVK.DE": "DE0005313506",
  "FTK.DE": "DE0005772206", "FNTN.DE": "DE000A2NBVD5", "G1A.DE": "DE0005855005",
  "GXI.DE": "DE0005408116", "HLE.DE": "DE0006070006", "BOSS.DE": "DE000A1PHFF7",
  "JUN3.DE": "DE0006219934", "SDF.DE": "DE000KSAG888", "KGX.DE": "DE000KGX8881",
  "KRN.DE": "DE0006335003", "LEG.DE": "DE0005199905", "LHA.DE": "DE0008232125",
  "NDX1.DE": "DE0006862005", "NEM.DE": "DE000NWRK013", "PUM.DE": "DE0006969603",
  "SHA.DE": "DE000SHA0159", "TLX.DE": "DE000TLX1005", "TUI1.DE": "DE000TUAG505",
  // TecDAX / SDAX
  "AIXA.DE": "DE000A0WMPJ6", "BYW6.DE": "DE0005190037", "COP.DE": "DE000COP0019",
  "SFQ.DE": "DE000A2LQ884", "SOW.DE": "DE0005137004", "O2D.DE": "DE000A0Z2ZZ5",
  "PBB.DE": "DE0008019001", "GFT.DE": "DE0005800601", "JEN.DE": "DE000A2NB601",
  "KWS.DE": "DE0007074007", "LXS.DE": "DE0005408884", "MOR.DE": "DE0006632003",
};

// Dynamic ISIN cache (supplements the static map)
const dynamicIsinCache = new Map<string, string | null>();

/** Look up ISIN for a Yahoo Finance ticker. Checks static map first, then dynamic cache. */
function lookupIsin(ticker: string): string | undefined {
  return TICKER_TO_ISIN[ticker] || TICKER_TO_ISIN[ticker.toUpperCase()]
    || dynamicIsinCache.get(ticker) || dynamicIsinCache.get(ticker.toUpperCase())
    || undefined;
}

/** Validate ISIN checksum (Luhn on letter→number expanded string). */
function isValidIsin(isin: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return false;
  // Convert letters to numbers: A=10, B=11, ..., Z=35
  const digits = isin.split("").map(c => {
    const code = c.charCodeAt(0);
    return code >= 65 ? String(code - 55) : c; // A-Z → 10-35
  }).join("");
  // Luhn check on the digit string
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const VALID_ISIN_COUNTRIES = new Set(["US", "DE", "GB", "NL", "FR", "CH", "CA", "IE", "LU", "BE", "AT", "DK", "SE", "NO", "FI", "ES", "IT", "JP", "AU", "KR", "TW", "HK", "CN", "SG", "BR", "IN", "ZA", "IL", "MX", "CL", "CO", "AR", "NZ", "PT"]);

/** Map Yahoo exchange codes to ISIN country prefixes */
const EXCHANGE_TO_ISIN_COUNTRY: Record<string, string> = {
  // US
  NMS: "US", NGM: "US", NYQ: "US", PCX: "US", ASE: "US", BTS: "US", NCM: "US",
  NASDAQ: "US", NYSE: "US", "NYSE ARCA": "US", AMEX: "US", "CBOE BZX U.S. EQUITIES EXCHANGE": "US",
  // Germany
  GER: "DE", FRA: "DE", STU: "DE", BER: "DE", HAM: "DE", HAN: "DE", MUN: "DE", DUS: "DE", XETRA: "DE",
  // UK
  LSE: "GB", IOB: "GB", AIM: "GB",
  // France
  PAR: "FR", ENX: "FR",
  // Netherlands
  AMS: "NL",
  // Switzerland
  EBS: "CH", SWX: "CH", VTX: "CH",
  // Canada
  TOR: "CA", TSX: "CA", CVE: "CA",
  // Japan
  JPX: "JP", TYO: "JP",
  // Australia
  ASX: "AU",
  // Hong Kong
  HKG: "HK",
};

/** Determine the expected ISIN country prefix from Yahoo exchange code/name */
function exchangeToIsinCountry(exchange: string): string | null {
  if (!exchange) return null;
  const upper = exchange.toUpperCase().trim();
  // Direct lookup
  if (EXCHANGE_TO_ISIN_COUNTRY[upper]) return EXCHANGE_TO_ISIN_COUNTRY[upper];
  // Fuzzy match for full names
  if (upper.includes("NASDAQ") || upper.includes("NYSE") || upper.includes("AMEX")) return "US";
  if (upper.includes("XETRA") || upper.includes("FRANK")) return "DE";
  if (upper.includes("LONDON") || upper.includes("LSE")) return "GB";
  if (upper.includes("PARIS") || upper.includes("EURONEXT")) return "FR";
  if (upper.includes("AMSTERDAM")) return "NL";
  if (upper.includes("TORONTO") || upper.includes("TSX")) return "CA";
  if (upper.includes("SWISS") || upper.includes("SIX")) return "CH";
  if (upper.includes("TOKYO")) return "JP";
  return null;
}

/** Well-known index ISINs that should never be assigned to individual stocks */
const INDEX_ISINS = new Set([
  "DE0008469008", // DAX
  "EU0009658145", // EURO STOXX 50
  "US78378X1072", // S&P 500 (SPY-like, but used as index)
  "GB0001383545", // FTSE 100
  "JP3027040005", // Nikkei related
]);

/** Extract the best ISIN from a blob of text. Validates checksum and picks the most frequent.
 *  If expectedCountry is given, only ISINs matching that country prefix are considered.
 *  Falls back to any valid ISIN if none match the expected country. */
function extractBestIsin(html: string, expectedCountry?: string | null): string | null {
  const raw = html.match(/\b([A-Z]{2}[A-Z0-9]{9}[0-9])\b/g);
  if (!raw) return null;
  // Filter: valid country code + valid Luhn checksum + not a known index ISIN
  const valid = raw.filter(m =>
    VALID_ISIN_COUNTRIES.has(m.substring(0, 2)) && isValidIsin(m) && !INDEX_ISINS.has(m)
  );
  if (valid.length === 0) return null;

  // If we know the expected country, prefer ISINs matching it
  const countryMatched = expectedCountry
    ? valid.filter(m => m.startsWith(expectedCountry))
    : [];
  const candidates = countryMatched.length > 0 ? countryMatched : valid;

  // Pick the most frequently appearing ISIN (more mentions = more likely correct)
  const freq = new Map<string, number>();
  for (const v of candidates) freq.set(v, (freq.get(v) || 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

async function resolveIsinAsync(ticker: string, companyName: string, exchange?: string): Promise<void> {
  const key = ticker.toUpperCase();
  // Already resolved (or attempted)
  if (TICKER_TO_ISIN[key] || dynamicIsinCache.has(key)) return;
  // Mark as in-progress (null = attempted but not found)
  dynamicIsinCache.set(key, null);

  // Strip Yahoo suffix (.DE, .F, .L, .SW, .TO, etc.) for cleaner API queries
  const baseTicker = key.replace(/\.[A-Z]{1,3}$/, "");

  // Determine expected ISIN country from exchange (e.g. NYQ→US, GER→DE)
  const expectedCountry = exchangeToIsinCountry(exchange || "");
  console.log(`[ISIN] Resolving ${key} (base: ${baseTicker}, company: ${companyName}, exchange: ${exchange || "?"}, expectedCountry: ${expectedCountry || "?"})`);

  try {
    // Strategy 1 (PRIMARY): Query onvista.de API — structured JSON with verified ISINs
    // Try multiple search queries: base ticker, full ticker, company name
    const onvistaQueries = [
      baseTicker,
      ...(baseTicker !== key ? [key] : []),
      companyName,
      `${baseTicker} ${companyName}`,
    ];

    for (const q of onvistaQueries) {
      try {
        const onvistaUrl = `https://api.onvista.de/api/v1/instruments/search?searchValue=${encodeURIComponent(q)}`;
        const onvistaRes = await fetch(onvistaUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; Stoxview/3.0)" },
          signal: AbortSignal.timeout(8000),
        });
        if (!onvistaRes.ok) continue;
        const onvistaData = await onvistaRes.json() as any;
        const stocks = (onvistaData.list || []).filter(
          (item: any) => item.entityType === "STOCK" && item.isin
        );

        // Find the best match: prefer matching homeSymbol (compare against both key and baseTicker)
        const matchesTicker = (s: any) => {
          const hs = s.homeSymbol?.toUpperCase() || "";
          return hs === key || hs === baseTicker;
        };

        let bestMatch = stocks.find((s: any) => matchesTicker(s));
        if (!bestMatch && stocks.length === 1) {
          bestMatch = stocks[0]; // Only one stock result — likely correct
        }
        if (!bestMatch && stocks.length > 0) {
          // Multiple results: prefer one matching expected country (or related countries)
          bestMatch = stocks.find((s: any) =>
            expectedCountry && s.isin.startsWith(expectedCountry)
          ) || stocks[0];
        }

        if (bestMatch && bestMatch.isin && isValidIsin(bestMatch.isin) && !INDEX_ISINS.has(bestMatch.isin)) {
          dynamicIsinCache.set(key, bestMatch.isin);
          console.log(`[ISIN] Resolved ${key} → ${bestMatch.isin} (via onvista, name: ${bestMatch.name})`);
          return;
        }
      } catch {
        // ignore individual query failures
      }
    }

    // Strategy 2 (FALLBACK): Search onvista HTML page for ISINs
    try {
      const searchUrl = `https://www.onvista.de/aktien/suche?searchValue=${encodeURIComponent(`${baseTicker} ${companyName}`)}`;
      const searchRes = await fetch(searchUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
      });
      if (searchRes.ok) {
        const html = await searchRes.text();
        // Don't filter by country here — onvista HTML results are already relevant
        const bestIsin = extractBestIsin(html);
        if (bestIsin) {
          dynamicIsinCache.set(key, bestIsin);
          console.log(`[ISIN] Resolved ${key} → ${bestIsin} (via onvista HTML)`);
          return;
        }
      }
    } catch {
      // ignore
    }

    console.log(`[ISIN] Could not resolve ${key} (no valid ISIN found matching country ${expectedCountry || "any"})`);
  } catch (e) {
    console.warn(`[ISIN] Resolution failed for ${key}:`, (e as Error).message?.slice(0, 80));
  }
}

// ═══════════════════════════════════════════════════════════
// SOURCE 1: WEB SEARCH NEWS (DuckDuckGo — no API key)
// ═══════════════════════════════════════════════════════════
async function fetchWebNews(companyName: string, ticker: string): Promise<NewsSource[]> {
  const sources: NewsSource[] = [];
  const queries = [
    `${companyName} stock news today`,
    `${ticker} stock forecast analyst`,
    `${companyName} earnings outlook`,
  ];

  for (const query of queries) {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://html.duckduckgo.com/html/?q=${encoded}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Stoxview/3.0)" },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const results = parseDuckDuckGoResults(html);

      for (const result of results.slice(0, 4)) {
        const score = analyzeSentiment(`${result.title} ${result.snippet}`);
        sources.push({
          name: extractDomain(result.url),
          url: result.url,
          title: result.title,
          summary: result.snippet.slice(0, 200),
          sentiment: classifySentiment(score),
          sentimentScore: score,
          publishedAt: new Date().toISOString(),
          sourceType: "web-search" as const,
        });
      }
      await new Promise((r) => setTimeout(r, 350));
    } catch (e) {
      console.warn(`Web search failed for "${query}":`, (e as Error).message?.slice(0, 80));
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  return sources.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

interface ParsedResult { title: string; url: string; snippet: string; }

function parseDuckDuckGoResults(html: string): ParsedResult[] {
  const results: ParsedResult[] = [];
  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const titles: { url: string; title: string }[] = [];
  let match;

  while ((match = resultRegex.exec(html)) !== null) {
    const rawUrl = match[1];
    const title = match[2].replace(/<[^>]*>/g, "").trim();
    const actualUrl = decodeURIComponent(rawUrl.replace(/.*uddg=/, "").replace(/&.*/, ""));
    if (title && actualUrl && actualUrl.startsWith("http")) {
      titles.push({ url: actualUrl, title });
    }
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(match[1].replace(/<[^>]*>/g, "").trim());
  }

  for (let i = 0; i < Math.min(titles.length, 8); i++) {
    results.push({ title: titles[i].title, url: titles[i].url, snippet: snippets[i] || "" });
  }
  return results;
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");
    const map: Record<string, string> = {
      "reuters.com": "Reuters", "bloomberg.com": "Bloomberg", "cnbc.com": "CNBC",
      "yahoo.com": "Yahoo Finance", "finance.yahoo.com": "Yahoo Finance",
      "marketwatch.com": "MarketWatch", "seekingalpha.com": "Seeking Alpha",
      "fool.com": "Motley Fool", "investopedia.com": "Investopedia",
      "wsj.com": "Wall Street Journal", "ft.com": "Financial Times",
      "barrons.com": "Barron's", "tipranks.com": "TipRanks", "benzinga.com": "Benzinga",
      "zacks.com": "Zacks", "thestreet.com": "TheStreet", "investors.com": "IBD",
      "handelsblatt.com": "Handelsblatt", "finanzen.net": "finanzen.net",
      "boerse.de": "boerse.de", "onvista.de": "OnVista", "google.com": "Google Finance",
      "nasdaq.com": "Nasdaq", "nypost.com": "NY Post", "bbc.com": "BBC",
      "nytimes.com": "NY Times", "theguardian.com": "The Guardian",
    };
    return map[hostname] || hostname;
  } catch { return "Web"; }
}

// ═══════════════════════════════════════════════════════════
// SOURCE 2: ANALYST SIGNAL (from Yahoo Finance recommendation)
// ═══════════════════════════════════════════════════════════
async function fetchAnalystSignal(symbol: string): Promise<{ rating: number; sources: NewsSource[] }> {
  try {
    const yf = await getYahoo();
    const data = await yf.recommendationsBySymbol(symbol);
    const recs = data?.recommendedSymbols || [];
    // Yahoo also gives recommendation trend via quoteSummary
    const summary = await yf.quoteSummary(symbol, { modules: ["recommendationTrend"] }).catch(() => null);
    const trends = summary?.recommendationTrend?.trend || [];
    const latest = trends[0];

    if (!latest) return { rating: 0, sources: [] };

    const total = (latest.strongBuy || 0) + (latest.buy || 0) + (latest.hold || 0) + (latest.sell || 0) + (latest.strongSell || 0);
    if (total === 0) return { rating: 0, sources: [] };

    const bullScore = ((latest.strongBuy || 0) * 2 + (latest.buy || 0)) / total;
    const bearScore = ((latest.strongSell || 0) * 2 + (latest.sell || 0)) / total;
    const netRating = Math.max(-1, Math.min(1, (bullScore - bearScore) / 2));
    const sentiment = classifySentiment(netRating);

    const summaryText = `Analysts: ${latest.strongBuy || 0} Strong Buy, ${latest.buy || 0} Buy, ${latest.hold || 0} Hold, ${latest.sell || 0} Sell, ${latest.strongSell || 0} Strong Sell`;

    return {
      rating: netRating,
      sources: [{
        name: "Analyst Consensus",
        url: `https://finance.yahoo.com/quote/${symbol}`,
        title: `${symbol} Analyst Ratings: ${sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}`,
        summary: summaryText,
        sentiment,
        sentimentScore: netRating,
        publishedAt: new Date().toISOString(),
        sourceType: "analyst" as const,
      }],
    };
  } catch (e) {
    console.warn(`Analyst data failed for ${symbol}:`, (e as Error).message?.slice(0, 80));
    return { rating: 0, sources: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// SOURCE 3: FINNHUB NEWS (requires free API key)
// ═══════════════════════════════════════════════════════════
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || "";

// Finnhub rate limiting: 60 calls/min on free tier, 30 calls/sec hard limit
let finnhubLastRequestTime = 0;
const FINNHUB_MIN_INTERVAL = 1100; // ~1 req/sec to stay well under limits

async function finnhubThrottle(): Promise<void> {
  const elapsed = Date.now() - finnhubLastRequestTime;
  if (elapsed < FINNHUB_MIN_INTERVAL) {
    await new Promise(r => setTimeout(r, FINNHUB_MIN_INTERVAL - elapsed));
  }
  finnhubLastRequestTime = Date.now();
}

async function fetchFinnhubNews(symbol: string): Promise<NewsSource[]> {
  if (!FINNHUB_API_KEY) return [];
  const sources: NewsSource[] = [];

  try {
    // Finnhub company news — last 7 days
    const now = new Date();
    const from = new Date(now.getTime() - 7 * 86400000);
    const fromStr = from.toISOString().split("T")[0];
    const toStr = now.toISOString().split("T")[0];

    await finnhubThrottle();
    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fromStr}&to=${toStr}&token=${FINNHUB_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.warn(`[Finnhub] News request failed: ${res.status}`);
      return [];
    }
    const articles: any[] = await res.json();

    // Trusted financial news domains only
    const TRUSTED_DOMAINS = new Set([
      "reuters.com", "bloomberg.com", "cnbc.com", "yahoo.com", "finance.yahoo.com",
      "marketwatch.com", "seekingalpha.com", "fool.com", "wsj.com", "ft.com",
      "barrons.com", "benzinga.com", "zacks.com", "investors.com", "nasdaq.com",
      "thestreet.com", "investopedia.com", "tipranks.com",
      "handelsblatt.com", "finanzen.net", "boerse.de", "onvista.de",
    ]);

    for (const article of articles.slice(0, 15)) {
      const articleUrl = article.url || "";
      let hostname = "";
      try { hostname = new URL(articleUrl).hostname.replace("www.", ""); } catch {}

      // Only include articles from trusted sources
      const isTrusted = TRUSTED_DOMAINS.has(hostname) ||
        Array.from(TRUSTED_DOMAINS).some(d => hostname.endsWith(`.${d}`));
      if (!isTrusted && hostname) continue;

      const text = `${article.headline || ""} ${article.summary || ""}`;
      const score = analyzeSentiment(text);

      sources.push({
        name: extractDomain(articleUrl) || article.source || "Finnhub",
        url: articleUrl,
        title: article.headline || "News",
        summary: (article.summary || "").slice(0, 200),
        sentiment: classifySentiment(score),
        sentimentScore: score,
        publishedAt: article.datetime
          ? new Date(article.datetime * 1000).toISOString()
          : new Date().toISOString(),
        sourceType: "finnhub" as const,
      });
    }
  } catch (e) {
    console.warn(`[Finnhub] News fetch failed for ${symbol}:`, (e as Error).message?.slice(0, 80));
  }

  return sources;
}

// Finnhub also provides a built-in sentiment score
async function fetchFinnhubSentiment(symbol: string): Promise<number | null> {
  if (!FINNHUB_API_KEY) return null;

  try {
    await finnhubThrottle();
    const url = `https://finnhub.io/api/v1/news-sentiment?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    // Finnhub returns sentiment.bullishPercent (0-1)
    const bullish = data?.sentiment?.bullishPercent;
    if (typeof bullish === "number") {
      // Convert 0-1 range to -1..+1 (0.5 = neutral)
      return Math.max(-1, Math.min(1, (bullish - 0.5) * 2));
    }
    return null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// SOURCE 4: SELF-CALCULATED TECHNICAL INDICATORS (from Yahoo price data)
// No external API needed — RSI, SMA, EMA computed from daily close prices
// ═══════════════════════════════════════════════════════════
const techCache = new Map<string, { data: TechnicalSignals; timestamp: number }>();
const TECH_CACHE_TTL = 1800000; // 30 min — refresh twice per hour

interface TechnicalSignals {
  rsi: number | null;       // 0-100 (>70 overbought, <30 oversold)
  smaShort: number | null;  // 20-day SMA
  smaLong: number | null;   // 50-day SMA
  ema: number | null;       // 20-day EMA
  overallSignal: number;    // -1 to +1 composite
  sources: NewsSource[];
}

// Calculate RSI from closing prices (standard 14-period Wilder's RSI)
function calculateRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gainSum += change; else lossSum += Math.abs(change);
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  // Wilder's smoothing for remaining data
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Calculate Simple Moving Average
function calculateSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(closes.length - period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

// Calculate Exponential Moving Average
function calculateEMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  // Seed with SMA of first `period` values
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

async function fetchTechnicals(symbol: string, currentPrice: number): Promise<TechnicalSignals> {
  const empty: TechnicalSignals = { rsi: null, smaShort: null, smaLong: null, ema: null, overallSignal: 0, sources: [] };
  if (!currentPrice) return empty;

  // Check cache
  const cached = techCache.get(symbol);
  if (cached && Date.now() - cached.timestamp < TECH_CACHE_TTL) {
    return cached.data;
  }

  try {
    // Fetch 120 trading days (~6 months) of daily data from Yahoo
    // We need >= 51 days for SMA50, plus buffer for RSI warm-up
    const yf = await getYahoo();
    const chartResult = await yf.chart(symbol, {
      period1: daysAgo(180),
      interval: "1d",
    });

    const quotes = chartResult?.quotes || [];
    const closes: number[] = quotes
      .filter((q: any) => q.close != null)
      .map((q: any) => q.close as number);

    if (closes.length < 15) {
      console.log(`[Technicals] ${symbol}: Not enough data (${closes.length} days)`);
      return empty;
    }

    // Calculate all indicators
    const rsi = calculateRSI(closes, 14);
    const smaShort = calculateSMA(closes, 20);
    const smaLong = calculateSMA(closes, 50);
    const ema = calculateEMA(closes, 20);

    console.log(`[Technicals] ${symbol}: RSI=${rsi?.toFixed(1) || "n/a"}, SMA20=${smaShort?.toFixed(2) || "n/a"}, SMA50=${smaLong?.toFixed(2) || "n/a"}, EMA20=${ema?.toFixed(2) || "n/a"} (${closes.length} days)`);

    // Compute signals from available data
    let signalSum = 0;
    let signalCount = 0;
    const summaryParts: string[] = [];

    // RSI signal
    if (rsi !== null && !isNaN(rsi)) {
      if (rsi > 70) {
        signalSum -= 0.6;
        summaryParts.push(`RSI ${rsi.toFixed(1)} (überkauft)`);
      } else if (rsi < 30) {
        signalSum += 0.6;
        summaryParts.push(`RSI ${rsi.toFixed(1)} (überverkauft)`);
      } else if (rsi > 55) {
        signalSum += 0.2;
        summaryParts.push(`RSI ${rsi.toFixed(1)} (leicht bullisch)`);
      } else if (rsi < 45) {
        signalSum -= 0.2;
        summaryParts.push(`RSI ${rsi.toFixed(1)} (leicht bärisch)`);
      } else {
        summaryParts.push(`RSI ${rsi.toFixed(1)} (neutral)`);
      }
      signalCount++;
    }

    // SMA crossover signal (price vs 20-day SMA)
    if (smaShort !== null && !isNaN(smaShort) && currentPrice > 0) {
      const priceSmaRatio = (currentPrice - smaShort) / smaShort;
      if (priceSmaRatio > 0.03) {
        signalSum += 0.3;
        summaryParts.push(`Kurs über SMA20 (+${(priceSmaRatio * 100).toFixed(1)}%)`);
      } else if (priceSmaRatio < -0.03) {
        signalSum -= 0.3;
        summaryParts.push(`Kurs unter SMA20 (${(priceSmaRatio * 100).toFixed(1)}%)`);
      } else {
        summaryParts.push(`Kurs nahe SMA20`);
      }
      signalCount++;
    }

    // SMA50 trend — golden/death cross signal
    if (smaShort !== null && smaLong !== null && !isNaN(smaShort) && !isNaN(smaLong)) {
      if (smaShort > smaLong * 1.01) {
        signalSum += 0.25;
        summaryParts.push(`SMA20 > SMA50 (Aufwärtstrend)`);
      } else if (smaShort < smaLong * 0.99) {
        signalSum -= 0.25;
        summaryParts.push(`SMA20 < SMA50 (Abwärtstrend)`);
      }
      signalCount++;
    }

    // EMA vs price — short-term momentum
    if (ema !== null && !isNaN(ema) && currentPrice > 0) {
      const priceEmaRatio = (currentPrice - ema) / ema;
      if (priceEmaRatio > 0.02) {
        signalSum += 0.2;
        summaryParts.push(`Kurs über EMA20 (+${(priceEmaRatio * 100).toFixed(1)}%)`);
      } else if (priceEmaRatio < -0.02) {
        signalSum -= 0.2;
        summaryParts.push(`Kurs unter EMA20 (${(priceEmaRatio * 100).toFixed(1)}%)`);
      }
      signalCount++;
    }

    const overallSignal = signalCount > 0 ? Math.max(-1, Math.min(1, signalSum / signalCount)) : 0;
    const sentiment = classifySentiment(overallSignal);

    const sources: NewsSource[] = summaryParts.length > 0 ? [{
      name: "Technische Analyse",
      url: `https://finance.yahoo.com/quote/${symbol}`,
      title: `${symbol} Technische Analyse: ${sentiment === "positive" ? "Bullisch" : sentiment === "negative" ? "Bärisch" : "Neutral"}`,
      summary: summaryParts.join(" · "),
      sentiment,
      sentimentScore: overallSignal,
      publishedAt: new Date().toISOString(),
      sourceType: "technical" as const,
    }] : [];

    const result: TechnicalSignals = { rsi, smaShort, smaLong, ema, overallSignal, sources };

    // Cache result
    techCache.set(symbol, { data: result, timestamp: Date.now() });

    return result;
  } catch (e) {
    console.warn(`[Technicals] Calculation failed for ${symbol}:`, (e as Error).message?.slice(0, 80));
    return empty;
  }
}

// ═══════════════════════════════════════════════════════════
// SOURCE 5: CNN FEAR & GREED INDEX (no API key, market-wide)
// ═══════════════════════════════════════════════════════════
let fearGreedCache: { score: number; rating: string; timestamp: number } | null = null;

async function fetchFearGreedIndex(): Promise<{ score: number; rating: string; signal: number; source: NewsSource | null }> {
  const fallback = { score: 50, rating: "Neutral", signal: 0, source: null };

  // Cache for 30 minutes — this is market-wide, doesn't change per stock
  if (fearGreedCache && Date.now() - fearGreedCache.timestamp < 1800000) {
    const signal = fearGreedToSignal(fearGreedCache.score);
    return {
      score: fearGreedCache.score,
      rating: fearGreedCache.rating,
      signal,
      source: buildFearGreedSource(fearGreedCache.score, fearGreedCache.rating, signal),
    };
  }

  try {
    // CNN Fear & Greed public JSON endpoint
    const url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Stoxview/4.0)",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[FearGreed] Failed: ${res.status}`);
      return fallback;
    }

    const data = await res.json();
    const fgNow = data?.fear_and_greed?.score;
    const fgRating = data?.fear_and_greed?.rating || "Neutral";

    if (typeof fgNow !== "number") return fallback;

    const score = Math.round(fgNow);
    const rating = fgRating.replace(/_/g, " ");

    fearGreedCache = { score, rating, timestamp: Date.now() };
    const signal = fearGreedToSignal(score);

    return {
      score,
      rating,
      signal,
      source: buildFearGreedSource(score, rating, signal),
    };
  } catch (e) {
    console.warn(`[FearGreed] Fetch failed:`, (e as Error).message?.slice(0, 80));
    return fallback;
  }
}

function fearGreedToSignal(score: number): number {
  // 0 = extreme fear (-1), 50 = neutral (0), 100 = extreme greed (+1)
  // But contrarian: extreme greed often precedes corrections
  // We use a mild contrarian bias for medium/long-term
  return Math.max(-1, Math.min(1, (score - 50) / 50));
}

function buildFearGreedSource(score: number, rating: string, signal: number): NewsSource {
  const sentiment = classifySentiment(signal);
  const ratingDe = {
    "Extreme Fear": "Extreme Angst",
    "Fear": "Angst",
    "Neutral": "Neutral",
    "Greed": "Gier",
    "Extreme Greed": "Extreme Gier",
  }[rating] || rating;

  return {
    name: "CNN Fear & Greed",
    url: "https://edition.cnn.com/markets/fear-and-greed",
    title: `Marktstimmung: ${ratingDe} (${score}/100)`,
    summary: `CNN Fear & Greed Index steht bei ${score}/100 (${ratingDe}). Der Index misst Marktmomentum, Volatilität, Put/Call-Ratio, Junk-Bond-Nachfrage und sichere Häfen.`,
    sentiment,
    sentimentScore: signal,
    publishedAt: new Date().toISOString(),
    sourceType: "fear-greed" as const,
  };
}

// ═══════════════════════════════════════════════════════════
// SENTIMENT ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════
const POSITIVE_WORDS = [
  "surge", "surges", "soar", "soars", "jump", "jumps", "gain", "gains",
  "rise", "rises", "grew", "grow", "growth", "profit", "profits", "beat",
  "beats", "exceed", "exceeds", "record high", "bullish", "upgrade",
  "upgrades", "outperform", "strong", "boost", "positive", "optimistic",
  "rally", "rallies", "recover", "recovery", "dividend", "buyback",
  "innovation", "breakthrough", "expand", "expansion", "milestone",
  "upside", "overweight", "buy", "accumulate", "top pick",
  "revenue growth", "earnings beat", "raised guidance", "increased forecast",
  "market leader", "competitive advantage", "strategic partnership",
  "strong demand", "all-time high", "new contract", "acquisition",
];

const NEGATIVE_WORDS = [
  "fall", "falls", "drop", "drops", "decline", "declines", "loss", "losses",
  "plunge", "plunges", "crash", "sink", "sinks", "miss", "misses", "cut",
  "cuts", "downgrade", "downgrades", "underperform", "weak", "bearish",
  "warning", "risk", "fears", "concern", "concerns",
  "layoff", "layoffs", "lawsuit", "fine", "fines", "penalty", "debt",
  "recession", "inflation", "tariff", "tariffs", "ban", "restriction",
  "downside", "underweight", "sell", "reduce", "avoid",
  "revenue miss", "earnings miss", "lowered guidance", "reduced forecast",
  "market share loss", "competitive threat", "regulatory probe",
  "weak demand", "all-time low", "contract loss", "writedown",
  "slump", "trouble", "crisis", "default", "bankruptcy", "investigation",
];

function analyzeSentiment(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  let matches = 0;
  for (const phrase of POSITIVE_WORDS) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "g");
    const count = (lower.match(re) || []).length;
    if (count > 0) { score += count; matches += count; }
  }
  for (const phrase of NEGATIVE_WORDS) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "g");
    const count = (lower.match(re) || []).length;
    if (count > 0) { score -= count; matches += count; }
  }
  if (matches === 0) return 0;
  return Math.max(-1, Math.min(1, score / Math.max(matches, 4)));
}

function classifySentiment(score: number): "positive" | "negative" | "neutral" {
  if (score > 0.12) return "positive";
  if (score < -0.12) return "negative";
  return "neutral";
}

// ═══════════════════════════════════════════════════════════
// PREDICTION ENGINE
// ═══════════════════════════════════════════════════════════
function generatePrediction(
  quote: any,
  allSources: NewsSource[],
  analystRating: number,
  symbol: string,
  eurRate: number,
  finnhubSentiment: number | null = null,
  technicalSignal: number = 0,
  fearGreedSignal: number = 0,
  learnedWeights?: Record<SourceKey, number>,
): StockPrediction {
  const rawCurrency = (quote.currency || "USD").toUpperCase();
  const needsConversion = rawCurrency !== "EUR";
  const toEur = (val: number) => needsConversion ? convertToEur(val, eurRate) : val;

  const currentPrice = toEur(quote.regularMarketPrice || 0);
  const previousClose = toEur(quote.regularMarketPreviousClose || (quote.regularMarketPrice || 0));
  const dayHigh = toEur(quote.regularMarketDayHigh || (quote.regularMarketPrice || 0));
  const dayLow = toEur(quote.regularMarketDayLow || (quote.regularMarketPrice || 0));
  const openPrice = toEur(quote.regularMarketOpen || (quote.regularMarketPrice || 0));

  const priceChange = currentPrice - previousClose;
  const priceChangePercent = previousClose > 0 ? (priceChange / previousClose) * 100 : 0;

  // Per-source-type sentiment
  const webSources = allSources.filter((s) => s.sourceType === "web-search");
  const finnhubSources = allSources.filter((s) => s.sourceType === "finnhub");
  const analystSources = allSources.filter((s) => s.sourceType === "analyst");
  const technicalSources = allSources.filter((s) => s.sourceType === "technical");
  const fearGreedSources = allSources.filter((s) => s.sourceType === "fear-greed");

  const avgWeb = webSources.length > 0
    ? webSources.reduce((sum, s) => sum + s.sentimentScore, 0) / webSources.length
    : 0;
  const avgFinnhub = finnhubSources.length > 0
    ? finnhubSources.reduce((sum, s) => sum + s.sentimentScore, 0) / finnhubSources.length
    : 0;

  // Use Finnhub's built-in sentiment if available, else use our computed average
  const effectiveFinnhubSentiment = finnhubSentiment !== null ? finnhubSentiment : avgFinnhub;

  // ── Multi-source combined sentiment ──
  // Dynamic weighting: each available source gets its share
  // Weights come from the self-learning engine (or defaults if no history yet)
  const w = learnedWeights || DEFAULT_WEIGHTS;
  let weightedSentiment = 0;
  let totalWeight = 0;

  // Web search news
  if (webSources.length > 0) { weightedSentiment += avgWeb * w.webSentiment; totalWeight += w.webSentiment; }
  // Yahoo analyst consensus
  if (analystRating !== 0) { weightedSentiment += analystRating * w.analystRating; totalWeight += w.analystRating; }
  // Finnhub news sentiment
  if (finnhubSources.length > 0 || finnhubSentiment !== null) {
    weightedSentiment += effectiveFinnhubSentiment * w.finnhubSentiment; totalWeight += w.finnhubSentiment;
  }
  // Technical indicators
  if (technicalSignal !== 0) { weightedSentiment += technicalSignal * w.technicalSignal; totalWeight += w.technicalSignal; }
  // Fear & Greed (market-wide, not stock-specific)
  if (fearGreedSignal !== 0) { weightedSentiment += fearGreedSignal * w.fearGreedSignal; totalWeight += w.fearGreedSignal; }

  // Normalize if not all sources available
  const combinedSentiment = totalWeight > 0 ? weightedSentiment / totalWeight : 0;

  // Price momentum
  const momentum = priceChangePercent / 100;
  const dayRange = dayHigh - dayLow;
  const rangePosition = dayRange > 0 ? (currentPrice - dayLow) / dayRange : 0.5;
  const gapSignal = openPrice > previousClose ? 0.08 : openPrice < previousClose ? -0.08 : 0;

  // SHORT-TERM (1-7 days): Momentum-heavy, with technicals
  const stTechBoost = technicalSignal * 0.15;
  const stRaw = combinedSentiment * 0.40 + momentum * 3.0 + (rangePosition - 0.5) * 0.25 + gapSignal + stTechBoost;
  const stSignal = stRaw > 0.10 ? "bullish" : stRaw < -0.10 ? "bearish" : "neutral";
  const stConf = clamp(Math.round(Math.abs(stRaw) * 130 + 18), 20, 85);

  // MEDIUM-TERM (1-4 weeks): Balanced sentiment + technicals
  const mtTechBoost = technicalSignal * 0.15;
  const mtFgBoost = fearGreedSignal * 0.05;
  const mtRaw = combinedSentiment * 0.50 + analystRating * 0.15 + momentum * 1.0 + mtTechBoost + mtFgBoost;
  const mtSignal = mtRaw > 0.07 ? "bullish" : mtRaw < -0.07 ? "bearish" : "neutral";
  const mtConf = clamp(Math.round(Math.abs(mtRaw) * 100 + 14), 16, 72);

  // LONG-TERM (1-6 months): Analyst-heavy, with contrarian Fear&Greed
  // For long-term, extreme greed is a warning (contrarian)
  const ltFgContrarian = -fearGreedSignal * 0.08;
  const ltRaw = analystRating * 0.40 + combinedSentiment * 0.35 + momentum * 0.2 + technicalSignal * 0.10 + ltFgContrarian;
  const ltSignal = ltRaw > 0.05 ? "bullish" : ltRaw < -0.05 ? "bearish" : "neutral";
  const ltConf = clamp(Math.round(Math.abs(ltRaw) * 80 + 10), 12, 62);

  // Risk: more sources = better risk assessment
  const volatility = dayRange > 0 && currentPrice > 0 ? (dayRange / currentPrice) * 100 : 2;
  const sentimentSpread = allSources.length > 1
    ? Math.sqrt(allSources.reduce((sum, s) => sum + Math.pow(s.sentimentScore - combinedSentiment, 2), 0) / allSources.length)
    : 0.3;
  // Source diversity bonus: more sources = slightly lower perceived risk
  const sourceCount = allSources.length;
  const diversityBonus = clamp(sourceCount * 0.3, 0, 5);
  const riskBase = volatility * 14 + sentimentSpread * 28 + Math.abs(priceChangePercent) * 4 - diversityBonus;
  const riskLevel = clamp(Math.round(riskBase), 8, 95);

  // ── Estimated price move (%) per timeframe ──
  // Based on signal strength × volatility × timeframe multiplier
  // dailyVol approximates average daily % move; scale by sqrt(trading days) for each horizon
  const dailyVol = volatility > 0 ? volatility : 1.5; // fallback ~1.5% daily range
  // Short: ~5 trading days, Medium: ~15 trading days, Long: ~65 trading days
  const stMove = round2(stRaw * dailyVol * Math.sqrt(5) * 1.2);   // amplify slightly — short is momentum-driven
  const mtMove = round2(mtRaw * dailyVol * Math.sqrt(15) * 0.9);  // temper slightly — mean reversion
  const ltMove = round2(ltRaw * dailyVol * Math.sqrt(65) * 0.6);  // conservative — long-term is harder to predict
  // Clamp to reasonable ranges: short ±15%, medium ±25%, long ±40%
  const stEstimate = clamp(stMove, -15, 15);
  const mtEstimate = clamp(mtMove, -25, 25);
  const ltEstimate = clamp(ltMove, -40, 40);

  // Currency — always EUR for display
  const exchange = quote.fullExchangeName || quote.exchange || "";
  const country = (exchange.toLowerCase().includes("xetra") || exchange.toLowerCase().includes("frank") || symbol.endsWith(".DE") || symbol.endsWith(".F")) ? "DE" : "US";

  return {
    ticker: symbol,
    name: quote.shortName || quote.longName || symbol,
    exchange: exchange || (country === "DE" ? "XETRA" : "US"),
    country,
    industry: quote.industry || "N/A",
    logo: undefined,
    currentPrice: round2(currentPrice),
    previousClose: round2(previousClose),
    dayHigh: round2(dayHigh),
    dayLow: round2(dayLow),
    openPrice: round2(openPrice),
    priceChange: round2(priceChange),
    priceChangePercent: round2(priceChangePercent),
    currency: "EUR",
    shortTerm: { signal: stSignal, confidence: stConf, estimatedMove: stEstimate, label: "Short-term", range: "1-7 days" },
    mediumTerm: { signal: mtSignal, confidence: mtConf, estimatedMove: mtEstimate, label: "Medium-term", range: "1-4 weeks" },
    longTerm: { signal: ltSignal, confidence: ltConf, estimatedMove: ltEstimate, label: "Long-term", range: "1-6 months" },
    riskLevel,
    sentimentScore: round2(combinedSentiment),
    sources: allSources.slice(0, 25),
    sourceBreakdown: {
      finnhub: finnhubSources.length,
      webSearch: webSources.length,
      analyst: analystSources.length,
      technical: technicalSources.length,
      fearGreed: fearGreedSources.length,
      total: allSources.length,
    },
    isin: lookupIsin(symbol),
    // Market state & bid/ask for post-market display
    marketState: (quote.marketState || "CLOSED") as "REGULAR" | "PRE" | "POST" | "PREPRE" | "POSTPOST" | "CLOSED",
    bidPrice: quote.bid ? round2(toEur(quote.bid)) : undefined,
    askPrice: quote.ask ? round2(toEur(quote.ask)) : undefined,
    lastUpdated: new Date().toISOString(),
  };
}

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
function round2(n: number) { return Math.round(n * 100) / 100; }

// ═══════════════════════════════════════════════════════════
// MULTI-SOURCE ORCHESTRATOR
// ═══════════════════════════════════════════════════════════
async function fetchFullPrediction(symbol: string, user?: string): Promise<StockPrediction | null> {
  const cacheKey = user ? `v4:${symbol}:${safeUser(user)}` : `v4:${symbol}`;
  const cached = getCached<StockPrediction>(cacheKey, 60000); // 60s — fast refresh for price accuracy
  if (cached) return cached;

  try {
    // Phase 1: Get quote + EUR rate from Yahoo Finance
    const [quote, eurRate] = await Promise.all([
      yahooQuote(symbol),
      getEurRate(),
    ]);
    if (!quote || !quote.regularMarketPrice) return null;

    const companyName = quote.shortName || quote.longName || symbol;
    const rawCurrency = (quote.currency || "USD").toUpperCase();
    const needsConversion = rawCurrency !== "EUR";
    const currentPriceEur = needsConversion ? convertToEur(quote.regularMarketPrice, eurRate) : quote.regularMarketPrice;

    // Phase 2: Fetch all sources + ISIN in parallel
    // Technical indicators are self-calculated from Yahoo price data — no external API needed
    // ISIN resolution runs alongside other fetches so it's ready when prediction is built
    const yahooExchange = quote.exchange || quote.fullExchangeName || "";
    const needsIsin = !lookupIsin(symbol);

    const [webNews, analystData, finnhubNews, finnhubSentiment, technicals, fearGreed] = await Promise.all([
      fetchWebNews(companyName, symbol),
      fetchAnalystSignal(symbol),
      fetchFinnhubNews(symbol),
      fetchFinnhubSentiment(symbol),
      fetchTechnicals(symbol, currentPriceEur),
      fetchFearGreedIndex(),
      // ISIN resolution runs in parallel — resolves into dynamicIsinCache
      needsIsin
        ? resolveIsinAsync(symbol, companyName, yahooExchange).catch(() => {})
        : Promise.resolve(),
    ]);

    const allSources = [
      ...webNews,
      ...analystData.sources,
      ...finnhubNews,
      ...technicals.sources,
      ...(fearGreed.source ? [fearGreed.source] : []),
    ];

    // Phase 3: Get learned weights (self-learning engine) and generate prediction
    const stockCategory = classifyCategory(quote.industry || "");
    const learnedW = user ? getLearnedWeights(user, symbol, stockCategory) : null;
    const prediction = generatePrediction(
      quote, allSources, analystData.rating, symbol, eurRate,
      finnhubSentiment, technicals.overallSignal, fearGreed.signal,
      learnedW?.isAdaptive ? learnedW.weights : undefined,
    );

    // Tag adaptive learning metadata on the prediction
    if (learnedW?.isAdaptive) {
      (prediction as any).isAdaptive = true;
      (prediction as any).adaptiveSource = learnedW.source;
      (prediction as any).adaptiveEvaluatedCount = learnedW.evaluatedCount;
      if (learnedW.category) (prediction as any).adaptiveCategory = learnedW.category;
    }
    // Tag category for history recording
    (prediction as any)._category = stockCategory;

    // Tag raw source signals for the self-learning engine to store in history
    const webSentimentAvg = webNews.length > 0
      ? webNews.reduce((sum, s) => sum + s.sentimentScore, 0) / webNews.length : 0;
    const effectiveFinnhub = finnhubSentiment !== null ? finnhubSentiment
      : (finnhubNews.length > 0 ? finnhubNews.reduce((sum, s) => sum + s.sentimentScore, 0) / finnhubNews.length : 0);
    const priceChange = quote.regularMarketPrice && quote.regularMarketPreviousClose
      ? (quote.regularMarketPrice - quote.regularMarketPreviousClose) / quote.regularMarketPreviousClose : 0;
    (prediction as any)._sourceSignals = {
      webSentiment: round2(webSentimentAvg),
      analystRating: round2(analystData.rating),
      finnhubSentiment: round2(effectiveFinnhub),
      technicalSignal: round2(technicals.overallSignal),
      fearGreedSignal: round2(fearGreed.signal),
      momentum: round2(priceChange),
    };

    // ISIN should now be resolved from the parallel fetch above
    if (!prediction.isin) {
      const resolved = lookupIsin(symbol);
      if (resolved) prediction.isin = resolved;
    }

    // Phase 4: Enhance with Trade Republic / Polygon data if available
    const isin = prediction.isin;
    const provider = getPriceProvider();
    if (isin) {
      // Auto-subscribe to TR for this ISIN (non-blocking)
      provider.subscribeToTR(isin);
    }
    const enhanced = provider.getEnhancedQuote(isin, quote, symbol);
    if (enhanced.source === "trade-republic") {
      // Override bid/ask with TR real-time data
      if (enhanced.bidPrice != null) prediction.bidPrice = round2(needsConversion ? convertToEur(enhanced.bidPrice, eurRate) : enhanced.bidPrice);
      if (enhanced.askPrice != null) prediction.askPrice = round2(needsConversion ? convertToEur(enhanced.askPrice, eurRate) : enhanced.askPrice);
      // TR prices are already from LSX (EUR) — but TR shows all prices in EUR,
      // so we only convert if the underlying is USD-denominated
    }
    // Tag the data source in the prediction
    (prediction as any).priceSource = enhanced.source;
    (prediction as any).isRealtime = enhanced.isRealtime;

    setCache(cacheKey, prediction);
    return prediction;
  } catch (e) {
    console.error(`Full prediction failed for ${symbol}:`, (e as Error).message?.slice(0, 120));
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// DEFAULT TRENDING STOCKS
// ═══════════════════════════════════════════════════════════
const DEFAULT_SYMBOLS = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META",
  "SAP", "SIE.DE", "ALV.DE", "BMW.DE", "BAS.DE", "DTE.DE", "ADS.DE",
];

// ═══════════════════════════════════════════════════════════
// WATCHLIST — persistent JSON file on desktop, in-memory on web
// ═══════════════════════════════════════════════════════════
interface WatchlistItem {
  symbol: string;
  name: string;
  addedAt: string;
}

const DATA_DIR = process.env.STOXVIEW_DATA_DIR || "";

// ── Per-user watchlist storage ──
// Sanitize username for safe filenames
function safeUser(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase().slice(0, 64) || "_default";
}

function watchlistPath(user: string): string {
  if (!DATA_DIR) return "";
  return join(DATA_DIR, `watchlist-${safeUser(user)}.json`);
}

// In-memory cache keyed by username
const userWatchlists = new Map<string, WatchlistItem[]>();

function getUserWatchlist(user: string): WatchlistItem[] {
  const key = safeUser(user);
  if (userWatchlists.has(key)) return userWatchlists.get(key)!;
  const filePath = watchlistPath(user);
  if (!filePath) return [];
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        console.log(`[Watchlist] Loaded ${data.length} items for user '${key}'`);
        userWatchlists.set(key, data);
        return data;
      }
    }
  } catch (err) {
    console.error(`[Watchlist] Failed to load for user '${key}':`, err);
  }
  const empty: WatchlistItem[] = [];
  userWatchlists.set(key, empty);
  return empty;
}

function saveUserWatchlist(user: string): void {
  const filePath = watchlistPath(user);
  if (!filePath) return;
  const items = getUserWatchlist(user);
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(filePath, JSON.stringify(items, null, 2), "utf-8");
  } catch (err) {
    console.error(`[Watchlist] Failed to save for user '${safeUser(user)}':`, err);
  }
}

// Legacy: load old shared watchlist and keep as fallback for "_default" user
(function migrateLegacyWatchlist() {
  if (!DATA_DIR) return;
  const legacyPath = join(DATA_DIR, "watchlist.json");
  try {
    if (existsSync(legacyPath)) {
      const raw = readFileSync(legacyPath, "utf-8");
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        console.log(`[Watchlist] Migrated ${data.length} legacy items to _default user`);
        userWatchlists.set("_default", data);
      }
    }
  } catch { /* ignore */ }
})();

// ═══════════════════════════════════════════════════════════
// PREDICTION HISTORY — stores past predictions for watchlist
// ═══════════════════════════════════════════════════════════
interface PredictionHistoryEntry {
  ticker: string;
  name: string;
  date: string; // ISO date (YYYY-MM-DD)
  priceAtPrediction: number;
  shortTerm: { signal: string; confidence: number; estimatedMove?: number };
  mediumTerm: { signal: string; confidence: number; estimatedMove?: number };
  longTerm: { signal: string; confidence: number; estimatedMove?: number };
  sentimentScore: number;
  riskLevel: number;
  category?: string; // sector category for category-based learning
  // Accuracy tracking — filled in later when we check actual price
  actualPriceShort?: number;  // Price 7 days later
  actualPriceMedium?: number; // Price 28 days later
  actualPriceLong?: number;   // Price 90 days later
  // Source signals — stored for self-learning (which sources were right?)
  sourceSignals?: {
    webSentiment: number;       // average web-search sentiment (-1..1)
    analystRating: number;      // Yahoo analyst signal (-1..1)
    finnhubSentiment: number;   // Finnhub sentiment (-1..1)
    technicalSignal: number;    // RSI/SMA/EMA-based signal (-1..1)
    fearGreedSignal: number;    // CNN Fear & Greed (-1..1)
    momentum: number;           // price momentum signal
  };
}

// ═══════════════════════════════════════════════════════════
// SELF-LEARNING ENGINE — adjusts prediction weights from history
// ═══════════════════════════════════════════════════════════

// ── Sector category mapping for category-based learning ──
// Yahoo industries are very specific ("Semiconductors", "Auto Manufacturers").
// We group them into broad categories so the learning engine has enough
// data points per category.
const INDUSTRY_TO_CATEGORY: Record<string, string> = {
  // Technology
  "consumer electronics": "tech", "semiconductors": "tech", "software—infrastructure": "tech",
  "software—application": "tech", "information technology services": "tech",
  "electronic components": "tech", "semiconductor equipment & materials": "tech",
  "communication equipment": "tech", "computer hardware": "tech",
  "scientific & technical instruments": "tech", "solar": "tech",
  // Internet & Media
  "internet content & information": "internet", "internet retail": "internet",
  "electronic gaming & multimedia": "internet", "entertainment": "internet",
  "advertising agencies": "internet", "broadcasting": "internet",
  "publishing": "internet",
  // Finance
  "insurance—diversified": "finance", "insurance—life": "finance",
  "banks—diversified": "finance", "banks—regional": "finance",
  "capital markets": "finance", "financial data & stock exchanges": "finance",
  "asset management": "finance", "insurance—property & casualty": "finance",
  "credit services": "finance", "insurance brokers": "finance",
  // Automotive
  "auto manufacturers": "auto", "auto parts": "auto",
  "recreational vehicles": "auto", "farm & heavy construction machinery": "auto",
  // Healthcare & Pharma
  "drug manufacturers—general": "pharma", "drug manufacturers—specialty & generic": "pharma",
  "biotechnology": "pharma", "medical devices": "pharma",
  "diagnostics & research": "pharma", "health information services": "pharma",
  "healthcare plans": "pharma", "medical instruments & supplies": "pharma",
  // Industrial
  "specialty industrial machinery": "industrial", "industrial distribution": "industrial",
  "conglomerates": "industrial", "electrical equipment & parts": "industrial",
  "aerospace & defense": "industrial", "railroads": "industrial",
  "integrated freight & logistics": "industrial", "building products & equipment": "industrial",
  // Energy
  "oil & gas integrated": "energy", "oil & gas e&p": "energy",
  "oil & gas midstream": "energy", "oil & gas equipment & services": "energy",
  "uranium": "energy", "utilities—renewable": "energy",
  // Consumer
  "discount stores": "consumer", "home improvement retail": "consumer",
  "restaurants": "consumer", "apparel retail": "consumer",
  "specialty retail": "consumer", "beverages—non-alcoholic": "consumer",
  "household & personal products": "consumer", "packaged foods": "consumer",
  "tobacco": "consumer", "beverages—brewers": "consumer",
  // Telecom
  "telecom services": "telecom", "pay tv": "telecom",
  // Real Estate
  "reit—specialty": "realestate", "reit—diversified": "realestate",
  "real estate services": "realestate",
  // Chemicals & Materials
  "specialty chemicals": "materials", "chemicals": "materials",
  "steel": "materials", "gold": "materials", "copper": "materials",
};

const CATEGORY_LABELS: Record<string, string> = {
  tech: "Technology", internet: "Internet & Media", finance: "Finance",
  auto: "Automotive", pharma: "Healthcare & Pharma", industrial: "Industrial",
  energy: "Energy", consumer: "Consumer", telecom: "Telecom",
  realestate: "Real Estate", materials: "Materials", other: "Other",
};

function classifyCategory(industry: string): string {
  if (!industry || industry === "N/A") return "other";
  const lower = industry.toLowerCase();
  return INDUSTRY_TO_CATEGORY[lower] || "other";
}

/** Default (hardcoded) weights used before learning kicks in. */
const DEFAULT_WEIGHTS = {
  webSentiment: 0.25,
  analystRating: 0.25,
  finnhubSentiment: 0.20,
  technicalSignal: 0.20,
  fearGreedSignal: 0.10,
};

type SourceKey = keyof typeof DEFAULT_WEIGHTS;
const SOURCE_KEYS: SourceKey[] = ["webSentiment", "analystRating", "finnhubSentiment", "technicalSignal", "fearGreedSignal"];

/** Learned weights structure — stored per-stock and globally. */
interface LearnedWeights {
  weights: Record<SourceKey, number>;
  evaluatedCount: number;   // how many predictions contributed
  lastUpdated: string;      // ISO date
  adjustments: Record<SourceKey, number>; // delta from default (for transparency)
}

interface LearningState {
  global: LearnedWeights | null;
  perCategory: Record<string, LearnedWeights>; // keyed by category (tech, finance, auto...)
}

// In-memory learning state per user (per-stock only) + shared global
const userLearningStates = new Map<string, LearningState>();
let sharedGlobalWeights: LearnedWeights | null = null;
let sharedCategoryWeights: Record<string, LearnedWeights> = {};

function sharedGlobalPath(): string {
  if (!DATA_DIR) return "";
  return join(DATA_DIR, "learning-weights-shared-global.json");
}

function learningPath(user: string): string {
  if (!DATA_DIR) return "";
  return join(DATA_DIR, `learning-weights-${safeUser(user)}.json`);
}

function loadSharedGlobal(): void {
  const filePath = sharedGlobalPath();
  if (!filePath) return;
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf-8");
      sharedGlobalWeights = JSON.parse(raw) as LearnedWeights;
    }
  } catch (err) {
    console.error(`[Learning] Failed to load shared global:`, err);
  }
}

function saveSharedGlobal(): void {
  const filePath = sharedGlobalPath();
  if (!filePath) return;
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(filePath, JSON.stringify(sharedGlobalWeights, null, 2), "utf-8");
  } catch (err) {
    console.error(`[Learning] Failed to save shared global:`, err);
  }
}

function categoryWeightsPath(): string {
  if (!DATA_DIR) return "";
  return join(DATA_DIR, "learning-weights-categories.json");
}

function loadCategoryWeights(): void {
  const filePath = categoryWeightsPath();
  if (!filePath) return;
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf-8");
      sharedCategoryWeights = JSON.parse(raw) as Record<string, LearnedWeights>;
    }
  } catch (err) {
    console.error(`[Learning] Failed to load category weights:`, err);
  }
}

function saveCategoryWeights(): void {
  const filePath = categoryWeightsPath();
  if (!filePath) return;
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(filePath, JSON.stringify(sharedCategoryWeights, null, 2), "utf-8");
  } catch (err) {
    console.error(`[Learning] Failed to save category weights:`, err);
  }
}

// Load on startup
loadSharedGlobal();
loadCategoryWeights();

// Preload all prediction histories from disk so the admin panel has data immediately
function preloadAllHistories(): void {
  if (!DATA_DIR) return;
  try {
    const files = readdirSync(DATA_DIR) as string[];
    let count = 0;
    for (const f of files) {
      const match = f.match(/^prediction-history-(.+)\.json$/);
      if (match) {
        const userKey = match[1];
        getUserHistory(userKey); // triggers lazy load into memory
        count++;
      }
    }
    if (count > 0) console.log(`[History] Preloaded ${count} user histories from disk`);
  } catch (err) {
    console.error("[History] Failed to preload histories:", err);
  }
}
preloadAllHistories();

function getUserLearningState(user: string): LearningState {
  const key = safeUser(user);
  if (userLearningStates.has(key)) return userLearningStates.get(key)!;
  const filePath = learningPath(user);
  if (filePath) {
    try {
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, "utf-8");
        const data = JSON.parse(raw) as LearningState;
        userLearningStates.set(key, data);
        return data;
      }
    } catch (err) {
      console.error(`[Learning] Failed to load for user '${key}':`, err);
    }
  }
  const empty: LearningState = { global: null, perCategory: {} };
  userLearningStates.set(key, empty);
  return empty;
}

function saveLearningState(user: string): void {
  const filePath = learningPath(user);
  if (!filePath) return;
  const state = getUserLearningState(user);
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error(`[Learning] Failed to save for user '${safeUser(user)}':`, err);
  }
}

/**
 * Evaluate how accurate each source signal was at predicting direction.
 * For each evaluated prediction, compute a "score" per source:
 *   +1 if the source signal correctly predicted direction
 *   -1 if it was wrong
 *   0 if the source was neutral or near zero
 * Returns average score per source.
 */
function evaluateSourceAccuracy(
  entries: PredictionHistoryEntry[],
  timeframe: "short" | "medium" | "long",
): Record<SourceKey, { totalScore: number; count: number; avgScore: number }> {
  const result: Record<SourceKey, { totalScore: number; count: number; avgScore: number }> = {} as any;
  for (const key of SOURCE_KEYS) {
    result[key] = { totalScore: 0, count: 0, avgScore: 0 };
  }

  for (const entry of entries) {
    if (!entry.sourceSignals) continue;

    // Determine actual price movement
    let actualPrice: number | undefined;
    let estimatedMove: number | undefined;
    if (timeframe === "short") { actualPrice = entry.actualPriceShort; estimatedMove = entry.shortTerm.estimatedMove; }
    else if (timeframe === "medium") { actualPrice = entry.actualPriceMedium; estimatedMove = entry.mediumTerm.estimatedMove; }
    else { actualPrice = entry.actualPriceLong; estimatedMove = entry.longTerm.estimatedMove; }
    if (actualPrice === undefined) continue;

    const actualMovePercent = ((actualPrice - entry.priceAtPrediction) / entry.priceAtPrediction) * 100;
    const actualDirection = actualMovePercent > 0.1 ? 1 : actualMovePercent < -0.1 ? -1 : 0;
    if (actualDirection === 0) continue; // flat — can't evaluate

    // Magnitude-aware scoring for each source signal
    // Score = direction component (±0.5) + magnitude component (±0.5)
    for (const key of SOURCE_KEYS) {
      const signal = entry.sourceSignals[key];
      if (signal === undefined || Math.abs(signal) < 0.02) continue;
      const sourceDirection = signal > 0 ? 1 : -1;

      // Direction component: +0.5 if correct, -0.5 if wrong
      const directionScore = sourceDirection === actualDirection ? 0.5 : -0.5;

      // Magnitude component: how well did the signal strength predict the actual move?
      // Compare signal magnitude (0-1) to actual move magnitude
      // If estimatedMove is available, use it for a more precise magnitude comparison
      let magnitudeScore = 0;
      if (sourceDirection === actualDirection) {
        if (estimatedMove !== undefined && Math.abs(estimatedMove) > 0.1) {
          // Compare predicted move to actual move — closer = better
          const moveRatio = Math.min(Math.abs(actualMovePercent), Math.abs(estimatedMove))
            / Math.max(Math.abs(actualMovePercent), Math.abs(estimatedMove));
          // moveRatio 0..1 where 1 = perfect magnitude match
          magnitudeScore = moveRatio * 0.5; // max +0.5
        } else {
          // No estimated move — use signal strength vs actual move as proxy
          // Strong signal + big move = good, strong signal + tiny move = less good
          const signalStrength = Math.abs(signal);
          const moveStrength = clamp(Math.abs(actualMovePercent) / 10, 0, 1); // normalize: 10% move = 1.0
          const strengthMatch = 1 - Math.abs(signalStrength - moveStrength);
          magnitudeScore = strengthMatch * 0.3; // max +0.3 (less confident without estimatedMove)
        }
      } else {
        // Wrong direction — penalty scales with how confident the source was
        const signalStrength = Math.abs(signal);
        magnitudeScore = -signalStrength * 0.3; // stronger wrong signal = bigger penalty
      }

      const totalScore = directionScore + magnitudeScore; // range roughly -0.8 to +1.0
      result[key].totalScore += totalScore;
      result[key].count++;
    }
  }

  // Calculate averages
  for (const key of SOURCE_KEYS) {
    const r = result[key];
    r.avgScore = r.count > 0 ? r.totalScore / r.count : 0;
  }

  return result;
}

/**
 * Compute adjusted weights from source accuracy data.
 * Conservative: max ±30% shift from default, needs 5+ evaluated predictions.
 */
function computeLearnedWeights(
  entries: PredictionHistoryEntry[],
  minSamples: number = 5,
): LearnedWeights | null {
  // Only use entries that have source signals and at least one actual price
  const evaluable = entries.filter(e =>
    e.sourceSignals &&
    (e.actualPriceShort !== undefined || e.actualPriceMedium !== undefined || e.actualPriceLong !== undefined)
  );
  if (evaluable.length < minSamples) return null;

  // Evaluate accuracy across all three timeframes, then average
  const shortAcc = evaluateSourceAccuracy(evaluable, "short");
  const medAcc = evaluateSourceAccuracy(evaluable, "medium");
  const longAcc = evaluateSourceAccuracy(evaluable, "long");

  // Weighted average across timeframes (short most important for learning, it resolves fastest)
  const combinedScores: Record<SourceKey, number> = {} as any;
  for (const key of SOURCE_KEYS) {
    const sCount = shortAcc[key].count;
    const mCount = medAcc[key].count;
    const lCount = longAcc[key].count;
    const total = sCount + mCount + lCount;
    if (total === 0) {
      combinedScores[key] = 0;
      continue;
    }
    // Weight by timeframe importance and sample count
    combinedScores[key] = (
      shortAcc[key].avgScore * sCount * 0.5 +
      medAcc[key].avgScore * mCount * 0.35 +
      longAcc[key].avgScore * lCount * 0.15
    ) / total;
  }

  // Convert scores to weight adjustments (conservative: max ±30% of default weight)
  const MAX_SHIFT = 0.30; // 30% max adjustment
  const adjustments: Record<SourceKey, number> = {} as any;
  const newWeights: Record<SourceKey, number> = {} as any;

  for (const key of SOURCE_KEYS) {
    const defaultW = DEFAULT_WEIGHTS[key];
    // Score ranges from -1 to +1; map to -MAX_SHIFT to +MAX_SHIFT of the default weight
    const adjustment = combinedScores[key] * MAX_SHIFT * defaultW;
    adjustments[key] = round2(adjustment);
    newWeights[key] = Math.max(0.02, defaultW + adjustment); // min 2% to never fully disable a source
  }

  // Normalize weights so they sum to 1.0
  const totalW = SOURCE_KEYS.reduce((sum, k) => sum + newWeights[k], 0);
  for (const key of SOURCE_KEYS) {
    newWeights[key] = round2(newWeights[key] / totalW);
  }

  return {
    weights: newWeights,
    evaluatedCount: evaluable.length,
    lastUpdated: new Date().toISOString().split("T")[0],
    adjustments,
  };
}

/**
 * Run the learning engine:
 * 1. Shared global weights from ALL users' histories
 * 2. Per-category weights (tech, finance, auto...) for sector-specific tuning
 */
function runLearningEngine(_user: string): void {
  const allEntries: PredictionHistoryEntry[] = [];
  userHistories.forEach((history) => {
    for (const entry of history) allEntries.push(entry);
  });

  if (allEntries.length === 0) return;

  // 1. Global model from all predictions
  const globalWeights = computeLearnedWeights(allEntries, 5);
  if (globalWeights) {
    sharedGlobalWeights = globalWeights;
    saveSharedGlobal();
    console.log(`[Learning] Global model updated (${globalWeights.evaluatedCount} samples from ${userHistories.size} users)`);
  }

  // 2. Per-category models — group by sector, compute weights per category
  const byCategory = new Map<string, PredictionHistoryEntry[]>();
  for (const entry of allEntries) {
    const cat = entry.category || "other";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(entry);
  }

  // Store category weights in a dedicated shared state
  // (reuse the first user's state for now — categories are global)
  const categoryWeights: Record<string, LearnedWeights> = {};
  byCategory.forEach((entries, cat) => {
    const weights = computeLearnedWeights(entries, 5);
    if (weights) {
      categoryWeights[cat] = weights;
      console.log(`[Learning] Category '${CATEGORY_LABELS[cat] || cat}' updated (${weights.evaluatedCount} samples)`);
    }
  });
  sharedCategoryWeights = categoryWeights;
  saveCategoryWeights();
}

/**
 * Get the learned weights for a stock.
 * Priority: category-specific > global > defaults.
 * Category weights are blended 60/40 with global for stability.
 * Same model for all users — learns from everyone's prediction history.
 */
function getLearnedWeights(user: string, ticker: string, category?: string): {
  weights: Record<SourceKey, number>;
  isAdaptive: boolean;
  source: "category" | "global" | "default";
  evaluatedCount: number;
  category?: string;
} {
  const global = sharedGlobalWeights;
  const cat = category || "other";
  const catWeights = sharedCategoryWeights[cat];

  if (catWeights && global) {
    // Blend: 60% category-specific, 40% global
    const blended: Record<SourceKey, number> = {} as any;
    for (const key of SOURCE_KEYS) {
      blended[key] = round2(catWeights.weights[key] * 0.6 + global.weights[key] * 0.4);
    }
    const total = SOURCE_KEYS.reduce((sum, k) => sum + blended[k], 0);
    for (const key of SOURCE_KEYS) blended[key] = round2(blended[key] / total);
    return { weights: blended, isAdaptive: true, source: "category", evaluatedCount: catWeights.evaluatedCount + global.evaluatedCount, category: CATEGORY_LABELS[cat] || cat };
  }

  if (catWeights) {
    return { weights: catWeights.weights, isAdaptive: true, source: "category", evaluatedCount: catWeights.evaluatedCount, category: CATEGORY_LABELS[cat] || cat };
  }

  if (global) {
    return { weights: global.weights, isAdaptive: true, source: "global", evaluatedCount: global.evaluatedCount };
  }

  return { weights: { ...DEFAULT_WEIGHTS }, isAdaptive: false, source: "default", evaluatedCount: 0 };
}

// Per-user prediction history
const userHistories = new Map<string, PredictionHistoryEntry[]>();

function historyPath(user: string): string {
  if (!DATA_DIR) return "";
  return join(DATA_DIR, `prediction-history-${safeUser(user)}.json`);
}

function getUserHistory(user: string): PredictionHistoryEntry[] {
  const key = safeUser(user);
  if (userHistories.has(key)) return userHistories.get(key)!;
  const filePath = historyPath(user);
  if (!filePath) return [];
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        userHistories.set(key, data);
        return data;
      }
    }
  } catch (err) {
    console.error(`[History] Failed to load for user '${key}':`, err);
  }
  const empty: PredictionHistoryEntry[] = [];
  userHistories.set(key, empty);
  return empty;
}

function saveUserHistory(user: string): void {
  const filePath = historyPath(user);
  if (!filePath) return;
  const entries = getUserHistory(user);
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(filePath, JSON.stringify(entries, null, 2), "utf-8");
  } catch (err) {
    console.error(`[History] Failed to save for user '${safeUser(user)}':`, err);
  }
}

/** Save a snapshot of a prediction for a watchlist stock (once per day per ticker). */
function recordPrediction(prediction: StockPrediction, user: string): void {
  const history = getUserHistory(user);
  const today = new Date().toISOString().split("T")[0];
  // Only record once per day per ticker per user
  if (history.some(e => e.ticker === prediction.ticker && e.date === today)) return;

  const entry: PredictionHistoryEntry = {
    ticker: prediction.ticker,
    name: prediction.name,
    date: today,
    priceAtPrediction: prediction.currentPrice,
    shortTerm: { signal: prediction.shortTerm.signal, confidence: prediction.shortTerm.confidence, estimatedMove: prediction.shortTerm.estimatedMove },
    mediumTerm: { signal: prediction.mediumTerm.signal, confidence: prediction.mediumTerm.confidence, estimatedMove: prediction.mediumTerm.estimatedMove },
    longTerm: { signal: prediction.longTerm.signal, confidence: prediction.longTerm.confidence, estimatedMove: prediction.longTerm.estimatedMove },
    sentimentScore: prediction.sentimentScore,
    riskLevel: prediction.riskLevel,
  };

  // Store source signals for the self-learning engine
  const src = (prediction as any)._sourceSignals;
  if (src) {
    entry.sourceSignals = {
      webSentiment: src.webSentiment ?? 0,
      analystRating: src.analystRating ?? 0,
      finnhubSentiment: src.finnhubSentiment ?? 0,
      technicalSignal: src.technicalSignal ?? 0,
      fearGreedSignal: src.fearGreedSignal ?? 0,
      momentum: src.momentum ?? 0,
    };
  }

  // Store category for category-based learning
  const cat = (prediction as any)._category;
  if (cat) entry.category = cat;

  history.push(entry);

  // Cap at 5000 entries to prevent unbounded growth
  while (history.length > 5000) history.shift();
  saveUserHistory(user);
  console.log(`[History] Recorded prediction for ${prediction.ticker} on ${today} (user: ${safeUser(user)})`);
}

/** Check old predictions against actual prices and fill in accuracy (runs for all users). */
async function updateAccuracy(): Promise<void> {
  const now = Date.now();

  for (const [userKey, history] of userHistories.entries()) {
    const entriesToCheck = history.filter(e => {
      const age = now - new Date(e.date).getTime();
      const ageDays = age / 86400000;
      return (
        (ageDays >= 7 && e.actualPriceShort === undefined) ||
        (ageDays >= 28 && e.actualPriceMedium === undefined) ||
        (ageDays >= 90 && e.actualPriceLong === undefined)
      );
    });

    if (entriesToCheck.length === 0) continue;

    const tickerSet = new Set(entriesToCheck.map(e => e.ticker));
    const eurRate = await getEurRate();

    for (const ticker of tickerSet) {
      try {
        const quote = await yahooQuote(ticker);
        if (!quote || !quote.regularMarketPrice) continue;

        const rawCurrency = (quote.currency || "USD").toUpperCase();
        const needsConversion = rawCurrency !== "EUR";
        const currentPrice = needsConversion ? convertToEur(quote.regularMarketPrice, eurRate) : quote.regularMarketPrice;

        for (const entry of entriesToCheck.filter(e => e.ticker === ticker)) {
          const age = now - new Date(entry.date).getTime();
          const ageDays = age / 86400000;

          if (ageDays >= 7 && entry.actualPriceShort === undefined) {
            entry.actualPriceShort = round2(currentPrice);
          }
          if (ageDays >= 28 && entry.actualPriceMedium === undefined) {
            entry.actualPriceMedium = round2(currentPrice);
          }
          if (ageDays >= 90 && entry.actualPriceLong === undefined) {
            entry.actualPriceLong = round2(currentPrice);
          }
        }
      } catch {
        // skip failed tickers
      }
    }

    saveUserHistory(userKey);

    // After accuracy is updated, re-run the learning engine to recompute weights
    runLearningEngine(userKey);
  }
}

// ═══════════════════════════════════════════════════════════
// EXPRESS ROUTES
// ═══════════════════════════════════════════════════════════
export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // --- Watchlist CRUD (per-user) ---
  app.get("/api/watchlist", (req, res) => {
    const user = (req.query.user as string) || "_default";
    res.json(getUserWatchlist(user));
  });

  app.post("/api/watchlist", (req, res) => {
    const user = (req.query.user as string) || (req.body.user as string) || "_default";
    const { symbol, name } = req.body;
    if (!symbol || typeof symbol !== "string") {
      return res.status(400).json({ error: "symbol is required" });
    }
    const upper = symbol.toUpperCase();
    const wl = getUserWatchlist(user);
    if (wl.some((w) => w.symbol === upper)) {
      return res.json({ ok: true, message: "Already in watchlist" });
    }
    wl.push({ symbol: upper, name: name || upper, addedAt: new Date().toISOString() });
    saveUserWatchlist(user);
    res.json({ ok: true, watchlist: wl });
  });

  app.delete("/api/watchlist/:symbol", (req, res) => {
    const user = (req.query.user as string) || "_default";
    const symbol = req.params.symbol.toUpperCase();
    const wl = getUserWatchlist(user);
    const idx = wl.findIndex((w) => w.symbol === symbol);
    if (idx !== -1) wl.splice(idx, 1);
    saveUserWatchlist(user);
    res.json({ ok: true, watchlist: wl });
  });

  // --- Prediction History (per-user) ---
  app.get("/api/prediction-history", async (req, res) => {
    try {
      const user = (req.query.user as string) || "_default";
      const ticker = (req.query.ticker as string || "").toUpperCase();
      const history = getUserHistory(user);

      // Trigger accuracy updates in the background
      updateAccuracy().catch(() => {});

      if (ticker) {
        const entries = history.filter(e => e.ticker === ticker);
        return res.json(entries);
      }

      res.json(history.slice(-500));
    } catch (err: any) {
      console.error("History error:", err.message);
      res.status(500).json({ error: "Failed to fetch prediction history." });
    }
  });

  app.get("/api/prediction-accuracy", async (req, res) => {
    try {
      const user = (req.query.user as string) || "_default";
      const ticker = (req.query.ticker as string || "").toUpperCase();
      const history = getUserHistory(user);
      const entries = ticker
        ? history.filter(e => e.ticker === ticker)
        : history;

      // Calculate accuracy stats
      let shortCorrect = 0, shortTotal = 0;
      let medCorrect = 0, medTotal = 0;
      let longCorrect = 0, longTotal = 0;

      for (const e of entries) {
        if (e.actualPriceShort !== undefined) {
          shortTotal++;
          const priceWentUp = e.actualPriceShort > e.priceAtPrediction;
          const priceWentDown = e.actualPriceShort < e.priceAtPrediction;
          if (
            (e.shortTerm.signal === "bullish" && priceWentUp) ||
            (e.shortTerm.signal === "bearish" && priceWentDown) ||
            (e.shortTerm.signal === "neutral" && Math.abs(e.actualPriceShort - e.priceAtPrediction) / e.priceAtPrediction < 0.02)
          ) {
            shortCorrect++;
          }
        }
        if (e.actualPriceMedium !== undefined) {
          medTotal++;
          const priceWentUp = e.actualPriceMedium > e.priceAtPrediction;
          const priceWentDown = e.actualPriceMedium < e.priceAtPrediction;
          if (
            (e.mediumTerm.signal === "bullish" && priceWentUp) ||
            (e.mediumTerm.signal === "bearish" && priceWentDown) ||
            (e.mediumTerm.signal === "neutral" && Math.abs(e.actualPriceMedium - e.priceAtPrediction) / e.priceAtPrediction < 0.03)
          ) {
            medCorrect++;
          }
        }
        if (e.actualPriceLong !== undefined) {
          longTotal++;
          const priceWentUp = e.actualPriceLong > e.priceAtPrediction;
          const priceWentDown = e.actualPriceLong < e.priceAtPrediction;
          if (
            (e.longTerm.signal === "bullish" && priceWentUp) ||
            (e.longTerm.signal === "bearish" && priceWentDown) ||
            (e.longTerm.signal === "neutral" && Math.abs(e.actualPriceLong - e.priceAtPrediction) / e.priceAtPrediction < 0.05)
          ) {
            longCorrect++;
          }
        }
      }

      // Calculate countdown: when will the next evaluations happen?
      const now = Date.now();
      let nextShortDays: number | null = null;
      let nextMedDays: number | null = null;
      let nextLongDays: number | null = null;

      for (const e of entries) {
        const entryDate = new Date(e.date).getTime();
        if (e.actualPriceShort === undefined) {
          const daysLeft = Math.max(0, Math.ceil((entryDate + 7 * 86400000 - now) / 86400000));
          if (nextShortDays === null || daysLeft < nextShortDays) nextShortDays = daysLeft;
        }
        if (e.actualPriceMedium === undefined) {
          const daysLeft = Math.max(0, Math.ceil((entryDate + 28 * 86400000 - now) / 86400000));
          if (nextMedDays === null || daysLeft < nextMedDays) nextMedDays = daysLeft;
        }
        if (e.actualPriceLong === undefined) {
          const daysLeft = Math.max(0, Math.ceil((entryDate + 90 * 86400000 - now) / 86400000));
          if (nextLongDays === null || daysLeft < nextLongDays) nextLongDays = daysLeft;
        }
      }

      // How many evaluated predictions needed before learning kicks in
      const totalEvaluated = shortTotal + medTotal + longTotal;
      const learningActive = !!sharedGlobalWeights;

      res.json({
        totalPredictions: entries.length,
        shortTerm: {
          total: shortTotal,
          correct: shortCorrect,
          accuracy: shortTotal > 0 ? round2((shortCorrect / shortTotal) * 100) : null,
          nextEvalDays: nextShortDays,
        },
        mediumTerm: {
          total: medTotal,
          correct: medCorrect,
          accuracy: medTotal > 0 ? round2((medCorrect / medTotal) * 100) : null,
          nextEvalDays: nextMedDays,
        },
        longTerm: {
          total: longTotal,
          correct: longCorrect,
          accuracy: longTotal > 0 ? round2((longCorrect / longTotal) * 100) : null,
          nextEvalDays: nextLongDays,
        },
        countdown: {
          nextShortDays,
          nextMedDays,
          nextLongDays,
          totalEvaluated,
          learningActive,
          needsForLearning: learningActive ? 0 : Math.max(0, 5 - totalEvaluated),
        },
        recentPredictions: entries.slice(-15).reverse(),
      });
    } catch (err: any) {
      console.error("Accuracy error:", err.message);
      res.status(500).json({ error: "Failed to compute accuracy." });
    }
  });

  // --- Learning stats (self-learning engine transparency) ---
  app.get("/api/learning-stats", (req, res) => {
    try {
      const user = (req.query.user as string) || "_default";
      const ticker = (req.query.ticker as string || "").toUpperCase();
      const state = getUserLearningState(user);

      // Get the effective weights for this ticker
      const effective = ticker
        ? getLearnedWeights(user, ticker)
        : { weights: DEFAULT_WEIGHTS, isAdaptive: false, source: "default" as const, evaluatedCount: 0 };

      // Find category for this ticker from recent history
      const history = getUserHistory(user);
      const tickerCategory = history.find(e => e.ticker === ticker)?.category;

      res.json({
        defaults: DEFAULT_WEIGHTS,
        effective: effective.weights,
        isAdaptive: effective.isAdaptive,
        adaptiveSource: effective.source,
        evaluatedCount: effective.evaluatedCount,
        category: (effective as any).category || null,
        global: sharedGlobalWeights ? {
          weights: sharedGlobalWeights.weights,
          adjustments: sharedGlobalWeights.adjustments,
          evaluatedCount: sharedGlobalWeights.evaluatedCount,
          lastUpdated: sharedGlobalWeights.lastUpdated,
        } : null,
        categoryWeights: tickerCategory && sharedCategoryWeights[tickerCategory] ? {
          category: CATEGORY_LABELS[tickerCategory] || tickerCategory,
          weights: sharedCategoryWeights[tickerCategory].weights,
          adjustments: sharedCategoryWeights[tickerCategory].adjustments,
          evaluatedCount: sharedCategoryWeights[tickerCategory].evaluatedCount,
        } : null,
        availableCategories: Object.keys(sharedCategoryWeights).map(k => ({
          key: k,
          label: CATEGORY_LABELS[k] || k,
          evaluatedCount: sharedCategoryWeights[k].evaluatedCount,
        })),
      });
    } catch (err: any) {
      console.error("Learning stats error:", err.message);
      res.status(500).json({ error: "Failed to fetch learning stats." });
    }
  });

  // --- Search stocks by name, ticker, or ISIN ---
  app.get("/api/search", async (req, res) => {
    try {
      const q = (req.query.q as string || "").trim();
      if (!q || q.length < 1) return res.json({ count: 0, result: [] });

      const cacheKey = `search:${q.toLowerCase()}`;
      const cached = getCached<any>(cacheKey, 300000);
      if (cached) return res.json(cached);

      // Detect ISIN and use smart resolution
      const isIsin = ISIN_REGEX.test(q.toUpperCase());
      const results = isIsin
        ? await resolveIsin(q.toUpperCase())
        : await yahooSearch(q);

      const filtered = results.slice(0, 20).map((r: any) => ({
        symbol: r.symbol,
        displaySymbol: r.symbol,
        description: r.shortname || r.longname || r.symbol,
        type: r.quoteType || "Stock",
      }));

      const result = { count: filtered.length, result: filtered };
      setCache(cacheKey, result);
      res.json(result);
    } catch (err: any) {
      console.error("Search error:", err.message);
      res.status(500).json({ error: "Search failed." });
    }
  });

  // --- Full prediction for a single stock ---
  app.get("/api/predict/:symbol", async (req, res) => {
    try {
      const user = (req.query.user as string) || "_default";
      const symbol = req.params.symbol.toUpperCase();
      const prediction = await fetchFullPrediction(symbol, user);
      if (!prediction) {
        return res.status(404).json({ error: "No data found. Market may be closed or symbol invalid." });
      }

      // Record prediction for watchlist stocks (per-user)
      const wl = getUserWatchlist(user);
      if (wl.some(w => w.symbol === symbol)) {
        recordPrediction(prediction, user);
      }

      res.json(prediction);
    } catch (err: any) {
      console.error("Predict error:", err.message);
      res.status(500).json({ error: "Failed to fetch prediction." });
    }
  });

  // --- Batch predictions for landing page ---
  app.get("/api/predictions", async (req, res) => {
    try {
      const force = req.query.force === "true";
      const symbolsParam = req.query.symbols as string;
      const symbols = symbolsParam
        ? symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
        : DEFAULT_SYMBOLS;

      const user = (req.query.user as string) || "_default";
      const cacheKey = `batch:${symbols.join(",")}:${safeUser(user)}`;

      if (force) {
        // Wipe individual prediction caches so fetchFullPrediction re-fetches
        for (const s of symbols) {
          cache.delete(`v4:${s}`);
          cache.delete(`v4:${s}:${safeUser(user)}`);
        }
        cache.delete(cacheKey);
      }

      const cached = !force ? getCached<any>(cacheKey, 60000) : null; // 60s

      // Even when serving cached results, record predictions for watchlist stocks
      // This ensures all watchlist stocks get history, not just ones the user clicks on
      if (cached) {
        const wl = getUserWatchlist(user);
        if (wl.length > 0) {
          const watchlistSymbols = new Set(wl.map(w => w.symbol));
          for (const pred of cached as StockPrediction[]) {
            if (watchlistSymbols.has(pred.ticker)) {
              recordPrediction(pred, user);
            }
          }
        }
        return res.json(cached);
      }

      const results: StockPrediction[] = [];
      const wl = getUserWatchlist(user);
      const watchlistSymbols = new Set(wl.map(w => w.symbol));
      for (const symbol of symbols.slice(0, 100)) {
        const prediction = await fetchFullPrediction(symbol, user);
        if (prediction) {
          results.push(prediction);
          if (watchlistSymbols.has(symbol)) {
            recordPrediction(prediction, user);
          }
        }
      }

      setCache(cacheKey, results);
      res.json(results);
    } catch (err: any) {
      console.error("Predictions error:", err.message);
      res.status(500).json({ error: "Failed to fetch predictions." });
    }
  });

  // --- Market summary ---
  app.get("/api/market-summary", async (req, res) => {
    try {
      const force = req.query.force === "true";
      const cacheKey = "market-summary";

      if (force) cache.delete(cacheKey);

      const cached = !force ? getCached<any>(cacheKey, 60000) : null; // 60s
      if (cached) return res.json(cached);

      const batchKey = `batch:${DEFAULT_SYMBOLS.join(",")}`;
      const predictions = getCached<StockPrediction[]>(batchKey, 60000) || []; // 60s

      if (predictions.length === 0) {
        return res.json({
          totalStocks: 0, bullishCount: 0, bearishCount: 0, neutralCount: 0,
          averageRisk: 0, averageSentiment: 0,
          topGainers: [], topLosers: [], totalSources: 0,
          lastUpdated: new Date().toISOString(),
        });
      }

      const sorted = [...predictions].sort((a, b) => b.priceChangePercent - a.priceChangePercent);
      const summary = {
        totalStocks: predictions.length,
        bullishCount: predictions.filter((p) => p.shortTerm.signal === "bullish").length,
        bearishCount: predictions.filter((p) => p.shortTerm.signal === "bearish").length,
        neutralCount: predictions.filter((p) => p.shortTerm.signal === "neutral").length,
        averageRisk: Math.round(predictions.reduce((s, p) => s + p.riskLevel, 0) / predictions.length),
        averageSentiment: round2(predictions.reduce((s, p) => s + p.sentimentScore, 0) / predictions.length),
        topGainers: sorted.slice(0, 3).map((p) => ({ ticker: p.ticker, change: p.priceChangePercent })),
        topLosers: sorted.slice(-3).reverse().map((p) => ({ ticker: p.ticker, change: p.priceChangePercent })),
        totalSources: predictions.reduce((s, p) => s + p.sourceBreakdown.total, 0),
        lastUpdated: new Date().toISOString(),
      };

      setCache(cacheKey, summary);
      res.json(summary);
    } catch (err: any) {
      console.error("Summary error:", err.message);
      res.status(500).json({ error: "Failed to compute summary." });
    }
  });

  // --- Force refresh: clear all server caches ---
  app.post("/api/force-refresh", (_req, res) => {
    const size = cache.size;
    clearAllCache();
    res.json({ cleared: size, timestamp: new Date().toISOString() });
  });

  // --- German stock tickers (DAX 40 + MDAX + SDAX/TecDAX selection) ---
  // Yahoo Finance uses .DE suffix for XETRA-listed stocks
  const DE_TICKERS = [
    // DAX 40
    "ADS.DE","AIR.DE","ALV.DE","BAS.DE","BAYN.DE","BEI.DE","BMW.DE","BNR.DE",
    "CBK.DE","CON.DE","1COV.DE","DTG.DE","DBK.DE","DB1.DE","DHL.DE","DTE.DE",
    "EOAN.DE","FRE.DE","HNR1.DE","HEI.DE","HEN3.DE","IFX.DE","MBG.DE","MRK.DE",
    "MTX.DE","MUV2.DE","PAH3.DE","QIA.DE","RHM.DE","RWE.DE","SAP.DE","SRT3.DE",
    "SIE.DE","ENR.DE","SHL.DE","SY1.DE","VNA.DE","VOW3.DE","ZAL.DE","P911.DE",
    // MDAX (50 stocks)
    "AIX.DE","AT1.DE","NDA.DE","AG1.DE","BC8.DE","GBF.DE","CZM.DE","EVD.DE",
    "DHER.DE","DWNI.DE","DWS.DE","EVK.DE","EVO.DE","FTK.DE","FRA.DE","FNTN.DE",
    "FPE3.DE","G1A.DE","GXI.DE","HLE.DE","HFG.DE","HAG.DE","HNK.DE","HOT.DE",
    "BOSS.DE","IOS.DE","JUN3.DE","SDF.DE","KGX.DE","KRN.DE","KBX.DE","LEG.DE",
    "LHA.DE","MDG1.DE","NDX1.DE","NEM.DE","PUM.DE","RAA.DE","R3NK.DE","RNKP.DE",
    "RTL.DE","S92.DE","SRT.DE","SHA.DE","TEG.DE","TLX.DE","TUI1.DE","UN01.DE",
    // TecDAX / SDAX selection
    "AIXA.DE","BDT.DE","BYW6.DE","COP.DE","DEZ.DE","DBAN.DE","DRI.DE",
    "SFQ.DE","SOW.DE","TMV.DE","WAF.DE","WDI.DE","O2D.DE","PBB.DE",
    "G24.DE","GFT.DE","INH.DE","JEN.DE","KWS.DE","LXS.DE","MOR.DE",
    "NB2.DE","PSM.DE","PNE3.DE","S4A.DE","SZG.DE","STM.DE","SBS.DE",
    "TKA.DE","WCH.DE","ZIL2.DE","ADV.DE","AMZ.DE","DLX.DE","EVT.DE",
    "FME.DE","HDD.DE","HHFA.DE","SEM.DE","SW1.DE","VBK.DE","ZO1.DE",
  ];

  // Helper: batch-quote German stocks and format as BrowseStock[]
  async function fetchGermanStocks(category: string): Promise<any[]> {
    const cacheKey = `de_stocks_raw`;
    let deQuotes = getCached<any[]>(cacheKey, 90000); // 90s cache

    if (!deQuotes) {
      const yf = await getYahoo();
      // Batch quote in chunks of 50 to avoid overloading
      const chunks: string[][] = [];
      for (let i = 0; i < DE_TICKERS.length; i += 50) {
        chunks.push(DE_TICKERS.slice(i, i + 50));
      }

      deQuotes = [];
      for (const chunk of chunks) {
        try {
          const results = await Promise.all(
            chunk.map(ticker => yf.quote(ticker).catch(() => null))
          );
          deQuotes.push(...results.filter((q: any) => q && q.regularMarketPrice));
        } catch {
          // skip failed chunks
        }
      }
      setCache(cacheKey, deQuotes);
    }

    const eurRate = await getEurRate();

    let formatted = deQuotes.map((q: any) => {
      const currency = (q.currency || "EUR").toUpperCase();
      const needsConversion = currency !== "EUR";
      const toEur = (v: number) => needsConversion ? convertToEur(v, eurRate) : v;

      return {
        symbol: q.symbol,
        name: q.longName || q.shortName || q.symbol,
        shortName: q.shortName || q.symbol,
        price: round2(toEur(q.regularMarketPrice || 0)),
        change: round2(toEur(q.regularMarketChange || 0)),
        changePercent: round2(q.regularMarketChangePercent || 0),
        volume: q.regularMarketVolume || 0,
        avgVolume: q.averageDailyVolume3Month || 0,
        exchange: q.fullExchangeName || q.exchange || "XETRA",
        market: "DE",
        marketCap: q.marketCap || 0,
        fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ? toEur(q.fiftyTwoWeekHigh) : null,
        fiftyTwoWeekLow: q.fiftyTwoWeekLow ? toEur(q.fiftyTwoWeekLow) : null,
      };
    });

    // Sort by category
    switch (category) {
      case "most_actives":
        formatted.sort((a: any, b: any) => b.volume - a.volume);
        break;
      case "day_gainers":
        formatted.sort((a: any, b: any) => b.changePercent - a.changePercent);
        formatted = formatted.filter((s: any) => s.changePercent > 0);
        break;
      case "day_losers":
        formatted.sort((a: any, b: any) => a.changePercent - b.changePercent);
        formatted = formatted.filter((s: any) => s.changePercent < 0);
        break;
    }

    return formatted;
  }

  // --- Browse market stocks (lightweight, no predictions) ---
  // Supports: ?category=most_actives|day_gainers|day_losers
  //           &market=all|us|de  (default: all — fetches both US + DE)
  //           &offset=0           (pagination start)
  //           &count=50           (page size, max 100)
  // Returns: { stocks: BrowseStock[], total: number, offset: number, hasMore: boolean }
  app.get("/api/browse", async (req, res) => {
    try {
      const category = (req.query.category as string) || "most_actives";
      const market = ((req.query.market as string) || "all").toLowerCase();
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
      const count = Math.min(Math.max(parseInt(req.query.count as string) || 50, 1), 100);

      const validCategories = ["most_actives", "day_gainers", "day_losers"];
      if (!validCategories.includes(category)) {
        return res.status(400).json({ error: "Invalid category. Use: most_actives, day_gainers, day_losers" });
      }

      // Cache the combined result per category+market
      const cacheKey = `browse:v2:${category}:${market}`;
      let allStocks = getCached<any[]>(cacheKey, 90000); // 90s cache

      if (!allStocks) {
        const yf = await getYahoo();
        const eurRate = await getEurRate();

        const fetchUS = market === "all" || market === "us";
        const fetchDE = market === "all" || market === "de";

        // Fetch US stocks via screener
        let usStocks: any[] = [];
        if (fetchUS) {
          try {
            const screen = await yf.screener({ scrIds: category as any, count: 250, region: "US", lang: "en-US" });
            usStocks = (screen.quotes || [])
              .filter((q: any) => q.quoteType === "EQUITY" && q.symbol && q.regularMarketPrice)
              .map((q: any) => {
                const currency = (q.currency || "USD").toUpperCase();
                const needsConversion = currency !== "EUR";
                const toEur = (v: number) => needsConversion ? convertToEur(v, eurRate) : v;

                return {
                  symbol: q.symbol,
                  name: q.longName || q.shortName || q.symbol,
                  shortName: q.shortName || q.symbol,
                  price: round2(toEur(q.regularMarketPrice || 0)),
                  change: round2(toEur(q.regularMarketChange || 0)),
                  changePercent: round2(q.regularMarketChangePercent || 0),
                  volume: q.regularMarketVolume || 0,
                  avgVolume: q.averageDailyVolume3Month || 0,
                  exchange: q.fullExchangeName || q.exchange || "",
                  market: "US",
                  marketCap: q.marketCap || 0,
                  fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ? toEur(q.fiftyTwoWeekHigh) : null,
                  fiftyTwoWeekLow: q.fiftyTwoWeekLow ? toEur(q.fiftyTwoWeekLow) : null,
                };
              });
          } catch (err: any) {
            console.error("US screener error:", err.message);
          }
        }

        // Fetch DE stocks via batch quote of known German index constituents
        let deStocks: any[] = [];
        if (fetchDE) {
          try {
            deStocks = await fetchGermanStocks(category);
          } catch (err: any) {
            console.error("DE stocks error:", err.message);
          }
        }

        // Merge: for "all" mode, interleave by category sort
        if (market === "all") {
          allStocks = [...usStocks, ...deStocks];
          // Re-sort the combined list by the category criteria
          switch (category) {
            case "most_actives":
              allStocks.sort((a, b) => b.volume - a.volume);
              break;
            case "day_gainers":
              allStocks.sort((a, b) => b.changePercent - a.changePercent);
              break;
            case "day_losers":
              allStocks.sort((a, b) => a.changePercent - b.changePercent);
              break;
          }
        } else {
          allStocks = market === "us" ? usStocks : deStocks;
        }

        // Deduplicate by symbol
        const seen = new Set<string>();
        allStocks = allStocks.filter(s => {
          if (seen.has(s.symbol)) return false;
          seen.add(s.symbol);
          return true;
        });

        setCache(cacheKey, allStocks);
      }

      // Paginate
      const page = allStocks.slice(offset, offset + count);
      res.json({
        stocks: page,
        total: allStocks.length,
        offset,
        hasMore: offset + count < allStocks.length,
      });
    } catch (err: any) {
      console.error("Browse error:", err.message);
      res.status(500).json({ error: "Failed to fetch browse data." });
    }
  });

  // --- Historical price data + projection ---
  app.get("/api/history/:symbol", async (req, res) => {
    try {
      const force = req.query.force === "true";
      const symbol = req.params.symbol.toUpperCase();
      const range = (req.query.range as string) || "3mo"; // 1mo, 3mo, 6mo, 1y
      const user = (req.query.user as string) || "_default";

      const cacheKey = `history:${symbol}:${range}`;

      if (force) {
        cache.delete(cacheKey);
        cache.delete(`v4:${symbol}`); // also clear prediction cache for this symbol
        cache.delete(`v4:${symbol}:${safeUser(user)}`);
      }

      const cached = !force ? getCached<any>(cacheKey, 300000) : null; // 5 min for chart history is fine
      if (cached) return res.json(cached);

      const yf = await getYahoo();

      // Map range to period
      const periodMap: Record<string, { period1: string; interval: string }> = {
        "1mo": { period1: daysAgo(30), interval: "1d" },
        "3mo": { period1: daysAgo(90), interval: "1d" },
        "6mo": { period1: daysAgo(180), interval: "1wk" },
        "1y": { period1: daysAgo(365), interval: "1wk" },
      };

      const config = periodMap[range] || periodMap["3mo"];
      const [result, eurRate] = await Promise.all([
        yf.chart(symbol, {
          period1: config.period1,
          interval: config.interval,
        }),
        getEurRate(),
      ]);

      // Determine if this symbol needs EUR conversion
      const chartMeta = result?.meta || {};
      const chartCurrency = (chartMeta.currency || "USD").toUpperCase();
      const needsConversion = chartCurrency !== "EUR";
      const toEur = (val: number) => needsConversion ? convertToEur(val, eurRate) : val;

      const quotes = result?.quotes || [];
      const historical = quotes
        .filter((q: any) => q.close != null && q.date != null)
        .map((q: any) => ({
          date: new Date(q.date).toISOString().split("T")[0],
          close: round2(toEur(q.close)),
        }));

      // Generate projection based on prediction, scaled to the selected range
      // Check prediction cache (3 min TTL — matches batch prediction TTL)
      const predCacheKey = `v4:${symbol}:${safeUser(user)}`;
      let prediction = getCached<StockPrediction>(predCacheKey, 60000); // 60s
      // Fallback: try generic cache without user (from non-user requests)
      if (!prediction) prediction = getCached<StockPrediction>(`v4:${symbol}`, 60000);

      // If no cached prediction, fetch one on-the-fly so the chart always has a projection
      if (!prediction) {
        try {
          prediction = await fetchFullPrediction(symbol, user);
        } catch {
          // Non-fatal — we'll just show historical only
        }
      }

      const projection = generateProjection(historical, prediction, range);

      const data = { historical, projection };
      // Only cache if we have a projection — otherwise a re-request can try again
      if (projection.length > 0) {
        setCache(cacheKey, data);
      }
      res.json(data);
    } catch (err: any) {
      console.error("History error:", err.message);
      res.status(500).json({ error: "Failed to fetch history." });
    }
  });

  // --- Data Source Status ---
  app.get("/api/data-sources", (_req, res) => {
    const provider = getPriceProvider();
    res.json(provider.getStatus());
  });

  // ═══════════════════════════════════════════════════════════
  // TRADE REPUBLIC ADMIN PANEL
  // Protected by admin password (env: TR_ADMIN_PASSWORD, default: STOXVIEW_DATA_DIR-based)
  // ═══════════════════════════════════════════════════════════
  const TR_ADMIN_PASSWORD = process.env.TR_ADMIN_PASSWORD || "Leckmeineeier";

  function checkAdminAuth(req: any, res: any): boolean {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${TR_ADMIN_PASSWORD}`) {
      res.status(401).json({ error: "Unauthorized" });
      return false;
    }
    return true;
  }

  // Admin page — serves the admin dashboard UI
  app.get("/admin", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(getTRAdminHTML());
  });
  // Backwards compat redirect
  app.get("/admin/tr", (_req, res) => res.redirect("/admin"));

  // Step 1: Initiate TR login — triggers 2FA to phone
  app.post("/api/tr/login", async (req, res) => {
    if (!checkAdminAuth(req, res)) return;
    try {
      const provider = getPriceProvider();
      const trClient = provider.getTRClient();
      if (!trClient) {
        return res.status(400).json({ error: "Trade Republic nicht konfiguriert. TR_PHONE und TR_PIN Umgebungsvariablen setzen." });
      }

      const result = await trClient.initiateLogin();
      if (!result) {
        return res.status(500).json({ error: "TR Login fehlgeschlagen. Überprüfe Telefonnummer und PIN." });
      }

      res.json({ processId: result.processId, message: "2FA-Code wurde an dein Handy gesendet" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Step 2: Verify 2FA code and establish session
  app.post("/api/tr/verify", async (req, res) => {
    if (!checkAdminAuth(req, res)) return;
    try {
      const { processId, code } = req.body;
      if (!processId || !code) {
        return res.status(400).json({ error: "processId und Code erforderlich" });
      }

      const provider = getPriceProvider();
      const trClient = provider.getTRClient();
      if (!trClient) {
        return res.status(400).json({ error: "Trade Republic nicht konfiguriert" });
      }

      const success = await trClient.completeLogin(processId, code);
      if (!success) {
        return res.status(401).json({ error: "2FA-Verifizierung fehlgeschlagen. Code falsch oder abgelaufen." });
      }

      // Reset provider state so it picks up the new session
      provider.resetTRState();
      await provider.initTradeRepublic();

      res.json({ success: true, message: "Trade Republic verbunden!" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Admin: Algorithm dashboard data ---
  app.get("/api/admin/algorithm-stats", (req, res) => {
    if (!checkAdminAuth(req, res)) return;
    try {
      // Collect stats from all loaded users
      const allUserStats: any[] = [];

      userHistories.forEach((history, userKey) => {
        const state = getUserLearningState(userKey);
        const totalEntries = history.length;
        const withSourceSignals = history.filter(e => !!e.sourceSignals).length;
        const evaluated = history.filter(e =>
          e.actualPriceShort !== undefined || e.actualPriceMedium !== undefined || e.actualPriceLong !== undefined
        ).length;

        // Accuracy per timeframe
        let stCorrect = 0, stTotal = 0, mtCorrect = 0, mtTotal = 0, ltCorrect = 0, ltTotal = 0;
        for (const e of history) {
          if (e.actualPriceShort !== undefined) {
            stTotal++;
            const up = e.actualPriceShort > e.priceAtPrediction;
            const down = e.actualPriceShort < e.priceAtPrediction;
            if ((e.shortTerm.signal === "bullish" && up) || (e.shortTerm.signal === "bearish" && down) ||
              (e.shortTerm.signal === "neutral" && Math.abs(e.actualPriceShort - e.priceAtPrediction) / e.priceAtPrediction < 0.02)) stCorrect++;
          }
          if (e.actualPriceMedium !== undefined) {
            mtTotal++;
            const up = e.actualPriceMedium > e.priceAtPrediction;
            const down = e.actualPriceMedium < e.priceAtPrediction;
            if ((e.mediumTerm.signal === "bullish" && up) || (e.mediumTerm.signal === "bearish" && down) ||
              (e.mediumTerm.signal === "neutral" && Math.abs(e.actualPriceMedium - e.priceAtPrediction) / e.priceAtPrediction < 0.03)) mtCorrect++;
          }
          if (e.actualPriceLong !== undefined) {
            ltTotal++;
            const up = e.actualPriceLong > e.priceAtPrediction;
            const down = e.actualPriceLong < e.priceAtPrediction;
            if ((e.longTerm.signal === "bullish" && up) || (e.longTerm.signal === "bearish" && down) ||
              (e.longTerm.signal === "neutral" && Math.abs(e.actualPriceLong - e.priceAtPrediction) / e.priceAtPrediction < 0.05)) ltCorrect++;
          }
        }

        // Recent predictions (last 7 days)
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
        const recentEntries = history.filter(e => e.date >= sevenDaysAgo);

        // Per-stock breakdown
        const tickerMap = new Map<string, { count: number; lastDate: string; category: string }>();
        for (const e of history) {
          const cur = tickerMap.get(e.ticker);
          if (!cur || e.date > cur.lastDate) {
            tickerMap.set(e.ticker, {
              count: (cur?.count || 0) + 1,
              lastDate: e.date,
              category: e.category || "other",
            });
          } else {
            cur.count++;
          }
        }

        const stockBreakdown: any[] = [];
        tickerMap.forEach((info, ticker) => {
          const cat = info.category;
          stockBreakdown.push({
            ticker,
            predictions: info.count,
            lastDate: info.lastDate,
            category: CATEGORY_LABELS[cat] || cat,
            hasCategoryWeights: !!sharedCategoryWeights[cat],
          });
        });
        stockBreakdown.sort((a, b) => b.predictions - a.predictions);

        allUserStats.push({
          user: userKey,
          totalPredictions: totalEntries,
          withSourceSignals,
          evaluated,
          recentCount: recentEntries.length,
          accuracy: {
            shortTerm: { total: stTotal, correct: stCorrect, pct: stTotal > 0 ? round2((stCorrect / stTotal) * 100) : null },
            mediumTerm: { total: mtTotal, correct: mtCorrect, pct: mtTotal > 0 ? round2((mtCorrect / mtTotal) * 100) : null },
            longTerm: { total: ltTotal, correct: ltCorrect, pct: ltTotal > 0 ? round2((ltCorrect / ltTotal) * 100) : null },
          },
          stocks: stockBreakdown,
        });
      });

      // Category weights summary
      const categories = Object.entries(sharedCategoryWeights).map(([key, w]) => ({
        key,
        label: CATEGORY_LABELS[key] || key,
        weights: w.weights,
        adjustments: w.adjustments,
        evaluatedCount: w.evaluatedCount,
        lastUpdated: w.lastUpdated,
      }));

      // Calculate countdown from actual prediction dates
      const now = Date.now();
      let nextShortDays: number | null = null;
      let nextMedDays: number | null = null;
      let nextLongDays: number | null = null;
      let totalEval = 0;

      userHistories.forEach((history) => {
        for (const e of history) {
          const entryDate = new Date(e.date).getTime();
          if (e.actualPriceShort === undefined) {
            const d = Math.max(0, Math.ceil((entryDate + 7 * 86400000 - now) / 86400000));
            if (nextShortDays === null || d < nextShortDays) nextShortDays = d;
          } else { totalEval++; }
          if (e.actualPriceMedium === undefined) {
            const d = Math.max(0, Math.ceil((entryDate + 28 * 86400000 - now) / 86400000));
            if (nextMedDays === null || d < nextMedDays) nextMedDays = d;
          }
          if (e.actualPriceLong === undefined) {
            const d = Math.max(0, Math.ceil((entryDate + 90 * 86400000 - now) / 86400000));
            if (nextLongDays === null || d < nextLongDays) nextLongDays = d;
          }
        }
      });

      res.json({
        defaults: DEFAULT_WEIGHTS,
        users: allUserStats,
        learning: {
          isActive: !!sharedGlobalWeights,
          globalWeights: sharedGlobalWeights?.weights || null,
          globalAdjustments: sharedGlobalWeights?.adjustments || null,
          globalEvaluatedCount: sharedGlobalWeights?.evaluatedCount || 0,
          globalLastUpdated: sharedGlobalWeights?.lastUpdated || null,
          categories,
          categoryCount: categories.length,
        },
        countdown: {
          nextShortDays,
          nextMedDays,
          nextLongDays,
          totalEvaluated: totalEval,
          needsForLearning: sharedGlobalWeights ? 0 : Math.max(0, 5 - totalEval),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("Admin algo stats error:", err.message);
      res.status(500).json({ error: "Failed to fetch algorithm stats." });
    }
  });

  return httpServer;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().split("T")[0];
}

// Generate projected price points driven by prediction signals.
// The projection length scales to the selected chart range:
//   1mo  → 20 trading days (~1 month)
//   3mo  → 60 trading days (~3 months)
//   6mo  → 125 trading days (~6 months)
//   1y   → 250 trading days (~1 year)
// Three signal phases:
//   Days 1–7:     short-term signal dominates
//   Days 8–28:    medium-term signal dominates
//   Days 29+:     long-term signal dominates (extended for longer ranges)
function generateProjection(
  historical: { date: string; close: number }[],
  prediction: StockPrediction | null,
  range?: string,
): { date: string; close: number }[] {
  if (!historical.length || !prediction) return [];

  const lastPoint = historical[historical.length - 1];
  const lastPrice = lastPoint.close;
  const lastDate = new Date(lastPoint.date);

  // Trading days per range (how far into the future we project)
  const tradingDaysMap: Record<string, number> = {
    "1mo": 20,
    "3mo": 60,
    "6mo": 125,
    "1y": 250,
  };
  const totalTradingDays = tradingDaysMap[range || "3mo"] || 60;
  // Calendar days needed (roughly 1.5x trading days to account for weekends)
  const maxCalendarDays = Math.ceil(totalTradingDays * 1.45);

  // Convert signal + confidence into a drift rate per timeframe
  const signalDrift = (signal: string, confidence: number): number => {
    const direction = signal === "bullish" ? 1 : signal === "bearish" ? -1 : 0;
    // confidence 0-100 → move magnitude 0-15% over the window
    return direction * (confidence / 100) * 0.15;
  };

  const stDrift = signalDrift(prediction.shortTerm.signal, prediction.shortTerm.confidence);
  const mtDrift = signalDrift(prediction.mediumTerm.signal, prediction.mediumTerm.confidence);
  const ltDrift = signalDrift(prediction.longTerm.signal, prediction.longTerm.confidence);

  // Target prices at each timeframe boundary
  const stTarget = lastPrice * (1 + stDrift);   // after ~7 trading days
  const mtTarget = stTarget * (1 + mtDrift);     // after ~28 trading days
  const ltTarget = mtTarget * (1 + ltDrift);     // after ~60 trading days

  // For the extended phase (6mo/1y, beyond day 60), smoothly continue
  // from ltTarget using the LT-phase slope (mtTarget → ltTarget over 32 days)
  // This ensures no direction change or bump at the day-60 boundary
  const ltPhaseDailyMove = (ltTarget - mtTarget) / 32; // price change per trading day in LT phase

  const projection: { date: string; close: number }[] = [];
  let tradingDay = 0;

  // Seed a deterministic pseudo-random from ticker hash for consistent micro-wobble
  let seed = 0;
  for (let i = 0; i < prediction.ticker.length; i++) seed = (seed * 31 + prediction.ticker.charCodeAt(i)) & 0x7fffffff;
  const pseudoRandom = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) - 0.5; };

  for (let calDay = 1; calDay <= maxCalendarDays; calDay++) {
    const date = new Date(lastDate);
    date.setDate(date.getDate() + calDay);
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    tradingDay++;
    if (tradingDay > totalTradingDays) break;

    // Smooth interpolation through timeframe targets
    let targetPrice: number;
    if (tradingDay <= 7) {
      // Short-term phase: interpolate from lastPrice to stTarget
      const t = tradingDay / 7;
      targetPrice = lastPrice + (stTarget - lastPrice) * t;
    } else if (tradingDay <= 28) {
      // Medium-term phase: interpolate from stTarget to mtTarget
      const t = (tradingDay - 7) / 21;
      targetPrice = stTarget + (mtTarget - stTarget) * t;
    } else if (tradingDay <= 60) {
      // Long-term phase: interpolate from mtTarget to ltTarget
      const t = (tradingDay - 28) / 32;
      targetPrice = mtTarget + (ltTarget - mtTarget) * Math.min(t, 1);
    } else {
      // Extended phase (6mo/1y): smooth continuation from ltTarget
      // Continues the LT-phase slope with gradual deceleration (no direction change)
      const extraDays = tradingDay - 60;
      // Decaying daily move: starts at ltPhaseDailyMove, decays toward 0
      // Cumulative sum of 1/(1+k) for k=0..extraDays gives log(1+extraDays)
      // Scale so the curve decelerates naturally
      const cumulativeMove = ltPhaseDailyMove * Math.log(1 + extraDays) * 2;
      targetPrice = ltTarget + cumulativeMove;
    }

    // Add subtle micro-wobble for realism (slightly larger for extended projections)
    const wobbleScale = tradingDay > 60 ? 0.003 : 0.002;
    const wobble = pseudoRandom() * lastPrice * wobbleScale;
    const price = targetPrice + wobble;

    projection.push({
      date: date.toISOString().split("T")[0],
      close: round2(Math.max(price, lastPrice * 0.3)),
    });
  }

  return projection;
}

// ═══════════════════════════════════════════════════════════
// TRADE REPUBLIC ADMIN PAGE HTML
// ═══════════════════════════════════════════════════════════
function getTRAdminHTML(): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StoxView Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      min-height: 100vh;
    }

    /* ── Login screen ── */
    .login-wrap {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .login-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 32px;
      width: 100%;
      max-width: 400px;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
    }
    .logo-icon {
      width: 40px; height: 40px;
      background: linear-gradient(135deg, #00d2ff 0%, #0088ff 100%);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; font-weight: 700; color: #0d1117;
    }
    .logo h1 { font-size: 18px; font-weight: 600; }
    .logo h1 span { color: #00d2ff; }

    /* ── Dashboard ── */
    .dashboard { display: none; }
    .dashboard.active { display: block; }
    .login-wrap.hidden { display: none; }

    .header {
      background: #161b22;
      border-bottom: 1px solid #30363d;
      padding: 14px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .header-left .logo-icon {
      width: 32px; height: 32px;
      font-size: 16px;
      border-radius: 8px;
    }
    .header-left h1 { font-size: 16px; font-weight: 600; }
    .header-left h1 span { color: #00d2ff; }
    .header-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .btn-icon {
      background: none;
      border: 1px solid #30363d;
      color: #8b949e;
      width: 34px; height: 34px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      padding: 0;
      transition: all 0.2s;
    }
    .btn-icon:hover { color: #e6edf3; border-color: #8b949e; }
    .btn-icon.spinning { animation: spin 0.8s linear infinite; }
    .btn-logout {
      background: none;
      border: 1px solid #30363d;
      color: #f85149;
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      width: auto;
    }
    .btn-logout:hover { background: #f8514922; border-color: #f85149; }

    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      padding: 20px 24px;
      max-width: 1100px;
      margin: 0 auto;
    }
    .grid .card.full-width { grid-column: 1 / -1; }

    @media (max-width: 700px) {
      .grid { grid-template-columns: 1fr; padding: 16px; gap: 12px; }
    }

    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 20px;
    }
    .card-title {
      font-size: 14px;
      font-weight: 600;
      color: #e6edf3;
      margin-bottom: 14px;
      padding-bottom: 8px;
      border-bottom: 1px solid #30363d;
    }

    /* ── Shared ── */
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #8b949e;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      padding: 10px 14px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      color: #e6edf3;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
      margin-bottom: 16px;
    }
    input:focus { border-color: #00d2ff; }
    input::placeholder { color: #484f58; }
    button {
      padding: 10px 16px;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary {
      background: linear-gradient(135deg, #00d2ff 0%, #0088ff 100%);
      color: #0d1117;
      width: 100%;
    }
    .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
    .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

    .message {
      margin-top: 12px;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      display: none;
    }
    .message.success { background: #0d2818; border: 1px solid #238636; color: #3fb950; display: block; }
    .message.error { background: #2d1117; border: 1px solid #f85149; color: #f85149; display: block; }
    .message.info { background: #0d1d30; border: 1px solid #1f6feb; color: #58a6ff; display: block; }

    .spinner {
      display: inline-block;
      width: 14px; height: 14px;
      border: 2px solid transparent;
      border-top-color: currentColor;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── TR Card ── */
    .status-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      margin-bottom: 14px;
      font-size: 13px;
    }
    .dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .dot.green { background: #3fb950; box-shadow: 0 0 6px #3fb950; }
    .dot.red { background: #f85149; }
    .dot.orange { background: #d29922; box-shadow: 0 0 6px #d29922; }
    .dot.gray { background: #484f58; }
    .muted { color: #8b949e; }
    .step { display: none; }
    .step.active { display: block; }
    .session-info {
      margin-top: 12px;
      padding: 10px 12px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      font-size: 11px;
      color: #8b949e;
    }
    .session-info strong { color: #e6edf3; }

    /* ── Algo Status Card ── */
    .stat-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 10px;
    }
    .stat-box {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 10px 12px;
    }
    .stat-box .val { font-size: 20px; font-weight: 700; color: #e6edf3; }
    .stat-box .lbl { font-size: 11px; color: #8b949e; margin-top: 2px; }

    /* ── Countdown section ── */
    #algoCountdown {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid #30363d;
    }
    .cd-title { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
    .cd-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .cd-label { font-size: 11px; color: #8b949e; width: 90px; text-align: right; flex-shrink: 0; }
    .cd-track { flex: 1; height: 6px; background: #161b22; border-radius: 3px; overflow: hidden; border: 1px solid #30363d; }
    .cd-fill { height: 100%; background: rgba(0, 210, 255, 0.5); border-radius: 3px; transition: width 0.4s; }
    .cd-fill.green { background: #3fb950; }
    .cd-val { font-size: 11px; color: #8b949e; width: 55px; text-align: right; font-variant-numeric: tabular-nums; }
    .cd-val.green { color: #3fb950; }
    .cd-note { font-size: 11px; color: #8b949e; margin-top: 8px; }

    /* ── Accuracy Card ── */
    .acc-bar-wrap { margin-bottom: 12px; }
    .acc-header {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #8b949e;
      margin-bottom: 4px;
    }
    .acc-track {
      height: 8px;
      background: #0d1117;
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid #30363d;
    }
    .acc-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.4s ease;
    }
    .acc-fill.green { background: #3fb950; }
    .acc-fill.amber { background: #d29922; }
    .acc-fill.red { background: #f85149; }
    .acc-fill.gray { background: #484f58; }
    .acc-detail { font-size: 11px; color: #8b949e; margin-top: 3px; }

    /* ── Weights Card ── */
    .w-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .w-table th {
      text-align: left;
      color: #8b949e;
      font-weight: 500;
      padding: 6px 8px;
      border-bottom: 1px solid #30363d;
    }
    .w-table td {
      padding: 8px;
      border-bottom: 1px solid #21262d;
      color: #e6edf3;
    }
    .w-bar-cell { width: 80px; }
    .w-bar {
      height: 6px;
      background: #0d1117;
      border-radius: 3px;
      overflow: hidden;
    }
    .w-bar-fill {
      height: 100%;
      border-radius: 3px;
      background: linear-gradient(90deg, #00d2ff, #0088ff);
    }
    .delta-pos { color: #3fb950; }
    .delta-neg { color: #f85149; }

    /* ── Stocks Card ── */
    .stocks-wrap {
      max-height: 340px;
      overflow-y: auto;
      border: 1px solid #30363d;
      border-radius: 8px;
    }
    .stocks-wrap::-webkit-scrollbar { width: 6px; }
    .stocks-wrap::-webkit-scrollbar-track { background: #0d1117; }
    .stocks-wrap::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
    .s-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .s-table th {
      text-align: left;
      color: #8b949e;
      font-weight: 500;
      padding: 6px 8px;
      border-bottom: 1px solid #30363d;
      position: sticky;
      top: 0;
      background: #161b22;
    }
    .s-table td {
      padding: 8px;
      border-bottom: 1px solid #21262d;
      color: #e6edf3;
    }
    .s-row { cursor: pointer; transition: background 0.15s; }
    .s-row:hover { background: #1c2128; }
    .s-detail { display: none; background: #0d1117; }
    .s-detail.open { display: table-row; }
    .s-detail td { padding: 10px 12px; font-size: 11px; color: #8b949e; }
    .s-weights {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 12px;
    }
    .s-weights span { color: #e6edf3; }

    /* ── Loading / hints ── */
    .card-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 30px 0;
      color: #8b949e;
      font-size: 13px;
    }
    .card-error {
      text-align: center;
      padding: 20px 0;
      color: #f85149;
      font-size: 13px;
    }
    .hint {
      color: #8b949e;
      font-size: 12px;
      font-style: italic;
      padding: 6px 0;
    }
  </style>
</head>
<body>

  <!-- ════ LOGIN SCREEN ════ -->
  <div class="login-wrap" id="loginWrap">
    <div class="login-card">
      <div class="logo">
        <div class="logo-icon">S</div>
        <h1>Stox<span>View</span> Admin</h1>
      </div>
      <p style="color:#8b949e;font-size:13px;margin-bottom:20px">Bitte mit Admin-Passwort anmelden</p>
      <label for="adminPw">Admin-Passwort</label>
      <input type="password" id="adminPw" placeholder="Passwort eingeben" autocomplete="off">
      <button class="btn-primary" id="btnAuth" onclick="authenticate()">Anmelden</button>
      <div class="message" id="loginMsg"></div>
    </div>
  </div>

  <!-- ════ DASHBOARD ════ -->
  <div class="dashboard" id="dashboard">

    <!-- Header -->
    <div class="header">
      <div class="header-left">
        <div class="logo-icon">S</div>
        <h1>Stox<span>View</span> Admin</h1>
      </div>
      <div class="header-right">
        <button class="btn-icon" onclick="refreshAll()" id="btnRefresh" title="Aktualisieren">\u21bb</button>
        <button class="btn-logout" onclick="logout()">Abmelden</button>
      </div>
    </div>

    <!-- Card Grid -->
    <div class="grid">

      <!-- Card 1: Trade Republic -->
      <div class="card" id="cardTR">
        <div class="card-title">Trade Republic</div>
        <div class="status-row">
          <div class="dot gray" id="trDot"></div>
          <span id="trStatusText" class="muted">Status wird geladen\u2026</span>
        </div>
        <div id="trBody">
          <!-- Step 1: Initiate Login (step0 is the global login now) -->
          <div class="step active" id="trStep1">
            <p style="color:#8b949e;font-size:13px;margin-bottom:14px">
              Klicke auf \u201eAnmelden\u201c um einen 2FA-Code an dein Handy zu senden.
              TR-Zugangsdaten werden aus den Umgebungsvariablen gelesen.
            </p>
            <button class="btn-primary" id="btnLogin" onclick="initiateLogin()">Anmelden</button>
          </div>
          <!-- Step 2: 2FA -->
          <div class="step" id="trStep2">
            <label for="code2fa">2FA-Code</label>
            <input type="text" id="code2fa" placeholder="4-stelliger Code" maxlength="4"
                   pattern="[0-9]*" inputmode="numeric" autocomplete="one-time-code">
            <button class="btn-primary" id="btnVerify" onclick="verifyCode()">Verifizieren</button>
          </div>
          <div class="message" id="trMsg"></div>
          <div class="session-info" id="sessionInfo" style="display:none">
            <strong>Session-Info:</strong><br>
            <span id="sessionDetails"></span>
          </div>
        </div>
      </div>

      <!-- Card 2: Algorithmus-Status -->
      <div class="card" id="cardAlgoStatus">
        <div class="card-title">Algorithmus-Status</div>
        <div class="card-loading" id="algoStatusLoading"><span class="spinner" style="border-top-color:#00d2ff"></span> Lade\u2026</div>
        <div class="card-error" id="algoStatusError" style="display:none"></div>
        <div id="algoStatusContent" style="display:none">
          <div class="status-row">
            <div class="dot gray" id="algoDot"></div>
            <span id="algoStatusLabel" class="muted">\u2013</span>
          </div>
          <div class="stat-grid">
            <div class="stat-box"><div class="val" id="statTotal">\u2013</div><div class="lbl">Vorhersagen gesamt</div></div>
            <div class="stat-box"><div class="val" id="statEval">\u2013</div><div class="lbl">Ausgewertet</div></div>
            <div class="stat-box"><div class="val" id="statSignals">\u2013</div><div class="lbl">Mit Quellensignalen</div></div>
            <div class="stat-box"><div class="val" id="statRecent">\u2013</div><div class="lbl">Letzte 7 Tage</div></div>
          </div>
          <div id="algoCountdown" style="display:none"></div>
        </div>
      </div>

      <!-- Card 3: Genauigkeit -->
      <div class="card" id="cardAccuracy">
        <div class="card-title">Genauigkeit</div>
        <div class="card-loading" id="accLoading"><span class="spinner" style="border-top-color:#00d2ff"></span> Lade\u2026</div>
        <div id="accContent" style="display:none"></div>
      </div>

      <!-- Card 4: Quellen-Gewichtung -->
      <div class="card" id="cardWeights">
        <div class="card-title">Quellen-Gewichtung</div>
        <div class="card-loading" id="wLoading"><span class="spinner" style="border-top-color:#00d2ff"></span> Lade\u2026</div>
        <div id="wContent" style="display:none"></div>
      </div>

      <!-- Card 5: Aktien-\u00dcbersicht (full width) -->
      <div class="card full-width" id="cardStocks">
        <div class="card-title">Aktien-\u00dcbersicht</div>
        <div class="card-loading" id="sLoading"><span class="spinner" style="border-top-color:#00d2ff"></span> Lade\u2026</div>
        <div id="sContent" style="display:none"></div>
      </div>

    </div>
  </div>

  <script>
    let adminToken = '';
    let processId = '';

    // Detect base path
    const basePath = window.location.pathname.replace(/\\/admin(\\/tr)?\\/?$/, '').replace(/\\/$/, '');
    function apiUrl(path) { return basePath + path; }

    // ─── Login ───
    document.getElementById('adminPw').addEventListener('keydown', e => {
      if (e.key === 'Enter') authenticate();
    });

    async function authenticate() {
      const pw = document.getElementById('adminPw').value.trim();
      if (!pw) {
        showLoginMsg('Bitte Passwort eingeben', 'error');
        return;
      }
      // Verify password against server before showing dashboard
      try {
        const res = await fetch(apiUrl('/api/admin/algorithm-stats'), {
          headers: { 'Authorization': 'Bearer ' + pw }
        });
        if (!res.ok) {
          showLoginMsg('Falsches Passwort', 'error');
          return;
        }
      } catch (err) {
        showLoginMsg('Verbindungsfehler', 'error');
        return;
      }
      adminToken = pw;
      document.getElementById('loginWrap').classList.add('hidden');
      document.getElementById('dashboard').classList.add('active');
      fetchAllData();
    }

    function showLoginMsg(text, type) {
      const el = document.getElementById('loginMsg');
      el.textContent = text;
      el.className = 'message ' + type;
    }

    function logout() {
      adminToken = '';
      processId = '';
      document.getElementById('dashboard').classList.remove('active');
      document.getElementById('loginWrap').classList.remove('hidden');
      document.getElementById('adminPw').value = '';
      document.getElementById('loginMsg').className = 'message';
    }

    // ─── Data fetching ───
    function fetchAllData() {
      fetchTRStatus();
      fetchAlgoStats();
    }

    function refreshAll() {
      const btn = document.getElementById('btnRefresh');
      btn.classList.add('spinning');
      fetchAllData();
      setTimeout(() => btn.classList.remove('spinning'), 800);
    }

    // ─── TR Status ───
    async function fetchTRStatus() {
      try {
        const res = await fetch(apiUrl('/api/data-sources'));
        const data = await res.json();
        const dot = document.getElementById('trDot');
        const text = document.getElementById('trStatusText');
        const info = document.getElementById('sessionInfo');
        const details = document.getElementById('sessionDetails');

        if (data.tradeRepublic.connected) {
          dot.className = 'dot green';
          text.textContent = 'Verbunden';
          text.className = '';
          info.style.display = 'block';
          details.textContent = 'WebSocket aktiv \u2022 ' + data.tradeRepublic.subscribedIsins + ' ISINs abonniert';
        } else if (data.tradeRepublic.hasSession) {
          dot.className = 'dot orange';
          text.textContent = 'Session vorhanden (nicht verbunden)';
          text.className = 'muted';
          info.style.display = 'none';
        } else {
          dot.className = 'dot red';
          text.textContent = 'Nicht verbunden';
          text.className = 'muted';
          info.style.display = 'none';
        }
      } catch {
        document.getElementById('trStatusText').textContent = 'Status nicht verf\u00fcgbar';
      }
    }

    // ─── TR Login flow ───
    function showTRMsg(text, type) {
      const el = document.getElementById('trMsg');
      el.textContent = text;
      el.className = 'message ' + type;
    }
    function hideTRMsg() {
      document.getElementById('trMsg').className = 'message';
    }
    function showTRStep(n) {
      document.querySelectorAll('#trBody .step').forEach(s => s.classList.remove('active'));
      const el = document.getElementById('trStep' + n);
      if (el) el.classList.add('active');
    }

    document.getElementById('code2fa').addEventListener('keydown', e => {
      if (e.key === 'Enter') verifyCode();
    });

    async function initiateLogin() {
      const btn = document.getElementById('btnLogin');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="border-top-color:#0d1117"></span>Wird gesendet\u2026';
      hideTRMsg();

      try {
        const res = await fetch(apiUrl('/api/tr/login'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + adminToken
          },
          body: '{}'
        });
        const data = await res.json();
        if (!res.ok) {
          showTRMsg(data.error || 'Login fehlgeschlagen', 'error');
          btn.disabled = false;
          btn.textContent = 'Anmelden';
          return;
        }
        processId = data.processId;
        showTRMsg(data.message, 'info');
        showTRStep(2);
        document.getElementById('code2fa').focus();
      } catch (err) {
        showTRMsg('Netzwerkfehler: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Anmelden';
      }
    }

    async function verifyCode() {
      const code = document.getElementById('code2fa').value.trim();
      if (!code) { showTRMsg('Bitte Code eingeben', 'error'); return; }
      const btn = document.getElementById('btnVerify');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="border-top-color:#0d1117"></span>Wird verifiziert\u2026';
      hideTRMsg();

      try {
        const res = await fetch(apiUrl('/api/tr/verify'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + adminToken
          },
          body: JSON.stringify({ processId, code })
        });
        const data = await res.json();
        if (!res.ok) {
          showTRMsg(data.error || 'Verifizierung fehlgeschlagen', 'error');
          btn.disabled = false;
          btn.textContent = 'Verifizieren';
          return;
        }
        showTRMsg(data.message, 'success');
        btn.disabled = false;
        btn.textContent = 'Verifizieren';
        setTimeout(fetchTRStatus, 1500);
      } catch (err) {
        showTRMsg('Netzwerkfehler: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Verifizieren';
      }
    }

    // ─── Algorithm Stats ───
    const SOURCE_NAMES = {
      webSentiment: 'Web-Nachrichten',
      analystRating: 'Analysten',
      finnhubSentiment: 'Finnhub',
      technicalSignal: 'Technische Analyse',
      fearGreedSignal: 'Fear & Greed'
    };
    const SOURCE_KEYS = ['webSentiment', 'analystRating', 'finnhubSentiment', 'technicalSignal', 'fearGreedSignal'];

    async function fetchAlgoStats() {
      // Show loading states
      document.getElementById('algoStatusLoading').style.display = 'flex';
      document.getElementById('algoStatusContent').style.display = 'none';
      document.getElementById('algoStatusError').style.display = 'none';
      document.getElementById('accLoading').style.display = 'flex';
      document.getElementById('accContent').style.display = 'none';
      document.getElementById('wLoading').style.display = 'flex';
      document.getElementById('wContent').style.display = 'none';
      document.getElementById('sLoading').style.display = 'flex';
      document.getElementById('sContent').style.display = 'none';

      try {
        const res = await fetch(apiUrl('/api/admin/algorithm-stats'), {
          headers: { 'Authorization': 'Bearer ' + adminToken }
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Fehler ' + res.status);
        }
        const data = await res.json();
        renderAlgoStatus(data);
        renderAccuracy(data);
        renderWeights(data);
        renderStocks(data);
      } catch (err) {
        const msg = esc(err.message);
        document.getElementById('algoStatusLoading').style.display = 'none';
        document.getElementById('algoStatusError').style.display = 'block';
        document.getElementById('algoStatusError').textContent = 'Fehler: ' + msg;
        document.getElementById('accLoading').style.display = 'none';
        document.getElementById('accContent').style.display = 'block';
        document.getElementById('accContent').innerHTML = '<p class="card-error">' + msg + '</p>';
        document.getElementById('wLoading').style.display = 'none';
        document.getElementById('wContent').style.display = 'block';
        document.getElementById('wContent').innerHTML = '<p class="card-error">' + msg + '</p>';
        document.getElementById('sLoading').style.display = 'none';
        document.getElementById('sContent').style.display = 'block';
        document.getElementById('sContent').innerHTML = '<p class="card-error">' + msg + '</p>';
      }
    }

    function esc(str) {
      const d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    }

    // ── Card 2: Algo status ──
    function renderAlgoStatus(data) {
      document.getElementById('algoStatusLoading').style.display = 'none';
      document.getElementById('algoStatusContent').style.display = 'block';

      // Aggregate stats across all users
      let totalPred = 0, totalEval = 0, totalSignals = 0, totalRecent = 0;
      let oldestPredDate = null;
      for (const u of (data.users || [])) {
        totalPred += u.totalPredictions || 0;
        totalEval += u.evaluated || 0;
        totalSignals += u.withSourceSignals || 0;
        totalRecent += u.recentCount || 0;
      }

      // Find oldest prediction date for countdown calculation
      for (const u of (data.users || [])) {
        for (const s of (u.stocks || [])) {
          // We use lastDate as an approximation; earliest would be better but not exposed
        }
      }

      const learning = data.learning || {};
      const isActive = !!learning.isActive;
      document.getElementById('algoDot').className = 'dot ' + (isActive ? 'green' : 'orange');
      document.getElementById('algoStatusLabel').textContent = isActive ? 'Aktiv \u2014 Lernt aus ' + (learning.categoryCount || 0) + ' Kategorien' : 'Sammelt Daten';
      document.getElementById('algoStatusLabel').className = '';
      document.getElementById('statTotal').textContent = totalPred;
      document.getElementById('statEval').textContent = totalEval;
      document.getElementById('statSignals').textContent = totalSignals;
      document.getElementById('statRecent').textContent = totalRecent;

      // Countdown section — uses real dates from API
      const cdEl = document.getElementById('algoCountdown');
      const cd = data.countdown || {};
      if (cdEl && totalPred > 0) {
        cdEl.style.display = 'block';
        let cdHtml = '<div class="cd-title">N\u00e4chste Auswertungen</div>';
        if (cd.nextShortDays !== null && cd.nextShortDays !== undefined) {
          cdHtml += renderCountdownBar('Kurzfristig', cd.nextShortDays, 7);
        }
        if (cd.nextMedDays !== null && cd.nextMedDays !== undefined) {
          cdHtml += renderCountdownBar('Mittelfristig', cd.nextMedDays, 28);
        }
        if (cd.nextLongDays !== null && cd.nextLongDays !== undefined) {
          cdHtml += renderCountdownBar('Langfristig', cd.nextLongDays, 90);
        }
        if (isActive) {
          cdHtml += '<div class="cd-note" style="color:#3fb950">' + (learning.globalEvaluatedCount || 0) + ' Vorhersagen ausgewertet \u00b7 ' + (learning.categoryCount || 0) + ' Kategorie-Modelle aktiv</div>';
        } else {
          const evald = cd.totalEvaluated || 0;
          const need = cd.needsForLearning || 0;
          cdHtml += '<div class="cd-note">' + evald + ' ausgewertet \u00b7 ' + need + ' weitere n\u00f6tig f\u00fcr Lernen</div>';
        }
        cdEl.innerHTML = cdHtml;
      } else if (cdEl) {
        cdEl.style.display = 'none';
      }
    }

    function renderCountdownBar(label, daysLeft, totalDays) {
      const pct = Math.max(5, ((totalDays - daysLeft) / totalDays) * 100);
      const cls = daysLeft === 0 ? 'green' : '';
      const valText = daysLeft === 0 ? 'heute' : daysLeft + ' Tage';
      return '<div class="cd-row">' +
        '<span class="cd-label">' + label + '</span>' +
        '<div class="cd-track"><div class="cd-fill ' + cls + '" style="width:' + pct + '%"></div></div>' +
        '<span class="cd-val ' + cls + '">' + valText + '</span>' +
        '</div>';
    }

    // ── Card 3: Accuracy ──
    function renderAccuracy(data) {
      document.getElementById('accLoading').style.display = 'none';
      const container = document.getElementById('accContent');
      container.style.display = 'block';
      const user = data.users && data.users[0];
      if (!user || !user.accuracy) {
        container.innerHTML = '<p class="hint">Noch keine ausgewerteten Vorhersagen</p>';
        return;
      }
      const acc = user.accuracy;
      if (acc.shortTerm.total === 0 && acc.mediumTerm.total === 0 && acc.longTerm.total === 0) {
        container.innerHTML = '<p class="hint">Noch keine ausgewerteten Vorhersagen</p>';
        return;
      }
      const terms = [
        { key: 'shortTerm', label: 'Kurzfristig' },
        { key: 'mediumTerm', label: 'Mittelfristig' },
        { key: 'longTerm', label: 'Langfristig' }
      ];
      let h = '';
      for (const t of terms) {
        const d = acc[t.key];
        const pct = d.pct !== null && d.pct !== undefined ? d.pct : 0;
        const hasData = d.total > 0;
        const cls = !hasData ? 'gray' : pct >= 65 ? 'green' : pct >= 45 ? 'amber' : 'red';
        h += '<div class="acc-bar-wrap">' +
          '<div class="acc-header"><span>' + t.label + '</span><span>' + (hasData ? pct.toFixed(1) + '%' : '\u2013') + '</span></div>' +
          '<div class="acc-track"><div class="acc-fill ' + cls + '" style="width:' + (hasData ? pct : 0) + '%"></div></div>' +
          '<div class="acc-detail">' + (hasData ? d.correct + '/' + d.total + ' korrekt' : 'Keine Daten') + '</div>' +
          '</div>';
      }
      container.innerHTML = h;
    }

    // ── Card 4: Weights ──
    function renderWeights(data) {
      document.getElementById('wLoading').style.display = 'none';
      const container = document.getElementById('wContent');
      container.style.display = 'block';
      const user = data.users && data.users[0];
      const defaults = data.defaults || {};
      const learning = user && user.learning;
      const isAdaptive = learning && learning.isActive && learning.globalWeights;

      let h = '';
      if (!isAdaptive) {
        h += '<p class="hint" style="margin-bottom:10px">Lernen noch nicht aktiv \u2014 Standardgewichte werden verwendet</p>';
      }
      h += '<table class="w-table"><thead><tr>' +
        '<th>Quelle</th><th>Standard</th>' + (isAdaptive ? '<th>Gelernt</th><th>\u00c4nderung</th>' : '') + '<th class="w-bar-cell"></th>' +
        '</tr></thead><tbody>';
      for (const k of SOURCE_KEYS) {
        const def = defaults[k] || 0;
        const learned = isAdaptive && learning.globalWeights[k] !== undefined ? learning.globalWeights[k] : def;
        const adj = isAdaptive && learning.globalAdjustments && learning.globalAdjustments[k] !== undefined ? learning.globalAdjustments[k] : 0;
        const ds = adj > 0 ? '<span class="delta-pos">+' + (adj * 100).toFixed(1) + '%</span>' :
                   adj < 0 ? '<span class="delta-neg">' + (adj * 100).toFixed(1) + '%</span>' : '0%';
        const bw = Math.min(Math.round(learned / 0.5 * 100), 100);
        h += '<tr><td>' + SOURCE_NAMES[k] + '</td><td>' + (def * 100).toFixed(0) + '%</td>' +
          (isAdaptive ? '<td>' + (learned * 100).toFixed(1) + '%</td><td>' + ds + '</td>' : '') +
          '<td class="w-bar-cell"><div class="w-bar"><div class="w-bar-fill" style="width:' + bw + '%"></div></div></td></tr>';
      }
      h += '</tbody></table>';
      container.innerHTML = h;
    }

    // ── Card 5: Stocks ──
    function renderStocks(data) {
      document.getElementById('sLoading').style.display = 'none';
      const container = document.getElementById('sContent');
      container.style.display = 'block';
      const user = data.users && data.users[0];
      const stocks = user && user.stocks;
      if (!stocks || stocks.length === 0) {
        container.innerHTML = '<p class="hint">Noch keine Aktien-Daten vorhanden</p>';
        return;
      }
      const sorted = [...stocks].sort((a, b) => (b.predictions || 0) - (a.predictions || 0));
      let h = '<div class="stocks-wrap"><table class="s-table"><thead><tr>' +
        '<th>Ticker</th><th>Vorhersagen</th><th>Letzte Aufnahme</th><th>Gelernt</th></tr></thead><tbody>';
      for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i];
        const icon = s.hasLearnedWeights ? '\ud83e\udde0' : '\u2013';
        const ld = s.lastDate || '\u2013';
        h += '<tr class="s-row" onclick="toggleSD(' + i + ')"><td><strong>' + esc(s.ticker) + '</strong></td>' +
          '<td>' + (s.predictions || 0) + '</td><td>' + esc(ld) + '</td><td style="text-align:center">' + icon + '</td></tr>';
        h += '<tr class="s-detail" id="sd' + i + '"><td colspan="4">';
        if (s.hasLearnedWeights && s.learnedWeights) {
          h += '<div class="s-weights">';
          for (const k of SOURCE_KEYS) {
            const w = s.learnedWeights[k];
            const a = s.adjustments && s.adjustments[k];
            if (w !== undefined) {
              const dd = a !== undefined ? (a > 0 ? ' <span class="delta-pos">+' + (a * 100).toFixed(1) + '%</span>' :
                         a < 0 ? ' <span class="delta-neg">' + (a * 100).toFixed(1) + '%</span>' : '') : '';
              h += '<div>' + SOURCE_NAMES[k] + ': <span>' + (w * 100).toFixed(1) + '%' + dd + '</span></div>';
            }
          }
          h += '</div>';
        } else {
          h += '<em class="muted">Keine individuellen Gewichte</em>';
        }
        h += '</td></tr>';
      }
      h += '</tbody></table></div>';
      container.innerHTML = h;
    }

    function toggleSD(i) {
      const r = document.getElementById('sd' + i);
      if (r) r.classList.toggle('open');
    }
  </script>
</body>
</html>`;
}
