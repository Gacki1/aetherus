import type { StockPrediction, TimeframePrediction } from "@shared/schema";
import { Card } from "@/components/ui/card";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Shield,
  ChevronRight,
  Globe,
  Star,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface StockCardProps {
  prediction: StockPrediction;
  isSelected: boolean;
  isInWatchlist: boolean;
  onToggleWatchlist: () => void;
  onClick: () => void;
}

function SignalBadge({ signal, confidence }: { signal: string; confidence: number }) {
  const config = {
    bullish: { bg: "bg-emerald-500/15", text: "text-emerald-400", icon: TrendingUp, label: "Bull" },
    bearish: { bg: "bg-red-500/15", text: "text-red-400", icon: TrendingDown, label: "Bear" },
    neutral: { bg: "bg-zinc-500/15", text: "text-zinc-400", icon: Minus, label: "Hold" },
  }[signal] || { bg: "bg-zinc-500/15", text: "text-zinc-400", icon: Minus, label: "Hold" };

  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${config.bg} ${config.text}`}>
      <Icon className="w-2.5 h-2.5" />
      {signal === "bearish" ? `-${confidence}%` : signal === "bullish" ? `+${confidence}%` : "~0%"}
    </span>
  );
}

function RiskBar({ level }: { level: number }) {
  const { t } = useI18n();
  const color = level > 65 ? "bg-red-400" : level > 40 ? "bg-amber-400" : "bg-emerald-400";
  const label = level > 65 ? t("card.risk.high") : level > 40 ? t("card.risk.med") : t("card.risk.low");

  return (
    <div className="flex items-center gap-2">
      <Shield className="w-3 h-3 text-muted-foreground shrink-0" />
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${level}%` }}
        />
      </div>
      <span className="text-[11px] text-muted-foreground tabular-nums w-14 text-right">
        {label} {level}%
      </span>
    </div>
  );
}

function TimeframeRow({ tf }: { tf: TimeframePrediction }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-muted-foreground">{tf.label}</span>
      <SignalBadge signal={tf.signal} confidence={tf.confidence} />
    </div>
  );
}

export function StockCard({ prediction, isSelected, isInWatchlist, onToggleWatchlist, onClick }: StockCardProps) {
  const { t } = useI18n();
  const isPositive = prediction.priceChangePercent >= 0;
  const currencySymbol = "€";

  return (
    <Card
      className={`p-4 cursor-pointer transition-all duration-200 hover-elevate ${
        isSelected ? "ring-1 ring-primary" : ""
      }`}
      onClick={onClick}
      data-testid={`card-stock-${prediction.ticker}`}
    >
      {/* Top row: ticker + watchlist star + price */}
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{prediction.ticker}</span>
            <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
              {prediction.exchange}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleWatchlist();
              }}
              className={`p-0.5 rounded transition-colors ${
                isInWatchlist
                  ? "text-amber-400 hover:text-amber-300"
                  : "text-muted-foreground/40 hover:text-amber-400"
              }`}
              title={isInWatchlist ? t("watchlist.remove") : t("watchlist.add")}
              data-testid={`watchlist-star-${prediction.ticker}`}
            >
              <Star className={`w-3.5 h-3.5 ${isInWatchlist ? "fill-current" : ""}`} />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-tight truncate">
            {prediction.name}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold tabular-nums">
            {currencySymbol}{prediction.currentPrice.toFixed(2)}
          </p>
          <p className={`text-xs font-medium tabular-nums ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
            {isPositive ? "+" : ""}{prediction.priceChangePercent.toFixed(2)}%
          </p>
        </div>
      </div>

      {/* Three timeframe signals */}
      <div className="space-y-1.5 mb-3">
        <TimeframeRow tf={prediction.shortTerm} />
        <TimeframeRow tf={prediction.mediumTerm} />
        <TimeframeRow tf={prediction.longTerm} />
      </div>

      {/* Risk bar */}
      <RiskBar level={prediction.riskLevel} />

      {/* Bottom: source count + expand hint */}
      <div className="flex items-center justify-between mt-2.5 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <Globe className="w-3 h-3" />
          <span>{prediction.sourceBreakdown.total} {t("card.sources")}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <span>{t("card.details")}</span>
          <ChevronRight className="w-3 h-3" />
        </div>
      </div>
    </Card>
  );
}
