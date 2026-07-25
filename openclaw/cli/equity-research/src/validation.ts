import { Bar, CandidateValidation, ContractError, PerformanceMetrics, TargetAllocation, ValidationFold } from "./contracts.js";
import { ETF_UNIVERSE, MAX_HOLDING_SESSIONS, STRATEGY_VERSION } from "./research.js";

const TRAINING_SESSIONS = 504;
const PURGE_SESSIONS = MAX_HOLDING_SESSIONS;
const EMBARGO_SESSIONS = 5;
const OOS_SESSIONS = 63;
const BASE_ONE_WAY_COST_BPS = 20;
const STRESS_ONE_WAY_COST_BPS = 40;

export const SHORT_HORIZON_CANDIDATES = [
  { id: "rotation-momentum-5-10-20", kind: "rotation-momentum" as const, description: "Top three liquid ETFs with positive 5/10/20-session momentum and a 10-session trend." },
  { id: "rotation-trend-20", kind: "rotation-trend" as const, description: "Top three liquid ETFs above their 20-session average, ranked by 20-session return." },
  { id: "qqq-trend-20", kind: "qqq-trend" as const, description: "Concentrated unlevered QQQ exposure only when its 20-session return is positive." },
] as const;

type Candidate = (typeof SHORT_HORIZON_CANDIDATES)[number];
type Weights = Map<string, number>;

interface SimulationResult {
  returns: number[];
  primary: number[];
  matched: number[];
  exposures: number[];
  turnover: number;
}

export function runShortHorizonValidation(input: { bars_by_symbol: Record<string, Bar[]>; as_of: string; data_checksum: string }): { id: string; created_at: string; as_of: string; data_checksum: string; candidates: CandidateValidation[] } {
  const bars = normalizeBars(input.bars_by_symbol);
  const dates = bars.SPY?.map((bar) => day(bar.t)) ?? [];
  if (dates.length < TRAINING_SESSIONS + PURGE_SESSIONS + EMBARGO_SESSIONS + OOS_SESSIONS + 2) {
    throw new ContractError("Short-horizon validation requires at least 594 aligned SPY sessions");
  }
  const candidates = SHORT_HORIZON_CANDIDATES.map((candidate) => validateCandidate(candidate, bars, dates));
  return {
    id: `validation:${STRATEGY_VERSION}:${input.as_of}:${input.data_checksum.slice(0, 12)}`,
    created_at: new Date().toISOString(),
    as_of: input.as_of,
    data_checksum: input.data_checksum,
    candidates,
  };
}

function validateCandidate(candidate: Candidate, bars: Record<string, Bar[]>, dates: string[]): CandidateValidation {
  const folds: ValidationFold[] = [];
  const all: SimulationResult[] = [];
  for (let oosStart = TRAINING_SESSIONS + PURGE_SESSIONS + EMBARGO_SESSIONS; oosStart + OOS_SESSIONS + 2 < dates.length; oosStart += OOS_SESSIONS) {
    const simulation = simulate(candidate, bars, dates, oosStart, oosStart + OOS_SESSIONS, BASE_ONE_WAY_COST_BPS);
    const metrics = metricsFor(simulation.returns, simulation.turnover, simulation.exposures);
    const primary = metricsFor(simulation.primary, 0, Array(simulation.primary.length).fill(0.9));
    const matched = metricsFor(simulation.matched, 0, simulation.exposures);
    folds.push({
      fold: folds.length + 1,
      train_start: dates[Math.max(0, oosStart - TRAINING_SESSIONS - PURGE_SESSIONS - EMBARGO_SESSIONS)],
      train_end: dates[oosStart - PURGE_SESSIONS - EMBARGO_SESSIONS - 1],
      oos_start: dates[oosStart],
      oos_end: dates[oosStart + OOS_SESSIONS - 1],
      metrics,
      primary_benchmark: primary,
      exposure_matched_benchmark: matched,
      active_return: metrics.cumulative_return - matched.cumulative_return,
    });
    all.push(simulation);
  }
  const aggregate = combine(all);
  const metrics = metricsFor(aggregate.returns, aggregate.turnover, aggregate.exposures);
  const primary = metricsFor(aggregate.primary, 0, Array(aggregate.primary.length).fill(0.9));
  const matched = metricsFor(aggregate.matched, 0, aggregate.exposures);
  const stress = combine(folds.map((_, index) => simulate(candidate, bars, dates, TRAINING_SESSIONS + PURGE_SESSIONS + EMBARGO_SESSIONS + index * OOS_SESSIONS, TRAINING_SESSIONS + PURGE_SESSIONS + EMBARGO_SESSIONS + (index + 1) * OOS_SESSIONS, STRESS_ONE_WAY_COST_BPS)));
  const stressMetrics = metricsFor(stress.returns, stress.turnover, stress.exposures);
  const positiveActiveFolds = folds.filter((fold) => fold.active_return > 0).length;
  const reasons = [
    ...(folds.length >= 8 ? [] : ["requires at least eight non-overlapping rolling OOS folds"]),
    ...(metrics.cumulative_return > matched.cumulative_return ? [] : ["requires positive aggregate OOS excess return versus exposure-matched SPY/BIL"]),
    ...(positiveActiveFolds >= 6 ? [] : ["requires positive excess return in at least six OOS folds"]),
    ...(metrics.max_drawdown >= -0.15 ? [] : ["requires aggregate OOS maximum drawdown <=15%"]),
    ...(metrics.max_drawdown >= matched.max_drawdown - 0.05 ? [] : ["cannot underperform exposure-matched benchmark drawdown by more than five points"]),
    ...(stressMetrics.cumulative_return > matched.cumulative_return ? [] : ["requires positive excess return after 40-bps one-way stress costs"]),
  ];
  return {
    candidate_id: candidate.id,
    strategy_version: STRATEGY_VERSION,
    max_holding_sessions: MAX_HOLDING_SESSIONS,
    configuration: { ...candidate, max_signal_lookback_sessions: 20, train_sessions: TRAINING_SESSIONS, purge_sessions: PURGE_SESSIONS, embargo_sessions: EMBARGO_SESSIONS, oos_sessions: OOS_SESSIONS, base_one_way_cost_bps: BASE_ONE_WAY_COST_BPS, stress_one_way_cost_bps: STRESS_ONE_WAY_COST_BPS },
    folds,
    metrics,
    primary_benchmark: primary,
    exposure_matched_benchmark: matched,
    stress_metrics: stressMetrics,
    approval: { status: reasons.length === 0 ? "approved" : "rejected", reasons, positive_active_folds: positiveActiveFolds, total_folds: folds.length, trial_count: SHORT_HORIZON_CANDIDATES.length },
  };
}

export function candidateTargets(candidate: Candidate, asOf: string, bars: Record<string, Bar[]>): TargetAllocation[] {
  const normalized = normalizeBars(bars);
  const eligible = ETF_UNIVERSE.filter((symbol) => symbol !== "BIL").map((symbol) => {
    const rows = normalized[symbol] ?? [];
    if (rows.length < 21) return { symbol, eligible: false, momentum20: Number.NEGATIVE_INFINITY, momentum5: Number.NEGATIVE_INFINITY, price: 0, sma10: 0, sma20: 0 };
    const price = rows.at(-1)!.c;
    const momentum20 = price / rows.at(-21)!.c - 1;
    const momentum5 = price / rows.at(-6)!.c - 1;
    const sma10 = average(rows.slice(-10).map((bar) => bar.c));
    const sma20 = average(rows.slice(-20).map((bar) => bar.c));
    const eligibleForCandidate = candidate.kind === "rotation-momentum"
      ? price > sma10 && momentum5 > 0 && price / rows.at(-11)!.c - 1 > 0 && momentum20 > 0
      : candidate.kind === "rotation-trend"
        ? price > sma20 && momentum20 > 0
        : symbol === "QQQ" && momentum20 > 0;
    return { symbol, eligible: eligibleForCandidate, momentum20, momentum5, price, sma10, sma20 };
  });
  const selected = eligible.filter((entry) => entry.eligible)
    .sort((left, right) => candidate.kind === "rotation-momentum" ? right.momentum5 - left.momentum5 : right.momentum20 - left.momentum20)
    .slice(0, candidate.kind === "qqq-trend" ? 1 : 3);
  const riskWeight = candidate.kind === "qqq-trend" ? 0.90 : 0.30;
  const targets: TargetAllocation[] = selected.map((entry, index) => ({ strategy_version: STRATEGY_VERSION, as_of: asOf, symbol: entry.symbol, sleeve: "etf", target_weight: riskWeight, reason: `${candidate.id} rank ${index + 1}; uses only 5/10/20-session indicators.` }));
  const allocated = targets.reduce((sum, target) => sum + target.target_weight, 0);
  targets.push({ strategy_version: STRATEGY_VERSION, as_of: asOf, symbol: "BIL", sleeve: "cash", target_weight: round(1 - allocated), reason: allocated >= 0.9 ? "10% T-bill reserve." : "Defensive T-bill allocation because no candidate passed." });
  return targets;
}

function simulate(candidate: Candidate, bars: Record<string, Bar[]>, dates: string[], start: number, end: number, oneWayCostBps: number): SimulationResult {
  const bySymbol = Object.fromEntries(Object.entries(bars).map(([symbol, rows]) => [symbol, new Map(rows.map((bar) => [day(bar.t), bar]))]));
  const returns: number[] = [], primary: number[] = [], matched: number[] = [], exposures: number[] = [];
  let previous: Weights = new Map();
  let turnover = 0;
  let equity = 1;
  let highWater = 1;
  for (let index = start; index < end; index += 1) {
    const signalBars = Object.fromEntries(Object.entries(bars).map(([symbol, rows]) => [symbol, rows.filter((bar) => day(bar.t) <= dates[index])]));
    const targets = candidateTargets(candidate, dates[index], signalBars);
    const weights = applyDrawdownThrottle(new Map(targets.map((target) => [target.symbol, target.target_weight])), equity / highWater - 1);
    const traded = totalTurnover(previous, weights);
    const executionDate = dates[index + 1];
    const exitDate = dates[index + 2];
    const riskExposure = [...weights.entries()].filter(([symbol]) => symbol !== "BIL").reduce((sum, [, weight]) => sum + weight, 0);
    let gross = 0;
    for (const [symbol, weight] of weights) gross += weight * openToOpen(bySymbol[symbol], executionDate, exitDate);
    const spyReturn = openToOpen(bySymbol.SPY, executionDate, exitDate);
    const billReturn = openToOpen(bySymbol.BIL, executionDate, exitDate);
    const netReturn = gross - traded * oneWayCostBps / 10_000;
    returns.push(netReturn);
    primary.push(0.9 * spyReturn + 0.1 * billReturn);
    matched.push(riskExposure * spyReturn + (1 - riskExposure) * billReturn);
    exposures.push(riskExposure);
    turnover += traded;
    previous = weights;
    equity *= 1 + netReturn;
    highWater = Math.max(highWater, equity);
  }
  return { returns, primary, matched, exposures, turnover };
}

function applyDrawdownThrottle(weights: Weights, drawdown: number): Weights {
  const multiplier = drawdown <= -0.15 ? 0 : drawdown <= -0.12 ? 0.50 : drawdown <= -0.08 ? 0.75 : 1;
  if (multiplier === 1) return weights;
  const throttled = new Map<string, number>();
  let riskWeight = 0;
  for (const [symbol, weight] of weights) {
    if (symbol === "BIL") continue;
    const adjusted = weight * multiplier;
    throttled.set(symbol, adjusted);
    riskWeight += adjusted;
  }
  throttled.set("BIL", 1 - riskWeight);
  return throttled;
}

function normalizeBars(input: Record<string, Bar[]>): Record<string, Bar[]> {
  return Object.fromEntries(Object.entries(input).map(([symbol, bars]) => [symbol.toUpperCase(), [...bars].sort((left, right) => left.t.localeCompare(right.t))]));
}
function openToOpen(rows: Map<string, Bar> | undefined, start: string, end: string): number { const first = rows?.get(start)?.o; const last = rows?.get(end)?.o; return first && last ? last / first - 1 : 0; }
function totalTurnover(left: Weights, right: Weights): number { return [...new Set([...left.keys(), ...right.keys()])].reduce((sum, symbol) => sum + Math.abs((left.get(symbol) ?? 0) - (right.get(symbol) ?? 0)), 0) / 2; }
function combine(results: SimulationResult[]): SimulationResult { return { returns: results.flatMap((result) => result.returns), primary: results.flatMap((result) => result.primary), matched: results.flatMap((result) => result.matched), exposures: results.flatMap((result) => result.exposures), turnover: results.reduce((sum, result) => sum + result.turnover, 0) }; }
function metricsFor(returns: number[], turnover: number, exposures: number[]): PerformanceMetrics { const equity = returns.reduce((value, daily) => value * (1 + daily), 1); const years = Math.max(returns.length / 252, 1 / 252); const mean = average(returns); const volatility = standardDeviation(returns) * Math.sqrt(252); const downside = Math.sqrt(average(returns.filter((value) => value < 0).map((value) => value ** 2))) * Math.sqrt(252); let highWater = 1, path = 1, drawdown = 0; for (const daily of returns) { path *= 1 + daily; highWater = Math.max(highWater, path); drawdown = Math.min(drawdown, path / highWater - 1); } return { cumulative_return: equity - 1, cagr: equity > 0 ? equity ** (1 / years) - 1 : -1, annualized_volatility: volatility, sharpe: volatility ? mean * 252 / volatility : null, sortino: downside ? mean * 252 / downside : null, max_drawdown: drawdown, turnover, win_rate: returns.length ? returns.filter((value) => value > 0).length / returns.length : null, average_exposure: average(exposures) }; }
function day(timestamp: string): string { return timestamp.slice(0, 10); }
function average(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function standardDeviation(values: number[]): number { if (values.length < 2) return 0; const mean = average(values); return Math.sqrt(average(values.map((value) => (value - mean) ** 2))); }
function round(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
