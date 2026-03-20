import { useState } from "react";
import type { StockPrediction, TimeframePrediction, NewsSource } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { PriceChart } from "@/components/price-chart";
import {
  X,
  TrendingUp,
  TrendingDown,
  Minus,
  Shield,
  Newspaper,
  Clock,
  AlertTriangle,
  ExternalLink,
  Globe,
  BarChart3,
  Search,
  Users,
  LineChart,
  ChevronDown,
  ChevronUp,
  Star,
  Zap,
  Info,
  Copy,
  Check,
  Maximize2,
  Minimize2,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import { useI18n } from "@/lib/i18n";
import { PredictionHistory } from "@/components/prediction-history";

interface StockDetailProps {
  prediction: StockPrediction;
  isInWatchlist?: boolean;
  onToggleWatchlist?: () => void;
  onClose: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

// ── Sentiment Gauge ──
function SentimentGauge({ score }: { score: number }) {
  const angle = ((score + 1) / 2) * 180;
  const color =
    score > 0.15 ? "hsl(152, 55%, 48%)"
    : score < -0.15 ? "hsl(0, 60%, 58%)"
    : "hsl(43, 70%, 58%)";

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-24 h-14 overflow-hidden">
        <svg viewBox="0 0 100 55" className="w-full h-full">
          <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="hsl(var(--muted))" strokeWidth="6" strokeLinecap="round" />
          <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(angle / 180) * 126} 126`} />
          <line
            x1="50" y1="50"
            x2={50 + 30 * Math.cos(((180 - angle) * Math.PI) / 180)}
            y2={50 - 30 * Math.sin(((180 - angle) * Math.PI) / 180)}
            stroke="hsl(var(--foreground))" strokeWidth="1.5" strokeLinecap="round"
          />
          <circle cx="50" cy="50" r="3" fill="hsl(var(--foreground))" />
        </svg>
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {score > 0 ? "+" : ""}{score.toFixed(2)}
      </span>
    </div>
  );
}

// ── Confidence chart for 3 timeframes ──
function ConfidenceChart({ prediction }: { prediction: StockPrediction }) {
  const { t } = useI18n();
  const data = [
    { name: t("signal.short"), confidence: prediction.shortTerm.confidence, signal: prediction.shortTerm.signal },
    { name: t("signal.medium"), confidence: prediction.mediumTerm.confidence, signal: prediction.mediumTerm.signal },
    { name: t("signal.long"), confidence: prediction.longTerm.confidence, signal: prediction.longTerm.signal },
  ];

  const colorForSignal = (signal: string) =>
    signal === "bullish" ? "hsl(152, 55%, 48%)"
    : signal === "bearish" ? "hsl(0, 60%, 58%)"
    : "hsl(var(--muted-foreground))";

  return (
    <div className="h-28">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" barSize={14}>
          <XAxis
            type="number" domain={[0, 100]}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false} axisLine={false}
          />
          <YAxis
            dataKey="name" type="category"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false} axisLine={false} width={52}
          />
          <Bar dataKey="confidence" radius={[0, 4, 4, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={colorForSignal(entry.signal)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Timeframe signal row ──
function TimeframeDetail({ tf }: { tf: TimeframePrediction }) {
  const { t } = useI18n();
  const config = {
    bullish: { text: "text-emerald-400", bg: "bg-emerald-500/10", icon: TrendingUp, label: t("signal.bullish") },
    bearish: { text: "text-red-400", bg: "bg-red-500/10", icon: TrendingDown, label: t("signal.bearish") },
    neutral: { text: "text-zinc-400", bg: "bg-zinc-500/10", icon: Minus, label: t("signal.neutral") },
  }[tf.signal];

  const Icon = config.icon;
  const move = tf.estimatedMove;
  const hasMove = move !== undefined && move !== null && move !== 0;
  const moveStr = hasMove
    ? `${move > 0 ? "+" : ""}${move.toFixed(1)}%`
    : tf.signal === "neutral" ? "~0%" : null;

  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-md ${config.bg}`}>
      <div className="flex items-center gap-2">
        <Icon className={`w-3.5 h-3.5 ${config.text}`} />
        <div>
          <span className={`text-xs font-medium ${config.text}`}>{config.label}</span>
          <span className="text-[10px] text-muted-foreground ml-1.5">{tf.range}</span>
        </div>
      </div>
      <div className="flex flex-col items-end">
        <span className={`text-sm font-semibold tabular-nums ${config.text}`}>
          {moveStr ?? (tf.signal === "bearish" ? `-${tf.confidence}%` : `+${tf.confidence}%`)}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {t("detail.confidence")}: {tf.confidence}%
        </span>
      </div>
    </div>
  );
}

// ── Investment Timing Insight ──
function InvestmentTiming({ prediction }: { prediction: StockPrediction }) {
  const { t } = useI18n();

  const signalScore = (tf: TimeframePrediction) => {
    if (tf.signal === "bullish") return tf.confidence * 0.01;
    if (tf.signal === "bearish") return -(tf.confidence * 0.01);
    return 0;
  };

  const shortScore = signalScore(prediction.shortTerm) * 0.25;
  const medScore = signalScore(prediction.mediumTerm) * 0.35;
  const longScore = signalScore(prediction.longTerm) * 0.40;
  const alignmentScore = shortScore + medScore + longScore;

  const sentimentFactor = prediction.sentimentScore;
  const riskFactor = 1 - (prediction.riskLevel / 100);

  const dayRange = prediction.dayHigh - prediction.dayLow;
  const pricePosition = dayRange > 0
    ? (prediction.dayHigh - prediction.currentPrice) / dayRange
    : 0.5;

  // Count bearish vs bullish timeframes to detect signal direction
  const signals = [prediction.shortTerm.signal, prediction.mediumTerm.signal, prediction.longTerm.signal];
  const bearishCount = signals.filter(s => s === "bearish").length;
  const bullishCount = signals.filter(s => s === "bullish").length;

  // Signal alignment is now the dominant factor (55% weight)
  // Reduced weight on sentiment and price position which could mask bearish signals
  const raw = (
    alignmentScore * 0.55 +
    sentimentFactor * 0.15 +
    (riskFactor - 0.5) * 2 * 0.20 +
    (pricePosition - 0.5) * 2 * 0.10
  );

  let timingScore = Math.max(0, Math.min(100, Math.round((raw + 1) * 50)));

  // Bearish override: prevent misleading entry signals when projection trends down
  if (bearishCount >= 3) {
    // All 3 bearish → cap at 25 (forces "poor timing")
    timingScore = Math.min(timingScore, 25);
  } else if (bearishCount >= 2) {
    // 2+ bearish → cap at 35 (forces "weak" or below)
    timingScore = Math.min(timingScore, 35);
  } else if (bearishCount >= 1 && bullishCount === 0) {
    // 1 bearish + rest neutral → cap at 44 (forces "neutral" or below)
    timingScore = Math.min(timingScore, 44);
  } else if (alignmentScore < -0.02) {
    // Any net negative alignment → cap at 50 (no entry signal)
    // Prevents sentiment/price position from pushing bearish stocks into "moderate entry"
    timingScore = Math.min(timingScore, 50);
  }

  let verdict: string;
  let verdictColor: string;
  let verdictBg: string;
  let description: string;

  if (timingScore >= 72) {
    verdict = t("timing.strong");
    verdictColor = "text-emerald-400";
    verdictBg = "bg-emerald-500/10 border-emerald-500/20";
    description = t("timing.strongDesc");
  } else if (timingScore >= 55) {
    verdict = t("timing.moderate");
    verdictColor = "text-emerald-300";
    verdictBg = "bg-emerald-500/5 border-emerald-500/15";
    description = t("timing.moderateDesc");
  } else if (timingScore >= 42) {
    verdict = t("timing.neutral");
    verdictColor = "text-amber-400";
    verdictBg = "bg-amber-500/10 border-amber-500/20";
    description = t("timing.neutralDesc");
  } else if (timingScore >= 28) {
    verdict = t("timing.weak");
    verdictColor = "text-orange-400";
    verdictBg = "bg-orange-500/10 border-orange-500/20";
    description = t("timing.weakDesc");
  } else {
    verdict = t("timing.poor");
    verdictColor = "text-red-400";
    verdictBg = "bg-red-500/10 border-red-500/20";
    description = t("timing.poorDesc");
  }

  const factors = [
    {
      label: t("timing.signalAlignment"),
      value: alignmentScore,
      desc: alignmentScore > 0.2 ? t("timing.bullishAcross")
        : alignmentScore < -0.2 ? t("timing.bearishAcross")
        : t("timing.mixedSignals"),
    },
    {
      label: t("timing.marketSentiment"),
      value: sentimentFactor,
      desc: sentimentFactor > 0.15 ? t("timing.positiveNews")
        : sentimentFactor < -0.15 ? t("timing.negativeNews")
        : t("timing.neutralNews"),
    },
    {
      label: t("timing.riskAssessment"),
      value: (riskFactor - 0.5) * 2,
      desc: prediction.riskLevel < 35 ? t("timing.lowRisk")
        : prediction.riskLevel > 65 ? t("timing.highRisk")
        : t("timing.moderateRisk"),
    },
    {
      label: t("timing.pricePosition"),
      value: (pricePosition - 0.5) * 2,
      desc: pricePosition > 0.6 ? t("timing.nearLow")
        : pricePosition < 0.3 ? t("timing.nearHigh")
        : t("timing.midRange"),
    },
  ];

  return (
    <div className={`rounded-lg border p-4 ${verdictBg}`} data-testid="investment-timing">
      <div className="flex items-center gap-2 mb-3">
        <Zap className={`w-4 h-4 ${verdictColor}`} />
        <span className={`text-sm font-semibold ${verdictColor}`}>{verdict}</span>
        <span className={`text-xs tabular-nums ml-auto font-medium ${verdictColor}`}>{timingScore}/100</span>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed mb-3">
        {description}
      </p>

      <div className="space-y-2">
        {factors.map((f, i) => {
          const barWidth = Math.abs(f.value) * 50;
          const isPositive = f.value >= 0;
          return (
            <div key={i} className="space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">{f.label}</span>
                <span className="text-[10px] text-muted-foreground">{f.desc}</span>
              </div>
              <div className="h-1 rounded-full bg-background/60 overflow-hidden flex">
                <div className="w-1/2 flex justify-end">
                  {!isPositive && (
                    <div
                      className="h-full rounded-full bg-red-400/70"
                      style={{ width: `${barWidth}%` }}
                    />
                  )}
                </div>
                <div className="w-px bg-muted-foreground/30 shrink-0" />
                <div className="w-1/2">
                  {isPositive && (
                    <div
                      className="h-full rounded-full bg-emerald-400/70"
                      style={{ width: `${barWidth}%` }}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-start gap-1.5 mt-3 pt-3 border-t border-border/30">
        <Info className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          {t("timing.disclaimer")}
        </p>
      </div>
    </div>
  );
}

// ── Source type icon ──
function SourceIcon({ type }: { type: string }) {
  switch (type) {
    case "finnhub": return <Newspaper className="w-3 h-3 text-blue-400 shrink-0" />;
    case "web-search": return <Search className="w-3 h-3 text-amber-400 shrink-0" />;
    case "analyst": return <Users className="w-3 h-3 text-purple-400 shrink-0" />;
    case "technical": return <LineChart className="w-3 h-3 text-cyan-400 shrink-0" />;
    case "fear-greed": return <Zap className="w-3 h-3 text-orange-400 shrink-0" />;
    default: return <Globe className="w-3 h-3 text-muted-foreground shrink-0" />;
  }
}

// ── News sentiment icon ──
function SentimentIcon({ sentiment }: { sentiment: string }) {
  if (sentiment === "positive") return <TrendingUp className="w-3 h-3 text-emerald-400 shrink-0" />;
  if (sentiment === "negative") return <TrendingDown className="w-3 h-3 text-red-400 shrink-0" />;
  return <Minus className="w-3 h-3 text-zinc-400 shrink-0" />;
}

// ── ISIN Badge with copy button ──
function IsinBadge({ isin }: { isin: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(isin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments where clipboard API isn't available
      const textarea = document.createElement("textarea");
      textarea.value = isin;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <span className="text-[10px] text-muted-foreground font-medium">{t("detail.isin")}:</span>
      <span className="text-[11px] font-mono text-muted-foreground tracking-wide">{isin}</span>
      <button
        onClick={handleCopy}
        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all ${
          copied
            ? "bg-emerald-500/15 text-emerald-400"
            : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
        }`}
        title={t("detail.isinCopy")}
        data-testid="button-copy-isin"
      >
        {copied ? (
          <><Check className="w-2.5 h-2.5" /> {t("detail.isinCopied")}</>
        ) : (
          <><Copy className="w-2.5 h-2.5" /> </>
        )}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN DETAIL COMPONENT
// ═══════════════════════════════════════════════════════════
export function StockDetail({ prediction, isInWatchlist, onToggleWatchlist, onClose, isExpanded, onToggleExpand }: StockDetailProps) {
  const [showChart, setShowChart] = useState(false);
  const { t } = useI18n();
  const isPositive = prediction.priceChangePercent >= 0;
  const currencySymbol = "€";

  const riskColor = prediction.riskLevel > 65 ? "text-red-400" : prediction.riskLevel > 40 ? "text-amber-400" : "text-emerald-400";
  const riskLabel = prediction.riskLevel > 65 ? t("detail.riskLevel.high") : prediction.riskLevel > 40 ? t("detail.riskLevel.medium") : t("detail.riskLevel.low");

  const { finnhub, webSearch, analyst, technical, fearGreed, total } = prediction.sourceBreakdown;

  const formatTimeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return t("detail.justNow");
    if (hours === 1) return `1 ${t("detail.hAgo")}`;
    if (hours < 24) return `${hours} ${t("detail.hAgo")}`;
    const days = Math.floor(hours / 24);
    return `${days} ${t("detail.dAgo")}`;
  };

  return (
    <div className={`p-5 overflow-y-auto max-h-[calc(100vh-6rem)] custom-scrollbar ${
      isExpanded ? "" : "space-y-5"
    }`} data-testid={`detail-${prediction.ticker}`}>
    {isExpanded ? (
      /* ── Expanded two-column layout ── */
      <div className="space-y-5">
        {/* Header row */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">{prediction.ticker}</h2>
              <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                {prediction.exchange}
              </span>
              {prediction.industry !== "N/A" && (
                <span className="text-[10px] text-muted-foreground">{prediction.industry}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{prediction.name}</p>
            {prediction.isin && <IsinBadge isin={prediction.isin} />}
          </div>
          <div className="flex items-center gap-1">
            {onToggleWatchlist && (
              <button
                onClick={onToggleWatchlist}
                className={`p-1 rounded transition-colors ${
                  isInWatchlist
                    ? "text-amber-400 hover:text-amber-300"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title={isInWatchlist ? t("watchlist.remove") : t("watchlist.add")}
              >
                <Star className={`w-4 h-4 ${isInWatchlist ? "fill-current" : ""}`} />
              </button>
            )}
            {onToggleExpand && (
              <button
                onClick={onToggleExpand}
                className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                title={t("detail.collapse")}
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Price row */}
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xl font-semibold tabular-nums">
              {currencySymbol}{prediction.currentPrice.toFixed(2)}
            </p>
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
              {prediction.marketState === "POST" ? t("detail.postMarket")
                : prediction.marketState === "PRE" ? t("detail.preMarket")
                : prediction.marketState === "CLOSED" ? t("detail.marketClosed")
                : t("detail.delayed")}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-sm font-medium tabular-nums ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
              {isPositive ? "+" : ""}{currencySymbol}{prediction.priceChange.toFixed(2)}
            </span>
            <span className={`text-sm tabular-nums ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
              ({isPositive ? "+" : ""}{prediction.priceChangePercent.toFixed(2)}%)
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground tabular-nums">
            <span>O: {currencySymbol}{prediction.openPrice.toFixed(2)}</span>
            <span>H: {currencySymbol}{prediction.dayHigh.toFixed(2)}</span>
            <span>L: {currencySymbol}{prediction.dayLow.toFixed(2)}</span>
            {prediction.bidPrice != null && prediction.askPrice != null && (
              <>
                <span className="text-muted-foreground/40">|</span>
                <span>{t("detail.bid")}: {currencySymbol}{prediction.bidPrice.toFixed(2)}</span>
                <span>{t("detail.ask")}: {currencySymbol}{prediction.askPrice.toFixed(2)}</span>
              </>
            )}
          </div>
        </div>

        {/* Chart — always visible when expanded */}
        <div>
          <PriceChart
            symbol={prediction.ticker}
            currentPrice={prediction.currentPrice}
            currency={prediction.currency}
            chartHeight="h-[400px]"
          />
        </div>

        {/* Two-column grid for remaining content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left column */}
          <div className="space-y-5">
            {/* Risk level */}
            <div className="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-muted/50">
              <Shield className={`w-5 h-5 ${riskColor}`} />
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-sm font-medium ${riskColor}`}>{riskLabel}</span>
                  <span className="text-sm font-semibold tabular-nums">{prediction.riskLevel}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-background overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${prediction.riskLevel}%`,
                      backgroundColor:
                        prediction.riskLevel > 65 ? "hsl(0, 60%, 58%)"
                        : prediction.riskLevel > 40 ? "hsl(43, 70%, 58%)"
                        : "hsl(152, 55%, 48%)",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* 3 Timeframe Signals */}
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                {t("detail.predictionSignals")}
              </h3>
              <div className="space-y-1.5">
                <TimeframeDetail tf={prediction.shortTerm} />
                <TimeframeDetail tf={prediction.mediumTerm} />
                <TimeframeDetail tf={prediction.longTerm} />
              </div>
            </div>

            {/* Confidence chart */}
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                {t("detail.confidenceComparison")}
              </h3>
              <ConfidenceChart prediction={prediction} />
            </div>

            {/* Investment Timing */}
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider flex items-center gap-1.5">
                <Zap className="w-3 h-3" />
                {t("detail.investmentTiming")}
              </h3>
              <InvestmentTiming prediction={prediction} />
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-5">
            {/* Prediction History & Accuracy */}
            <PredictionHistory ticker={prediction.ticker} isInWatchlist={!!isInWatchlist} />

            {/* Sentiment gauge */}
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                {t("detail.aggregatedSentiment")}
              </h3>
              <div className="flex items-center justify-between">
                <SentimentGauge score={prediction.sentimentScore} />
                <div className="text-right">
                  <p className="text-sm font-medium">
                    {prediction.sentimentScore > 0.15 ? t("detail.sentimentPositive") : prediction.sentimentScore < -0.15 ? t("detail.sentimentNegative") : t("detail.sentimentMixed")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("detail.across")} {total} {t("overview.sources")}
                  </p>
                </div>
              </div>
            </div>

            {/* Source breakdown */}
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider flex items-center gap-1.5">
                <Globe className="w-3 h-3" />
                {t("detail.intelligenceSources")} ({total})
              </h3>
              <div className="flex items-center gap-3 mb-3">
                {finnhub > 0 && (
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <Newspaper className="w-3 h-3 text-blue-400" />
                    <span className="text-muted-foreground">{finnhub} {t("detail.finnhub")}</span>
                  </div>
                )}
                {webSearch > 0 && (
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <Search className="w-3 h-3 text-amber-400" />
                    <span className="text-muted-foreground">{webSearch} {t("detail.web")}</span>
                  </div>
                )}
                {analyst > 0 && (
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <Users className="w-3 h-3 text-purple-400" />
                    <span className="text-muted-foreground">{analyst} {t("detail.analyst")}</span>
                  </div>
                )}
                {(technical ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <LineChart className="w-3 h-3 text-cyan-400" />
                    <span className="text-muted-foreground">{technical} {t("detail.technical")}</span>
                  </div>
                )}
                {(fearGreed ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <Zap className="w-3 h-3 text-orange-400" />
                    <span className="text-muted-foreground">{fearGreed} {t("detail.fearGreed")}</span>
                  </div>
                )}
              </div>
              {/* Evidence list */}
              <div className="space-y-1.5">
                {prediction.sources.slice(0, 15).map((source, i) => (
                  <div key={i} className="flex items-start gap-2 py-2 border-b border-border/50 last:border-0">
                    <div className="mt-0.5 flex items-center gap-1">
                      <SourceIcon type={source.sourceType} />
                      <SentimentIcon sentiment={source.sentiment} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs leading-relaxed line-clamp-2">{source.title}</p>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                        <span className="font-medium">{source.name}</span>
                        <span className="flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {formatTimeAgo(source.publishedAt)}
                        </span>
                      </div>
                    </div>
                    {source.url && source.url !== "#" && (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-muted-foreground hover:text-foreground mt-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 text-amber-200/80">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed">{t("detail.disclaimer")}</p>
        </div>

        {/* Last updated */}
        <p className="text-[11px] text-muted-foreground text-center tabular-nums">
          {t("detail.lastUpdated")}: {new Date(prediction.lastUpdated).toLocaleTimeString()}
        </p>
      </div>
    ) : (
      /* ── Normal sidebar layout ── */
      <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{prediction.ticker}</h2>
            <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
              {prediction.exchange}
            </span>
            {prediction.industry !== "N/A" && (
              <span className="text-[10px] text-muted-foreground">{prediction.industry}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{prediction.name}</p>
          {prediction.isin && (
            <IsinBadge isin={prediction.isin} />
          )}
        </div>
        <div className="flex items-center gap-1">
          {onToggleWatchlist && (
            <button
              onClick={onToggleWatchlist}
              className={`p-1 rounded transition-colors ${
                isInWatchlist
                  ? "text-amber-400 hover:text-amber-300"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title={isInWatchlist ? t("watchlist.remove") : t("watchlist.add")}
              data-testid="button-toggle-watchlist-detail"
            >
              <Star className={`w-4 h-4 ${isInWatchlist ? "fill-current" : ""}`} />
            </button>
          )}
          {onToggleExpand && (
            <button
              onClick={onToggleExpand}
              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
              title={isExpanded ? t("detail.collapse") : t("detail.expand")}
              data-testid="button-toggle-expand"
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-close-detail"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Price */}
      <div>
        <div className="flex items-center gap-2">
          <p className="text-xl font-semibold tabular-nums">
            {currencySymbol}{prediction.currentPrice.toFixed(2)}
          </p>
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
            {prediction.marketState === "POST" ? t("detail.postMarket")
              : prediction.marketState === "PRE" ? t("detail.preMarket")
              : prediction.marketState === "CLOSED" ? t("detail.marketClosed")
              : t("detail.delayed")}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-sm font-medium tabular-nums ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
            {isPositive ? "+" : ""}{currencySymbol}{prediction.priceChange.toFixed(2)}
          </span>
          <span className={`text-sm tabular-nums ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
            ({isPositive ? "+" : ""}{prediction.priceChangePercent.toFixed(2)}%)
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground tabular-nums">
          <span>O: {currencySymbol}{prediction.openPrice.toFixed(2)}</span>
          <span>H: {currencySymbol}{prediction.dayHigh.toFixed(2)}</span>
          <span>L: {currencySymbol}{prediction.dayLow.toFixed(2)}</span>
          {prediction.bidPrice != null && prediction.askPrice != null && (
            <>
              <span className="text-muted-foreground/40">|</span>
              <span>{t("detail.bid")}: {currencySymbol}{prediction.bidPrice.toFixed(2)}</span>
              <span>{t("detail.ask")}: {currencySymbol}{prediction.askPrice.toFixed(2)}</span>
            </>
          )}
        </div>
      </div>

      {/* Toggleable Price Chart */}
      <div>
        <button
          onClick={() => setShowChart(!showChart)}
          className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors group"
          data-testid="toggle-chart"
        >
          <div className="flex items-center gap-2">
            <LineChart className="w-4 h-4 text-primary" />
            <span className="text-xs font-medium">{t("detail.priceChart")}</span>
          </div>
          {showChart ? (
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
          )}
        </button>
        {showChart && (
          <div className="mt-3 px-1">
            <PriceChart
              symbol={prediction.ticker}
              currentPrice={prediction.currentPrice}
              currency={prediction.currency}
              chartHeight={isExpanded ? "h-[400px]" : undefined}
            />
          </div>
        )}
      </div>

      {/* Risk level */}
      <div className="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-muted/50">
        <Shield className={`w-5 h-5 ${riskColor}`} />
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className={`text-sm font-medium ${riskColor}`}>{riskLabel}</span>
            <span className="text-sm font-semibold tabular-nums">{prediction.riskLevel}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-background overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${prediction.riskLevel}%`,
                backgroundColor:
                  prediction.riskLevel > 65 ? "hsl(0, 60%, 58%)"
                  : prediction.riskLevel > 40 ? "hsl(43, 70%, 58%)"
                  : "hsl(152, 55%, 48%)",
              }}
            />
          </div>
        </div>
      </div>

      {/* 3 Timeframe Signals */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
          {t("detail.predictionSignals")}
        </h3>
        <div className="space-y-1.5">
          <TimeframeDetail tf={prediction.shortTerm} />
          <TimeframeDetail tf={prediction.mediumTerm} />
          <TimeframeDetail tf={prediction.longTerm} />
        </div>
      </div>

      {/* Confidence chart */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
          {t("detail.confidenceComparison")}
        </h3>
        <ConfidenceChart prediction={prediction} />
      </div>

      {/* Investment Timing */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider flex items-center gap-1.5">
          <Zap className="w-3 h-3" />
          {t("detail.investmentTiming")}
        </h3>
        <InvestmentTiming prediction={prediction} />
      </div>

      {/* Prediction History & Accuracy */}
      <PredictionHistory ticker={prediction.ticker} isInWatchlist={!!isInWatchlist} />

      {/* Sentiment gauge */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
          {t("detail.aggregatedSentiment")}
        </h3>
        <div className="flex items-center justify-between">
          <SentimentGauge score={prediction.sentimentScore} />
          <div className="text-right">
            <p className="text-sm font-medium">
              {prediction.sentimentScore > 0.15 ? t("detail.sentimentPositive") : prediction.sentimentScore < -0.15 ? t("detail.sentimentNegative") : t("detail.sentimentMixed")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("detail.across")} {total} {t("overview.sources")}
            </p>
          </div>
        </div>
      </div>

      {/* Source breakdown */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider flex items-center gap-1.5">
          <Globe className="w-3 h-3" />
          {t("detail.intelligenceSources")} ({total})
        </h3>
        <div className="flex items-center gap-3 mb-3">
          {finnhub > 0 && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <Newspaper className="w-3 h-3 text-blue-400" />
              <span className="text-muted-foreground">{finnhub} {t("detail.finnhub")}</span>
            </div>
          )}
          {webSearch > 0 && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <Search className="w-3 h-3 text-amber-400" />
              <span className="text-muted-foreground">{webSearch} {t("detail.web")}</span>
            </div>
          )}
          {analyst > 0 && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <Users className="w-3 h-3 text-purple-400" />
              <span className="text-muted-foreground">{analyst} {t("detail.analyst")}</span>
            </div>
          )}
          {(technical ?? 0) > 0 && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <LineChart className="w-3 h-3 text-cyan-400" />
              <span className="text-muted-foreground">{technical} {t("detail.technical")}</span>
            </div>
          )}
          {(fearGreed ?? 0) > 0 && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <Zap className="w-3 h-3 text-orange-400" />
              <span className="text-muted-foreground">{fearGreed} {t("detail.fearGreed")}</span>
            </div>
          )}
        </div>

        {/* Evidence list */}
        <div className="space-y-1.5">
          {prediction.sources.slice(0, 15).map((source, i) => (
            <div
              key={i}
              className="flex items-start gap-2 py-2 border-b border-border/50 last:border-0"
            >
              <div className="mt-0.5 flex items-center gap-1">
                <SourceIcon type={source.sourceType} />
                <SentimentIcon sentiment={source.sentiment} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs leading-relaxed line-clamp-2">{source.title}</p>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                  <span className="font-medium">{source.name}</span>
                  <span className="flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" />
                    {formatTimeAgo(source.publishedAt)}
                  </span>
                </div>
              </div>
              {source.url && source.url !== "#" && (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-foreground mt-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Disclaimer */}
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 text-amber-200/80">
        <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
        <p className="text-[11px] leading-relaxed">
          {t("detail.disclaimer")}
        </p>
      </div>

      {/* Last updated */}
      <p className="text-[11px] text-muted-foreground text-center tabular-nums">
        {t("detail.lastUpdated")}: {new Date(prediction.lastUpdated).toLocaleTimeString()}
      </p>
      </div>
    )}
    </div>
  );
}
