/**
 * Multi-Source Price Provider with Fallback Chain
 * Priority: Trade Republic (real-time) → Polygon.io (EOD) → Yahoo Finance (existing)
 *
 * This module wraps all three data sources and provides a unified interface
 * for getting stock prices with automatic fallback.
 */

import { TradeRepublicClient, type TRTickerData } from "./tr-client";
import { PolygonClient, type PolygonQuote } from "./polygon-client";

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════
export interface UnifiedQuote {
  price: number;
  bid: number | null;
  ask: number | null;
  open: number | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  currency: string;       // "EUR" or "USD"
  source: "trade-republic" | "polygon" | "yahoo";
  isRealtime: boolean;
  timestamp: number;
}

export interface PriceProviderStatus {
  tradeRepublic: {
    connected: boolean;
    hasSession: boolean;
    subscribedIsins: number;
  };
  polygon: {
    enabled: boolean;
  };
  yahoo: {
    available: boolean;
  };
}

// ═══════════════════════════════════════════════════════════
// ISIN ↔ TICKER MAPPING (for TR which uses ISINs)
// ═══════════════════════════════════════════════════════════
// We need this to map Yahoo Finance tickers (AAPL, SAP.DE) to ISINs for TR
// and to map ISINs back to tickers for Polygon.io
// The main TICKER_TO_ISIN map is in routes.ts — we import/reference it externally

// ═══════════════════════════════════════════════════════════
// PRICE PROVIDER
// ═══════════════════════════════════════════════════════════
export class PriceProvider {
  private trClient: TradeRepublicClient | null = null;
  private polygonClient: PolygonClient;
  private trInitialized = false;
  private trInitFailed = false;

  // Track which ISINs are actively subscribed on TR
  private trSubscriptions = new Map<string, number>(); // ISIN → subId

  constructor(
    trPhone?: string,
    trPin?: string,
    dataDir?: string,
    polygonApiKey?: string,
  ) {
    // Initialize Trade Republic client (if credentials provided)
    const phone = trPhone || process.env.TR_PHONE || "";
    const pin = trPin || process.env.TR_PIN || "";
    const dir = dataDir || process.env.STOXVIEW_DATA_DIR || "/tmp/stoxview";

    if (phone && pin) {
      this.trClient = new TradeRepublicClient(phone, pin, dir);
      console.log("[PriceProvider] Trade Republic client created");
    } else {
      console.log("[PriceProvider] No TR credentials — Trade Republic disabled");
    }

    // Initialize Polygon client
    this.polygonClient = new PolygonClient(polygonApiKey);

    console.log("[PriceProvider] Initialized. Sources available:", {
      tradeRepublic: !!this.trClient,
      polygon: this.polygonClient.isEnabled,
      yahoo: true,
    });
  }

  /** Initialize Trade Republic connection (async, non-blocking) */
  async initTradeRepublic(): Promise<boolean> {
    if (!this.trClient || this.trInitialized || this.trInitFailed) return false;

    try {
      const connected = await this.trClient.init();
      this.trInitialized = connected;
      if (!connected) {
        console.log("[PriceProvider] TR not connected (login required). Will use fallback sources.");
        this.trInitFailed = true;
      }
      return connected;
    } catch (e) {
      console.warn("[PriceProvider] TR init failed:", (e as Error).message?.slice(0, 80));
      this.trInitFailed = true;
      return false;
    }
  }

  /** Get status of all data sources */
  getStatus(): PriceProviderStatus {
    return {
      tradeRepublic: {
        connected: this.trClient?.isConnected || false,
        hasSession: this.trClient?.hasSession || false,
        subscribedIsins: this.trSubscriptions.size,
      },
      polygon: {
        enabled: this.polygonClient.isEnabled,
      },
      yahoo: {
        available: true,
      },
    };
  }

  /**
   * Subscribe to real-time TR price updates for an ISIN.
   * Call this for stocks the user is actively viewing.
   */
  subscribeToTR(isin: string): void {
    if (!this.trClient?.isConnected || this.trSubscriptions.has(isin)) return;

    const subId = this.trClient.subscribeTicker(isin, "LSX");
    this.trSubscriptions.set(isin, subId);
    console.log(`[PriceProvider] Subscribed to TR ticker: ${isin}`);
  }

  /**
   * Unsubscribe from TR updates for an ISIN.
   */
  unsubscribeFromTR(isin: string): void {
    const subId = this.trSubscriptions.get(isin);
    if (subId !== undefined && this.trClient) {
      this.trClient.unsubscribeTicker(subId);
      this.trSubscriptions.delete(isin);
    }
  }

  /**
   * Get cached TR price for an ISIN (if available).
   * Returns null if not subscribed or no data yet.
   */
  getTRPrice(isin: string): TRTickerData | null {
    if (!this.trClient?.isConnected) return null;
    return this.trClient.getCachedPrice(isin);
  }

  /**
   * Get Polygon.io EOD price for a US ticker.
   * Returns null if Polygon is disabled or ticker not found.
   */
  async getPolygonPrice(ticker: string): Promise<PolygonQuote | null> {
    return this.polygonClient.getPreviousClose(ticker);
  }

  /**
   * Get Polygon.io daily bars for charting.
   */
  async getPolygonDailyBars(ticker: string, from: string, to: string): Promise<PolygonQuote[]> {
    return this.polygonClient.getDailyBars(ticker, from, to);
  }

  /**
   * Try to get a unified quote using the fallback chain.
   * This is called from routes.ts when building predictions.
   *
   * @param isin - ISIN of the stock (for TR lookup)
   * @param yahooQuote - Already-fetched Yahoo quote (to avoid double-fetching)
   * @param polygonTicker - US ticker for Polygon (e.g., "AAPL")
   * @returns Enhanced quote data with source info, or null
   */
  getEnhancedQuote(
    isin: string | undefined,
    yahooQuote: any,
    polygonTicker?: string,
  ): { source: "trade-republic" | "polygon" | "yahoo"; bidPrice?: number; askPrice?: number; isRealtime: boolean } {
    // Try 1: Trade Republic real-time data
    if (isin && this.trClient?.isConnected) {
      const trData = this.trClient.getCachedPrice(isin);
      if (trData && Date.now() - trData.timestamp < 30_000) { // Max 30s old
        return {
          source: "trade-republic",
          bidPrice: trData.bid?.price,
          askPrice: trData.ask?.price,
          isRealtime: trData.qualityId === "realtime",
        };
      }
    }

    // Try 2 & 3: Yahoo is already the default — just report source
    // Polygon EOD is used for supplementary data, not as primary quote
    return {
      source: "yahoo",
      bidPrice: yahooQuote?.bid,
      askPrice: yahooQuote?.ask,
      isRealtime: yahooQuote?.marketState === "REGULAR",
    };
  }

  /** Clean up all connections */
  async shutdown(): Promise<void> {
    if (this.trClient) {
      await this.trClient.disconnect();
    }
  }
}

// ═══════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════
let _instance: PriceProvider | null = null;

export function getPriceProvider(): PriceProvider {
  if (!_instance) {
    _instance = new PriceProvider();
    // Try to init TR in background (non-blocking)
    _instance.initTradeRepublic().catch(() => {});
  }
  return _instance;
}
