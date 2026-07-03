export const MOUNTAINVALUE_WATCHLIST = [
  "SPY",
  "QQQ",
  "IWM",
  "XLK",
  "XLF",
  "XLV",
  "XLE",
  "XLI",
] as const;

export const MOUNTAINVALUE_TRADABLE_SYMBOLS = [
  "QQQ",
  "IWM",
  "XLK",
  "XLF",
  "XLV",
  "XLE",
  "XLI",
] as const;

export type WatchlistSymbol = typeof MOUNTAINVALUE_WATCHLIST[number];
export type TradableSymbol = typeof MOUNTAINVALUE_TRADABLE_SYMBOLS[number];
export type ExecutionMode = "paper" | "live";
export type TradingSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit";
export type TimeInForce = "day" | "gtc";
export type StrategySignal = "BUY_CANDIDATE" | "NO_BUY" | "EXIT_POSITION" | "NO_EXIT";
export type WorkflowStatus = "NO_TRADE" | "ORDER_SUBMITTED" | "ORDER_FILLED" | "EXIT_SUBMITTED" | "BLOCKED" | "SKIPPED" | "ERROR";
export type AuditKind = "info" | "warn" | "error";

export interface TradingConfig {
  execution_mode: ExecutionMode;
  autonomous_execution_enabled: boolean;
  alpaca_trading_base_url: string;
  alpaca_data_base_url: string;
  alpaca_data_feed: string;
  alpaca_api_key: string;
  alpaca_secret_key: string;
  paper_strategy_capital_usd: number;
  max_open_positions: number;
  max_new_entries_per_day: number;
  max_position_notional_pct: number;
  max_total_invested_pct: number;
  minimum_order_notional_usd: number;
  max_quote_age_seconds: number;
  max_spread_bps: number;
  max_midpoint_deviation_pct: number;
  order_client_prefix: string;
  ledger_path: string;
  timezone: string;
}

export interface TradingState {
  trading_enabled: boolean;
  execution_mode: ExecutionMode;
  starting_capital_usd: number;
  virtual_cash_usd: number;
  realized_pnl_usd: number;
  last_strategy_equity_usd: number;
  pause_reason: string | null;
  paused_at: string | null;
  resumed_at: string | null;
  resumed_by: string | null;
  last_signals_for: string | null;
  last_cycle_for: string | null;
  last_watchdog_for: string | null;
  last_cancel_for: string | null;
  last_entry_date: string | null;
}

export interface ClockSnapshot {
  timestamp: string;
  is_open: boolean;
  next_open?: string | null;
  next_close?: string | null;
}

export interface AccountSnapshot {
  status?: string;
  buying_power?: number;
  cash?: number;
  equity?: number;
  portfolio_value?: number;
  day_trade_count?: number;
  pattern_day_trader?: boolean;
  currency?: string;
  raw?: unknown;
}

export interface PositionSnapshot {
  symbol: string;
  qty: number;
  market_value?: number;
  avg_entry_price?: number;
  current_price?: number;
  unrealized_pl?: number;
  unrealized_plpc?: number;
  side?: "long" | "short";
  entry_date?: string | null;
  entry_order_id?: string | null;
  protective_stop_price?: number | null;
  protective_stop_order_id?: string | null;
  raw?: unknown;
}

export interface OrderSnapshot {
  id: string;
  client_order_id?: string;
  symbol: string;
  side: TradingSide;
  type: OrderType;
  status: string;
  qty?: number;
  filled_qty?: number;
  limit_price?: number | null;
  stop_price?: number | null;
  filled_avg_price?: number | null;
  created_at?: string;
  submitted_at?: string;
  filled_at?: string | null;
  canceled_at?: string | null;
  raw?: unknown;
}

export interface Bar {
  symbol: string;
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export interface Quote {
  symbol: string;
  timestamp: string;
  bid: number;
  ask: number;
  bid_size?: number;
  ask_size?: number;
  raw?: unknown;
}

export interface IndicatorSet {
  symbol: string;
  previous_close: number;
  sma_20: number | null;
  sma_50: number | null;
  sma_200: number | null;
  return_20d: number | null;
  highest_high_20d: number | null;
  atr_14: number | null;
  atr_percent: number | null;
  relative_strength_20d_vs_spy: number | null;
  above_20d_high_ratio: number | null;
}

export interface SignalDecision {
  symbol: WatchlistSymbol;
  action: StrategySignal;
  eligible: boolean;
  score: number;
  rank?: number | null;
  reason: string;
  checks: Record<string, boolean | number | null>;
  indicators: IndicatorSet;
}

export interface TradeIntent {
  trade_date: string;
  created_at: string;
  symbol: TradableSymbol | WatchlistSymbol;
  action: "buy" | "sell" | "none";
  reason: string;
  quantity?: number;
  limit_price?: number | null;
  stop_price?: number | null;
  signal?: SignalDecision;
}

export interface CycleResult {
  status: WorkflowStatus;
  trade_date: string;
  actions: Array<Record<string, unknown>>;
  skipped: Array<Record<string, unknown>>;
  paused: boolean;
  reason?: string | null;
}

export interface ReportSummary {
  mode: ExecutionMode;
  trading_enabled: boolean;
  trade_date: string;
  strategy_equity: number;
  cash: number;
  realized_pnl: number;
  invested: number;
  open_positions: PositionSnapshot[];
  open_orders: OrderSnapshot[];
  today_intent: TradeIntent | null;
  signals: SignalDecision[];
  skipped_trades: Array<Record<string, unknown>>;
  audit_count: number;
  pause_reason: string | null;
  watchdog: Record<string, unknown>;
}

export interface AuditRecord {
  timestamp: string;
  step: string;
  kind: AuditKind;
  symbol?: string | null;
  message: string;
  payload: Record<string, unknown>;
}

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

export function assertRecord(value: unknown, message = "expected object"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractError(message);
  }
  return value as Record<string, unknown>;
}

export function assertString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ContractError(message);
  }
  return value;
}

export function assertNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ContractError(message);
  }
  return value;
}

export function asNullableNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function isWatchlistSymbol(value: string): value is WatchlistSymbol {
  return (MOUNTAINVALUE_WATCHLIST as readonly string[]).includes(value);
}

export function isTradableSymbol(value: string): value is TradableSymbol {
  return (MOUNTAINVALUE_TRADABLE_SYMBOLS as readonly string[]).includes(value);
}

export function normalizeSymbol(symbol: string): string {
  return assertString(symbol, "symbol required").trim().toUpperCase();
}

export function createDefaultState(mode: ExecutionMode): TradingState {
  return {
    trading_enabled: true,
    execution_mode: mode,
    starting_capital_usd: 100,
    virtual_cash_usd: 100,
    realized_pnl_usd: 0,
    last_strategy_equity_usd: 100,
    pause_reason: null,
    paused_at: null,
    resumed_at: null,
    resumed_by: null,
    last_signals_for: null,
    last_cycle_for: null,
    last_watchdog_for: null,
    last_cancel_for: null,
    last_entry_date: null,
  };
}
