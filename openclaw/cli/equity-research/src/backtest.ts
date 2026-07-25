import { BacktestResult, Bar, PerformanceMetrics } from "./contracts.js";
import { approvalFromBacktest, buildEtfResearch } from "./research.js";

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
  const byDate = Object.fromEntries(Object.entries(ordered).map(([symbol, bars]) => [symbol, new Map(bars.map((bar) => [bar.t.slice(0, 10), bar]))]));
  const totalCost = ((input.transaction_cost_bps ?? DEFAULT_COST_BPS) + (input.slippage_bps ?? DEFAULT_COST_BPS)) / 10_000;
  let equity = 1;
  let benchmarkEquity = 1;
  let baselineEquity = 1;
  let previousWeights = new Map<string, number>();
  let turnover = 0;
  const returns: number[] = [];
  const benchmarkReturns: number[] = [];
  const baselineReturns: number[] = [];
  const benchmark6040Returns: number[] = [];
  const exposures: number[] = [];

  for (let index = 20; index < dates.length - 1; index += 1) {
    const date = dates[index];
    const nextDate = dates[index + 1];
    const slice = Object.fromEntries(Object.entries(ordered).map(([symbol, bars]) => [symbol, bars.filter((bar) => bar.t.slice(0, 10) <= date)]));
    if (Object.values(slice).some((bars) => bars.length < 21)) {
      continue;
    }
    const targets = buildEtfResearch({ as_of: date, bars_by_symbol: slice }).targets;
    const currentWeights = new Map(targets.map((target) => [target.symbol, target.target_weight]));
    const symbols = new Set([...previousWeights.keys(), ...currentWeights.keys()]);
    const dayTurnover = [...symbols].reduce((sum, symbol) => sum + Math.abs((previousWeights.get(symbol) ?? 0) - (currentWeights.get(symbol) ?? 0)), 0) / 2;
    turnover += dayTurnover;
    let dayReturn = 0;
    for (const [symbol, weight] of currentWeights) {
      const current = byDate[symbol]?.get(date)?.c;
      const next = byDate[symbol]?.get(nextDate)?.c;
      if (current && next) {
        dayReturn += (next / current - 1) * weight;
      }
    }
    dayReturn -= totalCost * dayTurnover;
    const spyCurrent = byDate.SPY?.get(date)?.c;
    const spyNext = byDate.SPY?.get(nextDate)?.c;
    const benchmarkReturn = spyCurrent && spyNext ? spyNext / spyCurrent - 1 : 0;
    const bilCurrent = byDate[input.defensive_symbol]?.get(date)?.c;
    const bilNext = byDate[input.defensive_symbol]?.get(nextDate)?.c;
    const bilReturn = bilCurrent && bilNext ? bilNext / bilCurrent - 1 : 0;
    const baselineReturn = benchmarkReturn;
    const benchmark6040Return = 0.6 * benchmarkReturn + 0.4 * bilReturn;
    equity *= 1 + dayReturn;
    benchmarkEquity *= 1 + benchmarkReturn;
    baselineEquity *= 1 + baselineReturn;
    returns.push(dayReturn);
    benchmarkReturns.push(benchmarkReturn);
    baselineReturns.push(baselineReturn);
    benchmark6040Returns.push(benchmark6040Return);
    exposures.push([...currentWeights.entries()].filter(([symbol]) => symbol !== input.defensive_symbol).reduce((sum, [, weight]) => sum + weight, 0));
    previousWeights = currentWeights;
  }

  const start = dates[20] ?? "";
  const end = dates.at(-1) ?? "";
  const metrics = calculateMetrics(returns, equity, turnover, exposures);
  const baseline = calculateMetrics(baselineReturns, baselineEquity, turnover, [1]);
  const benchmark = calculateMetrics(benchmarkReturns, benchmarkEquity, 0, [1]);
  const walkForward = walkForwardScore(returns, baselineReturns, benchmarkReturns);
  const selected = walkForward.passes && metrics.sortino !== null && baseline.sortino !== null && benchmark.sortino !== null
    && metrics.sortino > baseline.sortino && metrics.sortino > benchmark.sortino
    && metrics.max_drawdown >= -0.10
    ? "dual_momentum"
    : "none";
  const oos = splitMetrics(returns);
  const stress = calculateMetrics(returns.map((value) => value - 0.003), product(returns.map((value) => value - 0.003)), turnover, exposures);
  const approval = approvalFromBacktest({
    metrics,
    benchmark: calculateMetrics(benchmark6040Returns, product(benchmark6040Returns), 0, [0.6]),
    rolling_three_year_excess_cagr: rollingExcessCagr(returns, benchmarkReturns),
    out_of_sample: oos,
    stress_30bps: stress,
    trial_count: 1,
  });
  return {
    strategy: "dual_momentum",
    start_date: start,
    end_date: end,
    trading_days: returns.length,
    metrics,
    baseline,
    benchmark,
    selected_strategy: approval.status === "approved" ? selected : "none",
    walk_forward: walkForward,
    assumptions: { transaction_cost_bps: input.transaction_cost_bps ?? DEFAULT_COST_BPS, slippage_bps: input.slippage_bps ?? DEFAULT_COST_BPS, rebalance_frequency: "daily_after_close_20_session_rotation" },
    approval: { status: approval.status, reasons: approval.reasons, out_of_sample_windows: oos.length, deflated_sharpe_confidence: approval.deflated_sharpe_confidence },
  };
}

function splitMetrics(returns: number[]): PerformanceMetrics[] {
  const windows = 4;
  const size = Math.floor(returns.length / windows);
  if (size < 30) return [];
  return Array.from({ length: windows }, (_, index) => {
    const part = returns.slice(index * size, index === windows - 1 ? undefined : (index + 1) * size);
    return calculateMetrics(part, product(part), 0, [1]);
  });
}

function rollingExcessCagr(returns: number[], benchmark: number[]): number[] {
  const days = 252 * 3;
  const result: number[] = [];
  for (let index = days; index <= returns.length; index += 21) result.push(product(returns.slice(index - days, index)) ** (1 / 3) - product(benchmark.slice(index - days, index)) ** (1 / 3));
  return result;
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
