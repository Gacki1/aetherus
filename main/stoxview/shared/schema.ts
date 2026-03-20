import { z } from "zod";

// --- News source types ---
export const newsSourceSchema = z.object({
  name: z.string(),
  url: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  sentiment: z.enum(["positive", "negative", "neutral"]),
  sentimentScore: z.number().min(-1).max(1),
  publishedAt: z.string(),
  sourceType: z.enum(["finnhub", "web-search", "analyst", "technical", "fear-greed"]),
});

export type NewsSource = z.infer<typeof newsSourceSchema>;

// --- Timeframe prediction ---
export const timeframePredictionSchema = z.object({
  signal: z.enum(["bullish", "bearish", "neutral"]),
  confidence: z.number().min(0).max(100),
  estimatedMove: z.number().optional(), // Estimated price change in % (e.g., +3.2 or -1.5)
  label: z.string(),
  range: z.string(),
});

export type TimeframePrediction = z.infer<typeof timeframePredictionSchema>;

// --- Full stock prediction (V3 multi-source) ---
export const stockPredictionSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  exchange: z.string(),
  country: z.string(),
  industry: z.string(),
  logo: z.string().optional(),
  currentPrice: z.number(),
  previousClose: z.number(),
  dayHigh: z.number(),
  dayLow: z.number(),
  openPrice: z.number(),
  priceChange: z.number(),
  priceChangePercent: z.number(),
  currency: z.string(),
  // Three timeframes
  shortTerm: timeframePredictionSchema,
  mediumTerm: timeframePredictionSchema,
  longTerm: timeframePredictionSchema,
  // Risk & sentiment
  riskLevel: z.number().min(0).max(100),
  sentimentScore: z.number().min(-1).max(1),
  // Multi-source evidence
  sources: z.array(newsSourceSchema),
  sourceBreakdown: z.object({
    finnhub: z.number(),
    webSearch: z.number(),
    analyst: z.number(),
    technical: z.number().optional(),
    fearGreed: z.number().optional(),
    total: z.number(),
  }),
  // Identifiers
  isin: z.string().optional(),
  // Market state & bid/ask
  marketState: z.enum(["REGULAR", "PRE", "POST", "PREPRE", "POSTPOST", "CLOSED"]).optional(),
  bidPrice: z.number().optional(),
  askPrice: z.number().optional(),
  // Metadata
  lastUpdated: z.string(),
});

export type StockPrediction = z.infer<typeof stockPredictionSchema>;

// --- Search result ---
export const searchResultSchema = z.object({
  symbol: z.string(),
  displaySymbol: z.string(),
  description: z.string(),
  type: z.string(),
});

export type SearchResult = z.infer<typeof searchResultSchema>;

// --- Watchlist item ---
export interface WatchlistItem {
  symbol: string;
  name: string;
  addedAt: string;
}

// --- Browse stock (lightweight, no prediction) ---
export interface BrowseStock {
  symbol: string;
  name: string;
  shortName: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  exchange: string;
  market: "US" | "DE";
  marketCap: number;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
}

// Unused but required by template
import { sql } from "drizzle-orm";
import { pgTable, text, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
