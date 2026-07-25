import {
  Bar,
  IndicatorSet,
  PositionSnapshot,
  SignalDecision,
  StrategySignal,
  TradableSymbol,
  TradeIntent,
  TargetAllocation,
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
  buy_intents: TradeIntent[];
  sell_intents: TradeIntent[];
  skipped: Array<Record<string, unknown>>;
}

export function computeSignalPlan(input: {
  trade_date: string;
  generated_at: string;
  bars_by_symbol: Record<string, Bar[]>;
  holdings: PositionSnapshot[];
  watchlist_symbols?: string[];
  tradable_symbols?: string[];
  strategy?: "dual_momentum" | "baseline";
}): SignalPlan {
  const strategy = input.strategy ?? "dual_momentum";
  const barsBySymbol = normalizeBars(input.bars_by_symbol);
  const holdings = safeArray(input.holdings);
  const holdingsSymbols = new Set(holdings.map((holding) => holding.symbol.toUpperCase()));
  const spyBars = barsBySymbol.SPY ?? [];
  const spyIndicators = spyBars.length > 0 ? computeIndicators("SPY", spyBars, null) : null;
  const spyReturn20 = spyIndicators?.return_20d ?? null;
  const spyReturn126 = spyIndicators?.return_126d ?? null;
  const marketRegime = spyIndicators && spyIndicators.sma_200 !== null
    ? spyIndicators.previous_close > spyIndicators.sma_200
      ? "RISK_ON"
      : "RISK_OFF"
    : "UNKNOWN";

  const decisions: SignalDecision[] = [];
  let noTradeReason: string | null = null;

  if (!spyIndicators || (strategy === "dual_momentum" ? spyReturn126 === null : spyReturn20 === null) || marketRegime === "UNKNOWN") {
    noTradeReason = "Missing SPY bars for regime detection.";
  }

  const watchlist = input.watchlist_symbols ?? WATCHLIST;
  const tradable = input.tradable_symbols ?? TRADABLE;

  for (const symbol of watchlist) {
    if (symbol === "SPY" || (strategy === "dual_momentum" && symbol === "BIL")) {
      continue;
    }
    const bars = barsBySymbol[symbol] ?? [];
    if (bars.length < 200 || spyIndicators === null || (strategy === "dual_momentum" ? spyReturn126 === null : spyReturn20 === null)) {
      decisions.push(blankDecision(symbol, "insufficient data"));
      continue;
    }
    const indicators = computeIndicators(symbol, bars, spyReturn20, spyReturn126);
    const checks = buildEligibilityChecks(symbol, indicators, holdingsSymbols, marketRegime, tradable, strategy);
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

  // BIL is the defensive allocation. It is eligible only when the broad market
  // is below its 200-day average; it is never ranked against risk assets.
  if (strategy === "dual_momentum" && watchlist.includes("BIL")) {
    const bilBars = barsBySymbol.BIL ?? [];
    if (bilBars.length >= 200 && spyIndicators !== null) {
      const indicators = computeIndicators("BIL", bilBars, spyReturn20, spyReturn126);
      const defensive = marketRegime === "RISK_OFF";
      decisions.push({
        symbol: "BIL",
        action: defensive ? "BUY_CANDIDATE" : "NO_BUY",
        eligible: defensive && !holdingsSymbols.has("BIL"),
        score: defensive ? 1 : 0,
        rank: defensive ? 1 : null,
        reason: defensive ? "Defensive Treasury allocation while SPY is below its 200-day average." : "Risk-on market; defensive allocation not required.",
        checks: { regime_ok: defensive, symbol_allowed: tradable.includes("BIL"), already_held: !holdingsSymbols.has("BIL") },
        indicators,
      });
    }
  }

  const eligible = decisions.filter((decision) => decision.eligible);
  const ranked = [...eligible]
    .sort((left, right) => {
      const leftStrength = strategy === "dual_momentum" ? left.indicators.relative_strength_126d_vs_spy ?? Number.NEGATIVE_INFINITY : left.indicators.relative_strength_20d_vs_spy ?? Number.NEGATIVE_INFINITY;
      const rightStrength = strategy === "dual_momentum" ? right.indicators.relative_strength_126d_vs_spy ?? Number.NEGATIVE_INFINITY : right.indicators.relative_strength_20d_vs_spy ?? Number.NEGATIVE_INFINITY;
      const leftVol = left.indicators.atr_percent ?? Number.POSITIVE_INFINITY;
      const rightVol = right.indicators.atr_percent ?? Number.POSITIVE_INFINITY;
      return (rightStrength - leftStrength)
        || (leftVol - rightVol)
        || left.symbol.localeCompare(right.symbol);
    })
    .map((decision, index) => ({ ...decision, rank: index + 1, score: scoreDecision(decision, index + 1, strategy) }));

  const rankedBySymbol = new Map(ranked.map((decision) => [decision.symbol, decision]));
  const decisionsWithRank = decisions.map((decision) => rankedBySymbol.get(decision.symbol) ?? decision);
  const exitSymbols = holdings
    .filter((holding) => shouldExitHolding(holding, marketRegime, decisionsWithRank, ranked, input.generated_at, strategy))
    .map((holding) => holding.symbol.toUpperCase());

  const buyCandidate = strategy === "dual_momentum" && marketRegime === "RISK_OFF"
    ? decisions.find((decision) => decision.symbol === "BIL" && decision.eligible) ?? null
    : ranked.find((decision) => !holdingsSymbols.has(decision.symbol)) ?? null;
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

// Daily close research targets drive next-session entries. This deliberately
// works from 20 sessions or less, never intraday price discrepancies.
export function computeTargetSignalPlan(input: {
  trade_date: string;
  generated_at: string;
  bars_by_symbol: Record<string, Bar[]>;
  holdings: PositionSnapshot[];
  targets: TargetAllocation[];
}): SignalPlan {
  const bars = normalizeBars(input.bars_by_symbol);
  const holdings = safeArray(input.holdings);
  const held = new Set(holdings.map((holding) => holding.symbol.toUpperCase()));
  const spy = bars.SPY ?? bars.VTI ?? [];
  const spyIndicators = spy.length >= 20 ? computeIndicators("SPY", spy, null) : null;
  const targetAssets = input.targets.filter((target) => target.target_weight > 0 && (target.sleeve === "etf" || target.symbol === "BIL"));
  const decisions: SignalDecision[] = targetAssets.map((target, index) => {
    const symbolBars = bars[target.symbol] ?? [];
    if (symbolBars.length < 20) return blankDecision(target.symbol, "insufficient current bars for research target");
    const indicators = computeIndicators(target.symbol, symbolBars, spyIndicators?.return_20d ?? null, null);
    const heldAlready = held.has(target.symbol);
    return {
      symbol: target.symbol,
      action: heldAlready ? "NO_EXIT" : "BUY_CANDIDATE",
      eligible: !heldAlready,
      score: round(target.target_weight * 100),
      rank: index + 1,
      reason: target.reason,
      checks: { research_target: true, target_weight: target.target_weight, already_held: !heldAlready, current_price_positive: indicators.previous_close > 0 },
      indicators,
    };
  });
  const targetSymbols = new Set(targetAssets.map((target) => target.symbol.toUpperCase()));
  const exits = holdings.filter((holding) => {
    const symbol = holding.symbol.toUpperCase();
    if (!targetSymbols.has(symbol)) return true;
    if (symbol === "BIL") return false;
    const symbolBars = bars[symbol] ?? [];
    const sma10 = symbolBars.length >= 10 ? symbolBars.slice(-10).reduce((sum, bar) => sum + bar.c, 0) / 10 : null;
    const trendBroken = sma10 !== null && (symbolBars.at(-1)?.c ?? 0) < sma10;
    const sessionsHeld = holding.entry_date ? symbolBars.filter((bar) => bar.t.slice(0, 10) > holding.entry_date!).length : 0;
    return trendBroken || sessionsHeld >= 20;
  }).map((holding) => holding.symbol.toUpperCase());
  const candidate = decisions.filter((decision) => decision.eligible).sort((left, right) => (right.score - left.score) || left.symbol.localeCompare(right.symbol))[0] ?? null;
  return {
    trade_date: input.trade_date,
    generated_at: input.generated_at,
    market_regime: targetAssets.length > 0 ? "RISK_ON" : "RISK_OFF",
    spy: spyIndicators,
    decisions,
    buy_candidate: candidate,
    exit_symbols: exits,
    no_trade_reason: candidate ? null : targetAssets.length === 0 ? "No current research target passed the 20-session rotation filter." : "Current targets are already held.",
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
  target_portfolio_volatility_pct?: number;
}): ExecutionPlan {
  const skipped: Array<Record<string, unknown>> = [];
  const sell_intents: TradeIntent[] = [];
  const holdings = safeArray(input.holdings);
  const holdingsCount = holdings.length;
  let invested = 0;
  for (const holding of holdings) {
    invested += Math.max(0, holding.market_value ?? 0);
  }
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

  const buyCandidates = input.signal_plan.decisions
    .filter((decision) => decision.eligible && decision.action === "BUY_CANDIDATE")
    .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
  if (buyCandidates.length === 0) {
    if (input.signal_plan.no_trade_reason) {
      skipped.push({ symbol: null, reason: input.signal_plan.no_trade_reason });
    }
    return { buy_intent: null, buy_intents: [], sell_intents, skipped };
  }

  if (input.max_new_entries_per_day < 1) {
    skipped.push({ symbol: null, reason: "Daily entry limit is zero." });
    return { buy_intent: null, buy_intents: [], sell_intents, skipped };
  }

  const availableSlots = Math.max(0, input.max_open_positions - Math.max(0, holdingsCount - sell_intents.length));
  if (availableSlots === 0) {
    skipped.push({ symbol: null, reason: "Maximum open positions reached." });
    return { buy_intent: null, buy_intents: [], sell_intents, skipped };
  }

  const buy_intents: TradeIntent[] = [];
  let capacity = remainingTotal;
  let cash = input.cash_available;
  const targetVolatility = input.target_portfolio_volatility_pct ?? 0.25;
  for (const candidate of buyCandidates.slice(0, Math.min(input.max_new_entries_per_day, availableSlots))) {
    const quotePrice = candidate.indicators.previous_close;
    const targetWeight = Math.min(input.max_position_notional_pct, Number(candidate.checks.target_weight ?? input.max_position_notional_pct));
    const annualizedVolatility = (candidate.indicators.atr_percent ?? 0.03) * Math.sqrt(252);
    const volatilityScaledNotional = annualizedVolatility > 0
      ? input.strategy_equity * Math.min(targetWeight, targetVolatility / annualizedVolatility)
      : input.strategy_equity * targetWeight;
    const maxNotional = Math.min(input.strategy_equity * targetWeight, volatilityScaledNotional, capacity, cash);
    if (maxNotional < input.minimum_order_notional_usd) {
      skipped.push({ symbol: candidate.symbol, reason: "Notional below minimum order size." });
      continue;
    }
    const quantity = floorToDecimals(maxNotional / quotePrice, 3);
    if (quantity <= 0) {
      skipped.push({ symbol: candidate.symbol, reason: "Calculated quantity is zero." });
      continue;
    }
    buy_intents.push({
      trade_date: input.signal_plan.trade_date,
      created_at: input.signal_plan.generated_at,
      symbol: candidate.symbol,
      action: "buy",
      reason: candidate.reason,
      quantity,
      limit_price: null,
      signal: candidate,
    });
    const reserved = quantity * quotePrice;
    capacity = Math.max(0, capacity - reserved);
    cash = Math.max(0, cash - reserved);
  }
  return { buy_intent: buy_intents[0] ?? null, buy_intents, sell_intents, skipped };
}

export function computeIndicators(symbol: string, bars: Bar[], spyReturn20: number | null, spyReturn126: number | null = null): IndicatorSet {
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
  const close126Ago = closes.length >= 127 ? closes.at(-127) ?? null : null;
  const return126d = close126Ago && close126Ago !== 0 ? round((previousClose - close126Ago) / close126Ago) : null;
  let highestHigh20d = Number.NEGATIVE_INFINITY;
  for (const value of highs.slice(-20)) {
    highestHigh20d = Math.max(highestHigh20d, value);
  }
  const atr14 = atr(ordered, 14);
  const atrPercent = atr14 !== null && previousClose !== 0 ? round(atr14 / previousClose) : null;
  const relativeStrength = spyReturn20 !== null && return20d !== null ? round(return20d - spyReturn20) : null;
  const relativeStrength126 = spyReturn126 !== null && return126d !== null ? round(return126d - spyReturn126) : null;
  return {
    symbol: normalizeSymbol(symbol) as WatchlistSymbol,
    previous_close: previousClose,
    sma_20: sma20,
    sma_50: sma50,
    sma_200: sma200,
    return_20d: return20d,
    return_126d: return126d,
    highest_high_20d: Number.isFinite(highestHigh20d) ? round(highestHigh20d) : null,
    atr_14: atr14,
    atr_percent: atrPercent,
    relative_strength_20d_vs_spy: relativeStrength,
    relative_strength_126d_vs_spy: relativeStrength126,
    above_20d_high_ratio: Number.isFinite(highestHigh20d) && highestHigh20d !== 0 ? round(previousClose / highestHigh20d) : null,
  };
}

function buildEligibilityChecks(
  symbol: TradableSymbol,
  indicators: IndicatorSet,
  holdingsSymbols: Set<string>,
  marketRegime: SignalPlan["market_regime"],
  tradableSymbols?: string[],
  strategy: "dual_momentum" | "baseline" = "dual_momentum",
): Record<string, boolean | number | null> {
  const allowed = tradableSymbols ? tradableSymbols.includes(symbol) : isTradableSymbol(symbol);
  if (strategy === "baseline") {
    return {
      regime_ok: marketRegime === "RISK_ON",
      above_50: indicators.sma_50 !== null ? indicators.previous_close > indicators.sma_50 : false,
      sma_50_above_200: indicators.sma_50 !== null && indicators.sma_200 !== null ? indicators.sma_50 > indicators.sma_200 : false,
      near_high: indicators.highest_high_20d !== null ? indicators.previous_close >= indicators.highest_high_20d * 0.98 : false,
      positive_return: indicators.return_20d !== null ? indicators.return_20d > 0 : false,
      relative_strength: indicators.relative_strength_20d_vs_spy !== null ? indicators.relative_strength_20d_vs_spy >= 0.02 : false,
      volatility_cap: indicators.atr_percent !== null ? indicators.atr_percent <= 0.08 : false,
      symbol_allowed: allowed,
      already_held: !holdingsSymbols.has(symbol),
      qqq_xlk_bucket_ok: !(holdingsSymbols.has("QQQ") && symbol === "XLK") && !(holdingsSymbols.has("XLK") && symbol === "QQQ"),
    };
  }
  return {
    regime_ok: marketRegime === "RISK_ON",
    above_50: indicators.sma_50 !== null ? indicators.previous_close > indicators.sma_50 : false,
    sma_50_above_200: indicators.sma_50 !== null && indicators.sma_200 !== null ? indicators.sma_50 > indicators.sma_200 : false,
    positive_6_month_return: indicators.return_126d !== null ? indicators.return_126d > 0 : false,
    relative_strength_6_month: indicators.relative_strength_126d_vs_spy !== null ? indicators.relative_strength_126d_vs_spy > 0 : false,
    volatility_cap: indicators.atr_percent !== null ? indicators.atr_percent <= 0.08 : false,
    symbol_allowed: allowed,
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
  strategy: "dual_momentum" | "baseline",
): boolean {
  if (strategy === "baseline") {
    if (marketRegime === "RISK_OFF") return true;
    const decision = decisions.find((entry) => entry.symbol === holding.symbol);
    if (!decision) return false;
    if (decision.indicators.sma_20 !== null && decision.indicators.previous_close < decision.indicators.sma_20) return true;
    if (!new Set(ranked.slice(0, 3).map((entry) => entry.symbol)).has(holding.symbol as TradableSymbol)) return true;
    const entryDate = holding.entry_date ? new Date(`${holding.entry_date}T00:00:00Z`) : null;
    return Boolean(entryDate && Number.isFinite(new Date(referenceTime).getTime()) && businessDaySpan(entryDate, new Date(referenceTime)) >= 30);
  }
  if (holding.symbol === "BIL") {
    return marketRegime === "RISK_ON";
  }
  if (marketRegime === "RISK_OFF") {
    return true;
  }
  const decision = decisions.find((entry) => entry.symbol === holding.symbol);
  if (!decision) {
    return false;
  }
  if (decision.indicators.sma_50 !== null && decision.indicators.previous_close < decision.indicators.sma_50) {
    return true;
  }
  const topTwo = new Set(ranked.slice(0, 2).map((entry) => entry.symbol));
  if (!topTwo.has(holding.symbol as TradableSymbol)) {
    return true;
  }
  const entryDate = holding.entry_date ? new Date(`${holding.entry_date}T00:00:00Z`) : null;
  const nowDate = new Date(referenceTime);
  return false;
}

function scoreDecision(decision: SignalDecision, rank: number, strategy: "dual_momentum" | "baseline" = "dual_momentum"): number {
  const strength = strategy === "dual_momentum" ? decision.indicators.relative_strength_126d_vs_spy ?? 0 : decision.indicators.relative_strength_20d_vs_spy ?? 0;
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
  let sum = 0;
  for (const value of slice) {
    sum += value;
  }
  return round(sum / length);
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
  let sum = 0;
  for (const value of ranges.slice(-length)) {
    sum += value;
  }
  return round(sum / length);
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
      return_126d: null,
      highest_high_20d: null,
      atr_14: null,
      atr_percent: null,
      relative_strength_20d_vs_spy: null,
      relative_strength_126d_vs_spy: null,
      above_20d_high_ratio: null,
    },
  };
}
