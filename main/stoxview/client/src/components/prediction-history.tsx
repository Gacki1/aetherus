import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useI18n } from "@/lib/i18n";
import {
  History,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  XCircle,
  Clock,
  Target,
  Info,
  ChevronDown,
  ChevronUp,
  Brain,
  Sparkles,
} from "lucide-react";

interface SourceSignals {
  webSentiment: number;
  analystRating: number;
  finnhubSentiment: number;
  technicalSignal: number;
  fearGreedSignal: number;
  momentum: number;
}

interface PredictionEntry {
  ticker: string;
  name: string;
  date: string;
  priceAtPrediction: number;
  shortTerm: { signal: string; confidence: number; estimatedMove?: number };
  mediumTerm: { signal: string; confidence: number; estimatedMove?: number };
  longTerm: { signal: string; confidence: number; estimatedMove?: number };
  sentimentScore: number;
  riskLevel: number;
  actualPriceShort?: number;
  actualPriceMedium?: number;
  actualPriceLong?: number;
  sourceSignals?: SourceSignals;
}

interface AccuracyData {
  totalPredictions: number;
  shortTerm: { total: number; correct: number; accuracy: number | null };
  mediumTerm: { total: number; correct: number; accuracy: number | null };
  longTerm: { total: number; correct: number; accuracy: number | null };
  recentPredictions: PredictionEntry[];
}

interface LearningStats {
  defaults: Record<string, number>;
  effective: Record<string, number>;
  isAdaptive: boolean;
  adaptiveSource: string;
  evaluatedCount: number;
  global: { weights: Record<string, number>; adjustments: Record<string, number>; evaluatedCount: number; lastUpdated: string } | null;
  perStock: { weights: Record<string, number>; adjustments: Record<string, number>; evaluatedCount: number; lastUpdated: string } | null;
}

function AccuracyRing({ accuracy, label }: { accuracy: number | null; label: string }) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const pct = accuracy ?? 0;
  const offset = circumference - (pct / 100) * circumference;

  const color =
    accuracy === null ? "text-muted-foreground/30"
    : pct >= 65 ? "text-emerald-400"
    : pct >= 45 ? "text-amber-400"
    : "text-red-400";

  const strokeColor =
    accuracy === null ? "hsl(var(--muted))"
    : pct >= 65 ? "hsl(152, 55%, 48%)"
    : pct >= 45 ? "hsl(43, 70%, 58%)"
    : "hsl(0, 60%, 58%)";

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-14 h-14">
        <svg viewBox="0 0 48 48" className="w-full h-full -rotate-90">
          <circle
            cx="24" cy="24" r={radius}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth="4"
          />
          <circle
            cx="24" cy="24" r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-xs font-semibold tabular-nums ${color}`}>
            {accuracy !== null ? `${Math.round(pct)}%` : "—"}
          </span>
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
    </div>
  );
}

function SignalDot({ signal }: { signal: string }) {
  if (signal === "bullish") return <TrendingUp className="w-3 h-3 text-emerald-400" />;
  if (signal === "bearish") return <TrendingDown className="w-3 h-3 text-red-400" />;
  return <Minus className="w-3 h-3 text-zinc-400" />;
}

function ResultBadge({ signal, priceAtPrediction, actualPrice }: {
  signal: string;
  priceAtPrediction: number;
  actualPrice: number | undefined;
}) {
  const { t } = useI18n();

  if (actualPrice === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60">
        <Clock className="w-2.5 h-2.5" />
        {t("history.pending")}
      </span>
    );
  }

  const priceWentUp = actualPrice > priceAtPrediction;
  const priceWentDown = actualPrice < priceAtPrediction;
  const isCorrect =
    (signal === "bullish" && priceWentUp) ||
    (signal === "bearish" && priceWentDown) ||
    (signal === "neutral" && Math.abs(actualPrice - priceAtPrediction) / priceAtPrediction < 0.03);

  if (isCorrect) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400 font-medium">
        <CheckCircle2 className="w-2.5 h-2.5" />
        {t("history.hit")}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-red-400 font-medium">
      <XCircle className="w-2.5 h-2.5" />
      {t("history.miss")}
    </span>
  );
}

/** Small colored bar for a source signal value (-1 to +1) */
function SignalBar({ value, label }: { value: number; label: string }) {
  const pct = Math.abs(value) * 100;
  const isPositive = value >= 0;
  const barColor = isPositive ? "bg-emerald-500/70" : "bg-red-500/70";
  const textColor = Math.abs(value) < 0.02 ? "text-zinc-500" : isPositive ? "text-emerald-400" : "text-red-400";

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-20 shrink-0 text-right">{label}</span>
      <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden relative">
        {/* Center marker */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-600/50" />
        {isPositive ? (
          <div
            className={`absolute left-1/2 top-0 bottom-0 rounded-r-full ${barColor}`}
            style={{ width: `${pct / 2}%` }}
          />
        ) : (
          <div
            className={`absolute right-1/2 top-0 bottom-0 rounded-l-full ${barColor}`}
            style={{ width: `${pct / 2}%` }}
          />
        )}
      </div>
      <span className={`text-[10px] font-mono tabular-nums w-10 ${textColor}`}>
        {value > 0 ? "+" : ""}{value.toFixed(2)}
      </span>
    </div>
  );
}

/** Expandable row showing a single prediction entry */
function PredictionRow({ entry }: { entry: PredictionEntry }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const hasSourceSignals = !!entry.sourceSignals;
  const hasSomeResult = entry.actualPriceShort !== undefined || entry.actualPriceMedium !== undefined || entry.actualPriceLong !== undefined;

  return (
    <div className="rounded bg-muted/30 overflow-hidden">
      {/* Main row */}
      <button
        onClick={() => hasSourceSignals && setExpanded(!expanded)}
        className={`w-full flex items-center justify-between py-1.5 px-2 text-[11px] ${
          hasSourceSignals ? "cursor-pointer hover:bg-muted/50" : "cursor-default"
        } transition-colors`}
      >
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground tabular-nums w-16">
            {new Date(entry.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
          <span className="text-muted-foreground tabular-nums">
            €{entry.priceAtPrediction.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Signals */}
          <div className="flex items-center gap-1" title="ST">
            <SignalDot signal={entry.shortTerm.signal} />
            {hasSomeResult && (
              <ResultBadge
                signal={entry.shortTerm.signal}
                priceAtPrediction={entry.priceAtPrediction}
                actualPrice={entry.actualPriceShort}
              />
            )}
          </div>
          {/* Expand icon */}
          {hasSourceSignals && (
            expanded
              ? <ChevronUp className="w-3 h-3 text-muted-foreground/50" />
              : <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
          )}
        </div>
      </button>

      {/* Expanded detail: source signals */}
      {expanded && entry.sourceSignals && (
        <div className="px-3 pb-2 pt-1 border-t border-border/30 space-y-1">
          <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <Sparkles className="w-2.5 h-2.5" />
            {t("history.sourceSignals")}
          </div>
          <SignalBar value={entry.sourceSignals.webSentiment} label={t("learning.webSentiment")} />
          <SignalBar value={entry.sourceSignals.analystRating} label={t("learning.analystRating")} />
          <SignalBar value={entry.sourceSignals.finnhubSentiment} label={t("learning.finnhubSentiment")} />
          <SignalBar value={entry.sourceSignals.technicalSignal} label={t("learning.technicalSignal")} />
          <SignalBar value={entry.sourceSignals.fearGreedSignal} label={t("learning.fearGreedSignal")} />
          <SignalBar value={entry.sourceSignals.momentum} label={t("history.momentum")} />

          {/* Show all 3 timeframe signals + results */}
          <div className="mt-2 pt-1.5 border-t border-border/20 flex items-center justify-around">
            {[
              { tf: entry.shortTerm, actual: entry.actualPriceShort, label: "ST" },
              { tf: entry.mediumTerm, actual: entry.actualPriceMedium, label: "MT" },
              { tf: entry.longTerm, actual: entry.actualPriceLong, label: "LT" },
            ].map(({ tf, actual, label }) => (
              <div key={label} className="flex flex-col items-center gap-0.5">
                <span className="text-[9px] text-muted-foreground/50">{label}</span>
                <div className="flex items-center gap-1">
                  <SignalDot signal={tf.signal} />
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {tf.signal === "neutral" ? "~0%" : `${tf.signal === "bearish" ? "-" : "+"}${tf.confidence}%`}
                  </span>
                </div>
                {tf.estimatedMove != null && tf.signal !== "neutral" && (
                  <span className={`text-[9px] tabular-nums font-medium ${
                    tf.estimatedMove >= 0 ? "text-emerald-400/70" : "text-red-400/70"
                  }`}>
                    {tf.estimatedMove >= 0 ? "+" : ""}{tf.estimatedMove.toFixed(1)}%
                  </span>
                )}
                <ResultBadge signal={tf.signal} priceAtPrediction={entry.priceAtPrediction} actualPrice={actual} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Weight comparison bar for the learning stats section */
function WeightBar({ label, defaultVal, learnedVal }: { label: string; defaultVal: number; learnedVal: number }) {
  const diff = learnedVal - defaultVal;
  const diffColor = Math.abs(diff) < 0.005 ? "text-zinc-500" : diff > 0 ? "text-emerald-400" : "text-red-400";

  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="text-muted-foreground w-20 shrink-0 text-right">{label}</span>
      <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden">
        <div
          className="h-full bg-cyan-500/60 rounded-full transition-all"
          style={{ width: `${learnedVal * 100}%` }}
        />
      </div>
      <span className="tabular-nums text-muted-foreground w-8 text-right">
        {Math.round(learnedVal * 100)}%
      </span>
      <span className={`tabular-nums w-10 text-right ${diffColor}`}>
        {diff > 0 ? "+" : ""}{Math.round(diff * 100)}
      </span>
    </div>
  );
}

interface PredictionHistoryProps {
  ticker: string;
  isInWatchlist: boolean;
}

// Read Aetherus user from URL for per-user prediction history
const _stoxviewUser = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("uid") || params.get("user") || "_default";
  } catch { return "_default"; }
})();

export function PredictionHistory({ ticker, isInWatchlist }: PredictionHistoryProps) {
  const { t } = useI18n();
  const [showWeights, setShowWeights] = useState(false);

  const { data: accuracy } = useQuery<AccuracyData>({
    queryKey: ["/api/prediction-accuracy", ticker, _stoxviewUser],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/prediction-accuracy?ticker=${ticker}&user=${encodeURIComponent(_stoxviewUser)}`);
      return res.json();
    },
    enabled: isInWatchlist,
    refetchInterval: 300000, // 5 min
  });

  const { data: learningStats } = useQuery<LearningStats>({
    queryKey: ["/api/learning-stats", ticker, _stoxviewUser],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/learning-stats?ticker=${ticker}&user=${encodeURIComponent(_stoxviewUser)}`);
      return res.json();
    },
    enabled: isInWatchlist,
    refetchInterval: 300000,
  });

  if (!isInWatchlist) {
    return (
      <div className="rounded-lg border border-border/50 p-3">
        <div className="flex items-center gap-2 mb-2">
          <History className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("history.title")}
          </span>
        </div>
        <div className="flex items-start gap-1.5">
          <Info className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t("history.watchlistOnly")}
          </p>
        </div>
      </div>
    );
  }

  if (!accuracy || accuracy.totalPredictions === 0) {
    return (
      <div className="rounded-lg border border-border/50 p-3">
        <div className="flex items-center gap-2 mb-2">
          <History className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("history.title")}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t("history.noData")}</p>
        <p className="text-[11px] text-muted-foreground/70 mt-1">{t("history.noDataHint")}</p>
      </div>
    );
  }

  const sourceKeys = ["webSentiment", "analystRating", "finnhubSentiment", "technicalSignal", "fearGreedSignal"] as const;
  const sourceLabelKeys: Record<string, string> = {
    webSentiment: "learning.webSentiment",
    analystRating: "learning.analystRating",
    finnhubSentiment: "learning.finnhubSentiment",
    technicalSignal: "learning.technicalSignal",
    fearGreedSignal: "learning.fearGreedSignal",
  };

  return (
    <div className="space-y-3">
      {/* Adaptive Learning Badge */}
      {learningStats?.isAdaptive && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-cyan-500/8 border border-cyan-500/20">
          <Brain className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-[11px] font-medium text-cyan-400">{t("learning.badge")}</span>
            <span className="text-[10px] text-muted-foreground ml-1.5">
              {learningStats.adaptiveSource === "per-stock"
                ? t("learning.badgePerStock")
                : t("learning.badgeGlobal")}
              {" · "}{learningStats.evaluatedCount} {t("learning.evaluatedCount")}
            </span>
          </div>
          <button
            onClick={() => setShowWeights(!showWeights)}
            className="text-[10px] text-cyan-400/70 hover:text-cyan-400 transition-colors"
          >
            {showWeights ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      )}

      {/* Weight Comparison (expandable) */}
      {showWeights && learningStats && (
        <div className="px-2 space-y-1">
          <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <Target className="w-2.5 h-2.5" />
            {t("learning.weights")}
          </div>
          {sourceKeys.map(key => (
            <WeightBar
              key={key}
              label={t(sourceLabelKeys[key] as any)}
              defaultVal={learningStats.defaults[key]}
              learnedVal={learningStats.effective[key]}
            />
          ))}
        </div>
      )}

      {/* Not adaptive yet hint */}
      {learningStats && !learningStats.isAdaptive && accuracy.totalPredictions > 0 && (
        <div className="flex items-start gap-1.5 px-2">
          <Brain className="w-3 h-3 text-muted-foreground/40 shrink-0 mt-0.5" />
          <p className="text-[10px] text-muted-foreground/50 leading-relaxed">
            {t("learning.notEnoughData")}
          </p>
        </div>
      )}

      {/* Accuracy Rings */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-1.5">
          <Target className="w-3 h-3" />
          {t("history.accuracy")}
        </h3>
        <div className="flex items-center justify-around py-2">
          <AccuracyRing accuracy={accuracy.shortTerm.accuracy} label={t("filter.timeframe.short")} />
          <AccuracyRing accuracy={accuracy.mediumTerm.accuracy} label={t("filter.timeframe.medium")} />
          <AccuracyRing accuracy={accuracy.longTerm.accuracy} label={t("filter.timeframe.long")} />
        </div>
        <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-muted-foreground">
          {accuracy.shortTerm.total > 0 && (
            <span>{accuracy.shortTerm.correct}/{accuracy.shortTerm.total} {t("history.correct")}</span>
          )}
          {accuracy.mediumTerm.total > 0 && (
            <span>{accuracy.mediumTerm.correct}/{accuracy.mediumTerm.total} {t("history.correct")}</span>
          )}
          {accuracy.longTerm.total > 0 && (
            <span>{accuracy.longTerm.correct}/{accuracy.longTerm.total} {t("history.correct")}</span>
          )}
        </div>
        <p className="text-[10px] text-center text-muted-foreground/60 mt-1.5">
          {accuracy.totalPredictions} {t("history.predictions")}
        </p>
      </div>

      {/* Recent Predictions Table */}
      {accuracy.recentPredictions.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider flex items-center gap-1.5">
            <History className="w-3 h-3" />
            {t("history.recentPredictions")}
          </h3>
          <div className="space-y-1">
            {accuracy.recentPredictions.map((entry, i) => (
              <PredictionRow key={`${entry.date}-${i}`} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
