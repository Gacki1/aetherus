/**
 * Trade Republic Unofficial WebSocket Client
 * Connects to TR's WebSocket API for real-time bid/ask prices from Lang & Schwarz (LSX).
 *
 * IMPORTANT: This is unofficial and may break. Requires user's TR credentials.
 * Authentication requires interactive 2FA — session is persisted to avoid repeated logins.
 */

import { WebSocket } from "ws";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════
export interface TRTickerData {
  bid: { price: number; size: number } | null;
  ask: { price: number; size: number } | null;
  last: { price: number; size: number } | null;
  pre: { price: number } | null;
  open: { price: number } | null;
  qualityId: string;
  isin: string;
  exchange: string;
  timestamp: number;
}

interface TRSession {
  trSessionToken: string;
  trRefreshToken?: string;
  rawCookies: string[];
  savedAt: string;
}

interface TRSubscription {
  id: number;
  isin: string;
  exchange: string;
  callback: (data: TRTickerData) => void;
}

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════
const TR_HOST = "https://api.traderepublic.com";

// Browser-like headers to pass TR's bot protection
const TR_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Origin": "https://app.traderepublic.com",
  "Referer": "https://app.traderepublic.com/",
  "Accept": "application/json",
  "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
};
const TR_WS_HOST = "wss://api.traderepublic.com";
const TR_WS_VERSION = "31";
const ECHO_INTERVAL_MS = 25_000;
const WS_CONNECT_TIMEOUT_MS = 10_000;
const SESSION_FILE = "tr-session.json";

// ═══════════════════════════════════════════════════════════
// TR CLIENT
// ═══════════════════════════════════════════════════════════
export class TradeRepublicClient {
  private ws: WebSocket | null = null;
  private session: TRSession | null = null;
  private subscriptions: TRSubscription[] = [];
  private nextSubId = 1;
  private echoInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private connected = false;
  private connecting = false;
  private dataDir: string;

  // Price cache: ISIN → latest ticker data
  private priceCache = new Map<string, TRTickerData>();

  constructor(
    private phoneNo: string,
    private pin: string,
    dataDir: string,
  ) {
    this.dataDir = dataDir;
  }

  // ── Public API ──

  /** Check if client is connected and authenticated */
  get isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Check if we have a saved session (may or may not be valid) */
  get hasSession(): boolean {
    return !!this.session?.trSessionToken;
  }

  /** Get cached price for ISIN (returns null if not subscribed or no data yet) */
  getCachedPrice(isin: string): TRTickerData | null {
    return this.priceCache.get(isin) || null;
  }

  /** Get all cached prices */
  getAllCachedPrices(): Map<string, TRTickerData> {
    return this.priceCache;
  }

  /**
   * Initialize: Load saved session and connect WebSocket.
   * Returns true if connected successfully, false if login required.
   */
  async init(): Promise<boolean> {
    this.loadSession();
    if (!this.session) {
      console.log("[TR] No saved session found. Login required.");
      return false;
    }

    try {
      await this.connectWebSocket();
      // Validate session with a lightweight subscription
      const valid = await this.validateSession();
      if (!valid) {
        console.log("[TR] Saved session expired. Login required.");
        this.session = null;
        return false;
      }
      console.log("[TR] Connected with saved session.");
      return true;
    } catch (e) {
      console.warn("[TR] Init failed:", (e as Error).message?.slice(0, 100));
      return false;
    }
  }

  /**
   * Full login flow. Requires interactive 2FA.
   * @param devicePinCallback - Called when 2FA code is needed. Should return the code.
   */
  async login(devicePinCallback: () => Promise<string>): Promise<boolean> {
    try {
      // Step 1: Initial login request
      const loginRes = await fetch(`${TR_HOST}/api/v1/auth/web/login`, {
        method: "POST",
        headers: TR_HEADERS,
        body: JSON.stringify({ phoneNumber: this.phoneNo, pin: this.pin }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!loginRes.ok) {
        console.error("[TR] Login failed:", loginRes.status);
        return false;
      }

      const loginData = await loginRes.json() as { processId?: string };
      if (!loginData.processId) {
        console.error("[TR] No processId in login response");
        return false;
      }

      // Step 2: Get 2FA code from user
      const devicePin = await devicePinCallback();

      // Step 3: Verify 2FA
      const verifyRes = await fetch(
        `${TR_HOST}/api/v1/auth/web/login/${loginData.processId}/${devicePin}`,
        {
          method: "POST",
          headers: TR_HEADERS,
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (!verifyRes.ok) {
        console.error("[TR] 2FA verification failed:", verifyRes.status);
        return false;
      }

      // Extract session cookies
      const setCookies = verifyRes.headers.getSetCookie?.() || [];
      const sessionToken = this.extractCookie(setCookies, "tr_session");
      const refreshToken = this.extractCookie(setCookies, "tr_refresh");

      if (!sessionToken) {
        console.error("[TR] No tr_session cookie in response");
        return false;
      }

      this.session = {
        trSessionToken: sessionToken,
        trRefreshToken: refreshToken,
        rawCookies: setCookies,
        savedAt: new Date().toISOString(),
      };

      this.saveSession();
      await this.connectWebSocket();

      console.log("[TR] Login successful, WebSocket connected.");
      return true;
    } catch (e) {
      console.error("[TR] Login error:", (e as Error).message?.slice(0, 100));
      return false;
    }
  }

  /**
   * Subscribe to real-time ticker data for an ISIN.
   * Data format: { bid, ask, last, pre, open }
   */
  subscribeTicker(isin: string, exchange = "LSX", callback?: (data: TRTickerData) => void): number {
    const subId = this.nextSubId++;
    const sub: TRSubscription = {
      id: subId,
      isin,
      exchange,
      callback: callback || (() => {}),
    };
    this.subscriptions.push(sub);

    if (this.isConnected) {
      this.sendSubscription(sub);
    }

    return subId;
  }

  /** Unsubscribe from a ticker */
  unsubscribeTicker(subId: number): void {
    this.subscriptions = this.subscriptions.filter(s => s.id !== subId);
    if (this.isConnected) {
      try {
        this.ws!.send(`unsub ${subId}`);
      } catch {}
    }
  }

  /**
   * Two-step login for admin page flow:
   * Step 1: initiateLogin() → returns processId, triggers 2FA
   * Step 2: completeLogin(processId, code) → saves session, connects WS
   */
  /**
   * Launch headless Chromium to bypass TR's TLS fingerprinting.
   * Uses Puppeteer page.goto() to POST directly — the browser handles TLS.
   */
  private async browserFetch(url: string, body?: any): Promise<{ ok: boolean; status: number; data: any; cookies: string[] }> {
    const puppeteer = await import("puppeteer-core");
    const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";
    console.log("[TR] Launching headless Chromium...");
    const browser = await puppeteer.default.launch({
      executablePath: execPath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");

      // Use request interception to convert the navigation into a POST
      await page.setRequestInterception(true);
      let intercepted = false;
      page.on("request", (req) => {
        if (!intercepted && req.url() === url) {
          intercepted = true;
          const overrides: any = {
            method: "POST",
            headers: {
              ...req.headers(),
              "Content-Type": "application/json",
              "Origin": "https://app.traderepublic.com",
              "Referer": "https://app.traderepublic.com/",
            },
          };
          if (body) overrides.postData = JSON.stringify(body);
          req.continue(overrides);
        } else {
          req.continue();
        }
      });

      // Navigate to the URL — this triggers the intercepted POST
      let responseStatus = 0;
      let responseBody = "";
      try {
        const response = await page.goto(url, { waitUntil: "load", timeout: 15000 });
        if (response) {
          responseStatus = response.status();
          responseBody = await response.text().catch(() => "");
        }
      } catch (navErr: any) {
        // page.goto may throw on non-HTML responses, but we can still read the response
        console.log("[TR] Navigation threw (expected for API):", navErr.message?.slice(0, 80));
      }

      // Try to get response from the page content if goto didn't return it
      if (!responseBody) {
        responseBody = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
      }

      let data: any = null;
      try { data = JSON.parse(responseBody); } catch { data = responseBody; }
      const ok = responseStatus >= 200 && responseStatus < 300;

      console.log(`[TR] Browser response: HTTP ${responseStatus}, body length: ${responseBody.length}`);

      // Extract cookies
      const browserCookies = await page.cookies();
      const cookieStrings = browserCookies
        .filter((c: any) => c.domain.includes("traderepublic"))
        .map((c: any) => `${c.name}=${c.value}`);

      return { ok, status: responseStatus, data, cookies: cookieStrings };
    } finally {
      await browser.close();
      console.log("[TR] Chromium closed.");
    }
  }

  async initiateLogin(): Promise<{ processId: string } | null> {
    try {
      const result = await this.browserFetch(
        `${TR_HOST}/api/v1/auth/web/login`,
        { phoneNumber: this.phoneNo, pin: this.pin }
      );
      if (!result.ok) {
        console.error(`[TR] initiateLogin failed: HTTP ${result.status}`, JSON.stringify(result.data).slice(0, 200));
        return null;
      }
      const processId = result.data?.processId;
      return processId ? { processId } : null;
    } catch (e) {
      console.error("[TR] initiateLogin error:", (e as Error).message?.slice(0, 150));
      return null;
    }
  }

  async completeLogin(processId: string, code: string): Promise<boolean> {
    try {
      const result = await this.browserFetch(
        `${TR_HOST}/api/v1/auth/web/login/${processId}/${code}`
      );
      if (!result.ok) {
        console.error("[TR] completeLogin failed:", result.status, result.data);
        return false;
      }

      const sessionToken = result.cookies.find((c: string) => c.startsWith("tr_session="))?.split("=").slice(1).join("=");
      const refreshToken = result.cookies.find((c: string) => c.startsWith("tr_refresh="))?.split("=").slice(1).join("=");

      if (!sessionToken) {
        console.error("[TR] No tr_session cookie. Cookies:", result.cookies);
        return false;
      }

      this.session = {
        trSessionToken: sessionToken,
        trRefreshToken: refreshToken,
        rawCookies: result.cookies.map((c: string) => c + "; Path=/; Domain=.traderepublic.com"),
        savedAt: new Date().toISOString(),
      };

      this.saveSession();
      await this.connectWebSocket();

      console.log("[TR] completeLogin successful, WebSocket connected.");
      return true;
    } catch (e) {
      console.error("[TR] completeLogin error:", (e as Error).message?.slice(0, 100));
      return false;
    }
  }

  /** Disconnect and clean up */
  async disconnect(): Promise<void> {
    this.stopEcho();
    this.connected = false;
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  // ── Private methods ──

  private async connectWebSocket(): Promise<void> {
    if (this.connecting) return;
    this.connecting = true;

    try {
      await this.closeWebSocket();

      this.ws = new WebSocket(TR_WS_HOST);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.ws?.terminate();
          reject(new Error("WebSocket connection timeout"));
        }, WS_CONNECT_TIMEOUT_MS);

        this.ws!.once("open", () => {
          clearTimeout(timeout);
          // Send connection handshake
          this.ws!.send(`connect ${TR_WS_VERSION} ${JSON.stringify({ locale: "de" })}`);
          this.connected = true;
          this.reconnectAttempts = 0;
          this.startEcho();
          this.resubscribeAll();
          resolve();
        });

        this.ws!.on("message", (data: Buffer | string) => {
          this.handleMessage(data.toString());
        });

        this.ws!.once("close", (code, reason) => {
          console.log(`[TR] WebSocket closed: ${code} ${reason.toString()}`);
          this.connected = false;
          this.stopEcho();
          this.scheduleReconnect();
        });

        this.ws!.once("error", (err) => {
          clearTimeout(timeout);
          console.error("[TR] WebSocket error:", err.message);
          this.ws?.terminate();
          this.ws = null;
          this.connected = false;
          this.scheduleReconnect();
          reject(err);
        });
      });
    } finally {
      this.connecting = false;
    }
  }

  private async closeWebSocket(): Promise<void> {
    this.stopEcho();
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
    this.connected = false;
  }

  private handleMessage(raw: string): void {
    if (raw.startsWith("echo")) return;
    if (raw.startsWith("connected")) {
      console.log("[TR] WebSocket connected:", raw.slice(0, 50));
      return;
    }

    // Parse: "{subId} {jsonPayload}" or "{subId} A {jsonPayload}" (for subscription ack)
    const firstBrace = raw.indexOf("{");
    if (firstBrace === -1) return;

    const idPart = raw.substring(0, firstBrace).trim();
    const idMatch = idPart.match(/\d+/);
    if (!idMatch) return;

    const subId = parseInt(idMatch[0], 10);
    const jsonStr = raw.substring(firstBrace);

    const sub = this.subscriptions.find(s => s.id === subId);
    if (!sub) return;

    try {
      const data = JSON.parse(jsonStr);

      const tickerData: TRTickerData = {
        bid: data.bid || null,
        ask: data.ask || null,
        last: data.last || null,
        pre: data.pre || null,
        open: data.open || null,
        qualityId: data.qualityId || "unknown",
        isin: sub.isin,
        exchange: sub.exchange,
        timestamp: Date.now(),
      };

      // Update cache
      this.priceCache.set(sub.isin, tickerData);

      // Call callback
      sub.callback(tickerData);
    } catch (e) {
      // Might be an error message or non-JSON
      if (jsonStr.includes("AUTHENTICATION_ERROR")) {
        console.warn("[TR] Authentication error — session expired");
        this.session = null;
      }
    }
  }

  private sendSubscription(sub: TRSubscription): void {
    if (!this.session?.trSessionToken || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const payload = JSON.stringify({
      token: this.session.trSessionToken,
      type: "ticker",
      id: `${sub.isin}.${sub.exchange}`,
    });

    try {
      this.ws.send(`sub ${sub.id} ${payload}`);
    } catch (e) {
      console.warn("[TR] Failed to send subscription:", (e as Error).message);
    }
  }

  private resubscribeAll(): void {
    for (const sub of this.subscriptions) {
      this.sendSubscription(sub);
    }
  }

  private async validateSession(): Promise<boolean> {
    if (!this.session?.trSessionToken || !this.isConnected) return false;

    return new Promise<boolean>((resolve) => {
      const validationSubId = this.nextSubId++;
      const timeout = setTimeout(() => {
        this.subscriptions = this.subscriptions.filter(s => s.id !== validationSubId);
        resolve(false);
      }, 7_000);

      this.subscriptions.push({
        id: validationSubId,
        isin: "_validation",
        exchange: "",
        callback: () => {
          clearTimeout(timeout);
          this.subscriptions = this.subscriptions.filter(s => s.id !== validationSubId);
          resolve(true);
        },
      });

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const payload = JSON.stringify({
          token: this.session!.trSessionToken,
          type: "availableCash",
        });
        try {
          this.ws.send(`sub ${validationSubId} ${payload}`);
        } catch {
          clearTimeout(timeout);
          resolve(false);
        }
      } else {
        clearTimeout(timeout);
        resolve(false);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= 10) {
      console.error("[TR] Max reconnect attempts reached. Giving up.");
      return;
    }
    const delay = Math.min(30_000, 1_000 * Math.pow(2, this.reconnectAttempts++));
    console.log(`[TR] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})...`);
    setTimeout(async () => {
      try {
        await this.connectWebSocket();
      } catch {}
    }, delay);
  }

  private startEcho(): void {
    this.stopEcho();
    this.echoInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try { this.ws.send(`echo ${Date.now()}`); } catch {}
      }
    }, ECHO_INTERVAL_MS);
  }

  private stopEcho(): void {
    if (this.echoInterval) {
      clearInterval(this.echoInterval);
      this.echoInterval = null;
    }
  }

  // ── Session persistence ──

  private loadSession(): void {
    const filePath = join(this.dataDir, SESSION_FILE);
    try {
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, "utf-8");
        this.session = JSON.parse(raw);
        console.log("[TR] Loaded saved session from", filePath);
      }
    } catch (e) {
      console.warn("[TR] Failed to load session:", (e as Error).message);
      this.session = null;
    }
  }

  private saveSession(): void {
    if (!this.session) return;
    const filePath = join(this.dataDir, SESSION_FILE);
    try {
      if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
      writeFileSync(filePath, JSON.stringify(this.session, null, 2), "utf-8");
      console.log("[TR] Session saved to", filePath);
    } catch (e) {
      console.error("[TR] Failed to save session:", (e as Error).message);
    }
  }

  private extractCookie(cookies: string[], name: string): string | undefined {
    const joined = cookies.join("; ");
    const match = joined.match(new RegExp(`(?:^|;)\\s*${name}=([^;]+)`));
    return match?.[1];
  }
}
