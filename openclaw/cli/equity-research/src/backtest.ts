import { BacktestResult, Bar, PerformanceMetrics } from "./contracts.js";
import { computeSignalPlan } from "./value-engine.js";

const TRADING_DAYS_PER_YEAR = 252;
const DEFAULT_COST_BPS = 10;

export function runDualMomentumBacktest(input: {
  bars_by_symbol: Record<string, Bar[]>;
  symbols: string[];
  defensive_symbol: string;
  transaction_cost_bps?: number;
  slippage_bps?: number;
}): BacktestResult {
  const ordered = Object.fromEntries(Object.entries(input.bars_by_symbol).map(([symbol, bars]) => [symbol, [...bars].sort((a, b) => a.t.localeCompare(b.t))]));
  const spy = ordered.SPY ?? [];
  const dates = spy.map((bar) => bar.t.slice(0, 10));
  const totalCost = ((input.transaction_cost_bps ?? DEFAULT_COST_BPS) + (input.slippage_bps ?? DEFAULT_COST_BPS)) / 10_000;
  let equity = 1;
  let benchmarkEquity = 1;
  let baselineEquity = 1;
  let previousSymbols: string[] = [];
  let turnover = 0;
  const returns: number[] = [];
  const benchmarkReturns: number[] = [];
  const baselineReturns: number[] = [];
  const exposures: number[] = [];

  for (let index = 200; index < dates.length - 1; index += 1) {
    const slice = Object.fromEntries(Object.entries(ordered).map(([symbol, bars]) => [symbol, bars.slice(0, index + 1)]));
    if (Object.values(slice).some((bars) => bars.length < index + 1)) {
      continue;
    }
    const plan = computeSignalPlan({
      trade_date: dates[index],
      generated_at: `${dates[index]}T20:20:00Z`,
      bars_by_symbol: slice,
      holdings: [],
      watchlist_symbols: ["SPY", ...input.symbols, input.defensive_symbol],
      tradable_symbols: [...input.symbols, input.defensive_symbol],
    });
    const selected = plan.market_regime === "RISK_OFF"
      ? [input.defensive_symbol]
      : plan.decisions
        .filter((decision) => decision.eligible && decision.symbol !== input.defensive_symbol)
        .sort((left, right) => (left.rank ?? Number.POSITIVE_INFINITY) - (right.rank ?? Number.POSITIVE_INFINITY))
        .slice(0, 2)
        .map((decision) => decision.symbol);
    const currentSymbols = selected.length > 0 ? selected : [input.defensive_symbol];
    const changed = currentSymbols.filter((symbol) => !previousSymbols.includes(symbol)).length + previousSymbols.filter((symbol) => !currentSymbols.includes(symbol)).length;
    turnover += changed / 2;
    let dayReturn = 0;
    for (const symbol of currentSymbols) {
      const bars = ordered[symbol] ?? [];
      const current = bars[index]?.c;
      const next = bars[index + 1]?.c;
      if (current && next) {
        dayReturn += (next / current - 1) / currentSymbols.length;
      }
    }
    if (changed > 0) {
      dayReturn -= totalCost * (changed / Math.max(1, currentSymbols.length));
    }
    const spyCurrent = spy[index]?.c;
    const spyNext = spy[index + 1]?.c;
    const benchmarkReturn = spyCurrent && spyNext ? spyNext / spyCurrent - 1 : 0;
    const baselineSymbol = legacyBaselineSelection(ordered, input.symbols, index);
    const baselineCurrent = baselineSymbol ? ordered[baselineSymbol]?.[index]?.c : undefined;
    const baselineNext = baselineSymbol ? ordered[baselineSymbol]?.[index + 1]?.c : undefined;
    const baselineReturn = baselineCurrent && baselineNext ? baselineNext / baselineCurrent - 1 - totalCost : 0;
    equity *= 1 + dayReturn;
    benchmarkEquity *= 1 + benchmarkReturn;
    baselineEquity *= 1 + baselineReturn;
    returns.push(dayReturn);
    benchmarkReturns.push(benchmarkReturn);
    baselineReturns.push(baselineReturn);
    exposures.push(currentSymbols.includes(input.defensive_symbol) ? 0 : 1);
    previousSymbols = currentSymbols;
  }

  const start = dates[200] ?? "";
  const end = dates.at(-1) ?? "";
  const metrics = calculateMetrics(returns, equity, turnover, exposures);
  const baseline = calculateMetrics(baselineReturns, baselineEquity, turnover, [1]);
  const benchmark = calculateMetrics(benchmarkReturns, benchmarkEquity, 0, [1]);
  const walkForward = walkForwardScore(returns, baselineReturns, benchmarkReturns);
  const selected = walkForward.passes && metrics.sortino !== null && baseline.sortino !== null && benchmark.sortino !== null
    && metrics.sortino > baseline.sortino && metrics.sortino > benchmark.sortino
    && metrics.max_drawdown >= -0.10
    ? "dual_momentum"
    : "baseline";
  return {
    strategy: "dual_momentum",
    start_date: start,
    end_date: end,
    trading_days: returns.length,
    metrics,
    baseline,
    benchmark,
    selected_strategy: selected,
    walk_forward: walkForward,
    assumptions: { transaction_cost_bps: input.transaction_cost_bps ?? DEFAULT_COST_BPS, slippage_bps: input.slippage_bps ?? DEFAULT_COST_BPS, rebalance_frequency: "daily" },
  };
}

function walkForwardScore(returns: number[], baseline: number[], benchmark: number[]): { windows: number; dual_momentum_wins: number; passes: boolean } {
  const windows = 3;
  const size = Math.floor(returns.length / windows);
  if (size < 20) return { windows: 0, dual_momentum_wins: 0, passes: false };
  let wins = 0;
  for (let index = 0; index < windows; index += 1) {
    const start = index * size;
    const end = index === windows - 1 ? returns.length : start + size;
    const dual = calculateMetrics(returns.slice(start, end), product(returns.slice(start, end)), 0, [1]);
    const old = calculateMetrics(baseline.slice(start, end), product(baseline.slice(start, end)), 0, [1]);
    const spy = calculateMetrics(benchmark.slice(start, end), product(benchmark.slice(start, end)), 0, [1]);
    if (dual.sortino !== null && old.sortino !== null && spy.sortino !== null && dual.sortino > old.sortino && dual.sortino > spy.sortino && dual.max_drawdown >= -0.10) wins += 1;
  }
  return { windows, dual_momentum_wins: wins, passes: wins === windows };
}

function product(returns: number[]): number {
  return returns.reduce((equity, value) => equity * (1 + value), 1);
}

function legacyBaselineSelection(barsBySymbol: Record<string, Bar[]>, symbols: string[], index: number): string | null {
  const spy = barsBySymbol.SPY;
  if (!spy || !spy[index] || movingAverage(spy, index, 200) === null || spy[index].c <= (movingAverage(spy, index, 200) ?? Infinity)) return null;
  const spyReturn = returnOver(barsBySymbol.SPY ?? [], index, 20);
  return symbols
    .map((symbol) => ({ symbol, bars: barsBySymbol[symbol] ?? [] }))
    .filter(({ bars }) => bars[index] && bars[index - 20] && bars[index].c > (movingAverage(bars, index, 50) ?? Infinity))
    .map(({ symbol, bars }) => ({ symbol, strength: returnOver(bars, index, 20) - spyReturn }))
    .filter((candidate) => candidate.strength >= 0.02)
    .sort((left, right) => right.strength - left.strength || left.symbol.localeCompare(right.symbol))[0]?.symbol ?? null;
}

function movingAverage(bars: Bar[], index: number, length: number): number | null {
  if (index < length - 1) return null;
  return average(bars.slice(index - length + 1, index + 1).map((bar) => bar.c));
}

function returnOver(bars: Bar[], index: number, length: number): number {
  const current = bars[index]?.c;
  const prior = bars[index - length]?.c;
  return current && prior ? current / prior - 1 : Number.NEGATIVE_INFINITY;
}

function calculateMetrics(returns: number[], equity: number, turnover: number, exposures: number[]): PerformanceMetrics {
  const years = Math.max(returns.length / TRADING_DAYS_PER_YEAR, 1 / TRADING_DAYS_PER_YEAR);
  const mean = average(returns);
  const volatility = standardDeviation(returns) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  const downside = Math.sqrt(average(returns.filter((value) => value < 0).map((value) => value ** 2))) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  let peak = 1;
  let path = 1;
  let maxDrawdown = 0;
  let wins = 0;
  for (const value of returns) {
    path *= 1 + value;
    peak = Math.max(peak, path);
    maxDrawdown = Math.min(maxDrawdown, path / peak - 1);
    if (value > 0) wins += 1;
  }
  return {
    cumulative_return: equity - 1,
    cagr: equity > 0 ? equity ** (1 / years) - 1 : -1,
    annualized_volatility: volatility,
    sharpe: volatility > 0 ? (mean * TRADING_DAYS_PER_YEAR) / volatility : null,
    sortino: downside > 0 ? (mean * TRADING_DAYS_PER_YEAR) / downside : null,
    max_drawdown: maxDrawdown,
    turnover,
    win_rate: returns.length > 0 ? wins / returns.length : null,
    average_exposure: average(exposures),
  };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}
