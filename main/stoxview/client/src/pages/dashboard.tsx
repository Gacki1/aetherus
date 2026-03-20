import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { StockPrediction, SearchResult, WatchlistItem, BrowseStock } from "@shared/schema";
import { MarketOverview } from "@/components/market-overview";
import { StockCard } from "@/components/stock-card";
import { StockDetail } from "@/components/stock-detail";
import { DisclaimerBanner } from "@/components/disclaimer-banner";
// PerplexityAttribution removed — doesn't fit inside Aetherus embed
import { useI18n } from "@/lib/i18n";
import {
  Activity,
  RefreshCw,
  Search,
  TrendingUp,
  Filter,
  X,
  Loader2,
  ArrowUpDown,
  Star,
  Plus,
  Globe,
  Languages,
  Clock,
  LayoutGrid,
  LayoutList,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type SortOption = "change-desc" | "change-asc" | "confidence" | "risk" | "name";
type FilterOption = "all" | "bullish" | "bearish" | "neutral";
type ExchangeFilter = "all" | "us" | "de";
type TimeframeFilter = "short" | "medium" | "long";
type ViewTab = "trending" | "browse" | "watchlist";
type BrowseCategory = "most_actives" | "day_gainers" | "day_losers";
type BrowseSort = "default" | "name" | "change-desc" | "change-asc" | "volume" | "marketcap";

// Extract the Aetherus user ID from the page URL (?uid=N)
// Uses a stable numeric ID so username changes don't reset data.
// Falls back to legacy ?user= param for backwards compatibility.
const STOXVIEW_USER = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("uid") || params.get("user") || "_default";
  } catch { return "_default"; }
})();

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { t, lang, setLang } = useI18n();
  const [selectedStock, setSelectedStock] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("change-desc");
  const [filterSignal, setFilterSignal] = useState<FilterOption>("all");
  const [signalTimeframe, setSignalTimeframe] = useState<TimeframeFilter>("short");
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefreshCountdown, setAutoRefreshCountdown] = useState(300);
  const [activeTab, setActiveTab] = useState<ViewTab>("trending");
  const [isDetailExpanded, setIsDetailExpanded] = useState(false);

  // === Browse tab ===
  const [browseCategory, setBrowseCategory] = useState<BrowseCategory>("most_actives");
  const [browseSort, setBrowseSort] = useState<BrowseSort>("default");
  const [browseMarket, setBrowseMarket] = useState<ExchangeFilter>("all");
  const [browseViewMode, setBrowseViewMode] = useState<"table" | "cards">("table");
  const [browseStocks, setBrowseStocks] = useState<BrowseStock[]>([]);
  const [browseOffset, setBrowseOffset] = useState(0);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browseHasMore, setBrowseHasMore] = useState(false);
  const [isBrowseLoading, setIsBrowseLoading] = useState(false);
  const [isBrowseLoadingMore, setIsBrowseLoadingMore] = useState(false);

  const BROWSE_PAGE_SIZE = 50;

  const fetchBrowsePage = useCallback(async (offset: number, append: boolean) => {
    if (append) setIsBrowseLoadingMore(true); else setIsBrowseLoading(true);
    try {
      const res = await apiRequest("GET", `/api/browse?category=${browseCategory}&market=${browseMarket}&offset=${offset}&count=${BROWSE_PAGE_SIZE}`);
      const data = await res.json();
      const stocks: BrowseStock[] = data.stocks || [];
      if (append) {
        setBrowseStocks(prev => [...prev, ...stocks]);
      } else {
        setBrowseStocks(stocks);
      }
      setBrowseTotal(data.total || 0);
      setBrowseOffset(offset + stocks.length);
      setBrowseHasMore(data.hasMore || false);
    } catch (err) {
      console.error("Browse fetch error:", err);
    } finally {
      setIsBrowseLoading(false);
      setIsBrowseLoadingMore(false);
    }
  }, [browseCategory, browseMarket]);

  // Fetch first page when tab/category/market changes
  useEffect(() => {
    if (activeTab === "browse") {
      setBrowseStocks([]);
      setBrowseOffset(0);
      setBrowseTotal(0);
      setBrowseHasMore(false);
      fetchBrowsePage(0, false);
    }
  }, [activeTab, browseCategory, browseMarket, fetchBrowsePage]);

  const handleLoadMore = useCallback(() => {
    if (browseHasMore && !isBrowseLoadingMore) {
      fetchBrowsePage(browseOffset, true);
    }
  }, [browseHasMore, isBrowseLoadingMore, browseOffset, fetchBrowsePage]);

  // === Universal search ===
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [searchedPrediction, setSearchedPrediction] = useState<StockPrediction | null>(null);
  const [isLoadingPrediction, setIsLoadingPrediction] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Main predictions for default stocks
  const { data: predictions = [], isLoading } = useQuery<StockPrediction[]>({
    queryKey: ["/api/predictions"],
    refetchInterval: 60000, // 60s — match server cache TTL for fresher prices
  });

  // Market summary is now computed client-side from predictions data
  // to avoid race conditions where the summary endpoint returns empty
  // data before predictions have loaded into the server cache.

  // === Watchlist (per-user) ===
  const { data: watchlistItems = [] } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist", STOXVIEW_USER],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/watchlist?user=${encodeURIComponent(STOXVIEW_USER)}`);
      return res.json();
    },
  });

  // Watchlist predictions (fetched when watchlist has items)
  const [watchlistPredictions, setWatchlistPredictions] = useState<StockPrediction[]>([]);
  const [isLoadingWatchlist, setIsLoadingWatchlist] = useState(false);

  // Fetch predictions for watchlist stocks
  useEffect(() => {
    if (watchlistItems.length === 0) {
      setWatchlistPredictions([]);
      return;
    }

    const symbols = watchlistItems.map((w) => w.symbol);
    // Only fetch if we don't already have all of them
    const missing = symbols.filter(
      (s) => !watchlistPredictions.some((p) => p.ticker === s)
    );

    if (missing.length === 0 && watchlistPredictions.length === symbols.length) return;

    setIsLoadingWatchlist(true);
    const symbolsStr = symbols.join(",");
    apiRequest("GET", `/api/predictions?symbols=${encodeURIComponent(symbolsStr)}&user=${encodeURIComponent(STOXVIEW_USER)}`)
      .then((res) => res.json())
      .then((data: StockPrediction[]) => {
        setWatchlistPredictions(data);
      })
      .catch(() => {})
      .finally(() => setIsLoadingWatchlist(false));
  }, [watchlistItems]);

  const addToWatchlist = useMutation({
    mutationFn: async ({ symbol, name }: { symbol: string; name: string }) => {
      const res = await apiRequest("POST", `/api/watchlist?user=${encodeURIComponent(STOXVIEW_USER)}`, { symbol, name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist", STOXVIEW_USER] });
    },
  });

  const removeFromWatchlist = useMutation({
    mutationFn: async (symbol: string) => {
      const res = await apiRequest("DELETE", `/api/watchlist/${encodeURIComponent(symbol)}?user=${encodeURIComponent(STOXVIEW_USER)}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist", STOXVIEW_USER] });
      // Also remove from local predictions cache
      setWatchlistPredictions((prev) => prev);
    },
  });

  const isInWatchlist = useCallback(
    (symbol: string) => watchlistItems.some((w) => w.symbol === symbol.toUpperCase()),
    [watchlistItems]
  );

  const toggleWatchlist = useCallback(
    (symbol: string, name: string) => {
      if (isInWatchlist(symbol)) {
        removeFromWatchlist.mutate(symbol);
      } else {
        addToWatchlist.mutate({ symbol, name });
      }
    },
    [isInWatchlist, addToWatchlist, removeFromWatchlist]
  );

  // Auto-refresh countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setAutoRefreshCountdown((prev) => (prev <= 1 ? 300 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Click outside to close search dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearchDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Debounced search
  const handleSearchInput = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (!value.trim() || value.trim().length < 2) {
      setSearchResults([]);
      setShowSearchDropdown(false);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await apiRequest("GET", `/api/search?q=${encodeURIComponent(value.trim())}`);
        const data = await res.json();
        setSearchResults(data.result || []);
        setShowSearchDropdown(true);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 350);
  }, []);

  // Select a stock from search results
  const handleSelectSearchResult = async (symbol: string) => {
    setShowSearchDropdown(false);
    setSearchQuery("");

    // Check if already in default predictions
    const existing = predictions.find((p) => p.ticker === symbol);
    if (existing) {
      setSelectedStock(symbol);
      setSearchedPrediction(null);
      return;
    }

    // Fetch prediction for this stock
    setIsLoadingPrediction(true);
    setSelectedStock(symbol);
    try {
      const res = await apiRequest("GET", `/api/predict/${encodeURIComponent(symbol)}`);
      const data = await res.json();
      setSearchedPrediction(data);
    } catch {
      setSearchedPrediction(null);
    } finally {
      setIsLoadingPrediction(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // 1. Tell the server to wipe ALL its in-memory caches
      await apiRequest("POST", "/api/force-refresh");

      // 2. Invalidate every client-side query so React-Query refetches
      queryClient.invalidateQueries({ queryKey: ["/api/predictions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist", STOXVIEW_USER] });
      queryClient.invalidateQueries({ queryKey: ["/api/history"] });
      setAutoRefreshCountdown(300);
    } finally {
      setTimeout(() => setIsRefreshing(false), 1200);
    }
  };

  // Determine which predictions to show based on active tab
  const basePredictions =
    activeTab === "watchlist" ? watchlistPredictions : predictions;

  // Combine with searched prediction
  const allPredictions = searchedPrediction
    ? [searchedPrediction, ...basePredictions.filter((p) => p.ticker !== searchedPrediction.ticker)]
    : basePredictions;

  // Helper: get prediction signal for selected timeframe
  const getSignalForTimeframe = useCallback((p: StockPrediction) => {
    switch (signalTimeframe) {
      case "medium": return p.mediumTerm.signal;
      case "long": return p.longTerm.signal;
      default: return p.shortTerm.signal;
    }
  }, [signalTimeframe]);

  // Filter and sort
  const filtered = allPredictions
    .filter((p) => {
      if (filterSignal === "all") return true;
      return getSignalForTimeframe(p) === filterSignal;
    })
    .filter((p) => {
      if (exchangeFilter === "all") return true;
      if (exchangeFilter === "us") return !p.ticker.includes(".DE") && !p.ticker.includes(".F");
      return p.ticker.includes(".DE") || p.ticker.includes(".F") || p.country === "DE";
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "change-desc": return b.priceChangePercent - a.priceChangePercent;
        case "change-asc": return a.priceChangePercent - b.priceChangePercent;
        case "risk": return b.riskLevel - a.riskLevel;
        case "confidence": return b.shortTerm.confidence - a.shortTerm.confidence;
        default: return a.name.localeCompare(b.name);
      }
    });

  const selectedPrediction =
    [...(predictions || []), ...(watchlistPredictions || [])].find(
      (p) => p.ticker === selectedStock
    ) || searchedPrediction;

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const currentListLoading = activeTab === "watchlist" ? isLoadingWatchlist : activeTab === "browse" ? isBrowseLoading : isLoading;

  // Sort browse stocks (market filtering is done server-side now)
  const filteredBrowseStocks = [...browseStocks]
    .sort((a, b) => {
      switch (browseSort) {
        case "name": return a.name.localeCompare(b.name);
        case "change-desc": return b.changePercent - a.changePercent;
        case "change-asc": return a.changePercent - b.changePercent;
        case "volume": return b.volume - a.volume;
        case "marketcap": return b.marketCap - a.marketCap;
        default: return 0; // keep screener order
      }
    });

  // ═══ Compute market overview summary based on active tab ═══
  const computeSummaryFromPredictions = useCallback((preds: StockPrediction[]) => {
    if (preds.length === 0) return null;
    const sorted = [...preds].sort((a, b) => b.priceChangePercent - a.priceChangePercent);
    const getSignal = (p: StockPrediction) => {
      switch (signalTimeframe) {
        case "medium": return p.mediumTerm.signal;
        case "long": return p.longTerm.signal;
        default: return p.shortTerm.signal;
      }
    };
    return {
      totalStocks: preds.length,
      bullishCount: preds.filter((p) => getSignal(p) === "bullish").length,
      bearishCount: preds.filter((p) => getSignal(p) === "bearish").length,
      neutralCount: preds.filter((p) => getSignal(p) === "neutral").length,
      averageRisk: Math.round(preds.reduce((s, p) => s + p.riskLevel, 0) / preds.length),
      averageSentiment: Math.round(preds.reduce((s, p) => s + p.sentimentScore, 0) / preds.length * 100) / 100,
      topGainers: sorted.slice(0, 3).map((p) => ({ ticker: p.ticker, change: p.priceChangePercent })),
      topLosers: sorted.slice(-3).reverse().map((p) => ({ ticker: p.ticker, change: p.priceChangePercent })),
      totalSources: preds.reduce((s, p) => s + p.sourceBreakdown.total, 0),
      lastUpdated: new Date().toISOString(),
    };
  }, [signalTimeframe]);

  const computeSummaryFromBrowse = useCallback((stocks: BrowseStock[]) => {
    if (stocks.length === 0) return null;
    const sorted = [...stocks].sort((a, b) => b.changePercent - a.changePercent);
    const bullish = stocks.filter((s) => s.changePercent > 0.5).length;
    const bearish = stocks.filter((s) => s.changePercent < -0.5).length;
    const neutral = stocks.length - bullish - bearish;
    const avgChange = stocks.reduce((s, st) => s + st.changePercent, 0) / stocks.length;
    return {
      totalStocks: stocks.length,
      bullishCount: bullish,
      bearishCount: bearish,
      neutralCount: neutral,
      averageRisk: 0, // not available for browse
      averageSentiment: Math.round(avgChange * 10) / 100, // approximate from price change
      topGainers: sorted.slice(0, 3).map((s) => ({ ticker: s.symbol, change: s.changePercent })),
      topLosers: sorted.slice(-3).reverse().map((s) => ({ ticker: s.symbol, change: s.changePercent })),
      totalSources: 0,
      lastUpdated: new Date().toISOString(),
    };
  }, []);

  const activeSummary = useMemo(() => {
    if (activeTab === "trending") {
      return computeSummaryFromPredictions(predictions);
    }
    if (activeTab === "watchlist") {
      return computeSummaryFromPredictions(watchlistPredictions);
    }
    if (activeTab === "browse") {
      return computeSummaryFromBrowse(browseStocks);
    }
    return null;
  }, [activeTab, signalTimeframe, predictions, watchlistPredictions, browseStocks, computeSummaryFromPredictions, computeSummaryFromBrowse]);

  // Localized filter label helper
  const signalLabel = (f: FilterOption) => {
    const key = `filter.${f}` as const;
    return t(key as any);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <svg
              width="28"
              height="28"
              viewBox="0 0 28 28"
              fill="none"
              aria-label="Stoxview logo"
              className="shrink-0"
            >
              <rect width="28" height="28" rx="6" className="fill-primary" />
              <path
                d="M6 18L10 14L14 16L18 9L22 12"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="22" cy="12" r="2" fill="white" />
            </svg>
            <div>
              <h1 className="text-base font-semibold leading-tight">Stoxview</h1>
              <p className="text-xs text-muted-foreground leading-tight hidden sm:block">
                {t("header.subtitle")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
              <span className="hidden sm:inline tabular-nums">
                {formatCountdown(autoRefreshCountdown)}
              </span>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleRefresh}
              disabled={isRefreshing}
              data-testid="button-refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{t("header.refresh")}</span>
            </Button>
            {/* Language toggle */}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setLang(lang === "en" ? "de" : "en")}
              data-testid="button-lang-toggle"
              title={lang === "en" ? "Auf Deutsch wechseln" : "Switch to English"}
            >
              <Languages className="w-3.5 h-3.5 mr-1.5" />
              <span className="text-xs font-semibold uppercase">{lang === "en" ? "DE" : "EN"}</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-4 sm:px-6 py-5 space-y-5">
        <DisclaimerBanner />

        {/* Universal Search Bar */}
        <div className="relative" ref={searchRef}>
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            {isSearching && (
              <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
            )}
            <input
              type="search"
              placeholder={t("search.placeholder")}
              value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowSearchDropdown(true)}
              className="w-full h-11 pl-10 pr-10 rounded-lg border border-border bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
              data-testid="input-search"
            />
            {searchQuery && !isSearching && (
              <button
                onClick={() => { setSearchQuery(""); setSearchResults([]); setShowSearchDropdown(false); }}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Search dropdown */}
          {showSearchDropdown && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-border bg-card shadow-lg z-30 overflow-hidden max-h-72 overflow-y-auto custom-scrollbar">
              {searchResults.map((r) => (
                <div
                  key={r.symbol}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/50 transition-colors"
                  data-testid={`search-result-${r.symbol}`}
                >
                  <button
                    onClick={() => handleSelectSearchResult(r.symbol)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    <span className="text-sm font-semibold shrink-0">{r.displaySymbol}</span>
                    <span className="text-xs text-muted-foreground truncate">{r.description}</span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-auto mr-2 px-1.5 py-0.5 bg-muted rounded">
                      {r.type || "Stock"}
                    </span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleWatchlist(r.symbol, r.description);
                    }}
                    className={`shrink-0 p-1.5 rounded-md transition-colors ${
                      isInWatchlist(r.symbol)
                        ? "text-amber-400 hover:text-amber-300 bg-amber-400/10"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                    title={isInWatchlist(r.symbol) ? t("watchlist.remove") : t("watchlist.add")}
                    data-testid={`watchlist-toggle-${r.symbol}`}
                  >
                    {isInWatchlist(r.symbol) ? (
                      <Star className="w-4 h-4 fill-current" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Market Overview */}
        {activeSummary && <MarketOverview summary={activeSummary} />}

        {/* View tabs + Filters Bar */}
        <div className="space-y-3">
          {/* Trending / Browse / Watchlist tabs */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/50 w-fit">
            <button
              onClick={() => { setActiveTab("trending"); setSearchedPrediction(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === "trending"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="tab-trending"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              {t("tab.trending")}
            </button>
            <button
              onClick={() => { setActiveTab("browse"); setSearchedPrediction(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === "browse"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="tab-browse"
            >
              <Globe className="w-3.5 h-3.5" />
              {t("tab.browse")}
            </button>
            <button
              onClick={() => { setActiveTab("watchlist"); setSearchedPrediction(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === "watchlist"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="tab-watchlist"
            >
              <Star className={`w-3.5 h-3.5 ${activeTab === "watchlist" ? "fill-amber-400 text-amber-400" : ""}`} />
              {t("tab.watchlist")}
              {watchlistItems.length > 0 && (
                <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] tabular-nums ${
                  activeTab === "watchlist"
                    ? "bg-amber-400/15 text-amber-400"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {watchlistItems.length}
                </span>
              )}
            </button>
          </div>

          {/* Filters row — different for browse vs trending/watchlist */}
          {activeTab === "browse" ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Category filter */}
                <div className="flex items-center gap-1" data-testid="filter-browse-category">
                  <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                  {([["most_actives", t("browse.mostActive")], ["day_gainers", t("browse.topGainers")], ["day_losers", t("browse.topLosers")]] as [BrowseCategory, string][]).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setBrowseCategory(val)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        browseCategory === val
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Market filter */}
                <div className="flex items-center gap-1" data-testid="filter-browse-market">
                  {([["all", t("filter.all")], ["us", "US"], ["de", "DE"]] as [ExchangeFilter, string][]).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setBrowseMarket(val)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        browseMarket === val
                          ? "bg-secondary text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Sort */}
                <div className="flex items-center gap-1" data-testid="filter-browse-sort">
                  <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
                  <select
                    value={browseSort}
                    onChange={(e) => setBrowseSort(e.target.value as BrowseSort)}
                    className="h-7 px-2 rounded-md border border-border bg-card text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    data-testid="select-browse-sort"
                  >
                    <option value="default">{t("browse.sort.default")}</option>
                    <option value="change-desc">{t("filter.highestFirst")}</option>
                    <option value="change-asc">{t("filter.lowestFirst")}</option>
                    <option value="volume">{t("browse.sort.volume")}</option>
                    <option value="marketcap">{t("browse.sort.marketcap")}</option>
                    <option value="name">{t("browse.sort.name")}</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground ml-auto">
                <Activity className="w-3.5 h-3.5" />
                <span>{filteredBrowseStocks.length} {t("filter.ofStocks")} {browseTotal} {t("filter.stocks")}</span>
                <div className="flex items-center border border-border rounded-md overflow-hidden ml-2">
                  <button
                    onClick={() => setBrowseViewMode("table")}
                    className={`p-1.5 transition-colors ${browseViewMode === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    title={t("browse.viewTable")}
                  >
                    <LayoutList className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setBrowseViewMode("cards")}
                    className={`p-1.5 transition-colors ${browseViewMode === "cards" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    title={t("browse.viewCards")}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Signal filter */}
                <div className="flex items-center gap-1" data-testid="filter-signal">
                  <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                  {(["all", "bullish", "bearish", "neutral"] as FilterOption[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilterSignal(f)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        filterSignal === f
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {signalLabel(f)}
                    </button>
                  ))}
                </div>

                {/* Timeframe filter */}
                <div className="flex items-center gap-1" data-testid="filter-timeframe">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                  {([["short", t("filter.timeframe.short")], ["medium", t("filter.timeframe.medium")], ["long", t("filter.timeframe.long")]] as [TimeframeFilter, string][]).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setSignalTimeframe(val)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        signalTimeframe === val
                          ? "bg-secondary text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Exchange filter */}
                <div className="flex items-center gap-1" data-testid="filter-exchange">
                  {([["all", t("filter.all")], ["us", "US"], ["de", "DE"]] as [ExchangeFilter, string][]).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setExchangeFilter(val)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        exchangeFilter === val
                          ? "bg-secondary text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Sort */}
                <div className="flex items-center gap-1" data-testid="filter-sort">
                  <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="h-7 px-2 rounded-md border border-border bg-card text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    data-testid="select-sort"
                  >
                    <option value="change-desc">{t("filter.highestFirst")}</option>
                    <option value="change-asc">{t("filter.lowestFirst")}</option>
                    <option value="confidence">{t("filter.confidence")}</option>
                    <option value="risk">{t("filter.risk")}</option>
                    <option value="name">{t("filter.name")}</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground ml-auto">
                <Activity className="w-3.5 h-3.5" />
                <span>{filtered.length} {t("filter.ofStocks")} {allPredictions.length} {t("filter.stocks")}</span>
              </div>
            </div>
          )}
        </div>

        {/* Loading state for searched stock */}
        {isLoadingPrediction && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-primary/5 border border-primary/20">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">
              {t("loading.fetchingIntelligence")} {selectedStock}...
            </span>
          </div>
        )}

        {/* Content area */}
        <div className="flex gap-5 items-start">
          {/* Stock grid / browse table */}
          <div className={`flex-1 min-w-0 ${isDetailExpanded && selectedPrediction ? "hidden" : ""}`}>
            {currentListLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-60 rounded-lg bg-card border border-border animate-pulse" />
                ))}
              </div>
            ) : activeTab === "browse" ? (
              /* ── Browse: compact scrollable table ── */
              filteredBrowseStocks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Globe className="w-10 h-10 text-muted-foreground mb-3" />
                  <p className="text-sm font-medium">{t("browse.noStocks")}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t("browse.tryDifferent")}</p>
                </div>
              ) : browseViewMode === "cards" ? (
                /* ── Browse: card grid view ── */
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {filteredBrowseStocks.map((stock) => {
                      const positive = stock.changePercent >= 0;
                      const fmtVol = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v);
                      const fmtMcap = (v: number) => v >= 1_000_000_000 ? `${(v / 1_000_000_000).toFixed(1)}B` : v >= 1_000_000 ? `${(v / 1_000_000).toFixed(0)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v);
                      return (
                        <div
                          key={stock.symbol}
                          className={`rounded-lg border border-border bg-card p-4 hover:bg-muted/30 transition-colors cursor-pointer ${
                            selectedStock === stock.symbol ? "ring-1 ring-primary border-primary/40" : ""
                          }`}
                          onClick={() => handleSelectSearchResult(stock.symbol)}
                          data-testid={`browse-card-${stock.symbol}`}
                        >
                          {/* Header: symbol, name, watchlist */}
                          <div className="flex items-start justify-between gap-2 mb-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm">{stock.symbol}</span>
                                <span className="px-1.5 py-0.5 bg-muted rounded text-[10px] text-muted-foreground">{stock.exchange}</span>
                              </div>
                              <p className="text-xs text-muted-foreground truncate mt-0.5">{stock.shortName || stock.name}</p>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleWatchlist(stock.symbol, stock.name); }}
                              className={`p-1 rounded transition-colors shrink-0 ${
                                isInWatchlist(stock.symbol)
                                  ? "text-amber-400 hover:text-amber-300"
                                  : "text-muted-foreground/40 hover:text-muted-foreground"
                              }`}
                              title={isInWatchlist(stock.symbol) ? t("watchlist.remove") : t("watchlist.add")}
                            >
                              <Star className={`w-4 h-4 ${isInWatchlist(stock.symbol) ? "fill-current" : ""}`} />
                            </button>
                          </div>
                          {/* Price + change */}
                          <div className="flex items-baseline gap-3 mb-3">
                            <span className="text-lg font-semibold tabular-nums">€{stock.price.toFixed(2)}</span>
                            <span className={`text-sm font-medium tabular-nums ${positive ? "text-emerald-400" : "text-red-400"}`}>
                              {positive ? "+" : ""}{stock.changePercent.toFixed(2)}%
                            </span>
                          </div>
                          {/* Data grid */}
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{t("table.volume")}</span>
                              <span className="tabular-nums font-medium">{fmtVol(stock.volume)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{t("browse.avgVolume")}</span>
                              <span className="tabular-nums font-medium">{stock.avgVolume ? fmtVol(stock.avgVolume) : "—"}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{t("browse.52wHigh")}</span>
                              <span className="tabular-nums font-medium">{stock.fiftyTwoWeekHigh ? `€${stock.fiftyTwoWeekHigh.toFixed(2)}` : "—"}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{t("browse.52wLow")}</span>
                              <span className="tabular-nums font-medium">{stock.fiftyTwoWeekLow ? `€${stock.fiftyTwoWeekLow.toFixed(2)}` : "—"}</span>
                            </div>
                            {stock.marketCap != null && stock.marketCap > 0 && (
                              <div className="flex justify-between col-span-2">
                                <span className="text-muted-foreground">{t("browse.marketCap")}</span>
                                <span className="tabular-nums font-medium">€{fmtMcap(stock.marketCap)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Load More button */}
                  {browseHasMore && (
                    <div className="flex justify-center py-4">
                      <button
                        onClick={handleLoadMore}
                        disabled={isBrowseLoadingMore}
                        className="flex items-center gap-2 px-6 py-2 text-sm font-medium rounded-lg bg-muted hover:bg-muted/80 text-foreground transition-colors disabled:opacity-50"
                        data-testid="btn-load-more-cards"
                      >
                        {isBrowseLoadingMore ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {t("browse.loading")}
                          </>
                        ) : (
                          <>
                            {t("browse.loadMore")} ({browseTotal - browseOffset} {t("browse.remaining")})
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                /* ── Browse: compact scrollable table ── */
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                          <th className="text-left py-2.5 px-3 font-medium w-8"></th>
                          <th className="text-left py-2.5 px-3 font-medium">{t("table.symbol")}</th>
                          <th className="text-left py-2.5 px-3 font-medium hidden sm:table-cell">{t("table.name")}</th>
                          <th className="text-right py-2.5 px-3 font-medium">{t("table.price")}</th>
                          <th className="text-right py-2.5 px-3 font-medium">{t("table.change")}</th>
                          <th className="text-right py-2.5 px-3 font-medium hidden md:table-cell">{t("table.volume")}</th>
                          <th className="text-left py-2.5 px-3 font-medium hidden lg:table-cell">{t("table.exchange")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBrowseStocks.map((stock) => {
                          const positive = stock.changePercent >= 0;
                          return (
                            <tr
                              key={stock.symbol}
                              className={`border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer ${
                                selectedStock === stock.symbol ? "bg-primary/5" : ""
                              }`}
                              onClick={() => handleSelectSearchResult(stock.symbol)}
                              data-testid={`browse-row-${stock.symbol}`}
                            >
                              <td className="py-2 px-3">
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleWatchlist(stock.symbol, stock.name); }}
                                  className={`p-0.5 rounded transition-colors ${
                                    isInWatchlist(stock.symbol)
                                      ? "text-amber-400 hover:text-amber-300"
                                      : "text-muted-foreground/40 hover:text-muted-foreground"
                                  }`}
                                  title={isInWatchlist(stock.symbol) ? t("watchlist.remove") : t("watchlist.add")}
                                >
                                  <Star className={`w-3.5 h-3.5 ${isInWatchlist(stock.symbol) ? "fill-current" : ""}`} />
                                </button>
                              </td>
                              <td className="py-2 px-3">
                                <span className="font-semibold text-xs">{stock.symbol}</span>
                                <span className="sm:hidden text-[10px] text-muted-foreground block truncate max-w-[140px]">{stock.shortName}</span>
                              </td>
                              <td className="py-2 px-3 text-xs text-muted-foreground hidden sm:table-cell max-w-[200px] truncate">{stock.name}</td>
                              <td className="py-2 px-3 text-right font-medium tabular-nums text-xs">€{stock.price.toFixed(2)}</td>
                              <td className={`py-2 px-3 text-right font-medium tabular-nums text-xs ${positive ? "text-emerald-400" : "text-red-400"}`}>
                                {positive ? "+" : ""}{stock.changePercent.toFixed(2)}%
                              </td>
                              <td className="py-2 px-3 text-right text-xs text-muted-foreground tabular-nums hidden md:table-cell">
                                {stock.volume >= 1_000_000 ? `${(stock.volume / 1_000_000).toFixed(1)}M` : stock.volume >= 1000 ? `${(stock.volume / 1000).toFixed(0)}K` : stock.volume}
                              </td>
                              <td className="py-2 px-3 text-xs text-muted-foreground hidden lg:table-cell">
                                <span className="px-1.5 py-0.5 bg-muted rounded text-[10px]">{stock.exchange}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* Load More button */}
                  {browseHasMore && (
                    <div className="flex justify-center py-4 border-t border-border">
                      <button
                        onClick={handleLoadMore}
                        disabled={isBrowseLoadingMore}
                        className="flex items-center gap-2 px-6 py-2 text-sm font-medium rounded-lg bg-muted hover:bg-muted/80 text-foreground transition-colors disabled:opacity-50"
                        data-testid="btn-load-more"
                      >
                        {isBrowseLoadingMore ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {t("browse.loading")}
                          </>
                        ) : (
                          <>
                            {t("browse.loadMore")} ({browseTotal - browseOffset} {t("browse.remaining")})
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )
            ) : activeTab === "watchlist" && watchlistItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Star className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="text-sm font-medium">{t("watchlist.empty")}</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  {t("watchlist.emptyHint")}
                </p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <TrendingUp className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="text-sm font-medium">{t("noResults.title")}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("noResults.hint")}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map((prediction) => (
                  <StockCard
                    key={prediction.ticker}
                    prediction={prediction}
                    isSelected={selectedStock === prediction.ticker}
                    isInWatchlist={isInWatchlist(prediction.ticker)}
                    onToggleWatchlist={() => toggleWatchlist(prediction.ticker, prediction.name)}
                    onClick={() =>
                      setSelectedStock(
                        selectedStock === prediction.ticker ? null : prediction.ticker
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>

          {/* Detail panel (desktop) */}
          {selectedPrediction && (
            <div className={`hidden lg:block shrink-0 sticky top-20 transition-all duration-300 ${
              isDetailExpanded ? "w-full" : "w-[400px]"
            }`}>
              <StockDetail
                prediction={selectedPrediction}
                isInWatchlist={isInWatchlist(selectedPrediction.ticker)}
                onToggleWatchlist={() => toggleWatchlist(selectedPrediction.ticker, selectedPrediction.name)}
                onClose={() => { setSelectedStock(null); setSearchedPrediction(null); setIsDetailExpanded(false); }}
                isExpanded={isDetailExpanded}
                onToggleExpand={() => setIsDetailExpanded(!isDetailExpanded)}
              />
            </div>
          )}
        </div>

        {/* Detail panel (mobile overlay) */}
        {selectedPrediction && (
          <div className="fixed inset-0 z-30 lg:hidden">
            <div
              className="absolute inset-0 bg-background/60 backdrop-blur-sm"
              onClick={() => { setSelectedStock(null); setSearchedPrediction(null); setIsDetailExpanded(false); }}
            />
            <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-xl bg-card border-t border-border custom-scrollbar">
              <StockDetail
                prediction={selectedPrediction}
                isInWatchlist={isInWatchlist(selectedPrediction.ticker)}
                onToggleWatchlist={() => toggleWatchlist(selectedPrediction.ticker, selectedPrediction.name)}
                onClose={() => { setSelectedStock(null); setSearchedPrediction(null); setIsDetailExpanded(false); }}
              />
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
