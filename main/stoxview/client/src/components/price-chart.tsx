import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { Loader2, TrendingUp, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface PriceChartProps {
  symbol: string;
  currentPrice: number;
  currency: string;
  chartHeight?: string;
}

type Range = "1mo" | "3mo" | "6mo" | "1y";

const _chartUser = (() => {
  try {
    const p = new URLSearchParams(window.location.search);
    return p.get("uid") || p.get("user") || "_default";
  } catch { return "_default"; }
})();

interface ChartPoint {
  date: string;
  close: number;
  projected?: number;
}

export function PriceChart({ symbol, currentPrice, currency, chartHeight }: PriceChartProps) {
  const [range, setRange] = useState<Range>("3mo");
  const { t } = useI18n();
  const currencySymbol = "€";

  const { data, isLoading, isError } = useQuery<{
    historical: { date: string; close: number }[];
    projection: { date: string; close: number }[];
  }>({
    queryKey: ["/api/history", symbol, range],
    queryFn: async () => {
      const { apiRequest } = await import("@/lib/queryClient");
      const res = await apiRequest("GET", `/api/history/${symbol}?range=${range}&user=${encodeURIComponent(_chartUser)}`);
      return res.json();
    },
    staleTime: 300000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        <span className="text-xs">{t("chart.loading")}</span>
      </div>
    );
  }

  if (isError || !data || !data.historical.length) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-xs">
        {t("chart.unavailable")}
      </div>
    );
  }

  // Server generates projection scaled to the selected range, use it directly
  // Merge historical + projection into single dataset
  const chartData: ChartPoint[] = [];

  // Historical points
  for (const h of data.historical) {
    chartData.push({ date: h.date, close: h.close });
  }

  // Last historical point is also the start of projection
  const lastHistorical = data.historical[data.historical.length - 1];

  // Projection points (with both close from last known + projected)
  if (data.projection.length > 0) {
    // Bridge point: last historical also has projected value
    chartData[chartData.length - 1] = {
      ...chartData[chartData.length - 1],
      projected: lastHistorical.close,
    };

    for (const p of data.projection) {
      chartData.push({ date: p.date, close: undefined as any, projected: p.close });
    }
  }

  // Calculate domain
  const allPrices = [
    ...data.historical.map((h) => h.close),
    ...data.projection.map((p) => p.close),
  ];
  const minPrice = Math.min(...allPrices) * 0.98;
  const maxPrice = Math.max(...allPrices) * 1.02;

  // Format date for x-axis
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload as ChartPoint;
    const isProjected = point.projected != null && point.close == null;
    const price = isProjected ? point.projected : point.close;

    return (
      <div className="bg-card border border-border rounded-md px-3 py-2 shadow-lg">
        <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
        <p className="text-xs font-semibold tabular-nums">
          {currencySymbol}{price?.toFixed(2)}
        </p>
        {isProjected && (
          <p className="text-[10px] text-amber-400 mt-0.5 flex items-center gap-1">
            <TrendingUp className="w-2.5 h-2.5" />
            {t("chart.projected")}
          </p>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Range selector */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          {(["1mo", "3mo", "6mo", "1y"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                range === r
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`chart-range-${r}`}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 rounded bg-[hsl(210,55%,55%)]" />
            {t("chart.historical")}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 rounded bg-amber-400 opacity-60" style={{ borderBottom: "1px dashed" }} />
            {t("chart.projected")}
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className={chartHeight || "h-44"}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="historicalGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(210, 55%, 55%)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="hsl(210, 55%, 55%)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="projectedGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(43, 70%, 58%)" stopOpacity={0.15} />
                <stop offset="100%" stopColor="hsl(43, 70%, 58%)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              opacity={0.3}
            />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis
              domain={[minPrice, maxPrice]}
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(v: number) => `${currencySymbol}${v.toFixed(0)}`}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine
              y={currentPrice}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="2 4"
              strokeOpacity={0.4}
            />
            {/* Historical area */}
            <Area
              type="monotone"
              dataKey="close"
              stroke="hsl(210, 55%, 55%)"
              strokeWidth={1.5}
              fill="url(#historicalGrad)"
              connectNulls={false}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0, fill: "hsl(210, 55%, 55%)" }}
            />
            {/* Projected area */}
            <Area
              type="monotone"
              dataKey="projected"
              stroke="hsl(43, 70%, 58%)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              fill="url(#projectedGrad)"
              connectNulls={false}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0, fill: "hsl(43, 70%, 58%)" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Projection disclaimer */}
      <div className="flex items-start gap-1.5 mt-2 text-[10px] text-amber-400/70">
        <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
        <span>{t("chart.projectionDisclaimer")}</span>
      </div>
    </div>
  );
}
