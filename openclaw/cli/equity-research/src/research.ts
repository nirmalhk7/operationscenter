import { Bar, CandidateScore, ContractError, PerformanceMetrics, StrategyManifest, TargetAllocation } from "./contracts.js";

// Liquid, diversified ETFs only.  This intentionally keeps Victor in a
// universe that the free Alpaca IEX feed can price reliably; it is not a
// stock picker or an intraday screener.
export const ETF_UNIVERSE = ["VTI", "QQQ", "IWM", "VEA", "VWO", "VNQ", "GLD", "DBC", "IEF", "TLT", "XLK", "XLF", "XLV", "XLE", "XLI", "BIL"] as const;
export const STRATEGY_VERSION = "mountainvalue-v3.0.0-20d-rotation";
export const MAX_HOLDING_SESSIONS = 20;
const MAX_SIGNAL_LOOKBACK_SESSIONS = 20;

export interface EtfResearchResult {
  as_of: string;
  strategy_version: string;
  scores: CandidateScore[];
  targets: TargetAllocation[];
  diagnostics: { portfolio_volatility: number; risk_assets_weight: number; data_complete: boolean };
}

export interface ApprovalInput {
  metrics: PerformanceMetrics;
  benchmark: PerformanceMetrics;
  rolling_three_year_excess_cagr: number[];
  out_of_sample: PerformanceMetrics[];
  stress_30bps: PerformanceMetrics;
  trial_count: number;
}

export function buildEtfResearch(input: {
  as_of: string;
  bars_by_symbol: Record<string, Bar[]>;
  strategy_version?: string;
}): EtfResearchResult {
  const version = input.strategy_version ?? STRATEGY_VERSION;
  const normalized = Object.fromEntries(Object.entries(input.bars_by_symbol).map(([symbol, bars]) => [symbol.toUpperCase(), sortedBars(bars)]));
  const bil = normalized.BIL;
  const spy = normalized.SPY;
  if (!bil || !spy || bil.length < MAX_SIGNAL_LOOKBACK_SESSIONS + 1 || spy.length < MAX_SIGNAL_LOOKBACK_SESSIONS + 1) {
    throw new ContractError("ETF research requires 21 adjusted daily bars for BIL and SPY");
  }
  const spyReturn20 = returnOver(spy, 20);
  const spySma10 = average(spy.slice(-10).map((bar) => bar.c));
  const riskOn = spy.at(-1)!.c > spySma10 && spyReturn20 > 0;
  const scores: CandidateScore[] = ETF_UNIVERSE.filter((symbol) => symbol !== "BIL").map((symbol) => {
    const bars = normalized[symbol];
    if (!bars || bars.length < MAX_SIGNAL_LOOKBACK_SESSIONS + 1) return unavailableScore(version, input.as_of, symbol, "missing 21 adjusted daily bars");
    const price = bars.at(-1)?.c ?? 0;
    const sma10 = average(bars.slice(-10).map((bar) => bar.c));
    const returns = [5, 10, 20].map((days) => returnOver(bars, days));
    const momentum = weighted(returns, [0.25, 0.35, 0.40]);
    const vol20 = volatility(returnsSeries(bars, 20)) * Math.sqrt(252);
    const eligible = riskOn && price > sma10 && returns.every((value) => value > 0);
    return {
      strategy_version: version,
      symbol,
      sleeve: "etf",
      as_of: input.as_of,
      eligible,
      total_score: round(momentum - vol20 * 0.15),
      components: { return_5d: round(returns[0]), return_10d: round(returns[1]), return_20d: round(returns[2]), spy_return_20d: round(spyReturn20), sma_10: round(sma10), price: round(price), vol_20d: round(vol20) },
      rank: null,
      sector: null,
      reason: eligible ? "risk-on; positive 5/10/20-day momentum above 10-day trend" : "failed risk-on, 10-day trend, or positive 5/10/20-day momentum gate",
    };
  });
  const ranked = scores.filter((score) => score.eligible).sort((a, b) => b.total_score - a.total_score || a.symbol.localeCompare(b.symbol)).map((score, index) => ({ ...score, rank: index + 1 }));
  const scored = scores.map((score) => ranked.find((entry) => entry.symbol === score.symbol) ?? score);
  const selected = ranked.slice(0, 3);
  const riskBudget = selected.length * 0.30;
  const targets: TargetAllocation[] = selected.map((score) => ({
    strategy_version: version,
    as_of: input.as_of,
    symbol: score.symbol,
    sleeve: "etf",
    target_weight: 0.30,
    reason: `Daily 20-session rotation rank ${score.rank}; positive 5/10/20-day momentum, 10-day trend, no leverage.`,
  }));
  const allocated = targets.reduce((sum, target) => sum + target.target_weight, 0);
  targets.push({ strategy_version: version, as_of: input.as_of, symbol: "BIL", sleeve: "cash", target_weight: round(1 - allocated), reason: selected.length === 3 ? "10% T-bill reserve; 90% maximum risk-asset exposure." : "Defensive T-bill allocation because fewer than three 20-session candidates passed." });
  return { as_of: input.as_of, strategy_version: version, scores: scored, targets, diagnostics: { portfolio_volatility: round(selected.length ? average(selected.map((score) => Number(score.components.vol_20d ?? 0))) : 0), risk_assets_weight: round(riskBudget), data_complete: scores.every((score) => score.reason !== "missing 21 adjusted daily bars") } };
}

export function approvalFromBacktest(input: ApprovalInput): { status: "approved" | "rejected"; reasons: string[]; deflated_sharpe_confidence: number } {
  const oosSortino = input.out_of_sample.map((entry) => entry.sortino ?? Number.NEGATIVE_INFINITY);
  const windowsPass = input.out_of_sample.length >= 4 && oosSortino.every((sortino) => sortino >= 1 && sortino >= (input.benchmark.sortino ?? 0) + 0.1);
  const rollingPass = input.rolling_three_year_excess_cagr.length > 0 && input.rolling_three_year_excess_cagr.filter((value) => value > 0).length / input.rolling_three_year_excess_cagr.length >= 0.70;
  const stressPass = input.stress_30bps.cagr > 0;
  const drawdownPass = input.metrics.max_drawdown >= -0.15;
  const confidence = deflatedSharpeConfidence(input.metrics.sharpe ?? 0, input.trial_count, Math.max(252, input.out_of_sample.length * 252));
  const confidencePass = confidence >= 0.95;
  const reasons = [
    ...(windowsPass ? [] : ["requires >=4 OOS years with Sortino >=1 and >=0.1 above 60/40 benchmark"]),
    ...(rollingPass ? [] : ["requires positive excess CAGR in >=70% rolling three-year windows"]),
    ...(stressPass ? [] : ["requires positive 30-bps stress CAGR"]),
    ...(drawdownPass ? [] : ["requires maximum drawdown <=15%"]),
    ...(confidencePass ? [] : ["requires deflated Sharpe confidence >=95%"]),
  ];
  return { status: reasons.length === 0 ? "approved" : "rejected", reasons, deflated_sharpe_confidence: confidence };
}

export function currentDrawdownTier(drawdownPct: number): "normal" | "reduce_25" | "reduce_50" | "halt" {
  if (drawdownPct <= -0.15) return "halt";
  if (drawdownPct <= -0.12) return "reduce_50";
  if (drawdownPct <= -0.08) return "reduce_25";
  return "normal";
}

export function stopDistance(atrPercent: number, sleeve: "etf" | "stock", symbol: string): number | null {
  if (symbol === "BIL") return null;
  return sleeve === "stock" ? clamp(3 * atrPercent, 0.08, 0.15) : clamp(3 * atrPercent, 0.06, 0.10);
}

export function lossBudgetQuantity(input: { nav: number; targetWeight: number; cash: number; price: number; stopDistance: number; sleeve: "etf" | "stock"; riskBudgetPct?: number }): number {
  const riskBudget = input.nav * (input.riskBudgetPct ?? (input.sleeve === "stock" ? 0.0075 : 0.01));
  const byRisk = riskBudget / Math.max(0.0001, input.price * input.stopDistance);
  const byTarget = (input.nav * input.targetWeight) / input.price;
  const byCash = input.cash / input.price;
  return Math.floor(Math.max(0, Math.min(byRisk, byTarget, byCash)) * 1000) / 1000;
}

function unavailableScore(strategyVersion: string, asOf: string, symbol: string, reason: string): CandidateScore {
  return { strategy_version: strategyVersion, symbol, sleeve: "etf", as_of: asOf, eligible: false, total_score: Number.NEGATIVE_INFINITY, components: {}, rank: null, sector: null, reason };
}
function sortedBars(bars: Bar[]): Bar[] { return [...bars].sort((a, b) => a.t.localeCompare(b.t)); }
function returnOver(bars: Bar[], days: number): number { const last = bars.at(-1)?.c; const past = bars.at(-(days + 1))?.c; return last && past ? last / past - 1 : Number.NEGATIVE_INFINITY; }
function returnsSeries(bars: Bar[], length: number): number[] { return bars.slice(-(length + 1)).slice(1).map((bar, index) => bar.c / bars.slice(-(length + 1))[index].c - 1); }
function weighted(values: number[], weights: number[]): number { return values.reduce((sum, value, index) => sum + value * weights[index], 0); }
function average(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function volatility(values: number[]): number { const mean = average(values); return Math.sqrt(average(values.map((value) => (value - mean) ** 2))); }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function round(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
function normalCdf(value: number): number { return 0.5 * (1 + erf(value / Math.SQRT2)); }
function erf(value: number): number { const sign = value < 0 ? -1 : 1; const x = Math.abs(value); const a1 = 0.254829592; const a2 = -0.284496736; const a3 = 1.421413741; const a4 = -1.453152027; const a5 = 1.061405429; const p = 0.3275911; const t = 1 / (1 + p * x); return sign * (1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)); }
function deflatedSharpeConfidence(sharpe: number, trials: number, observations: number): number { const expectedMax = Math.sqrt(2 * Math.log(Math.max(1, trials))); const z = (sharpe - expectedMax) * Math.sqrt(Math.max(1, observations - 1)); return normalCdf(z); }
