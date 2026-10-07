import type { Pair, Timeframe } from "@/lib/data/universe";

// Phase 3 SMC (Smart Money Concepts) types.
// Pure data shapes — no LLM, no I/O. All overlays on /pair/[symbol] come from these.

/** Candle shape at the SMC edge: ISO openTime + decimal strings (Phase 1 DTO form). */
export type SmcCandleInput = {
  openTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
};

/** Parsed numeric candle, oldest → newest. */
export type NumericCandle = {
  time: string; // ISO UTC (original openTime)
  epoch: number; // seconds since epoch (for lightweight-charts UTCTimestamp)
  open: number;
  high: number;
  low: number;
  close: number;
  index: number; // position in the parsed array
};

export type SwingType = "high" | "low";

export type Swing = {
  index: number;
  time: string;
  epoch: number;
  price: number;
  type: SwingType;
};

export type StructureDirection = "bullish" | "bearish";

/** A BOS or CHOCH break: close beyond a confirmed swing level. */
export type BreakEvent = {
  index: number;
  time: string;
  epoch: number;
  direction: StructureDirection;
  brokenLevel: number;
};

export type ZoneDirection = "bullish" | "bearish";

export type FairValueGap = {
  index: number;
  time: string;
  epoch: number;
  low: number;
  high: number;
  direction: ZoneDirection;
  mitigated: boolean;
};

export type OrderBlock = {
  index: number;
  time: string;
  epoch: number;
  low: number;
  high: number;
  direction: ZoneDirection;
  kind: "demand" | "supply";
  mitigated: boolean;
};

export type LiquiditySide = "eqh" | "eql" | "highs" | "lows";

export type LiquidityLevel = {
  time: string;
  epoch: number;
  price: number;
  side: LiquiditySide;
  note: string;
};

/** Last confirmed swing range. Premium = upper half, discount = lower half. */
export type SmcRange = {
  high: number;
  low: number;
  midpoint: number;
  premiumMax: number;
  discountMin: number;
};

export type HtfBias = "bullish" | "bearish" | "range";

export type SmcSnapshot = {
  symbol: Pair;
  timeframe: Timeframe;
  asOf: string; // ISO UTC when computed
  candleCount: number;
  swings: Swing[];
  bos: BreakEvent[];
  choch: BreakEvent[];
  fvgs: FairValueGap[];
  orderBlocks: OrderBlock[];
  liquidity: LiquidityLevel[];
  range: SmcRange | null;
  htfBias: HtfBias; // from last BOS/CHOCH only — never from news
};

export type SetupGrade = "A" | "B";
export type SetupSide = "long" | "short";

export type Setup = {
  grade: SetupGrade;
  side: SetupSide;
  entryZone: { low: number; high: number };
  invalidation: number;
  targetHint: string;
  why: string[];
};

export type Alignment = "ALIGNED" | "MIXED" | "DO_NOT_TRADE";
