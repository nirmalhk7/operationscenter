import {
  Bar,
  IndicatorSet,
  PositionSnapshot,
  SignalDecision,
  StrategySignal,
  TradableSymbol,
  TradeIntent,
  TradingConfig,
  WatchlistSymbol,
  isTradableSymbol,
  normalizeSymbol,
} from "./contracts.js";

const TRADABLE: TradableSymbol[] = ["QQQ", "IWM", "XLK", "XLF", "XLV", "XLE", "XLI"];
const WATCHLIST: WatchlistSymbol[] = ["SPY", ...TRADABLE];

export interface SignalPlan {
  trade_date: string;
  generated_at: string;
  market_regime: "RISK_ON" | "RISK_OFF" | "UNKNOWN";
  spy: IndicatorSet | null;
  decisions: SignalDecision[];
  buy_candidate: SignalDecision | null;
  exit_symbols: string[];
  no_trade_reason: string | null;
}

export interface ExecutionPlan {
  buy_intent: TradeIntent | null;
  sell_intents: TradeIntent[];
  skipped: Array<Record<string, unknown>>;
}

export function computeSignalPlan(input: {
  trade_date: string;
  generated_at: string;
  bars_by_symbol: Record<string, Bar[]>;
  holdings: PositionSnapshot[];
}): SignalPlan {
  const barsBySymbol = normalizeBars(input.bars_by_symbol);
  const holdings = safeArray(input.holdings);
  const holdingsSymbols = new Set(holdings.map((holding) => holding.symbol.toUpperCase()));
  const spyBars = barsBySymbol.SPY ?? [];
  const spyIndicators = spyBars.length > 0 ? computeIndicators("SPY", spyBars, null) : null;
  const spyReturn20 = spyIndicators?.return_20d ?? null;
  const marketRegime = spyIndicators && spyIndicators.sma_200 !== null
    ? spyIndicators.previous_close > spyIndicators.sma_200
      ? "RISK_ON"
      : "RISK_OFF"
    : "UNKNOWN";

  const decisions: SignalDecision[] = [];
  let noTradeReason: string | null = null;

  if (!spyIndicators || spyReturn20 === null || marketRegime === "UNKNOWN") {
    noTradeReason = "Missing SPY bars for regime detection.";
  }

  for (const symbol of WATCHLIST) {
    if (symbol === "SPY") {
      continue;
    }
    const bars = barsBySymbol[symbol] ?? [];
    if (bars.length < 200 || spyIndicators === null || spyReturn20 === null) {
      decisions.push(blankDecision(symbol, "insufficient data"));
      continue;
    }
    const indicators = computeIndicators(symbol, bars, spyReturn20);
    const checks = buildEligibilityChecks(symbol, indicators, holdingsSymbols, marketRegime);
    const eligible = Object.values(checks).every((value) => value === true);
    const reason = eligible
      ? "eligible"
      : explainChecks(symbol, checks, marketRegime);
    decisions.push({
      symbol,
      action: eligible && marketRegime === "RISK_ON"
        ? "BUY_CANDIDATE"
        : marketRegime === "RISK_OFF" && holdingsSymbols.has(symbol)
          ? "EXIT_POSITION"
          : "NO_BUY",
      eligible: eligible && marketRegime === "RISK_ON" && !holdingsSymbols.has(symbol),
      score: eligible ? 1 : 0,
      rank: null,
      reason,
      checks,
      indicators,
    });
  }

  const eligible = decisions.filter((decision) => decision.eligible);
  const ranked = [...eligible]
    .sort((left, right) => {
      const leftStrength = left.indicators.relative_strength_20d_vs_spy ?? Number.NEGATIVE_INFINITY;
      const rightStrength = right.indicators.relative_strength_20d_vs_spy ?? Number.NEGATIVE_INFINITY;
      const leftVol = left.indicators.atr_percent ?? Number.POSITIVE_INFINITY;
      const rightVol = right.indicators.atr_percent ?? Number.POSITIVE_INFINITY;
      return (rightStrength - leftStrength)
        || (leftVol - rightVol)
        || left.symbol.localeCompare(right.symbol);
    })
    .map((decision, index) => ({ ...decision, rank: index + 1, score: scoreDecision(decision, index + 1) }));

  const rankedBySymbol = new Map(ranked.map((decision) => [decision.symbol, decision]));
  const decisionsWithRank = decisions.map((decision) => rankedBySymbol.get(decision.symbol) ?? decision);
  const exitSymbols = holdings
    .filter((holding) => shouldExitHolding(holding, marketRegime, decisionsWithRank, ranked, input.generated_at))
    .map((holding) => holding.symbol.toUpperCase());

  const buyCandidate = ranked.find((decision) => !holdingsSymbols.has(decision.symbol)) ?? null;
  if (!buyCandidate && !noTradeReason) {
    noTradeReason = marketRegime === "RISK_OFF"
      ? "Market regime is risk-off."
      : "No ETF passed the entry filter.";
  }

  return {
    trade_date: input.trade_date,
    generated_at: input.generated_at,
    market_regime: marketRegime,
    spy: spyIndicators,
    decisions: decisionsWithRank,
    buy_candidate: buyCandidate && !holdingsSymbols.has(buyCandidate.symbol) ? buyCandidate : null,
    exit_symbols: uniqueStrings(exitSymbols),
    no_trade_reason: noTradeReason,
  };
}

export function buildExecutionPlan(input: {
  signal_plan: SignalPlan;
  holdings: PositionSnapshot[];
  strategy_equity: number;
  cash_available: number;
  max_open_positions: number;
  max_new_entries_per_day: number;
  max_position_notional_pct: number;
  max_total_invested_pct: number;
  minimum_order_notional_usd: number;
}): ExecutionPlan {
  const skipped: Array<Record<string, unknown>> = [];
  const sell_intents: TradeIntent[] = [];
  const buyCandidate = input.signal_plan.buy_candidate;
  const holdings = safeArray(input.holdings);
  const holdingsCount = holdings.length;
  const invested = holdings.reduce((sum, holding) => sum + Math.max(0, holding.market_value ?? 0), 0);
  const totalCapacity = input.strategy_equity * input.max_total_invested_pct;
  const remainingTotal = Math.max(0, totalCapacity - invested);

  for (const symbol of input.signal_plan.exit_symbols) {
    const holding = holdings.find((entry) => entry.symbol.toUpperCase() === symbol);
    if (!holding) {
      continue;
    }
    sell_intents.push({
      trade_date: input.signal_plan.trade_date,
      created_at: input.signal_plan.generated_at,
      symbol: symbol as TradableSymbol,
      action: "sell",
      reason: `Exit signal triggered for ${symbol}.`,
      quantity: holding.qty,
    });
  }

  if (!buyCandidate) {
    if (input.signal_plan.no_trade_reason) {
      skipped.push({ symbol: null, reason: input.signal_plan.no_trade_reason });
    }
    return { buy_intent: null, sell_intents, skipped };
  }

  if (input.max_new_entries_per_day < 1) {
    skipped.push({ symbol: buyCandidate.symbol, reason: "Daily entry limit is zero." });
    return { buy_intent: null, sell_intents, skipped };
  }

  if (holdingsCount >= input.max_open_positions) {
    skipped.push({ symbol: buyCandidate.symbol, reason: "Maximum open positions reached." });
    return { buy_intent: null, sell_intents, skipped };
  }

  if (sell_intents.length > 0 && holdingsCount === 0) {
    skipped.push({ symbol: buyCandidate.symbol, reason: "Exit-only day." });
    return { buy_intent: null, sell_intents, skipped };
  }

  const quotePrice = buyCandidate.indicators.previous_close;
  const maxNotional = Math.min(
    input.strategy_equity * input.max_position_notional_pct,
    remainingTotal,
    input.cash_available,
  );
  if (maxNotional < input.minimum_order_notional_usd) {
    skipped.push({ symbol: buyCandidate.symbol, reason: "Notional below minimum order size." });
    return { buy_intent: null, sell_intents, skipped };
  }

  const quantity = floorToDecimals(maxNotional / quotePrice, 3);
  if (quantity <= 0) {
    skipped.push({ symbol: buyCandidate.symbol, reason: "Calculated quantity is zero." });
    return { buy_intent: null, sell_intents, skipped };
  }

  return {
    buy_intent: {
      trade_date: input.signal_plan.trade_date,
      created_at: input.signal_plan.generated_at,
      symbol: buyCandidate.symbol,
      action: "buy",
      reason: buyCandidate.reason,
      quantity,
      limit_price: null,
      signal: buyCandidate,
    },
    sell_intents,
    skipped,
  };
}

export function computeIndicators(symbol: string, bars: Bar[], spyReturn20: number | null): IndicatorSet {
  const ordered = [...bars]
    .map(normalizeBar)
    .sort((left, right) => left.t.localeCompare(right.t));
  if (ordered.length < 20) {
    throw new Error(`not enough bars for ${symbol}`);
  }
  const closes = ordered.map((bar) => bar.c);
  const highs = ordered.map((bar) => bar.h);
  const previousClose = closes.at(-1) ?? 0;
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const close20Ago = closes.length >= 21 ? closes.at(-21) ?? null : null;
  const return20d = close20Ago && close20Ago !== 0 ? round((previousClose - close20Ago) / close20Ago) : null;
  const highestHigh20d = highs.slice(-20).reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
  const atr14 = atr(ordered, 14);
  const atrPercent = atr14 !== null && previousClose !== 0 ? round(atr14 / previousClose) : null;
  const relativeStrength = spyReturn20 !== null && return20d !== null ? round(return20d - spyReturn20) : null;
  return {
    symbol: normalizeSymbol(symbol) as WatchlistSymbol,
    previous_close: previousClose,
    sma_20: sma20,
    sma_50: sma50,
    sma_200: sma200,
    return_20d: return20d,
    highest_high_20d: Number.isFinite(highestHigh20d) ? round(highestHigh20d) : null,
    atr_14: atr14,
    atr_percent: atrPercent,
    relative_strength_20d_vs_spy: relativeStrength,
    above_20d_high_ratio: Number.isFinite(highestHigh20d) && highestHigh20d !== 0 ? round(previousClose / highestHigh20d) : null,
  };
}

function buildEligibilityChecks(
  symbol: TradableSymbol,
  indicators: IndicatorSet,
  holdingsSymbols: Set<string>,
  marketRegime: SignalPlan["market_regime"],
): Record<string, boolean | number | null> {
  return {
    regime_ok: marketRegime === "RISK_ON",
    above_50: indicators.sma_50 !== null ? indicators.previous_close > indicators.sma_50 : false,
    sma_50_above_200: indicators.sma_50 !== null && indicators.sma_200 !== null ? indicators.sma_50 > indicators.sma_200 : false,
    near_high: indicators.highest_high_20d !== null ? indicators.previous_close >= indicators.highest_high_20d * 0.98 : false,
    positive_return: indicators.return_20d !== null ? indicators.return_20d > 0 : false,
    relative_strength: indicators.relative_strength_20d_vs_spy !== null ? indicators.relative_strength_20d_vs_spy >= 0.02 : false,
    volatility_cap: indicators.atr_percent !== null ? indicators.atr_percent <= 0.08 : false,
    symbol_allowed: isTradableSymbol(symbol),
    already_held: !holdingsSymbols.has(symbol),
    qqq_xlk_bucket_ok: !(holdingsSymbols.has("QQQ") && symbol === "XLK") && !(holdingsSymbols.has("XLK") && symbol === "QQQ"),
  };
}

function explainChecks(symbol: TradableSymbol, checks: Record<string, boolean | number | null>, marketRegime: SignalPlan["market_regime"]): string {
  if (marketRegime === "RISK_OFF") {
    return "Market regime is risk-off.";
  }
  const failures = Object.entries(checks)
    .filter(([, value]) => value === false)
    .map(([key]) => key.replaceAll("_", " "));
  return failures.length > 0 ? `${symbol} failed: ${failures.join(", ")}.` : `${symbol} did not qualify.`;
}

function shouldExitHolding(
  holding: PositionSnapshot,
  marketRegime: SignalPlan["market_regime"],
  decisions: SignalDecision[],
  ranked: SignalDecision[],
  referenceTime: string,
): boolean {
  if (marketRegime === "RISK_OFF") {
    return true;
  }
  const decision = decisions.find((entry) => entry.symbol === holding.symbol);
  if (!decision) {
    return false;
  }
  if (decision.indicators.sma_20 !== null && decision.indicators.previous_close < decision.indicators.sma_20) {
    return true;
  }
  const topThree = new Set(ranked.slice(0, 3).map((entry) => entry.symbol));
  if (!topThree.has(holding.symbol as TradableSymbol)) {
    return true;
  }
  const entryDate = holding.entry_date ? new Date(`${holding.entry_date}T00:00:00Z`) : null;
  const nowDate = new Date(referenceTime);
  if (entryDate && Number.isFinite(nowDate.getTime())) {
    const ageDays = businessDaySpan(entryDate, nowDate);
    if (ageDays >= 30) {
      return true;
    }
  }
  return false;
}

function scoreDecision(decision: SignalDecision, rank: number): number {
  const strength = decision.indicators.relative_strength_20d_vs_spy ?? 0;
  const volPenalty = decision.indicators.atr_percent ?? 1;
  return round((strength * 100) - (volPenalty * 10) - rank / 100);
}

function normalizeBars(barsBySymbol: Record<string, Bar[]>): Record<string, Bar[]> {
  const normalized: Record<string, Bar[]> = {};
  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    normalized[normalizeSymbol(symbol)] = bars.map(normalizeBar);
  }
  return normalized;
}

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function normalizeBar(bar: Bar): Bar {
  return {
    symbol: normalizeSymbol(bar.symbol),
    t: bar.t,
    o: bar.o,
    h: bar.h,
    l: bar.l,
    c: bar.c,
    v: bar.v,
  };
}

function sma(values: number[], length: number): number | null {
  if (values.length < length) {
    return null;
  }
  const slice = values.slice(-length);
  return round(slice.reduce((sum, value) => sum + value, 0) / length);
}

function atr(bars: Bar[], length: number): number | null {
  if (bars.length <= length) {
    return null;
  }
  const ranges: number[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    const current = bars[index];
    const previous = bars[index - 1];
    const trueRange = Math.max(
      current.h - current.l,
      Math.abs(current.h - previous.c),
      Math.abs(current.l - previous.c),
    );
    ranges.push(trueRange);
  }
  if (ranges.length < length) {
    return null;
  }
  return round(ranges.slice(-length).reduce((sum, value) => sum + value, 0) / length);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function floorToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.floor(value * factor) / factor;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function businessDaySpan(start: Date, end: Date): number {
  const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const limit = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  let days = 0;
  while (current < limit) {
    current.setUTCDate(current.getUTCDate() + 1);
    const weekday = current.getUTCDay();
    if (weekday >= 1 && weekday <= 5) {
      days += 1;
    }
  }
  return days;
}

function blankDecision(symbol: WatchlistSymbol, reason: string): SignalDecision {
  return {
    symbol,
    action: "NO_BUY",
    eligible: false,
    score: 0,
    rank: null,
    reason,
    checks: {},
    indicators: {
      symbol,
      previous_close: 0,
      sma_20: null,
      sma_50: null,
      sma_200: null,
      return_20d: null,
      highest_high_20d: null,
      atr_14: null,
      atr_percent: null,
      relative_strength_20d_vs_spy: null,
      above_20d_high_ratio: null,
    },
  };
}
