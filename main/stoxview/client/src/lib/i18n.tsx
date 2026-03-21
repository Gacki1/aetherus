import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type Lang = "en" | "de";

// ═══════════════════════════════════════════════════════════
// TRANSLATIONS
// ═══════════════════════════════════════════════════════════
const translations = {
  // ── Header ──
  "header.subtitle": { en: "Multi-Source Intelligence", de: "Multi-Quellen-Analyse" },
  "header.refresh": { en: "Refresh", de: "Aktualisieren" },

  // ── Search ──
  "search.placeholder": {
    en: "Search by name, ticker, or ISIN (e.g. AAPL, Apple, DE0007164600)...",
    de: "Suche nach Name, Ticker oder ISIN (z.B. AAPL, Apple, DE0007164600)...",
  },

  // ── Tabs ──
  "tab.trending": { en: "Trending", de: "Trends" },
  "tab.browse": { en: "Browse", de: "Durchsuchen" },
  "tab.watchlist": { en: "Watchlist", de: "Watchlist" },

  // ── Disclaimer banner ──
  "disclaimer.text": {
    en: "Predictions are based on sentiment analysis and are never 100% accurate. This tool is for informational purposes only and does not constitute financial advice. Always do your own research before making investment decisions. Past performance does not guarantee future results.",
    de: "Vorhersagen basieren auf Stimmungsanalysen und sind nie 100% genau. Dieses Tool dient nur zu Informationszwecken und stellt keine Finanzberatung dar. Recherchiere immer selbst, bevor du Investitionsentscheidungen triffst. Vergangene Ergebnisse garantieren keine zukünftigen Renditen.",
  },

  // ── Market overview ──
  "overview.signals": { en: "Signals", de: "Signale" },
  "overview.sentiment": { en: "Sentiment", de: "Stimmung" },
  "overview.avgRisk": { en: "Avg Risk", de: "Ø Risiko" },
  "overview.intelligence": { en: "Intelligence", de: "Quellen" },
  "overview.topMovers": { en: "Top Movers", de: "Top Beweger" },
  "overview.sources": { en: "sources", de: "Quellen" },
  "overview.score": { en: "Score", de: "Wert" },
  "sentiment.bullish": { en: "Bullish", de: "Bullisch" },
  "sentiment.bearish": { en: "Bearish", de: "Bärisch" },
  "sentiment.mixed": { en: "Mixed", de: "Gemischt" },

  // ── Filters ──
  "filter.all": { en: "All", de: "Alle" },
  "filter.bullish": { en: "Bullish", de: "Bullisch" },
  "filter.bearish": { en: "Bearish", de: "Bärisch" },
  "filter.neutral": { en: "Neutral", de: "Neutral" },
  "filter.timeframe": { en: "Timeframe", de: "Zeitraum" },
  "filter.timeframe.short": { en: "Short-term", de: "Kurzfristig" },
  "filter.timeframe.medium": { en: "Mid-term", de: "Mittelfristig" },
  "filter.timeframe.long": { en: "Long-term", de: "Langfristig" },
  "filter.highestFirst": { en: "% Highest first", de: "% Höchste zuerst" },
  "filter.lowestFirst": { en: "% Lowest first", de: "% Niedrigste zuerst" },
  "filter.confidence": { en: "Confidence", de: "Konfidenz" },
  "filter.risk": { en: "Risk", de: "Risiko" },
  "filter.name": { en: "Name", de: "Name" },
  "filter.ofStocks": { en: "of", de: "von" },
  "filter.stocks": { en: "stocks", de: "Aktien" },

  // ── Browse filters ──
  "browse.mostActive": { en: "Most Active", de: "Meistgehandelt" },
  "browse.topGainers": { en: "Top Gainers", de: "Top Gewinner" },
  "browse.topLosers": { en: "Top Losers", de: "Top Verlierer" },
  "browse.sort.default": { en: "Default", de: "Standard" },
  "browse.sort.change": { en: "Change %", de: "Änderung %" },
  "browse.sort.volume": { en: "Volume", de: "Volumen" },
  "browse.sort.marketcap": { en: "Market Cap", de: "Marktkapital." },
  "browse.sort.name": { en: "Name", de: "Name" },
  "browse.noStocks": { en: "No stocks found", de: "Keine Aktien gefunden" },
  "browse.tryDifferent": {
    en: "Try a different category or market filter",
    de: "Versuche eine andere Kategorie oder Marktfilter",
  },
  "browse.loadMore": { en: "Load More", de: "Mehr laden" },
  "browse.loading": { en: "Loading...", de: "Laden..." },
  "browse.remaining": { en: "remaining", de: "verbleibend" },
  "browse.viewTable": { en: "Table view", de: "Tabellenansicht" },
  "browse.viewCards": { en: "Card view", de: "Kartenansicht" },
  "browse.marketCap": { en: "Market Cap", de: "Marktkapital." },
  "browse.52wHigh": { en: "52W High", de: "52W Hoch" },
  "browse.52wLow": { en: "52W Low", de: "52W Tief" },
  "browse.avgVolume": { en: "Avg Vol", de: "Ø Volumen" },

  // ── Browse table headers ──
  "table.symbol": { en: "Symbol", de: "Symbol" },
  "table.name": { en: "Name", de: "Name" },
  "table.price": { en: "Price", de: "Preis" },
  "table.change": { en: "Change", de: "Änderung" },
  "table.volume": { en: "Volume", de: "Volumen" },
  "table.exchange": { en: "Exchange", de: "Börse" },

  // ── Watchlist ──
  "watchlist.empty": { en: "Your watchlist is empty", de: "Deine Watchlist ist leer" },
  "watchlist.emptyHint": {
    en: "Search for stocks above and click the + button to add them to your watchlist",
    de: "Suche oben nach Aktien und klicke auf +, um sie deiner Watchlist hinzuzufügen",
  },
  "watchlist.add": { en: "Add to watchlist", de: "Zur Watchlist hinzufügen" },
  "watchlist.remove": { en: "Remove from watchlist", de: "Von Watchlist entfernen" },

  // ── No results ──
  "noResults.title": { en: "No stocks match your filters", de: "Keine Aktien entsprechen deinen Filtern" },
  "noResults.hint": {
    en: "Try adjusting your filters or search for a specific stock",
    de: "Passe deine Filter an oder suche nach einer bestimmten Aktie",
  },

  // ── Stock card ──
  "card.sources": { en: "sources", de: "Quellen" },
  "card.details": { en: "Details", de: "Details" },
  "card.risk.high": { en: "High", de: "Hoch" },
  "card.risk.med": { en: "Med", de: "Mittel" },
  "card.risk.low": { en: "Low", de: "Niedrig" },

  // ── Stock detail ──
  "detail.isin": { en: "ISIN", de: "ISIN" },
  "detail.isinCopied": { en: "Copied!", de: "Kopiert!" },
  "detail.isinCopy": { en: "Copy ISIN", de: "ISIN kopieren" },
  "detail.priceChart": { en: "Price Chart + Projection", de: "Preischart + Prognose" },
  "detail.riskLevel.high": { en: "High Risk", de: "Hohes Risiko" },
  "detail.riskLevel.medium": { en: "Medium Risk", de: "Mittleres Risiko" },
  "detail.riskLevel.low": { en: "Low Risk", de: "Niedriges Risiko" },
  "detail.predictionSignals": { en: "Prediction Signals", de: "Vorhersage-Signale" },
  "detail.confidence": { en: "Confidence", de: "Konfidenz" },
  "detail.confidenceComparison": { en: "Confidence Comparison", de: "Konfidenzvergleich" },
  "detail.investmentTiming": { en: "Investment Timing", de: "Einstiegszeitpunkt" },
  "detail.aggregatedSentiment": { en: "Aggregated Sentiment", de: "Gesamtstimmung" },
  "detail.sentimentPositive": { en: "Positive", de: "Positiv" },
  "detail.sentimentNegative": { en: "Negative", de: "Negativ" },
  "detail.sentimentMixed": { en: "Mixed", de: "Gemischt" },
  "detail.across": { en: "Across", de: "Aus" },
  "detail.intelligenceSources": { en: "Intelligence Sources", de: "Analyse-Quellen" },
  "detail.finnhub": { en: "Finnhub", de: "Finnhub" },
  "detail.web": { en: "Web", de: "Web" },
  "detail.analyst": { en: "Analyst", de: "Analyst" },
  "detail.technical": { en: "Technical", de: "Technisch" },
  "detail.fearGreed": { en: "Fear & Greed", de: "Fear & Greed" },
  "detail.disclaimer": {
    en: "Predictions are estimates aggregated from multiple sources and are never 100% accurate. This tool does not constitute financial advice. Always do your own research.",
    de: "Vorhersagen sind Schätzungen aus mehreren Quellen und nie 100% genau. Dieses Tool stellt keine Finanzberatung dar. Recherchiere immer selbst.",
  },
  "detail.lastUpdated": { en: "Last updated", de: "Zuletzt aktualisiert" },
  "detail.expand": { en: "Expand", de: "Vergr\u00f6\u00dfern" },
  "detail.collapse": { en: "Collapse", de: "Verkleinern" },
  "detail.justNow": { en: "Just now", de: "Gerade eben" },
  "detail.hAgo": { en: "h ago", de: "Std. her" },
  "detail.dAgo": { en: "d ago", de: "T. her" },
  "detail.delayed": { en: "Delayed", de: "Verzögert" },
  "detail.postMarket": { en: "After hours", de: "Nachbörslich" },
  "detail.preMarket": { en: "Pre-market", de: "Vorbörslich" },
  "detail.marketClosed": { en: "Market closed", de: "Markt geschlossen" },
  "detail.bid": { en: "Bid", de: "Geld" },
  "detail.ask": { en: "Ask", de: "Brief" },

  // ── Timeframe signals ──
  "signal.bullish": { en: "Bullish", de: "Bullisch" },
  "signal.bearish": { en: "Bearish", de: "Bärisch" },
  "signal.neutral": { en: "Neutral", de: "Neutral" },
  "signal.short": { en: "Short", de: "Kurz" },
  "signal.medium": { en: "Medium", de: "Mittel" },
  "signal.long": { en: "Long", de: "Lang" },

  // ── Investment Timing ──
  "timing.strong": { en: "Strong Entry Signal", de: "Starkes Einstiegssignal" },
  "timing.strongDesc": {
    en: "Multiple indicators align positively. Sentiment is favorable and risk is manageable. This could be a good moment to consider an entry.",
    de: "Mehrere Indikatoren sind positiv ausgerichtet. Die Stimmung ist günstig und das Risiko überschaubar. Dies könnte ein guter Zeitpunkt für einen Einstieg sein.",
  },
  "timing.moderate": { en: "Moderate Entry Signal", de: "Moderates Einstiegssignal" },
  "timing.moderateDesc": {
    en: "Some indicators suggest a reasonable entry point, though signals are not fully aligned. Consider averaging in over time.",
    de: "Einige Indikatoren deuten auf einen vertretbaren Einstiegspunkt hin, obwohl die Signale nicht vollständig übereinstimmen. Erwäge einen schrittweisen Einstieg.",
  },
  "timing.neutral": { en: "Neutral \u2014 Hold / Watch", de: "Neutral \u2014 Halten / Beobachten" },
  "timing.neutralDesc": {
    en: "Mixed signals across timeframes. It may be better to wait for clearer confirmation before entering a position.",
    de: "Gemischte Signale über alle Zeiträume. Es ist möglicherweise besser, auf eine klarere Bestätigung zu warten, bevor man eine Position eröffnet.",
  },
  "timing.weak": { en: "Weak \u2014 Consider Waiting", de: "Schwach \u2014 Abwarten empfohlen" },
  "timing.weakDesc": {
    en: "Bearish pressure and elevated risk suggest this may not be the ideal time. Monitor for improving signals.",
    de: "Bärischer Druck und erhöhtes Risiko deuten darauf hin, dass dies nicht der ideale Zeitpunkt ist. Beobachte die Signale auf Verbesserungen.",
  },
  "timing.poor": { en: "Poor Timing \u2014 Caution", de: "Schlechter Zeitpunkt \u2014 Vorsicht" },
  "timing.poorDesc": {
    en: "Strong bearish signals and high risk. Entering now carries significant downside potential. Wait for reversal signals.",
    de: "Starke bärische Signale und hohes Risiko. Ein Einstieg jetzt birgt erhebliches Abwärtspotenzial. Warte auf Umkehrsignale.",
  },
  "timing.signalAlignment": { en: "Signal Alignment", de: "Signalübereinstimmung" },
  "timing.marketSentiment": { en: "Market Sentiment", de: "Marktstimmung" },
  "timing.riskAssessment": { en: "Risk Assessment", de: "Risikobewertung" },
  "timing.pricePosition": { en: "Price Position", de: "Preisposition" },
  "timing.bullishAcross": { en: "Bullish across timeframes", de: "Bullisch über alle Zeiträume" },
  "timing.bearishAcross": { en: "Bearish across timeframes", de: "Bärisch über alle Zeiträume" },
  "timing.mixedSignals": { en: "Mixed signals", de: "Gemischte Signale" },
  "timing.positiveNews": { en: "Positive news flow", de: "Positive Nachrichtenlage" },
  "timing.negativeNews": { en: "Negative news flow", de: "Negative Nachrichtenlage" },
  "timing.neutralNews": { en: "Neutral coverage", de: "Neutrale Berichterstattung" },
  "timing.lowRisk": { en: "Low volatility risk", de: "Niedriges Volatilitätsrisiko" },
  "timing.highRisk": { en: "High volatility risk", de: "Hohes Volatilitätsrisiko" },
  "timing.moderateRisk": { en: "Moderate risk level", de: "Moderates Risikoniveau" },
  "timing.nearLow": { en: "Near daily low \u2014 potential value", de: "Nahe Tagestief \u2014 möglicher Wert" },
  "timing.nearHigh": { en: "Near daily high", de: "Nahe Tageshoch" },
  "timing.midRange": { en: "Mid-range", de: "Mittelbereich" },
  "timing.disclaimer": {
    en: "This timing indicator is algorithmic and never 100% accurate. It is not financial advice. Always do your own research and consider your personal risk tolerance before investing.",
    de: "Dieser Timing-Indikator ist algorithmisch und nie 100% genau. Er stellt keine Finanzberatung dar. Recherchiere immer selbst und berücksichtige deine persönliche Risikobereitschaft vor einer Investition.",
  },

  // ── Dashboard loading ──
  "loading.fetchingIntelligence": {
    en: "Fetching multi-source intelligence for",
    de: "Lade Multi-Quellen-Analyse für",
  },

  // ── Prediction History ──
  "history.title": { en: "Prediction History", de: "Vorhersage-Verlauf" },
  "history.accuracy": { en: "Accuracy", de: "Genauigkeit" },
  "history.totalPredictions": { en: "Total Predictions", de: "Gesamtvorhersagen" },
  "history.noData": { en: "No prediction history yet", de: "Noch kein Vorhersage-Verlauf" },
  "history.noDataHint": {
    en: "Predictions for your watchlist stocks are recorded daily. Check back later to see accuracy.",
    de: "Vorhersagen für deine Watchlist-Aktien werden täglich aufgezeichnet. Schau später wieder vorbei für die Genauigkeit.",
  },
  "history.correct": { en: "correct", de: "korrekt" },
  "history.of": { en: "of", de: "von" },
  "history.predictions": { en: "predictions", de: "Vorhersagen" },
  "history.awaitingResult": { en: "Awaiting results", de: "Warte auf Ergebnis" },
  "history.date": { en: "Date", de: "Datum" },
  "history.priceAtPrediction": { en: "Price then", de: "Preis damals" },
  "history.actualPrice": { en: "Actual", de: "Tatsächlich" },
  "history.result": { en: "Result", de: "Ergebnis" },
  "history.hit": { en: "Hit", de: "Treffer" },
  "history.miss": { en: "Miss", de: "Verfehlt" },
  "history.pending": { en: "Pending", de: "Ausstehend" },
  "history.recentPredictions": { en: "Recent Predictions", de: "Letzte Vorhersagen" },
  "history.watchlistOnly": {
    en: "History is tracked only for watchlist stocks",
    de: "Verlauf wird nur für Watchlist-Aktien aufgezeichnet",
  },

  // ── Adaptive learning ──
  "learning.adaptive": { en: "Adaptive", de: "Adaptiv" },
  "learning.badge": { en: "Self-Learning Active", de: "Selbstlernen aktiv" },
  "learning.badgeGlobal": { en: "Learning from all stocks", de: "Lernt aus allen Aktien" },
  "learning.badgeCategory": { en: "Learning from sector", de: "Lernt aus Sektor" },
  "learning.evaluatedCount": { en: "predictions evaluated", de: "Vorhersagen ausgewertet" },
  "learning.weights": { en: "Source Weights", de: "Quellen-Gewichtung" },
  "learning.default": { en: "Default", de: "Standard" },
  "learning.learned": { en: "Learned", de: "Gelernt" },
  "learning.webSentiment": { en: "Web News", de: "Web-Nachrichten" },
  "learning.analystRating": { en: "Analyst", de: "Analysten" },
  "learning.finnhubSentiment": { en: "Finnhub", de: "Finnhub" },
  "learning.technicalSignal": { en: "Technicals", de: "Technische Analyse" },
  "learning.fearGreedSignal": { en: "Fear & Greed", de: "Fear & Greed" },
  "learning.notEnoughData": {
    en: "Not enough data yet — needs 5+ evaluated predictions to start learning",
    de: "Noch nicht gen\u00fcgend Daten — 5+ ausgewertete Vorhersagen n\u00f6tig",
  },
  // ── Source signals in history ──
  "history.sourceSignals": { en: "Source Signals", de: "Quellensignale" },
  "history.expand": { en: "Details", de: "Details" },
  "history.momentum": { en: "Momentum", de: "Momentum" },

  // ── Price chart ──
  "chart.loading": { en: "Loading chart data...", de: "Lade Chartdaten..." },
  "chart.unavailable": { en: "Chart data unavailable", de: "Chartdaten nicht verfügbar" },
  "chart.historical": { en: "Historical", de: "Historisch" },
  "chart.projected": { en: "Projected", de: "Prognose" },
  "chart.projectionDisclaimer": {
    en: "Projected line is an estimate based on trend analysis and prediction signals. Not financial advice.",
    de: "Die Prognoselinie ist eine Schätzung basierend auf Trendanalyse und Vorhersagesignalen. Keine Finanzberatung.",
  },
} as const;

export type TranslationKey = keyof typeof translations;

// ═══════════════════════════════════════════════════════════
// CONTEXT & HOOK
// ═══════════════════════════════════════════════════════════
interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: "en",
  setLang: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    // Detect browser language, default to English
    const browserLang = typeof navigator !== "undefined" ? navigator.language : "en";
    return browserLang.startsWith("de") ? "de" : "en";
  });

  const t = useCallback(
    (key: TranslationKey): string => {
      const entry = translations[key];
      if (!entry) return key;
      return entry[lang] || entry["en"] || key;
    },
    [lang]
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
