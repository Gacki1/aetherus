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
} from "lucide-react";

interface AccuracyData {
  totalPredictions: number;
  shortTerm: { total: number; correct: number; accuracy: number | null };
  mediumTerm: { total: number; correct: number; accuracy: number | null };
  longTerm: { total: number; correct: number; accuracy: number | null };
  recentPredictions: Array<{
    ticker: string;
    name: string;
    date: string;
    priceAtPrediction: number;
    shortTerm: { signal: string; confidence: number };
    mediumTerm: { signal: string; confidence: number };
    longTerm: { signal: string; confidence: number };
    actualPriceShort?: number;
    actualPriceMedium?: number;
    actualPriceLong?: number;
  }>;
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

interface PredictionHistoryProps {
  ticker: string;
  isInWatchlist: boolean;
}

// Read Aetherus user from URL for per-user prediction history
const _stoxviewUser = (() => {
  try {
    return new URLSearchParams(window.location.search).get("user") || "_default";
  } catch { return "_default"; }
})();

export function PredictionHistory({ ticker, isInWatchlist }: PredictionHistoryProps) {
  const { t } = useI18n();

  const { data: accuracy } = useQuery<AccuracyData>({
    queryKey: ["/api/prediction-accuracy", ticker, _stoxviewUser],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/prediction-accuracy?ticker=${ticker}&user=${encodeURIComponent(_stoxviewUser)}`);
      return res.json();
    },
    enabled: isInWatchlist,
    refetchInterval: 300000, // 5 min
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

  return (
    <div className="space-y-3">
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
              <div
                key={`${entry.date}-${i}`}
                className="flex items-center justify-between py-1.5 px-2 rounded bg-muted/30 text-[11px]"
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
                  <div className="flex items-center gap-1" title="Short">
                    <SignalDot signal={entry.shortTerm.signal} />
                    <ResultBadge
                      signal={entry.shortTerm.signal}
                      priceAtPrediction={entry.priceAtPrediction}
                      actualPrice={entry.actualPriceShort}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
