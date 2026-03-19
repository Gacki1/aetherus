import { TrendingUp, TrendingDown, Minus, Shield, BarChart3, Globe } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

interface MarketSummary {
  totalStocks: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  averageRisk: number;
  averageSentiment: number;
  topGainers: { ticker: string; change: number }[];
  topLosers: { ticker: string; change: number }[];
  totalSources: number;
  lastUpdated: string;
}

export function MarketOverview({ summary }: { summary: MarketSummary }) {
  const { t } = useI18n();
  const sentimentLabel = summary.averageSentiment > 0.1 ? t("sentiment.bullish") : summary.averageSentiment < -0.1 ? t("sentiment.bearish") : t("sentiment.mixed");
  const sentimentColor = summary.averageSentiment > 0.1 ? "text-emerald-400" : summary.averageSentiment < -0.1 ? "text-red-400" : "text-muted-foreground";

  // Determine how many columns to show (browse has less data)
  const hasRiskData = summary.averageRisk > 0;
  const hasSourceData = summary.totalSources > 0;
  const colCount = 2 + (hasRiskData ? 1 : 0) + (hasSourceData ? 1 : 0);
  const gridCols = colCount === 4 ? "grid-cols-2 sm:grid-cols-4" : colCount === 3 ? "grid-cols-3" : "grid-cols-2";

  return (
    <div className={`grid ${gridCols} gap-3`} data-testid="market-overview">
      {/* Signals breakdown */}
      <Card className="p-3.5">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-medium">{t("overview.signals")}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-sm font-semibold tabular-nums">{summary.bullishCount}</span>
          </div>
          <div className="flex items-center gap-1">
            <TrendingDown className="w-3.5 h-3.5 text-red-400" />
            <span className="text-sm font-semibold tabular-nums">{summary.bearishCount}</span>
          </div>
          <div className="flex items-center gap-1">
            <Minus className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm font-semibold tabular-nums">{summary.neutralCount}</span>
          </div>
        </div>
      </Card>

      {/* Market sentiment */}
      <Card className="p-3.5">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-medium">{t("overview.sentiment")}</span>
        </div>
        <p className={`text-sm font-semibold ${sentimentColor}`}>{sentimentLabel}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {t("overview.score")}: {summary.averageSentiment > 0 ? "+" : ""}{summary.averageSentiment.toFixed(2)}
        </p>
      </Card>

      {/* Avg risk — only show when data is available */}
      {hasRiskData && (
        <Card className="p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-medium">{t("overview.avgRisk")}</span>
          </div>
          <p className="text-sm font-semibold tabular-nums">{summary.averageRisk}%</p>
          <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${summary.averageRisk}%`,
                backgroundColor: summary.averageRisk > 60 ? "hsl(0, 65%, 50%)" : summary.averageRisk > 35 ? "hsl(43, 74%, 49%)" : "hsl(152, 60%, 38%)",
              }}
            />
          </div>
        </Card>
      )}

      {/* Sources + top movers — show sources count when available, always show top movers */}
      <Card className="p-3.5">
        <div className="flex items-center gap-2 mb-2">
          <Globe className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-medium">
            {hasSourceData ? t("overview.intelligence") : t("overview.topMovers")}
          </span>
        </div>
        {hasSourceData && (
          <p className="text-sm font-semibold tabular-nums">{summary.totalSources} {t("overview.sources")}</p>
        )}
        <div className={`space-y-0.5 ${hasSourceData ? "mt-1" : ""}`}>
          {summary.topGainers.slice(0, 1).map((g) => (
            <div key={g.ticker} className="flex items-center justify-between">
              <span className="text-[11px] font-medium">{g.ticker}</span>
              <span className="text-[11px] text-emerald-400 tabular-nums">+{g.change.toFixed(2)}%</span>
            </div>
          ))}
          {summary.topLosers.slice(0, 1).map((l) => (
            <div key={l.ticker} className="flex items-center justify-between">
              <span className="text-[11px] font-medium">{l.ticker}</span>
              <span className="text-[11px] text-red-400 tabular-nums">{l.change.toFixed(2)}%</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
